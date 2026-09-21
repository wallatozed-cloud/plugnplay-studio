import { extractDocument } from "@/lib/edit-document";

const TEXT_EXT = /\.(txt|md|markdown|csv|rtf)$/i;
const DOC_EXT = /\.(pdf|docx|txt|md|markdown|csv|rtf)$/i;
const MAX_DOC_BYTES = 2.5 * 1024 * 1024;

export class DocumentPrepareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentPrepareError";
  }
}

export function isAcceptedDocument(file: File | Blob, name?: string): boolean {
  const filename = name ?? (file instanceof File ? file.name : "");
  const mime = file.type;
  if (
    mime === "application/pdf" ||
    mime === "text/plain" ||
    mime === "text/markdown" ||
    mime === "text/csv" ||
    mime === "application/rtf" ||
    mime === "text/rtf" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return true;
  }
  return DOC_EXT.test(filename);
}

function isTextDocument(file: File | Blob, filename: string): boolean {
  const mime = file.type;
  if (mime === "text/plain" || mime === "text/markdown" || mime === "text/csv" || mime === "application/rtf" || mime === "text/rtf") {
    return true;
  }
  return TEXT_EXT.test(filename);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new DocumentPrepareError("Could not read the file."));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

export async function prepareDocument(
  file: File | Blob,
  name?: string,
): Promise<{ text: string; filename: string }> {
  const filename = name || (file instanceof File ? file.name : "document.txt");
  if (file.size > MAX_DOC_BYTES) {
    throw new DocumentPrepareError("Choose a document under 2.5 MB.");
  }
  if (!isAcceptedDocument(file, filename)) {
    throw new DocumentPrepareError("Use a PDF, Word (.docx), or text file.");
  }

  if (isTextDocument(file, filename)) {
    const text = (await file.text()).replace(/\u0000/g, "").trim();
    if (!text) throw new DocumentPrepareError("That file is empty.");
    return { text, filename };
  }

  const base64 = await blobToBase64(file);
  const extracted = await extractDocument({
    data: { filename, mime: file.type || "", base64 },
  });
  if (!extracted.ok) {
    throw new DocumentPrepareError(extracted.error);
  }
  return { text: extracted.text, filename };
}

export async function fetchSampleDocument(url: string, filename: string): Promise<{ text: string; filename: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new DocumentPrepareError("The sample letter could not be loaded.");
  const blob = await res.blob();
  return prepareDocument(blob, filename);
}

export function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function rewrittenFilename(filename: string): string {
  const safe = filename.replace(/[/\\?%*:|"<>]/g, "-");
  const dot = safe.lastIndexOf(".");
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  return `${base}-edited.txt`;
}
