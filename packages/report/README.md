# @firstrung/report

Local summary and optional artifact renderer for FirstRung alpha scans.

The renderer produces at most five nonblank lines (target 65 words) by default.
Detailed scope, privacy, and provenance text is opt-in through the CLI's
`--explain` flag.
`scan.json`, Markdown, and split debug artifacts are optional. It keeps raw
code, prompts, diffs, logs, and environment values out of human-readable output
by default. Explicit artifact writes refuse symbolic-link targets and
in-repository symlink ancestors.
