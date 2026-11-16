export type TrainingConsent = {
  optedIn: boolean;
  consentAt: string | null;
};

export type TrainingQueueStatus = "pending" | "failed" | "uploaded";

/** One approved photo waiting to upload, or a small marker after a successful send. */
export type TrainingQueueRecord = {
  id: string;
  status: TrainingQueueStatus;
  contributorId: string;
  consentAt: string;
  createdAt: string;
  prompt: string;
  resultDataUrl?: string;
  sourceDataUrl?: string;
  enqueuedAt: number;
  attempts: number;
};

export type TrainingQueueView = {
  id: string;
  status: TrainingQueueStatus;
  consentAt: string;
};

export type TrainingItemView = "hidden" | "approve" | "pending" | "failed" | "sent";

export type TrainingAttemptOutcome = "uploaded" | "drop" | "retry" | "stop" | "aborted";
