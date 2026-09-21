import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type CompareSliderProps = {
  before: string;
  after: string;
  className?: string;
};

export function CompareSlider({ before, after, className }: CompareSliderProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(52);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [after, before]);

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative mx-auto overflow-hidden rounded-md bg-raised shadow-border",
        className,
      )}
    >
      <img
        src={after}
        alt="Edited image"
        className="frame-img block w-full object-contain"
        draggable={false}
      />
      <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pos}%` }}>
        <img
          src={before}
          alt="Original image"
          draggable={false}
          className="absolute inset-y-0 left-0 h-full max-w-none object-cover"
          style={{ width: width || "100%" }}
        />
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 z-10 w-px bg-accent"
        style={{ left: `${pos}%` }}
      >
        <div className="absolute top-1/2 left-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lift">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M8 7 L3 12 L8 17" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 7 L21 12 L16 17" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      <div className="pointer-events-none absolute top-3 left-3 rounded-sm bg-bg/70 px-2 py-1 text-xs font-medium tracking-wide text-fg uppercase">
        Original
      </div>
      <div className="pointer-events-none absolute top-3 right-3 rounded-sm bg-bg/70 px-2 py-1 text-xs font-medium tracking-wide text-fg uppercase">
        Edited
      </div>

      <label className="sr-only" htmlFor="atelier-compare">
        Compare original and edited
      </label>
      <input
        id="atelier-compare"
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        className="absolute inset-0 z-20 m-0 h-full w-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}
