# Windows desktop app

A self-contained Windows installer that needs no Docker, internet, account or
administrator rights. It installs per user, adds a desktop icon, and keeps all data
on that computer.

| Part | Web/Compose | Desktop |
| --- | --- | --- |
| Window | Browser | Electron (`desktop/main.cjs`) |
| Interface | Vinext | Same components, static build (`desktop/web/`) |
| Backend | FastAPI | Same app, plus `backend/app/desktop.py`, on a random loopback port |
| Database | PostgreSQL | One SQLite file, same SQLAlchemy models and Alembic migrations |
| Word import | ONLYOFFICE | Bundled LibreOffice; pagination can differ from ONLYOFFICE |
| Access | Google or local | Local, with a per-launch token that Electron adds to each request |

New pages must be added to both `app/` and the route table in `desktop/web/main.tsx`.

## Build the installer

Run on the Mac; no Windows computer is needed. Requires Node, uv and Docker Desktop.
Docker is only a build tool here: it is used to copy the template database and to
unpack LibreOffice.

```sh
npm ci                        # At the repository root.
cd desktop
npm ci
npm run seed                  # Copy the current active templates into the build.
npm run build:windows         # Writes desktop/dist/Report-Formatter-Setup-<version>.exe
```

Increase `version` in `desktop/package.json` before building an update.

The installer and `desktop/.build/` **contain your templates**. They are ignored by
git. This repository is public: do not commit them, attach them to a release, or
build them in a public CI job.

## What ships

`npm run seed` copies the Compose database volume to a throwaway volume, reads from
that copy and deletes it, so saved data is only ever mounted read-only. It includes
active templates with their revision history and leaves out archived templates,
draft reports, photos and sign-in records.

Bundled templates are copied only when a computer has no database. Installing an
update never overwrites the user's data, so templates added in a later build reach
only new installations. Uninstalling also leaves the data in place.

## Data, backup and restore

Data lives in `%APPDATA%\Report Formatter\data\templates.sqlite`. Logs are in
`%APPDATA%\Report Formatter\logs\backend.log`.

- **Back up** writes one `.rfbackup` file to any folder. USB drives and synced
  OneDrive, Google Drive or Dropbox folders all appear as normal folders. The file is
  checked before it replaces an earlier backup. Backups are not encrypted, so treat
  them as confidential documents.
- **Restore** checks the file, then restarts the backend and swaps the database in.
  Older backups are upgraded automatically; backups from a newer app are refused.
- Restores and schema upgrades first keep a copy of the current data in
  `data\safety-copies\` (newest three). This protects against a bad restore, not a
  failed computer: only a backup stored elsewhere does that.

## Unsigned installer warning

The installer is not code-signed, so Windows SmartScreen shows "Windows protected
your PC" until it is. The user chooses **More info**, then **Run anyway**. A code
signing certificate removes or reduces this warning; set `CSC_LINK` and
`CSC_KEY_PASSWORD` for electron-builder if you buy one.

## Verify a build

```sh
cd backend && uv run --frozen python -m pytest tests/test_desktop.py
cd .. && (cd desktop && npm run web)
npx playwright test --config desktop/tests/playwright.config.ts
```

The Playwright run drives the real Electron shell and backend on the build computer
with a throwaway profile, and leaves its downloads in `desktop/.build/check-output`
for inspection. When run from a VS Code terminal, prefix it with
`env -u ELECTRON_RUN_AS_NODE`. The Word-upload test is skipped unless
`LIBREOFFICE_BINARY` points to a LibreOffice `soffice` on that computer.

These do not replace testing on Windows. Before giving a build to anyone, install it
on a clean Windows 10 or 11 computer or in Windows Sandbox, then check: the desktop
icon opens the app; templates appear; a Word file uploads and paginates acceptably;
PDF and Word downloads open; OCR runs with Wi-Fi turned off; backup and restore work
with a USB drive; and data survives installing the update over the top.
