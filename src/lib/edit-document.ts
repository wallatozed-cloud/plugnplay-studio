import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { extractJsonObject } from "@/lib/json-object";
import { withDeadline } from "@/lib/deadline";
import {
  extractCopyFromInstruction,
  formatCopyRules,
  mergeCopy,
  missedCopy,
  type CopyChange,
} from "@/lib/reason";

const MAX_BASE64 = 3_500_000;
const MAX_TEXT = 24_000;
const FETCH_MS = 55_000;
const PLAN_MS = 12_000;

const ExtractInput = z.object({
  filename: z.string().trim().min(1).max(180),
  mime: z.string().max(120),
  base64: z.string().min(8).max(MAX_BASE64, "That file is too large. Try one under 2.5 MB."),
});

const EditInput = z.object({
  filename: z.string().trim().min(1).max(180),
  text: z.string().trim().min(1, "The document is empty.").max(MAX_TEXT + 400),
  prompt: z.string().trim().min(3, "Write a slightly longer instruction.").max(4000),
});

export type ExtractDocumentResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export type EditDocumentResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

type DocumentPlan = {
  intent: string;
  notes: string;
  preserve: string;
  replacements: CopyChange[];
};

function unwrapFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return match?.[1] ? match[1].trimEnd() : trimmed;
}

function asReplacements(value: unknown): CopyChange[] {
  if (!Array.isArray(value)) return [];
  const rows: CopyChange[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { from?: unknown; to?: unknown; replace?: unknown; with?: unknown };
    const from = String(row.from ?? row.replace ?? "").trim();
    const to = String(row.to ?? row.with ?? "").trim();
    if (from || to) rows.push({ replace: from, with: to });
  }
  return rows;
}

function renderPlan(plan: DocumentPlan): string {
  return [
    plan.intent ? `Intent: ${plan.intent}` : "",
    plan.preserve ? `Preserve: ${plan.preserve}` : "",
    plan.notes ? `Other changes: ${plan.notes}` : "",
    formatCopyRules(plan.replacements),
  ]
    .filter(Boolean)
    .join("\n");
}

async function planDocument(
  apiKey: string,
  filename: string,
  instruction: string,
  bodyText: string,
  facts: CopyChange[],
  parent: AbortSignal,
): Promise<DocumentPlan | null> {
  const sample =
    bodyText.length > 12_000 ? `${bodyText.slice(0, 12_000)}\n\n[Document truncated for analysis.]` : bodyText;
  return withDeadline(
    async (signal) => {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-4.5",
          temperature: 0,
          max_tokens: 1400,
          messages: [
            {
              role: "system",
              content:
                'You are the reasoning brain of a document studio. Read the document and instruction, infer the real intent, then return JSON only: {"intent":"replace"|"rewrite"|"tighten"|"tone"|"mixed","replacements":[{"replace":"","with":""}],"notes":"","preserve":""}. Reason silently. Copy names, dates, amounts, and quoted strings from the instruction exactly. Do not rewrite the document in this step.',
            },
            {
              role: "user",
              content: [
                `File: ${filename}`,
                `INSTRUCTION:\n${instruction}`,
                facts.length ? `Already extracted exact strings:\n${formatCopyRules(facts)}` : "",
                `DOCUMENT:\n${sample}`,
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          ],
        }),
        signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const parsed = extractJsonObject(json.choices?.[0]?.message?.content ?? "");
      if (!parsed) return null;
      return {
        intent: String(parsed.intent ?? "rewrite").trim(),
        notes: String(parsed.notes ?? "").trim(),
        preserve: String(parsed.preserve ?? "").trim(),
        replacements: mergeCopy(facts, asReplacements(parsed.replacements)),
      };
    },
    PLAN_MS,
    parent,
  );
}

async function rewriteDocument(
  apiKey: string,
  filename: string,
  instruction: string,
  bodyText: string,
  planText: string | null,
  correction: string | null,
  signal: AbortSignal,
): Promise<string | null> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.5",
      temperature: 0,
      max_tokens: 12000,
      messages: [
        {
          role: "system",
          content:
            "You are a surgical document editor. Reason about the original and the instruction, then apply the change with precision. If the plan lists replacements, use those strings EXACTLY — same spelling, capitalization, punctuation, and digits. Do not paraphrase, correct, or expand them. Change only what was asked; keep every other sentence, name, figure, and line break. Never summarize. Return the complete edited document only — no preamble, no commentary, no markdown fences unless the original uses them.",
        },
        {
          role: "user",
          content: [
            `File: ${filename}`,
            `INSTRUCTION (source of truth):\n${instruction}`,
            planText ? `EDIT PLAN:\n${planText}` : "",
            correction ? `CORRECTION (apply these missed strings exactly):\n${correction}` : "",
            `ORIGINAL DOCUMENT:\n${bodyText}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    }),
    signal,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = unwrapFences(json.choices?.[0]?.message?.content ?? "");
  return text || null;
}

export const extractDocument = createServerFn({ method: "POST" })
  .validator((input: { filename: string; mime: string; base64: string }) => input)
  .handler(async ({ data }): Promise<ExtractDocumentResult> => {
    const parsed = ExtractInput.safeParse(data);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid file." };
    }
    const buffer = Buffer.from(parsed.data.base64, "base64");
    if (!buffer.byteLength) {
      return { ok: false, error: "That file is empty." };
    }
    const { extractFromBuffer } = await import("./extract-document.server");
    return extractFromBuffer({
      filename: parsed.data.filename,
      mime: parsed.data.mime,
      buffer,
    });
  });

export const editDocument = createServerFn({ method: "POST" })
  .validator((input: { filename: string; text: string; prompt: string }) => input)
  .handler(async ({ data }): Promise<EditDocumentResult> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "AI is not available in this environment." };
    }
    const parsed = EditInput.safeParse(data);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
    }

    let bodyText = parsed.data.text;
    if (bodyText.length > MAX_TEXT) {
      bodyText = `${bodyText.slice(0, MAX_TEXT)}\n\n[Document truncated.]`;
    }

    const facts = extractCopyFromInstruction(parsed.data.prompt);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_MS);
    try {
      const planned = await planDocument(
        apiKey,
        parsed.data.filename,
        parsed.data.prompt,
        bodyText,
        facts,
        controller.signal,
      );
      const plan: DocumentPlan = planned ?? {
        intent: facts.length ? "replace" : "rewrite",
        notes: "",
        preserve: "Everything the instruction did not name.",
        replacements: facts,
      };
      const planText = renderPlan(plan);

      const first = await rewriteDocument(
        apiKey,
        parsed.data.filename,
        parsed.data.prompt,
        bodyText,
        planText,
        null,
        controller.signal,
      );
      if (!first) {
        return { ok: false, error: "The edit could not be completed. Try a different instruction." };
      }

      const missed = missedCopy(first, plan.replacements);
      if (missed.length) {
        const correction = formatCopyRules(missed);
        const second = await rewriteDocument(
          apiKey,
          parsed.data.filename,
          parsed.data.prompt,
          first,
          planText,
          correction,
          controller.signal,
        );
        if (second) {
          const still = missedCopy(second, plan.replacements);
          return { ok: true, text: still.length < missed.length ? second : first };
        }
      }

      return { ok: true, text: first };
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || /timeout|aborted/i.test(err.message))) {
        return { ok: false, error: "The edit took too long. Stay on this screen and try again." };
      }
      return {
        ok: false,
        error: "The connection dropped. Stay on this screen and tap Rewrite.",
      };
    } finally {
      clearTimeout(timer);
    }
  });
