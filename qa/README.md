# Verification

Run checks against disposable databases, never saved application data:

```sh
npx tsc --noEmit --incremental false
npm run test:ocr
npm run test:entry
npm run test:ids
npm run test:deployment
npm run test:access
npm run test:devdocker
npm run test:quick
node --experimental-strip-types --test tests/template-editing.test.mjs
npm run test:templates
npm run build
cd backend && uv run python -m pytest -q
```

Playwright starts an isolated SQLite API and browser server. Backend tests use
SQLite by default; set `QA_POSTGRES_URL` only to a disposable PostgreSQL database
to verify private-schema migrations and PostgreSQL behaviour. Each test schema
is isolated and removed afterwards. Real Word conversion requires the optional
converter fixture; see `docs/word-templates.md`.

Expected failures and skipped provider tests must be reported separately. Offline
tests do not establish live Google sign-in, Cloudflare container routing, DNS,
conversion fidelity, capacity, or backup restoration.

## Cleanup verification — 22 October 2026

- Backend: 234 passed, 3 optional checks skipped, 1 existing strict expected failure.
- PostgreSQL 17: 42 migration/revision/retention/authentication checks passed using
  disposable schemas; all 5 migration checks also passed with schema-drift checking.
- Browser: 53 reported passed, 1 skipped. The reported passes include the existing
  expected-failure OCR assertion; that OCR limitation remains unresolved.
- Thumbnail/sidebar cleanup: 22 affected browser scenarios passed again after
  reinstalling the cleaned dependency set.
- Node helper/deployment checks: 39 passed.
- TypeScript and staging frontend build passed. Full ESLint: no errors, 18 warnings.
- Wrangler backend dry-run built Python and ONLYOFFICE images and validated both
  private bindings. Python 3.12 image migration upgrade/check smoke test passed.
- Documentation links and whitespace checks passed.

The PostgreSQL QA container used temporary storage and was removed. No saved
application database was migrated or reset. No cloud resources were deployed.
Live Cloudflare egress/callback routing, Google sign-in, converter load/fidelity
and backup restoration remain staging acceptance checks.

## Editable clean preview, font sizes and whole-photo BX extraction

- Clean preview uses the existing field/cover overlay and preserves undo/redo.
  Cover changes trigger a debounced, cancelable refresh of the cleaned background;
  font/label-only changes do not rerender the background PDF.
- Template/report font controls use fixed point-size dropdowns. Explicit report
  sizes retain their selected size in preview, PDF and DOCX, expanding field bounds
  within the page. Unrenderable page-sized text returns a named error.
- Whole-photo browser OCR recognises BX1/BX2/BX3 regardless of fixed crop position.
  Matching uses current page/geometry and nearest-image ownership. Missing,
  conflicting, low-confidence or tied readings do not overwrite existing values;
  manual edits and image-version checks protect against stale OCR results.
- Backend: 238 passed, 3 optional skips, 1 existing expected failure. Includes
  exact-font PDF/DOCX checks, page-boundary growth and empty-field growth.
- Node helpers: 44 passed, including BX parsing, row reconstruction, conflicts,
  duplicate field groups, page isolation and geometry overrides.
- Browser regression exercised all current scenarios. The clean-preview refresh
  assertion was corrected to wait for cover changes (field-only changes do not
  require background rasterisation), then the three new feature checks were rerun.
- TypeScript, staging frontend build and lint passed (lint warnings remain).

Whole-photo OCR was exercised with real Tesseract on synthetic photos whose BX
readings appeared in different locations. Accuracy on arbitrary real thermal
photos is not guaranteed; check readings against the uploaded image. Existing
manual crop extraction and its documented qualifier limitation remain available.

## Report history and top-aligned template/report text

- Report Undo/Redo retains 100 session changes, including photos, values, styles,
  geometry, annotations and reset. Focused inputs support Ctrl/Cmd+Z and redo.
  Multi-event drags record once; preview layout updates preserve the redo stack.
  Draft loading starts fresh history. Saved data is unchanged until explicitly saved.
- Template labels/defaults retain their configured point size even in tiny boxes.
  Nested SVGs use page-point coordinates to preserve glyph proportions. Text starts
  at the top with a one-point inset; report PDF and derived Word text use the same
  top-aligned baseline and line spacing. Inline text editing is top aligned too.
- Verification: 241 backend tests passed, 3 optional skips, 1 existing expected
  failure; 45 helper tests passed. All 14 focused browser checks passed, including
  real BX OCR, exact-size labels in clean preview, report history, drag grouping,
  annotation redo, photo restoration and fresh history after draft reload. Existing
  template undo/redo, direct editing, inline report typing and draft saving passed.
- TypeScript passed; lint passed with the existing 18 warnings.

## Centered template labels and independent covers

- Non-image template labels/defaults retain their font size. Measured glyph bounds
  and line spacing grow only the input box, within page boundaries. Extra space is
  divided equally on opposite sides; image labels stay centered without growing
  the image box. Clean preview uses the same behavior.
- Covers retain their own dimensions during input growth/resizing, linked moves
  and copy/paste. New cover creation still uses the area explicitly drawn or
  requested by the user. Automatic label sizing does not consume an undo step.
- Browser checks cover small and roomy fields, multiline defaults, numbers,
  image geometry, centered padding, clean preview, font-size undo and persisted
  cover/input geometry. Helper checks cover independently sized cover movement
  and duplication.

Verification for centered labels: all 14 focused browser checks and 46 helper
tests passed. TypeScript passed. Changed-file lint passed with one existing hook
dependency warning. These checks use disposable test data.

## Detach background covers when repositioning template inputs

Moving an existing input by mouse, arrow keys or group movement detaches its
background cover and leaves that cover's geometry unchanged. Detached covers get
independent IDs, stay editable, and survive later deletion of the moved input.
Drawing a new field still creates a cover over the original drawn area. Undo/redo
restores both geometry and cover attachment; saving retains the detached cover.

Verification: 46 helper tests and all 15 focused browser scenarios passed (the
new detachment scenario was rerun after correcting its initial-load wait).
TypeScript passed; changed-file lint passed with one existing hook warning.
