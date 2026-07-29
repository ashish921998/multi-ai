# Local issue tracker

Issues are Markdown files in this directory. The `id` in frontmatter is the issue identity; the title is the human-facing name.

Fields:

- `status`: `open` or `closed`
- `label`: `wayfinder:map`, `wayfinder:grilling`, or `wayfinder:prototype`
- `parent`: the map id for child issues
- `blocked_by`: ids of issues that must close first
- `assignee`: the current claimant, or empty when unclaimed

The frontier is the set of open child issues whose `blocked_by` issues are all closed and whose `assignee` is empty. A ticket is claimed by filling `assignee` before doing work. Resolutions are recorded as comments or an appended `## Resolution` section, then the issue is closed.
