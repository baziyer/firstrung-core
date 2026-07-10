# @firstrung/collector

Local Git collector for FirstRung evidence signals.

The alpha collector requires an explicit Git repository path and reads Git
metadata plus tracked file paths. It does not collect raw source, raw diffs,
raw prompts, private logs, or environment values by default.

Changed paths use `change_window` attribution. This records Git-window
membership without claiming who made the change. Added, modified, removed,
renamed, and copied paths stay distinct so a removed or renamed test cannot be
mistaken for new coverage. Risk labels are conservative path-name heuristics,
not source-code findings.
