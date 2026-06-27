# @firstrung/schema

Public schema contract for FirstRung evidence, attribution, rule results, skill
episodes, and evidence receipts.

## Install

```bash
npm install @firstrung/schema
```

## Usage

```ts
import { parseEvidenceSignal } from "@firstrung/schema";

const signal = parseEvidenceSignal({
  id: "signal_test_added",
  projectId: "project_booking_app",
  source: "git",
  signalType: "test.file.added",
  observedAt: "2026-06-20T10:15:00Z",
  summary: "Auth boundary tests were added in the candidate contribution window.",
  sourceEventIds: ["event_git_1"],
  attribution: {
    kind: "candidate_contributed",
    confidence: "high",
    basis: ["commit author matched candidate", "selected contribution window"]
  },
  confidence: "high"
});

console.log(signal.attribution.kind);
```

## Boundary

This package defines public contracts only. Private PRDs, OpenSpecs,
proprietary rule packs, benchmarks, and outcome models belong outside this
repository.
