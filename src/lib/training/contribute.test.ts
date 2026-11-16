import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  handleTrainingContribution,
  resolveTrainingUpload,
  trainingStatusResponse,
} from "./contribute.ts";
import { handleTrainingStatusRequest, trainingUploadFromProcess } from "./contribute.server.ts";

const TOKEN = "receiver-token-should-stay-server-side";
const URL = "https://trainer.example/upload";
const CONTRIBUTOR = "11111111-1111-4111-8111-111111111111";
const ENV = { uploadUrl: URL, uploadToken: TOKEN };

function jpegBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[size - 2] = 0xff;
  bytes[size - 1] = 0xd9;
  return bytes;
}

function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x18, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50], 0);
  return bytes;
}

function imageFile(bytes: Uint8Array, name: string, type: string): File {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new File([copy], name, { type });
}

function contributionRequest(
  fields: Record<string, string | File>,
  headers: Record<string, string> = {},
): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("https://studio.example/api/training/contribute", {
    method: "POST",
    headers: {
      origin: "https://studio.example",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: form,
  });
}

function validFields(extra: Record<string, string | File> = {}): Record<string, string | File> {
  return {
    contributor_id: CONTRIBUTOR,
    consent_at: "2026-11-16T08:03:00Z",
    created_at: "2020-05-01T12:00:00.000Z",
    prompt: " Make it night ",
    result: imageFile(jpegBytes(), "edit.jpg", "image/jpeg"),
    ...extra,
  };
}

const originalEnv = {
  url: process.env.TRAINING_UPLOAD_URL,
  token: process.env.TRAINING_UPLOAD_TOKEN,
};

afterEach(() => {
  if (originalEnv.url === undefined) delete process.env.TRAINING_UPLOAD_URL;
  else process.env.TRAINING_UPLOAD_URL = originalEnv.url;
  if (originalEnv.token === undefined) delete process.env.TRAINING_UPLOAD_TOKEN;
  else process.env.TRAINING_UPLOAD_TOKEN = originalEnv.token;
});

describe("training upload route", () => {
  it("is disabled unless both env vars are usable", () => {
    assert.equal(resolveTrainingUpload({}), null);
    assert.equal(resolveTrainingUpload({ uploadUrl: "  ", uploadToken: TOKEN }), null);
    assert.equal(resolveTrainingUpload({ uploadUrl: URL, uploadToken: " \n " }), null);
    assert.equal(
      resolveTrainingUpload({ uploadUrl: "javascript:alert(1)", uploadToken: TOKEN }),
      null,
    );
    assert.ok(resolveTrainingUpload({ uploadUrl: `  ${URL}  `, uploadToken: ` ${TOKEN} ` }));
    return trainingStatusResponse({})
      .json()
      .then((body) => {
        assert.deepEqual(body, { enabled: false });
      });
  });

  it("returns 503 and does not call the receiver when unset", async () => {
    let called = false;
    const response = await handleTrainingContribution(
      contributionRequest(validFields()),
      {},
      async () => {
        called = true;
        return new Response("nope");
      },
    );
    assert.equal(response.status, 503);
    assert.equal(called, false);
    const body = (await response.json()) as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, "Training upload is not configured.");
    assert.equal(JSON.stringify(body).includes(TOKEN), false);
  });

  it("forwards multipart with a bearer token and normalized times", async () => {
    const calls: Request[] = [];
    const response = await handleTrainingContribution(
      contributionRequest(
        validFields({
          source: imageFile(pngBytes(), "original.png", "image/png"),
        }),
      ),
      ENV,
      async (input, init) => {
        calls.push(new Request(input, init));
        return new Response("accepted", { status: 200 });
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.length, 1);
    const forwarded = calls[0]!;
    assert.equal(forwarded.url, URL);
    assert.equal(forwarded.headers.get("authorization"), `Bearer ${TOKEN}`);
    const form = await forwarded.formData();
    assert.equal(form.get("contributor_id"), CONTRIBUTOR);
    assert.equal(form.get("consent_at"), "2026-11-16T08:03:00.000Z");
    assert.equal(form.get("created_at"), "2020-05-01T12:00:00.000Z");
    assert.equal(form.get("prompt"), "Make it night");
    const result = form.get("result");
    const source = form.get("source");
    assert.equal(result instanceof File, true);
    assert.equal((result as File).type, "image/jpeg");
    assert.equal((result as File).name, "result.jpg");
    assert.equal(source instanceof File, true);
    assert.equal((source as File).type, "image/png");
    assert.equal((source as File).name, "source.png");
    assert.equal(String(form.get("prompt")).includes(TOKEN), false);
  });

  it("accepts webp and omits an empty source", async () => {
    let sawSource = true;
    const response = await handleTrainingContribution(
      contributionRequest({
        ...validFields(),
        result: imageFile(webpBytes(), "edit.webp", "image/webp"),
        source: "",
      }),
      ENV,
      async (_input, init) => {
        const form = await new Request("https://trainer.example/", init).formData();
        sawSource = form.get("source") != null;
        assert.equal((form.get("result") as File).type, "image/webp");
        return new Response(null, { status: 200 });
      },
    );
    assert.equal(response.status, 200);
    assert.equal(sawSource, false);
  });

  it("rejects cross-site, missing origin, bad files, and bad fields", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("receiver should not be called");
    };
    const cross = await handleTrainingContribution(
      contributionRequest(validFields(), { "sec-fetch-site": "cross-site" }),
      ENV,
      fetchImpl,
    );
    assert.equal(cross.status, 403);

    const bare = new Request("https://studio.example/api/training/contribute", {
      method: "POST",
      body: new FormData(),
    });
    assert.equal((await handleTrainingContribution(bare, ENV, fetchImpl)).status, 403);

    const gif = await handleTrainingContribution(
      contributionRequest(
        validFields({
          result: imageFile(
            new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...new Uint8Array(32)]),
            "a.gif",
            "image/gif",
          ),
        }),
      ),
      ENV,
      fetchImpl,
    );
    assert.equal(gif.status, 400);

    const huge = jpegBytes(8 * 1024 * 1024 + 1);
    const oversized = await handleTrainingContribution(
      contributionRequest(validFields({ result: imageFile(huge, "big.jpg", "image/jpeg") })),
      ENV,
      fetchImpl,
    );
    assert.equal(oversized.status, 400);
    assert.match(((await oversized.json()) as { error: string }).error, /8 MB/);

    const badSource = await handleTrainingContribution(
      contributionRequest(
        validFields({
          source: imageFile(
            new TextEncoder().encode("not-an-image-but-long-enough-yes"),
            "x.bin",
            "application/octet-stream",
          ),
        }),
      ),
      ENV,
      fetchImpl,
    );
    assert.equal(badSource.status, 400);

    const badId = await handleTrainingContribution(
      contributionRequest(validFields({ contributor_id: "device-7" })),
      ENV,
      fetchImpl,
    );
    assert.equal(badId.status, 400);

    const text = new Request("https://studio.example/api/training/contribute", {
      method: "POST",
      headers: {
        origin: "https://studio.example",
        "content-type": "text/plain",
      },
      body: "hello",
    });
    assert.equal((await handleTrainingContribution(text, ENV, fetchImpl)).status, 400);
  });

  it("accepts the public host behind a proxy", async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries(validFields())) form.set(key, value);
    const request = new Request("http://10.0.0.8:10000/api/training/contribute", {
      method: "POST",
      headers: {
        origin: "https://studio.example",
        "x-forwarded-host": "studio.example",
        "x-forwarded-proto": "https",
      },
      body: form,
    });
    const response = await handleTrainingContribution(request, ENV, async () => new Response("ok"));
    assert.equal(response.status, 200);
  });

  it("returns 502 when the receiver fails and does not leak the token", async () => {
    const failed = await handleTrainingContribution(
      contributionRequest(validFields()),
      ENV,
      async () => {
        return new Response(`denied ${TOKEN}`, { status: 500 });
      },
    );
    assert.equal(failed.status, 502);
    const body = await failed.text();
    assert.equal(body.includes(TOKEN), false);

    const redirected = await handleTrainingContribution(
      contributionRequest(validFields()),
      ENV,
      async () => Response.redirect("https://evil.example/steal", 302),
    );
    assert.equal(redirected.status, 502);

    const offline = await handleTrainingContribution(
      contributionRequest(validFields()),
      ENV,
      async () => {
        throw new Error(`connect ${TOKEN}`);
      },
    );
    assert.equal(offline.status, 502);
    assert.equal((await offline.text()).includes(TOKEN), false);
  });

  it("reads TRAINING_UPLOAD_URL and TRAINING_UPLOAD_TOKEN from the process environment", async () => {
    delete process.env.TRAINING_UPLOAD_URL;
    delete process.env.TRAINING_UPLOAD_TOKEN;
    assert.deepEqual(trainingUploadFromProcess(), { uploadUrl: undefined, uploadToken: undefined });
    const status = await handleTrainingStatusRequest().json();
    assert.deepEqual(status, { enabled: false });

    process.env.TRAINING_UPLOAD_URL = ` ${URL} `;
    process.env.TRAINING_UPLOAD_TOKEN = ` ${TOKEN} `;
    assert.deepEqual(trainingUploadFromProcess(), { uploadUrl: URL, uploadToken: TOKEN });
    assert.deepEqual(await handleTrainingStatusRequest().json(), { enabled: true });
  });
});
