# Report Formatter

A local-network report formatter. The home page lists report templates; the Fault Report template has its own draft library, editor, browser-only OCR, and PDF generator. The editor's normal live preview renders the same PDF as Download.

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
| `fault-report-service` | Python API, OCR-independent PDF generation, and draft endpoints | `localhost:8000` or laptop IP on the LAN |
| `fault-report-db` | Dedicated PostgreSQL database for fault-report drafts, images, companies, and template name | Laptop only at `127.0.0.1:5433` |

Future templates can add a template-specific service and database container while reusing the web app. PostgreSQL data lives in the named `fault-report-postgres` volume and survives ordinary container restarts and `docker compose down`. **Do not run `docker compose down -v` unless you intend to delete the database volume.**

Stop the stack with `docker compose down`. Start it again with `docker compose up -d`.

## Database access

For a SQL console inside the database container:

```bash
docker compose exec fault-report-db psql -U fault_report -d fault_report
```

At the `psql` prompt, run `\dt` to list tables or `SELECT id, title, company, created_at FROM fault_report_drafts;` to inspect draft cards. Type `\q` to exit. A desktop PostgreSQL client on the laptop can connect to host `127.0.0.1`, port `5433`, database `fault_report`, user `fault_report`, and the password from `.env`. The database port is not exposed to other Wi-Fi devices.

The service creates its tables on startup. Saved draft form values and both optional uploaded images are stored in PostgreSQL. There is no Supabase account or cloud database.

## Use

1. Choose the Fault Report card on the home page. Its name can be changed without changing the underlying PDF template.
2. On the draft page, search by title/company or filter by company and report (job) date using **jobs between** and **and**. Select a draft card to edit it, or create a blank report.
3. Enter a report title before saving. **Save draft** creates a draft from a new report or updates the open draft. A three-second popup lists any fields still blank; they do not block saving. Empty editor fields have a light-red outline. Reset asks for confirmation before clearing unsaved entries.
4. Select an existing company from the prefix-filtered suggestions sourced from saved reports, or type a new one. The new company appears in suggestions after its report is saved.
5. Add an equipment photograph and an infrared photograph if needed. Large equipment photos are resized in the browser before upload, so the resized copy is what is stored in the draft. OCR reads only the infrared image. Review and confirm Bx1/Bx2 before downloading a PDF with both readings.
6. The normal live preview is a PDF rendering of the current editor fields, not a selected saved version. **Arrange layout** temporarily shows draggable guides; choose **Finish arranging** to check the exact PDF result. Choose **Draw rectangle**, then drag inside either uploaded image. Click a rectangle to select it, drag its bottom-right handle to resize it, and adjust its line colour or width. Rectangles are saved with the draft and printed in the PDF.
7. Download the PDF. The button is transparent while text/number/select fields are blank and dark blue when they are all filled; partial PDFs can still be downloaded. The report title is used in its filename and metadata; the printed form layout remains unchanged.

The date prints as `dd mmm yyyy`, and a one-digit report number gets a leading zero (`1` becomes `01`). `% Load` is calculated from measured current divided by rated current. Location, descriptions, and other text are fitted within the PDF's mapped boundaries.

The first visit to the Fault Report draft page imports older browser-local drafts into PostgreSQL once. The old local storage is not deleted. Older drafts never contained the uploaded images, so re-upload those images if needed.

## Development without the full stack

Node.js 22.13+, Python 3.12+, uv, and a PostgreSQL server are required. The easiest way to provide PostgreSQL is `docker compose up -d fault-report-db` after creating `.env` as above. In separate terminals, run:

```bash
cd backend
uv sync
DATABASE_URL='postgresql+psycopg://fault_report:YOUR_PASSWORD@127.0.0.1:5433/fault_report' uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
npm install
npm run dev
```

Replace `YOUR_PASSWORD` with the same URL-safe password in `.env`. The web app is on port `5173`; the Python service must be running for PDF preview, saving, and downloads. If a preview request fails, the editor now shows the error rather than an old-looking static form.

## Tests and code map

```bash
npx tsc --noEmit
npm run build
cd backend && uv run pytest
```

The catalog is `app/page.tsx`, draft library is `app/templates/fault-report/page.tsx`, and editor is `app/templates/fault-report/editor.tsx`. The API is `backend/app/main.py`, database tables are in `backend/app/database.py`, and PDF field coordinates are in `backend/app/pdf_service.py`. The original and cleaned templates are in `backend/assets/`.

`FieldBox(x, y, width, height, maximum)` in `backend/app/pdf_service.py` sets printed text positions; PDF coordinates start at the bottom-left. The normal preview uses that same PDF. Only the temporary draggable layout guides use `.pv-*` CSS positions in `app/globals.css`.

## Network and privacy

OCR runs in the browser. Drafts and uploaded images go to the Python service and local PostgreSQL container; no cloud OCR or database is used. This deployment intentionally has **no login**: anyone who can reach the laptop's web/API ports on the Wi-Fi can view or change all drafts. Use only on a trusted network; do not forward ports `5173` or `8000` to the internet.
