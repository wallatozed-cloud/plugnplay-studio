import { createFileRoute } from "@tanstack/react-router";
import { AgeGate, AgeSplash } from "@/components/age-gate";
import { Studio } from "@/components/studio";
import { useAgeConfirmation } from "@/lib/training/use-age";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const age = useAgeConfirmation();
  if (age.state === "loading") return <AgeSplash />;
  if (age.state !== "confirmed") return <AgeGate onConfirm={age.confirm} />;
  return <Studio />;
}
