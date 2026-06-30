import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { EvidenceSignal, RuleResult, ScanArtifact, ScanSummary, SkillEpisode } from "@firstrung/schema";
import { parseEvidenceSignal, parseRuleResult, parseScanArtifact, parseSkillEpisode } from "@firstrung/schema";

export type ReportFormat = "summary" | "json" | "markdown" | "all";

export interface ScanResultModel {
  summary: ScanSummary;
  evidenceSignals: EvidenceSignal[];
  ruleResults: RuleResult[];
  skillEpisodes: SkillEpisode[];
}

export interface WriteReportInput extends ScanResultModel {
  outDir: string;
  format?: ReportFormat;
  debugArtifacts?: boolean;
}

export interface WrittenReportFiles {
  scan?: string;
  report?: string;
  evidenceSignals?: string;
  ruleResults?: string;
  skillEpisodes?: string;
}

interface ChangeBreakdown {
  total: number;
  code: number;
  tests: number;
  docs: number;
  deployConfig: number;
  dependency: number;
  riskSensitive: number;
  other: number;
}

export async function writeReportArtifacts(input: WriteReportInput): Promise<WrittenReportFiles> {
  const outDir = resolve(input.outDir);
  const format = input.format ?? "summary";
  const files: WrittenReportFiles = {};

  await mkdir(outDir, { recursive: true });

  if (format === "summary" || format === "json" || format === "all") {
    const scanPath = join(outDir, "scan.json");
    await writeFile(scanPath, `${stableJson(toScanJson(input))}\n`, "utf8");
    files.scan = scanPath;
  }

  if (format === "markdown" || format === "all") {
    const reportPath = join(outDir, "report.md");
    await writeFile(reportPath, renderMarkdownReport(input), "utf8");
    files.report = reportPath;
  }

  if (input.debugArtifacts) {
    const evidenceSignalsPath = join(outDir, "evidence-signals.json");
    const ruleResultsPath = join(outDir, "rule-results.json");
    const skillEpisodesPath = join(outDir, "skill-episodes.json");

    await writeFile(evidenceSignalsPath, `${stableJson(input.evidenceSignals.map(parseEvidenceSignal))}\n`, "utf8");
    await writeFile(ruleResultsPath, `${stableJson(input.ruleResults.map(parseRuleResult))}\n`, "utf8");
    await writeFile(skillEpisodesPath, `${stableJson(input.skillEpisodes.map(parseSkillEpisode))}\n`, "utf8");

    files.evidenceSignals = evidenceSignalsPath;
    files.ruleResults = ruleResultsPath;
    files.skillEpisodes = skillEpisodesPath;
  }

  return files;
}

export function toScanJson(input: ScanResultModel): ScanArtifact {
  return parseScanArtifact({
    summary: input.summary,
    signals: input.evidenceSignals.map(parseEvidenceSignal),
    rules: input.ruleResults.map(parseRuleResult),
    episodes: input.skillEpisodes.map(parseSkillEpisode)
  });
}

export function renderTerminalSummary(input: ScanResultModel): string {
  return renderSummaryLines(input).join("\n") + "\n";
}

export function renderMarkdownReport(input: ScanResultModel): string {
  const lines = renderSummaryLines(input);
  return [
    "# FirstRung Local Summary",
    "",
    "## Summary",
    "",
    ...lines.slice(0, 2),
    "",
    "## What I Inspected",
    "",
    ...lines.slice(2, 5).map((line) => `- ${line}`),
    "",
    "## What Stayed Local",
    "",
    ...lines.slice(5, 7).map((line) => `- ${line}`),
    "",
    "## What Changed",
    "",
    ...lines.slice(7, 8).map((line) => `- ${line}`),
    "",
    "## Evidence Found",
    "",
    ...evidenceLines(input).map((line) => `- ${line}`),
    "",
    "## Relevant Gaps",
    "",
    ...gapLines(input).map((line) => `- ${line}`),
    "",
    "## Next Useful Step",
    "",
    `- ${nextStep(input)}`
  ].join("\n") + "\n";
}

function renderSummaryLines(input: ScanResultModel): string[] {
  const breakdown = changedBreakdown(input.evidenceSignals);
  const lines = [
    `FirstRung scanned ${input.summary.projectName}.`,
    contributionBoundaryLine(input.summary),
    `I inspected ${input.summary.repoRoot}.`,
    `Current branch: ${input.summary.currentBranch}; target: ${input.summary.targetRef} (${input.summary.targetCommit}).`,
    `Changed paths in scope: ${input.summary.changedFileCount}.`,
    "Nothing was uploaded.",
    "I did not include raw code, raw prompts, raw diffs, private logs, or environment values.",
    changedLine(breakdown),
    ...evidenceLines(input),
    ...gapLines(input),
    nextStep(input)
  ];

  return lines.filter((line) => line.length > 0);
}

function contributionBoundaryLine(summary: ScanSummary): string {
  return summary.attributionReason;
}

function changedLine(breakdown: ChangeBreakdown): string {
  if (breakdown.total === 0) {
    return "No changed files stood out in this scan.";
  }

  return `You changed ${breakdown.total} file${plural(breakdown.total)}: ${formatBreakdown(breakdown)}.`;
}

function evidenceLines(input: ScanResultModel): string[] {
  const lines: string[] = [];
  const breakdown = changedBreakdown(input.evidenceSignals);
  const positiveRules = input.ruleResults.filter(
    (result) => result.matched && result.ruleId !== "rule_risky_files_without_nearby_tests"
  );
  const preExistingContext = input.ruleResults.filter(
    (result) => result.matched && result.attribution.kind === "pre_existing"
  );

  if (breakdown.tests > 0) {
    lines.push(`I found ${breakdown.tests} changed test file${plural(breakdown.tests)} in this working set.`);
  }

  if (breakdown.riskSensitive === 0 && breakdown.total > 0) {
    lines.push("No auth, payments, database, permissions, deploy, or secrets/config changes stood out in this working set.");
  }

  for (const result of positiveRules) {
    if (result.attribution.kind === "pre_existing") {
      continue;
    }

    if (result.feedback?.summary) {
      lines.push(result.feedback.summary);
    }
  }

  if (lines.length === 0 && preExistingContext.length > 0) {
    lines.push("I found pre-existing project setup evidence, but I am not treating it as your active contribution.");
  }

  return unique(lines);
}

function gapLines(input: ScanResultModel): string[] {
  return input.ruleResults
    .filter((result) => result.ruleId === "rule_risky_files_without_nearby_tests" && result.matched)
    .flatMap((result) => [
      result.feedback?.summary,
      ...(result.feedback?.missingEvidence ?? [])
    ])
    .filter(isString);
}

function nextStep(input: ScanResultModel): string {
  const riskGap = input.ruleResults.find((result) => result.ruleId === "rule_risky_files_without_nearby_tests" && result.matched);

  if (riskGap?.feedback?.nextStep) {
    return riskGap.feedback.nextStep;
  }

  const breakdown = changedBreakdown(input.evidenceSignals);

  if (breakdown.tests > 0) {
    return "Next useful step: run the relevant tests and keep the command result with this work.";
  }

  if (breakdown.code > 0) {
    return "Next useful step: add or surface the closest test evidence for these code changes.";
  }

  if (breakdown.total > 0) {
    return "Next useful step: keep a short note on why these files changed and what you verified.";
  }

  return "Next useful step: rerun with --since <git-ref> or after making local changes so I can separate active work from project context.";
}

function changedBreakdown(signals: EvidenceSignal[]): ChangeBreakdown {
  const changedSignals = signals.filter((signal) => signal.signalType === "file.changed");
  const breakdown: ChangeBreakdown = {
    total: changedSignals.length,
    code: 0,
    tests: 0,
    docs: 0,
    deployConfig: 0,
    dependency: 0,
    riskSensitive: 0,
    other: 0
  };

  for (const signal of changedSignals) {
    const categories = Array.isArray(signal.data?.categories)
      ? signal.data.categories.filter(isString)
      : [];

    if (categories.includes("test")) {
      breakdown.tests += 1;
    } else if (categories.includes("docs")) {
      breakdown.docs += 1;
    } else if (categories.includes("deploy_config")) {
      breakdown.deployConfig += 1;
    } else if (categories.includes("dependency")) {
      breakdown.dependency += 1;
    } else if (categories.includes("code")) {
      breakdown.code += 1;
    } else {
      breakdown.other += 1;
    }

    if (categories.includes("risk_sensitive")) {
      breakdown.riskSensitive += 1;
    }
  }

  return breakdown;
}

function formatBreakdown(breakdown: ChangeBreakdown): string {
  const parts = [
    countPart(breakdown.code, "code"),
    countPart(breakdown.tests, "test"),
    countPart(breakdown.docs, "docs"),
    countPart(breakdown.deployConfig, "deploy/config"),
    countPart(breakdown.dependency, "dependency"),
    countPart(breakdown.other, "other")
  ].filter(isString);

  return parts.length > 0 ? parts.join(", ") : "no categorized changed files";
}

function countPart(count: number, label: string): string | undefined {
  if (count === 0) {
    return undefined;
  }

  return `${count} ${label}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
