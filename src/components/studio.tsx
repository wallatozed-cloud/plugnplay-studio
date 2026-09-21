import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUpRight,
  ClipboardPaste,
  Download,
  FileUp,
  LoaderCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { CompareSlider } from "@/components/compare-slider";
import { DocumentStage } from "@/components/document-stage";
import { StudioMark } from "@/components/mark";
import { Button } from "@/components/ui/button";
import {
  DocumentPrepareError,
  downloadText,
  fetchSampleDocument,
  isAcceptedDocument,
  prepareDocument,
  rewrittenFilename,
} from "@/lib/document";
import { editDocument } from "@/lib/edit-document";
import { editImage, getAiStatus } from "@/lib/edit-image";
import {
  clearHistory,
  itemKind,
  loadHistory,
  saveHistoryItem,
  type HistoryItem,
} from "@/lib/history";
import {
  downloadDataUrl,
  fetchSampleImage,
  ImagePrepareError,
  isAcceptedImage,
  prepareImage,
} from "@/lib/image";
import { cn } from "@/lib/utils";

type ImageAsset = { kind: "image"; filename: string; dataUrl: string };
type DocAsset = { kind: "document"; filename: string; text: string };
type Asset = ImageAsset | DocAsset;

const IMAGE_SUGGESTIONS: { label: string; prompt: string }[] = [
  {
    label: "Replace text",
    prompt:
      "Replace only the text I name. Keep the photo, layout, and style. Change the existing words to exactly the new copy I write.",
  },
  {
    label: "Keep the face",
    prompt:
      "Keep this person's face, skin, hair, and body identical. You may change lighting, background, clothes, or mood.",
  },
  {
    label: "Darker",
    prompt: "Dim the lighting a little. Keep the subject, pose, and colors otherwise the same.",
  },
  {
    label: "Night",
    prompt:
      "Turn this into a cinematic night scene with practical lights, deep shadows, and cool moonlight. Keep the people recognizable.",
  },
  {
    label: "Clear background",
    prompt: "Replace the background with a quiet plaster studio wall and soft directional light. Keep the subject sharp.",
  },
  {
    label: "Sharper",
    prompt: "Make this photograph sharper and more detailed. Keep the subject, face, and composition identical.",
  },
];

const DOC_SUGGESTIONS: { label: string; prompt: string }[] = [
  {
    label: "Replace words",
    prompt: "Replace only the words, names, dates, or amounts I name. Keep every other sentence exactly.",
  },
  {
    label: "Tighten",
    prompt: "Tighten this into a shorter version. Keep every name, date, figure, and request.",
  },
  {
    label: "Fix grammar",
    prompt: "Correct grammar, spelling, and punctuation. Do not change meaning or tone.",
  },
  {
    label: "More formal",
    prompt: "Rewrite in a more formal professional register without adding new facts.",
  },
  {
    label: "Warm note",
    prompt: "Make this warmer and more human while keeping it professional and complete.",
  },
];

const SAMPLE_IMAGE = "/samples/still-life.jpg";
const SAMPLE_LETTER = "/samples/brief.txt";
const ACCEPT =
  "image/*,image/heic,image/heif,application/pdf,.pdf,.docx,.txt,.md,.csv,.rtf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function coarsePointer() {
  return window.matchMedia("(pointer: coarse)").matches;
}

function joinPrompt(current: string, addition: string) {
  if (!current.trim()) return addition;
  return `${current.replace(/\s+$/, "")} ${addition}`;
}

function assetFromHistory(item: HistoryItem): { source: Asset; result: Asset } {
  const kind = itemKind(item);
  if (kind === "image") {
    return {
      source: { kind: "image", filename: item.filename, dataUrl: item.source },
      result: { kind: "image", filename: item.filename, dataUrl: item.result },
    };
  }
  return {
    source: { kind: "document", filename: item.filename, text: item.source },
    result: { kind: "document", filename: item.filename, text: item.result },
  };
}

export function Studio() {
  const fileId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [source, setSource] = useState<Asset | null>(null);
  const [result, setResult] = useState<Asset | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiAvailable, setAiAvailable] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [typing, setTyping] = useState(false);
  const dragDepth = useRef(0);
  const typingRef = useRef(false);
  const blurTimer = useRef<number>(0);

  useEffect(() => {
    void loadHistory().then(setHistory);
    void getAiStatus()
      .then((s) => setAiAvailable(s.available))
      .catch(() => setAiAvailable(false));
  }, []);

  const syncKeyboard = useCallback(() => {
    const vv = window.visualViewport;
    let inset = 0;
    if (vv) {
      inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
    }
    if (typingRef.current && inset < 80 && coarsePointer()) {
      inset = Math.round(window.innerHeight * 0.4);
    }
    if (!typingRef.current && inset < 80) inset = 0;
    document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    syncKeyboard();
    window.addEventListener("resize", syncKeyboard);
    vv?.addEventListener("resize", syncKeyboard);
    vv?.addEventListener("scroll", syncKeyboard);
    return () => {
      window.removeEventListener("resize", syncKeyboard);
      vv?.removeEventListener("resize", syncKeyboard);
      vv?.removeEventListener("scroll", syncKeyboard);
    };
  }, [syncKeyboard]);

  function focusPrompt() {
    if (coarsePointer()) return;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function revealComposer() {
    requestAnimationFrame(() => {
      textareaRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      syncKeyboard();
    });
  }

  const ingestFile = useCallback(async (file: File | Blob, name?: string) => {
    const filename = name || (file instanceof File ? file.name : "upload");
    setError(null);
    setPreparing(true);
    try {
      if (isAcceptedImage(file, filename)) {
        const dataUrl = await prepareImage(file, filename);
        setSource({ kind: "image", filename, dataUrl });
        setResult(null);
      } else if (isAcceptedDocument(file, filename)) {
        const doc = await prepareDocument(file, filename);
        setSource({ kind: "document", filename: doc.filename, text: doc.text });
        setResult(null);
      } else {
        throw new DocumentPrepareError("Use a photo or a PDF, Word, or text file.");
      }
      focusPrompt();
    } catch (err) {
      const message =
        err instanceof ImagePrepareError || err instanceof DocumentPrepareError
          ? err.message
          : "That file could not be opened.";
      setError(message);
      toast.error(message);
    } finally {
      setPreparing(false);
    }
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (items) {
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              void ingestFile(file, file.name || "pasted.jpg");
            }
            return;
          }
        }
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest("textarea, input")) return;

      const text = event.clipboardData?.getData("text/plain")?.trim();
      if (text && source) {
        event.preventDefault();
        setPrompt((current) => joinPrompt(current, text));
        return;
      }
      if (text && !source) {
        event.preventDefault();
        setSource({ kind: "document", filename: "pasted.txt", text });
        setResult(null);
        setError(null);
        focusPrompt();
      }
    };

    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) void ingestFile(file, file.name);
    };

    window.addEventListener("paste", onPaste);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [ingestFile, source]);

  function resetAll() {
    setSource(null);
    setResult(null);
    setPrompt("");
    setError(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onSamplePhoto() {
    setError(null);
    setPreparing(true);
    try {
      const dataUrl = await fetchSampleImage(SAMPLE_IMAGE);
      setSource({ kind: "image", filename: "still-life.jpg", dataUrl });
      setResult(null);
      setPrompt("Make this a moonlit night scene with a single warm lamp on the table.");
      focusPrompt();
    } catch (err) {
      const message = err instanceof ImagePrepareError ? err.message : "Could not load the sample.";
      setError(message);
      toast.error(message);
    } finally {
      setPreparing(false);
    }
  }

  async function onSampleLetter() {
    setError(null);
    setPreparing(true);
    try {
      const doc = await fetchSampleDocument(SAMPLE_LETTER, "brief.txt");
      setSource({ kind: "document", filename: doc.filename, text: doc.text });
      setResult(null);
      setPrompt("Tighten this into a shorter, warmer note. Keep the dates and the forty percent deposit.");
      focusPrompt();
    } catch (err) {
      const message =
        err instanceof DocumentPrepareError ? err.message : "Could not load the sample.";
      setError(message);
      toast.error(message);
    } finally {
      setPreparing(false);
    }
  }

  async function onRewrite() {
    if (!source || busy) return;
    const trimmed = prompt.trim();
    if (trimmed.length < 3) {
      setError("Write a slightly longer instruction.");
      textareaRef.current?.focus();
      return;
    }
    if (!aiAvailable) {
      const message = "AI is not available in this environment.";
      setError(message);
      toast.error(message);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (source.kind === "image") {
        const response = await onceOrRetry(() =>
          withTimeout(
            editImage({
              data: { imageDataUrl: source.dataUrl, prompt: trimmed },
            }),
            70_000,
          ),
        );
        if (!response.ok) {
          setError(response.error);
          toast.error(response.error);
          return;
        }
        const next: ImageAsset = {
          kind: "image",
          filename: source.filename,
          dataUrl: response.imageDataUrl,
        };
        setResult(next);
        setHistory(
          await saveHistoryItem({
            id: newId(),
            kind: "image",
            prompt: trimmed,
            source: source.dataUrl,
            result: next.dataUrl,
            filename: source.filename,
            createdAt: Date.now(),
          }),
        );
      } else {
        const response = await onceOrRetry(() =>
          withTimeout(
            editDocument({
              data: { filename: source.filename, text: source.text, prompt: trimmed },
            }),
            70_000,
          ),
        );
        if (!response.ok) {
          setError(response.error);
          toast.error(response.error);
          return;
        }
        const next: DocAsset = {
          kind: "document",
          filename: source.filename,
          text: response.text,
        };
        setResult(next);
        setHistory(
          await saveHistoryItem({
            id: newId(),
            kind: "document",
            prompt: trimmed,
            source: source.text,
            result: next.text,
            filename: source.filename,
            createdAt: Date.now(),
          }),
        );
      }
    } catch (err) {
      const message = reachErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  function useResultAsSource() {
    if (!result) return;
    setSource(result);
    setResult(null);
    setPrompt("");
    setError(null);
    focusPrompt();
  }

  function restoreItem(item: HistoryItem) {
    const pair = assetFromHistory(item);
    setSource(pair.source);
    setResult(pair.result);
    setPrompt(item.prompt);
    setError(null);
  }

  async function wipeHistory() {
    await clearHistory();
    setHistory([]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void onRewrite();
    }
  }

  async function pasteFromClipboard() {
    try {
      if (typeof navigator.clipboard?.read === "function") {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((type) => type.startsWith("image/"));
          if (imageType) {
            const blob = await item.getType(imageType);
            await ingestFile(blob, "pasted.png");
            toast.success("Pasted image");
            return;
          }
        }
        for (const item of items) {
          if (!item.types.includes("text/plain")) continue;
          const text = (await (await item.getType("text/plain")).text()).trim();
          if (!text) continue;
          applyPastedText(text);
          return;
        }
      }
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        toast.error("Clipboard is empty.");
        return;
      }
      applyPastedText(text);
    } catch {
      toast.error("Long-press in the instruction box to paste.");
      textareaRef.current?.focus();
      revealComposer();
    }
  }

  function applyPastedText(text: string) {
    if (source) {
      setPrompt((current) => joinPrompt(current, text));
      textareaRef.current?.focus();
      revealComposer();
      toast.success("Pasted into the instruction");
      return;
    }
    setSource({ kind: "document", filename: "pasted.txt", text });
    setResult(null);
    setError(null);
    toast.success("Pasted text");
  }

  function onComposerFocus() {
    window.clearTimeout(blurTimer.current);
    typingRef.current = true;
    setTyping(true);
    revealComposer();
  }

  function onComposerBlur() {
    blurTimer.current = window.setTimeout(() => {
      typingRef.current = false;
      setTyping(false);
      syncKeyboard();
    }, 350);
  }

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, coarsePointer() ? 176 : 128)}px`;
  }, [prompt, source]);

  function downloadResult() {
    if (!result) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    if (result.kind === "image") {
      downloadDataUrl(result.dataUrl, `pnp-studio-${stamp}.jpg`);
    } else {
      downloadText(result.text, rewrittenFilename(result.filename));
    }
  }

  const canSubmit =
    Boolean(source) && prompt.trim().length >= 3 && !busy && !preparing && aiAvailable;
  const suggestions = source?.kind === "document" ? DOC_SUGGESTIONS : IMAGE_SUGGESTIONS;

  return (
    <div
      className={cn(
        "atelier-root relative flex flex-col bg-bg text-fg",
        typing && "is-typing",
      )}
    >
      <Toaster
        theme="dark"
        position="top-center"
        toastOptions={{
          style: {
            background: "var(--color-raised)",
            color: "var(--color-fg)",
            border: "1px solid var(--color-border)",
            fontFamily: "var(--font-sans)",
          },
        }}
      />

      {dragging ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80">
          <div className="rounded-xl border border-dashed border-accent/50 bg-surface px-10 py-8 text-center">
            <p className="font-display text-2xl text-fg italic">Drop to open</p>
            <p className="mt-2 text-sm text-muted">Image, PDF, Word, or text</p>
          </div>
        </div>
      ) : null}

      <header className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div className="flex items-center gap-2.5">
          <StudioMark className="size-7" />
          <div className="leading-tight">
            <p className="font-display text-xl tracking-tight italic">Plug N Play</p>
            <p className="text-xs tracking-wide text-subtle uppercase">Studio</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {source ? (
            <Button variant="ghost" size="sm" onClick={resetAll} type="button">
              <RotateCcw className="size-3.5" />
              New
            </Button>
          ) : null}
        </div>
      </header>

      {!aiAvailable ? (
        <div className="mx-4 mb-2 rounded-md bg-raised px-4 py-2 text-sm text-muted shadow-border md:mx-6">
          AI is not available in this environment. You can still drop files, but edits cannot run.
        </div>
      ) : null}

      <main className="flex min-h-0 flex-1 flex-col px-4 md:px-6">
        {!source ? (
          <EmptyState
            fileId={fileId}
            preparing={preparing}
            onBrowse={() => inputRef.current?.click()}
            onSamplePhoto={() => void onSamplePhoto()}
            onSampleLetter={() => void onSampleLetter()}
            onPaste={() => void pasteFromClipboard()}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 pb-3">
            <div className="relative flex min-h-0 flex-1 items-stretch justify-center">
              {source.kind === "image" ? (
                result?.kind === "image" ? (
                  <CompareSlider
                    before={source.dataUrl}
                    after={result.dataUrl}
                    className="atelier-enter frame-max self-center"
                  />
                ) : (
                  <div className="frame-max relative self-center overflow-hidden rounded-md bg-raised shadow-border atelier-enter">
                    <img
                      src={source.dataUrl}
                      alt="Source image to edit"
                      className="frame-img block w-full object-contain"
                    />
                  </div>
                )
              ) : (
                <DocumentStage
                  filename={source.filename}
                  original={source.text}
                  rewritten={result?.kind === "document" ? result.text : null}
                />
              )}

              {busy ? (
                <div className="absolute inset-0 flex items-center justify-center bg-bg/55">
                  <div className="w-full max-w-xs px-6 text-center">
                    <p className="font-display text-2xl italic">
                      {source.kind === "document" ? "Reasoning through the page" : "Reasoning through the photograph"}
                    </p>
                    <p className="mt-1 text-sm text-muted">Then making the change.</p>
                    <div className="relative mt-4 h-px overflow-hidden bg-border">
                      <div className="atelier-shimmer absolute inset-y-0 w-1/3 bg-accent" />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {history.length > 0 && !typing ? (
              <HistoryRail items={history} onRestore={restoreItem} onClear={() => void wipeHistory()} />
            ) : null}
          </div>
        )}
      </main>

      {source ? (
        <footer className="studio-composer border-t border-border bg-surface px-4 pt-3 md:px-6">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
            {!typing ? (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
                {suggestions.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setPrompt(item.prompt)}
                    className="h-11 shrink-0 rounded-sm px-3 text-xs text-muted shadow-border transition-colors duration-150 hover:text-fg"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="flex flex-col gap-2 rounded-lg bg-raised p-2 shadow-border sm:flex-row sm:items-end">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={onKeyDown}
                onFocus={onComposerFocus}
                onBlur={onComposerBlur}
                placeholder="Night scene, keep the face, or replace the name exactly…"
                rows={3}
                maxLength={4000}
                disabled={busy}
                enterKeyHint="enter"
                autoCapitalize="sentences"
                autoComplete="off"
                autoCorrect="on"
                className="max-h-44 min-h-24 flex-1 resize-none bg-transparent px-3 py-2.5 text-base leading-snug text-fg outline-none placeholder:text-subtle disabled:opacity-60 sm:min-h-11 sm:text-sm"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  disabled={busy}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void pasteFromClipboard()}
                  className="flex-1 sm:flex-none"
                >
                  <ClipboardPaste className="size-4" />
                  Paste
                </Button>
                <Button
                  type="button"
                  size="lg"
                  disabled={!canSubmit}
                  onClick={() => void onRewrite()}
                  className="flex-1 sm:flex-none"
                >
                  {busy ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ArrowUpRight className="size-4" />
                  )}
                  Rewrite
                </Button>
              </div>
            </div>

            {!typing ? (
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 text-xs text-subtle">
                <p>
                  {error ? (
                    <span className="text-danger">{error}</span>
                  ) : busy ? (
                    "Working…"
                  ) : result ? (
                    source.kind === "document"
                      ? "Compare both pages. Continue from the edit, or download the text."
                      : "Slide to compare. Continue from the edit, or download it."
                  ) : (
                    <>
                      Say what you want in your own words. The studio reasons through the file first.
                    </>
                  )}
                </p>
                <div className="flex items-center gap-1">
                  {result ? (
                    <>
                      <Button variant="ghost" size="sm" type="button" onClick={useResultAsSource}>
                        Continue from edit
                      </Button>
                      <Button variant="secondary" size="sm" type="button" onClick={downloadResult}>
                        <Download className="size-3.5" />
                        Download
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ) : error ? (
              <p className="pb-2 text-xs text-danger">{error}</p>
            ) : null}
          </div>
        </footer>
      ) : null}

      <input
        id={fileId}
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="pointer-events-none absolute size-px opacity-0"
        suppressHydrationWarning
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void ingestFile(file, file.name);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function EmptyState({
  fileId,
  preparing,
  onBrowse,
  onSamplePhoto,
  onSampleLetter,
  onPaste,
}: {
  fileId: string;
  preparing: boolean;
  onBrowse: () => void;
  onSamplePhoto: () => void;
  onSampleLetter: () => void;
  onPaste: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-8">
      <div className="w-full max-w-lg text-center">
        <h1 className="atelier-enter font-display text-4xl leading-tight tracking-tight italic md:text-5xl">
          Photos and pages. One instruction.
        </h1>
        <p className="atelier-enter atelier-enter-delay-1 mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted md:text-base">
          <span className="sm:hidden">
            Restyle a photograph, or replace the words on a flyer or letter. Plug N Play Studio returns the edit.
          </span>
          <span className="hidden sm:inline">
            Restyle a photograph, or replace the words on a flyer or letter. One tool.
          </span>
        </p>
      </div>

      <div
        className={cn(
          "atelier-enter atelier-enter-delay-2 mt-10 flex w-full max-w-lg flex-col items-center gap-4 rounded-xl bg-surface px-6 py-8 text-center shadow-border transition-[box-shadow] duration-150 md:py-12",
          preparing && "opacity-70",
        )}
      >
        <label htmlFor={fileId} className="flex w-full cursor-pointer flex-col items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-md bg-raised text-fg">
            {preparing ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : (
              <FileUp className="size-5" />
            )}
          </span>
          <span>
            <span className="block text-sm font-medium text-fg">
              {preparing
                ? "Preparing file…"
                : (
                  <>
                    <span className="sm:hidden">Tap to choose a photo or document</span>
                    <span className="hidden sm:inline">Drop an image or document</span>
                  </>
                )}
            </span>
            <span className="mt-1 block text-xs text-subtle">
              Photos, PDF, Word — or paste from your clipboard
            </span>
          </span>
        </label>
        <span className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
          <Button type="button" size="md" onClick={onBrowse} disabled={preparing}>
            Choose a file
          </Button>
          <Button type="button" variant="secondary" size="md" onClick={onPaste} disabled={preparing}>
            <ClipboardPaste className="size-4" />
            Paste
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onSamplePhoto}
            disabled={preparing}
          >
            Try a photo
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onSampleLetter}
            disabled={preparing}
          >
            Try a letter
          </Button>
        </span>
      </div>
    </div>
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function onceOrRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Error && err.message === "timeout") throw err;
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    return run();
  }
}

function reachErrorMessage(err: unknown) {
  if (err instanceof Error && (err.message === "timeout" || err.name === "AbortError")) {
    return "The edit took too long. Stay on this screen and try again.";
  }
  return "The connection dropped. Stay on this screen and tap Rewrite.";
}

function HistoryRail({
  items,
  onRestore,
  onClear,
}: {
  items: HistoryItem[];
  onRestore: (item: HistoryItem) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <p className="hidden shrink-0 text-xs tracking-wide text-subtle uppercase sm:block">Recent</p>
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
        {items.map((item) => {
          const kind = itemKind(item);
          return (
            <button
              key={item.id}
              type="button"
              title={item.prompt}
              onClick={() => onRestore(item)}
              className="relative size-14 shrink-0 overflow-hidden rounded-sm bg-raised shadow-border transition-[box-shadow] duration-150 hover:shadow-border-hover"
            >
              {kind === "image" ? (
                <img src={item.result} alt="" className="size-full object-cover" />
              ) : (
                <span className="flex size-full flex-col bg-accent px-1.5 py-1 text-left text-accent-fg">
                  <span className="history-doc-preview line-clamp-4 leading-tight whitespace-pre-wrap">
                    {item.result}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <Button variant="ghost" size="icon-sm" type="button" onClick={onClear} aria-label="Clear history">
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
