import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  capTrainingQueue,
  confirmAge,
  explicitQueueIds,
  MAX_TRAINING_QUEUE,
  optInToTraining,
  optOutOfTraining,
  pendingForConsent,
  readAgeConfirmation,
  readConsent,
  readContributorId,
  retainForConsent,
  settleTrainingAttempt,
  trainingItemView,
  withoutPendingForConsent,
} from "./policy.ts";
import type { KeyValueStore } from "./storage.ts";
import type { TrainingConsent, TrainingQueueRecord } from "./types.ts";

const CONTRIBUTOR = "11111111-1111-4111-8111-111111111111";
const CONSENT_AT = "2026-11-16T08:00:00.000Z";

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function record(overrides: Partial<TrainingQueueRecord> = {}): TrainingQueueRecord {
  return {
    id: "edit-1",
    status: "pending",
    contributorId: CONTRIBUTOR,
    consentAt: CONSENT_AT,
    createdAt: "2020-01-01T00:00:00.000Z",
    prompt: "Make it night",
    resultDataUrl: "data:image/jpeg;base64,abc",
    enqueuedAt: 1,
    attempts: 0,
    ...overrides,
  };
}

const optedIn: TrainingConsent = { optedIn: true, consentAt: CONSENT_AT };

describe("age confirmation", () => {
  it("starts unconfirmed and stores a one-time confirmation", () => {
    const store = memoryStore();
    assert.equal(readAgeConfirmation(store), null);
    const saved = confirmAge(store, new Date("2026-11-16T08:03:00.000Z"));
    assert.equal(saved.confirmedAt, "2026-11-16T08:03:00.000Z");
    assert.deepEqual(readAgeConfirmation(store), saved);
  });

  it("does not treat a decline or junk as confirmation", () => {
    const store = memoryStore();
    store.setItem("pnp-studio-age", JSON.stringify({ confirmed: false }));
    assert.equal(readAgeConfirmation(store), null);
    store.setItem("pnp-studio-age", "nope");
    assert.equal(readAgeConfirmation(store), null);
  });
});

describe("training consent", () => {
  it("is off until the user opts in", () => {
    const store = memoryStore();
    assert.deepEqual(readConsent(store), { optedIn: false, consentAt: null });
    const first = optInToTraining(store, new Date(CONSENT_AT), () => CONTRIBUTOR);
    assert.equal(first.consent.optedIn, true);
    assert.equal(first.consent.consentAt, CONSENT_AT);
    assert.equal(first.contributorId, CONTRIBUTOR);
    const second = optInToTraining(store, new Date("2026-12-01T00:00:00.000Z"), () => {
      throw new Error("should reuse the device id");
    });
    assert.equal(second.contributorId, CONTRIBUTOR);
    assert.equal(readContributorId(store), CONTRIBUTOR);
  });

  it("opt-out clears consent and keeps the anonymous device id", () => {
    const store = memoryStore();
    optInToTraining(store, new Date(CONSENT_AT), () => CONTRIBUTOR);
    assert.deepEqual(optOutOfTraining(store), { optedIn: false, consentAt: null });
    assert.equal(readContributorId(store), CONTRIBUTOR);
    assert.equal(readConsent(store).optedIn, false);
  });

  it("treats a corrupt consent record as off", () => {
    const store = memoryStore();
    store.setItem("pnp-studio-training-consent", JSON.stringify({ optedIn: true }));
    assert.deepEqual(readConsent(store), { optedIn: false, consentAt: null });
  });
});

describe("explicit approval queue", () => {
  it("does not upload history that was never approved", () => {
    assert.deepEqual(explicitQueueIds([], optedIn), []);
    assert.deepEqual(
      pendingForConsent([], optedIn).map((row) => row.id),
      [],
    );
  });

  it("sends an older edit only after it is queued under the current consent", () => {
    const older = record({ createdAt: "2020-01-01T00:00:00.000Z" });
    assert.deepEqual(explicitQueueIds([older], optedIn), ["edit-1"]);
    const beforeOptIn = record({ consentAt: "2026-01-01T00:00:00.000Z" });
    assert.deepEqual(explicitQueueIds([beforeOptIn], optedIn), []);
  });

  it("opt-out drops waiting uploads for that consent and keeps sent markers", () => {
    const rows = [
      record({ id: "wait", status: "pending" }),
      record({ id: "later", status: "failed" }),
      record({ id: "sent", status: "uploaded", resultDataUrl: undefined }),
      record({ id: "other", status: "pending", consentAt: "2026-12-01T00:00:00.000Z" }),
    ];
    const left = withoutPendingForConsent(rows, CONSENT_AT).map((row) => row.id);
    assert.deepEqual(left, ["sent", "other"]);
    assert.deepEqual(
      retainForConsent(rows, { optedIn: false, consentAt: null }).map((row) => row.id),
      ["sent"],
    );
  });

  it("keeps the queue small without dropping sent markers for waiting room", () => {
    const waiting = Array.from({ length: MAX_TRAINING_QUEUE + 1 }, (_, index) =>
      record({ id: `p${index}`, enqueuedAt: index, status: "pending" }),
    );
    const uploaded = [record({ id: "sent", status: "uploaded", enqueuedAt: 100 })];
    const capped = capTrainingQueue([...waiting, ...uploaded]);
    const pendingIds = capped.filter((row) => row.status !== "uploaded").map((row) => row.id);
    assert.equal(pendingIds.length, MAX_TRAINING_QUEUE);
    assert.equal(pendingIds.includes("p0"), false);
    assert.equal(pendingIds.includes(`p${MAX_TRAINING_QUEUE}`), true);
    assert.equal(
      capped.some((row) => row.id === "sent"),
      true,
    );
  });

  it("shows approve, queued, and sent without auto-sending stale consent", () => {
    assert.equal(
      trainingItemView({ featureEnabled: false, consent: optedIn, record: undefined }),
      "hidden",
    );
    assert.equal(
      trainingItemView({
        featureEnabled: true,
        consent: { optedIn: false, consentAt: null },
      }),
      "hidden",
    );
    assert.equal(trainingItemView({ featureEnabled: true, consent: optedIn }), "approve");
    assert.equal(
      trainingItemView({
        featureEnabled: true,
        consent: optedIn,
        record: { id: "edit-1", status: "pending", consentAt: CONSENT_AT },
      }),
      "pending",
    );
    assert.equal(
      trainingItemView({
        featureEnabled: true,
        consent: optedIn,
        record: { id: "edit-1", status: "failed", consentAt: CONSENT_AT },
      }),
      "failed",
    );
    assert.equal(
      trainingItemView({
        featureEnabled: true,
        consent: optedIn,
        record: { id: "edit-1", status: "uploaded", consentAt: "2020-01-01T00:00:00.000Z" },
      }),
      "sent",
    );
    assert.equal(
      trainingItemView({
        featureEnabled: true,
        consent: optedIn,
        record: { id: "edit-1", status: "pending", consentAt: "2020-01-01T00:00:00.000Z" },
      }),
      "approve",
    );
  });

  it("retries a few times, then drops a poison upload and strips sent bytes", () => {
    const first = settleTrainingAttempt([record({ attempts: 0 })], "edit-1", "retry", record());
    assert.equal(first[0]?.status, "failed");
    assert.equal(first[0]?.attempts, 1);
    const dropped = settleTrainingAttempt([record({ attempts: 7 })], "edit-1", "retry", record());
    assert.equal(dropped.length, 0);
    const sent = settleTrainingAttempt(
      [
        record({
          resultDataUrl: "data:image/jpeg;base64,abc",
          sourceDataUrl: "data:image/jpeg;base64,def",
        }),
      ],
      "edit-1",
      "uploaded",
      record(),
    );
    assert.equal(sent[0]?.status, "uploaded");
    assert.equal(sent[0]?.resultDataUrl, undefined);
    assert.equal(sent[0]?.sourceDataUrl, undefined);
    const stopped = settleTrainingAttempt([record()], "edit-1", "stop", record());
    assert.equal(stopped[0]?.status, "pending");
  });
});
