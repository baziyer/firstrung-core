import { execFile } from "node:child_process";
import { basename, resolve } from "node:path";

import type {
  AttributionKind,
  CollectorEvent,
  Confidence,
  ContributionAttribution,
  EvidenceSignal,
  JsonObject
} from "@firstrung/schema";

export type AttributionMode = "since" | "working_tree" | "branch" | "unknown";

export interface CollectRepositoryInput {
  repoPath: string;
  since?: string;
  branch?: string;
  now?: Date;
}

export interface CollectionSummary {
  projectId: string;
  projectName: string;
  requestedPath: string;
  repoRoot: string;
  currentBranch: string;
  targetRef: string;
  targetCommit: string;
  baselineRef?: string;
  attributionMode: AttributionMode;
  attributionReason: string;
  changedFileCount: number;
  trackedFileCount: number;
  rawContentIncluded: false;
}

export interface CollectionResult {
  events: CollectorEvent[];
  signals: EvidenceSignal[];
  summary: CollectionSummary;
}

interface ChangedEntry {
  path: string;
  status: string;
}

interface CommitSummary {
  shortHash: string;
  authoredAt: string;
  summary: string;
}

interface PathClassification {
  path: string;
  categories: string[];
  riskCategories: string[];
  isTest: boolean;
  isDeploymentConfig: boolean;
  isDependencyFile: boolean;
  isDocumentation: boolean;
  isCode: boolean;
}

export class CollectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectorError";
  }
}

export async function collectRepository(input: CollectRepositoryInput): Promise<CollectionResult> {
  if (input.repoPath.trim().length === 0) {
    throw new CollectorError("A repository path is required.");
  }

  const requestedPath = resolve(input.repoPath);
  const repoRoot = await getRepoRoot(requestedPath);
  const observedAt = (input.now ?? new Date()).toISOString();
  const projectName = basename(repoRoot);
  const projectId = `project_${slug(projectName)}`;
  const currentBranch = await readCurrentBranch(repoRoot);
  const targetRef = input.branch ?? "HEAD";
  const targetCommit = await readVerifiedCommit(repoRoot, targetRef, `Could not resolve branch/ref '${targetRef}'.`);
  const workingTreeEntries = await readWorkingTreeEntries(repoRoot);
  const comparison = await resolveComparison(repoRoot, currentBranch, targetRef, workingTreeEntries.length, input.since);
  const committedChangedEntries = comparison.baselineRef
    ? await readChangedEntries(repoRoot, comparison.baselineRef, targetRef)
    : [];
  const changedEntries = mergeChangedEntries(committedChangedEntries, workingTreeEntries);
  const changedPathSet = new Set(changedEntries.map((entry) => entry.path));
  const trackedFiles = await readTrackedFiles(repoRoot);
  const commitSummaries = await readCommitSummaries(repoRoot, comparison.baselineRef, targetRef);

  const summary: CollectionSummary = {
    projectId,
    projectName,
    requestedPath,
    repoRoot,
    currentBranch,
    targetRef,
    targetCommit,
    ...optional({ baselineRef: comparison.baselineRef }),
    attributionMode: comparison.mode,
    attributionReason: comparison.reason,
    changedFileCount: changedEntries.length,
    trackedFileCount: trackedFiles.length,
    rawContentIncluded: false
  };

  const inventoryEventId = `event_${projectId}_git_inventory`;
  const events: CollectorEvent[] = [
    {
      id: inventoryEventId,
      projectId,
      source: "git",
      type: "git.repository.scanned",
      observedAt,
      summary: `Scanned Git metadata and tracked file paths for ${projectName}.`,
      rawContentIncluded: false,
      metadata: {
        currentBranch,
        targetRef,
        targetCommit,
        attributionMode: comparison.mode,
        attributionReason: comparison.reason,
        changedFileCount: changedEntries.length,
        trackedFileCount: trackedFiles.length,
        rawCodeIncluded: false,
        rawDiffsIncluded: false,
        rawPromptsIncluded: false,
        privateLogsIncluded: false,
        envValuesIncluded: false,
        ...optional({ baselineRef: comparison.baselineRef })
      }
    },
    {
      id: `event_${projectId}_git_commits`,
      projectId,
      source: "git",
      type: "git.commits.observed",
      observedAt,
      summary: `Observed ${commitSummaries.length} commit summaries without reading raw diffs.`,
      rawContentIncluded: false,
      refs: commitSummaries.map((commit) => ({
        kind: "commit",
        label: `commit ${commit.shortHash}`,
        locator: commit.shortHash,
        redacted: true
      })),
      metadata: {
        commits: commitSummaries.map<JsonObject>((commit) => ({
          shortHash: commit.shortHash,
          authoredAt: commit.authoredAt,
          summary: commit.summary
        }))
      }
    }
  ];

  const signals: EvidenceSignal[] = [];
  for (const entry of changedEntries) {
    const classification = classifyPath(entry.path);
    const attribution = attributionFor("candidate_contributed", ["file changed in the selected contribution window"], "high");

    signals.push(
      buildSignal({
        prefix: "file_changed",
        projectId,
        observedAt,
        signalType: "file.changed",
        summary: `Path changed in the selected contribution window: ${entry.path}.`,
        sourceEventIds: [inventoryEventId],
        attribution,
        confidence: "high",
        path: entry.path,
        data: {
          path: entry.path,
          status: entry.status,
          categories: classification.categories
        }
      })
    );

    if (classification.riskCategories.length > 0) {
      signals.push(
        buildSignal({
          prefix: "risk_changed",
          projectId,
          observedAt,
          signalType: "risk.file.changed",
          summary: `Risk-sensitive path changed in the selected contribution window: ${entry.path}.`,
          sourceEventIds: [inventoryEventId],
          attribution,
          confidence: "high",
          path: entry.path,
          data: {
            path: entry.path,
            status: entry.status,
            riskCategories: classification.riskCategories
          }
        })
      );
    }

    if (classification.isTest) {
      signals.push(
        buildSignal({
          prefix: "test_changed",
          projectId,
          observedAt,
          signalType: "test.file.changed",
          summary: `Test path changed in the selected contribution window: ${entry.path}.`,
          sourceEventIds: [inventoryEventId],
          attribution,
          confidence: "high",
          path: entry.path,
          data: {
            path: entry.path,
            status: entry.status
          }
        })
      );
    }

    if (classification.isDeploymentConfig) {
      signals.push(
        buildSignal({
          prefix: "deployment_changed",
          projectId,
          observedAt,
          signalType: "deployment.config.changed",
          summary: `Deployment/config path changed in the selected contribution window: ${entry.path}.`,
          sourceEventIds: [inventoryEventId],
          attribution,
          confidence: "high",
          path: entry.path,
          data: {
            path: entry.path,
            status: entry.status
          }
        })
      );
    }

    if (classification.isDependencyFile) {
      signals.push(
        buildSignal({
          prefix: "dependency_changed",
          projectId,
          observedAt,
          signalType: "dependency.file.changed",
          summary: `Dependency or package file changed in the selected contribution window: ${entry.path}.`,
          sourceEventIds: [inventoryEventId],
          attribution,
          confidence: "medium",
          path: entry.path,
          data: {
            path: entry.path,
            status: entry.status
          }
        })
      );
    }
  }

  const unchangedTrackedFiles = trackedFiles.filter((path) => !changedPathSet.has(path));
  const changedRiskPaths = changedEntries
    .filter((entry) => classifyPath(entry.path).riskCategories.length > 0)
    .map((entry) => entry.path);
  const inventoryAttribution =
    comparison.mode === "unknown"
      ? attributionFor("unknown", ["no reliable comparison boundary was available"], "low")
      : attributionFor("pre_existing", ["tracked paths were present but not changed in the selected contribution window"], "medium");

  for (const path of unchangedTrackedFiles) {
    const classification = classifyPath(path);

    if (classification.isTest && changedRiskPaths.some((riskPath) => areRelatedPaths(riskPath, path))) {
      signals.push(
        buildSignal({
          prefix: "test_observed",
          projectId,
          observedAt,
          signalType: "test.file.observed",
          summary: `Nearby test path observed without raw source content: ${path}.`,
          sourceEventIds: [inventoryEventId],
          attribution: inventoryAttribution,
          confidence: inventoryAttribution.confidence,
          path,
          data: {
            path
          }
        })
      );
    }
  }

  signals.push(
    ...buildInventorySignals({
      projectId,
      observedAt,
      sourceEventId: inventoryEventId,
      attribution: inventoryAttribution,
      paths: unchangedTrackedFiles
    })
  );

  return {
    events,
    signals: dedupeSignals(signals),
    summary
  };
}

async function getRepoRoot(path: string): Promise<string> {
  try {
    return await git(path, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new CollectorError(`FirstRung alpha scans require a Git repository: ${path}`);
  }
}

async function readCurrentBranch(repoRoot: string): Promise<string> {
  const branch = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch.length > 0 ? branch : "HEAD";
}

async function readVerifiedCommit(repoRoot: string, ref: string, message: string): Promise<string> {
  try {
    return await git(repoRoot, ["rev-parse", "--short=12", `${ref}^{commit}`]);
  } catch {
    throw new CollectorError(message);
  }
}

async function resolveComparison(
  repoRoot: string,
  currentBranch: string,
  targetRef: string,
  workingTreeChangeCount: number,
  since?: string
): Promise<{ baselineRef?: string; mode: AttributionMode; reason: string }> {
  if (since) {
    await readVerifiedCommit(repoRoot, since, `Could not resolve --since ref '${since}'.`);
    return {
      baselineRef: since,
      mode: "since",
      reason: `You passed --since ${since}, so I treated changes after that ref and current working-tree paths as active work.`
    };
  }

  if (workingTreeChangeCount > 0) {
    return {
      mode: "working_tree",
      reason: "I found uncommitted changes and no --since ref was provided, so I focused on the working tree."
    };
  }

  const fallback = await findFallbackBase(repoRoot, currentBranch, targetRef);
  if (fallback) {
    return {
      baselineRef: fallback,
      mode: "branch",
      reason: `No --since ref was provided and the working tree looked clean, so I compared ${targetRef} with ${fallback}.`
    };
  }

  return {
    mode: "unknown",
    reason: "I could not find a working-tree change set or a reliable branch baseline, so attribution is conservative."
  };
}

async function findFallbackBase(repoRoot: string, currentBranch: string, targetRef: string): Promise<string | undefined> {
  const candidates = ["main", "master", "origin/main", "origin/master"];

  for (const candidate of candidates) {
    if (candidate === currentBranch || candidate === targetRef) {
      continue;
    }

    if (await refExists(repoRoot, candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function refExists(repoRoot: string, ref: string): Promise<boolean> {
  try {
    await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

async function readChangedEntries(repoRoot: string, baselineRef: string, targetRef: string): Promise<ChangedEntry[]> {
  const range = `${baselineRef}...${targetRef}`;

  try {
    return parseNameStatus(await git(repoRoot, ["diff", "--name-status", "-z", "--find-renames", range]));
  } catch {
    return parseNameStatus(await git(repoRoot, ["diff", "--name-status", "-z", "--find-renames", `${baselineRef}..${targetRef}`]));
  }
}

async function readTrackedFiles(repoRoot: string): Promise<string[]> {
  const output = await git(repoRoot, ["ls-files", "-z"]);
  return output
    .split("\0")
    .filter((path) => path.length > 0)
    .map(normalizeGitPath)
    .sort();
}

async function readWorkingTreeEntries(repoRoot: string): Promise<ChangedEntry[]> {
  const output = await git(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  return parsePorcelainStatus(output);
}

async function readCommitSummaries(repoRoot: string, baselineRef: string | undefined, targetRef: string): Promise<CommitSummary[]> {
  const range = baselineRef ? `${baselineRef}..${targetRef}` : targetRef;
  const output = await git(repoRoot, ["log", "--max-count=20", "--date=iso-strict", "--pretty=format:%h%x09%aI%x09%s", range]);

  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [shortHash, authoredAt, ...summaryParts] = line.split("\t");
      return {
        shortHash: shortHash ?? "unknown",
        authoredAt: authoredAt ?? "unknown",
        summary: summaryParts.join("\t")
      };
    });
}

function parseNameStatus(output: string): ChangedEntry[] {
  const parts = output.split("\0");
  const entries: ChangedEntry[] = [];
  let index = 0;

  while (index < parts.length) {
    const status = parts[index];
    index += 1;

    if (!status) {
      continue;
    }

    let path = parts[index];
    index += 1;

    if (status.startsWith("R") || status.startsWith("C")) {
      path = parts[index];
      index += 1;
    }

    if (path) {
      entries.push({
        status,
        path: normalizeGitPath(path)
      });
    }
  }

  return entries;
}

function parsePorcelainStatus(output: string): ChangedEntry[] {
  const parts = output.split("\0");
  const entries: ChangedEntry[] = [];
  let index = 0;

  while (index < parts.length) {
    const record = parts[index];
    index += 1;

    if (!record) {
      continue;
    }

    const rawStatus = record.slice(0, 2);
    let path = record.slice(3);

    if (rawStatus.includes("R") || rawStatus.includes("C")) {
      path = parts[index] ?? path;
      index += 1;
    }

    path = normalizeGitPath(path);

    if (path.length > 0 && !shouldIgnoreLocalPath(path)) {
      entries.push({
        status: `WT:${rawStatus.trim() || rawStatus}`,
        path
      });
    }
  }

  return entries;
}

function mergeChangedEntries(committed: ChangedEntry[], workingTree: ChangedEntry[]): ChangedEntry[] {
  const byPath = new Map<string, ChangedEntry>();

  for (const entry of committed) {
    if (!shouldIgnoreLocalPath(entry.path)) {
      byPath.set(entry.path, entry);
    }
  }

  for (const entry of workingTree) {
    byPath.set(entry.path, entry);
  }

  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function shouldIgnoreLocalPath(path: string): boolean {
  return path === ".firstrung" || path.startsWith(".firstrung/");
}

function classifyPath(path: string): PathClassification {
  const normalized = normalizeGitPath(path);
  const lower = normalized.toLowerCase();
  const segments = lower.split("/");
  const fileName = segments[segments.length - 1] ?? lower;
  const riskCategories = new Set<string>();
  const isDeploymentConfig = matchesDeploymentConfig(lower, segments, fileName);

  if (matchesAnySegment(segments, ["auth", "authentication", "login", "logout", "oauth", "jwt", "session", "sessions", "sso"])) {
    riskCategories.add("auth");
  }

  if (matchesAnySegment(segments, ["payment", "payments", "billing", "stripe", "checkout", "subscription", "subscriptions"])) {
    riskCategories.add("payments");
  }

  if (matchesAnySegment(segments, ["database", "databases", "db", "sql", "prisma", "drizzle", "schema"])) {
    riskCategories.add("database");
  }

  if (matchesAnySegment(segments, ["permission", "permissions", "rbac", "acl", "policy", "policies", "role", "roles"])) {
    riskCategories.add("permissions");
  }

  if (matchesAnySegment(segments, ["migration", "migrations"])) {
    riskCategories.add("migrations");
  }

  if (matchesAnySegment(segments, ["secret", "secrets", "credential", "credentials", "config", "configs"]) || fileName.startsWith(".env")) {
    riskCategories.add("secrets_config");
  }

  if (isDeploymentConfig) {
    riskCategories.add("infrastructure_deploy");
  }

  const isTest = matchesTestPath(lower, segments, fileName);
  const isDependencyFile = matchesDependencyFile(fileName);
  const isDocumentation =
    fileName.startsWith("readme") ||
    segments.includes("docs") ||
    segments.includes("documentation") ||
    segments.includes("openspec");
  const isCode = matchesCodePath(fileName);
  const categories = categoriesFor({
    riskCategories: [...riskCategories],
    isTest,
    isDeploymentConfig,
    isDependencyFile,
    isDocumentation,
    isCode
  });

  return {
    path: normalized,
    categories,
    riskCategories: [...riskCategories],
    isTest,
    isDeploymentConfig,
    isDependencyFile,
    isDocumentation,
    isCode
  };
}

function categoriesFor(input: {
  riskCategories: string[];
  isTest: boolean;
  isDeploymentConfig: boolean;
  isDependencyFile: boolean;
  isDocumentation: boolean;
  isCode: boolean;
}): string[] {
  const categories = new Set<string>();

  if (input.isCode) {
    categories.add("code");
  }

  if (input.isTest) {
    categories.add("test");
  }

  if (input.isDeploymentConfig) {
    categories.add("deploy_config");
  }

  if (input.isDependencyFile) {
    categories.add("dependency");
  }

  if (input.isDocumentation) {
    categories.add("docs");
  }

  if (input.riskCategories.length > 0) {
    categories.add("risk_sensitive");
  }

  if (categories.size === 0) {
    categories.add("other");
  }

  return [...categories];
}

function matchesAnySegment(segments: string[], markers: string[]): boolean {
  return segments.some((segment) => {
    const tokens = segment.split(/[^a-z0-9]+/).filter(Boolean);
    return tokens.some((token) => markers.includes(token));
  });
}

function matchesTestPath(lower: string, segments: string[], fileName: string): boolean {
  return (
    segments.includes("__tests__") ||
    segments.includes("test") ||
    segments.includes("tests") ||
    fileName.includes(".test.") ||
    fileName.includes(".spec.") ||
    lower.endsWith("_test.go") ||
    lower.endsWith("_test.py")
  );
}

function matchesDependencyFile(fileName: string): boolean {
  return [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "requirements.txt",
    "pyproject.toml",
    "poetry.lock",
    "cargo.toml",
    "cargo.lock",
    "go.mod",
    "go.sum",
    "gemfile",
    "gemfile.lock",
    "composer.json",
    "composer.lock"
  ].includes(fileName);
}

function matchesCodePath(fileName: string): boolean {
  return /\.(c|cc|cpp|cs|css|go|java|js|jsx|kt|mjs|py|rb|rs|scss|swift|ts|tsx|vue)$/.test(fileName);
}

function matchesDeploymentConfig(lower: string, segments: string[], fileName: string): boolean {
  return (
    lower.startsWith(".github/workflows/") ||
    segments.includes("deploy") ||
    segments.includes("deployment") ||
    segments.includes("deployments") ||
    segments.includes("infra") ||
    segments.includes("infrastructure") ||
    segments.includes("terraform") ||
    segments.includes("k8s") ||
    segments.includes("helm") ||
    [
      "dockerfile",
      "docker-compose.yml",
      "docker-compose.yaml",
      "vercel.json",
      "netlify.toml",
      "fly.toml",
      "railway.json",
      "railway.toml",
      "render.yaml",
      "serverless.yml",
      "serverless.yaml",
      "wrangler.toml",
      "cloudbuild.yaml",
      "app.yaml",
      ".env.example"
    ].includes(fileName)
  );
}

function attributionFor(kind: AttributionKind, basis: string[], confidence: Confidence): ContributionAttribution {
  return {
    kind,
    confidence,
    basis
  };
}

function buildInventorySignals(input: {
  projectId: string;
  observedAt: string;
  sourceEventId: string;
  attribution: ContributionAttribution;
  paths: string[];
}): EvidenceSignal[] {
  const ageLabel = input.attribution.kind === "pre_existing" ? "pre-existing " : "";
  const groups = [
    {
      prefix: "risk_observed",
      signalType: "risk.file.observed",
      label: "risk-sensitive",
      paths: input.paths.filter((path) => classifyPath(path).riskCategories.length > 0)
    },
    {
      prefix: "deployment_observed",
      signalType: "deployment.config.observed",
      label: "deployment/config",
      paths: input.paths.filter((path) => classifyPath(path).isDeploymentConfig)
    },
    {
      prefix: "dependency_observed",
      signalType: "dependency.file.observed",
      label: "dependency or package",
      paths: input.paths.filter((path) => classifyPath(path).isDependencyFile)
    },
    {
      prefix: "documentation_observed",
      signalType: "documentation.observed",
      label: "README or docs",
      paths: input.paths.filter((path) => classifyPath(path).isDocumentation)
    }
  ];

  return groups
    .filter((group) => group.paths.length > 0)
    .map((group) =>
      buildAggregateSignal({
        prefix: group.prefix,
        projectId: input.projectId,
        observedAt: input.observedAt,
        signalType: group.signalType,
        summary: `Observed ${group.paths.length} ${ageLabel}${group.label} path${group.paths.length === 1 ? "" : "s"} without raw file contents.`,
        sourceEventIds: [input.sourceEventId],
        attribution: input.attribution,
        confidence: input.attribution.confidence,
        data: {
          count: group.paths.length,
          samplePaths: group.paths.slice(0, 20),
          rawContentIncluded: false
        }
      })
    );
}

function buildSignal(input: {
  prefix: string;
  projectId: string;
  observedAt: string;
  signalType: string;
  summary: string;
  sourceEventIds: string[];
  attribution: ContributionAttribution;
  confidence: Confidence;
  path: string;
  data: JsonObject;
}): EvidenceSignal {
  return {
    id: `signal_${input.prefix}_${slug(input.path)}`,
    projectId: input.projectId,
    source: "git",
    signalType: input.signalType,
    observedAt: input.observedAt,
    summary: input.summary,
    sourceEventIds: input.sourceEventIds,
    attribution: input.attribution,
    confidence: input.confidence,
    refs: [
      {
        kind: "file",
        label: input.path,
        locator: input.path,
        redacted: true
      }
    ],
    data: {
      ...input.data,
      rawContentIncluded: false
    }
  };
}

function buildAggregateSignal(input: {
  prefix: string;
  projectId: string;
  observedAt: string;
  signalType: string;
  summary: string;
  sourceEventIds: string[];
  attribution: ContributionAttribution;
  confidence: Confidence;
  data: JsonObject;
}): EvidenceSignal {
  return {
    id: `signal_${input.prefix}_inventory`,
    projectId: input.projectId,
    source: "git",
    signalType: input.signalType,
    observedAt: input.observedAt,
    summary: input.summary,
    sourceEventIds: input.sourceEventIds,
    attribution: input.attribution,
    confidence: input.confidence,
    data: input.data
  };
}

function dedupeSignals(signals: EvidenceSignal[]): EvidenceSignal[] {
  const seen = new Set<string>();
  const deduped: EvidenceSignal[] = [];

  for (const signal of signals) {
    if (seen.has(signal.id)) {
      continue;
    }

    seen.add(signal.id);
    deduped.push(signal);
  }

  return deduped;
}

function normalizeGitPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function slug(value: string): string {
  const slugged = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slugged.length > 0 ? slugged.slice(0, 96) : "unknown";
}

function areRelatedPaths(left: string, right: string): boolean {
  const leftParts = normalizeGitPath(left).toLowerCase().split("/").filter(Boolean);
  const rightParts = normalizeGitPath(right).toLowerCase().split("/").filter(Boolean);
  const leftBase = baseWithoutTestTokens(leftParts[leftParts.length - 1] ?? "");
  const rightBase = baseWithoutTestTokens(rightParts[rightParts.length - 1] ?? "");
  const sharedDirectoryDepth = commonPrefixLength(leftParts.slice(0, -1), rightParts.slice(0, -1));

  return (
    (leftBase.length > 0 && rightBase.length > 0 && leftBase === rightBase) ||
    sharedDirectoryDepth >= Math.max(1, Math.min(leftParts.length, rightParts.length) - 2) ||
    sharedPathToken(leftParts, rightParts)
  );
}

function baseWithoutTestTokens(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/\.(test|spec)$/, "")
    .replace(/[_-](test|spec)$/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function commonPrefixLength(left: string[], right: string[]): number {
  let count = 0;

  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      break;
    }

    count += 1;
  }

  return count;
}

function sharedPathToken(left: string[], right: string[]): boolean {
  const ignored = new Set(["src", "app", "lib", "server", "client", "test", "tests", "__tests__", "spec", "specs"]);
  const leftTokens = new Set(left.flatMap((part) => part.split(/[^a-z0-9]+/)).filter((part) => part.length > 2 && !ignored.has(part)));

  return right
    .flatMap((part) => part.split(/[^a-z0-9]+/))
    .some((part) => part.length > 2 && leftTokens.has(part));
}

function optional<T extends Record<string, unknown>>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

function git(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 8
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          error.stdout = stdout;
          reject(error);
          return;
        }

        resolveOutput(stdout.trim());
      }
    );
  });
}
