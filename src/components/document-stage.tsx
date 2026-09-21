import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

type DocumentStageProps = {
  filename: string;
  original: string;
  rewritten?: string | null;
};

function Paper({
  label,
  filename,
  text,
  muted,
}: {
  label: string;
  filename: string;
  text: string;
  muted?: boolean;
}) {
  return (
    <article
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md shadow-border",
        muted ? "bg-accent/80 text-accent-fg" : "bg-accent text-accent-fg",
      )}
    >
      <header className="flex items-center gap-2 border-b border-accent-fg/10 px-4 py-2.5">
        <FileText className="size-3.5 shrink-0 opacity-70" />
        <p className="min-w-0 truncate text-xs font-medium tracking-wide uppercase opacity-70">
          {label}
        </p>
        <p className="ml-auto min-w-0 truncate text-xs opacity-50">{filename}</p>
      </header>
      <pre className="paper-body min-h-0 flex-1 overflow-auto px-5 py-4 font-sans text-sm leading-relaxed whitespace-pre-wrap">
        {text}
      </pre>
    </article>
  );
}

export function DocumentStage({ filename, original, rewritten }: DocumentStageProps) {
  if (rewritten) {
    return (
      <div className="atelier-enter mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-3 md:flex-row">
        <Paper label="Original" filename={filename} text={original} muted />
        <Paper label="Rewritten" filename={filename} text={rewritten} />
      </div>
    );
  }

  return (
    <div className="atelier-enter mx-auto flex min-h-0 w-full max-w-3xl flex-1">
      <Paper label="Original" filename={filename} text={original} />
    </div>
  );
}
