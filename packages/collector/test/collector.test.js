import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { CollectorError, collectRepository } from "../dist/index.js";

describe("@firstrung/collector", () => {
  it("attributes changed risk paths and pre-existing deployment config without raw content", async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, "vercel.json"), '{"buildCommand":"npm run build"}\n');
    await writeFile(join(repo, "README.md"), "# Private implementation notes should not be copied\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial deployment config"]);
    const baseline = git(repo, ["rev-parse", "HEAD"]);

    await mkdir(join(repo, "src", "auth"), { recursive: true });
    await writeFile(join(repo, "src", "auth", "session.ts"), "export const rawCodeSentinel = 'RAW_CODE_SENTINEL';\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "add auth session"]);

    const result = await collectRepository({
      repoPath: repo,
      since: baseline,
      now: new Date("2026-06-30T10:00:00Z")
    });
    const riskChanged = result.signals.find((signal) => signal.signalType === "risk.file.added");
    const deploymentObserved = result.signals.find((signal) => signal.signalType === "deployment.config.observed");
    const serialized = JSON.stringify(result);

    assert.equal(result.summary.attributionMode, "since");
    assert.equal(riskChanged?.attribution.kind, "change_window");
    assert.equal(riskChanged?.confidence, "medium");
    assert.equal(deploymentObserved?.attribution.kind, "pre_existing");
    assert.equal(result.events.every((event) => event.rawContentIncluded === false), true);
    assert.equal(serialized.includes("RAW_CODE_SENTINEL"), false);
  });

  it("marks attribution unknown when no comparison boundary exists", async () => {
    const repo = await makeRepo();
    await mkdir(join(repo, "src", "auth"), { recursive: true });
    await writeFile(join(repo, "src", "auth", "session.ts"), "export const value = true;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial auth"]);

    const result = await collectRepository({
      repoPath: repo,
      now: new Date("2026-06-30T10:00:00Z")
    });
    const observed = result.signals.find((signal) => signal.signalType === "risk.file.observed");

    assert.equal(result.summary.attributionMode, "unknown");
    assert.equal(observed?.attribution.kind, "unknown");
  });

  it("treats dirty working-tree paths as change-window metadata without person attribution", async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, "README.md"), "# Fixture\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial readme"]);

    await mkdir(join(repo, "src", "auth"), { recursive: true });
    await writeFile(join(repo, "src", "auth", "session.ts"), "export const dirtySentinel = 'DIRTY_RAW_CODE';\n");

    const result = await collectRepository({
      repoPath: repo,
      now: new Date("2026-06-30T10:00:00Z")
    });
    const changed = result.signals.find((signal) => signal.signalType === "risk.file.added");
    const serialized = JSON.stringify(result);

    assert.equal(result.summary.changedFileCount, 1);
    assert.equal(changed?.attribution.kind, "change_window");
    assert.equal(changed?.attribution.basis.includes("person attribution was not evaluated"), true);
    assert.equal(serialized.includes("DIRTY_RAW_CODE"), false);
  });

  it("classifies OpenSpec-style dirty paths as docs rather than tests or risk-sensitive code", async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, "README.md"), "# Fixture\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial readme"]);

    await mkdir(join(repo, "openspec", "changes", "secure-checkout-success-handoff", "specs", "feature"), {
      recursive: true
    });
    await writeFile(
      join(repo, "openspec", "changes", "secure-checkout-success-handoff", "specs", "feature", "spec.md"),
      "## ADDED Requirements\n"
    );

    const result = await collectRepository({
      repoPath: repo,
      now: new Date("2026-06-30T10:00:00Z")
    });
    const changed = result.signals.find((signal) => signal.signalType === "file.changed");

    assert.deepEqual(changed?.data?.categories, ["docs"]);
    assert.equal(result.signals.some((signal) => signal.signalType === "test.file.changed"), false);
    assert.equal(result.signals.some((signal) => signal.signalType === "risk.file.changed"), false);
  });

  it("does not classify GitHub issue-template config.yml as secrets or deployment risk", async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, "README.md"), "# Fixture\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial readme"]);

    await mkdir(join(repo, ".github", "ISSUE_TEMPLATE"), { recursive: true });
    await writeFile(join(repo, ".github", "ISSUE_TEMPLATE", "config.yml"), "blank_issues_enabled: false\n");

    const result = await collectRepository({ repoPath: repo, now: new Date("2026-07-10T10:00:00Z") });
    const changed = result.signals.find((signal) => signal.signalType === "file.changed");

    assert.deepEqual(changed?.data?.categories, ["other"]);
    assert.equal(result.signals.some((signal) => signal.signalType.startsWith("risk.file.")), false);
    assert.equal(result.signals.some((signal) => signal.signalType.startsWith("deployment.config.")), false);
  });

  it("preserves a leading-dot path for the first unstaged porcelain entry", async () => {
    const repo = await makeRepo();
    await mkdir(join(repo, ".github", "workflows"), { recursive: true });
    await writeFile(join(repo, ".github", "workflows", "ci.yml"), "name: CI\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial workflow"]);

    await writeFile(join(repo, ".github", "workflows", "ci.yml"), "name: CI updated\n");
    const result = await collectRepository({ repoPath: repo, now: new Date("2026-07-10T10:00:00Z") });
    const deployment = result.signals.find((signal) => signal.signalType === "deployment.config.changed");

    assert.equal(deployment?.data?.path, ".github/workflows/ci.yml");
    assert.equal(deployment?.attribution.kind, "change_window");
  });

  it("keeps auth test-only changes out of production risk signals", async () => {
    const repo = await makeRepo();
    await mkdir(join(repo, "src", "auth"), { recursive: true });
    await writeFile(join(repo, "src", "auth", "session.test.ts"), "test('session', () => {});\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial test"]);

    await writeFile(join(repo, "src", "auth", "session.test.ts"), "test('session update', () => {});\n");
    const result = await collectRepository({ repoPath: repo, now: new Date("2026-07-10T10:00:00Z") });

    assert.equal(result.signals.some((signal) => signal.signalType === "test.file.changed"), true);
    assert.equal(result.signals.some((signal) => signal.signalType.startsWith("risk.file.")), false);
  });

  it("does not count removed or renamed test paths as present changed tests", async () => {
    const repo = await makeRepo();
    await mkdir(join(repo, "src", "auth"), { recursive: true });
    await writeFile(join(repo, "src", "auth", "session.test.ts"), "test('session', () => {});\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial test"]);

    git(repo, ["mv", "src/auth/session.test.ts", "src/auth/renamed-session.test.ts"]);
    let result = await collectRepository({ repoPath: repo, now: new Date("2026-07-10T10:00:00Z") });

    assert.equal(result.signals.some((signal) => signal.signalType === "test.file.renamed"), true);
    assert.equal(result.signals.some((signal) => signal.signalType === "test.file.added"), false);
    assert.equal(result.signals.some((signal) => signal.signalType === "test.file.changed"), false);

    git(repo, ["reset", "--hard", "HEAD"]);
    git(repo, ["rm", "src/auth/session.test.ts"]);
    result = await collectRepository({ repoPath: repo, now: new Date("2026-07-10T10:00:00Z") });

    assert.equal(result.signals.some((signal) => signal.signalType === "test.file.removed"), true);
    assert.equal(result.signals.some((signal) => signal.signalType === "test.file.added"), false);
    assert.equal(result.signals.some((signal) => signal.signalType === "test.file.changed"), false);
  });

  it("does not relate an unrelated same-directory test to a risk path", async () => {
    const repo = await makeRepo();
    await mkdir(join(repo, "src", "auth"), { recursive: true });
    await writeFile(join(repo, "src", "auth", "session.ts"), "export const session = true;\n");
    await writeFile(join(repo, "src", "auth", "permissions.test.ts"), "test('permissions', () => {});\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial auth"]);

    await writeFile(join(repo, "src", "auth", "session.ts"), "export const session = false;\n");
    const result = await collectRepository({ repoPath: repo, now: new Date("2026-07-10T10:00:00Z") });

    assert.equal(result.signals.some((signal) => signal.signalType === "risk.file.changed"), true);
    assert.equal(result.signals.some((signal) => signal.signalType === "test.file.observed"), false);
  });

  it("keeps distinct signals when readable path slugs collide", async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, "README.md"), "# Fixture\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial readme"]);

    await mkdir(join(repo, "src", "auth"), { recursive: true });
    await writeFile(join(repo, "src", "auth", "foo-bar.ts"), "export const dashed = true;\n");
    await writeFile(join(repo, "src", "auth", "foo_bar.ts"), "export const underscored = true;\n");

    const result = await collectRepository({ repoPath: repo, now: new Date("2026-07-10T10:00:00Z") });
    const riskSignals = result.signals.filter((signal) => signal.signalType === "risk.file.added");

    assert.deepEqual(riskSignals.map((signal) => signal.data.path).sort(), [
      "src/auth/foo-bar.ts",
      "src/auth/foo_bar.ts"
    ]);
    assert.equal(new Set(riskSignals.map((signal) => signal.id)).size, 2);
    assert.equal(riskSignals.every((signal) => /signal_risk_changed_src_auth_foo_bar_ts_[a-f0-9]{24}$/.test(signal.id)), true);
  });

  it("keeps deleted and renamed risk paths eligible for downstream rules and existing-test lookup", async () => {
    const repo = await makeRepo();
    await mkdir(join(repo, "src", "auth"), { recursive: true });
    await writeFile(join(repo, "src", "auth", "deleted.ts"), "export const deleted = true;\n");
    await writeFile(join(repo, "src", "auth", "deleted.test.ts"), "test('deleted', () => {});\n");
    await writeFile(join(repo, "src", "auth", "renamed.ts"), "export const renamed = true;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial auth paths"]);

    git(repo, ["rm", "src/auth/deleted.ts"]);
    git(repo, ["mv", "src/auth/renamed.ts", "src/auth/renamed-next.ts"]);

    const result = await collectRepository({ repoPath: repo, now: new Date("2026-07-10T10:00:00Z") });

    assert.equal(
      result.signals.some(
        (signal) => signal.signalType === "risk.file.removed" && signal.data.path === "src/auth/deleted.ts"
      ),
      true
    );
    assert.equal(
      result.signals.some(
        (signal) => signal.signalType === "risk.file.renamed" && signal.data.path === "src/auth/renamed-next.ts"
      ),
      true
    );
    assert.equal(
      result.signals.some(
        (signal) => signal.signalType === "test.file.observed" && signal.data.path === "src/auth/deleted.test.ts"
      ),
      true
    );
  });

  it("treats a Git-detected copied risk destination as a present change", async () => {
    const repo = await makeRepo();
    await mkdir(join(repo, "src", "auth"), { recursive: true });
    const baselineContent = Array.from({ length: 40 }, (_, index) => `export const value${index} = ${index};`).join("\n") + "\n";
    await writeFile(join(repo, "src", "auth", "template.ts"), baselineContent);
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial auth template"]);
    const baseline = git(repo, ["rev-parse", "HEAD"]);

    const copiedContent = `${baselineContent}export const copied = true;\n`;
    await writeFile(join(repo, "src", "auth", "template.ts"), copiedContent);
    await writeFile(join(repo, "src", "auth", "template-copy.ts"), copiedContent);
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "copy auth template"]);

    const result = await collectRepository({
      repoPath: repo,
      since: baseline,
      now: new Date("2026-07-10T10:00:00Z")
    });

    assert.equal(
      result.signals.some(
        (signal) => signal.signalType === "risk.file.copied" && signal.data.path === "src/auth/template-copy.ts"
      ),
      true
    );
  });

  it("rejects non-Git directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "firstrung-non-git-"));

    await assert.rejects(
      () => collectRepository({ repoPath: dir }),
      (error) => error instanceof CollectorError && error.message.includes("run git init first")
    );
  });

  it("guides users when --since cannot be resolved", async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, "README.md"), "# Fixture\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial readme"]);

    await assert.rejects(
      () => collectRepository({ repoPath: repo, since: "does-not-exist" }),
      (error) =>
        error instanceof CollectorError &&
        error.message.includes("Could not resolve --since ref 'does-not-exist'") &&
        error.message.includes("git branch --all") &&
        error.message.includes("git log --oneline --max-count=5")
    );
  });

  it("explains when Git is not available on PATH", async () => {
    const originalPath = process.env.PATH;

    process.env.PATH = "";

    try {
      await assert.rejects(
        () => collectRepository({ repoPath: tmpdir() }),
        (error) =>
          error instanceof CollectorError &&
          error.message.includes("Git to be installed and available on PATH")
      );
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });
});

async function makeRepo() {
  const repo = await mkdtemp(join(tmpdir(), "firstrung-collector-"));
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
