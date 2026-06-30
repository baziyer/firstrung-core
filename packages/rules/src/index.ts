import type {
  AttributionKind,
  Confidence,
  ContributionAttribution,
  EvidenceSignal,
  EvidenceTier,
  JsonObject,
  RuleDefinition,
  RuleResult,
  SkillEpisode
} from "@firstrung/schema";

export interface RunRulesInput {
  projectId?: string;
  signals: EvidenceSignal[];
  now?: Date;
}

export interface RuleRunResult {
  ruleDefinitions: RuleDefinition[];
  ruleResults: RuleResult[];
  skillEpisodes: SkillEpisode[];
}

export const alphaRuleDefinitions: RuleDefinition[] = [
  {
    id: "rule_risky_files_without_nearby_tests",
    name: "Risk-sensitive files changed without nearby tests",
    version: "0.1.0-alpha.0",
    description: "Finds candidate-contributed risk-sensitive file changes where no nearby test evidence was observed.",
    appliesTo: ["risk.file.changed", "test.file.changed", "test.file.observed"],
    requiredSignals: ["risk.file.changed"],
    attributionRequired: ["candidate_contributed"],
    evidenceTierImpact: ["observed"],
    feedbackTemplates: {
      matched: "You changed risk-sensitive files, but I found no nearby test evidence yet.",
      missingEvidence: "No evidence yet of tests near those risk-sensitive changes.",
      nextStep: "Next useful step: add or surface a focused test near the risk-sensitive path."
    }
  },
  {
    id: "rule_tests_near_risky_files",
    name: "Tests added near risk-sensitive changes",
    version: "0.1.0-alpha.0",
    description: "Finds candidate-contributed test changes near candidate-contributed risk-sensitive paths.",
    appliesTo: ["risk.file.changed", "test.file.changed"],
    requiredSignals: ["risk.file.changed", "test.file.changed"],
    attributionRequired: ["candidate_contributed"],
    evidenceTierImpact: ["verified"],
    feedbackTemplates: {
      matched: "You added tests near risk-sensitive changes.",
      nextStep: "Next useful step: keep the test names and verification command easy to identify."
    }
  },
  {
    id: "rule_deployment_config_evidence",
    name: "Deployment/config evidence observed",
    version: "0.1.0-alpha.0",
    description: "Finds deployment or configuration evidence and preserves contribution attribution.",
    appliesTo: ["deployment.config.changed", "deployment.config.observed"],
    requiredSignals: ["deployment.config.changed", "deployment.config.observed"],
    evidenceTierImpact: ["observed"],
    feedbackTemplates: {
      matched: "I found deployment/config evidence.",
      nextStep: "Next useful step: connect this to a run, preview, or deployment receipt when you are ready."
    }
  },
  {
    id: "rule_dependency_api_evidence",
    name: "Dependency/API integration evidence observed",
    version: "0.1.0-alpha.0",
    description: "Finds dependency/package evidence that may support integration work.",
    appliesTo: ["dependency.file.changed", "dependency.file.observed"],
    requiredSignals: ["dependency.file.changed", "dependency.file.observed"],
    evidenceTierImpact: ["observed"],
    feedbackTemplates: {
      matched: "I found dependency or API-integration evidence.",
      nextStep: "Next useful step: pair dependency changes with tests or integration notes."
    }
  }
];

export function runAlphaRules(input: RunRulesInput): RuleRunResult {
  const projectId = input.projectId ?? input.signals[0]?.projectId ?? "project_unknown";
  const evaluatedAt = (input.now ?? new Date()).toISOString();
  const riskChanged = input.signals.filter(
    (signal) => signal.signalType === "risk.file.changed" && signal.attribution.kind === "candidate_contributed"
  );
  const changedTests = input.signals.filter(
    (signal) => signal.signalType === "test.file.changed" && signal.attribution.kind === "candidate_contributed"
  );
  const allTests = input.signals.filter(
    (signal) => signal.signalType === "test.file.changed" || signal.signalType === "test.file.observed"
  );
  const deploymentSignals = input.signals.filter(
    (signal) => signal.signalType === "deployment.config.changed" || signal.signalType === "deployment.config.observed"
  );
  const dependencySignals = input.signals.filter(
    (signal) => signal.signalType === "dependency.file.changed" || signal.signalType === "dependency.file.observed"
  );

  const riskyWithoutTests = riskChanged.filter(
    (riskSignal) => !allTests.some((testSignal) => areNearby(pathOf(riskSignal), pathOf(testSignal)))
  );
  const riskyWithChangedTests = riskChanged.filter((riskSignal) =>
    changedTests.some((testSignal) => areNearby(pathOf(riskSignal), pathOf(testSignal)))
  );

  const ruleResults: RuleResult[] = [];

  if (riskyWithoutTests.length > 0) {
    ruleResults.push(
      buildRuleResult({
        ruleId: "rule_risky_files_without_nearby_tests",
        projectId,
        evaluatedAt,
        matched: true,
        confidence: "high",
        matchedSignals: riskyWithoutTests,
        attribution: combineAttribution(riskyWithoutTests),
        evidenceTierImpact: ["observed"],
        summary: "You changed risk-sensitive files, but I found no nearby test evidence yet.",
        missingEvidence: ["No evidence yet of tests near those risk-sensitive changes."],
        nextStep: "Next useful step: add or surface a focused test near the risk-sensitive path."
      })
    );
  }

  if (riskyWithChangedTests.length > 0) {
    const matchedTests = changedTests.filter((testSignal) =>
      riskyWithChangedTests.some((riskSignal) => areNearby(pathOf(riskSignal), pathOf(testSignal)))
    );
    ruleResults.push(
      buildRuleResult({
        ruleId: "rule_tests_near_risky_files",
        projectId,
        evaluatedAt,
        matched: true,
        confidence: "high",
        matchedSignals: [...riskyWithChangedTests, ...matchedTests],
        attribution: combineAttribution([...riskyWithChangedTests, ...matchedTests]),
        evidenceTierImpact: ["verified"],
        summary: "You added tests near risk-sensitive changes.",
        nextStep: "Next useful step: keep the test names and verification command easy to identify."
      })
    );
  }

  if (deploymentSignals.length > 0) {
    ruleResults.push(
      buildRuleResult({
        ruleId: "rule_deployment_config_evidence",
        projectId,
        evaluatedAt,
        matched: true,
        confidence: strongestConfidence(deploymentSignals),
        matchedSignals: deploymentSignals,
        attribution: combineAttribution(deploymentSignals),
        evidenceTierImpact: ["observed"],
        summary: deploymentSummary(deploymentSignals),
        nextStep: "Next useful step: connect this to a run, preview, or deployment receipt when you are ready."
      })
    );
  }

  if (dependencySignals.length > 0) {
    ruleResults.push(
      buildRuleResult({
        ruleId: "rule_dependency_api_evidence",
        projectId,
        evaluatedAt,
        matched: true,
        confidence: strongestConfidence(dependencySignals),
        matchedSignals: dependencySignals,
        attribution: combineAttribution(dependencySignals),
        evidenceTierImpact: ["observed"],
        summary: dependencySummary(dependencySignals),
        nextStep: "Next useful step: pair dependency changes with tests or integration notes."
      })
    );
  }

  return {
    ruleDefinitions: alphaRuleDefinitions,
    ruleResults,
    skillEpisodes: buildSkillEpisodes(projectId, ruleResults)
  };
}

function buildRuleResult(input: {
  ruleId: string;
  projectId: string;
  evaluatedAt: string;
  matched: boolean;
  confidence: Confidence;
  matchedSignals: EvidenceSignal[];
  attribution: ContributionAttribution;
  evidenceTierImpact?: EvidenceTier[];
  summary: string;
  missingEvidence?: string[];
  nextStep?: string;
}): RuleResult {
  return {
    id: `result_${input.ruleId}`,
    ruleId: input.ruleId,
    projectId: input.projectId,
    evaluatedAt: input.evaluatedAt,
    matched: input.matched,
    confidence: input.confidence,
    matchedSignalIds: unique(input.matchedSignals.map((signal) => signal.id)),
    attribution: input.attribution,
    ...optional({ evidenceTierImpact: input.evidenceTierImpact }),
    feedback: {
      summary: input.summary,
      ...optional({
        missingEvidence: input.missingEvidence,
        nextStep: input.nextStep
      })
    }
  };
}

function buildSkillEpisodes(projectId: string, ruleResults: RuleResult[]): SkillEpisode[] {
  return ruleResults
    .filter(
      (result) =>
        result.matched &&
        result.ruleId !== "rule_risky_files_without_nearby_tests" &&
        result.attribution.kind === "candidate_contributed"
    )
    .map((result) => {
      const metadata = episodeMetadata(result);
      return {
        id: `episode_${result.ruleId.replace(/^rule_/, "")}`,
        projectId,
        type: metadata.type,
        title: metadata.title,
        status: "candidate",
        evidenceTier: result.evidenceTierImpact ?? ["observed"],
        confidence: result.confidence,
        supportingSignalIds: result.matchedSignalIds,
        attribution: result.attribution,
        ruleResultIds: [result.id]
      };
    });
}

function episodeMetadata(result: RuleResult): { type: string; title: string } {
  if (result.ruleId === "rule_tests_near_risky_files") {
    return {
      type: "risk_sensitive_testing",
      title: "Tests near risk-sensitive changes"
    };
  }

  if (result.ruleId === "rule_deployment_config_evidence") {
    return {
      type: "deployment_config_evidence",
      title: "Deployment/config evidence"
    };
  }

  if (result.ruleId === "rule_dependency_api_evidence") {
    return {
      type: "dependency_integration_evidence",
      title: "Dependency/API integration evidence"
    };
  }

  return {
    type: "local_repo_evidence",
    title: result.feedback?.summary ?? "Local repository evidence"
  };
}

function deploymentSummary(signals: EvidenceSignal[]): string {
  const kinds = new Set(signals.map((signal) => signal.attribution.kind));

  if (kinds.has("candidate_contributed")) {
    return "I found deployment/config evidence you changed in this contribution window.";
  }

  if (kinds.has("pre_existing")) {
    return "I found deployment/config evidence that appears to pre-date this contribution window.";
  }

  return "I found deployment/config evidence, but I could not tell whether you contributed it.";
}

function dependencySummary(signals: EvidenceSignal[]): string {
  const kinds = new Set(signals.map((signal) => signal.attribution.kind));

  if (kinds.has("candidate_contributed")) {
    return "I found dependency or API-integration evidence you changed in this contribution window.";
  }

  if (kinds.has("pre_existing")) {
    return "I found dependency or API-integration evidence that appears to pre-date this contribution window.";
  }

  return "I found dependency or API-integration evidence, but I could not tell whether you contributed it.";
}

function pathOf(signal: EvidenceSignal): string {
  const path = signal.data?.path;
  return typeof path === "string" ? path : signal.refs?.find((ref) => ref.kind === "file")?.locator ?? "";
}

function areNearby(left: string, right: string): boolean {
  if (left.length === 0 || right.length === 0) {
    return false;
  }

  const leftParts = normalizedParts(left);
  const rightParts = normalizedParts(right);
  const leftBase = baseWithoutTestTokens(leftParts[leftParts.length - 1] ?? "");
  const rightBase = baseWithoutTestTokens(rightParts[rightParts.length - 1] ?? "");
  const sharedDirectory = commonPrefix(leftParts.slice(0, -1), rightParts.slice(0, -1)).length;

  return (
    leftBase.length > 0 && rightBase.length > 0 && leftBase === rightBase ||
    sharedDirectory >= Math.max(1, Math.min(leftParts.length, rightParts.length) - 2) ||
    sharedPathToken(leftParts, rightParts)
  );
}

function normalizedParts(path: string): string[] {
  return path.toLowerCase().split("/").filter(Boolean);
}

function baseWithoutTestTokens(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/\.(test|spec)$/, "")
    .replace(/[_-](test|spec)$/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function commonPrefix(left: string[], right: string[]): string[] {
  const result: string[] = [];

  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      break;
    }

    result.push(left[index] ?? "");
  }

  return result;
}

function sharedPathToken(left: string[], right: string[]): boolean {
  const ignored = new Set(["src", "app", "lib", "server", "client", "test", "tests", "__tests__", "spec", "specs"]);
  const leftTokens = new Set(left.flatMap((part) => part.split(/[^a-z0-9]+/)).filter((part) => part.length > 2 && !ignored.has(part)));

  return right
    .flatMap((part) => part.split(/[^a-z0-9]+/))
    .some((part) => part.length > 2 && leftTokens.has(part));
}

function combineAttribution(signals: EvidenceSignal[]): ContributionAttribution {
  const kinds = unique(signals.map((signal) => signal.attribution.kind));
  const basis = unique(signals.flatMap((signal) => signal.attribution.basis));

  if (kinds.length === 1) {
    return attribution(kinds[0] ?? "unknown", basis, strongestConfidence(signals));
  }

  if (kinds.includes("candidate_contributed")) {
    return attribution("candidate_contributed", [...basis, "at least one matched signal changed in the contribution window"], "medium");
  }

  if (kinds.includes("pre_existing")) {
    return attribution("pre_existing", basis, "medium");
  }

  return attribution("unknown", basis.length > 0 ? basis : ["mixed or unavailable attribution"], "low");
}

function strongestConfidence(signals: EvidenceSignal[]): Confidence {
  if (signals.some((signal) => signal.confidence === "high")) {
    return "high";
  }

  if (signals.some((signal) => signal.confidence === "medium")) {
    return "medium";
  }

  return "low";
}

function attribution(kind: AttributionKind, basis: string[], confidence: Confidence): ContributionAttribution {
  return {
    kind,
    confidence,
    basis
  };
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function optional<T extends Record<string, unknown>>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
