import { execFile } from "node:child_process";

import type { AiSessionEvent } from "@firstrung/ai-session";
import type { JsonObject } from "@firstrung/schema";

export type VerificationCommandId =
  | "npm_test"
  | "npm_run_test"
  | "npm_run_check"
  | "pnpm_test"
  | "pnpm_run_check"
  | "pytest"
  | "cargo_test"
  | "git_status_short";

export interface VerificationCommandRunnerOptions {
  cwd: string;
  timeoutMs?: number | undefined;
}

export interface VerificationCommandRunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  errorCode?: string;
  timedOut?: boolean;
}

export type VerificationCommandRunner = (
  command: string,
  args: readonly string[],
  options: VerificationCommandRunnerOptions
) => Promise<VerificationCommandRunnerResult>;

export interface RunVerificationCommandOptions {
  commandId: VerificationCommandId | string;
  cwd: string;
  timeoutMs?: number;
  approvedCommandIds?: ReadonlySet<string> | readonly string[];
  now?: () => Date;
  commandRunner?: VerificationCommandRunner;
  projectId?: string;
  sessionId?: string;
}

export interface VerificationCommandResult {
  commandId: VerificationCommandId | string;
  status: "approved" | "denied" | "completed";
  exitCode?: number;
  errorCode?: string;
  summary: string;
  rawCommandOutputIncluded: false;
  events: AiSessionEvent[];
}

const COMMANDS: Record<VerificationCommandId, readonly [string, readonly string[]]> = {
  npm_test: ["npm", ["test"]],
  npm_run_test: ["npm", ["run", "test"]],
  npm_run_check: ["npm", ["run", "check"]],
  pnpm_test: ["pnpm", ["test"]],
  pnpm_run_check: ["pnpm", ["run", "check"]],
  pytest: ["python", ["-m", "pytest"]],
  cargo_test: ["cargo", ["test"]],
  git_status_short: ["git", ["status", "--short"]]
};

export function verificationCommandArgv(commandId: VerificationCommandId | string): { command: string; args: readonly string[] } {
  if (!isKnownCommandId(commandId)) {
    throw new Error(`Unknown FirstRung verification command: ${commandId}`);
  }

  const [command, args] = COMMANDS[commandId];
  return { command, args };
}

export async function runVerificationCommand(
  options: RunVerificationCommandOptions
): Promise<VerificationCommandResult> {
  const now = options.now ?? (() => new Date());
  const projectId = options.projectId ?? "project_unknown";
  const sessionId = options.sessionId ?? "session_verification";
  const events: AiSessionEvent[] = [
    makeEvent({
      index: 1,
      now,
      projectId,
      sessionId,
      type: "tool.call.requested",
      summary: `Verification command requested: ${options.commandId}.`,
      metadata: { commandId: options.commandId }
    })
  ];

  if (!isKnownCommandId(options.commandId)) {
    events.push(
      makeEvent({
        index: 2,
        now,
        projectId,
        sessionId,
        type: "tool.call.denied",
        summary: `Verification command denied: ${options.commandId}.`,
        metadata: { commandId: options.commandId, reason: "command id is not a FirstRung verification command" }
      })
    );

    return {
      commandId: options.commandId,
      status: "denied",
      summary: `${options.commandId} was denied because it is not a FirstRung verification command.`,
      rawCommandOutputIncluded: false,
      events
    };
  }

  if (!isApproved(options.commandId, options.approvedCommandIds)) {
    events.push(
      makeEvent({
        index: 2,
        now,
        projectId,
        sessionId,
        type: "tool.call.denied",
        summary: `Verification command denied: ${options.commandId}.`,
        metadata: { commandId: options.commandId, reason: "command id was not approved for this run" }
      })
    );

    return {
      commandId: options.commandId,
      status: "denied",
      summary: `${options.commandId} was denied because it was not approved for this run.`,
      rawCommandOutputIncluded: false,
      events
    };
  }

  const { command, args } = verificationCommandArgv(options.commandId);
  events.push(
    makeEvent({
      index: 2,
      now,
      projectId,
      sessionId,
      type: "tool.call.approved",
      summary: `Verification command approved: ${options.commandId}.`,
      metadata: { commandId: options.commandId, argv: [command, ...args] }
    }),
    makeEvent({
      index: 3,
      now,
      projectId,
      sessionId,
      type: "verification.command.started",
      summary: `Started verification command: ${options.commandId}.`,
      metadata: { commandId: options.commandId, argv: [command, ...args], cwd: options.cwd }
    })
  );

  const runner = options.commandRunner ?? execFileCommandRunner;
  const runResult = await runner(command, args, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs
  });
  const summary = summarizeCommand(options.commandId, runResult);
  events.push(
    makeEvent({
      index: 4,
      now,
      projectId,
      sessionId,
      type: "verification.command.completed",
      summary,
      metadata: {
        commandId: options.commandId,
        exitCode: runResult.exitCode,
        rawCommandOutputIncluded: false,
        ...(runResult.errorCode ? { errorCode: runResult.errorCode } : {})
      }
    })
  );

  return {
    commandId: options.commandId,
    status: "completed",
    exitCode: runResult.exitCode,
    ...(runResult.errorCode ? { errorCode: runResult.errorCode } : {}),
    summary,
    rawCommandOutputIncluded: false,
    events
  };
}

function execFileCommandRunner(
  command: string,
  args: readonly string[],
  options: VerificationCommandRunnerOptions
): Promise<VerificationCommandRunnerResult> {
  return new Promise((resolveResult) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: 1024 * 256,
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs })
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolveResult({ exitCode: 0, stdout, stderr });
          return;
        }
        const timeout = isExecFileTimeout(error, options.timeoutMs);
        const errorCode =
          timeout ? "TIMEOUT" : typeof error.code === "string" ? error.code : undefined;

        resolveResult({
          exitCode: typeof error.code === "number" ? error.code : 1,
          stdout,
          stderr,
          ...(errorCode ? { errorCode } : {}),
          ...(timeout ? { timedOut: true } : {})
        });
      }
    );
  });
}

function isApproved(
  commandId: VerificationCommandId,
  approvedCommandIds?: ReadonlySet<string> | readonly string[]
): boolean {
  if (!approvedCommandIds) {
    return false;
  }

  if (isReadonlySet(approvedCommandIds)) {
    return approvedCommandIds.has(commandId);
  }

  return approvedCommandIds.includes(commandId);
}

function isReadonlySet(
  input: ReadonlySet<string> | readonly string[]
): input is ReadonlySet<string> {
  return typeof (input as ReadonlySet<string>).has === "function";
}

function summarizeCommand(commandId: VerificationCommandId, result: VerificationCommandRunnerResult): string {
  const errorCode = result.errorCode ? ` (${result.errorCode})` : "";
  if (isTimeoutResult(result)) {
    return `${commandId} timed out with exit code ${result.exitCode}${errorCode}`;
  }

  return `${commandId} completed with exit code ${result.exitCode}${errorCode}`;
}

function isTimeoutResult(result: VerificationCommandRunnerResult): boolean {
  return result.timedOut === true || result.errorCode === "TIMEOUT" || result.errorCode === "ETIMEDOUT";
}

function isExecFileTimeout(error: { killed?: boolean; signal?: string }, timeoutMs: number | undefined): boolean {
  return timeoutMs !== undefined && (error.killed === true || error.signal === "SIGTERM");
}

function isKnownCommandId(commandId: string): commandId is VerificationCommandId {
  return Object.prototype.hasOwnProperty.call(COMMANDS, commandId);
}

function makeEvent(input: {
  index: number;
  now: () => Date;
  projectId: string;
  sessionId: string;
  type: AiSessionEvent["type"];
  summary: string;
  metadata?: JsonObject;
}): AiSessionEvent {
  return {
    id: `event_${input.sessionId}_${input.index}`,
    projectId: input.projectId,
    sourceAdapter: "firstrung_pi_coach",
    observedAt: input.now().toISOString(),
    sessionId: input.sessionId,
    type: input.type,
    summary: input.summary,
    attribution: {
      kind: "agent_activity",
      confidence: "high",
      basis: ["FirstRung verification runner event"]
    },
    rawPromptIncluded: false,
    rawResponseIncluded: false,
    rawCommandOutputIncluded: false,
    rawSourceIncluded: false,
    rawDiffIncluded: false,
    redactionLevel: "redacted",
    ...(input.metadata ? { metadata: input.metadata } : {})
  };
}
