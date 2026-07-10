import type { CoachContext } from "./coachContext.js";

export function buildCoachPrompt(context: CoachContext): string {
  const matchedRules = context.rules
    .map((rule) => {
      const feedback = typeof rule.feedback === "object" && rule.feedback !== null && !Array.isArray(rule.feedback)
        ? (rule.feedback as { summary?: unknown; nextStep?: unknown; missingEvidence?: unknown })
        : {};
      return {
        ruleId: String(rule.ruleId ?? rule.id ?? "rule"),
        summary: typeof feedback.summary === "string" ? feedback.summary : String(rule.summary ?? "Evidence observed."),
        nextStep: typeof feedback.nextStep === "string" ? feedback.nextStep : undefined,
        missingEvidence: Array.isArray(feedback.missingEvidence)
          ? feedback.missingEvidence.filter((item): item is string => typeof item === "string")
          : []
      };
    })
    .slice(0, 12);

  return [
    "You are the FirstRung Coach. Give candidate-facing feedback from the provided redacted context only.",
    "Return exactly three markdown sections, in this order, with headings on their own lines: ## Evidence, ## Inference, ## Next steps.",
    "Keep the complete response under 120 words. Prefer one concrete next step; never provide more than two.",
    "If the evidence does not justify an action, say that no specific action is justified yet.",
    "Frame gaps as not yet evidenced, not as absent capability.",
    "Do not give scores, rankings, hiring recommendations, or employment suitability judgments.",
    "Do not suggest that you can edit code. Direct code changes back to the user's normal agent or editor.",
    `Disclosure: ${context.disclosure.notice}`,
    `Project: ${context.summary.projectName} (${context.summary.projectId}). Local paths are pseudonymized.`,
    `Changed files observed: ${context.summary.changedFileCount}; tracked files observed: ${context.summary.trackedFileCount}.`,
    "Rule evidence:",
    ...matchedRules.map((rule) => {
      const missing = rule.missingEvidence.length > 0 ? ` Missing evidence: ${rule.missingEvidence.join(" ")}` : "";
      const next = rule.nextStep ? ` Next step: ${rule.nextStep}` : "";
      return `- ${rule.ruleId}: ${rule.summary}${missing}${next}`;
    }),
    "Do not repeat the project metadata or disclosure in the response."
  ].join("\n");
}
