import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { CLI_STATIC_METADATA, runCli } from "../dist/index.js";

describe("firstrung CLI", () => {
  it("keeps published compatibility metadata aligned with runtime constants", async () => {
    const packageMetadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

    assert.deepEqual(packageMetadata.firstrung, CLI_STATIC_METADATA);
  });

  it("requires a repo path for scan", async () => {
    const result = await runCli(["scan"]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.includes("Usage: firstrung scan <repo>"), true);
  });

  it("guides users to the optional FirstRung Coach package without depending on it", async () => {
    const result = await runCli(["coach"]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.includes("FirstRung Coach is provided by the optional @firstrung/pi-coach package."), true);
    assert.equal(result.stderr.includes("Install and run: firstrung-coach coach <repo>"), true);
  });

  it("prints a summary and writes no files by default", async () => {
    const repo = await makeRepoWithAuthTests();
    const result = await runCli(["scan", repo.path, "--since", repo.baseline]);
    const lines = result.stdout.trim().split("\n");
    const words = result.stdout.trim().split(/\s+/);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.includes("FirstRung —"), true);
    assert.equal(
      result.stdout.includes(
        "Path relation: src/auth/session.ts matched auth and a closely related changed test path; test execution was not observed."
      ),
      true
    );
    assert.equal(result.stdout.includes("nothing uploaded"), true);
    assert.equal(result.stdout.includes("You "), false);
    assert.equal(result.stdout.includes("FirstRung wrote:"), false);
    assert.equal(lines.length <= 5, true);
    assert.equal(words.length <= 65, true);
    await assert.rejects(() => access(join(repo.path, ".firstrung")));
  });

  it("names one representative path and category for a risk gap", async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, "README.md"), "# Fixture\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial readme"]);
    const baseline = git(repo, ["rev-parse", "HEAD"]);
    await mkdir(join(repo, "src", "auth"), { recursive: true });
    await writeFile(join(repo, "src", "auth", "session.ts"), "export const session = true;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "add auth session"]);

    const result = await runCli(["scan", repo, "--since", baseline]);

    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.includes(
        "Path heuristic: src/auth/session.ts matched auth; no closely related test path was found."
      ),
      true
    );
    assert.equal(result.stdout.trim().split("\n").length <= 5, true);
    assert.equal(result.stdout.trim().split(/\s+/).length <= 65, true);
  });

  it("prints scope, limitations, privacy detail, and versions only with --explain", async () => {
    const repo = await makeRepoWithAuthTests();
    const result = await runCli(["scan", repo.path, "--since", repo.baseline, "--explain"]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.includes("Repository:"), true);
    assert.equal(result.stdout.includes("do not prove authorship or test execution"), true);
    assert.equal(result.stdout.includes("Versions: schema firstrung.scan.v1"), true);
    assert.equal(result.stdout.trim().split("\n").length > 5, true);
  });

  it("writes scan.json when --out is provided", async () => {
    const repo = await makeRepoWithAuthTests();
    const outDir = await mkdtemp(join(tmpdir(), "firstrung-cli-report-"));
    const result = await runCli(["scan", repo.path, "--since", repo.baseline, "--out", outDir]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.includes("FirstRung —"), true);
    assert.equal(result.stdout.includes("scan.json"), true);
    assert.equal(result.stdout.includes("evidence-signals.json"), false);

    const scan = JSON.parse(await readFile(join(outDir, "scan.json"), "utf8"));

    assert.equal(scan.summary.projectId.startsWith("project_"), true);
    assert.equal(scan.signals.some((signal) => signal.signalType === "file.changed"), true);
    assert.equal(scan.signals.some((signal) => signal.attribution.kind === "change_window"), true);
    assert.equal(scan.signals.some((signal) => signal.attribution.kind === "pre_existing"), true);
    assert.equal(scan.rules.some((rule) => rule.ruleId === "rule_tests_near_risky_files" && rule.matched), true);
    assert.equal(scan.rules.every((rule) => !rule.evidenceTierImpact?.includes("verified")), true);
    assert.equal(scan.provenance.rendererVersion, "2026-07-10.1");
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

    assert.equal(report.includes("A changed test path was observed near a potentially risk-sensitive change."), true);
    assert.equal(report.includes("Raw code, prompts, diffs"), true);
    assert.equal(report.includes("You "), false);
    assert.equal(report.includes("RAW_CODE_SENTINEL"), false);
    assert.equal(evidence.some((signal) => signal.attribution.kind === "change_window"), true);
  });

  it("prints a safe local feedback packet and never accepts free-form repository data", async () => {
    const result = await runCli([
      "feedback",
      "--accuracy",
      "partly_accurate",
      "--helpfulness",
      "3",
      "--action",
      "planned",
      "--reason",
      "too_wordy",
      "--rule",
      "rule_tests_near_risky_files"
    ]);
    const packet = JSON.parse(result.stdout);

    assert.equal(result.exitCode, 0);
    assert.equal(packet.transport, "local_preview");
    assert.equal(packet.schemaVersion, "firstrung.feedback.v1");
    assert.equal(packet.rulesetVersion, "2026-07-10.1");
    assert.deepEqual(packet.reasons, ["too_wordy"]);
    assert.equal("repoPath" in packet, false);
    assert.equal("commit" in packet, false);
    assert.equal("output" in packet, false);

    const rejected = await runCli([
      "feedback",
      "--accuracy",
      "wrong",
      "--helpfulness",
      "1",
      "--action",
      "ignored",
      "--rule",
      "/private/repo/path"
    ]);

    assert.equal(rejected.exitCode, 1);
    assert.equal(rejected.stdout, "");
  });

  it("requires --out for non-summary formats", async () => {
    const repo = await makeRepoWithAuthTests();
    const result = await runCli(["scan", repo.path, "--format", "markdown"]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.includes("require --out"), true);
    assert.equal(result.stderr.includes("firstrung scan <repo> --out .firstrung/report --format markdown"), true);
  });

  it("checks local prerequisites with doctor", async () => {
    const result = await runCli(["doctor"]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.includes("FirstRung doctor"), true);
    assert.equal(result.stdout.includes("Node.js"), true);
    assert.equal(result.stdout.includes("npm"), true);
    assert.equal(result.stdout.includes("Git"), true);
    assert.equal(result.stdout.includes("firstrung doctor <repo>"), true);
  });

  it("validates a Git repository target with doctor", async () => {
    const repo = await makeRepo();
    const result = await runCli(["doctor", repo]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.includes("Repository: Git repository ready"), true);
    assert.equal(result.stdout.includes(repo), true);
  });

  it("reports non-Git repository targets with doctor", async () => {
    const repo = await mkdtemp(join(tmpdir(), "firstrung-cli-not-git-"));
    const result = await runCli(["doctor", repo]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.includes("Not a Git repository"), true);
    assert.equal(result.stdout.includes("run git init first"), true);
  });

  it("keeps install checks silent when prerequisites are present", async () => {
    const result = await runCli(["doctor", "--install-check"]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
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
