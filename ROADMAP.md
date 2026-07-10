# FirstRung Core Public Roadmap

This public roadmap is intentionally narrower than the private FirstRung product
plan. FirstRung Core should earn trust by making local collection, schemas,
rules, redaction, receipts, and basic reports inspectable. Hosted product
strategy and commercial workflows stay outside this repository.

## Current Alpha

The current alpha is a local CLI that scans an explicit Git repository and
prints a concise candidate-facing summary. It writes no files by default.
Optional output is local and explicit.

```bash
npm exec -- firstrung scan /path/to/project
```

## Near-Term Priorities

1. Keep public source and published npm packages aligned.
2. Improve first-run docs, examples, and package README coverage.
3. Tighten metadata-only Git collection and contribution attribution.
4. Add redaction and secret-safety checks before broader adapters.
5. Expand deterministic basic rules with fixtures and clear report copy.
6. Stabilize `scan.json` as the single local artifact for tool integrations.
7. Add local adapters only where the default posture remains inspectable and
   private by default.

## Contribution Lanes

Good public contributions include:

- schema contracts and parser tests;
- local Git collector classification improvements;
- deterministic rule behavior and fixture coverage;
- report language that is clear, direct, and not evaluative;
- redaction, secret-safety, and privacy-boundary hardening;
- examples and synthetic fixture repositories;
- local adapter groundwork that avoids raw prompt/code upload by default.

## Not on This Roadmap

- Hosted candidate passport service.
- Employer evidence viewer.
- Institution dashboard.
- Proprietary rule packs or benchmark distributions.
- Outcome-linked skill models.
- Attestation registry.
- Paid project or hiring workflows.
- Automated hiring recommendations, single scores, or public leaderboards.
- Private PRDs, OpenSpecs, customer strategy, or commercial planning material.

## Release Principle

Every published npm package should point back to public source that reviewers
can inspect. Maintainers should push source and create release tags before, or
as part of, package publication.
