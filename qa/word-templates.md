# PDF and Word template verification

Verified locally on 2026-10-17. No cloud deployment or saved PostgreSQL records
were used for destructive tests. The existing local app was rebuilt; its database
volume was retained. The new source-retention table is additive.

## Results

- Full backend suite in the Python 3.12 service image, using isolated SQLite:
  **133 passed, 1 skipped, 1 expected failure**. Real LibreOffice conversion and
  DOCX-to-PDF round-trip tests ran successfully. The skip is the optional
  PostgreSQL-only test (`QA_POSTGRES_URL` was not supplied).
- Full Playwright suite with `QA_WORD_API_URL` pointing to a disposable
  LibreOffice service: **34 passed** as reported by Playwright, including the
  pre-existing OCR expected-failure scenario. The two new scenarios covered
  PDF-to-DOCX downloads and real Word import/edit/save/download.
- Node helper suites: deployment 8, report-entry 3, UUID 5, OCR 4 and editing 5
  tests passed.
- TypeScript `--noEmit --incremental false`, local frontend build and Cloudflare
  staging frontend build passed. Targeted lint of changed frontend files had no
  errors; existing hook-dependency/image warnings remain. The user's existing
  Vite comments/trailing whitespace were preserved.
- Rendered both pages of a generated DOCX report and both pages of its Word
  source with the packaged `render_docx.py`, inside an isolated LibreOffice
  container. Inspected every PNG. Checked mixed page sizes, multiline coloured
  text, right alignment, a photo, tick, date and number. Native text remained
  extractable after conversion back to PDF. Microsoft Word itself was not tested.

## Behaviours covered

The same upload button accepts PDF/DOCX; Word conversion feeds the existing field
detector. Editing a saved Word template does not replace the retained DOCX with
its internal PDF. Reusable defaults, the trial flow, report values, saved drafts
and all three report download choices worked in the browser.

Backend checks verified native DOCX text and styling, images/annotations, blank
reports, invalid format rejection, original-byte retention, immutable source
revisions and preservation of old drafts' export type after a source replacement.
Archive retains source files; confirmed permanent deletion removes them with the
template. Unsafe ZIP/XML, macros, embedded objects, external resources, external
fields and imported HTML are rejected. The missing-converter error is explicit.

## Reproduce

Standard host checks (Word integration skips without LibreOffice):

```bash
cd backend
uv run python -m pytest
```

Run real backend conversion checks using the service image and a read-only mount
of tests. The mounted tests use temporary SQLite, not the Compose database:

```bash
docker compose build template-service
docker run --rm \
  --volume "$PWD/backend:/qa:ro" --workdir /qa \
  --env PYTHONDONTWRITEBYTECODE=1 --env PYTHONPATH=/qa \
  fault-report-generator-source-template-service \
  uv run --project /service --with pytest --with httpx \
  python -m pytest -p no:cacheprovider /qa/tests -q
```

Use your Compose project's actual image name if different. For the full real-Word
browser scenario, start an explicitly disposable API with a container-local DB:

```bash
docker run --rm --detach --name report-word-qa \
  --publish 127.0.0.1:8012:8000 \
  --env TEMPLATE_DATABASE_URL=sqlite+pysqlite:////tmp/word-qa.sqlite \
  fault-report-generator-source-template-service
QA_WORD_API_URL=http://127.0.0.1:8012 npm run test:templates
docker stop report-word-qa
```

Only use this test-only SQLite URL in the disposable container, never to replace
the normal app database setting. The temporary container is automatically
removed after stopping. Do not use the saved local API or production as
`QA_WORD_API_URL`; the tests intentionally create templates and reports.

## Remaining limitations

The truncated-JPEG backend regression and cross-label OCR browser regression
remain expected failures from the earlier audit. There is no claim of 100%
coverage, PostgreSQL verification for this run, or cloud production readiness.
DOCX output is fixed-layout artwork with editable report text, not a reconstructed
native Word table/paragraph document. Legacy `.doc` input requires conversion to
`.docx`. Browser certificate trust and production Access/Supabase permissions
still require device/environment-specific checks.
