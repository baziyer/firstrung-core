import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runVerificationCommand } from "../dist/index.js";

describe("verification runner", () => {
  it("runs only fixed argv arrays through the injected command runner", async () => {
    const calls = [];
    const result = await runVerificationCommand({
      commandId: "npm_run_check",
      cwd: "/repo",
      now: fixedNow,
      approvedCommandIds: ["npm_run_check"],
      commandRunner: async (command, args, options) => {
        calls.push({ command, args, options });
        return { exitCode: 0, stdout: "check ok\nRAW_OUTPUT_SENTINEL", stderr: "" };
      }
    });

    assert.deepEqual(calls, [
      {
        command: "npm",
        args: ["run", "check"],
        options: { cwd: "/repo", timeoutMs: undefined }
      }
    ]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.rawCommandOutputIncluded, false);
    assert.equal(JSON.stringify(result).includes("check ok"), false);
    assert.equal(JSON.stringify(result).includes("RAW_OUTPUT_SENTINEL"), false);
    assert.equal(result.summary, "npm_run_check completed with exit code 0");
    assert.deepEqual(
      result.events.map((event) => event.type),
      [
        "tool.call.requested",
        "tool.call.approved",
        "verification.command.started",
        "verification.command.completed"
      ]
    );
  });

  it("denies unapproved commands without executing them", async () => {
    let executed = false;
    const result = await runVerificationCommand({
      commandId: "cargo_test",
      cwd: "/repo",
      now: fixedNow,
      approvedCommandIds: ["npm_test"],
      commandRunner: async () => {
        executed = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    });

    assert.equal(executed, false);
    assert.equal(result.status, "denied");
    assert.equal(result.exitCode, undefined);
    assert.deepEqual(result.events.map((event) => event.type), ["tool.call.requested", "tool.call.denied"]);
  });

  it("denies commands when no explicit approval list is provided", async () => {
    let executed = false;
    const result = await runVerificationCommand({
      commandId: "npm_test",
      cwd: "/repo",
      now: fixedNow,
      commandRunner: async () => {
        executed = true;
        return { exitCode: 0, stdout: "should not run", stderr: "" };
      }
    });

    assert.equal(executed, false);
    assert.equal(result.status, "denied");
    assert.deepEqual(result.events.map((event) => event.type), ["tool.call.requested", "tool.call.denied"]);
  });

  it("denies unknown runtime command ids instead of throwing", async () => {
    let executed = false;
    const result = await runVerificationCommand({
      commandId: "rm_rf",
      cwd: "/repo",
      now: fixedNow,
      approvedCommandIds: ["npm_test", "rm_rf"],
      commandRunner: async () => {
        executed = true;
        return { exitCode: 0, stdout: "should not run", stderr: "" };
      }
    });

    assert.equal(executed, false);
    assert.equal(result.status, "denied");
    assert.equal(result.summary, "rm_rf was denied because it is not a FirstRung verification command.");
    assert.deepEqual(result.events.map((event) => event.type), ["tool.call.requested", "tool.call.denied"]);
  });

  it("denies inherited object key command ids instead of throwing", async () => {
    let executed = false;
    const result = await runVerificationCommand({
      commandId: "toString",
      cwd: "/repo",
      now: fixedNow,
      approvedCommandIds: ["toString"],
      commandRunner: async () => {
        executed = true;
        return { exitCode: 0, stdout: "should not run", stderr: "" };
      }
    });

    assert.equal(executed, false);
    assert.equal(result.status, "denied");
    assert.equal(result.summary, "toString was denied because it is not a FirstRung verification command.");
    assert.deepEqual(result.events.map((event) => event.type), ["tool.call.requested", "tool.call.denied"]);
  });

  it("marks timeout-shaped command results without raw output", async () => {
    const result = await runVerificationCommand({
      commandId: "npm_test",
      cwd: "/repo",
      now: fixedNow,
      approvedCommandIds: ["npm_test"],
      timeoutMs: 10,
      commandRunner: async () => ({
        exitCode: 1,
        stdout: "TIMEOUT_STDOUT_SENTINEL",
        stderr: "TIMEOUT_STDERR_SENTINEL",
        errorCode: "ETIMEDOUT"
      })
    });

    assert.equal(result.errorCode, "ETIMEDOUT");
    assert.match(result.summary, /timed out/i);
    assert.equal(JSON.stringify(result).includes("TIMEOUT_STDOUT_SENTINEL"), false);
    assert.equal(JSON.stringify(result).includes("TIMEOUT_STDERR_SENTINEL"), false);
  });
});

function fixedNow() {
  return new Date("2026-01-02T03:04:05.000Z");
}
