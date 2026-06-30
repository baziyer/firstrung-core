# firstrung

Local FirstRung evidence scanner and report CLI.

```bash
firstrung scan /path/to/project
```

The default scan prints a concise local summary and writes no files.

Use `--since <git-ref>` to give the alpha scanner a contribution boundary. Use
`--out <dir>` to write `scan.json`; Markdown and split debug artifacts require
explicit flags.
