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
  signalType: "test.file.changed",
  observedAt: "2026-06-20T10:15:00Z",
  summary: "An auth test path changed in the selected Git window.",
  sourceEventIds: ["event_git_1"],
  attribution: {
    kind: "change_window",
    confidence: "high",
    basis: ["path changed in selected Git window", "person attribution was not evaluated"]
  },
  confidence: "high"
});

console.log(signal.attribution.kind);
```

`parseLocalFeedbackPacket` validates a closed-field, local-preview feedback
shape. It deliberately has no repository, path, commit, output, prompt, or
free-text fields.

## Boundary

This package defines public contracts only. Private PRDs, OpenSpecs,
proprietary rule packs, benchmarks, and outcome models belong outside this
repository.
