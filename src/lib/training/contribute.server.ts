import {
  handleTrainingContribution,
  trainingStatusResponse,
  type TrainingUploadEnv,
} from "./contribute.ts";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Server-only. The token is read here and never returned to the browser. */
export function trainingUploadFromProcess(): TrainingUploadEnv {
  return {
    uploadUrl: readEnv("TRAINING_UPLOAD_URL"),
    uploadToken: readEnv("TRAINING_UPLOAD_TOKEN"),
  };
}

export function handleTrainingContributionRequest(request: Request): Promise<Response> {
  return handleTrainingContribution(request, trainingUploadFromProcess());
}

export function handleTrainingStatusRequest(): Response {
  return trainingStatusResponse(trainingUploadFromProcess());
}
