# Report Formatter

A local-network report formatter for uploaded PDF templates, with a template builder, draft library, browser-only OCR, and PDF generator. Live previews use transparent field layers drawn by the same Python functions as downloaded PDFs, over the cleaned template background.

## Run with Docker (recommended)

Install and start Docker Desktop, then from this folder:

```bash
cp .env.example .env
```

Edit `.env` and replace `FAULT_REPORT_DB_PASSWORD` with a long URL-safe password (letters, numbers, hyphens, and underscores). Then run:

```bash
docker compose up --build -d
docker compose ps
```

Open `http://localhost:5173` on the laptop. On another device on the same Wi-Fi, open `http://LAPTOP_IP:5173`. On macOS, `ipconfig getifaddr en0` often shows the Wi-Fi address. Allow incoming connections to Docker if macOS asks.

The Compose stack has three containers:

| Container | Role | Access |
| --- | --- | --- |
| `web` | Shared template catalog, draft cards, and editor | `localhost:5173` or laptop IP on the LAN |
| `template-service` | Shared PDF analysis, uploaded-template definitions, generic reports, and drafts | `localhost:8001` or laptop IP on the LAN |
| `template-db` | PostgreSQL database for all uploaded templates and their drafts/images | Laptop only at `127.0.0.1:5434` |

Uploaded templates share `template-service` and `template-db`; uploading another PDF does not build or deploy a container. The database continues using the existing `FAULT_REPORT_DB_PASSWORD` variable in `.env` for compatibility; do not change it just because the legacy service was retired. PostgreSQL data lives in the named `template-postgres` volume and survives ordinary container restarts and `docker compose down`. **Do not run `docker compose down -v` unless you intend to delete the active database volume.**

The legacy `fault-report-service`, `fault-report-db`, built-in routes, source, PDF assets, and legacy-only tests have been removed. Previously saved built-in Fault Reports were **not migrated** into the uploaded-template database. At the owner's request, the old local `fault-report-generator-source_fault-report-postgres` volume was also deleted; restoring those old records requires a separately retained backup. The active `template-postgres` volume and its uploaded templates/reports were not changed.

If upgrading a running older stack, stop/remove only its two legacy containers before rebuilding (these commands deliberately omit any volume-removal flag):

```bash
docker stop fault-report-generator-source-fault-report-service-1 fault-report-generator-source-fault-report-db-1
docker rm fault-report-generator-source-fault-report-service-1 fault-report-generator-source-fault-report-db-1
docker compose up --build -d
```

Check `docker ps -a` first: use the exact names from your own Compose project, and skip removal if those containers do not exist. Avoid a broad `--remove-orphans` operation if unrelated containers share the project.

Stop the stack with `docker compose down`. Start it again with `docker compose up -d`.

## Database access

For a SQL console inside the database container:

```bash
docker compose exec template-db psql -U templates -d templates
```

At the `psql` prompt, run `\dt` to list tables or `SELECT id, title, template_id, created_at FROM template_drafts;` to inspect draft cards. Type `\q` to exit. A desktop PostgreSQL client on the laptop can connect to host `127.0.0.1`, port `5434`, database `templates`, user `templates`, and the password from `.env`. The database port is not exposed to other Wi-Fi devices.

The service creates missing tables on startup. Saved draft form values, PDFs, revisions, and uploaded images are stored in PostgreSQL. There is no Supabase account or cloud database. Startup table creation is not a general-purpose schema migration system.

## Create and use an uploaded template

See [source cleanup and current checks](qa/source-cleanup.md), [template navigation and references](qa/template-navigation.md), [direct editing](qa/direct-editing.md), [previous report-flow changes](qa/report-flow.md), [previous refinements](qa/template-refinements.md), and [the earlier editor upgrade](qa/template-editor-changes.md). Older QA documents describe the source/test suite as it existed at that time, including the now-removed built-in report.

Opening a template selects its first editable field in visual page order. Red calculation messages and their named source links select/reveal the affected fields. The extraction sidebar previews the original PDF crop underneath its image box; moving/resizing the box refreshes it after release, while an uploaded sample takes precedence. This preview is also the crop/extraction source. New report is green in the action row beside Edit template.

1. Choose **Create new template** in the template library. Upload a blank or completed PDF, including Excel sheets exported to PDF. Native `.xlsx` uploads are not supported. Limits are 20 MB and 20 pages.
2. The service suggests fields using PDF form widgets, text positions, rectangles, and table cells. Review every suggestion: a PDF does not reliably distinguish labels from sample values. The top ribbon has **Input field**, **Image box**, **Cover box**, font family, editable font size, font color, Undo, and Redo. Click a box to select it; drag it to move, or drag any corner/edge to resize. Delete/Backspace removes the selected box; arrow keys nudge it, Shift uses larger increments, and Alt+arrows resize. Keyboard shortcuts do not delete boxes while you are typing in an input. For scanned pages, use local OCR detection or add boxes manually.
3. New-template field types are **text, number, date, image, and calculated**. Manual draft-filter role, alignment, and coordinate controls are removed. Fields are centered; drag boxes/handles to position or resize them. Older saved reports retain their original field types/revision. Calculations use two number-field dropdowns and a **+**, **−**, or percentage operator. Percentages use numerator/denominator; multiplication by 100 stays internal. Named errors highlight affected controls in red; preview/download reject zero denominators and numeric overflow. Drafts can save unfinished calculations. Text shrinks/wraps to fit, or produces a fit error instead of clipping. Image boxes fit the whole image by default; **Fill box** crops edges. Existing/automatically detected company/date roles continue supporting filtering.
4. **Cover box** masks old values or photographs. Avoid labels and borders. Input/image fields can be placed on top of covers. Select fields directly on the PDF: there is no sticky list of imported fields. The selected field/cover settings appear immediately below **Preview report creation flow**. Covers stay in their original positions when a field moves; edit them directly on the PDF using **Only view cover boxes** (there is no cover dropdown/list). **View clean template** is beside that button; the blue **Continue editing template** button returns to editing. Cleaning renders source pages at up to 216 DPI and removes underlying sample text from the blank PDF; the original PDF is retained separately. New report text remains searchable.
5. The separate **Extract Data from Image** sidebar section contains image selection, sample photos, cropping and extracted items. Select an image box and optionally choose a **Sample photo for extraction**; its filename and thumbnail appear in the sidebar. Click **Extract data from image**. Without a reference upload, the photo inside that PDF box is used. The screen dims; drag over just the value, name the area, and create an extracted item. Escape/X cancels and **Retake area** starts again; both buttons remain visible. **Extracted Data from Image** appears below the extraction controls: unlinked items have red outlines, linked items name their target field. Drag an item onto a value field, or use its **Extracted item** control. Sample readings are never defaults. Saved crop coordinates and links read fresh values from each report's image upload. Keep future photos consistently framed and check OCR output. Older quoted-label rules remain supported.
6. **Preview report creation flow** opens a temporary editor for the current unsaved template. Enter values, upload photos, move fields, format text or draw shapes to test it. **Continue editing** returns to the builder; **Save template** saves only the builder definition, never the trial report values/photos/formatting. Trial reports are not written to the database. No review checkbox is required. After saving, **Back to editing** is an outline button; **Edit template** in the draft library is blue. Each template/configuration save creates an immutable revision: existing drafts retain their layout/schema/background; new reports use the latest revision. The configuration download button and dedicated export endpoint are removed; the blank PDF remains downloadable.
7. Create a report and drop photos into image boxes in the sidebar or preview. The sidebar follows page/top-to-bottom/left-to-right positions, not names or creation order. Desktop sidebar and preview scroll independently. Drag the divider between them to resize the sidebar, or focus it and use arrow keys (Home/End for minimum/maximum). Inputs reflow into additional columns when space permits; mobile stays stacked. Click fields to type directly in the preview, including the temporary template trial. Their matching sidebar controls glow and scroll into view. Drag fields or hover over shapes to move/resize them; clicking outside deselects them. The report toolbar changes the selected field's font, size and colour. Rectangles and ticks are one-shot, and shapes have hover delete controls. The future-configuration dialog wraps text/actions and stays within the viewport on narrow screens. Save updates the current titled draft; missing fields appear centrally without blocking saves. Size/geometry changes offer a separate opt-in to future-report defaults, excluding values/photos/other styles. Reset and draft deletion require confirmation. Draft cards have **Edit draft** plus a PDF download button between rename and delete; it downloads the saved draft with its saved images, not an unsaved editor state.
8. The preview remains live with a 120ms typing debounce. PDF.js renders transparent field pages off-screen and replaces only their value canvases; the cleaned background stays in place. Moving/resizing a field moves/scales its value immediately, with final text fitting refreshed after release. Shapes use matching vector paths in the preview and export. Previous valid layers remain during rendering/errors. A bounded 64MB, 32-entry, five-minute server cache avoids repeat photo uploads during typing and refreshes expired tokens; it is not persistent storage. Saving/downloading send actual report images. OCR reuses one worker per image batch and avoids re-reading identical crops.
9. Cards have separate **Open template** and **Edit template** buttons. The delete icon **archives** a template, retaining reports/photos. **Show archived templates** offers **Recover** or **Delete permanently**. Permanent deletion requires a backup warning/confirmation and removes all reports, images, PDF revisions and configuration for the selected template. Other templates remain untouched.

No LLM or cloud OCR API is used. Uploaded-template OCR serves Tesseract worker/WASM/language assets locally; dev/build prepare them from installed packages. Geometry suggestions and OCR require human review. Template Undo/Redo stores the last **five changes in browser memory** (Ctrl/Cmd+Z; Ctrl/Cmd+Shift+Z or Ctrl+Y); a drag is one change. History is not saved across reloads. Native text-input undo is preserved while typing.

After updating source, run `docker compose up --build -d`. Service startup adds missing tables and backfills existing draft revision bindings without deleting/replacing records. Per-report appearance overrides live in existing draft JSON; uploaded-template future defaults create revisions. Back up important databases before upgrades; never use `docker compose down -v` as an upgrade step.

Copy/paste selected input or cover boxes with **Ctrl/Cmd+C** and **Ctrl/Cmd+V**. Copies retain styling and receive unique IDs; pasted fields do not duplicate filter roles or OCR links. A linked white cover is copied with its field. The clipboard is local to this editor tab and resets on a fresh upload/reload. Native text copying/pasting remains unchanged while typing.

Permanent deletion is a PostgreSQL transaction, not deletion of the shared Docker volume. PostgreSQL reuses deleted storage through normal vacuuming; volume size need not shrink immediately. Backups, recovery logs, previously downloaded PDFs, and browser-local legacy copies are not securely erased. This feature is not a secure disk-erasure operation. Make backups **before** deleting, for example:

```sh
docker compose exec -T template-db pg_dump -U templates -d templates -Fc > templates-backup.dump
```

Keep backups somewhere separate and protected. Recovery from a backup is an administrative database operation, not the archive **Recover** button.

For a SQL console in the uploaded-template database:

```bash
docker compose exec template-db psql -U templates -d templates
```

Tables include `templates`, `template_drafts`, `template_draft_images`, `template_revisions`, `template_draft_revisions`, and `template_archives`. Original/clean PDFs, definitions and thumbnails are retained for each revision; draft bindings identify which revision to use. Draft values, crop items, shapes and photos remain in PostgreSQL. A desktop client connects to `127.0.0.1:5434`, database/user `templates`, using the password from `.env`.

## Development without the full stack

Node.js 22.13+, Python 3.12+, uv, and PostgreSQL are required. Start the database with `docker compose up -d template-db` after creating `.env` as above. In separate terminals, run:

```bash
cd backend
uv sync
TEMPLATE_DATABASE_URL='postgresql+psycopg://templates:YOUR_PASSWORD@127.0.0.1:5434/templates' uv run python -m uvicorn app.template_main:app --reload --host 0.0.0.0 --port 8001
```

```bash
npm install
npm run dev
```

Replace `YOUR_PASSWORD` with the same URL-safe password in `.env`. The web app is on port `5173`; only the shared template Python service needs to run. `NEXT_PUBLIC_TEMPLATE_API_BASE_URL` can override the default template-service URL; otherwise it uses the browser's hostname and port 8001 for Wi-Fi access.

## Tests and code map

```bash
npx tsc --noEmit
npm run test:ocr
node --experimental-strip-types --test tests/template-editing.test.mjs
npm run test:templates
npm run build
cd backend && uv run python -m pytest
```

The active catalog is `app/page.tsx`. Browser tests start only the shared template API on port 8011 and the web app on 5174; keep those ports free. They use a temporary SQLite database, never the saved PostgreSQL database. Backend tests share one isolated API fixture in `backend/tests/conftest.py`. Optionally set `QA_POSTGRES_URL` to an isolated disposable test database: each test uses its own temporary schema, which is removed afterwards. Never point that variable at production. The PostgreSQL-only JSONB/image/reconnection check is skipped without that variable.

For uploaded templates, the builder is `app/templates/new/template-builder.tsx`, the library/editor are in `app/templates/custom/`, and `components/template-pdf-viewer.tsx` renders all PDF pages. The shared API, schema, database, and PDF processing are in `backend/app/template_main.py`, `template_models.py`, `template_database.py`, and `template_pdf.py`. Browser OCR rules are in `lib/template-ocr.ts` and `lib/template-image-ocr.ts`. The browser test starts isolated servers and a temporary SQLite database; it does not modify your PostgreSQL drafts. Install its Chromium browser once with `PLAYWRIGHT_BROWSERS_PATH=.playwright npx playwright install chromium`.

Template fields and report geometry overrides use normalized top-left page coordinates; the backend converts them into bottom-left PDF coordinates when drawing. `components/report-preview.tsx` displays backend-rendered transparent value layers over the background and provides the shared field/shape controls; the same backend drawing helpers generate downloads. `pdf_shapes.py`, `report_styles.py`, and `report_configuration.py` are shared active helpers, not retired Fault Report code.

## Network and privacy

OCR runs in the browser. Drafts and uploaded images go to the shared Python service and its local PostgreSQL container; no cloud OCR or database is used. This deployment intentionally has **no login**: anyone who can reach the laptop's web/API ports on the Wi-Fi can view or change all drafts and create templates. Use only on a trusted network; do not forward ports `5173` or `8001` to the internet.
