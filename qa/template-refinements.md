# Template refinements

Historical verification for the previous upgrade. The current hover-based controls, temporary report trials, font settings and defaults workflow are documented in [report-flow.md](report-flow.md).

Date: 15 October 2026. Follow-up to [the editor upgrade](template-editor-changes.md).

## Changes

- Library cards use separate Open template / Edit template buttons. The code-bundled Fault Report remains template-code based, with its Edit template button disabled; uploaded templates support interactive editing.
- Archived cards offer Recover or permanent deletion with a centered confirmation and backup warning. Deletion is archive-only and explicitly confirmed at the API. A transaction deletes that template's reports, images, revision bindings, PDF/schema snapshots, archive entry, and template record; its temporary preview cache is invalidated. Other templates remain intact.
- Built-in deletion also clears its reports/photos/company list and display settings. A minimal tombstone prevents it reappearing or importing old browser drafts. Static application assets and the running service are not deleted.
- Ctrl/Cmd+C and Ctrl/Cmd+V duplicate selected fields/covers in the current builder tab, with new IDs and a bounded positional offset. Linked field covers copy too; filter roles and OCR links are not duplicated. Native text shortcuts remain native. Paste participates in five-step undo/redo.
- New/re-edited template controls offer text, number, date, image, and calculated types; other older types become text in a newly edited revision, not in already saved reports. Alignment is centered. Manual role/alignment/coordinate controls are removed. The ribbon lives above the right-hand review area, separate from the sidebar.
- Calculations have two number-field dropdowns plus an operator. Percentages still compute numerator / denominator × 100 internally. Errors name the calculation and source fields, with a red outline/glow. Backend preview/download reject zero denominators and numeric overflow with HTTP 422; incomplete/problematic values can still be saved as a draft. The previous QA-005 overflow expected failure is now a normal regression test.
- Report sidebar ordering follows page, vertical position, then horizontal position (including per-report adjustments), rather than template array order or alphabetical labels. Desktop editors have independent sidebar/preview scrolling; mobile stays vertically stacked.
- Arrange layout exposes all eight edge/corner resize handles, including in the built-in Fault Report. Per-report sizes/positions save into draft JSON and control the PDF renderer without changing the shared background template. Built-in guides obtain default geometry from the backend instead of duplicating printed positions in CSS.
- Inserted ticks use a curved, tapered, filled vector shape with matching geometry in browser overlays and both PDF renderers. Colour and size are editable and persist; rectangles retain their line-width control.

## Deletion and data safety

Deletion removes records from PostgreSQL stored in the existing named Docker volume. It does **not** delete that shared volume, which also contains unrelated templates and database internals. Ordinary PostgreSQL vacuuming makes deleted space reusable; disk usage need not fall immediately. This is not secure erasure of backups, WAL/recovery logs, old browser-local copies, downloaded PDFs, or filesystem snapshots.

Back up before deletion. Backup commands are in [README](../README.md). Application Recover restores an archive, not a permanently deleted template. Restoring a database backup is a separate administrative operation. The deployment remains shared/no-login, so use only on a trusted network.

## Verification

- Full backend suite against a disposable PostgreSQL instance: **114 passed, 4 strict expected failures**. A later SQLite repeat: **113 passed, 1 PostgreSQL test skipped, 4 expected failures**. No production database/volume was used. The temporary PostgreSQL container used tmpfs storage and was removed afterward.
- The new backend checks cover archive/confirmation guards, dependent-row/photo/revision deletion, retained unrelated reports, cache invalidation, tombstone/re-import protection, named division-by-zero errors, draft saving, and actual built-in PDF field geometry.
- Browser: **19 normally passing scenarios and 1 expected legacy OCR failure** (Playwright prints `20 passed`). These cover library actions, confirmation cancellation, permanent removal, keyboard copying/pasting, allowed field types, centered labels, dropdown operators, error highlighting, positional sidebar order, independent scrolling, edge resizing and persisted tick colour. Existing PDF preview, crop/OCR, revision and archive workflows were also rerun. A subsequent focused test passed after adding pixel verification for the tick in the actual PDF preview canvas.
- Eight helper/OCR unit tests passed. TypeScript checks and production-build verification are included in the handoff. Screenshots are inspected; a rendered green tick is also checked in the PDF preview canvas.

The four known backend expected failures remain: damaged JPEG handling in both services, non-finite built-in current input, and recoverable sample content under the built-in template masks. One legacy quoted-label OCR browser regression remains expected. The built-in OCR worker still depends on its external CDN. These are not passing functionality, and no 100% coverage claim is made.

## Supporting code

- [Library / confirmation](../app/page.tsx)
- [Builder](../app/templates/new/template-builder.tsx), [editing helpers](../lib/template-editing.ts), [calculation validation](../lib/template-calculations.ts)
- [Custom report editor](../app/templates/custom/template-editor.tsx), [built-in editor](../app/templates/fault-report/editor.tsx)
- [Shared API](../backend/app/template_main.py), [built-in API](../backend/app/main.py), [PDF shape renderer](../backend/app/pdf_shapes.py)
- [Backend regressions](../backend/tests/test_template_refinements.py), [helper tests](../tests/template-editing.test.mjs), [browser regressions](../tests/browser/zz-template-refinements.spec.ts)

After updating, run `docker compose up --build -d` from the project root. No production containers were restarted by this change and no production records were deleted.
