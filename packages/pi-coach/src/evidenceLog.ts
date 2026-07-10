import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { JsonObject } from "@firstrung/schema";
import { appendSafeOwnedFile, ensureSafeOutputDirectory } from "./pathSafety.js";

export interface EvidenceLoggerOptions {
  sessionId: string;
  now?: () => Date;
}

export interface WorkspaceEvidenceLoggerOptions extends EvidenceLoggerOptions {
  repoPath?: string;
  outDir?: string;
  sessionDir?: string;
}

export interface EvidenceLogRecord {
  sessionId: string;
  observedAt: string;
  event: JsonObject;
}

export interface EvidenceLogger {
  readonly sessionId: string;
  readonly logPath?: string;
  log(event: unknown): Promise<EvidenceLogRecord>;
}

export interface InMemoryEvidenceLogger extends EvidenceLogger {
  readonly events: EvidenceLogRecord[];
}

export function createInMemoryEvidenceLogger(options: EvidenceLoggerOptions): InMemoryEvidenceLogger {
  const events: EvidenceLogRecord[] = [];
  const now = options.now ?? (() => new Date());

  return {
    sessionId: options.sessionId,
    events,
    async log(event: unknown) {
      const record = makeRecord(options.sessionId, now, event);
      events.push(record);
      return record;
    }
  };
}

export function createWorkspaceEvidenceLogger(options: WorkspaceEvidenceLoggerOptions): EvidenceLogger {
  if (!options.outDir && !options.repoPath) {
    throw new Error("createWorkspaceEvidenceLogger requires repoPath or outDir.");
  }

  const sessionId = validateSessionId(options.sessionId);
  const sessionDir = options.sessionDir ?? (options.outDir
    ? join(options.outDir, "sessions")
    : join(options.repoPath ?? "", ".firstrung", "coach", "sessions"));
  const logPath = join(sessionDir, `${sessionId}.jsonl`);
  const now = options.now ?? (() => new Date());

  return {
    sessionId,
    logPath,
    async log(event: unknown) {
      const record = makeRecord(sessionId, now, event);
      if (options.repoPath) {
        await ensureSafeOutputDirectory(options.repoPath, sessionDir);
        await appendSafeOwnedFile(options.repoPath, logPath, `${JSON.stringify(record)}\n`);
      } else {
        await mkdir(sessionDir, { recursive: true });
        await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
      }
      return record;
    }
  };
}

export function redactForEvidenceLog(input: unknown): JsonObject {
  if (!isRecord(input)) return { type: "unknown" };
  const assistantEvent = isRecord(input.assistantMessageEvent) ? input.assistantMessageEvent : undefined;
  return {
    type: safeEventName(input.type),
    ...(typeof input.toolName === "string" ? { toolName: safeEventName(input.toolName) } : {}),
    ...(typeof input.toolCallId === "string" ? { toolCallId: "tool_call_redacted" } : {}),
    ...(typeof input.isError === "boolean" ? { isError: input.isError } : {}),
    ...(typeof input.willRetry === "boolean" ? { willRetry: input.willRetry } : {}),
    ...(assistantEvent && typeof assistantEvent.type === "string"
      ? { assistantEventType: safeEventName(assistantEvent.type) }
      : {}),
    ...(input.error !== undefined ? { errorPresent: true } : {})
  };
}

function makeRecord(sessionId: string, now: () => Date, event: unknown): EvidenceLogRecord {
  return {
    sessionId,
    observedAt: now().toISOString(),
    event: redactForEvidenceLog(event)
  };
}

function safeEventName(input: unknown): string {
  return typeof input === "string" && /^[A-Za-z0-9._:-]{1,120}$/u.test(input) ? input : "unknown";
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function validateSessionId(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new Error("FirstRung Coach sessionId must contain only letters, numbers, underscores, and hyphens.");
  }

  return sessionId;
}
