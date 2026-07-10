import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluationExitCode, validateCorpusPolicy } from "./policy.mjs";

describe("deterministic evaluation policy gate", () => {
  it("accepts only synthetic, non-human, non-repository, offline data", () => {
    const compliant = {
      classification: "synthetic_only",
      containsHumanFeedback: false,
      containsRepositoryData: false,
      networkAllowed: false
    };

    assert.deepEqual(validateCorpusPolicy(compliant), []);
    assert.equal(evaluationExitCode(0, validateCorpusPolicy(compliant)), 0);
  });

  it("fails CI for every data-policy violation even when all cases pass", () => {
    const violations = [
      { classification: "production", containsHumanFeedback: false, containsRepositoryData: false, networkAllowed: false },
      { classification: "synthetic_only", containsHumanFeedback: true, containsRepositoryData: false, networkAllowed: false },
      { classification: "synthetic_only", containsHumanFeedback: false, containsRepositoryData: true, networkAllowed: false },
      { classification: "synthetic_only", containsHumanFeedback: false, containsRepositoryData: false, networkAllowed: true }
    ];

    for (const policy of violations) {
      const failures = validateCorpusPolicy(policy);
      assert.equal(failures.length > 0, true);
      assert.equal(evaluationExitCode(0, failures), 1);
    }
    assert.equal(evaluationExitCode(1, []), 1);
  });
});
