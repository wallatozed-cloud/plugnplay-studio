import { isContributorId } from "./ids.ts";
import {
  detectTrainingImage,
  extensionForTrainingImage,
  MAX_TRAINING_IMAGE_BYTES,
  MIN_TRAINING_IMAGE_BYTES,
  type TrainingImageType,
} from "./image-bytes.ts";

/**
 * POST /api/training/contribute
 *
 * The browser sends multipart/form-data. This route checks the request came
 * from the studio, then forwards a new multipart body to TRAINING_UPLOAD_URL
 * with `Authorization: Bearer <TRAINING_UPLOAD_TOKEN>`. The token is never
 * placed on a response. If either env var is missing, the route returns 503
 * and does not call the receiver.
 *
 * Fields: contributor_id, consent_at, created_at, prompt.
 * Files: result (required), source (optional).
 * Images: PNG, JPEG, or WebP, detected from bytes, each at most 8 MB.
 * Times are normalized to UTC ISO-8601.
 */

export type TrainingUploadEnv = {
  uploadUrl?: string;
  uploadToken?: string;
};

export type ResolvedTrainingUpload = {
  url: string;
  token: string;
};

export function resolveTrainingUpload(env: TrainingUploadEnv): ResolvedTrainingUpload | null {
  const url = env.uploadUrl?.trim() ?? "";
  const token = env.uploadToken?.trim() ?? "";
  if (!url || !token) return null;
  if (/[\r\n]/.test(url) || /[\r\n]/.test(token)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return { url, token };
}

export function trainingStatusResponse(env: TrainingUploadEnv): Response {
  return json(200, { enabled: resolveTrainingUpload(env) !== null });
}

export function studioOriginAllowed(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === publicOrigin(request);
  } catch {
    return false;
  }
}

export async function handleTrainingContribution(
  request: Request,
  env: TrainingUploadEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const config = resolveTrainingUpload(env);
  if (!config) {
    return json(503, { ok: false, error: "Training upload is not configured." });
  }
  if (!studioOriginAllowed(request)) {
    return json(403, { ok: false, error: "This upload must come from the studio." });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return json(400, { ok: false, error: "Expected a multipart form." });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { ok: false, error: "The upload could not be read." });
  }

  const contributor = stringField(form, "contributor_id");
  if (!contributor || !isContributorId(contributor)) {
    return json(400, { ok: false, error: "A valid contributor id is required." });
  }
  const consentAt = parseTimestamp(stringField(form, "consent_at"));
  const createdAt = parseTimestamp(stringField(form, "created_at"));
  if (!consentAt || !createdAt) {
    return json(400, { ok: false, error: "Consent and created times must be ISO dates." });
  }
  const prompt = stringField(form, "prompt")?.trim() ?? "";
  if (!prompt || prompt.length > 4000) {
    return json(400, { ok: false, error: "A prompt is required." });
  }

  const result = await readImage(form.get("result"));
  if (!result.ok) return json(400, { ok: false, error: result.error });
  const sourceEntry = form.get("source");
  let source: ImagePart | null = null;
  if (sourceEntry != null && !(typeof sourceEntry === "string" && sourceEntry.trim() === "")) {
    const parsed = await readImage(sourceEntry);
    if (!parsed.ok) return json(400, { ok: false, error: parsed.error });
    source = parsed.image;
  }

  const outgoing = new FormData();
  outgoing.set("contributor_id", contributor);
  outgoing.set("consent_at", consentAt);
  outgoing.set("created_at", createdAt);
  outgoing.set("prompt", prompt);
  outgoing.set(
    "result",
    new File([bytesToArrayBuffer(result.image.bytes)], `result.${result.image.ext}`, {
      type: result.image.type,
    }),
  );
  if (source) {
    outgoing.set(
      "source",
      new File([bytesToArrayBuffer(source.bytes)], `source.${source.ext}`, { type: source.type }),
    );
  }

  let upstream: Response;
  try {
    upstream = await fetchImpl(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
      body: outgoing,
      redirect: "manual",
      signal: AbortSignal.any([AbortSignal.timeout(30_000), request.signal]),
    });
  } catch {
    return json(502, { ok: false, error: "The training receiver could not be reached." });
  }

  await upstream.body?.cancel().catch(() => undefined);
  if (!upstream.ok || (upstream.status >= 300 && upstream.status < 400)) {
    return json(502, { ok: false, error: "The training receiver did not accept the upload." });
  }
  return json(200, { ok: true });
}

type ImagePart = {
  bytes: Uint8Array;
  type: TrainingImageType;
  ext: "jpg" | "png" | "webp";
};

async function readImage(
  entry: FormDataEntryValue | null,
): Promise<{ ok: true; image: ImagePart } | { ok: false; error: string }> {
  if (!(entry instanceof Blob) || typeof entry === "string") {
    return { ok: false, error: "A PNG, JPEG, or WebP image is required." };
  }
  if (entry.size > MAX_TRAINING_IMAGE_BYTES) {
    return { ok: false, error: "Images must be 8 MB or smaller." };
  }
  const bytes = new Uint8Array(await entry.arrayBuffer());
  if (bytes.byteLength < MIN_TRAINING_IMAGE_BYTES) {
    return { ok: false, error: "A PNG, JPEG, or WebP image is required." };
  }
  if (bytes.byteLength > MAX_TRAINING_IMAGE_BYTES) {
    return { ok: false, error: "Images must be 8 MB or smaller." };
  }
  const type = detectTrainingImage(bytes);
  if (!type) return { ok: false, error: "Only PNG, JPEG, and WebP images can be sent." };
  return { ok: true, image: { bytes, type, ext: extensionForTrainingImage(type) } };
}

function stringField(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

function parseTimestamp(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed) || trimmed.length > 40) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  const year = new Date(ms).getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return new Date(ms).toISOString();
}

function publicOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || new URL(request.url).host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || new URL(request.url).protocol.replace(/:$/, "") || "https";
  return `${proto}://${host}`;
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
