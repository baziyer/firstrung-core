import { dirname } from "node:path";

export function renderCoachArtifactGuidance(input: {
  artifactPath?: string;
  feedbackPath?: string;
  sessionLogPath?: string;
}): string | undefined {
  if (!input.artifactPath && !input.feedbackPath && !input.sessionLogPath) return undefined;
  const cleanupDir = input.artifactPath ? dirname(input.artifactPath) : undefined;

  return [
    "FirstRung Coach local artifacts:",
    ...(input.feedbackPath ? [`- Feedback: ${input.feedbackPath}`] : []),
    ...(input.artifactPath ? [`- Metadata: ${input.artifactPath}`] : []),
    ...(input.sessionLogPath ? [`- Redacted session log: ${input.sessionLogPath}`] : []),
    ...(cleanupDir ? [`Cleanup: delete ${cleanupDir}`] : []),
    "Repository hygiene: keep .firstrung/ ignored and do not commit Coach artifacts."
  ].join("\n");
}
