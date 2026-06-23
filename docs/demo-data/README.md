# Token Work ROI Demo Data

`token-work-demo.json` contains synthetic data for screenshots, blog posts, and local demos.

It is not real local AI usage data. It contains no conversation content.

The file has two sections:

- `usageSeed`: synthetic daily/session usage rows that mirror the local collector shape.
- `annotationBackup`: import/export-shaped annotations, output links, and project alias rules.

The import API expects matching sessions to already exist in SQLite because annotations are keyed by `device + source + session_id`.
