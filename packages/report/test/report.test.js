import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { renderMarkdownReport, renderTerminalSummary, writeReportArtifacts } from "../dist/index.js";

describe("@firstrung/report", () => {
  it("renders stripped-back candidate-facing terminal and markdown output without raw material", () => {
    const terminal = renderTerminalSummary(fixtureReport());
    const markdown = renderMarkdownReport(fixtureReport());

    assert.equal(terminal.includes("FirstRung scanned fixture."), true);
    assert.equal(terminal.includes("You changed 1 file"), true);
    assert.equal(terminal.includes("Nothing was uploaded."), true);
    assert.equal(terminal.includes("Next useful step"), true);
    assert.equal(terminal.includes("evidence signal"), false);

    for (const section of [
      "## Summary",
      "## What I Inspected",
      "## What Stayed Local",
      "## What Changed",
      "## Evidence Found",
      "## Relevant Gaps",
      "## Next Useful Step"
    ]) {
      assert.equal(markdown.includes(section), true);
    }

    assert.equal(markdown.includes("You changed"), true);
    assert.equal(markdown.includes("I found"), true);
    assert.equal(markdown.includes("No evidence yet"), true);
    assert.equal(markdown.includes("Next useful step"), true);
    assert.equal(markdown.includes("the candidate"), false);
    assert.equal(markdown.includes("this user"), false);
    assert.equal(markdown.includes("RAW_CODE_SENTINEL"), false);
    assert.equal(markdown.includes("SECRET_ENV_VALUE"), false);
  });

  it("writes scan.json by default when an output directory is requested", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "firstrung-report-"));
    const written = await writeReportArtifacts({
      ...fixtureReport(),
      outDir
    });

    assert.equal(Boolean(written.scan), true);
    assert.equal(written.report, undefined);
    assert.equal(written.evidenceSignals, undefined);

    const scan = JSON.parse(await readFile(written.scan, "utf8"));

    assert.equal(scan.summary.projectId, "project_fixture");
    assert.equal(scan.signals[0].data.rawContentIncluded, false);
    await assert.rejects(() => access(join(outDir, "report.md")));
  });

  it("writes optional markdown and debug artifacts only when requested", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "firstrung-report-debug-"));
    const written = await writeReportArtifacts({
      ...fixtureReport(),
      outDir,
      format: "all",
      debugArtifacts: true
    });

    assert.equal(Boolean(written.scan), true);
    assert.equal(Boolean(written.report), true);
    assert.equal(Boolean(written.evidenceSignals), true);
    assert.equal(Boolean(written.ruleResults), true);
    assert.equal(Boolean(written.skillEpisodes), true);

    const report = await readFile(written.report, "utf8");
    assert.equal(report.includes("What Stayed Local"), true);
  });
});

function fixtureReport() {
  return {
    summary: {
      projectId: "project_fixture",
      projectName: "fixture",
      requestedPath: "/tmp/fixture",
      repoRoot: "/tmp/fixture",
      currentBranch: "main",
      targetRef: "HEAD",
      targetCommit: "abc123",
      baselineRef: "main",
      attributionMode: "since",
      attributionReason: "You passed --since main, so I treated changes after that ref and current working-tree paths as active work.",
      changedFileCount: 2,
      trackedFileCount: 4,
      rawContentIncluded: false
    },
    evidenceSignals: [
      {
        id: "signal_file_changed",
        projectId: "project_fixture",
        source: "git",
        signalType: "file.changed",
        observedAt: "2026-06-30T10:00:00Z",
        summary: "Path changed.",
        sourceEventIds: ["event_fixture"],
        attribution: {
          kind: "candidate_contributed",
          confidence: "high",
          basis: ["fixture"]
        },
        confidence: "high",
        data: {
          path: "src/auth/session.test.ts",
          categories: ["code", "test", "risk_sensitive"],
          rawContentIncluded: false
        }
      },
      {
        id: "signal_test",
        projectId: "project_fixture",
        source: "git",
        signalType: "test.file.changed",
        observedAt: "2026-06-30T10:00:00Z",
        summary: "Test path changed.",
        sourceEventIds: ["event_fixture"],
        attribution: {
          kind: "candidate_contributed",
          confidence: "high",
          basis: ["fixture"]
        },
        confidence: "high",
        data: {
          path: "src/auth/session.test.ts",
          rawContentIncluded: false
        }
      }
    ],
    ruleResults: [
      {
        id: "result_tests",
        ruleId: "rule_tests_near_risky_files",
        projectId: "project_fixture",
        evaluatedAt: "2026-06-30T10:00:00Z",
        matched: true,
        confidence: "high",
        matchedSignalIds: ["signal_test"],
        attribution: {
          kind: "candidate_contributed",
          confidence: "high",
          basis: ["fixture"]
        },
        evidenceTierImpact: ["verified"],
        feedback: {
          summary: "You added tests near risk-sensitive changes.",
          nextStep: "Next useful step: keep the verification command easy to identify."
        }
      },
      {
        id: "result_gap",
        ruleId: "rule_risky_files_without_nearby_tests",
        projectId: "project_fixture",
        evaluatedAt: "2026-06-30T10:00:00Z",
        matched: true,
        confidence: "low",
        matchedSignalIds: [],
        attribution: {
          kind: "unknown",
          confidence: "low",
          basis: ["fixture"]
        },
        feedback: {
          summary: "You changed risk-sensitive files, but I found no nearby test evidence yet.",
          missingEvidence: ["No evidence yet of tests near those risk-sensitive changes."],
          nextStep: "Next useful step: add or surface a focused test near the risk-sensitive path."
        }
      }
    ],
    skillEpisodes: [
      {
        id: "episode_tests",
        projectId: "project_fixture",
        type: "risk_sensitive_testing",
        title: "Tests near risk-sensitive changes",
        status: "candidate",
        evidenceTier: ["verified"],
        confidence: "high",
        supportingSignalIds: ["signal_test"],
        attribution: {
          kind: "candidate_contributed",
          confidence: "high",
          basis: ["fixture"]
        },
        ruleResultIds: ["result_tests"]
      }
    ]
  };
}
