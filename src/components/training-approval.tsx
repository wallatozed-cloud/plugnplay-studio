import type { TrainingItemView } from "@/lib/training/types";

export function TrainingApprovalActions({
  view,
  compact = false,
  disabled = false,
  onApprove,
  onUnapprove,
}: {
  view: TrainingItemView;
  compact?: boolean;
  disabled?: boolean;
  onApprove: () => void;
  onUnapprove: () => void;
}) {
  if (view === "hidden") return null;

  if (compact) {
    if (view === "sent") {
      return <span className="flex items-center px-2.5 text-[11px] text-muted">Sent</span>;
    }
    if (view === "pending" || view === "failed") {
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={onUnapprove}
          aria-label={
            view === "failed"
              ? "Approved for training. The upload will retry later. Undo."
              : "Approved for training. Undo before it uploads."
          }
          className="flex h-14 min-w-14 flex-col items-center justify-center px-2.5 text-xs leading-tight text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          <span>{view === "failed" ? "Waiting" : "Approved"}</span>
          <span className="text-[10px] text-muted">Undo</span>
        </button>
      );
    }
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onApprove}
        aria-label="Approve for training"
        className="flex h-14 min-w-14 items-center px-2.5 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        Approve
      </button>
    );
  }

  if (view === "sent") {
    return (
      <p className="text-xs text-muted" aria-live="polite">
        Sent for training.
      </p>
    );
  }

  if (view === "pending" || view === "failed") {
    return (
      <div className="flex flex-col items-start gap-1">
        <p className="text-xs text-muted" aria-live="polite">
          {view === "failed"
            ? "Approved. The upload will retry next time you open the studio."
            : "Approved. Sending…"}
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={onUnapprove}
          className="h-11 rounded-sm px-3 text-xs text-muted hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          Undo approval
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onApprove}
      className="h-11 rounded-sm bg-raised px-3 text-xs text-fg shadow-border hover:shadow-border-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
    >
      Approve for training
    </button>
  );
}
