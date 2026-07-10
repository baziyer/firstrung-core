# Packages

Current package layout:

- `schema`: shared event, evidence, rule, receipt, report, and profile schemas.
- `collector`: metadata-only local Git collection and attribution.
- `rules`: unified rule pipeline and basic inspectable rules.
- `ai-session`: source-neutral AI session events and evidence signal conversion.
- `pi-coach`: optional FirstRung Coach adapter powered by Pi with non-mutating tool lockdown.
- `report`: concise terminal summaries and optional local artifacts.
- `cli`: `firstrung` command-line interface.

Packages should stay small, source-neutral, and inspectable. Public packages
must not depend on private platform code or private product strategy.
