import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

import type {
  EvidenceSignal,
  RuleResult,
  ScanArtifact,
  ScanProvenance,
  ScanSummary,
  SkillEpisode
} from "@firstrung/schema";
import { parseEvidenceSignal, parseRuleResult, parseScanArtifact, parseSkillEpisode } from "@firstrung/schema";

export type ReportFormat = "summary" | "json" | "markdown" | "all";
export const REPORT_RENDERER_VERSION = "2026-07-10.1";

export interface ScanResultModel {
  provenance: ScanProvenance;
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
  const requestedOutDir = resolve(input.outDir);
  const format = input.format ?? "summary";
  const files: WrittenReportFiles = {};

  const repoRoot = resolve(input.summary.repoRoot);
  if (isPathInside(repoRoot, requestedOutDir)) {
    await assertNoSymlinkBelowRoot(repoRoot, requestedOutDir);
  }

  await assertNotSymlink(requestedOutDir);
  await mkdir(requestedOutDir, { recursive: true });
  await assertNotSymlink(requestedOutDir);
  const outDir = await realpath(requestedOutDir);
  await assertNoSymlinkComponents(outDir);

  if (format === "summary" || format === "json" || format === "all") {
    const scanPath = join(outDir, "scan.json");
    await safeWriteFile(scanPath, `${stableJson(toScanJson(input))}\n`);
    files.scan = scanPath;
  }

  if (format === "markdown" || format === "all") {
    const reportPath = join(outDir, "report.md");
    await safeWriteFile(reportPath, renderMarkdownReport(input));
    files.report = reportPath;
  }

  if (input.debugArtifacts) {
    const evidenceSignalsPath = join(outDir, "evidence-signals.json");
    const ruleResultsPath = join(outDir, "rule-results.json");
    const skillEpisodesPath = join(outDir, "skill-episodes.json");

    await safeWriteFile(evidenceSignalsPath, `${stableJson(input.evidenceSignals.map(parseEvidenceSignal))}\n`);
    await safeWriteFile(ruleResultsPath, `${stableJson(input.ruleResults.map(parseRuleResult))}\n`);
    await safeWriteFile(skillEpisodesPath, `${stableJson(input.skillEpisodes.map(parseSkillEpisode))}\n`);

    files.evidenceSignals = evidenceSignalsPath;
    files.ruleResults = ruleResultsPath;
    files.skillEpisodes = skillEpisodesPath;
  }

  return files;
}

async function assertNoSymlinkBelowRoot(root: string, target: string): Promise<void> {
  const pathFromRoot = relative(root, target);
  let current = root;

  for (const part of pathFromRoot.split(sep).filter(Boolean)) {
    current = join(current, part);

    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to write a FirstRung report through a repository symlink: ${current}`);
      }
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) {
        continue;
      }

      throw error;
    }
  }
}

function isPathInside(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === "" || (!isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`));
}

async function safeWriteFile(path: string, contents: string): Promise<void> {
  await assertNoSymlinkComponents(path);

  let handle;
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o600
    );
    await handle.writeFile(contents, "utf8");
  } catch (error) {
    if (isFileSystemError(error, "ELOOP")) {
      throw new Error(`Refusing to write a FirstRung report through a symbolic link: ${path}`);
    }

    throw error;
  } finally {
    await handle?.close();
  }
}

async function assertNoSymlinkComponents(path: string): Promise<void> {
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  const parts = relative(root, absolutePath).split(sep).filter(Boolean);
  let current = root;

  for (const part of parts) {
    current = join(current, part);

    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to write a FirstRung report through a symbolic link: ${current}`);
      }
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) {
        continue;
      }

      throw error;
    }
  }

  const parent = dirname(absolutePath);
  if (parent !== absolutePath && parent !== root) {
    await assertExistingDirectory(parent);
  }
}

async function assertNotSymlink(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to use a symbolic link as a FirstRung report directory: ${path}`);
    }
  } catch (error) {
    if (!isFileSystemError(error, "ENOENT")) {
      throw error;
    }
  }
}

async function assertExistingDirectory(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory()) {
      throw new Error(`FirstRung report output parent is not a directory: ${path}`);
    }
  } catch (error) {
    if (!isFileSystemError(error, "ENOENT")) {
      throw error;
    }
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

export function toScanJson(input: ScanResultModel): ScanArtifact {
  return parseScanArtifact({
    provenance: input.provenance,
    summary: input.summary,
    signals: input.evidenceSignals.map(parseEvidenceSignal),
    rules: input.ruleResults.map(parseRuleResult),
    episodes: input.skillEpisodes.map(parseSkillEpisode)
  });
}

export function renderTerminalSummary(input: ScanResultModel, options: { explain?: boolean } = {}): string {
  return `${(options.explain ? renderExplainLines(input) : renderBriefLines(input)).join("\n")}\n`;
}

export function renderMarkdownReport(input: ScanResultModel): string {
  const evidence = evidenceLines(input);
  const gaps = gapLines(input);
  return [
    "# FirstRung Local Summary",
    "",
    "## Summary",
    "",
    summaryHeaderLine(input),
    primaryObservation(input),
    "",
    "## Scope and limitations",
    "",
    `- ${contributionBoundaryLine(input.summary)}`,
    `- Repository: ${boundedInline(input.summary.repoRoot, 96, 12)}.`,
    `- ${branchLine(input.summary)}`,
    "- Git paths identify a change window; they do not prove who made a change or whether a check ran.",
    "",
    "## Privacy",
    "",
    "- Nothing was uploaded.",
    "- Raw code, prompts, diffs, private logs, and environment values were not included.",
    "",
    "## Provenance",
    "",
    `- ${provenanceLine(input.provenance)}`,
    "",
    "## Evidence Found",
    "",
    ...(evidence.length > 0 ? evidence : ["No specific positive evidence claim was justified from path metadata."]).map(
      (line) => `- ${line}`
    ),
    "",
    "## Relevant Gaps",
    "",
    ...(gaps.length > 0 ? gaps : ["No risk-specific gap was identified by the current path rules."]).map(
      (line) => `- ${line}`
    ),
    "",
    "## Next Useful Step",
    "",
    `- ${nextStep(input)}`
  ].join("\n") + "\n";
}

function renderBriefLines(input: ScanResultModel): string[] {
  return [
    boundedWords(summaryHeaderLine(input), 16),
    boundedWords(primaryObservation(input), 24),
    boundedWords(nextStep(input), 13),
    "Local path metadata only; nothing uploaded. Use --explain for scope, limits, and versions."
  ];
}

function summaryHeaderLine(input: ScanResultModel): string {
  const projectName = boundedInline(input.summary.projectName, 48, 4);
  return `FirstRung — ${projectName}: ${input.summary.changedFileCount} changed path${plural(input.summary.changedFileCount)} in the selected Git window.`;
}

function renderExplainLines(input: ScanResultModel): string[] {
  return [
    `FirstRung scanned ${boundedInline(input.summary.projectName, 48, 4)}.`,
    contributionBoundaryLine(input.summary),
    `Repository: ${boundedInline(input.summary.repoRoot, 96, 12)}.`,
    branchLine(input.summary),
    `Changed paths in scope: ${input.summary.changedFileCount}.`,
    "Limit: Git paths identify a change window; they do not prove authorship or test execution.",
    "Privacy: nothing was uploaded; raw code, prompts, diffs, private logs, and environment values were not included.",
    provenanceLine(input.provenance),
    `Observation: ${primaryObservation(input)}`,
    nextStep(input)
  ];
}

function contributionBoundaryLine(summary: ScanSummary): string {
  return boundedInline(summary.attributionReason, 160, 24);
}

function branchLine(summary: ScanSummary): string {
  const currentBranch = boundedInline(summary.currentBranch, 48, 4);
  const targetRef = boundedInline(summary.targetRef, 48, 4);
  const targetCommit = boundedInline(summary.targetCommit, 48, 2);
  const target = `${targetRef} (${targetCommit})`;

  if (summary.baselineRef) {
    const baselineRef = boundedInline(summary.baselineRef, 48, 4);
    return `Current branch: ${currentBranch}; comparison: ${baselineRef}..${target}.`;
  }

  return `Current branch: ${currentBranch}; target: ${target}.`;
}

function provenanceLine(provenance: ScanProvenance): string {
  return `Versions: schema ${boundedInline(provenance.schemaVersion, 40, 2)}; rules ${boundedInline(provenance.rulesetVersion, 40, 2)}; templates ${boundedInline(provenance.templateVersion, 40, 2)}; renderer ${boundedInline(provenance.rendererVersion, 40, 2)}.`;
}

function primaryObservation(input: ScanResultModel): string {
  const priority = [
    "rule_risky_files_without_nearby_tests",
    "rule_tests_near_risky_files",
    "rule_existing_tests_near_risky_files",
    "rule_deployment_config_evidence",
    "rule_dependency_api_evidence"
  ];

  for (const ruleId of priority) {
    const result = input.ruleResults.find(
      (item) =>
        item.ruleId === ruleId &&
        item.matched &&
        (item.attribution.kind !== "pre_existing" || item.ruleId === "rule_existing_tests_near_risky_files")
    );

    if (!result) {
      continue;
    }

    const pathSignal = representativePathSignal(input, result);
    if (!pathSignal) {
      return result.feedback?.summary
        ? boundedInline(result.feedback.summary, 144, 20)
        : "A path-metadata rule matched without a representative path.";
    }

    const path = boundedDisplayPath(pathOf(pathSignal));

    if (
      result.ruleId === "rule_risky_files_without_nearby_tests" ||
      result.ruleId === "rule_tests_near_risky_files" ||
      result.ruleId === "rule_existing_tests_near_risky_files"
    ) {
      const category = riskCategoryOf(pathSignal);

      if (result.ruleId === "rule_risky_files_without_nearby_tests") {
        const additional = additionalRiskPathCount(input, result);
        const additionalText = additional > 0
          ? ` ${additional} additional risk path${plural(additional)} matched.`
          : "";
        return `Path heuristic: ${path} matched ${category}; no closely related test path was found.${additionalText}`;
      }

      const relation = result.ruleId === "rule_tests_near_risky_files" ? "changed" : "existing";
      return `Path relation: ${path} matched ${category} and a closely related ${relation} test path; test execution was not observed.`;
    }

    if (result.ruleId === "rule_deployment_config_evidence") {
      if (isCiWorkflowPath(pathOf(pathSignal))) {
        return `Path heuristic: ${path} matched CI workflow metadata.`;
      }

      return `Path heuristic: ${path} matched deployment config metadata.`;
    }

    if (result.ruleId === "rule_dependency_api_evidence") {
      return `Path heuristic: ${path} matched dependency metadata.`;
    }
  }

  if (input.summary.changedFileCount === 0) {
    return "No changed paths were available for a change-window observation.";
  }

  return "No risk-specific gap was identified by the current path-metadata rules.";
}

function representativePathSignal(input: ScanResultModel, result: RuleResult): EvidenceSignal | undefined {
  const matchedIds = new Set(result.matchedSignalIds);
  const matchedSignals = input.evidenceSignals.filter(
    (signal) => matchedIds.has(signal.id) && pathOf(signal).length > 0
  );

  if (
    result.ruleId === "rule_risky_files_without_nearby_tests" ||
    result.ruleId === "rule_tests_near_risky_files" ||
    result.ruleId === "rule_existing_tests_near_risky_files"
  ) {
    return matchedSignals.find((signal) => signal.signalType.startsWith("risk.file."));
  }

  if (result.ruleId === "rule_deployment_config_evidence") {
    return matchedSignals.find(
      (signal) => signal.signalType === "deployment.config.added" || signal.signalType === "deployment.config.changed"
    );
  }

  if (result.ruleId === "rule_dependency_api_evidence") {
    return matchedSignals.find(
      (signal) => signal.signalType === "dependency.file.added" || signal.signalType === "dependency.file.changed"
    );
  }

  return matchedSignals[0];
}

function pathOf(signal: EvidenceSignal): string {
  const path = signal.data?.path;
  return typeof path === "string" ? path : signal.refs?.find((ref) => ref.kind === "file")?.locator ?? "";
}

function riskCategoryOf(signal: EvidenceSignal): string {
  const categories = signal.data?.riskCategories;
  const category = Array.isArray(categories)
    ? categories.find((item) => typeof item === "string" && item !== "infrastructure_deploy") ?? categories[0]
    : undefined;

  if (category === "secrets_config") {
    return "secrets/config";
  }

  if (category === "infrastructure_deploy") {
    return "deployment config";
  }

  return typeof category === "string"
    ? boundedInline(category.replaceAll("_", "/"), 32, 3)
    : "risk-sensitive path metadata";
}

function boundedDisplayPath(path: string, maxLength = 56): string {
  const sanitized = stripAnsi(path).replace(
    /[\s\u0000-\u001f\u007f-\u009f]/g,
    (character) => character === " " ? "␠" : "?"
  );

  if (sanitized.length <= maxLength) {
    return sanitized;
  }

  const headLength = Math.ceil((maxLength - 1) / 2);
  const tailLength = maxLength - 1 - headLength;
  return `${sanitized.slice(0, headLength)}…${sanitized.slice(-tailLength)}`;
}

function isCiWorkflowPath(path: string): boolean {
  return path.replace(/\\/g, "/").toLowerCase().startsWith(".github/workflows/");
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
  const changedTestCount = input.evidenceSignals.filter(
    (signal) =>
      signal.signalType === "test.file.added" ||
      signal.signalType === "test.file.changed" ||
      signal.signalType === "test.file.copied"
  ).length;

  if (changedTestCount > 0) {
    lines.push(`${changedTestCount} present test path${plural(changedTestCount)} changed in this Git window.`);
  }

  if (breakdown.riskSensitive === 0 && breakdown.total > 0) {
    lines.push("No path names matched the current auth, payments, database, permissions, deploy, or secrets rules.");
  }

  for (const result of positiveRules) {
    if (result.ruleId === "rule_existing_tests_near_risky_files") {
      if (result.feedback?.summary) {
        lines.push(boundedInline(result.feedback.summary, 144, 20));
      }
      continue;
    }

    if (result.attribution.kind === "pre_existing") {
      continue;
    }

    if (result.feedback?.summary) {
      lines.push(boundedInline(result.feedback.summary, 144, 20));
    }
  }

  if (lines.length === 0 && preExistingContext.length > 0) {
    lines.push("Project setup paths exist outside the selected Git window; no person attribution was inferred.");
  }

  return unique(lines);
}

function gapLines(input: ScanResultModel): string[] {
  return input.ruleResults
    .filter((result) => result.ruleId === "rule_risky_files_without_nearby_tests" && result.matched)
    .flatMap((result) => {
      const missing = (result.feedback?.missingEvidence ?? []).filter(isString);
      return missing.length > 0 ? missing : [result.feedback?.summary].filter(isString);
    })
    .map((line) => boundedInline(line, 144, 20));
}

function nextStep(input: ScanResultModel): string {
  const priority = [
    "rule_risky_files_without_nearby_tests",
    "rule_tests_near_risky_files",
    "rule_existing_tests_near_risky_files",
    "rule_deployment_config_evidence",
    "rule_dependency_api_evidence"
  ];

  for (const ruleId of priority) {
    const result = input.ruleResults.find(
      (item) =>
        item.ruleId === ruleId &&
        item.matched &&
        (item.attribution.kind === "change_window" ||
          item.attribution.kind === "candidate_contributed" ||
          item.ruleId === "rule_existing_tests_near_risky_files")
    );

    if (result?.feedback?.nextStep) {
      return boundedInline(result.feedback.nextStep, 120, 13);
    }
  }

  if (input.summary.changedFileCount === 0) {
    return "Next: rerun with --since <ref> or after a local change.";
  }

  return "No specific next action is justified from path metadata alone.";
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

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function additionalRiskPathCount(input: ScanResultModel, result: RuleResult): number {
  const matchedIds = new Set(result.matchedSignalIds);
  const paths = new Set(
    input.evidenceSignals
      .filter((signal) => matchedIds.has(signal.id) && signal.signalType.startsWith("risk.file."))
      .map(pathOf)
      .filter((path) => path.length > 0)
  );
  return Math.max(0, paths.size - 1);
}

function boundedInline(value: string, maxLength: number, maxWords: number): string {
  const sanitized = stripAnsi(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "unknown";
  const words = sanitized.split(" ");
  const wordBounded = words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}…` : sanitized;

  if (wordBounded.length <= maxLength) return wordBounded;
  return `${wordBounded.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function boundedWords(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}…` : value;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
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
