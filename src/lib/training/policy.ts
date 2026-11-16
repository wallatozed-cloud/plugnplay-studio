import { isContributorId, createContributorId } from "./ids.ts";
import {
  AGE_STORAGE_KEY,
  CONSENT_STORAGE_KEY,
  CONTRIBUTOR_STORAGE_KEY,
  type KeyValueStore,
} from "./storage.ts";
import type {
  TrainingAttemptOutcome,
  TrainingConsent,
  TrainingItemView,
  TrainingQueueRecord,
  TrainingQueueView,
} from "./types.ts";

export const MAX_TRAINING_QUEUE = 8;
export const MAX_TRAINING_ATTEMPTS = 8;

const defaultConsent = (): TrainingConsent => ({ optedIn: false, consentAt: null });

export function parseAgeConfirmation(raw: string | null): { confirmedAt: string } | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { confirmed?: unknown; confirmedAt?: unknown };
    if (value.confirmed !== true || typeof value.confirmedAt !== "string") return null;
    const ms = Date.parse(value.confirmedAt);
    if (!Number.isFinite(ms)) return null;
    return { confirmedAt: new Date(ms).toISOString() };
  } catch {
    return null;
  }
}

export function readAgeConfirmation(store: KeyValueStore): { confirmedAt: string } | null {
  return parseAgeConfirmation(store.getItem(AGE_STORAGE_KEY));
}

export function confirmAge(store: KeyValueStore, now: Date): { confirmedAt: string } {
  const confirmedAt = now.toISOString();
  store.setItem(AGE_STORAGE_KEY, JSON.stringify({ confirmed: true, confirmedAt }));
  return { confirmedAt };
}

export function parseConsent(raw: string | null): TrainingConsent {
  if (!raw) return defaultConsent();
  try {
    const value = JSON.parse(raw) as { optedIn?: unknown; consentAt?: unknown };
    if (value.optedIn !== true || typeof value.consentAt !== "string") return defaultConsent();
    const ms = Date.parse(value.consentAt);
    if (!Number.isFinite(ms)) return defaultConsent();
    return { optedIn: true, consentAt: new Date(ms).toISOString() };
  } catch {
    return defaultConsent();
  }
}

export function readConsent(store: KeyValueStore): TrainingConsent {
  return parseConsent(store.getItem(CONSENT_STORAGE_KEY));
}

export function readContributorId(store: KeyValueStore): string | null {
  const value = store.getItem(CONTRIBUTOR_STORAGE_KEY);
  if (!value || !isContributorId(value)) return null;
  return value;
}

/**
 * Turn training on and stamp the consent time. The device id is created once
 * and reused so later opt-ins stay anonymous and stable.
 */
export function optInToTraining(
  store: KeyValueStore,
  now: Date,
  createId: () => string = createContributorId,
): { consent: TrainingConsent; contributorId: string } {
  const existing = readContributorId(store);
  const contributorId = existing ?? createId();
  if (!isContributorId(contributorId)) {
    throw new Error("Could not create a contributor id.");
  }
  const consent: TrainingConsent = { optedIn: true, consentAt: now.toISOString() };
  store.setItem(CONTRIBUTOR_STORAGE_KEY, contributorId);
  store.setItem(CONSENT_STORAGE_KEY, JSON.stringify(consent));
  return { consent, contributorId };
}

export function optOutOfTraining(store: KeyValueStore): TrainingConsent {
  const consent = defaultConsent();
  store.setItem(CONSENT_STORAGE_KEY, JSON.stringify(consent));
  return consent;
}

export function toQueueViews(records: TrainingQueueRecord[]): TrainingQueueView[] {
  return records.map((record) => ({
    id: record.id,
    status: record.status,
    consentAt: record.consentAt,
  }));
}

/** Pending rows only count when they were approved under the current consent. */
export function pendingForConsent(
  records: TrainingQueueRecord[],
  consent: TrainingConsent,
): TrainingQueueRecord[] {
  if (!consent.optedIn || !consent.consentAt) return [];
  return records.filter(
    (record) =>
      (record.status === "pending" || record.status === "failed") &&
      record.consentAt === consent.consentAt,
  );
}

/** Drop waiting uploads from other consent periods. Keep sent markers. */
export function retainForConsent(
  records: TrainingQueueRecord[],
  consent: TrainingConsent,
): TrainingQueueRecord[] {
  return records.filter((record) => {
    if (record.status === "uploaded") return true;
    return Boolean(consent.optedIn && consent.consentAt && record.consentAt === consent.consentAt);
  });
}

/** Opt-out: delete anything still waiting that was approved under this consent. */
export function withoutPendingForConsent(
  records: TrainingQueueRecord[],
  consentAt: string,
): TrainingQueueRecord[] {
  return records.filter((record) => record.status === "uploaded" || record.consentAt !== consentAt);
}

export function capTrainingQueue(records: TrainingQueueRecord[]): TrainingQueueRecord[] {
  const waiting: TrainingQueueRecord[] = [];
  const uploaded: TrainingQueueRecord[] = [];
  for (const record of records) {
    if (record.status === "uploaded") uploaded.push(record);
    else waiting.push(record);
  }
  const byNewest = (a: TrainingQueueRecord, b: TrainingQueueRecord) => b.enqueuedAt - a.enqueuedAt;
  waiting.sort(byNewest);
  uploaded.sort(byNewest);
  return [...waiting.slice(0, MAX_TRAINING_QUEUE), ...uploaded.slice(0, MAX_TRAINING_QUEUE)];
}

export function trainingItemView(input: {
  featureEnabled: boolean;
  consent: TrainingConsent;
  record?: TrainingQueueView;
}): TrainingItemView {
  if (!input.featureEnabled || !input.consent.optedIn || !input.consent.consentAt) return "hidden";
  const record = input.record;
  if (!record) return "approve";
  if (record.status === "uploaded") return "sent";
  if (record.consentAt !== input.consent.consentAt) return "approve";
  if (record.status === "failed") return "failed";
  return "pending";
}

/**
 * Nothing in history is uploadable on its own. A queue record is created only
 * when the user taps Approve after the current opt-in.
 */
export function explicitQueueIds(
  records: TrainingQueueRecord[],
  consent: TrainingConsent,
): string[] {
  return pendingForConsent(records, consent).map((record) => record.id);
}

export function settleTrainingAttempt(
  records: TrainingQueueRecord[],
  id: string,
  outcome: TrainingAttemptOutcome,
  snapshot: TrainingQueueRecord,
): TrainingQueueRecord[] {
  if (outcome === "stop" || outcome === "aborted") return records;
  if (outcome === "drop") return records.filter((record) => record.id !== id);
  if (outcome === "uploaded") {
    const base = records.find((record) => record.id === id) ?? snapshot;
    const uploaded: TrainingQueueRecord = {
      id: base.id,
      status: "uploaded",
      contributorId: base.contributorId,
      consentAt: base.consentAt,
      createdAt: base.createdAt,
      prompt: base.prompt,
      enqueuedAt: base.enqueuedAt,
      attempts: base.attempts,
    };
    return capTrainingQueue([uploaded, ...records.filter((record) => record.id !== id)]);
  }
  const current = records.find((record) => record.id === id);
  if (!current || current.status === "uploaded") return records;
  const attempts = current.attempts + 1;
  if (attempts >= MAX_TRAINING_ATTEMPTS) {
    return records.filter((record) => record.id !== id);
  }
  return records.map((record) =>
    record.id === id ? { ...record, status: "failed", attempts } : record,
  );
}
