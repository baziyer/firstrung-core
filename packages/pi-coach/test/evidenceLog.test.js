import assert from "node:assert/strict";
import { access, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createInMemoryEvidenceLogger, createWorkspaceEvidenceLogger } from "../dist/index.js";

describe("evidence loggers", () => {
  it("stores redacted events in memory", async () => {
    const logger = createInMemoryEvidenceLogger({
      sessionId: "session_test",
      now: fixedNow
    });

    await logger.log({ type: "coach.feedback.generated", raw: "RAW_SENTINEL", nested: { secret: "SECRET_SENTINEL" } });

    assert.equal(logger.events.length, 1);
    assert.equal(logger.events[0].sessionId, "session_test");
    assert.equal(JSON.stringify(logger.events).includes("RAW_SENTINEL"), false);
    assert.equal(JSON.stringify(logger.events).includes("SECRET_SENTINEL"), false);
  });

  it("redacts camelCase raw-content keys from Pi-shaped events", async () => {
    const logger = createInMemoryEvidenceLogger({
      sessionId: "session_test",
      now: fixedNow
    });

    await logger.log({
      type: "coach.feedback.generated",
      rawSource: "RAW_SOURCE_SENTINEL",
      rawPrompt: "RAW_PROMPT_SENTINEL",
      rawResponse: "RAW_RESPONSE_SENTINEL",
      commandOutput: "COMMAND_OUTPUT_SENTINEL",
      sourceText: "SOURCE_TEXT_SENTINEL",
      privateLog: "PRIVATE_LOG_SENTINEL",
      envValue: "ENV_VALUE_SENTINEL",
      safe: "INNOCUOUS_KEY_SECRET_SENTINEL",
      toolName: "firstrung_verify",
      assistantMessageEvent: { type: "text_delta", delta: "DELTA_SENTINEL" }
    });

    const text = JSON.stringify(logger.events);
    assert.equal(text.includes("RAW_SOURCE_SENTINEL"), false);
    assert.equal(text.includes("RAW_PROMPT_SENTINEL"), false);
    assert.equal(text.includes("RAW_RESPONSE_SENTINEL"), false);
    assert.equal(text.includes("COMMAND_OUTPUT_SENTINEL"), false);
    assert.equal(text.includes("SOURCE_TEXT_SENTINEL"), false);
    assert.equal(text.includes("PRIVATE_LOG_SENTINEL"), false);
    assert.equal(text.includes("ENV_VALUE_SENTINEL"), false);
    assert.equal(text.includes("INNOCUOUS_KEY_SECRET_SENTINEL"), false);
    assert.equal(text.includes("DELTA_SENTINEL"), false);
    assert.deepEqual(logger.events[0].event, {
      type: "coach.feedback.generated",
      toolName: "firstrung_verify",
      assistantEventType: "text_delta"
    });
  });

  it("writes JSONL under .firstrung/coach/sessions", async () => {
    const repo = join(tmpdir(), `firstrung-evidence-${Date.now()}`);
    await mkdir(repo, { recursive: true });
    const logger = createWorkspaceEvidenceLogger({
      repoPath: repo,
      sessionId: "session_test",
      now: fixedNow
    });

    await logger.log({
      type: "verification.command.completed",
      stdout: "RAW_OUTPUT_SENTINEL",
      note: "INNOCUOUS_LOG_SECRET_SENTINEL",
      willRetry: false
    });

    const logPath = join(repo, ".firstrung", "coach", "sessions", "session_test.jsonl");
    const line = await readFile(logPath, "utf8");
    const parsed = JSON.parse(line);

    assert.equal(parsed.sessionId, "session_test");
    assert.deepEqual(parsed.event, { type: "verification.command.completed", willRetry: false });
    assert.equal(line.includes("RAW_OUTPUT_SENTINEL"), false);
    assert.equal(line.includes("INNOCUOUS_LOG_SECRET_SENTINEL"), false);
  });

  it("rejects unsafe workspace logger session ids before creating paths", async () => {
    const repo = join(tmpdir(), `firstrung-evidence-escape-${Date.now()}`);
    await mkdir(repo, { recursive: true });

    assert.throws(
      () =>
        createWorkspaceEvidenceLogger({
          repoPath: repo,
          sessionId: "../escape",
          now: fixedNow
        }),
      /FirstRung Coach sessionId must contain only letters, numbers, underscores, and hyphens\./
    );

    await assert.rejects(() => access(join(repo, ".firstrung", "coach", "sessions")));
    await assert.rejects(() => access(join(repo, ".firstrung", "coach", "escape.jsonl")));
  });
});

function fixedNow() {
  return new Date("2026-01-02T03:04:05.000Z");
}
