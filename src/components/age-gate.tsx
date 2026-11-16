import { useState } from "react";
import { StudioMark } from "@/components/mark";
import { Button } from "@/components/ui/button";

export function AgeSplash() {
  return (
    <div
      className="atelier-root flex items-center justify-center bg-bg"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading</span>
      <StudioMark className="size-8" />
    </div>
  );
}

export function AgeGate({ onConfirm }: { onConfirm: () => void }) {
  const [declined, setDeclined] = useState(false);

  return (
    <div className="atelier-root shell-pad flex flex-col bg-bg text-fg">
      <header className="flex items-center gap-2.5 px-4 py-3">
        <StudioMark className="size-7" />
        <div className="leading-tight">
          <p className="font-display text-xl tracking-tight italic">Plug N Play</p>
          <p className="text-xs tracking-wide text-subtle uppercase">Studio</p>
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-8">
        {declined ? (
          <section className="w-full max-w-md text-center" aria-labelledby="age-declined-title">
            <h1 id="age-declined-title" className="font-display text-4xl tracking-tight italic">
              This studio is for adults
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              You need to be 18 or older to use Plug N Play Studio.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="mt-8 w-full"
              onClick={() => setDeclined(false)}
            >
              Back
            </Button>
          </section>
        ) : (
          <section className="w-full max-w-md text-center" aria-labelledby="age-gate-title">
            <h1 id="age-gate-title" className="font-display text-4xl tracking-tight italic">
              Adults only
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Plug N Play Studio is only for people who are 18 or older. Confirm your age to
              continue. We save this on this device and will not ask again.
            </p>
            <div className="mt-8 flex flex-col gap-3">
              <Button type="button" size="lg" className="w-full" onClick={onConfirm}>
                I am 18 or older
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => setDeclined(true)}
              >
                I am under 18
              </Button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
