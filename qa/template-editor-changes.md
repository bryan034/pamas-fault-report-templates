# Template editor changes

> This describes the 14 October upgrade. See [15 October refinements](template-refinements.md) for subsequent controls, permanent deletion, resizing, and current validation results.

Date: 14 October 2026. This update changes application behavior; [the earlier audit](audit.md) is a historical baseline, not a current coverage report.

## Implemented

- A builder ribbon with input/image/cover boxes, PDF font selection, editable font size, font colour, and undo/redo. Selected boxes have edge/corner resize handles, keyboard nudging and Delete/Backspace. Undo retains five changes; dragging counts as one change. Typing controls retain native keyboard behavior.
- Input fields can overlap cover boxes. **Only view cover boxes** hides inputs for cover editing. Clean-preview return is **Back to template review**. Configuration export is removed; the clean PDF can still be downloaded.
- **Extract data from image** opens a darkened crop overlay. A named region becomes a draggable OCR item; users can retake/cancel, assign it to a field, or drop it onto a value. Template crop rules read fresh values from subsequent report images, rather than saving sample OCR readings as defaults. Report crop items and values are persisted.
- Uploaded templates can be reopened and edited. Immutable PDF/schema revisions pin existing reports to their original template; new reports use the latest revision. Stale concurrent edits return a conflict instead of overwriting changes.
- Report rectangles and ticks can be drawn anywhere on a page, saved, and rendered into downloaded PDFs. This includes the built-in Fault Report; legacy photo-relative rectangles remain readable.
- Live preview retains its last completed canvas while replacement pages render offscreen. Debounce is reduced to 120 ms. Uploaded-template previews reuse bounded, expiring in-memory photo tokens instead of resending photos on each keystroke; saved reports and downloads still supply complete image data.
- Deleting a template archives it, including the built-in Fault Report. Existing reports/photos are retained and editable; new drafts are blocked until restoration. Archived cards are accessible through **Show archived templates**.
- Custom PDF text that cannot fit even at the readable minimum now produces field-specific validation feedback instead of silently clipping content. Missing required checkbox styling is also corrected.

## Source and verification

- Builder controls/history: [template-builder.tsx](../app/templates/new/template-builder.tsx), [use-edit-history.ts](../lib/use-edit-history.ts), [template-editing.ts](../lib/template-editing.ts).
- Cropping and OCR: [image-extraction.tsx](../components/image-extraction.tsx), [template-image-ocr.ts](../lib/template-image-ocr.ts).
- Report preview/annotations: [custom editor](../app/templates/custom/template-editor.tsx), [persistent PDF viewer](../components/template-pdf-viewer.tsx), [built-in editor](../app/templates/fault-report/editor.tsx), [custom PDF renderer](../backend/app/template_pdf.py), [fault PDF renderer](../backend/app/pdf_service.py).
- Persistence/API: [template database](../backend/app/template_database.py), [revision/backfill helpers](../backend/app/template_versions.py), [shared API](../backend/app/template_main.py), [preview cache](../backend/app/preview_assets.py), [fault API](../backend/app/main.py).
- Backend regressions: [test_template_editing.py](../backend/tests/test_template_editing.py) covers revisions, additive legacy backfill/idempotence, image retention, archives, cache scoping/expiry, crop validation/persistence, and actual rendered pixels for shapes without photos.
- Browser regressions: [templates.spec.ts](../tests/browser/templates.spec.ts), [template-history.spec.ts](../tests/browser/template-history.spec.ts), [template-versions.spec.ts](../tests/browser/template-versions.spec.ts), and [updated audit scenarios](../tests/browser/audit.spec.ts). Checks include all five undo steps, crop item drops, saved template reopening, historical/new report revisions, built-in page shapes, archive restoration, and retaining preview frames without repeat photo uploads.

TypeScript checking, production build, OCR helper tests, isolated backend tests, and Chromium workflows were run. PostgreSQL verification used a disposable database, never production drafts; browser tests use temporary SQLite databases on separate service ports. Builder/report screenshots were inspected. This is not a claim of 100% coverage or arbitrary-PDF/OCR accuracy.

Latest regression results:

- Backend: **108 passed, 1 skipped, 5 expected failures**. The skipped test requires an explicitly configured disposable PostgreSQL database. An earlier full PostgreSQL-backed run in this update passed **107 tests with 5 expected failures**, before adding the final legacy-backfill and built-in shape regression cases; those two additional cases passed in the latest SQLite run.
- Browser: **15 normally passing scenarios and 1 expected failure**. Playwright prints `16 passed` because the known OCR-parser failure is marked expected; it is not a fix.
- OCR helper unit tests: **4 passed**. TypeScript, production build, Compose configuration validation, and tracked diff whitespace checks passed.

## Known limitations

- Five backend expected-failure cases remain from the earlier audit: truncated JPEG decoding in both services, non-finite fault-current input, source content recoverable under the built-in PDF masks, and numeric calculation overflow. One browser expected failure documents the legacy quoted-label OCR parser borrowing another label's reading. These are known defects, not passing functionality.
- The built-in Fault Report OCR worker still depends on an external CDN. Custom crop recognition can also be inaccurate: inspect extracted values before confirming them. Browser automation is Chromium-only; physical-device, load/concurrency, security, cloud-deployment, and backup/restore verification are not included.
- Covers visually obscure PDF content; they are not secure redaction. Do not publish a filled source PDF containing confidential data merely because it is visually covered.
- Revision snapshots duplicate PDF data to preserve old reports. There is no retention/purge policy yet. Preview photo caching is temporary process memory, not durable storage or a replacement for saving.
- Root-project lint has historical generated/vendor/cache scanning problems. Historical coverage percentages in `coverage-summary.json` have not been recalculated for this release.

## Upgrade and rerun

Back up important databases. From the repository root run `docker compose up --build -d` to rebuild/start the application. Startup adds tables and binds legacy drafts without deleting records. Do not use `docker compose down -v`. This change does not remove the built-in service or any database volume.

```sh
npx tsc --noEmit --incremental false
npm run test:ocr
npm run test:templates
npm run build
```

From `backend`:

```sh
PYTHONDONTWRITEBYTECODE=1 UV_CACHE_DIR=.uv-cache uv run python -m pytest -q
```

Optional PostgreSQL tests require `QA_POSTGRES_URL` pointing only to an isolated disposable test database; never use production credentials. Browser setup/ports are documented in [README](../README.md) and [playwright.config.ts](../playwright.config.ts).
