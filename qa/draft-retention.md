# Thirty-day draft trash — 18 October 2026

Implemented additive deletion markers, editor/owner-only Recently Deleted,
restoration, unchanged draft/image/revision data during retention, and expiry
cleanup at startup, hourly while running, and on draft-list requests.

Verification:

- Full backend suite: 169 passed, 2 skipped, 1 existing expected failure.
- Targeted retention/templates/access suite on PostgreSQL: 46 passed, each API
  test in a disposable schema; no application tables/data were used as fixtures.
- Nine browser access/retention/report-entry checks passed using temporary
  SQLite data. Includes delete confirmation, trash after reload, restoration
  with image bytes intact, and hidden trash controls for Viewers.
- TypeScript and frontend/backend Docker builds passed. Targeted frontend lint
  has no errors; existing plain-image usage produces warnings.
- Before rollout: 1 active draft, 3 templates, no deletion-marker table. After
  rollout: same draft/template counts, the new marker table with zero entries,
  and no leftover disposable QA schemas. Existing PostgreSQL volume preserved.
- Rebuilt frontend, backend health and Recently Deleted listing returned HTTP
  200 in read-only local smoke checks.

Tests simulate dates instead of waiting 30 days. They verify the exact expiry
cutoff, repeated DELETE not extending retention, UTC normalization, cascade
cleanup of draft images/binding/marker, retention of unrelated reports/shared
template revisions, archived-template restoration, permanent parent deletion,
and cleanup failure retry without logging secrets.

The scheduler cannot run while the backend is asleep/offline. Expired records
then await the next startup/list request/sweep, but cannot be restored after
the cutoff. Backup/WAL retention and secure disk erasure are separate concerns.
Previously hard-deleted drafts are not recovered. Explicit permanent deletion
of an archived template still removes all associated trash immediately.

Operational guide: [draft retention](../docs/draft-retention.md).
