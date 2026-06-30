# FirstRung Core

Open-source trust layer for FirstRung.

FirstRung Core is intended to make the local collector, schemas, evidence
receipt format, basic rules, redaction tools, and local report/profile export
auditable by candidates, institutions, employers, and contributors.

Status: local report alpha scaffold.

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

Detailed PRDs, OpenSpecs, proprietary rule packs, benchmarks, outcome models,
and product strategy belong in the private platform repository. If private
planning material is copied into this checkout locally, keep it under ignored
paths such as `docs/private/`, `docs/prd/`, `docs/dev/`, or `openspec/`.

## Development

This repository uses npm workspaces and Node's built-in test runner.

```bash
npm install
npm run check
```

`npm run check` builds the workspace packages and runs their tests.

## Local Report Alpha

After installing dependencies and building the workspaces, run the local scanner
against an explicit Git repository:

```bash
npm run build
npm exec -- firstrung scan /path/to/project
```

For clearer contribution attribution, pass a baseline ref:

```bash
npm exec -- firstrung scan /path/to/project --since main
```

The default command prints a short candidate-facing summary and writes no files.
It uses direct language such as "You changed", "I found", and "No evidence
yet". It excludes raw code, raw prompts, raw diffs, private logs, and
environment values by default.

To write one local JSON artifact:

```bash
npm exec -- firstrung scan /path/to/project --out .firstrung/report
```

That writes:

```text
.firstrung/report/
  scan.json
```

Markdown and split debug artifacts are opt-in:

```bash
npm exec -- firstrung scan /path/to/project --out .firstrung/report --format all --debug-artifacts
```

Supported alpha flags:

```text
--out <path>          optional output directory; omitted by default
--since <git-ref>     optional baseline ref for attribution
--branch <name>       optional target branch/ref, default HEAD
--format <mode>       summary, json, markdown, or all; default summary
--debug-artifacts     write evidence-signals/rule-results/skill-episodes JSON
```

## Publishing

GitHub is the source repository and audit trail. npm is the distribution channel
for versioned JavaScript/TypeScript packages.

The first package intended for npm publication is:

```text
@firstrung/schema
```

To inspect the publish contents:

```bash
npm pack --workspace @firstrung/schema --dry-run
```

To publish an alpha release after authenticating with npm and confirming access
to the `firstrung` npm organisation:

```bash
npm run release:schema
```

GitHub releases can be added for repo-level milestones, but downstream JS/TS
consumers should use npm packages rather than GitHub dependencies.

## License

Apache License 2.0.

Copyright 2026 Bharathwaj Iyer.
