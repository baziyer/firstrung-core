import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertNodeSupportsPiCoach, loadPiSdkBindings } from "../dist/index.js";

describe("pi SDK facade", () => {
  it("rejects unsupported Node versions before importing Pi", async () => {
    await assert.rejects(
      () => loadPiSdkBindings("22.18.9"),
      /firstrung-coach requires Node >=22\.19\.0; current Node is 22\.18\.9\./
    );
  });

  it("exposes the node gate independently from the live Pi import", () => {
    assert.equal(assertNodeSupportsPiCoach("22.19.0"), undefined);
  });
});
