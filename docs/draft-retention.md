# Recently Deleted drafts: 30-day retention

Deleting a report draft now moves it to **Recently Deleted** in that template's
draft library. Editors/owners can restore it for 30 days. Restoring retains its
ID, title, values, uploaded images, shapes, font/layout overrides, timestamps
and pinned template revision. Active draft searches exclude deleted drafts.

The deleted draft cannot be opened, downloaded, renamed or overwritten through
its ordinary API routes. Viewers cannot list trash or restore it. The trash
cards show deletion and permanent-deletion dates; restore returns the report to
**Your drafts**. Filters/search also work within Recently Deleted.

## Storage and rollout

The `template_draft_deletions` table records `draft_id` and a UTC
`deleted_at` timestamp. The existing draft, image and revision-binding rows stay
in place until expiry, rather than being copied to a new folder or volume.
Alembic creates the table in the configured database/schema. Existing saved drafts remain active and unchanged. No database
reset or volume deletion is required. Back up data before deploying a release.

Rebuild/start the backend and frontend for local Docker:

```bash
docker compose up --build -d template-service web
```

Cloud deployment requires deploying both services; the Supabase app role must
retain permission to create this additional table/index in the private app
schema. No browser database credentials or Supabase public Data API are needed.

## Expiry and cleanup

- Retention is 30 × 24 hours from the original deletion time, in UTC.
- Repeating DELETE does not extend that window.
- At the cutoff the draft can no longer be restored.
- Expired rows are purged at backend startup, hourly while the backend runs,
  and when an active/deleted draft list is loaded for that template.
- Cleanup removes the draft's uploaded image rows, revision binding, trash
  marker and draft row. Shared template revisions/source files stay available
  for other reports. Cleanup locks rows and deletes in bounded batches.

An idle/stopped/sleeping backend cannot run background cleanup. Physical removal
then happens at the next startup/list request (or the next hourly sweep), not
necessarily at the exact expiry second. Restoration is still rejected at the
cutoff. If a deployment needs a strict independent deletion schedule, provision
an authenticated scheduler separately; this change creates no cloud cron jobs.

Recently Deleted is not a backup. Database backups, snapshots and PostgreSQL
WAL can retain older data under their own policies. SQL deletion is not secure
erasure of individual disk sectors; do not remove the entire Docker volume to
purge one draft. Drafts permanently deleted before this feature cannot be
recovered by this change.

## Template deletion exception

Archiving a template retains its active and deleted drafts. The existing
**Delete permanently** action on an archived template still deletes **all** its
data immediately, including Recently Deleted drafts, after the explicit backup
warning/confirmation. This is separate from deleting a single report draft.

## API

- `DELETE /api/templates/{template}/drafts/{draft}`: soft delete, returns 204.
- `GET /api/templates/{template}/deleted-drafts`: editor/owner-only list with
  `deleted_at` and `expires_at` metadata; expired entries are omitted/purged.
- `POST /api/templates/{template}/drafts/{draft}/restore`: restore before expiry.

Code: [retention/cleanup](../backend/app/draft_trash.py),
[database table](../backend/app/template_database.py),
[routes and lifecycle](../backend/app/template_main.py),
[draft library](../app/templates/custom/template-draft-library.tsx).

Tests use isolated databases and simulated dates, never wait for 30 real days:
[backend tests](../backend/tests/test_draft_trash.py),
[browser restore workflow](../tests/browser/draft-trash.spec.ts).
