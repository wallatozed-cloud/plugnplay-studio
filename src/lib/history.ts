const DB_NAME = "pnp-studio-history";
const STORE = "edits";
const MAX_ITEMS = 8;

export type HistoryKind = "image" | "document";

export type HistoryItem = {
  id: string;
  kind: HistoryKind;
  prompt: string;
  source: string;
  result: string;
  filename: string;
  createdAt: number;
};

export function itemKind(item: HistoryItem): HistoryKind {
  if (item.kind === "document" || item.kind === "image") return item.kind;
  return item.source.startsWith("data:image/") ? "image" : "document";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function normalize(raw: HistoryItem): HistoryItem {
  return {
    id: raw.id,
    kind: itemKind(raw),
    prompt: raw.prompt,
    source: raw.source,
    result: raw.result,
    filename: raw.filename || (itemKind(raw) === "image" ? "image.jpg" : "document.txt"),
    createdAt: raw.createdAt,
  };
}

export async function loadHistory(): Promise<HistoryItem[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const items = (req.result as HistoryItem[])
          .map(normalize)
          .sort((a, b) => b.createdAt - a.createdAt);
        resolve(items.slice(0, MAX_ITEMS));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveHistoryItem(item: HistoryItem): Promise<HistoryItem[]> {
  const existing = await loadHistory();
  const next = [normalize(item), ...existing.filter((x) => x.id !== item.id)].slice(0, MAX_ITEMS);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      for (const row of next) store.put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Quota or private mode — keep the in-memory list only.
  }
  return next;
}

export async function clearHistory(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}
