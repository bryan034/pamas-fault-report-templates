# Report Formatter

This application creates reusable PDF/DOCX templates, stores them in PostgreSQL,
and fills revision-pinned reports with values, photos, calculations and OCR links.
Preserve these current workflows when cleaning up code. Remove code only after
checking its imports, routes, tests and saved-data compatibility requirements.

- UI: React/TypeScript via Vinext/Vite; PDF.js and browser-local Tesseract OCR.
- API/storage: FastAPI, SQLAlchemy, PostgreSQL; schema changes use Alembic in
  `backend/migrations/`. Never reintroduce startup `create_all` or a second ORM.
- Word import: private ONLYOFFICE conversion; PDF and DOCX share the field-box UI.
- Cloud: frontend Worker, private backend Worker, Python/ONLYOFFICE containers,
  Supabase PostgreSQL, application-owned Google sign-in and live access grants.
- Local Compose is development; cloud configuration lives in `deploy/cloudflare/`.
- Never test against saved application data or delete database volumes. Backend
  and browser tests use disposable databases; PostgreSQL QA uses isolated schemas.
- Existing document compatibility and recovery code protects saved data. Its age
  alone is not evidence that it is unused.

See README.md, docs/database-migrations.md, docs/cloudflare-deployment.md and
qa/README.md for the current workflow and verification commands.
