# Report Formatter

Create reusable PDF and Word templates, save them in PostgreSQL, and fill reports
with text, calculations, photos, and annotations. PDF and DOCX imports use one
fixed-page field-box editor. OCR runs in the browser without an external AI API.

## Local development

Requires Docker Desktop. Copy `.env.example` to `.env` if it does not exist.
Set a long URL-safe database password and an `ONLYOFFICE_JWT_SECRET` of at least
32 random characters. Preserve the configured password when upgrading.

```sh
docker compose up --build -d
docker compose ps
```

Open http://localhost:5173. Default development is loopback-only without login.
Frontend/Python source changes reload automatically. Rebuild after dependency or
Dockerfile changes. Recreate containers after environment changes. Never use
`docker compose down -v` to upgrade: it deletes database volumes.

| Container | Purpose |
| --- | --- |
| web | React/Vinext template library, builder and report editor |
| word-gateway | Same-origin local UI/API routing on localhost:5173 |
| template-service | FastAPI document processing, authentication and persistence |
| onlyoffice | Private DOCX-to-PDF conversion |
| template-db | PostgreSQL; persistent `template-postgres` volume |

The backend and database expose only loopback ports 8001 and 5434 for local
administration. Uploading a template does not create another deployment.

## Template and report workflow

1. Upload PDF or DOCX (20 MB / 20 rendered pages). Export spreadsheets to PDF
   before uploading. Word imports use ONLYOFFICE; review converted pagination.
2. Review suggested fields. Add/move/resize text, number, date, calculated or
   image fields and covers. Scanned pages can use browser OCR. Fields and OCR
   suggestions require human review.
3. Configure explicit defaults, formulas, photo crop regions and extraction
   links. Sample readings and trial-report values are not saved as defaults.
4. Try the report flow, then save the template. Template edits create immutable
   revisions; existing drafts keep their original definition and background.
5. Fill reports using sidebar/inline controls, add photos and annotations, and
   save a titled draft. Download PDF or Word from the editor or saved draft card.
   Font sizes use fixed dropdown choices; choosing a report size expands its box
   when necessary instead of shrinking the text. Clean-template previews remain
   editable: select, move, resize and format fields/covers directly there.
6. For thermal photos, name nearby fields BX1, BX2 and BX3, upload an image and
   choose **Extract BX values from image**. Browser OCR reads the whole photo and
   fills its closest matching fields on the same page. Review temperatures;
   unclear/conflicting readings keep existing values. Manual crops remain available.
7. Archive/recover templates. Deleted drafts can be restored for 30 days.
   Permanently deleting an archived template removes all its records immediately.

Preview and export share backend drawing code. Image boxes centre-crop without
stretching. Text fits within its bounds or returns a validation error. Calculation
errors identify source fields. Undo/redo retains five changes in browser memory.
Word output uses editable positioned text boxes over page artwork; PDF is the
reference layout. See [Word support](docs/word-templates.md),
[field detection](docs/field-detection.md), and [retention](docs/draft-retention.md).

## Architecture and source

- `app/`, `components/`, `lib/`: React/TypeScript UI, PDF.js, Tesseract.js.
- `backend/app/template_main.py`: FastAPI template/report endpoints.
- `backend/app/template_pdf.py`, `template_word.py`: rendering and downloads.
- `backend/app/template_database.py`: SQLAlchemy models, PostgreSQL storage.
- `backend/migrations/`: versioned Alembic schema; [migration guide](docs/database-migrations.md).
- `deploy/cloudflare/`: separate staging/production Workers and containers.
- `tests/`, `backend/tests/`: browser, helper and API checks; [verification](qa/README.md).

PostgreSQL stores original uploads, canonical/clean PDFs, thumbnails, revisions,
draft values, photos, grants and sessions. It is the persistent source of truth;
preview-image caches are temporary.

## Authentication and hosting

[Google sign-in](docs/google-sign-in.md) supplies identity; Python enforces
Owner/Editor/Viewer grants across the application. Unknown accounts are denied.
Permissions are application-wide. Browser OCR does not prevent document uploads
from reaching the configured application host/database.

- [Named Tunnel](docs/cloudflare-tunnel.md): HTTPS access to the local stack;
  the computer must stay online.
- [Temporary HTTPS testing](docs/quick-https-testing.md): disposable testing access.
- [Cloud deployment](docs/cloudflare-deployment.md): Cloudflare Workers/Containers
  with private ONLYOFFICE conversion and Supabase PostgreSQL.

Backend sleep does not erase saved data or the browser's current in-memory form.
A request wakes the backend; cold starts can require retry. Unsaved changes are
lost if the browser tab reloads/closes or its process stops. Save drafts regularly.
A rollback deploys a previous compatible release; no standby rollback container
is required. See the cloud guide for recovery and rollout checks.

## Back up local data

```sh
docker compose exec -T template-db pg_dump -U templates -d templates -Fc > templates-backup.dump
```

Keep backups separately protected and test restoration into a separate database.
Trash is not backup; application deletion does not erase retained backups.
