import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runAlphaRules } from "../dist/index.js";

describe("@firstrung/rules", () => {
  it("flags risk-sensitive changes without nearby tests", () => {
    const result = runAlphaRules({
      signals: [
        signal({
          id: "signal_risk",
          signalType: "risk.file.changed",
          path: "src/auth/session.ts",
          attributionKind: "change_window"
        })
      ],
      now: new Date("2026-06-30T10:00:00Z")
    });
    const rule = result.ruleResults.find((item) => item.ruleId === "rule_risky_files_without_nearby_tests");

    assert.equal(rule?.matched, true);
    assert.equal(rule?.feedback?.summary, "A potentially risk-sensitive path has no conservatively matched nearby test path.");
    assert.deepEqual(rule?.evidenceTierImpact, ["observed"]);
  });

  it("detects tests near risk-sensitive changes", () => {
    const result = runAlphaRules({
      signals: [
        signal({
          id: "signal_risk",
          signalType: "risk.file.changed",
          path: "src/auth/session.ts",
          attributionKind: "change_window"
        }),
        signal({
          id: "signal_test",
          signalType: "test.file.changed",
          path: "src/auth/session.test.ts",
          attributionKind: "change_window"
        })
      ],
      now: new Date("2026-06-30T10:00:00Z")
    });
    const rule = result.ruleResults.find((item) => item.ruleId === "rule_tests_near_risky_files");

    assert.equal(rule?.matched, true);
    assert.equal(rule?.feedback?.summary, "A changed test path was observed near a potentially risk-sensitive change.");
    assert.deepEqual(rule?.evidenceTierImpact, ["observed"]);
    assert.equal(result.skillEpisodes.every((episode) => !episode.evidenceTier.includes("verified")), true);
    assert.equal(result.skillEpisodes.some((episode) => episode.type === "risk_sensitive_testing"), true);
  });

  it("surfaces existing tests near risk-sensitive changes without creating a candidate episode", () => {
    const result = runAlphaRules({
      signals: [
        signal({
          id: "signal_risk",
          signalType: "risk.file.changed",
          path: "src/auth/session.ts",
          attributionKind: "change_window"
        }),
        signal({
          id: "signal_test",
          signalType: "test.file.observed",
          path: "src/auth/session.test.ts",
          attributionKind: "pre_existing"
        })
      ],
      now: new Date("2026-06-30T10:00:00Z")
    });
    const gap = result.ruleResults.find((item) => item.ruleId === "rule_risky_files_without_nearby_tests");
    const existingTests = result.ruleResults.find((item) => item.ruleId === "rule_existing_tests_near_risky_files");

    assert.equal(gap, undefined);
    assert.equal(existingTests?.matched, true);
    assert.equal(existingTests?.attribution.kind, "pre_existing");
    assert.equal(existingTests?.feedback?.summary, "An existing test path was observed near a potentially risk-sensitive change.");
    assert.equal(result.skillEpisodes.some((episode) => episode.type === "risk_sensitive_testing"), false);
  });

  it("distinguishes pre-existing deployment evidence", () => {
    const result = runAlphaRules({
      signals: [
        signal({
          id: "signal_deploy",
          signalType: "deployment.config.observed",
          path: "vercel.json",
          attributionKind: "pre_existing"
        })
      ],
      now: new Date("2026-06-30T10:00:00Z")
    });
    const rule = result.ruleResults.find((item) => item.ruleId === "rule_deployment_config_evidence");

    assert.equal(rule?.matched, true);
    assert.equal(rule?.attribution.kind, "pre_existing");
    assert.equal(rule?.feedback?.summary, "Deployment/config path evidence exists outside the selected Git window.");
  });

  it("routes CI workflow metadata to CI guidance rather than a nearby-test gap", () => {
    const deployment = signal({
      id: "signal_deploy_changed",
      signalType: "deployment.config.changed",
      path: ".github/workflows/ci.yml",
      attributionKind: "change_window"
    });
    const risk = signal({
      id: "signal_deploy_risk",
      signalType: "risk.file.changed",
      path: ".github/workflows/ci.yml",
      attributionKind: "change_window"
    });
    risk.data.riskCategories = ["infrastructure_deploy"];

    const result = runAlphaRules({ signals: [deployment, risk] });

    const rule = result.ruleResults.find((item) => item.ruleId === "rule_deployment_config_evidence");

    assert.equal(result.ruleResults.some((item) => item.ruleId === "rule_risky_files_without_nearby_tests"), false);
    assert.equal(rule?.feedback?.summary, "CI workflow metadata changed in the selected Git window; authorship and execution were not inferred.");
    assert.equal(rule?.feedback?.nextStep, "Next: run or observe the relevant CI workflow.");
  });

  it("keeps deployment preview guidance for non-CI deployment config", () => {
    const result = runAlphaRules({
      signals: [
        signal({
          id: "signal_vercel_changed",
          signalType: "deployment.config.changed",
          path: "vercel.json",
          attributionKind: "change_window"
        })
      ]
    });
    const rule = result.ruleResults.find((item) => item.ruleId === "rule_deployment_config_evidence");

    assert.equal(rule?.feedback?.summary, "Deployment/config paths changed in the selected Git window; authorship was not inferred.");
    assert.equal(rule?.feedback?.nextStep, "Next: capture a preview or deployment check if this change will ship.");
  });

  it("does not let unrelated same-directory tests satisfy the nearby-test rule", () => {
    const result = runAlphaRules({
      signals: [
        signal({
          id: "signal_risk",
          signalType: "risk.file.changed",
          path: "src/auth/session.ts",
          attributionKind: "change_window"
        }),
        signal({
          id: "signal_unrelated_test",
          signalType: "test.file.changed",
          path: "src/auth/permissions.test.ts",
          attributionKind: "change_window"
        })
      ],
      now: new Date("2026-07-10T10:00:00Z")
    });

    assert.equal(result.ruleResults.some((item) => item.ruleId === "rule_tests_near_risky_files"), false);
    assert.equal(result.ruleResults.some((item) => item.ruleId === "rule_risky_files_without_nearby_tests"), true);
  });

  it("does not count removed or renamed tests as present nearby evidence", () => {
    for (const signalType of ["test.file.removed", "test.file.renamed"]) {
      const result = runAlphaRules({
        signals: [
          signal({
            id: "signal_risk",
            signalType: "risk.file.changed",
            path: "src/auth/session.ts",
            attributionKind: "change_window"
          }),
          signal({
            id: `signal_${signalType}`,
            signalType,
            path: "src/auth/session.test.ts",
            attributionKind: "change_window"
          })
        ],
        now: new Date("2026-07-10T10:00:00Z")
      });

      assert.equal(result.ruleResults.some((item) => item.ruleId === "rule_tests_near_risky_files"), false);
      assert.equal(result.ruleResults.some((item) => item.ruleId === "rule_risky_files_without_nearby_tests"), true);
    }
  });

  it("keeps removed, renamed, and copied risk paths rule-eligible", () => {
    for (const signalType of ["risk.file.removed", "risk.file.renamed", "risk.file.copied"]) {
      const result = runAlphaRules({
        signals: [
          signal({
            id: `signal_${signalType}`,
            signalType,
            path: "src/auth/session.ts",
            attributionKind: "change_window"
          })
        ],
        now: new Date("2026-07-10T10:00:00Z")
      });

      assert.equal(result.ruleResults.some((item) => item.ruleId === "rule_risky_files_without_nearby_tests"), true);
    }
  });

  it("counts a copied test destination as present evidence without counting removed tests", () => {
    const result = runAlphaRules({
      signals: [
        signal({
          id: "signal_copied_risk",
          signalType: "risk.file.copied",
          path: "src/auth/session.ts",
          attributionKind: "change_window"
        }),
        signal({
          id: "signal_copied_test",
          signalType: "test.file.copied",
          path: "tests/auth/session.test.ts",
          attributionKind: "change_window"
        })
      ],
      now: new Date("2026-07-10T10:00:00Z")
    });

    assert.equal(result.ruleResults.some((item) => item.ruleId === "rule_tests_near_risky_files"), true);
    assert.equal(result.ruleResults.some((item) => item.ruleId === "rule_risky_files_without_nearby_tests"), false);
  });

  it("does not invent a production risk change when only a test signal is present", () => {
    const result = runAlphaRules({
      signals: [
        signal({
          id: "signal_test_only",
          signalType: "test.file.changed",
          path: "src/auth/session.test.ts",
          attributionKind: "change_window"
        })
      ],
      now: new Date("2026-07-10T10:00:00Z")
    });

    assert.equal(result.ruleResults.some((item) => item.ruleId.includes("risky_files")), false);
    assert.equal(result.skillEpisodes.length, 0);
  });
});

function signal({ id, signalType, path, attributionKind }) {
  return {
    id,
    projectId: "project_fixture",
    source: "git",
    signalType,
    observedAt: "2026-06-30T10:00:00Z",
    summary: `${signalType} ${path}`,
    sourceEventIds: ["event_fixture"],
    attribution: {
      kind: attributionKind,
      confidence: attributionKind === "unknown" ? "low" : "high",
      basis: ["fixture"]
    },
    confidence: attributionKind === "unknown" ? "low" : "high",
    refs: [
      {
        kind: "file",
        label: path,
        locator: path,
        redacted: true
      }
    ],
    data: {
      path,
      ...(signalType.startsWith("risk.file.") ? { riskCategories: ["auth"] } : {}),
      rawContentIncluded: false
    }
  };
}
