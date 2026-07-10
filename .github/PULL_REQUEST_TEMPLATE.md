## Summary

Describe the change and the public-core behavior it affects.

## Scope Check

- [ ] This stays within the public trust-layer scope.
- [ ] This does not add hosted passport, employer, institution, benchmark,
      outcome-model, attestation, paid-project, or private strategy code.
- [ ] This does not include private code, prompts, raw diffs, logs, env values,
      secrets, candidate data, or customer data.

## Validation

- [ ] `npm run check`
- [ ] `npm run pack:dry-run` if package metadata, release scripts, or published
      files changed

## Privacy and Evidence Impact

Explain any change to what the tool reads, stores, prints, or writes.
