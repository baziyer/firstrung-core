import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MIN_PI_COACH_NODE_VERSION,
  assertNodeSupportsPiCoach,
  isNodeVersionAtLeast,
  parseNodeVersion
} from "../dist/index.js";

describe("FirstRung Coach node version gate", () => {
  it("parses and compares exact Node versions", () => {
    assert.equal(MIN_PI_COACH_NODE_VERSION, "22.19.0");
    assert.deepEqual(parseNodeVersion("22.19.0"), { major: 22, minor: 19, patch: 0 });
    assert.equal(isNodeVersionAtLeast("22.19.0", MIN_PI_COACH_NODE_VERSION), true);
    assert.equal(isNodeVersionAtLeast("22.19.1", MIN_PI_COACH_NODE_VERSION), true);
    assert.equal(isNodeVersionAtLeast("22.20.0", MIN_PI_COACH_NODE_VERSION), true);
    assert.equal(isNodeVersionAtLeast("23.0.0", MIN_PI_COACH_NODE_VERSION), true);
    assert.equal(isNodeVersionAtLeast("22.18.9", MIN_PI_COACH_NODE_VERSION), false);
  });

  it("throws an actionable error below the FirstRung Coach Node floor", () => {
    assert.throws(
      () => assertNodeSupportsPiCoach("22.18.9"),
      /firstrung-coach requires Node >=22\.19\.0; current Node is 22\.18\.9\./
    );
  });
});
