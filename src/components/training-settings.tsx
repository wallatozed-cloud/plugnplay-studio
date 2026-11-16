import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import * as Switch from "@radix-ui/react-switch";
import { Button } from "@/components/ui/button";
import type { TrainingController } from "@/lib/training/use-training";

export function TrainingSettingsButton({ training }: { training: TrainingController }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  if (!training.enabled) return null;

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="sm"
        className="h-11 px-2"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Settings"
        onClick={() => setOpen(true)}
      >
        <Settings className="size-4" />
        <span className="hidden sm:inline">Settings</span>
      </Button>
      {open ? (
        <TrainingSettingsDialog
          training={training}
          onClose={() => {
            setOpen(false);
            buttonRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

function TrainingSettingsDialog({
  training,
  onClose,
}: {
  training: TrainingController;
  onClose: () => void;
}) {
  const titleId = useId();
  const copyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [busy, setBusy] = useState(false);
  const optedIn = training.optedIn;
  onCloseRef.current = onClose;

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    node.focus();
    const focusable = () => [
      ...node.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [role='switch']"),
    ];
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  async function onChecked(next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        const result = training.optIn();
        if (!result.ok) toast.error(result.error);
        return;
      }
      const result = await training.optOut();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast("Training uploads are off. Anything still waiting was discarded.");
    } finally {
      setBusy(false);
    }
  }

  const since =
    optedIn && training.consentAt
      ? new Date(training.consentAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-bg/75 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={copyId}
        tabIndex={-1}
        className="max-h-[85dvh] w-full overflow-y-auto overscroll-contain rounded-t-xl bg-surface px-5 pt-5 shadow-lift focus:outline-none sm:max-w-md sm:rounded-xl"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-display text-3xl tracking-tight italic">
            Settings
          </h2>
          <Button type="button" variant="ghost" size="sm" className="h-11" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mt-5 flex items-start justify-between gap-4">
          <label htmlFor="training-opt-in" className="text-sm font-medium text-fg">
            Use my approved photos and edits to improve the engine
          </label>
          <Switch.Root
            id="training-opt-in"
            checked={optedIn}
            disabled={busy}
            onCheckedChange={(checked) => void onChecked(checked)}
            className="relative inline-flex h-11 w-[4.5rem] shrink-0 items-center rounded-full bg-raised shadow-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40 data-[state=checked]:bg-accent"
          >
            <Switch.Thumb className="block size-7 translate-x-2 rounded-full bg-muted transition-transform duration-150 data-[state=checked]:translate-x-8 data-[state=checked]:bg-accent-fg" />
          </Switch.Root>
        </div>

        <p id={copyId} className="mt-3 text-sm leading-relaxed text-muted">
          When this is on, you can approve a finished photo. We send that edited image, the original
          photo if it is still on this device, and the instruction you wrote. We also send an
          anonymous id for this device and the time you turned this on. Photos from before you opted
          in are not sent unless you approve them. Documents are never sent. Turn this off any time
          to stop new uploads and discard anything still waiting.
        </p>
        {since ? <p className="mt-3 text-xs text-subtle">On since {since}.</p> : null}
        <Link
          to="/training-terms"
          className="mt-4 inline-flex h-11 items-center text-sm text-fg underline underline-offset-4"
        >
          Training terms
        </Link>
      </div>
    </div>
  );
}
