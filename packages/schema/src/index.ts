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

export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

export function parseCollectorEvent(input: unknown): CollectorEvent {
  const value = object(input, "CollectorEvent");

  return {
    id: string(value.id, "CollectorEvent.id"),
    projectId: string(value.projectId, "CollectorEvent.projectId"),
    source: oneOf(value.source, evidenceSources, "CollectorEvent.source"),
    type: string(value.type, "CollectorEvent.type"),
    observedAt: string(value.observedAt, "CollectorEvent.observedAt"),
    summary: string(value.summary, "CollectorEvent.summary"),
    rawContentIncluded: boolean(value.rawContentIncluded, "CollectorEvent.rawContentIncluded"),
    refs: optionalArray(value.refs, "CollectorEvent.refs", parseEvidenceReference),
    metadata: optionalJsonObject(value.metadata, "CollectorEvent.metadata")
  };
}

export function parseContributionAttribution(input: unknown): ContributionAttribution {
  const value = object(input, "ContributionAttribution");

  return {
    kind: oneOf(value.kind, attributionKinds, "ContributionAttribution.kind"),
    confidence: oneOf(value.confidence, confidenceValues, "ContributionAttribution.confidence"),
    basis: stringArray(value.basis, "ContributionAttribution.basis"),
    actor: optionalString(value.actor, "ContributionAttribution.actor"),
    timeWindow: optionalTimeWindow(value.timeWindow, "ContributionAttribution.timeWindow")
  };
}

export function parseEvidenceSignal(input: unknown): EvidenceSignal {
  const value = object(input, "EvidenceSignal");

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
    refs: optionalArray(value.refs, "EvidenceSignal.refs", parseEvidenceReference),
    data: optionalJsonObject(value.data, "EvidenceSignal.data")
  };
}

export function parseRuleDefinition(input: unknown): RuleDefinition {
  const value = object(input, "RuleDefinition");

  return {
    id: string(value.id, "RuleDefinition.id"),
    name: string(value.name, "RuleDefinition.name"),
    version: string(value.version, "RuleDefinition.version"),
    description: string(value.description, "RuleDefinition.description"),
    appliesTo: stringArray(value.appliesTo, "RuleDefinition.appliesTo"),
    requiredSignals: optionalStringArray(value.requiredSignals, "RuleDefinition.requiredSignals"),
    attributionRequired: optionalEnumArray(
      value.attributionRequired,
      attributionKinds,
      "RuleDefinition.attributionRequired"
    ),
    evidenceTierImpact: optionalEnumArray(
      value.evidenceTierImpact,
      evidenceTiers,
      "RuleDefinition.evidenceTierImpact"
    ),
    feedbackTemplates: optionalFeedbackTemplates(value.feedbackTemplates)
  };
}

export function parseRuleResult(input: unknown): RuleResult {
  const value = object(input, "RuleResult");

  return {
    id: string(value.id, "RuleResult.id"),
    ruleId: string(value.ruleId, "RuleResult.ruleId"),
    projectId: string(value.projectId, "RuleResult.projectId"),
    evaluatedAt: string(value.evaluatedAt, "RuleResult.evaluatedAt"),
    matched: boolean(value.matched, "RuleResult.matched"),
    confidence: oneOf(value.confidence, confidenceValues, "RuleResult.confidence"),
    matchedSignalIds: stringArray(value.matchedSignalIds, "RuleResult.matchedSignalIds"),
    attribution: parseContributionAttribution(value.attribution),
    evidenceTierImpact: optionalEnumArray(value.evidenceTierImpact, evidenceTiers, "RuleResult.evidenceTierImpact"),
    feedback: optionalFeedback(value.feedback)
  };
}

export function parseSkillEpisode(input: unknown): SkillEpisode {
  const value = object(input, "SkillEpisode");

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
    ruleResultIds: optionalStringArray(value.ruleResultIds, "SkillEpisode.ruleResultIds")
  };
}

export function parseEvidenceReceipt(input: unknown): EvidenceReceipt {
  const value = object(input, "EvidenceReceipt");

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
    signature: optionalString(value.signature, "EvidenceReceipt.signature")
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

  return {
    kind: oneOf(
      value.kind,
      ["commit", "file", "command", "session", "reflection", "receipt", "external"] as const,
      "EvidenceReference.kind"
    ),
    label: string(value.label, "EvidenceReference.label"),
    locator: optionalString(value.locator, "EvidenceReference.locator"),
    redacted: optionalBoolean(value.redacted, "EvidenceReference.redacted")
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
  return {
    startedAt: optionalString(value.startedAt, `${path}.startedAt`),
    endedAt: optionalString(value.endedAt, `${path}.endedAt`)
  };
}

function optionalFeedbackTemplates(input: unknown): RuleDefinition["feedbackTemplates"] {
  if (input === undefined) {
    return undefined;
  }

  const value = object(input, "RuleDefinition.feedbackTemplates");
  return {
    matched: optionalString(value.matched, "RuleDefinition.feedbackTemplates.matched"),
    missingEvidence: optionalString(value.missingEvidence, "RuleDefinition.feedbackTemplates.missingEvidence"),
    nextStep: optionalString(value.nextStep, "RuleDefinition.feedbackTemplates.nextStep")
  };
}

function optionalFeedback(input: unknown): RuleResult["feedback"] {
  if (input === undefined) {
    return undefined;
  }

  const value = object(input, "RuleResult.feedback");
  return {
    summary: string(value.summary, "RuleResult.feedback.summary"),
    missingEvidence: optionalStringArray(value.missingEvidence, "RuleResult.feedback.missingEvidence"),
    nextStep: optionalString(value.nextStep, "RuleResult.feedback.nextStep")
  };
}
