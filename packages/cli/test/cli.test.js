import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { runCli } from "../dist/index.js";

describe("firstrung CLI", () => {
  it("requires a repo path for scan", async () => {
    const result = await runCli(["scan"]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.includes("Usage: firstrung scan <repo>"), true);
  });

  it("prints a summary and writes no files by default", async () => {
    const repo = await makeRepoWithAuthTests();
    const result = await runCli(["scan", repo.path, "--since", repo.baseline]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.includes("FirstRung scanned"), true);
    assert.equal(result.stdout.includes("You changed"), true);
    assert.equal(result.stdout.includes("Nothing was uploaded."), true);
    assert.equal(result.stdout.includes("FirstRung wrote:"), false);
    await assert.rejects(() => access(join(repo.path, ".firstrung")));
  });

  it("writes scan.json when --out is provided", async () => {
    const repo = await makeRepoWithAuthTests();
    const outDir = await mkdtemp(join(tmpdir(), "firstrung-cli-report-"));
    const result = await runCli(["scan", repo.path, "--since", repo.baseline, "--out", outDir]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.includes("FirstRung scanned"), true);
    assert.equal(result.stdout.includes("scan.json"), true);
    assert.equal(result.stdout.includes("evidence-signals.json"), false);

    const scan = JSON.parse(await readFile(join(outDir, "scan.json"), "utf8"));

    assert.equal(scan.summary.projectId.startsWith("project_"), true);
    assert.equal(scan.signals.some((signal) => signal.signalType === "file.changed"), true);
    assert.equal(scan.signals.some((signal) => signal.attribution.kind === "candidate_contributed"), true);
    assert.equal(scan.signals.some((signal) => signal.attribution.kind === "pre_existing"), true);
    assert.equal(scan.rules.some((rule) => rule.ruleId === "rule_tests_near_risky_files" && rule.matched), true);
    assert.equal(JSON.stringify(scan).includes("RAW_CODE_SENTINEL"), false);
    await assert.rejects(() => access(join(outDir, "report.md")));
  });

  it("writes optional markdown and debug artifacts when explicitly requested", async () => {
    const repo = await makeRepoWithAuthTests();
    const outDir = await mkdtemp(join(tmpdir(), "firstrung-cli-report-debug-"));
    const result = await runCli([
      "scan",
      repo.path,
      "--since",
      repo.baseline,
      "--out",
      outDir,
      "--format",
      "all",
      "--debug-artifacts"
    ]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.includes("scan.json"), true);
    assert.equal(result.stdout.includes("report.md"), true);
    assert.equal(result.stdout.includes("evidence-signals.json"), true);

    const report = await readFile(join(outDir, "report.md"), "utf8");
    const evidence = JSON.parse(await readFile(join(outDir, "evidence-signals.json"), "utf8"));

    assert.equal(report.includes("You added tests near risk-sensitive changes."), true);
    assert.equal(report.includes("I did not include raw code"), true);
    assert.equal(report.includes("RAW_CODE_SENTINEL"), false);
    assert.equal(evidence.some((signal) => signal.attribution.kind === "candidate_contributed"), true);
  });

  it("requires --out for non-summary formats", async () => {
    const repo = await makeRepoWithAuthTests();
    const result = await runCli(["scan", repo.path, "--format", "markdown"]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.includes("require --out"), true);
  });
});

async function makeRepoWithAuthTests() {
    const repo = await makeRepo();
    await writeFile(join(repo, "vercel.json"), "{}\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial deploy"]);
    const baseline = git(repo, ["rev-parse", "HEAD"]);

    await mkdir(join(repo, "src", "auth"), { recursive: true });
    await writeFile(join(repo, "src", "auth", "session.ts"), "export const sentinel = 'RAW_CODE_SENTINEL';\n");
    await writeFile(join(repo, "src", "auth", "session.test.ts"), "test('auth', () => {});\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "add auth tests"]);

  return { path: repo, baseline };
}

async function makeRepo() {
  const repo = await mkdtemp(join(tmpdir(), "firstrung-cli-"));
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "test@example.invalid"]);
  git(repo, ["config", "user.name", "FirstRung Test"]);
  return repo;
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
