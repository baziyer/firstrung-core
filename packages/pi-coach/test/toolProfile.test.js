import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FIRSTRUNG_PI_COACH_TOOL_NAMES,
  assertPiCoachToolRegistryMatchesProfile,
  sortedToolNames
} from "../dist/index.js";

const allowed = [...FIRSTRUNG_PI_COACH_TOOL_NAMES];

describe("FirstRung Coach tool profile", () => {
  it("accepts an exact active and visible allowlist match", () => {
    assert.deepEqual(sortedToolNames(["b", "a", "a"]), ["a", "b"]);

    assert.doesNotThrow(() =>
      assertPiCoachToolRegistryMatchesProfile({
        activeToolNames: allowed,
        registryVisibleToolNames: [...allowed].reverse()
      })
    );
  });

  it("rejects visible shell and file mutation tools", () => {
    for (const toolName of ["bash", "write", "edit", "delete", "patch"]) {
      assert.throws(
        () =>
          assertPiCoachToolRegistryMatchesProfile({
            activeToolNames: allowed,
            registryVisibleToolNames: [...allowed, toolName]
          }),
        new RegExp(`disallowed Pi tool.*${toolName}`)
      );
    }
  });

  it("rejects unexpected extension tools", () => {
    assert.throws(
      () =>
        assertPiCoachToolRegistryMatchesProfile({
          activeToolNames: [...allowed, "extension_custom_tool"],
          registryVisibleToolNames: [...allowed, "extension_custom_tool"]
        }),
      /unexpected FirstRung Coach tool.*extension_custom_tool/
    );
  });

  it("rejects missing FirstRung tools", () => {
    assert.throws(
      () =>
        assertPiCoachToolRegistryMatchesProfile({
          activeToolNames: allowed.filter((toolName) => toolName !== "firstrung_verify"),
          registryVisibleToolNames: allowed
        }),
      /missing required FirstRung Coach tool.*firstrung_verify/
    );
  });
});
