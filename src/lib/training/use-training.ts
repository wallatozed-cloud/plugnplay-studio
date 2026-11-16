import { useCallback, useEffect, useRef, useState } from "react";
import { buildTrainingRecord, type TrainingApprovalInput } from "./payload.ts";
import {
  optInToTraining,
  optOutOfTraining,
  readConsent,
  readContributorId,
  toQueueViews,
  trainingItemView,
} from "./policy.ts";
import {
  cancelTrainingUploads,
  clearPendingForConsent,
  enqueueTrainingRecord,
  flushTrainingQueue,
  forgetTrainingIds,
  loadTrainingQueue,
  removePendingTrainingRecord,
} from "./queue.ts";
import { browserStore } from "./storage.ts";
import type { TrainingConsent, TrainingItemView, TrainingQueueView } from "./types.ts";

export type TrainingActionResult = { ok: true } | { ok: false; error: string };

async function fetchTrainingEnabled(): Promise<boolean> {
  try {
    const response = await fetch("/api/training/status", { cache: "no-store" });
    if (!response.ok) return false;
    const body = (await response.json()) as { enabled?: unknown };
    return body.enabled === true;
  } catch {
    return false;
  }
}

export function useTraining() {
  const [enabled, setEnabled] = useState(false);
  const [consent, setConsent] = useState<TrainingConsent>({ optedIn: false, consentAt: null });
  const [queue, setQueue] = useState<TrainingQueueView[]>([]);
  const [ready, setReady] = useState(false);
  const consentRef = useRef(consent);
  const enabledRef = useRef(enabled);
  const runId = useRef(0);
  consentRef.current = consent;
  enabledRef.current = enabled;

  const publish = useCallback((records: Parameters<typeof toQueueViews>[0]) => {
    setQueue(toQueueViews(records));
  }, []);

  const flush = useCallback(async () => {
    const id = runId.current;
    const records = await flushTrainingQueue({
      consent: consentRef.current,
      isAllowed: () =>
        runId.current === id && enabledRef.current && consentRef.current.optedIn === true,
    });
    if (runId.current === id) publish(records);
    return records;
  }, [publish]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [nextEnabled, storedConsent, storedQueue] = await Promise.all([
        fetchTrainingEnabled(),
        Promise.resolve(readConsent(browserStore())),
        loadTrainingQueue().catch(() => []),
      ]);
      if (cancelled) return;
      setEnabled(nextEnabled);
      setConsent(storedConsent);
      publish(storedQueue);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [publish]);

  useEffect(() => {
    if (!ready || !enabled || !consent.optedIn) return;
    void flush();
    const onWake = () => {
      if (document.visibilityState === "hidden") return;
      void flush();
    };
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [ready, enabled, consent.optedIn, flush]);

  const optIn = useCallback((): TrainingActionResult => {
    try {
      const next = optInToTraining(browserStore(), new Date());
      setConsent(next.consent);
      return { ok: true };
    } catch {
      return { ok: false, error: "This device couldn't save that choice." };
    }
  }, []);

  const optOut = useCallback(async (): Promise<TrainingActionResult> => {
    const previous = consentRef.current.consentAt;
    try {
      optOutOfTraining(browserStore());
    } catch {
      return { ok: false, error: "This device couldn't save that choice." };
    }
    runId.current += 1;
    cancelTrainingUploads();
    setConsent({ optedIn: false, consentAt: null });
    if (!previous) return { ok: true };
    try {
      publish(await clearPendingForConsent(previous));
    } catch {
      setQueue([]);
    }
    return { ok: true };
  }, [publish]);

  const approve = useCallback(
    async (input: TrainingApprovalInput): Promise<TrainingActionResult> => {
      const current = consentRef.current;
      if (!enabledRef.current || !current.optedIn || !current.consentAt) {
        return { ok: false, error: "Turn on training in Settings before approving a photo." };
      }
      const contributorId = readContributorId(browserStore());
      if (!contributorId) {
        return { ok: false, error: "Turn on training in Settings before approving a photo." };
      }
      const built = buildTrainingRecord({
        ...input,
        contributorId,
        consentAt: current.consentAt,
      });
      if (!built.ok) return built;
      try {
        publish(await enqueueTrainingRecord(built.record));
      } catch {
        return { ok: false, error: "This device couldn't save the photo for upload." };
      }
      void flush();
      return { ok: true };
    },
    [flush, publish],
  );

  const unapprove = useCallback(
    async (id: string) => {
      cancelTrainingUploads();
      try {
        publish(await removePendingTrainingRecord(id));
      } catch {
        // Leave the previous view. The photo may still be queued.
      }
    },
    [publish],
  );

  const forget = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      cancelTrainingUploads();
      try {
        publish(await forgetTrainingIds(ids));
      } catch {
        // History can still clear if the training queue is unavailable.
      }
    },
    [publish],
  );

  const viewFor = useCallback(
    (id: string): TrainingItemView =>
      trainingItemView({
        featureEnabled: enabled,
        consent,
        record: queue.find((row) => row.id === id),
      }),
    [consent, enabled, queue],
  );

  return {
    ready,
    enabled,
    optedIn: enabled && consent.optedIn,
    consentAt: enabled ? consent.consentAt : null,
    viewFor,
    optIn,
    optOut,
    approve,
    unapprove,
    forget,
  };
}

export type TrainingController = ReturnType<typeof useTraining>;
