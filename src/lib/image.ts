const ACCEPTED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const MAX_INPUT_BYTES = 18 * 1024 * 1024;

export class ImagePrepareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImagePrepareError";
  }
}

function isCoarsePointer() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

function budget() {
  const mobile = isCoarsePointer();
  return {
    maxEdge: mobile ? 1024 : 1280,
    targetBytes: mobile ? 420_000 : 700_000,
  };
}

export function isAcceptedImage(file: File | Blob, name?: string): boolean {
  const mime = file.type;
  if (mime && ACCEPTED.has(mime)) return true;
  if (mime && mime.startsWith("image/") && mime !== "image/svg+xml") return true;
  const lower = (name ?? (file instanceof File ? file.name : "")).toLowerCase();
  return /\.(jpe?g|png|webp|gif|heic|heif)$/.test(lower);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImagePrepareError("Could not encode the image."))),
      type,
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ImagePrepareError("Could not read the image."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImagePrepareError("That file could not be opened as an image."));
    img.src = url;
  });
}

async function decodeBitmap(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImageElement(url);
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function prepareImage(file: File | Blob, name?: string): Promise<string> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImagePrepareError("Choose a file under 18 MB.");
  }
  if (!isAcceptedImage(file, name)) {
    throw new ImagePrepareError("Use a JPEG, PNG, HEIC, WebP, or GIF.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeBitmap(file);
  } catch {
    throw new ImagePrepareError("That file could not be opened as an image.");
  }

  const { maxEdge, targetBytes } = budget();
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new ImagePrepareError("This browser cannot prepare images.");
  }
  ctx.fillStyle = "#0b0b0a";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let quality = 0.82;
  let blob = await canvasToBlob(canvas, "image/jpeg", quality);
  while (blob.size > targetBytes && quality > 0.48) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, "image/jpeg", quality);
  }

  if (blob.size > targetBytes) {
    const shrink = Math.sqrt(targetBytes / blob.size);
    const w2 = Math.max(1, Math.round(width * shrink));
    const h2 = Math.max(1, Math.round(height * shrink));
    const canvas2 = document.createElement("canvas");
    canvas2.width = w2;
    canvas2.height = h2;
    const ctx2 = canvas2.getContext("2d");
    if (!ctx2) throw new ImagePrepareError("Could not resize the image.");
    ctx2.drawImage(canvas, 0, 0, w2, h2);
    blob = await canvasToBlob(canvas2, "image/jpeg", 0.72);
  }

  return blobToDataUrl(blob);
}

export async function fetchSampleImage(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new ImagePrepareError("The sample photo could not be loaded.");
  const blob = await res.blob();
  return prepareImage(blob, "still-life.jpg");
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
