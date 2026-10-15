# Retired-source cleanup

Updated 15 October 2026. Supersedes the retained-source state in [service retirement](service-retirement.md). Earlier QA documents are historical records, not current test counts or current source maps.

## Removed

- The `app/templates/fault-report/` routes/editor and `lib/fault-report-api.ts`.
- The original backend `main.py`, `database.py`, `models.py`, and `pdf_service.py`.
- Fixed-form PDF assets, the built-in preview PNG, legacy sample photos, and the two fixed-report generation scripts.
- Legacy-only `test_api.py`, `test_models.py`, and `test_pdf.py`, plus built-in-only scenarios from mixed backend/browser files. Shared scenarios in those mixed files remain.
- Committed Python bytecode for the removed modules/tests and the package initializer. Generated caches are already ignored.
- The legacy Playwright API server, test database, and API URL override.

Existing shared-service helpers `pdf_shapes.py`, `report_styles.py`, and `report_configuration.py` remain because the active template system imports them. The shared PostgreSQL schema, draft data, OCR rules, calculations, input validation, revision bindings, and API contracts were not changed.

## Behaviour-preserving simplifications

- PDF export groups fields by their effective page, including report layout overrides, once rather than scanning every field for every page. Page ordering, within-page definition order, field-before-shape drawing, styles, and legacy image-relative annotations are preserved. A regression checks moved fields and paint order; existing render tests cover images and shapes. No speed benchmark is claimed.
- Removed 183 CSS selectors with no corresponding class in remaining application/component/library source, including fixed-form positioning, legacy upload/current controls, and superseded builder controls. Retained selectors and declarations keep their existing cascade order. Responsive/browser regression tests remain.
- Removed the preview's unused built-in-only locked-field, extra-read-only, and per-field-length options. The sole remaining caller never supplied them; calculated fields remain read-only and the existing 20,000-character default remains unchanged.
- Backend tests now share one isolated API fixture in `tests/conftest.py`, rather than constructing a legacy/shared pair per test. Optional PostgreSQL runs use one unique disposable schema per test.
- Kept meaningful camera-image and CORS checks by expressing them against the shared API. The synthetic 5152×3864 JPEG check exercises preview, save, image retrieval, and PDF download; it is not a guarantee for every camera/colour profile or damaged file.

The legacy Compose password variable and package identifiers remain for compatibility. No application data migration or Docker-volume operation was performed during this source cleanup. The old Fault Report volume was deleted separately at the owner's request; active uploaded-template storage was not touched.

## Verification

- Backend, SQLite: **83 passed, 1 PostgreSQL-only test skipped, 1 existing strict expected failure**.
- Backend, isolated PostgreSQL 17: **84 passed, 1 existing strict expected failure**. The temporary RAM-backed container used no application volumes and was stopped/automatically removed afterwards.
- Browser: **27 normally passing scenarios plus 1 existing expected failure**; Playwright reports `28 passed`. Tests start only the shared API and web app with a temporary SQLite database.
- Helper/OCR unit tests: **9 passed**.
- TypeScript, including unused-local/parameter checks: passed.
- Frontend build: passed; no `/templates/fault-report` routes remain in the route manifest.
- Compose configuration validation and offline Python lockfile validation: passed.

The malformed-JPEG backend regression and quoted-label OCR browser regression remain expected failures, not fixes. Removing tests for the retired system does not resolve defects in the active shared system or establish 100% coverage.

Scoped frontend ESLint still reports **4 existing errors and 9 warnings**: one synchronous-state-in-effect error in `components/image-extraction.tsx` and three ref/immutability errors in `components/resizable-report-workspace.tsx`. These checks are not claimed to pass; changing resize/ref/effect behaviour solely to satisfy lint was outside this behaviour-preserving cleanup. No Docker image build, production deployment, load test, or new backup/restore drill is claimed.

## Apply

Run `docker compose up --build -d` to rebuild the copied source in the existing three-service deployment. Do not remove the active database volume. Previously committed versions of deleted source/assets can be recovered from Git history; old database records require an existing database backup.
