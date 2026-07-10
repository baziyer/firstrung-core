import {
  SchemaValidationError,
  parseContributionAttribution,
  parseEvidenceSignal,
  type ContributionAttribution,
  type EvidenceReference,
  type EvidenceSignal,
  type JsonObject,
  type JsonValue
} from "@firstrung/schema";

export type AiSessionEventType =
  | "session.started"
  | "session.ended"
  | "coach.prompt.submitted"
  | "model.response.summarized"
  | "tool.call.requested"
  | "tool.call.approved"
  | "tool.call.denied"
  | "verification.command.started"
  | "verification.command.completed"
  | "coach.feedback.generated"
  | "candidate.reflection.captured";

export type RawDataDisclosure = "none" | "redacted" | "selected";

export interface AiSessionRawDisclosure {
  rawPromptIncluded: boolean;
  rawResponseIncluded: boolean;
  rawCommandOutputIncluded: boolean;
  rawSourceIncluded: boolean;
  rawDiffIncluded: boolean;
  redactionLevel: RawDataDisclosure;
}

export interface AiSessionEvent extends AiSessionRawDisclosure {
  id: string;
  projectId: string;
  sourceAdapter: string;
  observedAt: string;
  sessionId: string;
  type: AiSessionEventType;
  summary: string;
  attribution: ContributionAttribution;
  refs?: EvidenceReference[];
  metadata?: JsonObject;
}

const aiSessionEventTypes = [
  "session.started",
  "session.ended",
  "coach.prompt.submitted",
  "model.response.summarized",
  "tool.call.requested",
  "tool.call.approved",
  "tool.call.denied",
  "verification.command.started",
  "verification.command.completed",
  "coach.feedback.generated",
  "candidate.reflection.captured"
] as const;

const rawDataDisclosures = ["none", "redacted", "selected"] as const;
const unsafeMetadataKeyTokens = [
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
  "env",
  "delta",
  "content",
  "message",
  "result"
] as const;
const unsafeMetadataExactKeys = ["log", "text"] as const;

export function parseAiSessionEvent(input: unknown): AiSessionEvent {
  const value = object(input, "AiSessionEvent");
  const refs = optionalArray(value.refs, "AiSessionEvent.refs", parseEvidenceReference);
  const metadata = optionalJsonObject(value.metadata, "AiSessionEvent.metadata");

  return {
    id: string(value.id, "AiSessionEvent.id"),
    projectId: string(value.projectId, "AiSessionEvent.projectId"),
    sourceAdapter: string(value.sourceAdapter, "AiSessionEvent.sourceAdapter"),
    observedAt: string(value.observedAt, "AiSessionEvent.observedAt"),
    sessionId: string(value.sessionId, "AiSessionEvent.sessionId"),
    type: oneOf(value.type, aiSessionEventTypes, "AiSessionEvent.type"),
    summary: string(value.summary, "AiSessionEvent.summary"),
    attribution: parseContributionAttribution(value.attribution),
    rawPromptIncluded: optionalBoolean(value.rawPromptIncluded, "AiSessionEvent.rawPromptIncluded") ?? false,
    rawResponseIncluded: optionalBoolean(value.rawResponseIncluded, "AiSessionEvent.rawResponseIncluded") ?? false,
    rawCommandOutputIncluded:
      optionalBoolean(value.rawCommandOutputIncluded, "AiSessionEvent.rawCommandOutputIncluded") ?? false,
    rawSourceIncluded: optionalBoolean(value.rawSourceIncluded, "AiSessionEvent.rawSourceIncluded") ?? false,
    rawDiffIncluded: optionalBoolean(value.rawDiffIncluded, "AiSessionEvent.rawDiffIncluded") ?? false,
    redactionLevel:
      value.redactionLevel === undefined
        ? "none"
        : oneOf(value.redactionLevel, rawDataDisclosures, "AiSessionEvent.redactionLevel"),
    ...defined({ refs, metadata })
  };
}

export function parseAiSessionEvents(input: unknown): AiSessionEvent[] {
  return array(input, "AiSessionEvents", parseAiSessionEvent);
}

export function aiSessionEventsToEvidenceSignals(events: AiSessionEvent[]): EvidenceSignal[] {
  const parsedEvents = parseAiSessionEvents(events);
  assertUniqueEventIds(parsedEvents);

  return parsedEvents.map((event) =>
    parseEvidenceSignal({
      id: `signal_${event.id}`,
      projectId: event.projectId,
      source: "ai_session",
      signalType: signalTypeForEvent(event.type),
      observedAt: event.observedAt,
      summary: event.summary,
      sourceEventIds: [event.id],
      attribution: event.attribution,
      confidence: event.attribution.confidence,
      ...defined({ refs: event.refs }),
      data: {
        sourceAdapter: event.sourceAdapter,
        sessionId: event.sessionId,
        eventType: event.type,
        rawPromptIncluded: event.rawPromptIncluded,
        rawResponseIncluded: event.rawResponseIncluded,
        rawCommandOutputIncluded: event.rawCommandOutputIncluded,
        rawSourceIncluded: event.rawSourceIncluded,
        rawDiffIncluded: event.rawDiffIncluded,
        redactionLevel: event.redactionLevel,
        ...defined({ metadata: event.metadata })
      }
    })
  );
}

function signalTypeForEvent(type: AiSessionEventType): string {
  if (type === "verification.command.completed") {
    return "ai_session.verification.completed";
  }

  if (type === "coach.feedback.generated") {
    return "ai_session.coach.feedback.generated";
  }

  if (type === "candidate.reflection.captured") {
    return "ai_session.candidate.reflection.captured";
  }

  return `ai_session.${type}`;
}

function assertUniqueEventIds(events: AiSessionEvent[]): void {
  const seen = new Set<string>();

  for (const event of events) {
    if (seen.has(event.id)) {
      throw new SchemaValidationError(
        `Duplicate AiSessionEvent id "${event.id}" cannot be converted to EvidenceSignal records; event IDs must be unique`
      );
    }

    seen.add(event.id);
  }
}

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

function optionalArray<T>(input: unknown, path: string, parseItem: (item: unknown) => T): T[] | undefined {
  if (input === undefined) {
    return undefined;
  }

  return array(input, path, parseItem);
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
    typeof input === "boolean"
  ) {
    return;
  }

  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new SchemaValidationError(`${path} must be a finite number`);
    }

    return;
  }

  if (Array.isArray(input)) {
    input.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }

  if (typeof input === "object") {
    if (!isPlainObject(input)) {
      throw new SchemaValidationError(`${path} must be a plain JSON object`);
    }

    Object.entries(input as Record<string, unknown>).forEach(([key, value]) => {
      if (path.startsWith("AiSessionEvent.metadata") && isUnsafeMetadataKey(key)) {
        throw new SchemaValidationError(
          `AiSessionEvent.metadata must not include raw content fields; unsafe key at ${path}.${key}`
        );
      }

      assertJsonValue(value, `${path}.${key}`);
    });
    return;
  }

  throw new SchemaValidationError(`${path} must contain only JSON-compatible values`);
}

function isUnsafeMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    (unsafeMetadataExactKeys as readonly string[]).includes(normalized) ||
    unsafeMetadataKeyTokens.some((token) => normalized.includes(token))
  );
}

function isPlainObject(input: object): boolean {
  return Object.getPrototypeOf(input) === Object.prototype;
}

function defined<T extends Record<string, unknown>>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
