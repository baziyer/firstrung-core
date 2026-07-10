#!/usr/bin/env node
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { collectRepository, CollectorError } from "@firstrung/collector";
import {
  REPORT_RENDERER_VERSION,
  renderTerminalSummary,
  writeReportArtifacts,
  type ReportFormat
} from "@firstrung/report";
import { ALPHA_RULESET_VERSION, ALPHA_TEMPLATE_VERSION, runAlphaRules } from "@firstrung/rules";
import {
  FEEDBACK_PACKET_SCHEMA_VERSION,
  SCAN_SCHEMA_VERSION,
  parseLocalFeedbackPacket,
  type FeedbackAccuracy,
  type FeedbackActionStatus,
  type FeedbackReason,
  type FeedbackSurface
} from "@firstrung/schema";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ScanOptions {
  repoPath: string;
  outDir?: string;
  since?: string;
  branch?: string;
  format: ReportFormat;
  debugArtifacts: boolean;
  explain: boolean;
}

interface FeedbackOptions {
  accuracy: FeedbackAccuracy;
  helpfulness: 1 | 2 | 3 | 4 | 5;
  reasons: FeedbackReason[];
  actionStatus: FeedbackActionStatus;
  surface: FeedbackSurface;
  ruleIds: string[];
}

interface DoctorOptions {
  repoPath?: string;
  installCheck: boolean;
}

interface DoctorCheck {
  status: "ok" | "warn" | "error";
  label: string;
  detail: string;
}

const REQUIRED_NODE_MAJOR = 22;
const REQUIRED_NODE_MINOR = 6;
export const CLI_STATIC_METADATA = Object.freeze({
  outputContract: "terminal-brief-v1",
  scanSchemaVersion: SCAN_SCHEMA_VERSION,
  feedbackPacketSchemaVersion: FEEDBACK_PACKET_SCHEMA_VERSION,
  rulesetVersion: ALPHA_RULESET_VERSION,
  templateVersion: ALPHA_TEMPLATE_VERSION,
  rendererVersion: REPORT_RENDERER_VERSION,
  defaultMaxNonblankLines: 5,
  defaultTargetMaxWords: 65
});
const scanUsage =
  "Usage: firstrung scan <repo> [--out <dir>] [--since <git-ref>] [--branch <name>] [--format summary|json|markdown|all] [--debug-artifacts] [--explain]";
const doctorUsage = "Usage: firstrung doctor [repo] [--install-check]";
const feedbackUsage =
  "Usage: firstrung feedback --accuracy accurate|partly_accurate|wrong --helpfulness 1-5 --action acted|planned|ignored|not_applicable [--reason too_wordy|generic|irrelevant|already_known|infeasible] [--surface terminal|markdown|coach] [--rule <rule_id>]";
const usage = `${scanUsage}\n${doctorUsage}\n${feedbackUsage}`;

export async function runCli(argv: string[]): Promise<CliResult> {
  try {
    const command = argv[0];

    if (command === "doctor") {
      return await runDoctor(parseDoctorArgs(argv.slice(1)));
    }

    if (command === "feedback") {
      return runFeedback(parseFeedbackArgs(argv.slice(1)));
    }

    if (command === "coach") {
      return errorResult(
        "FirstRung Coach is provided by the optional @firstrung/pi-coach package. Install and run: firstrung-coach coach <repo>"
      );
    }

    if (command !== "scan") {
      return errorResult(usage);
    }

    const options = parseScanArgs(argv.slice(1));
    const collection = await collectRepository({
      repoPath: options.repoPath,
      ...optional({
        since: options.since,
        branch: options.branch
      })
    });
    const rules = runAlphaRules({
      projectId: collection.summary.projectId,
      signals: collection.signals
    });
    const model = {
      provenance: {
        schemaVersion: CLI_STATIC_METADATA.scanSchemaVersion,
        rulesetVersion: CLI_STATIC_METADATA.rulesetVersion,
        templateVersion: CLI_STATIC_METADATA.templateVersion,
        rendererVersion: CLI_STATIC_METADATA.rendererVersion
      },
      summary: collection.summary,
      evidenceSignals: collection.signals,
      ruleResults: rules.ruleResults,
      skillEpisodes: rules.skillEpisodes
    };
    let stdout = renderTerminalSummary(model, { explain: options.explain });

    if (options.outDir) {
      const written = await writeReportArtifacts({
        outDir: options.outDir,
        format: options.format,
        debugArtifacts: options.debugArtifacts,
        ...model
      });
      stdout += `\n${renderWrittenFiles(written)}`;
    }

    return {
      exitCode: 0,
      stdout,
      stderr: ""
    };
  } catch (error) {
    if (error instanceof CliUsageError || error instanceof CollectorError) {
      return errorResult(error.message);
    }

    return errorResult(error instanceof Error ? error.message : "Unknown FirstRung CLI error.");
  }
}

function parseScanArgs(args: string[]): ScanOptions {
  const repoPath = args[0];

  if (!repoPath || repoPath.startsWith("-")) {
    throw new CliUsageError(scanUsage);
  }

  const options: ScanOptions = {
    repoPath,
    format: "summary",
    debugArtifacts: false,
    explain: false
  };

  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];

    if (flag === "--out") {
      options.outDir = requiredValue(args, index, flag);
      index += 1;
      continue;
    }

    if (flag === "--since") {
      options.since = requiredValue(args, index, flag);
      index += 1;
      continue;
    }

    if (flag === "--branch") {
      options.branch = requiredValue(args, index, flag);
      index += 1;
      continue;
    }

    if (flag === "--format") {
      options.format = parseFormat(requiredValue(args, index, flag));
      index += 1;
      continue;
    }

    if (flag === "--debug-artifacts") {
      options.debugArtifacts = true;
      continue;
    }

    if (flag === "--explain") {
      options.explain = true;
      continue;
    }

    throw new CliUsageError(`Unknown argument: ${flag}`);
  }

  if (!options.outDir && (options.format !== "summary" || options.debugArtifacts)) {
    throw new CliUsageError(
      "--format json, --format markdown, --format all, and --debug-artifacts require --out <dir>. Example: firstrung scan <repo> --out .firstrung/report --format markdown"
    );
  }

  return options;
}

function parseDoctorArgs(args: string[]): DoctorOptions {
  const options: DoctorOptions = {
    installCheck: false
  };

  for (const arg of args) {
    if (arg === "--install-check") {
      options.installCheck = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new CliUsageError(`Unknown argument: ${arg}\n${doctorUsage}`);
    }

    if (options.repoPath) {
      throw new CliUsageError(`Doctor accepts at most one repo path.\n${doctorUsage}`);
    }

    options.repoPath = arg;
  }

  return options;
}

function parseFeedbackArgs(args: string[]): FeedbackOptions {
  let accuracy: FeedbackAccuracy | undefined;
  let helpfulness: FeedbackOptions["helpfulness"] | undefined;
  let actionStatus: FeedbackActionStatus | undefined;
  let surface: FeedbackSurface = "terminal";
  const reasons: FeedbackReason[] = [];
  const ruleIds: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];

    if (flag === "--accuracy") {
      accuracy = parseFeedbackAccuracy(requiredValue(args, index, flag));
      index += 1;
      continue;
    }

    if (flag === "--helpfulness") {
      helpfulness = parseHelpfulness(requiredValue(args, index, flag));
      index += 1;
      continue;
    }

    if (flag === "--action") {
      actionStatus = parseFeedbackAction(requiredValue(args, index, flag));
      index += 1;
      continue;
    }

    if (flag === "--reason") {
      reasons.push(parseFeedbackReason(requiredValue(args, index, flag)));
      index += 1;
      continue;
    }

    if (flag === "--surface") {
      surface = parseFeedbackSurface(requiredValue(args, index, flag));
      index += 1;
      continue;
    }

    if (flag === "--rule") {
      ruleIds.push(parseRuleId(requiredValue(args, index, flag)));
      index += 1;
      continue;
    }

    throw new CliUsageError(`Unknown feedback argument: ${flag}\n${feedbackUsage}`);
  }

  if (!accuracy || helpfulness === undefined || !actionStatus) {
    throw new CliUsageError(feedbackUsage);
  }

  return {
    accuracy,
    helpfulness,
    actionStatus,
    surface,
    reasons: unique(reasons),
    ruleIds: unique(ruleIds)
  };
}

function parseFeedbackAccuracy(value: string): FeedbackAccuracy {
  if (value === "accurate" || value === "partly_accurate" || value === "wrong") {
    return value;
  }

  throw new CliUsageError("--accuracy must be accurate, partly_accurate, or wrong.");
}

function parseHelpfulness(value: string): FeedbackOptions["helpfulness"] {
  const parsed = Number(value);

  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 5) {
    return parsed as FeedbackOptions["helpfulness"];
  }

  throw new CliUsageError("--helpfulness must be an integer from 1 to 5.");
}

function parseFeedbackAction(value: string): FeedbackActionStatus {
  if (value === "acted" || value === "planned" || value === "ignored" || value === "not_applicable") {
    return value;
  }

  throw new CliUsageError("--action must be acted, planned, ignored, or not_applicable.");
}

function parseFeedbackReason(value: string): FeedbackReason {
  if (
    value === "too_wordy" ||
    value === "generic" ||
    value === "irrelevant" ||
    value === "already_known" ||
    value === "infeasible"
  ) {
    return value;
  }

  throw new CliUsageError("--reason must be too_wordy, generic, irrelevant, already_known, or infeasible.");
}

function parseFeedbackSurface(value: string): FeedbackSurface {
  if (value === "terminal" || value === "markdown" || value === "coach") {
    return value;
  }

  throw new CliUsageError("--surface must be terminal, markdown, or coach.");
}

function parseRuleId(value: string): string {
  if (/^rule_[a-z0-9_]+$/.test(value)) {
    return value;
  }

  throw new CliUsageError("--rule must be a safe rule identifier such as rule_tests_near_risky_files.");
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (!value || value.startsWith("-")) {
    throw new CliUsageError(`Missing value for ${flag}.`);
  }

  return value;
}

function parseFormat(value: string): ReportFormat {
  if (value === "summary" || value === "json" || value === "markdown" || value === "all") {
    return value;
  }

  throw new CliUsageError("--format must be summary, json, markdown, or all.");
}

function renderWrittenFiles(files: {
  scan?: string;
  evidenceSignals?: string;
  ruleResults?: string;
  skillEpisodes?: string;
  report?: string;
}): string {
  const lines = ["FirstRung wrote:"];

  for (const path of [files.scan, files.report, files.evidenceSignals, files.ruleResults, files.skillEpisodes]) {
    if (path) {
      lines.push(`- ${path}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function runFeedback(options: FeedbackOptions): CliResult {
  const packet = parseLocalFeedbackPacket({
    kind: "firstrung.feedback.preview.v1",
    transport: "local_preview",
    schemaVersion: CLI_STATIC_METADATA.feedbackPacketSchemaVersion,
    rulesetVersion: CLI_STATIC_METADATA.rulesetVersion,
    templateVersion: CLI_STATIC_METADATA.templateVersion,
    rendererVersion: CLI_STATIC_METADATA.rendererVersion,
    surface: options.surface,
    accuracy: options.accuracy,
    helpfulness: options.helpfulness,
    reasons: options.reasons,
    actionStatus: options.actionStatus,
    ruleIds: options.ruleIds
  });

  return {
    exitCode: 0,
    stdout: `${JSON.stringify(packet, null, 2)}\n`,
    stderr: ""
  };
}

function errorResult(message: string): CliResult {
  return {
    exitCode: 1,
    stdout: "",
    stderr: `${message}\n`
  };
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

async function runDoctor(options: DoctorOptions): Promise<CliResult> {
  const checks = await collectDoctorChecks(options);
  const hasProblem = checks.some((check) => check.status !== "ok");
  const hasError = checks.some((check) => check.status === "error");

  if (options.installCheck) {
    return {
      exitCode: 0,
      stdout: "",
      stderr: hasProblem ? renderDoctorInstallGuidance(checks) : ""
    };
  }

  return {
    exitCode: hasError ? 1 : 0,
    stdout: renderDoctorReport(checks, options),
    stderr: ""
  };
}

async function collectDoctorChecks(options: DoctorOptions): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [
    checkNodeVersion(),
    await checkExecutable("npm", ["--version"], "npm", (version) => `Found npm ${version}.`),
    await checkExecutable("git", ["--version"], "Git", (version) => `Found ${version}.`)
  ];

  if (options.repoPath) {
    checks.push(await checkGitRepository(options.repoPath));
  }

  return checks;
}

function checkNodeVersion(): DoctorCheck {
  const version = process.version.replace(/^v/, "");
  const [majorRaw, minorRaw] = version.split(".");
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const meetsRequirement = major > REQUIRED_NODE_MAJOR || (major === REQUIRED_NODE_MAJOR && minor >= REQUIRED_NODE_MINOR);

  if (Number.isNaN(major) || Number.isNaN(minor)) {
    return {
      status: "warn",
      label: "Node.js",
      detail: `Could not parse current Node.js version '${process.version}'. FirstRung expects Node.js >=${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR}.`
    };
  }

  if (!meetsRequirement) {
    return {
      status: "error",
      label: "Node.js",
      detail: `Found Node.js ${version}. FirstRung expects Node.js >=${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR}.`
    };
  }

  return {
    status: "ok",
    label: "Node.js",
    detail: `Found Node.js ${version}.`
  };
}

async function checkExecutable(
  command: string,
  args: readonly string[],
  label: string,
  renderOk: (stdout: string) => string
): Promise<DoctorCheck> {
  const result = await exec(command, args);

  if (result.errorCode === "ENOENT") {
    return {
      status: label === "Git" ? "error" : "warn",
      label,
      detail:
        label === "Git"
          ? "Git was not found on PATH. Install Git before running FirstRung scans."
          : `${label} was not found on PATH. Install npm to use the published FirstRung CLI path.`
    };
  }

  if (result.exitCode !== 0) {
    return {
      status: "warn",
      label,
      detail: `${label} was found but did not run cleanly: ${firstLine(result.stderr || result.stdout || "unknown error")}`
    };
  }

  return {
    status: "ok",
    label,
    detail: renderOk(firstLine(result.stdout))
  };
}

async function checkGitRepository(repoPath: string): Promise<DoctorCheck> {
  const resolvedPath = resolve(repoPath);
  const result = await exec("git", ["-C", resolvedPath, "rev-parse", "--show-toplevel"]);

  if (result.errorCode === "ENOENT") {
    return {
      status: "error",
      label: "Repository",
      detail: "Git was not found on PATH, so FirstRung could not validate the repository path."
    };
  }

  if (result.exitCode !== 0) {
    return {
      status: "error",
      label: "Repository",
      detail: `Not a Git repository: ${resolvedPath}. Choose a Git repo path or run git init first.`
    };
  }

  return {
    status: "ok",
    label: "Repository",
    detail: `Git repository ready: ${firstLine(result.stdout)}.`
  };
}

function renderDoctorReport(checks: readonly DoctorCheck[], options: DoctorOptions): string {
  const lines = ["FirstRung doctor"];

  for (const check of checks) {
    lines.push(`${doctorIcon(check.status)} ${check.label}: ${check.detail}`);
  }

  if (!options.repoPath) {
    lines.push("Tip: run firstrung doctor <repo> to validate a scan target before scanning.");
  }

  lines.push(checks.some((check) => check.status === "error") ? "FirstRung is not ready to scan yet." : "FirstRung is ready to scan.");

  return `${lines.join("\n")}\n`;
}

function renderDoctorInstallGuidance(checks: readonly DoctorCheck[]): string {
  const problemLines = checks
    .filter((check) => check.status !== "ok")
    .map((check) => `- ${check.label}: ${check.detail}`);

  if (problemLines.length === 0) {
    return "";
  }

  return [
    "FirstRung install check found environment issue(s).",
    ...problemLines,
    "Run firstrung doctor <repo> after fixing them."
  ].join("\n") + "\n";
}

function doctorIcon(status: DoctorCheck["status"]): string {
  if (status === "ok") {
    return "OK";
  }

  if (status === "warn") {
    return "WARN";
  }

  return "ERROR";
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/, 1)[0] ?? "";
}

function exec(command: string, args: readonly string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  errorCode?: string;
}> {
  return new Promise((resolveResult) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolveResult({ exitCode: 0, stdout, stderr });
          return;
        }

        resolveResult({
          exitCode: typeof error.code === "number" ? error.code : 1,
          stdout,
          stderr,
          ...(typeof error.code === "string" ? { errorCode: error.code } : {})
        });
      }
    );
  });
}

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

function optional<T extends Record<string, unknown>>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

if (await isCliEntrypoint()) {
  const result = await runCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

async function isCliEntrypoint(): Promise<boolean> {
  const entrypoint = process.argv[1];

  if (!entrypoint) {
    return false;
  }

  const modulePath = fileURLToPath(import.meta.url);
  const [moduleRealPath, entrypointRealPath] = await Promise.all([
    realpath(modulePath).catch(() => modulePath),
    realpath(entrypoint).catch(() => entrypoint)
  ]);

  return moduleRealPath === entrypointRealPath;
}
