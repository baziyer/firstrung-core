import assert from "node:assert/strict";
import { win32 } from "node:path";
import { describe, it } from "node:test";

import { isPathWithinOrEqual } from "../dist/index.js";

describe("coach tools", () => {
  it("checks output containment with platform path semantics", () => {
    const outDir = "C:\\repo\\.firstrung\\coach";

    assert.equal(isPathWithinOrEqual("C:\\repo\\.firstrung\\coach\\note.json", outDir, win32), true);
    assert.equal(isPathWithinOrEqual("C:\\repo\\.firstrung\\coach", outDir, win32), true);
    assert.equal(isPathWithinOrEqual("C:\\repo\\.firstrung\\coach-escape\\note.json", outDir, win32), false);
  });
});
