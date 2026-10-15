# Template selection, error navigation and image references

Updated 15 October 2026, following [direct editing](direct-editing.md).

## Implemented

- The initial PDF upload shows a centered Choose file button without a visible native No file chosen status. The sample-image chooser is centered too; selected uploads still show their filenames.
- Opening an existing template or finishing PDF analysis selects the first editable field in page/top/left order. Image and calculated fields are skipped when another editable field exists; an image-only template selects its first available box, and a fieldless template stays unselected. This selection does not change or save the template.
- Red calculation messages are buttons that open the relevant calculated field. Smaller named links navigate to individual affected source fields. Navigation exits cover-only/clean preview, selects the field, scrolls its PDF box into view, and reveals its settings. Template extraction-item titles are also actionable: linked items open their destination; unlinked items open the source image box. Dragging/linking/removal remain available.
- The extraction sidebar automatically previews the original PDF region underneath the selected image box. Drawing, moving, resizing, and undoing geometry refresh this reference after the gesture ends. Superseded asynchronous results are ignored. Already-current references are reused rather than re-rendered on ordinary clicks.
- The reference uses the original PDF, not the cleaned background or a saved report. A user-uploaded sample overrides it and remains the reference when the box moves. The same reference file is passed to cropping/extraction. Reference previews are transient browser state, not new report values or draft image uploads. Existing cover controls still determine which source content remains in the cleaned background.
- New report moves from the header to the template action row, directly beside Edit template for uploaded templates, and is green. The built-in library uses the same green action row; its code-based layout still has no interactive template-edit action. Archived templates retain their existing no-new-report behaviour.

## Verification

Four new browser scenarios cover upload presentation and initial field selection, calculation-error navigation to off-screen fields, actual pixel checks of PDF-derived references, crop-dialog source, geometry/undo refresh, uploaded-sample precedence, action placement/colour and navigation. A helper test covers visual ordering, editable-field preference, image-only fallback and empty templates. Existing report and template regression tests are retained.

Results: 33 normally passing browser scenarios plus one expected legacy OCR failure (Playwright reports `34 passed`); 117 backend tests passed, one PostgreSQL-specific test skipped, and four existing expected failures retained. Nine helper/OCR unit tests and TypeScript checks passed. Source-reference and error-navigation screenshots were visually inspected. These results do not imply 100% coverage.

Browser checks use isolated temporary databases. No production containers, database records or Docker volumes are changed. No new dependencies, backend endpoints or database schema changes are required.

## Code

- [Template builder](../app/templates/new/template-builder.tsx)
- [Field-order helper](../lib/template-editing.ts), [PDF-region rasterization](../lib/template-image-ocr.ts)
- [Sample preview and extracted items](../components/image-extraction.tsx)
- [Uploaded-template library](../app/templates/custom/template-draft-library.tsx), [built-in library](../app/templates/fault-report/page.tsx)
- [Browser regressions](../tests/browser/template-navigation.spec.ts), [helper tests](../tests/template-editing.test.mjs)

Apply with `docker compose up --build -d`. Do not remove database volumes as an upgrade step.
