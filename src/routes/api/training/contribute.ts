import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/training/contribute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleTrainingContributionRequest } =
          await import("@/lib/training/contribute.server");
        return handleTrainingContributionRequest(request);
      },
    },
  },
});
