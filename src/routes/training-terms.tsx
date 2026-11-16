import { createFileRoute, Link } from "@tanstack/react-router";
import { StudioMark } from "@/components/mark";

export const Route = createFileRoute("/training-terms")({
  head: () => ({
    meta: [{ title: "Training terms · Plug N Play Studio" }],
  }),
  component: TrainingTermsPage,
});

function TrainingTermsPage() {
  return (
    <div className="atelier-root shell-pad bg-bg text-fg">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <StudioMark className="size-7" />
          <div className="leading-tight">
            <p className="font-display text-xl tracking-tight italic">Plug N Play</p>
            <p className="text-xs tracking-wide text-subtle uppercase">Studio</p>
          </div>
        </div>
        <Link
          to="/"
          className="inline-flex h-11 items-center rounded-sm px-3 text-sm text-muted hover:bg-raised hover:text-fg"
        >
          Back
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-6">
        <h1 className="font-display text-4xl tracking-tight italic">Training terms</h1>
        <p className="text-sm leading-relaxed text-muted">
          This is optional. It is off until you turn it on in Settings, and nothing is uploaded
          until you approve a photo.
        </p>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-fg">What this is</h2>
          <p className="text-sm leading-relaxed text-muted">
            You can let Plug N Play Studio use photos you approve to improve the image engine.
            Approved photos are sent to a separate training server. The editor that makes your image
            does not keep them.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-fg">What we send</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted">
            <li>The edited image.</li>
            <li>The original photo, when it is still on this device.</li>
            <li>The instruction you wrote.</li>
            <li>An anonymous id created on this device, not your name.</li>
            <li>The time you turned training on, and the time the edit was made.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-fg">What we do not send</h2>
          <p className="text-sm leading-relaxed text-muted">
            Documents are never sent. An edit is not sent just because training is on. Photos saved
            before you opted in stay on this device unless you approve them afterward. People who
            operate the training server can see the photos and instructions you approve. They may be
            used to train the image engine.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-fg">Age</h2>
          <p className="text-sm leading-relaxed text-muted">
            You need to be 18 or older to use the studio and to contribute photos.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-fg">Turning it off</h2>
          <p className="text-sm leading-relaxed text-muted">
            Turn the setting off any time. That stops new uploads and deletes anything on this
            device that is still waiting to send. An upload that has already gone through stays in
            the training set. This app cannot pull it back. The anonymous id stays on this device if
            you turn training on again, so later photos from this phone can be grouped. You can
            still undo an approval before it uploads.
          </p>
        </section>
      </main>
    </div>
  );
}
