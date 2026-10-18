# Report Formatter

A local-network report formatter for uploaded PDF and Word (.docx) templates, with a shared template builder, draft library, browser-only OCR, and PDF/Word report downloads. Live previews use transparent field layers drawn by the same Python functions as downloaded PDFs, over the cleaned template background. See [Word import and cross-format exports](docs/word-templates.md) for layout and editability limits.

## Cloud deployment (Cloudflare + Supabase)

The optional production path uses a Vinext frontend Worker, a private Python
container behind a service-binding gateway, Cloudflare Access team email login,
and Supabase PostgreSQL. Local Docker Compose remains a separate workflow and does not
require a cloud account. See the [complete deployment guide](docs/cloudflare-deployment.md)
for staging/production setup, secrets, database schema, access policies, costs,
backup/migration notes and acceptance checks. **Nothing has been deployed merely
by adding this configuration.** The frontend refuses unauthenticated requests;
fill in your own domain and Access identifiers before deploying it.

For Google sign-in and administrator-approved emails, follow
[Google sign-in setup](docs/google-sign-in.md). The configured administrator is
`bry.io456@gmail.com`; approved Editors/Viewers are managed in the app at
`/access`. Cloudflare verifies Google identity; the app independently enforces
its database allow-list. This production flow is separate from public Quick
Tunnel testing, which can intentionally run without login.

## Run with Docker (recommended)

Deleted report drafts now appear in each template's **Recently Deleted** section
for 30 days, with restore support. Expired draft data is cleaned automatically
while the backend runs and on startup/list requests. See
[draft retention and cleanup](docs/draft-retention.md) for rollout, timing and
backup limits. Permanent deletion of an entire archived template remains a
separate irreversible action, including its trash.

For temporary multi-device HTTPS testing without buying a domain, see
[Quick HTTPS testing](docs/quick-https-testing.md). It reuses the existing testing
database. Email mode requires real approved addresses for login codes; explicit
`QUICK_TEST_ACCESS=public` in `.env.quick` removes all login and lets anyone with
the URL view/edit/delete testing data. Public mode starts with `npm run dev:quick`;
email mode starts with `npm run dev:quick -- YOUR_REAL_EMAIL`. Stop either with
`npm run dev:quick:stop`. These modes are distinct from application role-based Access.

Install and start Docker Desktop, then from this folder:

```bash
cp .env.example .env
```

Edit `.env` and replace `FAULT_REPORT_DB_PASSWORD` with a long URL-safe password (letters, numbers, hyphens, and underscores). Then run:

```bash
docker compose up --build -d
docker compose ps
```

Open `http://localhost:5173` on the laptop. The default stack is loopback-only,
with no login; it deliberately cannot be opened through the laptop's Wi-Fi IP.
For other devices, use [Cloudflare Tunnel + Access](docs/cloudflare-tunnel.md):
one public HTTPS hostname, email sign-in and application-wide Owner/Editor/Viewer
roles. No local certificate installation is needed. The app and data still run
on the laptop. This is different from deploying Workers/Containers to the cloud.

Editor IDs work on both HTTPS/localhost and plain-HTTP LAN addresses: the shared
`lib/create-id.ts` helper uses native `crypto.randomUUID()` when available and
otherwise builds a UUID v4 using `crypto.getRandomValues()`. This covers new
fields, cover/image boxes, copied fields, shapes and extraction items. It does
not make HTTP encrypted or enable unrelated HTTPS-only browser APIs. Production
must still use HTTPS. Run `npm run test:ids` for both code-path checks.

The default Compose stack has three containers (the optional tunnel adds one):

| Container | Role | Access |
| --- | --- | --- |
| `web` | Shared template catalog, draft cards, and editor | `http://localhost:5173` |
| `template-service` | Shared PDF analysis, uploaded-template definitions, generic reports, and drafts | `http://127.0.0.1:8001` |
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

The service creates missing tables on startup. Saved draft form values, PDFs, revisions, and uploaded images are stored in PostgreSQL. The default local setup uses no cloud database; the optional deployment guide configures Supabase separately. Startup table creation is not a general-purpose schema migration system.

## Create and use an uploaded template

See [source cleanup and current checks](qa/source-cleanup.md), [template navigation and references](qa/template-navigation.md), [direct editing](qa/direct-editing.md), [previous report-flow changes](qa/report-flow.md), [previous refinements](qa/template-refinements.md), and [the earlier editor upgrade](qa/template-editor-changes.md). Older QA documents describe the source/test suite as it existed at that time, including the now-removed built-in report.

Opening a template selects its first editable field in visual page order. Red calculation messages and their named source links select/reveal the affected fields. The extraction sidebar previews the original PDF crop underneath its image box; moving/resizing the box refreshes it after release, while an uploaded sample takes precedence. This preview is also the crop/extraction source. New report is green in the action row beside Edit template.

1. Choose **Create new template** in the template library. The same file picker accepts blank or completed **PDF or Word .docx** documents, including Excel sheets exported to PDF. Word is converted locally by LibreOffice Writer in the shared Python container before field detection; the original upload is retained separately. Native `.xlsx` and legacy `.doc` uploads are not supported (save `.doc` as `.docx` first). Limits are 20 MB and 20 rendered pages. Review conversion layout before saving.
2. The service suggests fields using PDF form widgets, text positions, rectangles, and table cells. Review every suggestion: a PDF does not reliably distinguish labels from sample values. The top ribbon has **Input field**, **Image box**, **Cover box**, font family, editable font size, font color, Undo, and Redo. Click a box to select it; drag it to move, or drag any corner/edge to resize. Delete/Backspace removes the selected box; arrow keys nudge it, Shift uses larger increments, and Alt+arrows resize. Keyboard shortcuts do not delete boxes while you are typing in an input. For scanned pages, use local OCR detection or add boxes manually.
3. New-template field types are **text, number, date, image, and calculated**. Manual draft-filter role, alignment, and coordinate controls are removed. Fields are centered initially; drag boxes/handles to position or resize them. **Default value for new reports** explicitly sets reusable text, number or date values. Detected sample values and trial-report values are never promoted to defaults. New reports and Reset use configured defaults; explicit blank report values override them, and existing drafts retain their saved revision/defaults. Images and calculations do not accept manual defaults. Older saved reports retain their original field types/revision. Calculations use two number-field dropdowns and a **+**, **−**, or percentage operator. Percentages use numerator/denominator; multiplication by 100 stays internal. Calculated fields appear in the PDF/preview, not the report sidebar. Named errors highlight affected source controls in red; preview/download reject zero denominators and numeric overflow. Drafts can save unfinished calculations. Text shrinks/wraps to fit, or produces a fit error instead of clipping. Image boxes always centre-crop images to fill their bounds without stretching, including older templates. Preview and PDF/Word exports share this behaviour; original uploads remain intact for extraction. Existing/automatically detected company/date roles continue supporting filtering.
4. **Cover box** masks old values or photographs. Avoid labels and borders. Input/image fields can be placed on top of covers. Select fields directly on the PDF: there is no sticky list of imported fields. The selected field/cover settings appear immediately below **Preview report creation flow**. Covers stay in their original positions when a field moves; edit them directly on the PDF using **Only view cover boxes** (there is no cover dropdown/list). **View clean template** is beside that button; the blue **Continue editing template** button returns to editing. Cleaning renders source pages at up to 216 DPI and removes underlying sample text from the blank PDF; the original PDF is retained separately. New report text remains searchable.
5. The separate **Extract Data from Image** sidebar section contains image selection, sample photos, cropping and extracted items. Select an image box and optionally choose a **Sample photo for extraction**; its filename and thumbnail appear in the sidebar. Click **Extract data from image**. Without a reference upload, the photo inside that PDF box is used. The screen dims; drag over just the value, name the area, and create an extracted item. Escape/X cancels and **Retake area** starts again; both buttons remain visible. **Extracted Data from Image** appears below the extraction controls: unlinked items have red outlines, linked items name their target field. Drag an item onto a value field, or use its **Extracted item** control. Sample readings are never defaults. Saved crop coordinates and links read fresh values from each report's image upload. Keep future photos consistently framed and check OCR output. Older quoted-label rules remain supported.
6. **Preview report creation flow** opens a temporary editor for the current unsaved template. Enter values, upload photos, move fields, format text or draw shapes to test it. **Continue editing** returns to the builder; **Save template** saves only the builder definition, never the trial report values/photos/formatting. Trial reports are not written to the database. No review checkbox is required. Saving shows **Template saved successfully**, then opens the template's report library. **Edit template** there returns to editing. Each template/configuration save creates an immutable revision: existing drafts retain their layout/schema/background; new reports use the latest revision. The configuration download button and dedicated export endpoint are removed; the blank PDF remains downloadable.
7. Create a report and drop photos into image boxes in the sidebar or preview. The sidebar follows page/top-to-bottom/left-to-right positions, not names or creation order. Desktop sidebar and preview scroll independently. Drag the divider between them to resize the sidebar, or focus it and use arrow keys (Home/End for minimum/maximum). Inputs reflow into additional columns when space permits; mobile stays stacked. Click fields to type directly in the preview, including the temporary template trial. Their matching sidebar controls glow and scroll into view. Drag fields or hover over shapes to move/resize them; clicking outside deselects them. The sticky report toolbar changes the selected field's font, size and colour; select the field directly in the preview or sidebar, not from a toolbar dropdown. Rectangles and ticks are one-shot, and shapes have hover delete controls. The future-configuration dialog wraps text/actions and stays within the viewport on narrow screens. Save updates the current titled draft; missing fields appear centrally without blocking saves. Size/geometry changes offer a separate opt-in to future-report defaults, excluding values/photos/other styles. Reset and draft deletion require confirmation. Draft cards keep Rename and Download beside a readable title; Download opens a PDF/Word chooser. Edit draft and Delete are below. Downloads use saved values/images, not an unsaved editor state.
8. The preview remains live with a 120ms typing debounce. PDF.js renders transparent field pages off-screen and replaces only their value canvases; the cleaned background stays in place. Moving/resizing a field moves/scales its value immediately, with final text fitting refreshed after release. Shapes use matching vector paths in the preview and export. Previous valid layers remain during rendering/errors. A bounded 64MB, 32-entry, five-minute server cache avoids repeat photo uploads during typing and refreshes expired tokens; it is not persistent storage. Saving/downloading send actual report images. OCR reuses one worker per image batch and avoids re-reading identical crops.
9. Cards have separate **Open template** and **Edit template** buttons. The delete icon **archives** a template, retaining reports/photos. **Show archived templates** offers **Recover** or **Delete permanently**. Permanent deletion requires a backup warning/confirmation and removes all reports, images, PDF revisions and configuration for the selected template. Other templates remain untouched.

While filling a report (including the trial flow), **Enter** moves to the next editable value field in page/top-to-bottom/left-to-right order, skipping images and calculated fields. It stops at the last field. **Shift+Enter** inserts a newline in text fields, in either the sidebar or inline preview. Select a field and use the report toolbar's **Text alignment** control for left, center or right alignment. Alignment is saved with that report and used by both preview and downloaded PDF; it is not included in the existing future-configuration opt-in, which still saves only font sizes and field geometry.

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

Report editors offer **Download PDF** and **Download Word**; the redundant original-format button is removed. The draft library uses one Download button with PDF/Word choices and has no original-template download button. Original uploads remain stored for template editing and revision history. DOCX report values are editable, positioned Word text boxes; template artwork, photos and annotations are page images, not reconstructed Word tables/shapes. PDF remains the reference layout; Word rendering can vary with fonts/software.

Explicit template defaults appear immediately in both the template editor and its clean preview, using the field's font, colour and alignment and shrinking to stay within its boundaries. Empty fields show their labels while editing. This overlay does not burn defaults into the blank PDF or turn detected sample values into defaults.

The additional `template_sources` table stores original upload bytes, filename and file type per immutable revision. Startup creates this new table without replacing existing tables or drafts. Revisions keep original uploads across template/configuration edits. Permanent deletion removes these source records too; archive retains them. Include this table in database backups.

## Development without the full stack

Node.js 22.13+, Python 3.12+, uv, and PostgreSQL are required. Word uploads also require LibreOffice Writer on the backend's PATH (or `LIBREOFFICE_BINARY`); the Docker image includes it. No desktop Word application is used. Start the database with `docker compose up -d template-db` after creating `.env` as above. In separate terminals, run:

```bash
cd backend
uv sync
TEMPLATE_DATABASE_URL='postgresql+psycopg://templates:YOUR_PASSWORD@127.0.0.1:5434/templates' uv run python -m uvicorn app.template_main:app --reload --host 0.0.0.0 --port 8001
```

```bash
npm install
npm run dev
```

Replace `YOUR_PASSWORD` with the same URL-safe password in `.env`. This standalone hot-reload setup uses HTTP on port `5173` and calls the browser's hostname on API port `8001`. Stop the Compose web/API services first if they occupy those ports. For secure multi-device testing, use the [protected tunnel workflow](docs/cloudflare-tunnel.md). `NEXT_PUBLIC_TEMPLATE_API_BASE_URL` can override API routing; without an override, HTTPS uses same-origin `/api/...`, while standalone HTTP uses port `8001`. Do not configure an HTTP API URL under an HTTPS frontend (mixed content).

## Tests and code map

```bash
npx tsc --noEmit
npm run test:ocr
npm run test:entry
npm run test:ids
npm run test:deployment
npm run test:access
node --experimental-strip-types --test tests/template-editing.test.mjs
npm run test:templates
npm run build
cd backend && uv run python -m pytest
```

The active catalog is `app/page.tsx`. Browser tests start only the shared template API on port 8011 and the web app on 5174; keep those ports free. They use a temporary SQLite database, never the saved PostgreSQL database. Backend tests share one isolated API fixture in `backend/tests/conftest.py`. Optionally set `QA_POSTGRES_URL` to an isolated disposable test database: each test uses its own temporary schema, which is removed afterwards. Never point that variable at production. The PostgreSQL-only JSONB/image/reconnection check is skipped without that variable.

For uploaded templates, the builder is `app/templates/new/template-builder.tsx`, the library/editor are in `app/templates/custom/`, and `components/template-pdf-viewer.tsx` renders all PDF pages. The shared API, schema, database, and PDF processing are in `backend/app/template_main.py`, `template_models.py`, `template_database.py`, and `template_pdf.py`. Browser OCR rules are in `lib/template-ocr.ts` and `lib/template-image-ocr.ts`. The browser test starts isolated servers and a temporary SQLite database; it does not modify your PostgreSQL drafts. Install its Chromium browser once with `PLAYWRIGHT_BROWSERS_PATH=.playwright npx playwright install chromium`.

Template fields and report geometry overrides use normalized top-left page coordinates; the backend converts them into bottom-left PDF coordinates when drawing. `components/report-preview.tsx` displays backend-rendered transparent value layers over the background and provides the shared field/shape controls; the same backend drawing helpers generate downloads. `pdf_shapes.py`, `report_styles.py`, and `report_configuration.py` are shared active helpers, not retired Fault Report code.

## Network and privacy

OCR runs in the browser. Drafts and uploaded images go to the shared Python service and its local PostgreSQL container; the local workflow uses no cloud OCR or database. Local development is unauthenticated and loopback-only. Do not port-forward `5173`, `8001` or `5434`. The optional tunnel uses Cloudflare's public HTTPS certificate and Access identity verification, with Python enforcing application roles on every data request. Unknown users are denied, Viewers cannot write, and only the configured Owner can manage grants at `/access`. Access applies to the whole application, not individual documents. Cloudflare processes proxied traffic; this is not end-to-end encryption excluding Cloudflare.

That paragraph describes **local development**, not the optional cloud deployment.
Cloud builds enforce Access and route APIs privately; PostgreSQL is then hosted
by Supabase. No cloud OCR/LLM API is introduced.
