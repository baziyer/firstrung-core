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
          attributionKind: "candidate_contributed"
        })
      ],
      now: new Date("2026-06-30T10:00:00Z")
    });
    const rule = result.ruleResults.find((item) => item.ruleId === "rule_risky_files_without_nearby_tests");

    assert.equal(rule?.matched, true);
    assert.equal(rule?.feedback?.summary, "You changed risk-sensitive files, but I found no nearby test evidence yet.");
  });

  it("detects tests near risk-sensitive changes", () => {
    const result = runAlphaRules({
      signals: [
        signal({
          id: "signal_risk",
          signalType: "risk.file.changed",
          path: "src/auth/session.ts",
          attributionKind: "candidate_contributed"
        }),
        signal({
          id: "signal_test",
          signalType: "test.file.changed",
          path: "src/auth/session.test.ts",
          attributionKind: "candidate_contributed"
        })
      ],
      now: new Date("2026-06-30T10:00:00Z")
    });
    const rule = result.ruleResults.find((item) => item.ruleId === "rule_tests_near_risky_files");

    assert.equal(rule?.matched, true);
    assert.equal(rule?.feedback?.summary, "You added tests near risk-sensitive changes.");
    assert.equal(result.skillEpisodes.some((episode) => episode.type === "risk_sensitive_testing"), true);
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
    assert.equal(rule?.feedback?.summary, "I found deployment/config evidence that appears to pre-date this contribution window.");
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
      rawContentIncluded: false
    }
  };
}

