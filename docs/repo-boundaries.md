# Repository Boundaries

## Role of This Repository

`firstrung-core` is the public, open-source trust layer for FirstRung.

It should be possible for candidates and institutions to inspect what the local
collector reads, how evidence signals are derived, how rules are evaluated, how
redaction works, and what is included in evidence receipts.

## Public Scope

This repository owns:

- local collector CLI;
- `CollectorEvent`, `EvidenceSignal`, `RuleDefinition`, `RuleResult`,
  `SkillEpisode`, `EvidenceReceipt`, and profile export schemas;
- contribution attribution model;
- unified rules pipeline;
- basic skill episode rules and rubrics;
- local AI-session adapters where safe and inspectable;
- redaction tools;
- secret scanning integration;
- evidence receipt format;
- basic local coaching report;
- static profile export;
- import/export tools;
- plugin/adapter SDK.

## Out of Scope

The following belong in the private `firstrung` platform repository:

- hosted candidate passport service;
- user accounts and identity;
- employer evidence viewer;
- institution dashboard;
- proprietary rule packs;
- benchmark distributions;
- outcome-linked skill models;
- reviewer and mentor network workflows;
- attestation registry;
- paid project and hiring workflows;
- commercial product strategy.

## Dependency Direction

Allowed:

```text
private firstrung platform -> firstrung-core
```

Not allowed:

```text
firstrung-core -> private firstrung platform
```

This repository must remain independently buildable and testable.

## Licensing

This repository is licensed under Apache 2.0.

Copyright 2026 Bharathwaj Iyer.
