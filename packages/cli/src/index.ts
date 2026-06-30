#!/usr/bin/env node
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { collectRepository, CollectorError } from "@firstrung/collector";
import { renderTerminalSummary, writeReportArtifacts, type ReportFormat } from "@firstrung/report";
import { runAlphaRules } from "@firstrung/rules";

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
}

const usage = "Usage: firstrung scan <repo> [--out <dir>] [--since <git-ref>] [--branch <name>] [--format summary|json|markdown|all] [--debug-artifacts]";

export async function runCli(argv: string[]): Promise<CliResult> {
  try {
    const command = argv[0];

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
      summary: collection.summary,
      evidenceSignals: collection.signals,
      ruleResults: rules.ruleResults,
      skillEpisodes: rules.skillEpisodes
    };
    let stdout = renderTerminalSummary(model);

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
    throw new CliUsageError(usage);
  }

  const options: ScanOptions = {
    repoPath,
    format: "summary",
    debugArtifacts: false
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

    throw new CliUsageError(`Unknown argument: ${flag}`);
  }

  if (!options.outDir && (options.format !== "summary" || options.debugArtifacts)) {
    throw new CliUsageError("--format json, --format markdown, --format all, and --debug-artifacts require --out <dir>.");
  }

  return options;
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

function errorResult(message: string): CliResult {
  return {
    exitCode: 1,
    stdout: "",
    stderr: `${message}\n`
  };
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
