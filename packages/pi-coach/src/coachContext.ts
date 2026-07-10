import { aiSessionEventsToEvidenceSignals, type AiSessionEvent } from "@firstrung/ai-session";
import { extname, isAbsolute } from "node:path";
import type {
  CandidateReflection,
  ContributionAttribution,
  EvidenceSignal,
  JsonObject,
  JsonValue,
  RuleResult,
  ScanSummary,
  SkillEpisode
} from "@firstrung/schema";

export interface SelectedCoachSnippet {
  id: string;
  label: string;
  text: string;
}

export interface SelectedCoachSnippetMetadata {
  id: string;
  label: string;
  textMetadata: {
    included: false;
    summary: string;
    characterCount: number;
  };
}

export interface CoachContextInput {
  scanSummary: ScanSummary;
  ruleResults: readonly RuleResult[];
  skillEpisodes: readonly SkillEpisode[];
  evidenceSignals?: readonly EvidenceSignal[];
  aiSessionEvents?: readonly AiSessionEvent[];
  aiSessionSignals?: readonly EvidenceSignal[];
  approvedFiles?: readonly JsonObject[];
  candidateReflection?: Partial<CandidateReflection> & { rawResponse?: string; rawPrompt?: string };
  selectedSnippetConsent?: {
    snippets: readonly SelectedCoachSnippet[];
    approvedSnippetIds: readonly string[];
  };
}

export interface CoachContext {
  summary: ScanSummary;
  disclosure: {
    rawSnippetConsent: boolean;
    rawDataDisclosure: "none" | "selected";
    notice: string;
    provider: {
      promptFields: string[];
      toolFields: string[];
      pathHandling: string;
      selectedSnippetPolicy: string;
    };
  };
  evidence: {
    signals: JsonObject[];
    aiSessionSignals: JsonObject[];
  };
  rules: JsonObject[];
  skillEpisodes: JsonObject[];
  approvedFiles: JsonObject[];
  candidateReflection?: JsonObject;
  selectedSnippets?: SelectedCoachSnippetMetadata[];
}

const DISCLOSURE_NOTICE =
  "Live coaching sends the redacted provider prompt and approved tool results to the configured model provider. Raw source, diffs, prior prompts or responses, command output, private logs, secrets, and env values are excluded by default.";

const PROVIDER_DISCLOSURE = {
  promptFields: ["session-local project pseudonym", "changed/tracked file counts", "redacted rule summaries"],
  toolFields: [
    "redacted scan metadata",
    "repository-relative approved file metadata",
    "fixed verification status without command output"
  ],
  pathHandling:
    "Absolute local paths are replaced with project:// aliases. Repository-relative evidence paths may be sent because they are needed to explain a finding.",
  selectedSnippetPolicy:
    "Raw snippet text is available to the provider only when the caller explicitly supplies selected snippet consent."
} as const;

const UNSAFE_KEY_TOKENS = [
  "raw",
  "rawsource",
  "sourcecode",
  "sourcetext",
  "diff",
  "patch",
  "prompt",
  "response",
  "commandoutput",
  "stdout",
  "stderr",
  "privatelog",
  "secret",
  "token",
  "password",
  "credential",
  "env"
] as const;

const APPROVED_FILE_UNSAFE_KEY_TOKENS = ["content", "text", "body", "source"] as const;

export function buildCoachContext(input: CoachContextInput): CoachContext {
  const aiSessionSignals = [
    ...(input.aiSessionSignals ?? []),
    ...(input.aiSessionEvents ? aiSessionEventsToEvidenceSignals([...input.aiSessionEvents]) : [])
  ];
  const sensitiveAliases = buildSensitiveAliases(input.scanSummary);
  for (const actor of [
    ...(input.evidenceSignals ?? []).map((signal) => signal.attribution.actor),
    ...aiSessionSignals.map((signal) => signal.attribution.actor),
    ...input.ruleResults.map((rule) => rule.attribution.actor),
    ...input.skillEpisodes.map((episode) => episode.attribution.actor)
  ]) {
    if (actor) sensitiveAliases.set(actor, "actor-redacted");
  }
  const approvedSnippets = input.selectedSnippetConsent
    ? resolveApprovedCoachSnippets(
        input.selectedSnippetConsent.snippets,
        input.selectedSnippetConsent.approvedSnippetIds ?? []
      )
    : [];
  const selectedSnippets = approvedSnippets.map((snippet, index) =>
    selectedSnippetMetadata(snippet, index, sensitiveAliases)
  );
  const allSignals = [...(input.evidenceSignals ?? []), ...aiSessionSignals];
  const signalIds = aliasIds(allSignals.map((signal) => signal.id), "signal");
  const ruleResultIds = aliasIds(input.ruleResults.map((rule) => rule.id), "rule_result");
  const context: CoachContext = {
    summary: pseudonymizedSummary(input.scanSummary, sensitiveAliases),
    disclosure: {
      rawSnippetConsent: selectedSnippets !== undefined && selectedSnippets.length > 0,
      rawDataDisclosure: selectedSnippets !== undefined && selectedSnippets.length > 0 ? "selected" : "none",
      notice: DISCLOSURE_NOTICE,
      provider: {
        promptFields: [...PROVIDER_DISCLOSURE.promptFields],
        toolFields: [...PROVIDER_DISCLOSURE.toolFields],
        pathHandling: PROVIDER_DISCLOSURE.pathHandling,
        selectedSnippetPolicy: PROVIDER_DISCLOSURE.selectedSnippetPolicy
      }
    },
    evidence: {
      signals: (input.evidenceSignals ?? []).map((signal) => projectEvidenceSignal(signal, signalIds, sensitiveAliases)),
      aiSessionSignals: aiSessionSignals.map((signal) => projectEvidenceSignal(signal, signalIds, sensitiveAliases))
    },
    rules: input.ruleResults.map((rule) => projectRuleResult(rule, signalIds, ruleResultIds, sensitiveAliases)),
    skillEpisodes: input.skillEpisodes.map((episode, index) =>
      projectSkillEpisode(episode, index, signalIds, ruleResultIds, sensitiveAliases)
    ),
    approvedFiles: (input.approvedFiles ?? []).map((file, index) =>
      projectApprovedFile(file, index, sensitiveAliases)
    )
  };
  const reflection = sanitizeReflection(input.candidateReflection, sensitiveAliases);

  if (reflection) {
    context.candidateReflection = reflection;
  }

  if (selectedSnippets.length > 0) {
    context.selectedSnippets = selectedSnippets;
  }

  return context;
}

export function resolveApprovedCoachSnippets(
  snippets: readonly SelectedCoachSnippet[],
  approvedSnippetIds: readonly string[]
): SelectedCoachSnippet[] {
  const byId = new Map<string, SelectedCoachSnippet>();

  for (const snippet of snippets) {
    if (!snippet.id || byId.has(snippet.id)) {
      throw new Error("FirstRung Coach selected snippet ids must be non-empty and unique.");
    }

    byId.set(snippet.id, snippet);
  }

  const approved = [];
  const seen = new Set<string>();

  for (const id of approvedSnippetIds) {
    if (seen.has(id)) continue;
    const snippet = byId.get(id);

    if (!snippet) {
      throw new Error(`FirstRung Coach snippet consent references unknown snippet id: ${id}.`);
    }

    if (snippet.text.length > 8_000) {
      throw new Error(`FirstRung Coach selected snippet ${id} exceeds the 8000 character consent limit.`);
    }

    seen.add(id);
    approved.push(snippet);
  }

  return approved;
}

function projectEvidenceSignal(
  signal: EvidenceSignal,
  signalIds: ReadonlyMap<string, string>,
  sensitiveAliases: ReadonlyMap<string, string>
): JsonObject {
  return {
    id: signalIds.get(signal.id) ?? "signal_external",
    projectId: "project_local",
    source: signal.source,
    signalType: projectIdentifier(signal.signalType, "signal_type"),
    observedAt: signal.observedAt,
    summary: projectText(signal.summary, sensitiveAliases),
    sourceEventIds: signal.sourceEventIds.slice(0, 20).map((_, index) => `event_${index + 1}`),
    attribution: projectAttribution(signal.attribution, sensitiveAliases),
    confidence: signal.confidence
  };
}

function projectRuleResult(
  rule: RuleResult,
  signalIds: ReadonlyMap<string, string>,
  ruleResultIds: ReadonlyMap<string, string>,
  sensitiveAliases: ReadonlyMap<string, string>
): JsonObject {
  const output: JsonObject = {
    id: ruleResultIds.get(rule.id) ?? "rule_result_external",
    ruleId: projectIdentifier(rule.ruleId, "rule"),
    projectId: "project_local",
    evaluatedAt: rule.evaluatedAt,
    matched: rule.matched,
    confidence: rule.confidence,
    matchedSignalIds: rule.matchedSignalIds.slice(0, 40).map((id) => signalIds.get(id) ?? "signal_external"),
    attribution: projectAttribution(rule.attribution, sensitiveAliases)
  };

  if (rule.evidenceTierImpact) {
    output.evidenceTierImpact = projectEvidenceTiers(rule.evidenceTierImpact);
  }

  if (rule.feedback) {
    output.feedback = {
      summary: projectText(rule.feedback.summary, sensitiveAliases),
      ...(rule.feedback.missingEvidence
        ? { missingEvidence: rule.feedback.missingEvidence.slice(0, 8).map((item) => projectText(item, sensitiveAliases)) }
        : {}),
      ...(rule.feedback.nextStep ? { nextStep: projectText(rule.feedback.nextStep, sensitiveAliases) } : {})
    };
  }

  return output;
}

function projectSkillEpisode(
  episode: SkillEpisode,
  index: number,
  signalIds: ReadonlyMap<string, string>,
  ruleResultIds: ReadonlyMap<string, string>,
  sensitiveAliases: ReadonlyMap<string, string>
): JsonObject {
  return {
    id: `skill_episode_${index + 1}`,
    projectId: "project_local",
    type: projectIdentifier(episode.type, "skill_episode"),
    title: projectText(episode.title, sensitiveAliases),
    status: episode.status,
    evidenceTier: projectEvidenceTiers(episode.evidenceTier),
    confidence: episode.confidence,
    supportingSignalIds: episode.supportingSignalIds
      .slice(0, 40)
      .map((id) => signalIds.get(id) ?? "signal_external"),
    attribution: projectAttribution(episode.attribution, sensitiveAliases),
    ...(episode.ruleResultIds
      ? {
          ruleResultIds: episode.ruleResultIds
            .slice(0, 20)
            .map((id) => ruleResultIds.get(id) ?? "rule_result_external")
        }
      : {})
  };
}

function projectAttribution(
  attribution: ContributionAttribution,
  sensitiveAliases: ReadonlyMap<string, string>
): JsonObject {
  const timeWindow: JsonObject = {};

  if (attribution.timeWindow?.startedAt) timeWindow.startedAt = attribution.timeWindow.startedAt;
  if (attribution.timeWindow?.endedAt) timeWindow.endedAt = attribution.timeWindow.endedAt;

  return {
    kind: attribution.kind,
    confidence: attribution.confidence,
    basis: attribution.basis.slice(0, 8).map((item) => projectText(item, sensitiveAliases)),
    ...(attribution.actor ? { actor: "actor-redacted" } : {}),
    ...(Object.keys(timeWindow).length > 0 ? { timeWindow } : {})
  };
}

function projectApprovedFile(
  input: JsonObject,
  index: number,
  sensitiveAliases: ReadonlyMap<string, string>
): JsonObject {
  const path = typeof input.path === "string" ? projectRepositoryPath(input.path, sensitiveAliases) : undefined;
  const label = typeof input.label === "string" ? projectText(input.label, sensitiveAliases) : undefined;

  return {
    id: `approved_file_${index + 1}`,
    ...(path ? { path } : {}),
    ...(label ? { label } : {})
  };
}

function projectEvidenceTiers(input: readonly string[]): JsonValue[] {
  const allowed = new Set(["observed", "verified", "operated", "repeated", "attested", "outcome_linked"]);
  return input.filter((item) => allowed.has(item)).slice(0, 8);
}

function aliasIds(ids: readonly string[], prefix: string): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();

  for (const id of ids) {
    if (!aliases.has(id)) aliases.set(id, `${prefix}_${aliases.size + 1}`);
  }

  return aliases;
}

export function sanitizeJson(input: unknown, sensitiveAliases: ReadonlyMap<string, string> = new Map()): JsonObject {
  const value = sanitizeValue(input, [], sensitiveAliases);

  if (isJsonObject(value)) {
    return value;
  }

  return { value };
}

function sanitizeApprovedFile(input: unknown, sensitiveAliases: ReadonlyMap<string, string>): JsonObject {
  const value = sanitizeValue(input, APPROVED_FILE_UNSAFE_KEY_TOKENS, sensitiveAliases);

  if (isJsonObject(value)) {
    return value;
  }

  return { value };
}

function selectedSnippetMetadata(
  snippet: SelectedCoachSnippet,
  index: number,
  sensitiveAliases: ReadonlyMap<string, string>
): SelectedCoachSnippetMetadata {
  const label = pseudonymizeString(snippet.label.trim(), sensitiveAliases);
  return {
    id: `snippet_${index + 1}`,
    label:
      label.length > 0 && label.length <= 120 && !isAbsoluteOnAnyPlatform(label) && !hasControlCharacters(label)
        ? label
        : `Selected snippet ${index + 1}`,
    textMetadata: {
      included: false,
      summary: "selected snippet text available only through explicit read tool consent",
      characterCount: snippet.text.length
    }
  };
}

function sanitizeReflection(
  reflection: (Partial<CandidateReflection> & { rawResponse?: string; rawPrompt?: string }) | undefined,
  sensitiveAliases: ReadonlyMap<string, string>
): JsonObject | undefined {
  if (!reflection) {
    return undefined;
  }

  const safe: JsonObject = {};

  if (reflection.id) {
    safe.id = "reflection_1";
  }

  if (reflection.projectId) {
    safe.projectId = "project_local";
  }

  if (reflection.createdAt) {
    safe.createdAt = reflection.createdAt;
  }

  if (reflection.summary) {
    safe.summary = projectText(reflection.summary, sensitiveAliases);
  }

  return safe;
}

function sanitizeValue(
  input: unknown,
  extraUnsafeTokens: readonly string[],
  sensitiveAliases: ReadonlyMap<string, string>,
  key = ""
): JsonValue {
  if (typeof input === "string") {
    const explicitAlias = sensitiveKeyAlias(key);

    if (explicitAlias) {
      return explicitAlias;
    }

    const pseudonymized = pseudonymizeString(input, sensitiveAliases);
    return isPathKey(key) && isAbsoluteOnAnyPlatform(pseudonymized) ? aliasAbsolutePath(pseudonymized) : pseudonymized;
  }

  if (input === null || typeof input === "number" || typeof input === "boolean") {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeValue(item, extraUnsafeTokens, sensitiveAliases, key));
  }

  if (typeof input === "object") {
    const output: JsonObject = {};

    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (isUnsafeKey(key, extraUnsafeTokens)) {
        continue;
      }

      output[key] = sanitizeValue(value, extraUnsafeTokens, sensitiveAliases, key);
    }

    return output;
  }

  return String(input);
}

function pseudonymizedSummary(summary: ScanSummary, sensitiveAliases: ReadonlyMap<string, string>): ScanSummary {
  return {
    projectId: "project_local",
    projectName: "local-project",
    requestedPath: "project://root",
    repoRoot: "project://root",
    currentBranch: "branch-redacted",
    targetRef: "ref-redacted",
    targetCommit: "commit-redacted",
    ...(summary.baselineRef ? { baselineRef: "ref-redacted" } : {}),
    attributionMode: summary.attributionMode,
    attributionReason: projectText(summary.attributionReason, sensitiveAliases),
    changedFileCount: summary.changedFileCount,
    trackedFileCount: summary.trackedFileCount,
    rawContentIncluded: false
  };
}

function buildSensitiveAliases(summary: ScanSummary): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const path of [summary.requestedPath, summary.repoRoot]) {
    if (path && isAbsoluteOnAnyPlatform(path)) {
      aliases.set(path, "project://root");
    }
  }

  for (const [value, alias] of [
    [summary.projectId, "project_local"],
    [summary.projectName, "local-project"],
    [summary.currentBranch, "branch-redacted"],
    [summary.targetRef, "ref-redacted"],
    [summary.targetCommit, "commit-redacted"],
    [summary.baselineRef, "ref-redacted"]
  ] as const) {
    if (value) {
      aliases.set(value, alias);
    }
  }

  return aliases;
}

function pseudonymizeString(value: string, sensitiveAliases: ReadonlyMap<string, string>): string {
  let output = value;

  for (const [sensitiveValue, alias] of [...sensitiveAliases].sort(([left], [right]) => right.length - left.length)) {
    output = output.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(sensitiveValue)}(?![A-Za-z0-9])`, "gu"), alias);
  }

  return output;
}

function projectText(value: string, sensitiveAliases: ReadonlyMap<string, string>): string {
  return pseudonymizeString(value, sensitiveAliases)
    .replace(/\b(?:https?|ssh|git):\/\/[^\s"'<>]+/giu, "remote://redacted")
    .replace(/\bgit@[A-Za-z0-9.-]+:[^\s"'<>]+/gu, "remote://redacted")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "actor-redacted")
    .replace(/[A-Za-z]:\\Users\\[^\s"'<>]+/gu, "project://absolute-path")
    .replace(/\/(?:Users|home)\/[^\s"'<>]+/gu, "project://absolute-path")
    .replace(/[\u0000-\u001F\u007F]/gu, " ")
    .trim()
    .slice(0, 1_000);
}

function projectIdentifier(value: string, fallback: string): string {
  return /^[A-Za-z0-9._:-]{1,120}$/u.test(value) ? value : fallback;
}

function projectRepositoryPath(value: string, sensitiveAliases: ReadonlyMap<string, string>): string {
  const projected = projectText(value, sensitiveAliases).replaceAll("\\", "/");

  if (isAbsoluteOnAnyPlatform(value)) return aliasAbsolutePath(value);
  if (projected.startsWith("remote://") || projected.split("/").includes("..")) return "project://relative-path-redacted";

  return projected.slice(0, 240);
}

function sensitiveKeyAlias(key: string): string | undefined {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (normalized === "projectid") return "project_local";
  if (normalized === "projectname") return "local-project";
  if (normalized === "currentbranch") return "branch-redacted";
  if (normalized === "targetref" || normalized === "baselineref") return "ref-redacted";
  if (normalized === "actor" || normalized === "username" || normalized === "user" || normalized === "author") {
    return "actor-redacted";
  }
  if (normalized.includes("remote") || normalized.includes("url")) return "remote://redacted";
  if (normalized === "targetcommit" || normalized === "commithash" || normalized === "shorthash") {
    return "commit-redacted";
  }

  return undefined;
}

function isPathKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized.includes("path") || normalized === "reporoot";
}

function isAbsoluteOnAnyPlatform(path: string): boolean {
  return isAbsolute(path) || /^[A-Za-z]:[\\/]/u.test(path) || /^\\\\/u.test(path);
}

function aliasAbsolutePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const extension = extname(normalized).slice(0, 16).replace(/[^A-Za-z0-9.]/g, "");
  return `project://absolute-path${extension}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F]/u.test(value);
}

function isUnsafeKey(key: string, extraUnsafeTokens: readonly string[]): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [...UNSAFE_KEY_TOKENS, ...extraUnsafeTokens].some((token) => normalized.includes(token));
}

function isJsonObject(input: JsonValue): input is JsonObject {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
