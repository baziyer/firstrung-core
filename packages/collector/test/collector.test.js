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
    const riskChanged = result.signals.find((signal) => signal.signalType === "risk.file.changed");
    const deploymentObserved = result.signals.find((signal) => signal.signalType === "deployment.config.observed");
    const serialized = JSON.stringify(result);

    assert.equal(result.summary.attributionMode, "since");
    assert.equal(riskChanged?.attribution.kind, "candidate_contributed");
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

  it("treats dirty working-tree paths as candidate-contributed metadata", async () => {
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
    const changed = result.signals.find((signal) => signal.signalType === "risk.file.changed");
    const serialized = JSON.stringify(result);

    assert.equal(result.summary.changedFileCount, 1);
    assert.equal(changed?.attribution.kind, "candidate_contributed");
    assert.equal(serialized.includes("DIRTY_RAW_CODE"), false);
  });

  it("classifies OpenSpec-style dirty paths as docs rather than tests", async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, "README.md"), "# Fixture\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial readme"]);

    await mkdir(join(repo, "openspec", "changes", "alpha", "specs", "feature"), { recursive: true });
    await writeFile(join(repo, "openspec", "changes", "alpha", "specs", "feature", "spec.md"), "## ADDED Requirements\n");

    const result = await collectRepository({
      repoPath: repo,
      now: new Date("2026-06-30T10:00:00Z")
    });
    const changed = result.signals.find((signal) => signal.signalType === "file.changed");

    assert.deepEqual(changed?.data?.categories, ["docs"]);
    assert.equal(result.signals.some((signal) => signal.signalType === "test.file.changed"), false);
  });

  it("rejects non-Git directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "firstrung-non-git-"));

    await assert.rejects(() => collectRepository({ repoPath: dir }), CollectorError);
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
