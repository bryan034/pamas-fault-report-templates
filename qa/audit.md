# Checker audit

> Historical, pre-editor-upgrade results. The coverage figures and defect list below describe the earlier code, not the current release. See [Template editor changes](template-editor-changes.md) for the implemented changes, current verification, and remaining known issues. QA-003 and QA-008 have since been fixed.

Date: 14 October 2026 (Singapore). Scope: fault-report application, shared custom-template service, their APIs/database models, PDF generation, OCR, and browser workflows. Application behavior was not changed; this audit adds tests and test configuration.

## Results

- Backend run with isolated PostgreSQL: **101 passed, 6 strict expected failures**. The expected failures reproduce five defects, including the same malformed-image defect in both services.
- Backend repeat after Docker became unavailable: **100 passed, 1 PostgreSQL test skipped, 6 strict expected failures**.
- Chromium browser run: **9 passed, 2 expected failures**. Playwright prints `11 passed` because expected failures satisfy the test runner; those two behaviors are still broken.
- OCR parser unit tests: **4 passed**.
- TypeScript check and production build: passed.
- Full-project lint: failed. Application-source lint also fails on one existing navigation rule.
- Backend combined statement/branch coverage: **99.64%**, up from the measured 81% baseline. Statements: **1,311/1,314 (99.77%)**; branches: **331/334 (99.10%)**. No backend coverage exclusions were added.
- Partial source-mapped browser coverage: **3,179/4,390 lines (72.41%)**, **138/235 functions (58.72%)**, **603/709 V8-derived branches (85.04%)** across 15 delivered client modules. This is not whole-repository coverage. Link-driven navigations can lose old JavaScript contexts; server-rendered code, other components, and dependencies are not included. These browser branch figures are not directly comparable to Python branch coverage.

**100% overall coverage has not been achieved. Neither this suite nor 100% line coverage would prove every possible behavior correct.** See [coverage-summary.json](coverage-summary.json) for the measured scope and counts.

## Confirmed defects

| ID | Priority | Reproduction and observed result | Relevant implementation |
| --- | --- | --- | --- |
| QA-001 | High | Remove the last 40 bytes from a valid JPEG and upload it. Both preview APIs return HTTP 500 instead of rejecting the invalid image. `Image.verify()` succeeds, but later full decoding fails. | [Fault upload validation](../backend/app/main.py), [shared upload validation](../backend/app/template_main.py), PDF image decoders |
| QA-002 | Medium | Submit `l1_current="inf"` and `rated_current="60"` to the fault preview API. Accepted string values reach `round(inf)` and produce HTTP 500 rather than validation feedback. This is an API-level case, not a normal numeric-control entry. | [_load_percentage](../backend/app/pdf_service.py), [ReportData](../backend/app/models.py) |
| QA-003 | High | Put long textarea content into an accepted narrow, 5-point-high custom field. The renderer shrinks only to 4pt, then still succeeds while clipping overflowing lines. Some saved input is absent from the visible PDF. | [Custom text fitting and clipping](../backend/app/template_pdf.py) |
| QA-004 | High | Generate an empty fault report and extract its PDF text. Every original source word longer than three characters remains underneath the white masks. Embedded original graphics also remain in the output. Visually covering content is not removing it. | [build_blank_template and PDF merge](../backend/app/pdf_service.py) |
| QA-005 | Medium | Add finite `1e308` numeric operands in a custom calculated field. Overflow produces `inf` in the backend instead of a validation error or blank calculation. | [resolved_values](../backend/app/template_models.py) |
| QA-006 | High | Ask for `Bx1` with qualifier `Max` in `Bx1 Min 20 Bx2 Max 60`. The parser returns **60**, borrowing another label's reading; the expected result is no match. This check isolates parsing from OCR recognition accuracy. | [extractQuotedReading](../lib/template-ocr.ts) |
| QA-008 | Low | Leave a required custom checkbox unchecked. Its outline is gray (`rgb(207, 215, 229)`), not the light-red missing-field outline (`rgb(239, 167, 173)`). | [Custom checkbox control](../app/templates/custom/template-editor.tsx), [styles](../app/globals.css) |

The backend regressions are marked `xfail(strict=True)` and browser regressions use `test.fail`. They are **not fixes** or proof that these features work. After correcting a defect, remove its expected-failure marker and require the test to pass normally.

## Tooling and dependency findings

- **QA-007:** Root lint scans generated PDF/OCR scripts and the local Python cache. The initial cleanly completed run reported 35 errors and 3,135 warnings; counts vary with generated cache content. The final source-only run found one application error: `@next/next/no-html-link-for-pages` in [the fault draft library](../app/templates/fault-report/page.tsx). The shared-template UI documents a deliberate full-navigation workaround for Vinext, so replacing all anchors automatically would be inappropriate. Reconcile that deliberate choice with ESLint, and exclude generated/vendor/cache files from root lint.
- **QA-009:** Fault OCR still downloads its worker from `https://cdn.jsdelivr.net/npm/tesseract.js@v6.0.1/dist/worker.min.js`. Blocking external requests reliably yields “Automatic reading failed.” The new shared-template OCR uses local worker/core assets and passed actual OCR and scanned-page detection checks. Fault OCR is browser-executed, but is not entirely independent of external asset availability. See [fault worker setup](../app/templates/fault-report/editor.tsx) and [local shared worker setup](../lib/template-image-ocr.ts).
- FastAPI TestClient emits a Starlette/httpx deprecation warning. It did not prevent tests from passing.

## Workflows exercised

- Fault editor: period default, title validation, report-number zero padding, full-element priority selection, temperature difference, derived load, reference-photo upload without OCR, preview readiness, save/update/reload, titled PDF download, reset cancellation/confirmation, company prefix suggestions and keyboard selection, search/company/report-date filters, rename, and delete cancellation/confirmation.
- Custom templates: PDF upload/analysis, corruption and file-type errors, explicit review before save, two-page PDF handling, field drawing and clear regions, property editing, label/font/color/alignment/type/options/required settings, image fitting, clean-template preview, schema/background downloads, OCR mapping and actual synthetic-photo recognition, and raster-only scanned-page detection.
- Custom reports: text/textarea/number/date/time/select/checkbox/calculated fields; company/date roles; save/reopen with photos; layout movement/reset; rectangle drawing, color, line width, deletion, persistence, and PDF download; title rename; missing-field reminders; network/save/preview error recovery.
- API/model checks: malformed JSON, missing records, draft scoping and CRUD, legacy-import validation, duplicate company handling, image MIME formats and size limits, aggregate upload limit, malformed references/options/calculations, invalid date/time/numeric data, OCR review requirements, encrypted/too-many-page PDFs, AcroForm widgets and rotations, font fallback, text wrapping, annotations, and 300-field analysis limit.
- Isolated PostgreSQL: JSONB and binary image persistence, case-insensitive company upsert, committed draft retrieval after engine disposal/reconnection. This tests client reconnection, **not** a PostgreSQL container restart or backup/restore.
- Responsive browser checks: six application pages at 390px and 800px widths, without horizontal overflow. A representative fault PDF was rendered and visually inspected; visual review was not an exhaustive pixel-by-pixel comparison of every template.

## Remaining coverage and verification gaps

- Backend: three unexecuted statements/branches in [template_pdf.py](../backend/app/template_pdf.py): `None` table-cell handling (line 150), too-short post-caption region guard (line 232), and ignoring a rectangle assigned to a different image field (line 432). The line-232 guard appears unreachable under preceding minimum-height/caption-space checks. No artificial coverage exclusions were used to hide it.
- Frontend: not every failure/cancellation path, upload/image removal interaction, builder formula/crop-setting interaction, home-card rename handler, original editor arrangement/annotation interaction, or legacy browser-storage migration path is covered by a browser test. Some are covered at backend/helper level only. Chromium is the only tested browser; mobile viewport emulation is not physical-device testing.
- No load/concurrency soak testing, penetration testing, complete accessibility audit, VM/cloud deployment test, WAN/Wi-Fi device test, production preview/download test, database backup/restore drill, or arbitrary-PDF/OCR accuracy corpus benchmark was completed.
- The original camera-upload regression suite tests a synthetic **5152×3864 JPEG** and API/render behavior. That does not establish compatibility with every camera image, EXIF orientation, color profile, or damaged JPEG.
- Docker was briefly unavailable after the interruption. The final check found all five application containers running, both APIs and both databases healthy, and `docker compose config --quiet` passing. The disposable audit database container no longer exists. Browser checks used isolated SQLite databases and separate API ports, not production drafts. Container health is not proof that every production workflow works.

## Re-run

From the repository root:

```sh
npm run test:ocr
npx tsc --noEmit --incremental false
npm run test:templates
npm run build
npm run lint
```

Browser tests start isolated API services on 8011/8012 and the web app on 5174; keep those ports free. Chromium must be installed using `PLAYWRIGHT_BROWSERS_PATH=.playwright npx playwright install chromium` if not already available. [Playwright configuration](../playwright.config.ts) creates temporary SQLite databases, preserving your normal saved drafts.

From `backend`:

```sh
PYTHONDONTWRITEBYTECODE=1 UV_CACHE_DIR=.uv-cache uv run python -m pytest -q
PYTHONDONTWRITEBYTECODE=1 UV_CACHE_DIR=.uv-cache uv run --with coverage python -m coverage run --branch --source=app -m pytest -q
UV_CACHE_DIR=.uv-cache uv run --with coverage python -m coverage report -m
```

The PostgreSQL integration test is optional unless `QA_POSTGRES_URL` points to an **isolated disposable test database**. Do not point it at a production database: it creates tables and writes fixture company/draft records. During the complete audit this used a dedicated tmpfs PostgreSQL container, created with `--rm`; the final cleanup check confirmed that container no longer exists. No production volumes were removed.

Coverage tooling was used ephemerally, without adding application dependencies. [checker-fixture.ts](../tests/browser/checker-fixture.ts) writes raw Chromium coverage to `QA_ARTIFACT_DIR`, or the ignored `test-results/checker-coverage` folder by default. Browser metrics in this report were converted using temporary `v8-to-istanbul` and `istanbul-lib-coverage` tooling; no persistent frontend coverage threshold is configured.

Supporting tests: [backend audit](../backend/tests/test_audit.py), [existing template tests](../backend/tests/test_templates.py), [browser audit](../tests/browser/audit.spec.ts), [end-to-end template workflow](../tests/browser/templates.spec.ts), and [OCR parser tests](../tests/template-ocr.test.mjs).
