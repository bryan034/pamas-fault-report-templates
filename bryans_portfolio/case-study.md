## Overview

Report Formatter converts uploaded PDFs into reusable report templates. Users review suggested fields, link cropped image readings through browser OCR, and create saved drafts with calculations, photographs, and page-wide annotations. A live PDF preview supports direct editing; the original fixed Fault Report service has been retired.

## My contribution & project context

I designed the product and reviewed AI-assisted implementation; this remains an independent, local-network project.

- Designed the reusable-template builder, report editor, and configurable image-extraction workflow.
- Specified revision-safe drafts, annotation tools, calculations, and PDF layout requirements.
- Reviewed AI-assisted implementation across the interface, PDF processing, persistence, and regression tests.

## Technical approach

### Template review and extraction

PDF geometry suggests fields; users correct boundaries and link named photo crops to inputs. Tesseract.js runs in the browser with locally served assets, without an LLM or cloud OCR API. Detection remains reviewable rather than being treated as reliable document understanding. [Template builder](../app/templates/new/template-builder.tsx).

### PDF rendering and preview

Shared Python drawing helpers generate exports and transparent preview layers displayed by PDF.js. Rasterized backgrounds remove covered sample content, but lose selectable source text. Fields are grouped by effective page without changing paint order. [PDF rendering](../backend/app/template_pdf.py).

### Revision-safe persistence

One shared FastAPI service handles uploaded templates; PostgreSQL stores JSONB definitions, draft values, images, and PDF snapshots. Drafts stay bound to immutable template revisions, so template edits do not silently change older reports. Docker Compose runs web, API, and database containers. [Revision handling](../backend/app/template_versions.py).

### Verification and limits

Recorded checks include 84 passing PostgreSQL-backed tests, 27 normally passing browser scenarios, and nine helper tests. One backend and one browser regression remain expected failures; lint also has unresolved errors. These results do not establish complete coverage or production readiness. [QA record](../qa/source-cleanup.md).

## Further development

Cloud hosting remains exploratory; Cloudflare and Supabase are not deployed. Before public access, add authentication, versioned migrations, tested backups, and environment isolation. Resolve known upload/OCR defects and replace or adapt the process-local preview-image cache before scaling across instances.
