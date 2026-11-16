import {
  detectTrainingImage,
  extensionForTrainingImage,
  MAX_TRAINING_IMAGE_BYTES,
  MIN_TRAINING_IMAGE_BYTES,
  type TrainingImageType,
} from "./image-bytes.ts";
import type { TrainingQueueRecord } from "./types.ts";

const DATA_URL = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i;

export type TrainingApprovalInput = {
  id: string;
  prompt: string;
  createdAt: number;
  resultDataUrl: string;
  sourceDataUrl?: string;
};

export function decodeTrainingDataUrl(
  dataUrl: string,
): { type: TrainingImageType; bytes: Uint8Array } | null {
  const match = DATA_URL.exec(dataUrl.trim());
  if (!match) return null;
  const declared = match[1]!.toLowerCase() === "image/jpg" ? "image/jpeg" : match[1]!.toLowerCase();
  let bytes: Uint8Array;
  try {
    const binary = atob(match[2]!.replace(/\s/g, ""));
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } catch {
    return null;
  }
  if (bytes.byteLength < MIN_TRAINING_IMAGE_BYTES || bytes.byteLength > MAX_TRAINING_IMAGE_BYTES) {
    return null;
  }
  const detected = detectTrainingImage(bytes);
  if (!detected || detected !== declared) return null;
  return { type: detected, bytes };
}

export function trainingFileFromDataUrl(dataUrl: string, role: "result" | "source"): File | null {
  const decoded = decodeTrainingDataUrl(dataUrl);
  if (!decoded) return null;
  const ext = extensionForTrainingImage(decoded.type);
  const copy = new Uint8Array(decoded.bytes.byteLength);
  copy.set(decoded.bytes);
  return new File([copy], `${role}.${ext}`, { type: decoded.type });
}

export function buildTrainingRecord(
  input: TrainingApprovalInput & { contributorId: string; consentAt: string; now?: number },
): { ok: true; record: TrainingQueueRecord } | { ok: false; error: string } {
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 4000) {
    return { ok: false, error: "That instruction can't be sent for training." };
  }
  if (!Number.isFinite(input.createdAt)) {
    return { ok: false, error: "This edit is missing a time, so it can't be sent." };
  }
  const result = decodeTrainingDataUrl(input.resultDataUrl);
  if (!result) {
    return {
      ok: false,
      error: "Only a PNG, JPEG, or WebP under 8 MB can be sent for training.",
    };
  }
  let sourceDataUrl: string | undefined;
  if (input.sourceDataUrl) {
    const source = decodeTrainingDataUrl(input.sourceDataUrl);
    if (source) sourceDataUrl = input.sourceDataUrl;
  }
  return {
    ok: true,
    record: {
      id: input.id,
      status: "pending",
      contributorId: input.contributorId,
      consentAt: input.consentAt,
      createdAt: new Date(input.createdAt).toISOString(),
      prompt,
      resultDataUrl: input.resultDataUrl,
      sourceDataUrl,
      enqueuedAt: input.now ?? Date.now(),
      attempts: 0,
    },
  };
}

export function contributionFormData(record: TrainingQueueRecord): FormData | null {
  if (!record.resultDataUrl) return null;
  const result = trainingFileFromDataUrl(record.resultDataUrl, "result");
  if (!result) return null;
  const form = new FormData();
  form.set("contributor_id", record.contributorId);
  form.set("consent_at", record.consentAt);
  form.set("created_at", record.createdAt);
  form.set("prompt", record.prompt);
  form.set("result", result);
  if (record.sourceDataUrl) {
    const source = trainingFileFromDataUrl(record.sourceDataUrl, "source");
    if (source) form.set("source", source);
  }
  return form;
}
