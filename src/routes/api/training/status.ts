import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/training/status")({
  server: {
    handlers: {
      GET: async () => {
        const { handleTrainingStatusRequest } = await import("@/lib/training/contribute.server");
        return handleTrainingStatusRequest();
      },
    },
  },
});
