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

export const ALPHA_RULESET_VERSION = "2026-07-10.1";
export const ALPHA_TEMPLATE_VERSION = "2026-07-10.1";

const riskChangeSignalTypes = [
  "risk.file.added",
  "risk.file.changed",
  "risk.file.removed",
  "risk.file.renamed",
  "risk.file.copied"
];
const presentChangedTestSignalTypes = ["test.file.added", "test.file.changed", "test.file.copied"];
const riskChangeSignalTypeSet = new Set(riskChangeSignalTypes);
const presentChangedTestSignalTypeSet = new Set(presentChangedTestSignalTypes);

export const alphaRuleDefinitions: RuleDefinition[] = [
  {
    id: "rule_risky_files_without_nearby_tests",
    name: "Risk-sensitive files changed without nearby tests",
    version: ALPHA_RULESET_VERSION,
    description: "Finds path-classified risk-sensitive changes where no conservatively related test path was observed.",
    appliesTo: [...riskChangeSignalTypes, ...presentChangedTestSignalTypes, "test.file.observed"],
    requiredSignals: riskChangeSignalTypes,
    attributionRequired: ["change_window", "candidate_contributed"],
    evidenceTierImpact: ["observed"],
    feedbackTemplates: {
      matched: "A potentially risk-sensitive path has no conservatively matched nearby test path.",
      missingEvidence: "Path metadata did not identify a closely related test path.",
      nextStep: "Next: add or identify one focused test, then run it."
    }
  },
  {
    id: "rule_tests_near_risky_files",
    name: "Changed tests near risk-sensitive changes",
    version: ALPHA_RULESET_VERSION,
    description: "Finds present test-path changes near path-classified risk-sensitive changes without claiming execution or authorship.",
    appliesTo: [...riskChangeSignalTypes, ...presentChangedTestSignalTypes],
    requiredSignals: [...riskChangeSignalTypes, ...presentChangedTestSignalTypes],
    attributionRequired: ["change_window", "candidate_contributed"],
    evidenceTierImpact: ["observed"],
    feedbackTemplates: {
      matched: "A changed test path was observed near a potentially risk-sensitive change.",
      nextStep: "Next: run the relevant test and keep the command result."
    }
  },
  {
    id: "rule_existing_tests_near_risky_files",
    name: "Existing tests near risk-sensitive changes",
    version: ALPHA_RULESET_VERSION,
    description: "Finds a conservatively related pre-existing test path for a path-classified risk-sensitive change.",
    appliesTo: [...riskChangeSignalTypes, "test.file.observed"],
    requiredSignals: [...riskChangeSignalTypes, "test.file.observed"],
    attributionRequired: ["pre_existing"],
    evidenceTierImpact: ["observed"],
    feedbackTemplates: {
      matched: "An existing test path was observed near a potentially risk-sensitive change.",
      nextStep: "Next: run the relevant test and keep the command result."
    }
  },
  {
    id: "rule_deployment_config_evidence",
    name: "Deployment/config evidence observed",
    version: ALPHA_RULESET_VERSION,
    description: "Finds deployment or configuration evidence and preserves contribution attribution.",
    appliesTo: ["deployment.config.added", "deployment.config.changed", "deployment.config.observed"],
    requiredSignals: ["deployment.config.added", "deployment.config.changed", "deployment.config.observed"],
    evidenceTierImpact: ["observed"],
    feedbackTemplates: {
      matched: "Deployment/config path evidence was observed.",
      nextStep: "Next: capture a preview or deployment check if this change will ship."
    }
  },
  {
    id: "rule_dependency_api_evidence",
    name: "Dependency/API integration evidence observed",
    version: ALPHA_RULESET_VERSION,
    description: "Finds dependency/package evidence that may support integration work.",
    appliesTo: ["dependency.file.added", "dependency.file.changed", "dependency.file.observed"],
    requiredSignals: ["dependency.file.added", "dependency.file.changed", "dependency.file.observed"],
    evidenceTierImpact: ["observed"],
    feedbackTemplates: {
      matched: "Dependency or package path evidence was observed.",
      nextStep: "Next: run the closest build or integration check."
    }
  }
];

export function runAlphaRules(input: RunRulesInput): RuleRunResult {
  const projectId = input.projectId ?? input.signals[0]?.projectId ?? "project_unknown";
  const evaluatedAt = (input.now ?? new Date()).toISOString();
  const riskChanged = input.signals.filter(
    (signal) =>
      riskChangeSignalTypeSet.has(signal.signalType) &&
      isChangeWindowSignal(signal) &&
      hasTestableRiskCategory(signal)
  );
  const changedTests = input.signals.filter(
    (signal) =>
      presentChangedTestSignalTypeSet.has(signal.signalType) &&
      isChangeWindowSignal(signal)
  );
  const observedTests = input.signals.filter((signal) => signal.signalType === "test.file.observed");
  const allTests = input.signals.filter(
    (signal) => presentChangedTestSignalTypeSet.has(signal.signalType) || signal.signalType === "test.file.observed"
  );
  const deploymentSignals = input.signals.filter(
    (signal) =>
      signal.signalType === "deployment.config.added" ||
      signal.signalType === "deployment.config.changed" ||
      signal.signalType === "deployment.config.observed"
  );
  const dependencySignals = input.signals.filter(
    (signal) =>
      signal.signalType === "dependency.file.added" ||
      signal.signalType === "dependency.file.changed" ||
      signal.signalType === "dependency.file.observed"
  );

  const riskyWithoutTests = riskChanged.filter(
    (riskSignal) => !allTests.some((testSignal) => areNearby(pathOf(riskSignal), pathOf(testSignal)))
  );
  const riskyWithChangedTests = riskChanged.filter((riskSignal) =>
    changedTests.some((testSignal) => areNearby(pathOf(riskSignal), pathOf(testSignal)))
  );
  const riskyWithObservedTests = riskChanged.filter(
    (riskSignal) =>
      !changedTests.some((testSignal) => areNearby(pathOf(riskSignal), pathOf(testSignal))) &&
      observedTests.some((testSignal) => areNearby(pathOf(riskSignal), pathOf(testSignal)))
  );

  const ruleResults: RuleResult[] = [];

  if (riskyWithoutTests.length > 0) {
    ruleResults.push(
      buildRuleResult({
        ruleId: "rule_risky_files_without_nearby_tests",
        projectId,
        evaluatedAt,
        matched: true,
        confidence: "medium",
        matchedSignals: riskyWithoutTests,
        attribution: combineAttribution(riskyWithoutTests),
        evidenceTierImpact: ["observed"],
        summary: "A potentially risk-sensitive path has no conservatively matched nearby test path.",
        missingEvidence: ["Path metadata did not identify a closely related test path."],
        nextStep: "Next: add or identify one focused test, then run it."
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
        evidenceTierImpact: ["observed"],
        summary: "A changed test path was observed near a potentially risk-sensitive change.",
        nextStep: "Next: run the relevant test and keep the command result."
      })
    );
  }

  if (riskyWithObservedTests.length > 0) {
    const matchedTests = observedTests.filter((testSignal) =>
      riskyWithObservedTests.some((riskSignal) => areNearby(pathOf(riskSignal), pathOf(testSignal)))
    );
    ruleResults.push(
      buildRuleResult({
        ruleId: "rule_existing_tests_near_risky_files",
        projectId,
        evaluatedAt,
        matched: true,
        confidence: "medium",
        matchedSignals: [...riskyWithObservedTests, ...matchedTests],
        attribution: combineAttribution(matchedTests),
        evidenceTierImpact: ["observed"],
        summary: "An existing test path was observed near a potentially risk-sensitive change.",
        nextStep: "Next: run the relevant test and keep the command result."
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
        nextStep: hasChangedCiWorkflow(deploymentSignals)
          ? "Next: run or observe the relevant CI workflow."
          : "Next: capture a preview or deployment check if this change will ship."
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
        nextStep: "Next: run the closest build or integration check."
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
        (result.attribution.kind === "change_window" || result.attribution.kind === "candidate_contributed")
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

  if (hasChangedCiWorkflow(signals)) {
    return "CI workflow metadata changed in the selected Git window; authorship and execution were not inferred.";
  }

  if (kinds.has("change_window") || kinds.has("candidate_contributed")) {
    return "Deployment/config paths changed in the selected Git window; authorship was not inferred.";
  }

  if (kinds.has("pre_existing")) {
    return "Deployment/config path evidence exists outside the selected Git window.";
  }

  return "Deployment/config path evidence was observed without a reliable change window.";
}

function hasChangedCiWorkflow(signals: EvidenceSignal[]): boolean {
  return signals.some(
    (signal) =>
      (signal.signalType === "deployment.config.added" || signal.signalType === "deployment.config.changed") &&
      pathOf(signal).replace(/\\/g, "/").toLowerCase().startsWith(".github/workflows/")
  );
}

function dependencySummary(signals: EvidenceSignal[]): string {
  const kinds = new Set(signals.map((signal) => signal.attribution.kind));

  if (kinds.has("change_window") || kinds.has("candidate_contributed")) {
    return "Dependency or package paths changed in the selected Git window; authorship was not inferred.";
  }

  if (kinds.has("pre_existing")) {
    return "Dependency or package path evidence exists outside the selected Git window.";
  }

  return "Dependency or package path evidence was observed without a reliable change window.";
}

function pathOf(signal: EvidenceSignal): string {
  const path = signal.data?.path;
  return typeof path === "string" ? path : signal.refs?.find((ref) => ref.kind === "file")?.locator ?? "";
}

function areNearby(left: string, right: string): boolean {
  if (left.length === 0 || right.length === 0) {
    return false;
  }

  const leftModule = normalizedModulePath(left);
  const rightModule = normalizedModulePath(right);

  return leftModule.length > 0 && leftModule === rightModule;
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

function normalizedModulePath(path: string): string {
  const ignoredDirectories = new Set(["src", "app", "lib", "server", "client", "test", "tests", "__tests__", "spec", "specs"]);
  const parts = normalizedParts(path);
  const fileName = parts.pop() ?? "";
  const base = baseWithoutTestTokens(fileName);

  if (base.length === 0) {
    return "";
  }

  return [...parts.filter((part) => !ignoredDirectories.has(part)), base].join("/");
}

function combineAttribution(signals: EvidenceSignal[]): ContributionAttribution {
  const kinds = unique(signals.map((signal) => signal.attribution.kind));
  const basis = unique(signals.flatMap((signal) => signal.attribution.basis));

  if (kinds.length === 1) {
    return attribution(kinds[0] ?? "unknown", basis, strongestConfidence(signals));
  }

  if (kinds.includes("change_window")) {
    return attribution("change_window", [...basis, "at least one matched signal changed in the selected Git window"], "medium");
  }

  if (kinds.includes("candidate_contributed")) {
    return attribution("candidate_contributed", basis, "medium");
  }

  if (kinds.includes("pre_existing")) {
    return attribution("pre_existing", basis, "medium");
  }

  return attribution("unknown", basis.length > 0 ? basis : ["mixed or unavailable attribution"], "low");
}

function isChangeWindowSignal(signal: EvidenceSignal): boolean {
  return signal.attribution.kind === "change_window" || signal.attribution.kind === "candidate_contributed";
}

function hasTestableRiskCategory(signal: EvidenceSignal): boolean {
  const categories = signal.data?.riskCategories;
  return Array.isArray(categories) && categories.some(
    (category) => typeof category === "string" && category !== "infrastructure_deploy"
  );
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
