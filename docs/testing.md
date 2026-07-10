# Testing FirstRung Core

This repository has three useful testing layers:

1. Workspace checks for source changes.
2. Package dry runs for release contents.
3. Docker smoke tests for first-run behavior in clean environments.

## Workspace Checks

Run this for normal development:

```bash
npm run check
```

It builds every workspace package and runs package tests.

The CI/release gate additionally runs the deterministic evaluation corpus:

```bash
npm run check:ci
```

`npm run eval:deterministic` currently uses synthetic, network-disabled cases
and enforces semantic, privacy, and copy-budget expectations. Human pilot data
must not be added to the public corpus.

## Package Contents

Run this before package metadata, release, or publish-surface changes:

```bash
npm run pack:dry-run
```

If the local npm cache has ownership problems:

```bash
npm --cache /private/tmp/firstrung-npm-cache run pack:dry-run
```

The expected package surface is each package `README.md`, built `dist/*`, and
`package.json`; the CLI package also includes the small install-check script
used by its `postinstall` hook.

## Docker Smoke Tests

Run the clean-environment smoke harness:

```bash
npm run test:docker
```

The harness uses `node:22-bookworm` by default, copies the checkout into an
isolated container workspace, installs dependencies, runs `npm run check`, and
then scans a synthetic Git repository.

It covers:

- a fresh container with Node/npm/Git available;
- `firstrung doctor` prerequisite checks;
- default scan behavior that writes no files;
- explicit `--out` artifact behavior;
- optional FirstRung Coach dry-run context without writing files;
- optional FirstRung Coach live startup against the real Pi SDK with credential
  guidance in a credential-free container;
- missing repo path guidance;
- non-Git directory guidance;
- `--format` without `--out` guidance;
- missing Git executable guidance by hiding Git from `PATH`.

To use a different base image:

```bash
FIRSTRUNG_DOCKER_IMAGE=node:22-bookworm-slim npm run test:docker
```

The script can install Git through `apt-get` or `apk`, so Alpine-style Node
images are also covered:

```bash
FIRSTRUNG_DOCKER_IMAGE=node:22-alpine npm run test:docker
```

To test the published npm install path, use the separate published-package
smoke. It does not mount or copy this workspace into the container; it creates a
synthetic repo and runs the package through `npx`.

```bash
npm run test:docker:published
```

That mode uses `npx --yes firstrung@latest`, so it needs network access to the
npm registry. To test a specific package version or tag:

```bash
FIRSTRUNG_DOCKER_PACKAGE_SPEC=firstrung@0.1.0-alpha.2 npm run test:docker:published
```

After `@firstrung/pi-coach` has been published, include the optional coach
package in the same published Docker smoke:

```bash
FIRSTRUNG_DOCKER_PACKAGE_SPEC=firstrung@0.1.0-alpha.2 \
FIRSTRUNG_DOCKER_COACH_PACKAGE_SPEC=@firstrung/pi-coach@0.1.0-alpha.2 \
npm run test:docker:published
```

## Manual First-Run Matrix

Use the Docker smoke results together with manual checks on real machines:

| Environment | What to check |
|---|---|
| Fresh install with Node/npm/Git ready | The install check is silent. |
| Fresh install with a likely issue | The install check prints guidance and does not fail the install. |
| Node/npm installed, Git installed | `npx firstrung doctor /path/to/repo` passes, then `npx firstrung scan /path/to/repo` prints a useful local summary. |
| Optional Coach installed on Node `>=22.19.0` | `firstrung-coach coach /path/to/repo --dry-run-context` prints redacted context and writes no files. |
| Optional Coach installed without Pi/model credentials | `firstrung-coach coach /path/to/repo` explains `pi login` or supported model credential setup. |
| Optional Coach installed with Pi/model credentials | `firstrung-coach coach /path/to/repo --confirm-provider` prints provider disclosure, returns validated three-section feedback, and writes local artifacts under `.firstrung/coach`. |
| Optional Coach returns malformed or overlong output | The run fails without writing `coach-feedback.md`. |
| Coach output path contains a directory or fixed-file symlink | The run refuses the path and does not follow it outside the repository. |
| Real sister repo path | `firstrung doctor /Users/baziyer/firstrung`, `firstrung scan /Users/baziyer/firstrung --since HEAD`, and `firstrung-coach coach /Users/baziyer/firstrung --since HEAD --dry-run-context` all complete. |
| Node/npm installed, Git missing | `firstrung doctor` explains that Git must be installed and on `PATH`. |
| Node older than supported package engines | The deterministic CLI warns below Node `22.6`; Coach and repository release commands require Node `>=22.19.0`. |
| Git repo with no `--since` ref | The summary explains whether it used dirty working-tree focus, a branch baseline, or conservative unknown attribution. |
| Non-Git directory | The CLI explains that alpha scans require a Git repository. |
| User asks for Markdown without `--out` | The CLI explains that non-summary formats require an output directory. |
| npm cache ownership problem | The docs show the temp-cache command form. |
| Private or sensitive repo | Output excludes raw source, raw diffs, raw prompts, private logs, and env values by default. |

## Release Gate

Before publishing, maintainers should verify:

```bash
npm run check
npm run eval:deterministic
npm --cache /private/tmp/firstrung-npm-cache run pack:dry-run
```

`npm run release:source-preflight` performs the non-publishing safety checks. It
requires a clean branch whose local `HEAD` exactly matches its live upstream,
requires one coordinated workspace version/internal dependency graph, then
verifies that every intended workspace version is either missing or already has
the exact release `gitHead`, internal pins, and CLI contract. A registry/network
ambiguity or metadata mismatch fails closed. `npm run release:preflight` adds
the Node `22.19` release floor, npm identity/organisation role, complete CI
check/evaluation, and package dry runs without publishing.

`npm run release:alpha` performs that preflight once, publishes missing
packages behind a version-specific staging tag in dependency order, verifies
the complete set, then promotes `alpha` and `latest`. An interrupted publish can
resume only from matching immutable metadata; a failed public-tag promotion
restores its previous tag snapshot. Published npm package `gitHead` values must
resolve to the public release commit.

The preflight also validates static `package.json#firstrung` output-contract
metadata. A web deploy may inspect it without executing the package with
`npm view firstrung@<version> firstrung --json`.

CI tests the deterministic package set at its exact Node `22.6.0` floor and the
full workspace, including Coach, at Node `22.19.0`.
