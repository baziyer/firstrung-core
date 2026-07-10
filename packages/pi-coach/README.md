# @firstrung/pi-coach

Optional FirstRung Coach adapter powered by Pi.

This package is isolated from the default `firstrung` CLI. It requires Node
`>=22.19.0` because its Pi SDK dependency, `@earendil-works/pi-coding-agent`,
requires that runtime floor.

The MVP tool profile is non-mutating. It allows only FirstRung-approved coach
tools and rejects shell, generic filesystem, edit, write, delete, and patch
tools. Project and global Pi resources are not loaded by default: extensions,
skills, prompts, themes, and agents files start empty.

This package does not include hosted account, passport, employer, institution,
or commercial workflow features.

## CLI

Dry-run the redacted coach context without loading Pi:

```bash
firstrung-coach coach /path/to/project --dry-run-context
```

Dry-run mode prints the derived context JSON and exits before any Pi SDK import.
The context excludes raw source, diffs, prompts, model responses, command
output, private logs, secrets, and environment values unless an explicit future
flow passes selected snippet consent. It also replaces repository identity,
absolute paths, branch names, refs, and commit hashes with session-local aliases.
Provider/artifact context uses schema-specific allowlists: unknown metadata is
dropped even when its key looks harmless. Actor, username, remote, email, and
URL-shaped identifiers are pseudonymized where they enter an allowed field.

Live mode is networked: the redacted prompt and approved tool results go to the
configured model provider. Repository-relative evidence paths may be included
because they are needed to explain a finding. Inspect `--dry-run-context` first,
then provide explicit consent:

Live coaching uses two confirmations. The first command confirms the disclosed
data categories and resolves the exact provider/model locally; it prints the
target and exits before a provider request because the exact target is not yet
confirmed:

```bash
firstrung-coach coach /path/to/project \
  --out /path/to/project/.firstrung/coach \
  --confirm-provider
```

Then repeat the command with the printed target:

```bash
firstrung-coach coach /path/to/project \
  --out /path/to/project/.firstrung/coach \
  --confirm-provider \
  --confirm-provider-target 'provider/model-id'
```

Before the provider request, the CLI prints the selected provider/model and the
derived field categories that can leave the machine. If selected snippet text
is supplied through the library API, its content is provider-visible only when
that snippet's original ID is also present in `approvedSnippetIds`. General
provider confirmation does not consent to any snippet. Snippet IDs and labels
are separately pseudonymized before disclosure.

The model has no generic shell, filesystem, edit, or artifact-write tool. The
host persists only feedback that contains non-empty `Evidence`, `Inference`,
and `Next steps` sections in that order and stays within 160 words. Invalid or
missing model output fails safely without a feedback artifact.

Default artifact paths:

```text
/path/to/project/.firstrung/coach/
  coach-feedback.md
  coach-artifact.json
  sessions/<session-id>.jsonl
```

After a successful run, the CLI prints each artifact path, the directory to
delete for cleanup, and a reminder to keep `.firstrung/` ignored. The session
JSONL is an allowlisted event envelope, not a raw Pi transcript.

Coach output directories and fixed artifact files must not be symbolic links;
FirstRung refuses them rather than following writes outside the repository.

## Non-networked lockdown probe

On Node `>=22.19.0`, load the installed Pi SDK and verify resource/tool
isolation without creating an agent session or making a provider request:

```bash
npm run probe:lockdown --workspace @firstrung/pi-coach
```

The probe requires empty extension, skill, prompt, theme, and agents-file sets;
in-memory auth/model/session/settings managers; and the exact FirstRung tool
allowlist. CI runs this probe before package dry-runs.
