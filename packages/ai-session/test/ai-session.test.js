import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as aiSession from "../dist/index.js";
import { SchemaValidationError } from "@firstrung/schema";

const redactedPiEvent = {
  id: "event_pi_verification_completed",
  projectId: "project_checkout_app",
  sourceAdapter: "pi",
  observedAt: "2026-07-06T09:15:00Z",
  sessionId: "session_pi_123",
  type: "verification.command.completed",
  summary: "Pi completed a redacted test command after candidate approval.",
  rawPromptIncluded: false,
  rawResponseIncluded: false,
  rawCommandOutputIncluded: false,
  rawSourceIncluded: false,
  rawDiffIncluded: false,
  redactionLevel: "redacted",
  attribution: {
    kind: "agent_activity",
    confidence: "high",
    basis: ["redacted local AI session event"],
    actor: "pi"
  },
  refs: [
    {
      kind: "command",
      label: "npm test redacted",
      locator: "local-session:command-7",
      redacted: true
    }
  ],
  metadata: {
    exitCode: 0,
    commandLabel: "npm test"
  }
};

describe("@firstrung/ai-session", () => {
  it("validates a redacted Pi event fixture", () => {
    assert.equal(typeof aiSession.parseAiSessionEvent, "function");

    const event = aiSession.parseAiSessionEvent(redactedPiEvent);

    assert.equal(event.sourceAdapter, "pi");
    assert.equal(event.type, "verification.command.completed");
    assert.equal(event.rawCommandOutputIncluded, false);
    assert.equal(event.redactionLevel, "redacted");
    assert.equal(event.attribution.kind, "agent_activity");
    assert.equal(event.refs?.[0]?.redacted, true);
    assert.equal(event.metadata?.exitCode, 0);
  });

  it("defaults omitted disclosure fields to false and redactionLevel none", () => {
    assert.equal(typeof aiSession.parseAiSessionEvent, "function");

    const event = aiSession.parseAiSessionEvent({
      id: "event_prompt_submitted",
      projectId: "project_checkout_app",
      sourceAdapter: "generic",
      observedAt: "2026-07-06T09:10:00Z",
      sessionId: "session_generic_1",
      type: "coach.prompt.submitted",
      summary: "Candidate submitted a summarized coach prompt.",
      attribution: {
        kind: "candidate_contributed",
        confidence: "medium",
        basis: ["local session summary"]
      }
    });

    assert.equal(event.rawPromptIncluded, false);
    assert.equal(event.rawResponseIncluded, false);
    assert.equal(event.rawCommandOutputIncluded, false);
    assert.equal(event.rawSourceIncluded, false);
    assert.equal(event.rawDiffIncluded, false);
    assert.equal(event.redactionLevel, "none");
  });

  it("rejects ambiguous or non-object metadata", () => {
    assert.equal(typeof aiSession.parseAiSessionEvent, "function");

    assert.throws(
      () =>
        aiSession.parseAiSessionEvent({
          ...redactedPiEvent,
          id: "event_bad_metadata_array",
          metadata: ["ambiguous"]
        }),
      SchemaValidationError
    );
    assert.throws(
      () =>
        aiSession.parseAiSessionEvent({
          ...redactedPiEvent,
          id: "event_bad_metadata_function",
          metadata: {
            parse() {
              return true;
            }
          }
        }),
      SchemaValidationError
    );
  });

  it("rejects non-finite and non-plain JSON metadata values", () => {
    assert.equal(typeof aiSession.parseAiSessionEvent, "function");

    class MetadataValue {
      constructor(value) {
        this.value = value;
      }
    }

    for (const [name, metadata] of [
      ["nan", { score: Number.NaN }],
      ["infinity", { durationMs: Number.POSITIVE_INFINITY }],
      ["date", { observedAt: new Date("2026-07-06T09:15:00Z") }],
      ["map", { values: new Map([["exitCode", 0]]) }],
      ["class", { value: new MetadataValue("ambiguous") }]
    ]) {
      assert.throws(
        () =>
          aiSession.parseAiSessionEvent({
            ...redactedPiEvent,
            id: `event_bad_metadata_${name}`,
            metadata
          }),
        SchemaValidationError
      );
    }
  });

  it("rejects raw-content metadata keys even when disclosure flags are false", () => {
    assert.equal(typeof aiSession.parseAiSessionEvent, "function");

    for (const [name, metadata] of [
      ["prompt", { prompt: "RAW_PROMPT_SENTINEL" }],
      ["stdout", { command: { stdout: "RAW_STDOUT_SENTINEL" } }],
      ["diff", { nested: { diff: "RAW_DIFF_SENTINEL" } }],
      ["raw_source", { rawSource: "RAW_SOURCE_SENTINEL" }],
      ["command_output", { commandOutput: "RAW_COMMAND_OUTPUT_SENTINEL" }],
      ["assistant_delta", { assistantMessageEvent: { delta: "RAW_DELTA_SENTINEL" } }],
      ["tool_result_text", { result: { content: [{ type: "text", text: "RAW_RESULT_TEXT_SENTINEL" }] } }],
      ["text", { text: "RAW_TEXT_SENTINEL" }]
    ]) {
      assert.throws(
        () =>
          aiSession.parseAiSessionEvent({
            ...redactedPiEvent,
            id: `event_bad_metadata_${name}`,
            metadata
          }),
        /AiSessionEvent\.metadata.*must not include raw content fields/
      );
    }
  });

  it("revalidates unsafe metadata when converting already-shaped events", () => {
    assert.equal(typeof aiSession.aiSessionEventsToEvidenceSignals, "function");

    const event = aiSession.parseAiSessionEvent(redactedPiEvent);
    event.metadata = {
      prompt: "RAW_PROMPT_SENTINEL"
    };

    assert.throws(
      () => aiSession.aiSessionEventsToEvidenceSignals([event]),
      /AiSessionEvent\.metadata.*must not include raw content fields/
    );
  });

  it("converts verification and coach feedback events into EvidenceSignal records", () => {
    assert.equal(typeof aiSession.aiSessionEventsToEvidenceSignals, "function");

    const feedbackEvent = aiSession.parseAiSessionEvent({
      ...redactedPiEvent,
      id: "event_coach_feedback",
      type: "coach.feedback.generated",
      summary: "Coach generated feedback from selected session evidence.",
      metadata: {
        feedbackType: "next_step"
      }
    });
    const signals = aiSession.aiSessionEventsToEvidenceSignals([
      aiSession.parseAiSessionEvent(redactedPiEvent),
      feedbackEvent
    ]);

    assert.deepEqual(
      signals.map((signal) => signal.signalType),
      ["ai_session.verification.completed", "ai_session.coach.feedback.generated"]
    );
    assert.equal(signals[0].source, "ai_session");
    assert.deepEqual(signals[0].sourceEventIds, ["event_pi_verification_completed"]);
    assert.equal(signals[0].confidence, "high");
    assert.equal(signals[0].data?.sourceAdapter, "pi");
    assert.equal(signals[0].data?.eventType, "verification.command.completed");
    assert.equal(signals[0].data?.rawCommandOutputIncluded, false);
    assert.equal(signals[0].data?.redactionLevel, "redacted");
    assert.equal(signals[0].refs?.[0]?.kind, "command");
    assert.equal(signals[1].data?.metadata?.feedbackType, "next_step");
  });

  it("preserves sourceAdapter pi while using no Pi package import", () => {
    assert.equal(typeof aiSession.parseAiSessionEvents, "function");

    const events = aiSession.parseAiSessionEvents([redactedPiEvent]);
    const signals = aiSession.aiSessionEventsToEvidenceSignals(events);

    assert.equal(events[0].sourceAdapter, "pi");
    assert.equal(signals[0].data?.sourceAdapter, "pi");
  });

  it("rejects duplicate event IDs before converting to evidence signals", () => {
    assert.equal(typeof aiSession.aiSessionEventsToEvidenceSignals, "function");

    const events = aiSession.parseAiSessionEvents([
      redactedPiEvent,
      {
        ...redactedPiEvent,
        summary: "Duplicate source event that would create an ambiguous signal ID."
      }
    ]);

    assert.throws(
      () => aiSession.aiSessionEventsToEvidenceSignals(events),
      /Duplicate AiSessionEvent id "event_pi_verification_completed"/
    );
  });
});
