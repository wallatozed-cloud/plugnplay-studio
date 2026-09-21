export type CopyChange = { replace: string; with: string };

function addCopy(rows: CopyChange[], seen: Set<string>, replace: string, next: string) {
  const from = replace.replace(/\s+/g, " ").trim();
  const to = next.replace(/\s+/g, " ").trim();
  if (!from && !to) return;
  const key = `${from}=>${to}`;
  if (seen.has(key)) return;
  seen.add(key);
  rows.push({ replace: from, with: to });
}

export function extractCopyFromInstruction(instruction: string): CopyChange[] {
  const text = instruction.trim();
  if (!text) return [];
  const rows: CopyChange[] = [];
  const seen = new Set<string>();

  const quotedPair =
    /["“«]([^"'“”»]{1,160})["”»]\s+(?:with|to|for|->|→)\s+["“«]([^"'“”»]{1,160})["”»]/gi;
  for (const match of text.matchAll(quotedPair)) {
    addCopy(rows, seen, match[1] ?? "", match[2] ?? "");
  }

  const labeled =
    /\b(?:replace|replacing|change|changing|swap|swapping)\s+["“«]?([^"'“”»\n,]{1,80}?)["”»]?\s+(?:with|to|for|into)\s+["“«]([^"'“”»]{1,160})["”»]/gi;
  for (const match of text.matchAll(labeled)) {
    addCopy(rows, seen, match[1] ?? "", match[2] ?? "");
  }

  const unquoted =
    /\b(?:replace|change|swap)\s+([A-Za-z0-9][A-Za-z0-9 .,'’-]{0,60}?)\s+(?:with|to|for)\s+([A-Za-z0-9][A-Za-z0-9 .,'’-]{0,60}?)(?:[.!?,;]|$)/gi;
  for (const match of text.matchAll(unquoted)) {
    addCopy(rows, seen, match[1] ?? "", match[2] ?? "");
  }

  const quotes = [...text.matchAll(/["“«]([^"'“”»]{1,160})["”»]/g)]
    .map((match) => (match[1] ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (/\b(replace|change|swap)\b/i.test(text) && quotes.length >= 2) {
    addCopy(rows, seen, quotes[0] ?? "", quotes[1] ?? "");
  }

  for (const quote of quotes) {
    const already = rows.some((row) => row.with === quote || row.replace === quote);
    if (!already) addCopy(rows, seen, "", quote);
  }

  return rows;
}

export function mergeCopy(local: CopyChange[], remote: CopyChange[]): CopyChange[] {
  const rows = local.map((row) => ({ ...row }));
  for (const row of remote) {
    const hit = rows.find(
      (item) =>
        (row.with && item.with === row.with) || (row.replace && item.replace === row.replace),
    );
    if (hit) {
      if (!hit.replace && row.replace) hit.replace = row.replace;
      if (!hit.with && row.with) hit.with = row.with;
      continue;
    }
    rows.push({ ...row });
  }
  return rows;
}

function fold(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function containsExact(haystack: string, needle: string) {
  const target = fold(needle);
  if (!target) return true;
  return fold(haystack).includes(target);
}

export function missedCopy(haystack: string, rows: CopyChange[]): CopyChange[] {
  return rows.filter((row) => row.with && !containsExact(haystack, row.with));
}

export function formatCopyRules(rows: CopyChange[]): string {
  if (!rows.length) return "";
  return [
    "Exact strings from the user (character-for-character, do not correct or paraphrase):",
    ...rows.map((row) =>
      row.replace ? `- Replace "${row.replace}" with "${row.with}"` : `- Put this text in: "${row.with}"`,
    ),
  ].join("\n");
}
