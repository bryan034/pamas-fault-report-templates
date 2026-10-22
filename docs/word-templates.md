# Word import and report export

PDF and DOCX use one field-box editor. DOCX uploads are converted privately with
ONLYOFFICE into the canonical PDF background; original upload bytes are retained
with the immutable template revision. The editor does not embed a Word processor.

## Conversion

Local Compose includes ONLYOFFICE. Set the same random `ONLYOFFICE_JWT_SECRET`
(at least 32 characters) for the converter and Python. No converter/browser-editor
route is public. Cloudflare provisions its own private converter container; see
[cloud deployment](cloudflare-deployment.md).

Inputs are limited to 20 MB and 20 rendered pages. Fonts and Word-specific layout
can affect pagination; review the converted preview. If necessary, upload a
matching PDF exported from Word through **Word-exported PDF layout (optional)**
before configuring fields. This replaces the current detection/layout; original
DOCX bytes are retained. The application cannot verify the files match.

Standalone Python can explicitly choose `WORD_CONVERSION_ENGINE=libreoffice`
when LibreOffice Writer is installed. Its pagination can differ from ONLYOFFICE.
Cloud and Compose explicitly select ONLYOFFICE and do not fall back on an outage.

Temporary conversion sources are stored in PostgreSQL with 15-minute signed,
document-specific links, then removed when jobs finish. Expired abandoned sources
are purged at startup/next conversion. Converter response URLs are restricted to
the configured converter origin and cache path. DOCX ZIP/XML checks reject unsafe
embedded/external content; conversion concurrency and request times are bounded.
Keep document-processing dependencies patched.

## Export

Reports offer PDF and Word downloads. Saved draft cards download saved values
and photos; editor downloads use current editor state. PDF is the reference
layout. DOCX exports contain editable positioned text boxes for values and
page images for artwork/photos/annotations. They do not reconstruct reflowable
paragraphs and tables. Rendering can vary across Word software and fonts.
Explicit report font-size selections use their exact point size in preview, PDF
and Word. Fields expand within the page as necessary; text too large for the
whole page returns an error instead of silently shrinking or clipping.

Template geometry, defaults, covers, image crops, calculations, annotations and
pinned revisions apply to both input formats. All sources/images must be included
in database backups. Schema upgrades use [Alembic](database-migrations.md).

## Verification

Run `cd backend && uv run python -m pytest tests/test_word_templates.py
tests/test_word_overlay_conversion.py`. Run `npm run test:templates` for browser
checks. Optional real Word tests need `QA_WORD_API_URL` pointing to a disposable
converter/backend with an isolated database. Never target saved application data.
Staging acceptance must exercise the real Cloudflare converter and callbacks.

ONLYOFFICE Community has AGPLv3 licensing requirements; review the upstream
license for your distribution and deployment.
