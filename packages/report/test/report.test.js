import assert from "node:assert/strict";
import { access, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { renderMarkdownReport, renderTerminalSummary, writeReportArtifacts } from "../dist/index.js";

describe("@firstrung/report", () => {
  it("renders stripped-back candidate-facing terminal and markdown output without raw material", () => {
    const terminal = renderTerminalSummary(fixtureReport());
    const markdown = renderMarkdownReport(fixtureReport());
    const terminalLines = terminal.trim().split("\n");
    const terminalWords = terminal.trim().split(/\s+/);

    assert.equal(terminal.includes("FirstRung — fixture"), true);
    assert.equal(
      terminal.includes("Path heuristic: src/auth/session.ts matched auth; no closely related test path was found."),
      true
    );
    assert.equal(terminal.includes("nothing uploaded"), true);
    assert.equal(terminal.includes("Next:"), true);
    assert.equal(terminal.includes("evidence signal"), false);
    assert.equal(terminal.includes("You "), false);
    assert.equal(terminalLines.length <= 5, true);
    assert.equal(terminalWords.length <= 65, true);

    for (const section of [
      "## Summary",
      "## Scope and limitations",
      "## Privacy",
      "## Provenance",
      "## Evidence Found",
      "## Relevant Gaps",
      "## Next Useful Step"
    ]) {
      assert.equal(markdown.includes(section), true);
    }

    assert.equal(markdown.includes("not a person"), true);
    assert.equal(markdown.includes("Path metadata did not identify"), true);
    assert.equal(markdown.includes("A potentially risk-sensitive path has no conservatively matched nearby test path."), false);
    assert.equal(markdown.includes("Next:"), true);
    assert.equal(markdown.split("Next:").length - 1, 1);
    assert.equal(markdown.includes("Local path metadata only"), false);
    assert.equal(markdown.trim().split("\n").length <= 45, true);
    assert.equal(markdown.trim().split(/\s+/).length <= 180, true);
    assert.equal(markdown.includes("the candidate"), false);
    assert.equal(markdown.includes("this user"), false);
    assert.equal(markdown.includes("RAW_CODE_SENTINEL"), false);
    assert.equal(markdown.includes("SECRET_ENV_VALUE"), false);
  });

  it("renders existing nearby test context without claiming candidate test work", () => {
    const terminal = renderTerminalSummary(existingTestReport());

    assert.equal(
      terminal.includes(
        "Path relation: src/auth/session.ts matched auth and a closely related existing test path; test execution was not observed."
      ),
      true
    );
    assert.equal(terminal.includes("You "), false);
    assert.equal(terminal.includes("Next: run the relevant test and keep the command result."), true);
  });

  it("renders one representative path for a changed nearby-test relation", () => {
    const model = fixtureReport();
    model.ruleResults = model.ruleResults.filter((result) => result.ruleId === "rule_tests_near_risky_files");
    const terminal = renderTerminalSummary(model);

    assert.equal(
      terminal.includes(
        "Path relation: src/auth/session.ts matched auth and a closely related changed test path; test execution was not observed."
      ),
      true
    );
    assert.equal(terminal.split("src/auth/session.ts").length - 1, 1);
    assert.equal(terminal.trim().split(/\s+/).length <= 65, true);
  });

  it("distinguishes CI workflow metadata from deployment config in actionable copy", () => {
    const ciTerminal = renderTerminalSummary(deploymentReport(".github/workflows/ci.yml", true));
    const deployTerminal = renderTerminalSummary(deploymentReport("vercel.json", false));

    assert.equal(ciTerminal.includes("Path heuristic: .github/workflows/ci.yml matched CI workflow metadata."), true);
    assert.equal(ciTerminal.includes("Next: run or observe the relevant CI workflow."), true);
    assert.equal(deployTerminal.includes("Path heuristic: vercel.json matched deployment config metadata."), true);
    assert.equal(deployTerminal.includes("Next: capture a preview or deployment check if this change will ship."), true);
  });

  it("truncates and sanitizes the representative path deterministically", () => {
    const model = fixtureReport();
    const fullPath = "src/auth/a-very-long-directory-name/another-long-directory-name/session-handler.ts";
    const riskSignal = model.evidenceSignals.find((signal) => signal.id === "signal_risk");
    riskSignal.data.path = `${fullPath}\n`;
    const terminal = renderTerminalSummary(model);

    assert.equal(terminal.includes(fullPath), false);
    assert.equal(terminal.includes("…"), true);
    assert.equal(terminal.includes("\nmatched auth"), false);
  });

  it("keeps one action while reporting additional distinct risk paths", () => {
    const model = fixtureReport();
    const secondRisk = structuredClone(model.evidenceSignals.find((signal) => signal.id === "signal_risk"));
    secondRisk.id = "signal_risk_second";
    secondRisk.data.path = "src/auth/permissions.ts";
    model.evidenceSignals.push(secondRisk);
    const gap = model.ruleResults.find((result) => result.ruleId === "rule_risky_files_without_nearby_tests");
    gap.matchedSignalIds.push(secondRisk.id);
    const terminal = renderTerminalSummary(model);

    assert.equal(terminal.includes("1 additional risk path matched."), true);
    assert.equal(terminal.split("Next:").length - 1, 1);
    assert.equal(terminal.trim().split(/\s+/).length <= 65, true);
  });

  it("sanitizes and bounds every dynamic display field before enforcing the terminal budget", () => {
    const model = fixtureReport();
    const hostile = `\u001b[31m${"very-long-value ".repeat(80)}\nINJECTED`;
    model.summary.projectName = hostile;
    model.summary.repoRoot = hostile;
    model.summary.currentBranch = hostile;
    model.summary.targetRef = hostile;
    model.summary.targetCommit = hostile;
    model.summary.baselineRef = hostile;
    model.summary.attributionReason = hostile;
    model.provenance.schemaVersion = hostile;
    const gap = model.ruleResults.find((result) => result.ruleId === "rule_risky_files_without_nearby_tests");
    gap.feedback.nextStep = `Next: ${hostile}`;

    const terminal = renderTerminalSummary(model);
    const explained = renderTerminalSummary(model, { explain: true });
    const markdown = renderMarkdownReport(model);

    assert.equal(terminal.trim().split("\n").length, 4);
    assert.equal(terminal.trim().split(/\s+/).length <= 65, true);
    assert.equal(explained.trim().split("\n").length, 10);
    assert.equal(markdown.trim().split("\n").length <= 45, true);
    assert.equal(markdown.trim().split(/\s+/).length <= 180, true);
    for (const output of [terminal, explained, markdown]) {
      assert.equal(output.includes("\u001b"), false);
      assert.equal(output.includes("\nINJECTED"), false);
    }
  });

  it("keeps scope, privacy detail, and provenance behind --explain output", () => {
    const explained = renderTerminalSummary(fixtureReport(), { explain: true });

    assert.equal(explained.includes("Repository: /tmp/fixture."), true);
    assert.equal(explained.includes("do not prove authorship or test execution"), true);
    assert.equal(explained.includes("Versions: schema firstrung.scan.v1"), true);
    assert.equal(explained.trim().split("\n").length > 5, true);
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
    assert.equal(report.includes("## Privacy"), true);
  });

  it("refuses to overwrite an external file through a report symlink", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "firstrung-report-symlink-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "firstrung-report-outside-"));
    const outsideFile = join(outsideDir, "outside.json");
    await writeFile(outsideFile, "do not overwrite\n", "utf8");
    await symlink(outsideFile, join(outDir, "scan.json"));

    await assert.rejects(
      () => writeReportArtifacts({ ...fixtureReport(), outDir }),
      /Refusing to write a FirstRung report through a symbolic link/
    );
    assert.equal(await readFile(outsideFile, "utf8"), "do not overwrite\n");
  });

  it("refuses an in-repository output path with a symlinked ancestor before mkdir", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "firstrung-report-repo-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "firstrung-report-ancestor-outside-"));
    await symlink(outsideDir, join(repoRoot, "reports"));
    const model = fixtureReport();
    model.summary.repoRoot = repoRoot;

    await assert.rejects(
      () => writeReportArtifacts({ ...model, outDir: join(repoRoot, "reports", "run") }),
      /Refusing to write a FirstRung report through a repository symlink/
    );
    await assert.rejects(() => access(join(outsideDir, "run")));
  });
});

function fixtureReport() {
  return {
    provenance: {
      schemaVersion: "firstrung.scan.v1",
      rulesetVersion: "2026-07-10.1",
      templateVersion: "2026-07-10.1",
      rendererVersion: "2026-07-10.1"
    },
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
      attributionReason: "Scope: changes after main, plus current working-tree paths. This identifies a Git window, not a person.",
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
          kind: "change_window",
          confidence: "high",
          basis: ["fixture"]
        },
        confidence: "high",
        data: {
          path: "src/auth/session.ts",
          categories: ["code", "risk_sensitive"],
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
          kind: "change_window",
          confidence: "high",
          basis: ["fixture"]
        },
        confidence: "high",
        data: {
          path: "src/auth/session.test.ts",
          rawContentIncluded: false
        }
      },
      {
        id: "signal_risk",
        projectId: "project_fixture",
        source: "git",
        signalType: "risk.file.changed",
        observedAt: "2026-06-30T10:00:00Z",
        summary: "Risk path changed.",
        sourceEventIds: ["event_fixture"],
        attribution: {
          kind: "change_window",
          confidence: "high",
          basis: ["fixture"]
        },
        confidence: "medium",
        data: {
          path: "src/auth/session.ts",
          riskCategories: ["auth"],
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
        matchedSignalIds: ["signal_risk", "signal_test"],
        attribution: {
          kind: "change_window",
          confidence: "high",
          basis: ["fixture"]
        },
        evidenceTierImpact: ["observed"],
        feedback: {
          summary: "A changed test path was observed near a potentially risk-sensitive change.",
          nextStep: "Next: run the relevant test and keep the command result."
        }
      },
      {
        id: "result_gap",
        ruleId: "rule_risky_files_without_nearby_tests",
        projectId: "project_fixture",
        evaluatedAt: "2026-06-30T10:00:00Z",
        matched: true,
        confidence: "low",
        matchedSignalIds: ["signal_risk"],
        attribution: {
          kind: "unknown",
          confidence: "low",
          basis: ["fixture"]
        },
        feedback: {
          summary: "A potentially risk-sensitive path has no conservatively matched nearby test path.",
          missingEvidence: ["Path metadata did not identify a closely related test path."],
          nextStep: "Next: add or identify one focused test, then run it."
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
        evidenceTier: ["observed"],
        confidence: "high",
        supportingSignalIds: ["signal_test"],
        attribution: {
          kind: "change_window",
          confidence: "high",
          basis: ["fixture"]
        },
        ruleResultIds: ["result_tests"]
      }
    ]
  };
}

function existingTestReport() {
  return {
    provenance: {
      schemaVersion: "firstrung.scan.v1",
      rulesetVersion: "2026-07-10.1",
      templateVersion: "2026-07-10.1",
      rendererVersion: "2026-07-10.1"
    },
    summary: {
      projectId: "project_fixture",
      projectName: "fixture",
      requestedPath: "/tmp/fixture",
      repoRoot: "/tmp/fixture",
      currentBranch: "main",
      targetRef: "HEAD",
      targetCommit: "abc123",
      attributionMode: "working_tree",
      attributionReason: "Scope: current working-tree paths because no --since ref was provided. This identifies a Git window, not a person.",
      changedFileCount: 1,
      trackedFileCount: 3,
      rawContentIncluded: false
    },
    evidenceSignals: [
      {
        id: "signal_risk",
        projectId: "project_fixture",
        source: "git",
        signalType: "risk.file.changed",
        observedAt: "2026-06-30T10:00:00Z",
        summary: "Risk path changed.",
        sourceEventIds: ["event_fixture"],
        attribution: {
          kind: "change_window",
          confidence: "high",
          basis: ["fixture"]
        },
        confidence: "medium",
        data: {
          path: "src/auth/session.ts",
          riskCategories: ["auth"],
          rawContentIncluded: false
        }
      },
      {
        id: "signal_test_observed",
        projectId: "project_fixture",
        source: "git",
        signalType: "test.file.observed",
        observedAt: "2026-06-30T10:00:00Z",
        summary: "Existing test path observed.",
        sourceEventIds: ["event_fixture"],
        attribution: {
          kind: "pre_existing",
          confidence: "medium",
          basis: ["fixture"]
        },
        confidence: "medium",
        data: {
          path: "src/auth/session.test.ts",
          rawContentIncluded: false
        }
      },
      {
        id: "signal_file_changed",
        projectId: "project_fixture",
        source: "git",
        signalType: "file.changed",
        observedAt: "2026-06-30T10:00:00Z",
        summary: "Path changed.",
        sourceEventIds: ["event_fixture"],
        attribution: {
          kind: "change_window",
          confidence: "high",
          basis: ["fixture"]
        },
        confidence: "high",
        data: {
          path: "src/auth/session.ts",
          categories: ["code", "risk_sensitive"],
          rawContentIncluded: false
        }
      }
    ],
    ruleResults: [
      {
        id: "result_existing_tests",
        ruleId: "rule_existing_tests_near_risky_files",
        projectId: "project_fixture",
        evaluatedAt: "2026-06-30T10:00:00Z",
        matched: true,
        confidence: "medium",
        matchedSignalIds: ["signal_risk", "signal_test_observed"],
        attribution: {
          kind: "pre_existing",
          confidence: "medium",
          basis: ["fixture"]
        },
        evidenceTierImpact: ["observed"],
        feedback: {
          summary: "An existing test path was observed near a potentially risk-sensitive change.",
          nextStep: "Next: run the relevant test and keep the command result."
        }
      }
    ],
    skillEpisodes: []
  };
}

function deploymentReport(path, isCiWorkflow) {
  const model = fixtureReport();
  model.summary.changedFileCount = 1;
  model.evidenceSignals = [
    {
      id: "signal_deployment",
      projectId: "project_fixture",
      source: "git",
      signalType: "deployment.config.changed",
      observedAt: "2026-07-10T10:00:00Z",
      summary: "Deployment metadata changed.",
      sourceEventIds: ["event_fixture"],
      attribution: {
        kind: "change_window",
        confidence: "high",
        basis: ["fixture"]
      },
      confidence: "high",
      data: {
        path,
        rawContentIncluded: false
      }
    }
  ];
  model.ruleResults = [
    {
      id: "result_deployment",
      ruleId: "rule_deployment_config_evidence",
      projectId: "project_fixture",
      evaluatedAt: "2026-07-10T10:00:00Z",
      matched: true,
      confidence: "high",
      matchedSignalIds: ["signal_deployment"],
      attribution: {
        kind: "change_window",
        confidence: "high",
        basis: ["fixture"]
      },
      evidenceTierImpact: ["observed"],
      feedback: {
        summary: isCiWorkflow ? "CI workflow metadata changed." : "Deployment/config metadata changed.",
        nextStep: isCiWorkflow
          ? "Next: run or observe the relevant CI workflow."
          : "Next: capture a preview or deployment check if this change will ship."
      }
    }
  ];
  model.skillEpisodes = [];
  return model;
}
