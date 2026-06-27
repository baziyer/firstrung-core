import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SchemaValidationError,
  parseCollectorEvent,
  parseContributionAttribution,
  parseEvidenceReceipt,
  parseEvidenceSignal,
  parseRuleDefinition,
  parseRuleResult,
  parseSkillEpisode
} from "../src/index.ts";

const candidateAttribution = {
  kind: "candidate_contributed",
  confidence: "high",
  basis: ["commit author matched candidate", "selected contribution window"],
  actor: "candidate",
  timeWindow: {
    startedAt: "2026-06-20T09:00:00Z",
    endedAt: "2026-06-20T11:00:00Z"
  }
};

const preExistingAttribution = {
  kind: "pre_existing",
  confidence: "medium",
  basis: ["file existed before selected contribution window"]
};

describe("@firstrung/schema", () => {
  it("validates collector events without raw content", () => {
    const event = parseCollectorEvent({
      id: "event_git_1",
      projectId: "project_booking_app",
      source: "git",
      type: "git.file.changed",
      observedAt: "2026-06-20T10:15:00Z",
      summary: "Candidate changed auth route tests.",
      rawContentIncluded: false,
      refs: [
        {
          kind: "commit",
          label: "commit ending a91f",
          locator: "a91f",
          redacted: true
        }
      ],
      metadata: {
        filesChanged: 3,
        categories: ["auth", "tests"]
      }
    });

    assert.equal(event.source, "git");
    assert.equal(event.rawContentIncluded, false);
    assert.equal(event.metadata?.filesChanged, 3);
  });

  it("keeps candidate and pre-existing attribution distinct", () => {
    assert.equal(parseContributionAttribution(candidateAttribution).kind, "candidate_contributed");
    assert.equal(parseContributionAttribution(preExistingAttribution).kind, "pre_existing");
  });

  it("validates evidence signals from repo and AI-session sources through the same shape", () => {
    const repoSignal = parseEvidenceSignal({
      id: "signal_test_added",
      projectId: "project_booking_app",
      source: "git",
      signalType: "test.file.added",
      observedAt: "2026-06-20T10:15:00Z",
      summary: "Auth boundary tests were added in candidate window.",
      sourceEventIds: ["event_git_1"],
      attribution: candidateAttribution,
      confidence: "high",
      data: {
        testFramework: "vitest"
      }
    });

    const sessionSignal = parseEvidenceSignal({
      id: "signal_agent_recovery",
      projectId: "project_booking_app",
      source: "ai_session",
      signalType: "agent.recovery_loop",
      observedAt: "2026-06-20T10:20:00Z",
      summary: "Candidate rejected an agent edit and reran verification.",
      sourceEventIds: ["event_session_1"],
      attribution: {
        kind: "agent_activity",
        confidence: "medium",
        basis: ["local session log summary"]
      },
      confidence: "medium"
    });

    assert.equal(repoSignal.signalType, "test.file.added");
    assert.equal(sessionSignal.source, "ai_session");
  });

  it("validates rule definitions and results", () => {
    const rule = parseRuleDefinition({
      id: "rule_auth_boundary_testing",
      name: "Auth Boundary Testing",
      version: "0.1.0",
      description: "Detects evidence of tests around authentication or permissions boundaries.",
      appliesTo: ["test.file.added", "auth.file.changed"],
      requiredSignals: ["test.file.added"],
      attributionRequired: ["candidate_contributed"],
      evidenceTierImpact: ["verified"],
      feedbackTemplates: {
        matched: "Strong evidence of auth boundary testing.",
        missingEvidence: "No evidence yet of multi-user access tests.",
        nextStep: "Add one denied-access test for another user."
      }
    });

    const result = parseRuleResult({
      id: "result_auth_boundary_testing",
      ruleId: rule.id,
      projectId: "project_booking_app",
      evaluatedAt: "2026-06-20T11:00:00Z",
      matched: true,
      confidence: "high",
      matchedSignalIds: ["signal_test_added"],
      attribution: candidateAttribution,
      evidenceTierImpact: ["verified"],
      feedback: {
        summary: "Strong evidence of auth boundary testing.",
        nextStep: "Attach CI or local test output to strengthen the receipt."
      }
    });

    assert.equal(result.matched, true);
    assert.deepEqual(result.evidenceTierImpact, ["verified"]);
  });

  it("validates skill episodes and evidence receipts", () => {
    const episode = parseSkillEpisode({
      id: "episode_auth_testing",
      projectId: "project_booking_app",
      type: "high_risk_path_testing",
      title: "Auth boundary tests added",
      status: "candidate",
      evidenceTier: ["observed", "verified"],
      confidence: "high",
      supportingSignalIds: ["signal_test_added"],
      attribution: candidateAttribution,
      ruleResultIds: ["result_auth_boundary_testing"]
    });

    const receipt = parseEvidenceReceipt({
      id: "receipt_auth_testing",
      projectId: "project_booking_app",
      skillEpisodeId: episode.id,
      generatedAt: "2026-06-20T11:15:00Z",
      evidenceTier: ["observed", "verified"],
      supportingSignalIds: ["signal_test_added"],
      attributionSummary: candidateAttribution,
      rawDataDisclosure: "none",
      excludedDataNotice: "Raw code, prompts, diffs, and private logs are not included."
    });

    assert.equal(receipt.rawDataDisclosure, "none");
    assert.equal(receipt.attributionSummary.kind, "candidate_contributed");
  });

  it("rejects invalid source values", () => {
    assert.throws(
      () =>
        parseEvidenceSignal({
          id: "signal_invalid",
          projectId: "project_booking_app",
          source: "spreadsheet",
          signalType: "test.file.added",
          observedAt: "2026-06-20T10:15:00Z",
          summary: "Invalid source.",
          sourceEventIds: ["event_1"],
          attribution: candidateAttribution,
          confidence: "high"
        }),
      SchemaValidationError
    );
  });
});
