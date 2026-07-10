#!/usr/bin/env node

import { renderCoachArtifactGuidance } from "../coachCliOutput.js";
import { runCoachSession } from "../coachSession.js";

const usage =
  "Usage: firstrung-coach coach <repo> [--out <dir>] [--since <git-ref>] [--branch <name>] [--dry-run-context] [--confirm-provider] [--confirm-provider-target <provider/model>] [--session-dir <dir>]";

interface CoachCliOptions {
  repoPath: string;
  outDir?: string;
  since?: string;
  branch?: string;
  dryRunContext: boolean;
  confirmProviderDisclosure: boolean;
  providerTarget?: string;
  sessionDir?: string;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const result = await runCoachSession({
    repoPath: options.repoPath,
    dryRunContext: options.dryRunContext,
    confirmProviderDisclosure: options.confirmProviderDisclosure,
    confirmProviderTarget: (preflight) => options.providerTarget === preflight.target,
    onProviderPreflight: (preflight) => {
      process.stderr.write(
        [
          `FirstRung Coach provider: ${preflight.provider} / ${preflight.model}`,
          `Exact confirmation target: ${preflight.target}`,
          `Outbound derived fields: ${preflight.outboundFields.join(", ")}.`,
          preflight.pathHandling,
          `Explicitly consented snippets: ${preflight.selectedSnippetIds.join(", ") || "none"}.`
        ].join("\n") + "\n"
      );
    },
    ...optional({
      outDir: options.outDir,
      since: options.since,
      branch: options.branch,
      sessionDir: options.sessionDir
    })
  });

  if (options.dryRunContext) {
    process.stdout.write(`${JSON.stringify(result.context, null, 2)}\n`);
  } else {
    process.stdout.write(`${result.feedback ?? "FirstRung Coach completed."}\n`);
    const artifactGuidance = renderCoachArtifactGuidance(result);
    if (artifactGuidance) process.stderr.write(`${artifactGuidance}\n`);
  }
} catch (error) {
  process.stderr.write(`${renderError(error)}\n`);
  process.exitCode = 1;
}

function parseArgs(args: readonly string[]): CoachCliOptions {
  if (args[0] !== "coach") {
    throw new Error(usage);
  }

  const repoPath = args[1];

  if (!repoPath || repoPath.startsWith("-")) {
    throw new Error(usage);
  }

  const options: CoachCliOptions = {
    repoPath,
    dryRunContext: false,
    confirmProviderDisclosure: false
  };

  for (let index = 2; index < args.length; index += 1) {
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

    if (flag === "--session-dir") {
      options.sessionDir = requiredValue(args, index, flag);
      index += 1;
      continue;
    }

    if (flag === "--dry-run-context") {
      options.dryRunContext = true;
      continue;
    }

    if (flag === "--confirm-provider") {
      options.confirmProviderDisclosure = true;
      continue;
    }

    if (flag === "--confirm-provider-target") {
      options.providerTarget = requiredValue(args, index, flag);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${flag}\n${usage}`);
  }

  return options;
}

function requiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}.\n${usage}`);
  }

  return value;
}

function renderError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown firstrung-coach error.";
  const guidance = "Try: firstrung-coach coach <repo> --dry-run-context to inspect the redacted context without Pi.";

  if (/firstrung-coach requires Node >=22\.19\.0/.test(message)) {
    return `${message}\n${guidance}`;
  }

  if (message === usage || message.startsWith("Unknown argument") || message.startsWith("Missing value")) {
    return message;
  }

  return `FirstRung Coach could not start: ${message}\n${guidance}`;
}

function optional<T extends Record<string, unknown>>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
