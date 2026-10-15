# Legacy Fault Report service retirement

Updated 15 October 2026.

Historical snapshot: the later [source cleanup](source-cleanup.md) removes the retained legacy source/tests. The owner also subsequently authorized deletion of the old Fault Report volume; it is no longer preserved locally. The checks below describe the earlier retirement step.

## Scope

- Compose now defines only `web`, `template-service`, and `template-db`. The web dependency on the legacy API and the legacy database volume declaration are removed.
- The shared backend image defaults to `app.template_main:app`.
- The library no longer fetches built-in template settings or exposes the built-in card; rename, archive, recover, and permanent deletion use only the shared template API.
- Existing uploaded templates and their reports are unchanged. The existing `FAULT_REPORT_DB_PASSWORD` environment variable remains in use so initialized shared database credentials do not change.
- Legacy source/routes remain for reference and isolated regression tests. They are not supported by the normal three-service deployment. This change does not convert old built-in drafts into uploaded-template drafts.

## Data and runtime checks

Read-only inspection of the active Docker environment found no `fault-report-service` or `fault-report-db` containers, so no container deletion was necessary. The existing `fault-report-generator-source_fault-report-postgres` and `fault-report-generator-source_template-postgres` volumes were present and neither was removed or modified. Unrelated containers were left untouched. The application stack was not started or rebuilt in Docker as part of this change.

The retired database volume is detached from Compose, not erased. Its records are not accessible through the shared report library. Do not prune/delete it if those records may be needed. README contains upgrade/removal guidance for environments where legacy containers still exist.

## Verification

- `docker compose config --quiet`: passed.
- `docker compose config --services`: exactly `template-db`, `template-service`, and `web`.
- `docker compose config --volumes`: only `template-postgres`.
- TypeScript check (`npx tsc --noEmit --incremental false`): passed.
- Targeted Playwright files (`service-retirement`, `templates`, `zz-template-refinements`): 9 passed. The new test blocks legacy API requests and verifies the library makes none, displays no connection error, and retains template creation and archive filtering.
- Backend suite: 117 passed, 1 PostgreSQL-only test skipped, 4 existing expected failures. Expected failures are not fixes.
- `npm run build`: passed.

Browser checks used isolated temporary databases. They did not connect to the saved PostgreSQL volumes. This verification does not claim a Docker image build or end-to-end production deployment test.
