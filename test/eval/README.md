# Deterministic feedback evaluation

This lane checks whether FirstRung's path-metadata feedback stays accurate, modest, concise, and privacy-safe.

Run it after building the workspace:

```sh
node test/eval/run-eval.mjs
```

The runner reads `corpus.v1.json` and prints a versioned JSON report to stdout.
It exits non-zero when a labelled case fails or when the corpus is not marked
synthetic-only, contains human feedback or repository data, or allows network
access. It does not make network requests or read a real user repository;
repository-shaped cases are created from synthetic fixtures in a temporary
directory and removed after evaluation.

The initial gates cover:

- Git-window attribution without person attribution;
- `observed`-only evidence for path metadata;
- deleted, renamed, copied, unrelated, colliding-ID, multi-gap, mixed-priority,
  and test-only adversarial cases;
- known path false positives such as `.github/ISSUE_TEMPLATE/config.yml`;
- privacy sentinels; and
- the default terminal limit of five lines and 65 words, forbidden certainty
  language, plus Markdown line and word budgets on every case.

Add a labelled case before changing a rule, template, or renderer. Keep real pilot feedback in a consent-controlled private system; do not copy repository names, paths, commits, output, prompts, or free-form user text into this public corpus.
