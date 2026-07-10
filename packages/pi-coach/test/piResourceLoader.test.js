import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FirstRungPiResourceLoader } from "../dist/index.js";

describe("FirstRungPiResourceLoader", () => {
  it("loads no project or global Pi resources by default", () => {
    const loader = new FirstRungPiResourceLoader();

    const extensionsResult = loader.getExtensions();
    assert.deepEqual(extensionsResult.extensions, []);
    assert.deepEqual(extensionsResult.errors, []);
    assert.equal(typeof extensionsResult.runtime, "object");
    assert.ok(extensionsResult.runtime);

    assert.deepEqual(loader.getSkills(), { skills: [], diagnostics: [] });
    assert.deepEqual(loader.getPrompts(), { prompts: [], diagnostics: [] });
    assert.deepEqual(loader.getThemes(), { themes: [], diagnostics: [] });
    assert.deepEqual(loader.getAgentsFiles(), { agentsFiles: [] });
  });

  it("can seed the empty extension runtime from an injected factory", () => {
    const runtime = Object.freeze({ source: "test-runtime" });
    const loader = new FirstRungPiResourceLoader({
      createExtensionRuntime: () => runtime
    });

    assert.equal(loader.getExtensions().runtime, runtime);
  });

  it("returns immutable FirstRung coach guidance", async () => {
    const loader = new FirstRungPiResourceLoader();

    const systemPrompt = loader.getSystemPrompt();
    assert.match(systemPrompt, /FirstRung/);
    assert.match(systemPrompt, /FirstRung-approved tools/);
    assert.match(systemPrompt, /do not edit, write, or delete files/);
    assert.match(systemPrompt, /evidence, inference, and next steps/);

    const guidance = loader.getAppendSystemPrompt();
    assert.ok(guidance.length > 0);
    assert.ok(guidance.every((item) => typeof item === "string"));
    assert.throws(() => guidance.push("mutate"));

    loader.extendResources();
    await loader.reload();
    assert.deepEqual(loader.getExtensions().extensions, []);
  });
});
