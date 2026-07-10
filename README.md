# FirstRung Core

Open-source trust layer for FirstRung.

FirstRung Core is intended to make the local collector, schemas, evidence
receipt format, basic rules, redaction tools, and local report/profile export
auditable by candidates, institutions, employers, and contributors.

Status: local report alpha.

## Quick Links

- [Public roadmap](ROADMAP.md)
- [Contributing](CONTRIBUTING.md)
- [Testing guide](docs/testing.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)

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

Prerequisites:

- Node.js `>=22.19.0` for the complete workspace (`firstrung` itself remains
  compatible with Node `>=22.6`);
- npm;
- Git available on `PATH` for scans.

```bash
npm install
npm run check
```

`npm run check` builds the workspace packages and runs their tests.

For clean-environment smoke testing through Docker:

```bash
npm run test:docker
```

See [docs/testing.md](docs/testing.md) for the full testing matrix.

## Install the Alpha

The published alpha CLI can be run through npm:

```bash
npx firstrung scan /path/to/project
```

The package also runs a lightweight install check. It is silent when Node, npm,
and Git look ready, and prints guidance if a likely first-run issue is detected.

For local development from this checkout, install dependencies and use the
workspace binary:

```bash
npm install
npm run build
npm exec -- firstrung doctor /path/to/project
npm exec -- firstrung scan /path/to/project
```

## Local Report Alpha

Run the local scanner against an explicit Git repository:

```bash
npm run build
npm exec -- firstrung doctor /path/to/project
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

Supported alpha scan flags:

```text
--out <path>          optional output directory; omitted by default
--since <git-ref>     optional baseline ref for attribution
--branch <name>       optional target branch/ref, default HEAD
--format <mode>       summary, json, markdown, or all; default summary
--debug-artifacts     write evidence-signals/rule-results/skill-episodes JSON
```

## Optional FirstRung Coach

The default `firstrung` CLI does not depend on Pi. FirstRung Coach lives in the
optional `@firstrung/pi-coach` package, which has a higher Node runtime floor
because the Pi SDK currently requires Node.js `>=22.19`.

Install it separately, or run it through `npx`:

```bash
npm install --global @firstrung/pi-coach
firstrung-coach coach /path/to/project --dry-run-context
```

```bash
npx --yes --package @firstrung/pi-coach firstrung-coach coach /path/to/project --dry-run-context
```

The legacy `firstrung-pi-coach` bin is kept as an alias for early alpha users.

To inspect the redacted coach context without loading Pi:

```bash
firstrung-coach coach /path/to/project --dry-run-context
```

Live Coach is provider-backed rather than local-only. It requires explicit
consent after inspecting the redacted context:

```bash
firstrung-coach coach /path/to/project --confirm-provider
```

The CLI discloses the configured provider/model and outbound derived field
categories before the request. Repository identity, absolute paths, Git
branch/ref/commit values, and snippet identifiers are pseudonymized; useful
repository-relative evidence paths may still be sent. Explicitly selected
snippet content may be sent only under separate consent.

Live feedback must contain `Evidence`, `Inference`, and `Next steps` in that
order and stay within 160 words. Invalid or missing provider output is rejected
without writing a feedback artifact. The model cannot use generic shell,
filesystem, edit, or artifact-write tools.

Live coach artifacts are written under the FirstRung-owned output directory:

```text
/path/to/project/.firstrung/coach/
  coach-feedback.md
  coach-artifact.json
  sessions/<session-id>.jsonl
```

Delete `.firstrung/coach` in the target project to remove local coach outputs.

Supported alpha coach flags:

```text
--out <path>          optional output directory under .firstrung/coach
--since <git-ref>     optional baseline ref for attribution
--branch <name>       optional target branch/ref, default HEAD
--session-dir <path>   optional session directory under .firstrung/coach/sessions
--dry-run-context      print redacted context without loading Pi
--confirm-provider     consent to the disclosed provider-backed live run
```

To check prerequisites without scanning:

```bash
npm exec -- firstrung doctor /path/to/project
```

## Contributing

FirstRung Core is a deliberately narrow public trust layer. Good public
contributions improve local collection, schemas, attribution, deterministic
rules, report copy, redaction, fixtures, package hygiene, and local-only
adapters.

Hosted passport flows, employer and institution workflows, proprietary rule
packs, benchmarks, outcome models, attestation registries, paid-project flows,
and private product strategy are out of scope for this repository.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [ROADMAP.md](ROADMAP.md) before
opening larger issues or pull requests.

## Security

Do not post private code, raw prompts, raw diffs, logs, environment values,
secrets, candidate data, or customer data in public issues. See
[SECURITY.md](SECURITY.md) for the vulnerability reporting path and scope.

## Publishing

GitHub is the source repository and audit trail. npm is the distribution channel
for versioned JavaScript/TypeScript packages.

The alpha release is the `firstrung` CLI plus its workspace packages:

```text
@firstrung/schema
@firstrung/collector
@firstrung/rules
@firstrung/ai-session
@firstrung/pi-coach
@firstrung/report
firstrung
```

`@firstrung/pi-coach` is optional and carries the Pi dependency plus Node
`>=22.19.0`; the default `firstrung` package stays deterministic and Pi-free.
The release workspace also requires Node `>=22.19.0`, while the published
deterministic CLI continues to support Node `>=22.6`.

Built `dist/` files stay ignored in Git. They are generated by the build and
included in npm packages through each package's `files` list. Every publishable
workspace also carries a package-local `LICENSE` that release preflight requires
to exactly match the repository Apache-2.0 text.

To inspect the publish contents for every package:

```bash
npm run pack:dry-run
```

If the local npm cache has ownership problems, use a temp cache:

```bash
npm --cache /private/tmp/firstrung-npm-cache run pack:dry-run
```

To run the full local preflight before publishing:

```bash
npm run release:preflight
```

The source preflight runs before npm authentication, tests, packing, or any
publish command. It refuses:

- a dirty working tree;
- a detached branch or branch without a remote upstream;
- local `HEAD` that does not exactly match the current upstream branch head;
- mixed workspace versions or stale internal `@firstrung/*` dependency pins;
- an existing workspace version whose `gitHead`, internal dependency pins, or
  CLI output contract differs from the release commit;
- a registry/network error that prevents proving a version missing or an exact
  match for a safely resumable release.

To run only these non-publishing source/version checks:

```bash
npm run release:source-preflight
```

The same temp-cache pattern works for release preflight:

```bash
npm --cache /private/tmp/firstrung-npm-cache run release:preflight
```

To publish the alpha package set after authenticating with npm and confirming
access to the `firstrung` npm organisation:

```bash
npm run release:alpha
```

The release command runs the same clean-source, live-upstream, npm-auth,
CI-equivalent, deterministic-evaluation, and package-content preflight exactly
once. It then:

1. resumes an existing package only when its immutable registry metadata
   matches the release `HEAD`;
2. publishes missing packages in dependency order behind a version-specific
   staging tag;
3. verifies all seven package versions and the CLI output contract; and
4. moves both `alpha` and `latest` only after the complete set is present.

If public tag promotion fails part-way, the command restores the tag state it
observed before promotion. Rerunning the release is safe only for package
versions whose registry `gitHead` and metadata still match the same release
commit. Ambiguous registry failures stop without moving public tags.

For a local token stored as `NPM_TOKEN` in the ignored `.env.local`, use a
mode-600 temporary npm config whose credential remains an environment
reference rather than copying the token into another file:

```ini
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

Then select the release runtime and config explicitly:

```bash
source "$HOME/.nvm/nvm.sh"
nvm use 22.20.0
set -a
source .env.local
set +a
export NPM_CONFIG_USERCONFIG=/private/tmp/firstrung-npmrc
npm run release:preflight
```

The release scripts do not bump versions. Bump and review the complete package
graph first. Published npm packages should have a `gitHead` that resolves to the
same public GitHub commit. For production releases, prefer npm trusted
publishing with GitHub OIDC/provenance over long-lived local automation tokens.
The release command deliberately does not create a Git tag; after registry and
published-install verification, it prints the exact annotated-tag command for
the coordinated version.

The `firstrung` package also exposes its output contract as static package
metadata (`package.json#firstrung`). Deployment checks can compare it without
executing downloaded code:

```bash
npm view firstrung@<version> firstrung --json
```

Release preflight refuses a CLI manifest missing those schema, ruleset,
template, renderer, line-budget, or word-budget fields.

GitHub releases can be added for repo-level milestones, but downstream JS/TS
consumers should use npm packages rather than GitHub dependencies.

## License

Apache License 2.0.

Copyright 2026 Bharathwaj Iyer.
