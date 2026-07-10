import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { renderCoachArtifactGuidance } from "../dist/index.js";

describe("firstrung-coach bin", () => {
  it("prints derived context JSON in dry-run mode", async () => {
    const binPath = fileURLToPath(new URL("../dist/bin/firstrung-coach.js", import.meta.url));
    assert.equal(existsSync(binPath), true);
    const repo = makeRepo();

    const result = spawnSync(process.execPath, [binPath, "coach", repo, "--dry-run-context"], {
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    const context = JSON.parse(result.stdout);
    assert.equal(context.summary.projectName, "local-project");
    assert.equal(context.summary.repoRoot, "project://root");
    assert.equal(context.disclosure.rawSnippetConsent, false);
    assert.equal(result.stderr, "");
  });

  it("prints actionable guidance when live Pi cannot run", () => {
    const binPath = fileURLToPath(new URL("../dist/bin/firstrung-coach.js", import.meta.url));
    const repo = makeRepo();

    const result = spawnSync(process.execPath, [binPath, "coach", repo], {
      encoding: "utf8"
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /re-run with --confirm-provider|firstrung-coach requires Node >=22\.19\.0|FirstRung Coach could not start/i);
    assert.match(result.stderr, /Try: firstrung-coach coach <repo> --dry-run-context/);
  });

  it("renders artifact paths, cleanup, and ignore guidance", () => {
    const guidance = renderCoachArtifactGuidance({
      feedbackPath: "/repo/.firstrung/coach/coach-feedback.md",
      artifactPath: "/repo/.firstrung/coach/coach-artifact.json",
      sessionLogPath: "/repo/.firstrung/coach/sessions/session_1.jsonl"
    });

    assert.match(guidance, /Feedback: \/repo\/\.firstrung\/coach\/coach-feedback\.md/);
    assert.match(guidance, /Metadata: \/repo\/\.firstrung\/coach\/coach-artifact\.json/);
    assert.match(guidance, /Redacted session log: \/repo\/\.firstrung\/coach\/sessions\/session_1\.jsonl/);
    assert.match(guidance, /Cleanup: delete \/repo\/\.firstrung\/coach/);
    assert.match(guidance, /keep \.firstrung\/ ignored/);
  });
});

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), "firstrung-coach-bin-"));
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "test@example.invalid"]);
  git(repo, ["config", "user.name", "FirstRung Test"]);
  writeFileSync(join(repo, "README.md"), "# Repo\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  return repo;
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
