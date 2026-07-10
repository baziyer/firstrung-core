import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FIRSTRUNG_PI_COACH_TOOL_NAMES, runPiLockdownProbe } from "../dist/index.js";

describe("Pi lockdown probe", () => {
  it("loads the SDK surface without creating a session or loading project/global resources", async () => {
    const calls = { runtime: 0, auth: 0, modelRegistry: 0, sessionManager: 0, settingsManager: 0, agentSession: 0 };
    const result = await runPiLockdownProbe({
      loadBindings: async () => ({
        AuthStorage: {
          inMemory: () => {
            calls.auth += 1;
            return {};
          }
        },
        ModelRegistry: {
          inMemory: () => {
            calls.modelRegistry += 1;
            return {};
          }
        },
        SessionManager: {
          inMemory: () => {
            calls.sessionManager += 1;
            return {};
          }
        },
        SettingsManager: {
          inMemory: () => {
            calls.settingsManager += 1;
            return {};
          }
        },
        createExtensionRuntime: () => {
          calls.runtime += 1;
          return {};
        },
        defineTool: (tool) => tool,
        Theme: class {},
        createAgentSession: async () => {
          calls.agentSession += 1;
          throw new Error("The non-networked lockdown probe must not create an agent session");
        }
      })
    });

    assert.deepEqual(result.activeToolNames, [...FIRSTRUNG_PI_COACH_TOOL_NAMES]);
    assert.equal(result.networkRequestAttempted, false);
    assert.deepEqual(result.resources, { extensions: 0, skills: 0, prompts: 0, themes: 0, agentsFiles: 0 });
    assert.deepEqual(calls, {
      runtime: 1,
      auth: 1,
      modelRegistry: 1,
      sessionManager: 1,
      settingsManager: 1,
      agentSession: 0
    });
  });
});
