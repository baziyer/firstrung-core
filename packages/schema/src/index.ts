export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type EvidenceSource =
  | "git"
  | "filesystem"
  | "ai_session"
  | "candidate_reflection"
  | "reviewer"
  | "integration"
  | "manual";

export type AttributionKind =
  | "change_window"
  | "candidate_contributed"
  | "pre_existing"
  | "agent_activity"
  | "candidate_reflection"
  | "external_reviewer"
  | "unknown";

export type Confidence = "low" | "medium" | "high";

export type EvidenceTier =
  | "observed"
  | "verified"
  | "operated"
  | "repeated"
  | "attested"
  | "outcome_linked";

export const SCAN_SCHEMA_VERSION = "firstrung.scan.v1";
export const FEEDBACK_PACKET_SCHEMA_VERSION = "firstrung.feedback.v1";

export interface TimeWindow {
  startedAt?: string;
  endedAt?: string;
}

export interface EvidenceReference {
  kind: "commit" | "file" | "command" | "session" | "reflection" | "receipt" | "external";
  label: string;
  locator?: string;
  redacted?: boolean;
}

export interface ContributionAttribution {
  kind: AttributionKind;
  confidence: Confidence;
  basis: string[];
  actor?: string;
  timeWindow?: TimeWindow;
}

export interface Project {
  id: string;
  name: string;
  createdAt?: string;
  repoPath?: string;
  refs?: EvidenceReference[];
  metadata?: JsonObject;
}

export interface CollectorEvent {
  id: string;
  projectId: string;
  source: EvidenceSource;
  type: string;
  observedAt: string;
  summary: string;
  rawContentIncluded: boolean;
  refs?: EvidenceReference[];
  metadata?: JsonObject;
}

export interface EvidenceSignal {
  id: string;
  projectId: string;
  source: EvidenceSource;
  signalType: string;
  observedAt: string;
  summary: string;
  sourceEventIds: string[];
  attribution: ContributionAttribution;
  confidence: Confidence;
  refs?: EvidenceReference[];
  data?: JsonObject;
}

export interface RuleDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  appliesTo: string[];
  requiredSignals?: string[];
  attributionRequired?: AttributionKind[];
  evidenceTierImpact?: EvidenceTier[];
  feedbackTemplates?: {
    matched?: string;
    missingEvidence?: string;
    nextStep?: string;
  };
}

export interface RuleResult {
  id: string;
  ruleId: string;
  projectId: string;
  evaluatedAt: string;
  matched: boolean;
  confidence: Confidence;
  matchedSignalIds: string[];
  attribution: ContributionAttribution;
  evidenceTierImpact?: EvidenceTier[];
  feedback?: {
    summary: string;
    missingEvidence?: string[];
    nextStep?: string;
  };
}

export interface SkillEpisode {
  id: string;
  projectId: string;
  type: string;
  title: string;
  status: "candidate" | "accepted" | "dismissed";
  evidenceTier: EvidenceTier[];
  confidence: Confidence;
  supportingSignalIds: string[];
  attribution: ContributionAttribution;
  ruleResultIds?: string[];
}

export interface FeedbackItem {
  id: string;
  projectId: string;
  type: "strength" | "gap" | "next_step" | "attribution_note";
  summary: string;
  generatedAt: string;
  ruleResultId?: string;
  skillEpisodeId?: string;
  attribution?: ContributionAttribution;
  refs?: EvidenceReference[];
}

export interface CandidateReflection {
  id: string;
  projectId: string;
  createdAt: string;
  summary: string;
  rawPromptIncluded: boolean;
  rawResponseIncluded: boolean;
  refs?: EvidenceReference[];
  metadata?: JsonObject;
}

export interface ProfileExport {
  id: string;
  projectId: string;
  generatedAt: string;
  skillEpisodeIds: string[];
  feedbackItemIds: string[];
  rawDataDisclosure: "none" | "redacted" | "selected";
  excludedDataNotice: string;
  refs?: EvidenceReference[];
  metadata?: JsonObject;
}

export interface EvidenceReceipt {
  id: string;
  projectId: string;
  skillEpisodeId: string;
  generatedAt: string;
  evidenceTier: EvidenceTier[];
  supportingSignalIds: string[];
  attributionSummary: ContributionAttribution;
  rawDataDisclosure: "none" | "redacted" | "selected";
  excludedDataNotice: string;
  signature?: string;
}

export interface ScanSummary {
  projectId: string;
  projectName: string;
  requestedPath: string;
  repoRoot: string;
  currentBranch: string;
  targetRef: string;
  targetCommit: string;
  baselineRef?: string;
  attributionMode: "since" | "working_tree" | "branch" | "unknown";
  attributionReason: string;
  changedFileCount: number;
  trackedFileCount: number;
  rawContentIncluded: boolean;
}

export interface ScanProvenance {
  schemaVersion: string;
  rulesetVersion: string;
  templateVersion: string;
  rendererVersion: string;
}

export interface ScanArtifact {
  provenance: ScanProvenance;
  summary: ScanSummary;
  signals: EvidenceSignal[];
  rules: RuleResult[];
  episodes: SkillEpisode[];
}

export type FeedbackAccuracy = "accurate" | "partly_accurate" | "wrong";
export type FeedbackReason = "too_wordy" | "generic" | "irrelevant" | "already_known" | "infeasible";
export type FeedbackActionStatus = "acted" | "planned" | "ignored" | "not_applicable";
export type FeedbackSurface = "terminal" | "markdown" | "coach";

export interface LocalFeedbackPacket {
  kind: "firstrung.feedback.preview.v1";
  transport: "local_preview";
  schemaVersion: string;
  rulesetVersion: string;
  templateVersion: string;
  rendererVersion: string;
  surface: FeedbackSurface;
  accuracy: FeedbackAccuracy;
  helpfulness: 1 | 2 | 3 | 4 | 5;
  reasons: FeedbackReason[];
  actionStatus: FeedbackActionStatus;
  ruleIds: string[];
}

export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

export function parseCollectorEvent(input: unknown): CollectorEvent {
  const value = object(input, "CollectorEvent");
  const refs = optionalArray(value.refs, "CollectorEvent.refs", parseEvidenceReference);
  const metadata = optionalJsonObject(value.metadata, "CollectorEvent.metadata");

  return {
    id: string(value.id, "CollectorEvent.id"),
    projectId: string(value.projectId, "CollectorEvent.projectId"),
    source: oneOf(value.source, evidenceSources, "CollectorEvent.source"),
    type: string(value.type, "CollectorEvent.type"),
    observedAt: string(value.observedAt, "CollectorEvent.observedAt"),
    summary: string(value.summary, "CollectorEvent.summary"),
    rawContentIncluded: boolean(value.rawContentIncluded, "CollectorEvent.rawContentIncluded"),
    ...defined({ refs, metadata })
  };
}

export function parseContributionAttribution(input: unknown): ContributionAttribution {
  const value = object(input, "ContributionAttribution");
  const actor = optionalString(value.actor, "ContributionAttribution.actor");
  const timeWindow = optionalTimeWindow(value.timeWindow, "ContributionAttribution.timeWindow");

  return {
    kind: oneOf(value.kind, attributionKinds, "ContributionAttribution.kind"),
    confidence: oneOf(value.confidence, confidenceValues, "ContributionAttribution.confidence"),
    basis: stringArray(value.basis, "ContributionAttribution.basis"),
    ...defined({ actor, timeWindow })
  };
}

export function parseProject(input: unknown): Project {
  const value = object(input, "Project");
  const createdAt = optionalString(value.createdAt, "Project.createdAt");
  const repoPath = optionalString(value.repoPath, "Project.repoPath");
  const refs = optionalArray(value.refs, "Project.refs", parseEvidenceReference);
  const metadata = optionalJsonObject(value.metadata, "Project.metadata");

  return {
    id: string(value.id, "Project.id"),
    name: string(value.name, "Project.name"),
    ...defined({ createdAt, repoPath, refs, metadata })
  };
}

export function parseEvidenceSignal(input: unknown): EvidenceSignal {
  const value = object(input, "EvidenceSignal");
  const refs = optionalArray(value.refs, "EvidenceSignal.refs", parseEvidenceReference);
  const data = optionalJsonObject(value.data, "EvidenceSignal.data");

  return {
    id: string(value.id, "EvidenceSignal.id"),
    projectId: string(value.projectId, "EvidenceSignal.projectId"),
    source: oneOf(value.source, evidenceSources, "EvidenceSignal.source"),
    signalType: string(value.signalType, "EvidenceSignal.signalType"),
    observedAt: string(value.observedAt, "EvidenceSignal.observedAt"),
    summary: string(value.summary, "EvidenceSignal.summary"),
    sourceEventIds: stringArray(value.sourceEventIds, "EvidenceSignal.sourceEventIds"),
    attribution: parseContributionAttribution(value.attribution),
    confidence: oneOf(value.confidence, confidenceValues, "EvidenceSignal.confidence"),
    ...defined({ refs, data })
  };
}

export function parseRuleDefinition(input: unknown): RuleDefinition {
  const value = object(input, "RuleDefinition");
  const requiredSignals = optionalStringArray(value.requiredSignals, "RuleDefinition.requiredSignals");
  const attributionRequired = optionalEnumArray(
    value.attributionRequired,
    attributionKinds,
    "RuleDefinition.attributionRequired"
  );
  const evidenceTierImpact = optionalEnumArray(
    value.evidenceTierImpact,
    evidenceTiers,
    "RuleDefinition.evidenceTierImpact"
  );
  const feedbackTemplates = optionalFeedbackTemplates(value.feedbackTemplates);

  return {
    id: string(value.id, "RuleDefinition.id"),
    name: string(value.name, "RuleDefinition.name"),
    version: string(value.version, "RuleDefinition.version"),
    description: string(value.description, "RuleDefinition.description"),
    appliesTo: stringArray(value.appliesTo, "RuleDefinition.appliesTo"),
    ...defined({ requiredSignals, attributionRequired, evidenceTierImpact, feedbackTemplates })
  };
}

export function parseRuleResult(input: unknown): RuleResult {
  const value = object(input, "RuleResult");
  const evidenceTierImpact = optionalEnumArray(value.evidenceTierImpact, evidenceTiers, "RuleResult.evidenceTierImpact");
  const feedback = optionalFeedback(value.feedback);

  return {
    id: string(value.id, "RuleResult.id"),
    ruleId: string(value.ruleId, "RuleResult.ruleId"),
    projectId: string(value.projectId, "RuleResult.projectId"),
    evaluatedAt: string(value.evaluatedAt, "RuleResult.evaluatedAt"),
    matched: boolean(value.matched, "RuleResult.matched"),
    confidence: oneOf(value.confidence, confidenceValues, "RuleResult.confidence"),
    matchedSignalIds: stringArray(value.matchedSignalIds, "RuleResult.matchedSignalIds"),
    attribution: parseContributionAttribution(value.attribution),
    ...defined({ evidenceTierImpact, feedback })
  };
}

export function parseSkillEpisode(input: unknown): SkillEpisode {
  const value = object(input, "SkillEpisode");
  const ruleResultIds = optionalStringArray(value.ruleResultIds, "SkillEpisode.ruleResultIds");

  return {
    id: string(value.id, "SkillEpisode.id"),
    projectId: string(value.projectId, "SkillEpisode.projectId"),
    type: string(value.type, "SkillEpisode.type"),
    title: string(value.title, "SkillEpisode.title"),
    status: oneOf(value.status, ["candidate", "accepted", "dismissed"] as const, "SkillEpisode.status"),
    evidenceTier: enumArray(value.evidenceTier, evidenceTiers, "SkillEpisode.evidenceTier"),
    confidence: oneOf(value.confidence, confidenceValues, "SkillEpisode.confidence"),
    supportingSignalIds: stringArray(value.supportingSignalIds, "SkillEpisode.supportingSignalIds"),
    attribution: parseContributionAttribution(value.attribution),
    ...defined({ ruleResultIds })
  };
}

export function parseFeedbackItem(input: unknown): FeedbackItem {
  const value = object(input, "FeedbackItem");
  const ruleResultId = optionalString(value.ruleResultId, "FeedbackItem.ruleResultId");
  const skillEpisodeId = optionalString(value.skillEpisodeId, "FeedbackItem.skillEpisodeId");
  const attribution =
    value.attribution === undefined ? undefined : parseContributionAttribution(value.attribution);
  const refs = optionalArray(value.refs, "FeedbackItem.refs", parseEvidenceReference);

  return {
    id: string(value.id, "FeedbackItem.id"),
    projectId: string(value.projectId, "FeedbackItem.projectId"),
    type: oneOf(
      value.type,
      ["strength", "gap", "next_step", "attribution_note"] as const,
      "FeedbackItem.type"
    ),
    summary: string(value.summary, "FeedbackItem.summary"),
    generatedAt: string(value.generatedAt, "FeedbackItem.generatedAt"),
    ...defined({ ruleResultId, skillEpisodeId, attribution, refs })
  };
}

export function parseCandidateReflection(input: unknown): CandidateReflection {
  const value = object(input, "CandidateReflection");
  const refs = optionalArray(value.refs, "CandidateReflection.refs", parseEvidenceReference);
  const metadata = optionalJsonObject(value.metadata, "CandidateReflection.metadata");

  return {
    id: string(value.id, "CandidateReflection.id"),
    projectId: string(value.projectId, "CandidateReflection.projectId"),
    createdAt: string(value.createdAt, "CandidateReflection.createdAt"),
    summary: string(value.summary, "CandidateReflection.summary"),
    rawPromptIncluded: boolean(value.rawPromptIncluded, "CandidateReflection.rawPromptIncluded"),
    rawResponseIncluded: boolean(value.rawResponseIncluded, "CandidateReflection.rawResponseIncluded"),
    ...defined({ refs, metadata })
  };
}

export function parseProfileExport(input: unknown): ProfileExport {
  const value = object(input, "ProfileExport");
  const refs = optionalArray(value.refs, "ProfileExport.refs", parseEvidenceReference);
  const metadata = optionalJsonObject(value.metadata, "ProfileExport.metadata");

  return {
    id: string(value.id, "ProfileExport.id"),
    projectId: string(value.projectId, "ProfileExport.projectId"),
    generatedAt: string(value.generatedAt, "ProfileExport.generatedAt"),
    skillEpisodeIds: stringArray(value.skillEpisodeIds, "ProfileExport.skillEpisodeIds"),
    feedbackItemIds: stringArray(value.feedbackItemIds, "ProfileExport.feedbackItemIds"),
    rawDataDisclosure: oneOf(
      value.rawDataDisclosure,
      ["none", "redacted", "selected"] as const,
      "ProfileExport.rawDataDisclosure"
    ),
    excludedDataNotice: string(value.excludedDataNotice, "ProfileExport.excludedDataNotice"),
    ...defined({ refs, metadata })
  };
}

export function parseEvidenceReceipt(input: unknown): EvidenceReceipt {
  const value = object(input, "EvidenceReceipt");
  const signature = optionalString(value.signature, "EvidenceReceipt.signature");

  return {
    id: string(value.id, "EvidenceReceipt.id"),
    projectId: string(value.projectId, "EvidenceReceipt.projectId"),
    skillEpisodeId: string(value.skillEpisodeId, "EvidenceReceipt.skillEpisodeId"),
    generatedAt: string(value.generatedAt, "EvidenceReceipt.generatedAt"),
    evidenceTier: enumArray(value.evidenceTier, evidenceTiers, "EvidenceReceipt.evidenceTier"),
    supportingSignalIds: stringArray(value.supportingSignalIds, "EvidenceReceipt.supportingSignalIds"),
    attributionSummary: parseContributionAttribution(value.attributionSummary),
    rawDataDisclosure: oneOf(
      value.rawDataDisclosure,
      ["none", "redacted", "selected"] as const,
      "EvidenceReceipt.rawDataDisclosure"
    ),
    excludedDataNotice: string(value.excludedDataNotice, "EvidenceReceipt.excludedDataNotice"),
    ...defined({ signature })
  };
}

export function parseScanSummary(input: unknown): ScanSummary {
  const value = object(input, "ScanSummary");
  const baselineRef = optionalString(value.baselineRef, "ScanSummary.baselineRef");

  return {
    projectId: string(value.projectId, "ScanSummary.projectId"),
    projectName: string(value.projectName, "ScanSummary.projectName"),
    requestedPath: string(value.requestedPath, "ScanSummary.requestedPath"),
    repoRoot: string(value.repoRoot, "ScanSummary.repoRoot"),
    currentBranch: string(value.currentBranch, "ScanSummary.currentBranch"),
    targetRef: string(value.targetRef, "ScanSummary.targetRef"),
    targetCommit: string(value.targetCommit, "ScanSummary.targetCommit"),
    ...defined({ baselineRef }),
    attributionMode: oneOf(
      value.attributionMode,
      ["since", "working_tree", "branch", "unknown"] as const,
      "ScanSummary.attributionMode"
    ),
    attributionReason: string(value.attributionReason, "ScanSummary.attributionReason"),
    changedFileCount: number(value.changedFileCount, "ScanSummary.changedFileCount"),
    trackedFileCount: number(value.trackedFileCount, "ScanSummary.trackedFileCount"),
    rawContentIncluded: boolean(value.rawContentIncluded, "ScanSummary.rawContentIncluded")
  };
}

export function parseScanArtifact(input: unknown): ScanArtifact {
  const value = object(input, "ScanArtifact");

  return {
    provenance: parseScanProvenance(value.provenance),
    summary: parseScanSummary(value.summary),
    signals: array(value.signals, "ScanArtifact.signals", parseEvidenceSignal),
    rules: array(value.rules, "ScanArtifact.rules", parseRuleResult),
    episodes: array(value.episodes, "ScanArtifact.episodes", parseSkillEpisode)
  };
}

export function parseScanProvenance(input: unknown): ScanProvenance {
  const value = object(input, "ScanProvenance");

  return {
    schemaVersion: string(value.schemaVersion, "ScanProvenance.schemaVersion"),
    rulesetVersion: string(value.rulesetVersion, "ScanProvenance.rulesetVersion"),
    templateVersion: string(value.templateVersion, "ScanProvenance.templateVersion"),
    rendererVersion: string(value.rendererVersion, "ScanProvenance.rendererVersion")
  };
}

export function parseLocalFeedbackPacket(input: unknown): LocalFeedbackPacket {
  const value = object(input, "LocalFeedbackPacket");
  const helpfulness = number(value.helpfulness, "LocalFeedbackPacket.helpfulness");

  if (![1, 2, 3, 4, 5].includes(helpfulness)) {
    throw new SchemaValidationError("LocalFeedbackPacket.helpfulness must be an integer from 1 to 5");
  }

  return {
    kind: oneOf(value.kind, ["firstrung.feedback.preview.v1"] as const, "LocalFeedbackPacket.kind"),
    transport: oneOf(value.transport, ["local_preview"] as const, "LocalFeedbackPacket.transport"),
    schemaVersion: string(value.schemaVersion, "LocalFeedbackPacket.schemaVersion"),
    rulesetVersion: string(value.rulesetVersion, "LocalFeedbackPacket.rulesetVersion"),
    templateVersion: string(value.templateVersion, "LocalFeedbackPacket.templateVersion"),
    rendererVersion: string(value.rendererVersion, "LocalFeedbackPacket.rendererVersion"),
    surface: oneOf(value.surface, ["terminal", "markdown", "coach"] as const, "LocalFeedbackPacket.surface"),
    accuracy: oneOf(
      value.accuracy,
      ["accurate", "partly_accurate", "wrong"] as const,
      "LocalFeedbackPacket.accuracy"
    ),
    helpfulness: helpfulness as LocalFeedbackPacket["helpfulness"],
    reasons: enumArray(
      value.reasons,
      ["too_wordy", "generic", "irrelevant", "already_known", "infeasible"] as const,
      "LocalFeedbackPacket.reasons"
    ),
    actionStatus: oneOf(
      value.actionStatus,
      ["acted", "planned", "ignored", "not_applicable"] as const,
      "LocalFeedbackPacket.actionStatus"
    ),
    ruleIds: stringArray(value.ruleIds, "LocalFeedbackPacket.ruleIds")
  };
}

const evidenceSources = [
  "git",
  "filesystem",
  "ai_session",
  "candidate_reflection",
  "reviewer",
  "integration",
  "manual"
] as const;

const attributionKinds = [
  "change_window",
  "candidate_contributed",
  "pre_existing",
  "agent_activity",
  "candidate_reflection",
  "external_reviewer",
  "unknown"
] as const;

const confidenceValues = ["low", "medium", "high"] as const;

const evidenceTiers = ["observed", "verified", "operated", "repeated", "attested", "outcome_linked"] as const;

function parseEvidenceReference(input: unknown): EvidenceReference {
  const value = object(input, "EvidenceReference");
  const locator = optionalString(value.locator, "EvidenceReference.locator");
  const redacted = optionalBoolean(value.redacted, "EvidenceReference.redacted");

  return {
    kind: oneOf(
      value.kind,
      ["commit", "file", "command", "session", "reflection", "receipt", "external"] as const,
      "EvidenceReference.kind"
    ),
    label: string(value.label, "EvidenceReference.label"),
    ...defined({ locator, redacted })
  };
}

function object(input: unknown, path: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SchemaValidationError(`${path} must be an object`);
  }

  return input as Record<string, unknown>;
}

function string(input: unknown, path: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new SchemaValidationError(`${path} must be a non-empty string`);
  }

  return input;
}

function number(input: unknown, path: string): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    throw new SchemaValidationError(`${path} must be a finite number`);
  }

  return input;
}

function optionalString(input: unknown, path: string): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  return string(input, path);
}

function boolean(input: unknown, path: string): boolean {
  if (typeof input !== "boolean") {
    throw new SchemaValidationError(`${path} must be a boolean`);
  }

  return input;
}

function optionalBoolean(input: unknown, path: string): boolean | undefined {
  if (input === undefined) {
    return undefined;
  }

  return boolean(input, path);
}

function oneOf<const T extends readonly string[]>(input: unknown, allowed: T, path: string): T[number] {
  if (typeof input !== "string" || !allowed.includes(input)) {
    throw new SchemaValidationError(`${path} must be one of: ${allowed.join(", ")}`);
  }

  return input as T[number];
}

function stringArray(input: unknown, path: string): string[] {
  if (!Array.isArray(input) || input.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new SchemaValidationError(`${path} must be an array of non-empty strings`);
  }

  return input;
}

function optionalStringArray(input: unknown, path: string): string[] | undefined {
  if (input === undefined) {
    return undefined;
  }

  return stringArray(input, path);
}

function enumArray<const T extends readonly string[]>(input: unknown, allowed: T, path: string): T[number][] {
  if (!Array.isArray(input)) {
    throw new SchemaValidationError(`${path} must be an array`);
  }

  return input.map((item, index) => oneOf(item, allowed, `${path}[${index}]`));
}

function optionalEnumArray<const T extends readonly string[]>(
  input: unknown,
  allowed: T,
  path: string
): T[number][] | undefined {
  if (input === undefined) {
    return undefined;
  }

  return enumArray(input, allowed, path);
}

function optionalArray<T>(input: unknown, path: string, parseItem: (item: unknown) => T): T[] | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!Array.isArray(input)) {
    throw new SchemaValidationError(`${path} must be an array`);
  }

  return input.map((item, index) => {
    try {
      return parseItem(item);
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw new SchemaValidationError(`${path}[${index}]: ${error.message}`);
      }

      throw error;
    }
  });
}

function array<T>(input: unknown, path: string, parseItem: (item: unknown) => T): T[] {
  if (!Array.isArray(input)) {
    throw new SchemaValidationError(`${path} must be an array`);
  }

  return input.map((item, index) => {
    try {
      return parseItem(item);
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw new SchemaValidationError(`${path}[${index}]: ${error.message}`);
      }

      throw error;
    }
  });
}

function optionalJsonObject(input: unknown, path: string): JsonObject | undefined {
  if (input === undefined) {
    return undefined;
  }

  assertJsonValue(input, path);

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SchemaValidationError(`${path} must be a JSON object`);
  }

  return input as JsonObject;
}

function assertJsonValue(input: unknown, path: string): asserts input is JsonValue {
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "boolean"
  ) {
    return;
  }

  if (Array.isArray(input)) {
    input.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }

  if (typeof input === "object") {
    Object.entries(input as Record<string, unknown>).forEach(([key, value]) => {
      assertJsonValue(value, `${path}.${key}`);
    });
    return;
  }

  throw new SchemaValidationError(`${path} must contain only JSON-compatible values`);
}

function optionalTimeWindow(input: unknown, path: string): TimeWindow | undefined {
  if (input === undefined) {
    return undefined;
  }

  const value = object(input, path);
  const startedAt = optionalString(value.startedAt, `${path}.startedAt`);
  const endedAt = optionalString(value.endedAt, `${path}.endedAt`);

  return defined({ startedAt, endedAt });
}

function optionalFeedbackTemplates(input: unknown): RuleDefinition["feedbackTemplates"] {
  if (input === undefined) {
    return undefined;
  }

  const value = object(input, "RuleDefinition.feedbackTemplates");
  const matched = optionalString(value.matched, "RuleDefinition.feedbackTemplates.matched");
  const missingEvidence = optionalString(value.missingEvidence, "RuleDefinition.feedbackTemplates.missingEvidence");
  const nextStep = optionalString(value.nextStep, "RuleDefinition.feedbackTemplates.nextStep");

  return defined({ matched, missingEvidence, nextStep });
}

function optionalFeedback(input: unknown): RuleResult["feedback"] {
  if (input === undefined) {
    return undefined;
  }

  const value = object(input, "RuleResult.feedback");
  const missingEvidence = optionalStringArray(value.missingEvidence, "RuleResult.feedback.missingEvidence");
  const nextStep = optionalString(value.nextStep, "RuleResult.feedback.nextStep");

  return {
    summary: string(value.summary, "RuleResult.feedback.summary"),
    ...defined({ missingEvidence, nextStep })
  };
}

function defined<T extends Record<string, unknown>>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
