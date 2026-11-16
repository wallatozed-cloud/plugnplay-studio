import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTrainingRecord, contributionFormData, decodeTrainingDataUrl } from "./payload.ts";

const CONTRIBUTOR = "11111111-1111-4111-8111-111111111111";

function jpegDataUrl(size = 64): string {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[size - 2] = 0xff;
  bytes[size - 1] = 0xd9;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

describe("training payload", () => {
  it("builds a record for an older edit only when asked, and keeps the original time", () => {
    const built = buildTrainingRecord({
      id: "old",
      prompt: "  Night scene  ",
      createdAt: Date.parse("2020-05-01T12:00:00.000Z"),
      resultDataUrl: jpegDataUrl(),
      sourceDataUrl: jpegDataUrl(40),
      contributorId: CONTRIBUTOR,
      consentAt: "2026-11-16T08:00:00.000Z",
      now: 50,
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.record.prompt, "Night scene");
    assert.equal(built.record.createdAt, "2020-05-01T12:00:00.000Z");
    assert.equal(built.record.consentAt, "2026-11-16T08:00:00.000Z");
    assert.equal(built.record.status, "pending");
    assert.ok(built.record.sourceDataUrl);
    const form = contributionFormData(built.record);
    assert.ok(form);
    assert.equal(form?.get("contributor_id"), CONTRIBUTOR);
    assert.equal(form?.get("prompt"), "Night scene");
    assert.equal(form?.get("result") instanceof File, true);
    assert.equal((form?.get("result") as File).type, "image/jpeg");
    assert.equal(form?.get("source") instanceof File, true);
  });

  it("rejects a non-image and an oversized result", () => {
    const gif = `data:image/gif;base64,${btoa("GIF89a" + "x".repeat(40))}`;
    assert.equal(decodeTrainingDataUrl(gif), null);
    const rejected = buildTrainingRecord({
      id: "gif",
      prompt: "Night",
      createdAt: Date.now(),
      resultDataUrl: gif,
      contributorId: CONTRIBUTOR,
      consentAt: "2026-11-16T08:00:00.000Z",
    });
    assert.equal(rejected.ok, false);

    const huge = jpegDataUrl(8 * 1024 * 1024 + 1);
    const tooBig = buildTrainingRecord({
      id: "big",
      prompt: "Night",
      createdAt: Date.now(),
      resultDataUrl: huge,
      contributorId: CONTRIBUTOR,
      consentAt: "2026-11-16T08:00:00.000Z",
    });
    assert.equal(tooBig.ok, false);
  });

  it("omits a source that is not a training image", () => {
    const built = buildTrainingRecord({
      id: "photo",
      prompt: "Night",
      createdAt: Date.parse("2026-11-16T08:00:00.000Z"),
      resultDataUrl: jpegDataUrl(),
      sourceDataUrl: "not-an-image",
      contributorId: CONTRIBUTOR,
      consentAt: "2026-11-16T08:00:00.000Z",
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.record.sourceDataUrl, undefined);
    const form = contributionFormData(built.record);
    assert.equal(form?.get("source"), null);
  });
});
