# Report creation, extraction and live editing

This records the preceding upgrade. See [direct-editing.md](direct-editing.md) for the current sidebar, inline typing, one-shot rectangle and title-validation behaviour.

Updated 15 October 2026. This supersedes the Arrange layout/review-checkbox workflows in the earlier QA notes.

## Implemented

- Saved-template Back to editing is transparent/outlined; the uploaded-template draft library's Edit template action is blue. Draft cards have Edit draft and a titled PDF download between rename/delete, in both report libraries.
- Builder clean/cover-only controls are adjacent. Cover boxes are selected directly on the PDF, without a cover dropdown/list. The full-width Preview report creation flow opens the actual report editor against a temporary cleaned background. Continue editing returns to the preserved builder; Save template saves the builder definition, never trial values/photos/formatting. Entering the trial does not save a template or report.
- Template review and report photo-reading confirmation checkboxes are removed, including their server-side download gates. Reading accuracy still requires human judgement.
- Sample-photo controls show the chosen filename and thumbnail. Crop X/Retake controls have explicit contrast and remain visible. Extracted items appear in their own sidebar section under the extraction controls, with italic drag instructions, red outlines for unlinked items, and the actual target label for linked items. Samples never become report defaults.
- Both report editors share hover-to-move/resize fields and shapes, one-shot tick insertion, hover/keyboard shape deletion, and a font family/size/colour toolbar above the preview. Moving a field moves its content before pointer release. Text is refitted after release; during resizing the last valid field texture scales with the box.
- Save draft prompts when font sizes or field geometry changed: Cancel, Save draft only, or Save draft and future configuration. The latter copies only font sizes and positions/sizes. Values, images, extracted readings, shapes, font families and colours are excluded. Existing drafts stay unchanged. Optional/null appearance overrides inherit template settings rather than replacing them with UI defaults.

## Rendering and storage

The cleaned background is rendered once. The Python services return a small transparent PDF page for each populated field, using the same drawing helper as a download. PDF.js renders those pages to individual transparent value canvases. Moving DOM boxes moves content immediately; pointer gestures pause preview requests until release. Shape overlays use the same tick geometry as the PDF renderers. Typing still uses a short debounce and cached photo uploads for saved templates.

`POST /api/template-try-report` is stateless: it validates/renders the temporary report without database writes or persistent assets. Trial values/photos are held in the editor's browser memory and sent to the local service for rendering; they are discarded when leaving the trial. This is not an offline-only feature.

Per-report appearance overrides live in existing draft JSON. Uploaded-template future defaults create a new immutable revision, with an expected-revision guard to avoid overwriting a newer template; existing reports remain pinned to their original revision. The built-in service adds the `fault_report_defaults` table, read only when creating new reports. Startup creates that missing table without resetting data. Permanent built-in deletion clears these defaults too.

Future-default requests use a separate strict schema that rejects report values/photos/other styles. Drafts are saved before publishing defaults: if publishing fails, the message explicitly says that the draft was saved but future defaults were not updated. Direct library downloads render the stored report, images and revision, not unsaved editor state.

## Verification

- Backend: 118 passed and four strict expected failures against a disposable PostgreSQL 17 container using tmpfs storage. A SQLite repeat passed 117, skipped the PostgreSQL-specific test, and retained the same four expected failures. The temporary container was removed afterward. No production database or named Docker volume was used.
- Added backend tests cover stateless trials/no extra rows, transparent rendering, style validation/persistence, images in direct downloads, titled PDFs, strict value-free defaults, stale-revision conflicts, pinned reports and the built-in defaults/layered preview path. Existing tests now assert that removed review gates no longer reject downloads.
- Browser: 25 normally passing scenarios and one expected legacy OCR failure (Playwright reports `26 passed`). Regressions cover temporary trials and navigation, immediate content movement before mouse-up, hover resize/delete, one-shot ticks, both editors' font settings, inherited optional styles, future-default opt-in, crop controls, sample thumbnail/filename, orphan/link labels, and direct draft downloads. Existing builder, calculations, copy/paste, undo, revision history, archives, deletion, mobile and error-handling checks are retained.
- Eight helper/OCR unit tests and TypeScript checks pass. Production build and visual inspection of builder, uploaded report, extraction and built-in report screenshots are part of this verification. Browser tests use isolated temporary SQLite databases, not the application's PostgreSQL drafts.

The four existing backend expected failures remain: damaged JPEG handling in each service, non-finite built-in current values, and recoverable sample content under the built-in template masks. One legacy quoted-label OCR browser check also remains an expected failure. The built-in OCR worker retains its existing external CDN dependency. These limitations are not claimed as passing functionality; this work does not claim 100% test coverage.

## Supporting code

- [Builder](../app/templates/new/template-builder.tsx), [crop controls and extracted items](../components/image-extraction.tsx)
- [Shared report preview and formatting](../components/report-preview.tsx)
- [Uploaded report editor](../app/templates/custom/template-editor.tsx), [built-in report editor](../app/templates/fault-report/editor.tsx)
- [Uploaded-template API](../backend/app/template_main.py), [built-in API](../backend/app/main.py)
- [Uploaded renderer](../backend/app/template_pdf.py), [built-in renderer](../backend/app/pdf_service.py)
- [Strict future-default schema](../backend/app/report_configuration.py), [appearance overrides](../backend/app/report_styles.py), [built-in defaults table](../backend/app/database.py)
- [Backend regressions](../backend/tests/test_report_flow.py), [browser regressions](../tests/browser/report-flow.spec.ts)

Rebuild from the project root with `docker compose up --build -d`. No production containers were restarted for this change. Back up important databases before upgrading; do not remove volumes as an upgrade step.
