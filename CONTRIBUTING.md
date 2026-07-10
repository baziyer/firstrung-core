# Contributing to FirstRung Core

FirstRung Core is the open-source trust layer for FirstRung. Contributions are
welcome when they make the local collector, schemas, rules, reports, redaction,
or adapters easier to inspect, run, and trust.

The public repo is intentionally narrower than the full product. Hosted
passport flows, employer and institution workflows, proprietary rule packs,
benchmarks, outcome models, attestation registries, paid-project flows, and
private product strategy belong outside this repository.

## Good Contribution Areas

- Documentation, examples, and first-run clarity.
- Public schema contracts and parser coverage.
- Metadata-only Git collection and attribution improvements.
- Deterministic basic rules with clear evidence and tests.
- Candidate-facing report wording that is direct, useful, and not shaming.
- Fixtures that use synthetic or toy repositories, not private code.
- Redaction, secret-safety, and local-only privacy hardening.
- Local adapters that are inspectable and avoid raw prompt/code upload by
  default.

## Out of Scope

- Hosted candidate passport implementation.
- Employer evidence viewer or institution dashboard features.
- Proprietary or benchmark-backed rule packs.
- Outcome-linked scoring or automated hiring recommendations.
- Public leaderboards, single scores, or peer ranking systems.
- Uploading raw code, raw diffs, prompts, logs, or environment values by
  default.
- Private PRDs, OpenSpecs, commercial strategy, or customer materials.

## Development Setup

This repo uses npm workspaces and Node's built-in test runner.

```bash
npm install
npm run check
```

See `docs/testing.md` for the Docker smoke workflow and first-run testing
matrix.

For package/release-adjacent changes, also inspect package contents:

```bash
npm run pack:dry-run
```

If the local npm cache has ownership problems, use a temp cache:

```bash
npm --cache /private/tmp/firstrung-npm-cache run pack:dry-run
```

Generated `dist/`, package tarballs, `.firstrung/` scan output, and local
environment files should stay out of Git.

## Pull Request Expectations

Before opening a pull request:

- Keep the change small and focused.
- Add or update tests for behavior changes.
- Run `npm run check`.
- Avoid committing generated build output.
- Do not include private code, private prompts, raw diffs, logs, secrets, or
  customer/candidate data.
- Keep public docs free of private strategy and private OpenSpec content.
- Explain any privacy, attribution, or release-surface impact in the PR.

If you change package metadata, release scripts, or publishing docs, also run
`npm run pack:dry-run` and confirm the package contents are still limited to
intended public files.

## Release Integrity

Maintainers should publish npm packages only from source that is already public
or is pushed and tagged as part of the same release. The npm package `gitHead`
should resolve to a public GitHub commit for the corresponding package version.

Contributors should not publish packages directly.

## Reporting Security Issues

Do not open public issues that contain exploit details, secrets, private code,
raw prompts, private logs, or environment values. See `SECURITY.md` for the
private reporting path and scope.
