const MAX_PAGES = 20;

function isPdf(filename: string, mime: string) {
  return mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
}

function isDocx(filename: string, mime: string) {
  return (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filename.toLowerCase().endsWith(".docx")
  );
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  } as never).promise;
  const pages: string[] = [];
  const count = Math.min(doc.numPages, MAX_PAGES);
  for (let i = 1; i <= count; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (line) pages.push(line);
  }
  if (doc.numPages > MAX_PAGES) {
    pages.push(`[Only the first ${MAX_PAGES} pages were read.]`);
  }
  return pages.join("\n\n");
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const extractRawText = mammoth.extractRawText ?? mammoth.default.extractRawText;
  const result = await extractRawText({ buffer });
  return String(result.value ?? "").trim();
}

export async function extractFromBuffer(input: {
  filename: string;
  mime: string;
  buffer: Buffer;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    let text = "";
    if (isPdf(input.filename, input.mime)) {
      text = await extractPdf(input.buffer);
    } else if (isDocx(input.filename, input.mime)) {
      text = await extractDocx(input.buffer);
    } else {
      return { ok: false, error: "That document type is not supported yet." };
    }
    if (!text.trim()) {
      return {
        ok: false,
        error: "No text could be read. Try a Word file, a text file, or a PDF with selectable text.",
      };
    }
    return { ok: true, text };
  } catch {
    return { ok: false, error: "That document could not be opened." };
  }
}
