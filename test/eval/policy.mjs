export function validateCorpusPolicy(policy) {
  const failures = [];
  if (policy?.classification !== "synthetic_only") failures.push("classification must be synthetic_only");
  if (policy?.containsHumanFeedback !== false) failures.push("containsHumanFeedback must be false");
  if (policy?.containsRepositoryData !== false) failures.push("containsRepositoryData must be false");
  if (policy?.networkAllowed !== false) failures.push("networkAllowed must be false");
  return failures;
}

export function evaluationExitCode(failedCaseCount, policyFailures) {
  return failedCaseCount === 0 && policyFailures.length === 0 ? 0 : 1;
}
