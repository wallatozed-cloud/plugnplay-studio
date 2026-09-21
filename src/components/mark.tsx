import { cn } from "@/lib/utils";

export function StudioMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={cn("text-fg", className)}
      fill="none"
    >
      <path
        d="M16 26.2 C9.2 21.2 5.4 16.4 6.6 11.6 C7.6 7.8 12.2 7.2 16 11.2 C19.8 7.2 24.4 7.8 25.4 11.6 C26.6 16.4 22.8 21.2 16 26.2 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M11.2 14.2 C12.4 12.1 14.6 12.4 16 14.4 C17.4 12.4 19.6 12.1 20.8 14.2"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
      <path
        d="M16 11.6 L18.15 13.75 L16 15.9 L13.85 13.75 Z"
        fill="currentColor"
      />
    </svg>
  );
}
