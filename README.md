# AI Builder Core

Open-source trust layer for AI Builder Passport.

AI Builder Core is intended to make the local collector, schemas, evidence
receipt format, basic rules, redaction tools, and local report/profile export
auditable by candidates, institutions, employers, and contributors.

Status: pre-implementation repository skeleton.

## Scope

This repository should contain:

- local collector CLI;
- event, evidence signal, rule, receipt, and profile schemas;
- unified evidence/rules pipeline;
- basic inspectable skill episode rules;
- contribution attribution model;
- local AI-session adapters where safe and inspectable;
- redaction and secret-safety tools;
- local coaching report and static profile export.

This repository should not contain:

- hosted candidate passport service;
- employer evidence viewer;
- institution dashboard;
- proprietary rule packs;
- benchmark distributions;
- outcome-linked skill models;
- attestation registry;
- paid project or hiring workflows;
- private product strategy.

## Boundary

The private platform may depend on this public core.

This public core must never depend on private platform code.

See `docs/repo-boundaries.md`.

## License

Apache License 2.0.

Copyright 2026 Bharathwaj Iyer.
