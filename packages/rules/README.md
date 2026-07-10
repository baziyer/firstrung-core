# @firstrung/rules

Deterministic alpha rules for FirstRung evidence signals.

The first rules cover risk-sensitive changes without nearby tests, tests near
risk-sensitive changes, deployment/config evidence, and dependency evidence.

Path-only rules produce `observed` evidence. `verified` is reserved for a
successful executed check supplied by another evidence source. Nearby tests
must resolve to the same normalized module path; sharing a folder or a generic
path token is not enough.
