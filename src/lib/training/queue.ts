import { contributionFormData } from "./payload.ts";
import {
  capTrainingQueue,
  pendingForConsent,
  retainForConsent,
  settleTrainingAttempt,
  withoutPendingForConsent,
} from "./policy.ts";
import type { TrainingAttemptOutcome, TrainingConsent, TrainingQueueRecord } from "./types.ts";

const DB_NAME = "pnp-studio-training";
const STORE = "queue";

let chain: Promise<void> = Promise.resolve();
let activeController: AbortController | null = null;

export function cancelTrainingUploads(): void {
  activeController?.abort();
}

export async function loadTrainingQueue(): Promise<TrainingQueueRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(normalizeAll(req.result));
    req.onerror = () => reject(req.error);
  });
}

export function enqueueTrainingRecord(record: TrainingQueueRecord): Promise<TrainingQueueRecord[]> {
  return updateQueue((records) =>
    capTrainingQueue([record, ...records.filter((row) => row.id !== record.id)]),
  );
}

export function removePendingTrainingRecord(id: string): Promise<TrainingQueueRecord[]> {
  return updateQueue((records) => {
    const target = records.find((record) => record.id === id);
    if (!target || target.status === "uploaded") return records;
    return records.filter((record) => record.id !== id);
  });
}

export function clearPendingForConsent(consentAt: string): Promise<TrainingQueueRecord[]> {
  return updateQueue((records) => withoutPendingForConsent(records, consentAt));
}

export function forgetTrainingIds(ids: string[]): Promise<TrainingQueueRecord[]> {
  const drop = new Set(ids);
  return updateQueue((records) => records.filter((record) => !drop.has(record.id)));
}

export function flushTrainingQueue(input: {
  consent: TrainingConsent;
  isAllowed: () => boolean;
}): Promise<TrainingQueueRecord[]> {
  const run = chain.then(() => flushOnce(input));
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function flushOnce(input: {
  consent: TrainingConsent;
  isAllowed: () => boolean;
}): Promise<TrainingQueueRecord[]> {
  let records = await updateQueue((current) =>
    capTrainingQueue(retainForConsent(current, input.consent)),
  );
  if (!input.isAllowed()) return records;

  const controller = new AbortController();
  activeController = controller;
  try {
    const waiting = pendingForConsent(records, input.consent);
    for (const record of waiting) {
      if (!input.isAllowed() || controller.signal.aborted) break;
      const outcome = await postContribution(record, controller.signal);
      const stopped = !input.isAllowed() || controller.signal.aborted;
      if (outcome === "uploaded" || (!stopped && outcome !== "aborted")) {
        records = await updateQueue((current) =>
          settleTrainingAttempt(current, record.id, outcome, record),
        );
      }
      if (stopped || outcome === "stop" || outcome === "aborted") break;
    }
  } finally {
    if (activeController === controller) activeController = null;
  }
  return loadTrainingQueue();
}

async function postContribution(
  record: TrainingQueueRecord,
  signal: AbortSignal,
): Promise<TrainingAttemptOutcome> {
  const form = contributionFormData(record);
  if (!form) return "drop";
  try {
    const response = await fetch("/api/training/contribute", {
      method: "POST",
      body: form,
      signal,
    });
    if (response.ok) return "uploaded";
    if (response.status === 400 || response.status === 403 || response.status === 413)
      return "drop";
    if (response.status === 503) return "stop";
    return "retry";
  } catch {
    if (signal.aborted) return "aborted";
    return "retry";
  }
}

function normalizeAll(value: unknown): TrainingQueueRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const record = normalizeRecord(row);
    return record ? [record] : [];
  });
}

function normalizeRecord(raw: unknown): TrainingQueueRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<TrainingQueueRecord>;
  if (typeof row.id !== "string" || !row.id) return null;
  if (row.status !== "pending" && row.status !== "failed" && row.status !== "uploaded") return null;
  if (typeof row.contributorId !== "string" || typeof row.consentAt !== "string") return null;
  if (typeof row.createdAt !== "string" || typeof row.prompt !== "string") return null;
  if (row.status !== "uploaded" && typeof row.resultDataUrl !== "string") return null;
  return {
    id: row.id,
    status: row.status,
    contributorId: row.contributorId,
    consentAt: row.consentAt,
    createdAt: row.createdAt,
    prompt: row.prompt,
    resultDataUrl: typeof row.resultDataUrl === "string" ? row.resultDataUrl : undefined,
    sourceDataUrl: typeof row.sourceDataUrl === "string" ? row.sourceDataUrl : undefined,
    enqueuedAt: typeof row.enqueuedAt === "number" ? row.enqueuedAt : 0,
    attempts: typeof row.attempts === "number" ? row.attempts : 0,
  };
}

function serialize(record: TrainingQueueRecord): TrainingQueueRecord {
  const next: TrainingQueueRecord = {
    id: record.id,
    status: record.status,
    contributorId: record.contributorId,
    consentAt: record.consentAt,
    createdAt: record.createdAt,
    prompt: record.prompt,
    enqueuedAt: record.enqueuedAt,
    attempts: record.attempts,
  };
  if (record.resultDataUrl) next.resultDataUrl = record.resultDataUrl;
  if (record.sourceDataUrl) next.sourceDataUrl = record.sourceDataUrl;
  return next;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open the training queue."));
  });
}

function updateQueue(
  mutate: (records: TrainingQueueRecord[]) => TrainingQueueRecord[],
): Promise<TrainingQueueRecord[]> {
  return new Promise((resolve, reject) => {
    openDb().then(
      (db) => {
        let next: TrainingQueueRecord[] = [];
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          next = mutate(normalizeAll(req.result));
          store.clear();
          for (const row of next) store.put(serialize(row));
        };
        req.onerror = () => reject(req.error ?? new Error("Could not read the training queue."));
        tx.oncomplete = () => resolve(next);
        tx.onerror = () => reject(tx.error ?? new Error("Could not update the training queue."));
      },
      (err) => reject(err),
    );
  });
}
