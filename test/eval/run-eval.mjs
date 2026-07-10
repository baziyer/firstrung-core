import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { collectRepository } from "../../packages/collector/dist/index.js";
import {
  REPORT_RENDERER_VERSION,
  renderMarkdownReport,
  renderTerminalSummary
} from "../../packages/report/dist/index.js";
import {
  ALPHA_RULESET_VERSION,
  ALPHA_TEMPLATE_VERSION,
  runAlphaRules
} from "../../packages/rules/dist/index.js";
import { SCAN_SCHEMA_VERSION } from "../../packages/schema/dist/index.js";
import { evaluationExitCode, validateCorpusPolicy } from "./policy.mjs";

const evalDir = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(await readFile(join(evalDir, "corpus.v1.json"), "utf8"));
const caseResults = [];

for (const evalCase of corpus.cases) {
  try {
    const evaluated = evalCase.kind === "repository"
      ? await evaluateRepositoryCase(evalCase)
      : evaluateRuleCase(evalCase);
    caseResults.push(scoreCase(evalCase, evaluated));
  } catch (error) {
    caseResults.push({
      id: evalCase.id,
      category: evalCase.category,
      passed: false,
      failures: [error instanceof Error ? error.message : "Unknown evaluation error"]
    });
  }
}

const failedCases = caseResults.filter((result) => !result.passed);
const policyFailures = validateCorpusPolicy(corpus.dataPolicy);
const report = {
  schemaVersion: "firstrung.eval.report.v1",
  corpusVersion: corpus.corpusVersion,
  dataPolicy: corpus.dataPolicy,
  provenance: {
    scanSchemaVersion: SCAN_SCHEMA_VERSION,
    rulesetVersion: ALPHA_RULESET_VERSION,
    templateVersion: ALPHA_TEMPLATE_VERSION,
    rendererVersion: REPORT_RENDERER_VERSION
  },
  totals: {
    cases: caseResults.length,
    passed: caseResults.length - failedCases.length,
    failed: failedCases.length
  },
  gates: {
    syntheticOnly: corpus.dataPolicy.classification === "synthetic_only",
    noHumanFeedback: corpus.dataPolicy.containsHumanFeedback === false,
    noRepositoryData: corpus.dataPolicy.containsRepositoryData === false,
    networkDisabled: corpus.dataPolicy.networkAllowed === false,
    allCasesPassed: failedCases.length === 0,
    policyCompliant: policyFailures.length === 0
  },
  policyFailures,
  cases: caseResults
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = evaluationExitCode(failedCases.length, policyFailures);

function evaluateRuleCase(evalCase) {
  const signals = evalCase.signals.map((item, index) => signalFromFixture(evalCase.id, item, index));
  return evaluateSignals(evalCase.id, signals);
}

async function evaluateRepositoryCase(evalCase) {
  const repo = await mkdtemp(join(tmpdir(), "firstrung-eval-"));

  try {
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "eval@example.invalid"]);
    git(repo, ["config", "user.name", "FirstRung Synthetic Eval"]);

    for (const file of evalCase.baselineFiles) {
      await writeFixtureFile(repo, file.path, file.content);
    }

    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "synthetic baseline"]);

    for (const change of evalCase.changes) {
      if (change.operation === "write") {
        await writeFixtureFile(repo, change.path, change.content);
      } else if (change.operation === "delete") {
        git(repo, ["rm", change.path]);
      } else if (change.operation === "rename") {
        git(repo, ["mv", change.path, change.to]);
      } else {
        throw new Error(`Unsupported synthetic operation: ${change.operation}`);
      }
    }

    const collection = await collectRepository({
      repoPath: repo,
      now: new Date("2026-07-10T10:00:00.000Z")
    });
    return evaluateSignals(evalCase.id, collection.signals, collection.summary);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

function evaluateSignals(caseId, signals, suppliedSummary) {
  const rules = runAlphaRules({
    projectId: `project_eval_${caseId.replace(/[^a-z0-9]+/g, "_")}`,
    signals,
    now: new Date("2026-07-10T10:00:00.000Z")
  });
  const summary = suppliedSummary ?? syntheticSummary(caseId, signals);
  const model = {
    provenance: {
      schemaVersion: SCAN_SCHEMA_VERSION,
      rulesetVersion: ALPHA_RULESET_VERSION,
      templateVersion: ALPHA_TEMPLATE_VERSION,
      rendererVersion: REPORT_RENDERER_VERSION
    },
    summary,
    evidenceSignals: signals,
    ruleResults: rules.ruleResults,
    skillEpisodes: rules.skillEpisodes
  };

  return {
    signals,
    ruleResults: rules.ruleResults,
    skillEpisodes: rules.skillEpisodes,
    terminal: renderTerminalSummary(model),
    markdown: renderMarkdownReport(model)
  };
}

function scoreCase(evalCase, evaluated) {
  const expect = effectiveExpect(evalCase.expect);
  const failures = [];
  const matchedRuleIds = new Set(evaluated.ruleResults.filter((result) => result.matched).map((result) => result.ruleId));
  const signalTypes = evaluated.signals.map((signal) => signal.signalType);
  const evidenceTiers = [
    ...evaluated.ruleResults.flatMap((result) => result.evidenceTierImpact ?? []),
    ...evaluated.skillEpisodes.flatMap((episode) => episode.evidenceTier)
  ];

  for (const ruleId of expect.includeRuleIds ?? []) {
    if (!matchedRuleIds.has(ruleId)) failures.push(`missing rule ${ruleId}`);
  }

  for (const ruleId of expect.excludeRuleIds ?? []) {
    if (matchedRuleIds.has(ruleId)) failures.push(`unexpected rule ${ruleId}`);
  }

  for (const signalType of expect.includeSignalTypes ?? []) {
    if (!signalTypes.includes(signalType)) failures.push(`missing signal ${signalType}`);
  }

  for (const prefix of expect.excludeSignalPrefixes ?? []) {
    if (signalTypes.some((type) => type.startsWith(prefix))) failures.push(`unexpected signal prefix ${prefix}`);
  }

  for (const [signalType, expectedCount] of Object.entries(expect.signalTypeCounts ?? {})) {
    const actualCount = signalTypes.filter((type) => type === signalType).length;
    if (actualCount !== expectedCount) failures.push(`expected ${expectedCount} ${signalType} signals, found ${actualCount}`);
  }

  for (const path of expect.includeSignalPaths ?? []) {
    if (!evaluated.signals.some((signal) => signal.data?.path === path)) failures.push(`missing signal path ${path}`);
  }

  if (expect.uniqueSignalIds && new Set(evaluated.signals.map(({ id }) => id)).size !== evaluated.signals.length) {
    failures.push("signal ids were not unique");
  }

  if (expect.changedAttribution) {
    const changedSignals = evaluated.signals.filter((signal) => signal.signalType === "file.changed");
    if (changedSignals.some((signal) => signal.attribution.kind !== expect.changedAttribution)) {
      failures.push(`changed-path attribution was not ${expect.changedAttribution}`);
    }
  }

  if (expect.allowedEvidenceTiers) {
    const allowed = new Set(expect.allowedEvidenceTiers);
    for (const tier of evidenceTiers) {
      if (!allowed.has(tier)) failures.push(`disallowed evidence tier ${tier}`);
    }
  }

  const lineCount = evaluated.terminal.trim().split("\n").length;
  const wordCount = evaluated.terminal.trim().split(/\s+/).filter(Boolean).length;
  const markdownLineCount = evaluated.markdown.trim().split("\n").length;
  const markdownWordCount = evaluated.markdown.trim().split(/\s+/).filter(Boolean).length;
  if (expect.maxLines && lineCount > expect.maxLines) failures.push(`copy has ${lineCount} lines`);
  if (expect.maxWords && wordCount > expect.maxWords) failures.push(`copy has ${wordCount} words`);
  if (expect.maxMarkdownLines && markdownLineCount > expect.maxMarkdownLines) {
    failures.push(`markdown has ${markdownLineCount} lines`);
  }
  if (expect.maxMarkdownWords && markdownWordCount > expect.maxMarkdownWords) {
    failures.push(`markdown has ${markdownWordCount} words`);
  }

  for (const required of expect.requiredText ?? []) {
    if (!evaluated.terminal.includes(required)) failures.push(`copy is missing required text ${required}`);
  }

  for (const forbidden of expect.forbiddenText ?? []) {
    if (evaluated.terminal.includes(forbidden)) failures.push(`copy contains forbidden text ${forbidden}`);
  }

  for (const required of expect.requiredMarkdownText ?? []) {
    if (!evaluated.markdown.includes(required)) failures.push(`markdown is missing required text ${required}`);
  }

  for (const forbidden of expect.forbiddenMarkdownText ?? []) {
    if (evaluated.markdown.includes(forbidden)) failures.push(`markdown contains forbidden text ${forbidden}`);
  }

  return {
    id: evalCase.id,
    category: evalCase.category,
    passed: failures.length === 0,
    failures,
    metrics: { lineCount, wordCount, markdownLineCount, markdownWordCount }
  };
}

function effectiveExpect(caseExpect) {
  const defaults = corpus.defaults?.expect ?? {};
  return {
    ...defaults,
    ...caseExpect,
    maxLines: strictestBudget(defaults.maxLines, caseExpect.maxLines),
    maxWords: strictestBudget(defaults.maxWords, caseExpect.maxWords),
    maxMarkdownLines: strictestBudget(defaults.maxMarkdownLines, caseExpect.maxMarkdownLines),
    maxMarkdownWords: strictestBudget(defaults.maxMarkdownWords, caseExpect.maxMarkdownWords),
    forbiddenText: [...new Set([...(defaults.forbiddenText ?? []), ...(caseExpect.forbiddenText ?? [])])],
    forbiddenMarkdownText: [
      ...new Set([...(defaults.forbiddenMarkdownText ?? []), ...(caseExpect.forbiddenMarkdownText ?? [])])
    ]
  };
}

function strictestBudget(defaultValue, caseValue) {
  if (typeof defaultValue === "number" && typeof caseValue === "number") return Math.min(defaultValue, caseValue);
  return caseValue ?? defaultValue;
}


function signalFromFixture(caseId, item, index) {
  return {
    id: `signal_eval_${caseId.replace(/[^a-z0-9]+/g, "_")}_${index}`,
    projectId: `project_eval_${caseId.replace(/[^a-z0-9]+/g, "_")}`,
    source: "git",
    signalType: item.type,
    observedAt: "2026-07-10T10:00:00.000Z",
    summary: item.summary ?? `${item.type} observed in synthetic fixture.`,
    sourceEventIds: ["event_synthetic_eval"],
    attribution: {
      kind: item.attribution,
      confidence: item.attribution === "change_window" ? "high" : "medium",
      basis: ["synthetic labelled evaluation fixture", "person attribution was not evaluated"]
    },
    confidence: item.type.startsWith("risk.file.") ? "medium" : "high",
    refs: [{ kind: "file", label: item.path, locator: item.path, redacted: true }],
    data: {
      path: item.path,
      categories: item.categories ?? [],
      ...(item.type.startsWith("risk.file.") ? { riskCategories: item.riskCategories ?? ["auth"] } : {}),
      rawContentIncluded: false
    }
  };
}

function syntheticSummary(caseId, signals) {
  return {
    projectId: `project_eval_${caseId.replace(/[^a-z0-9]+/g, "_")}`,
    projectName: "synthetic-eval",
    requestedPath: "/synthetic/eval",
    repoRoot: "/synthetic/eval",
    currentBranch: "main",
    targetRef: "HEAD",
    targetCommit: "synthetic0001",
    attributionMode: "working_tree",
    attributionReason: "Scope: synthetic changed paths. This identifies a Git window, not a person.",
    changedFileCount: Math.max(1, signals.filter((signal) => signal.signalType === "file.changed").length),
    trackedFileCount: signals.length,
    rawContentIncluded: false
  };
}

async function writeFixtureFile(repo, relativePath, content) {
  const absolutePath = join(repo, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
