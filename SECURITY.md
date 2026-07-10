# Security Policy

FirstRung Core is a local-first tool that inspects selected repositories and
produces derived evidence. Security and privacy reports are in scope when they
affect what the collector reads, what reports expose, package integrity, or the
local-only trust boundary.

## Supported Versions

FirstRung Core is currently pre-1.0 alpha software. The supported security
surface is:

- the latest published alpha packages on npm;
- the public `main` branch;
- package contents produced by the documented release scripts.

Older alpha versions may receive fixes only when the issue is severe and a
patch is practical.

## Report a Vulnerability

Use GitHub private vulnerability reporting for this repository when available:

```text
https://github.com/baziyer/firstrung-core/security/advisories/new
```

If private reporting is unavailable, open a minimal public issue asking for a
security contact, but do not include technical details. Do not paste secrets,
private code, raw prompts, raw diffs, logs, environment values, tokens, or
candidate/customer data into a public issue.

Helpful private reports include:

- affected package and version;
- operating system and Node version;
- exact command or API call used;
- high-level impact;
- minimal synthetic reproduction steps;
- whether raw private material could be collected, stored, printed, or uploaded.

## Security Scope

In scope:

- accidental inclusion of raw source, raw diffs, raw prompts, logs, or env
  values in stdout or artifacts;
- unsafe default output paths or overwrites;
- package integrity, release metadata, or npm/GitHub source mismatches;
- command injection, path traversal, or unsafe Git/filesystem handling;
- dependency or build-chain issues that affect published packages;
- redaction and secret-safety failures.

Out of scope for this public repo:

- hosted passport, employer, institution, benchmark, outcome, or attestation
  systems that are not implemented here;
- private product strategy or unreleased private OpenSpecs;
- broad product or hiring-policy disagreements without a concrete software
  vulnerability.

## Disclosure Expectations

Please give maintainers a reasonable opportunity to investigate and publish a
fix before public disclosure. Maintainers will aim to acknowledge actionable
reports quickly and will keep the report public only after details are safe to
share.
