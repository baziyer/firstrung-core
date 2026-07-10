# firstrung

Local FirstRung evidence scanner and report CLI.

```bash
firstrung scan /path/to/project
```

The default scan prints a four-line local summary and writes no files. Git path
metadata identifies a change window; it does not identify a person or prove
that a test ran. Use `--explain` for the comparison scope, limitations, privacy
detail, and schema/rule/template/renderer versions.

Check local prerequisites before scanning:

```bash
firstrung doctor /path/to/project
```

Use `--since <git-ref>` to give the alpha scanner a Git comparison boundary. Use
`--out <dir>` to write `scan.json`; Markdown and split debug artifacts require
explicit flags. Report files refuse symbolic-link targets.

Preview a structured feedback packet locally without sending it anywhere:

```bash
firstrung feedback \
  --accuracy partly_accurate \
  --helpfulness 3 \
  --action planned \
  --reason too_wordy \
  --rule rule_tests_near_risky_files
```

The packet is intentionally closed-field: it has no repo, path, commit, output,
prompt, or free-text field.

FirstRung Coach is optional and lives in `@firstrung/pi-coach`; run it with
`firstrung-coach coach <repo>`.
