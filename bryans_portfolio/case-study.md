## Overview

Report Formatter turns PDF and Word (.docx) documents into reusable, fixed-layout report templates. Users review detected fields, configure defaults and calculations, link cropped photo readings through browser OCR, and save reports with photographs and annotations. Both template types use one editor and support PDF, DOCX and original-format report downloads.

## My contribution & project context

I designed the product and reviewed AI-assisted implementation. My role is product design and implementation review, not a claim that I independently wrote every source file. This is an independent project; no public deployment or adoption figures are claimed.

- Designed the shared template-building, report-editing and image-extraction workflows.
- Specified immutable draft revisions, reusable field defaults, keyboard navigation, annotations and cross-format exports.
- Reviewed AI-assisted implementation across the interface, document processing, persistence and regression tests.

## Technical approach

The Vinext/React interface uses PDF.js for page display and editable overlays. A shared FastAPI service analyzes PDF widgets, text positions and table boundaries. Tesseract.js reads user-selected photo crops in the browser using locally served assets; extraction is reviewable and uses no LLM/cloud OCR API. [Builder](../app/templates/new/template-builder.tsx), [OCR](../lib/template-image-ocr.ts).

Word uploads are validated as bounded OOXML archives and converted locally by containerized LibreOffice Writer. The canonical PDF then follows the existing builder, OCR and report pipeline. ReportLab generates PDF downloads and transparent preview layers, keeping field fitting and alignment in shared code. Defaults, multiline entry, visual-order Enter navigation and per-report alignment use the same editor. [Conversion](../backend/app/word_conversion.py), [PDF rendering](../backend/app/template_pdf.py), [editor](../app/templates/custom/template-editor.tsx).

A deliberate trade-off preserves fixed-page editing rather than reconstructing arbitrary Word paragraphs and tables. DOCX exports combine page artwork/photos/annotations with native, positioned report text boxes. Values remain editable, but the source's full Word structure is not recreated; PDF is the reference layout. Conversion has per-process concurrency limits, a timeout and a disposable profile. [Word export](../backend/app/template_word.py), [format limits](../docs/word-templates.md).

PostgreSQL stores definitions and report values in JSONB, alongside images and document bytes. Drafts pin immutable template revisions. An additive source table retains original upload bytes and file type per revision, so changing a template does not silently change an older report or its original-format export. [Database](../backend/app/template_database.py), [revision handling](../backend/app/template_versions.py).

Local Compose runs the frontend, shared API, PostgreSQL and a Caddy HTTPS gateway. The optional cloud configuration separates a frontend Worker, private Python container gateway and Supabase private schema, with Cloudflare Access verification. That configuration is implemented and locally checked, not deployed or verified against real cloud permissions. [Local HTTPS](../docs/local-https.md), [cloud setup](../docs/cloudflare-deployment.md).

## Evidence & limitations

The latest verification includes 133 passing backend tests inside the Python 3.12 service image, with one PostgreSQL-only skip and one pre-existing expected failure. Word checks include real LibreOffice conversion, original-source retention, revision/format isolation, native export text and rejected unsafe uploads. Rendered two-page Word fixtures were visually inspected. Browser checks exercise the shared editor and real Word import/save/download using a disposable converter service. [Verification record](../qa/word-templates.md), [Word tests](../backend/tests/test_word_templates.py), [browser tests](../tests/browser/word-templates.spec.ts).

TypeScript checking and local/Cloudflare frontend builds passed. These checks do not establish complete test coverage, Microsoft Word rendering fidelity or production readiness. Existing truncated-image and cross-label OCR expected failures remain. The ordinary local stack has no login; HTTPS requires device certificate trust. Geometry/OCR suggestions need human review, and the process-local preview cache is not persistent storage.

## Further development

Validate Access policies, Supabase permissions, backups/restores and container cold starts in staging before a team rollout. Add versioned database migrations and parser/security update procedures, measure document-conversion memory use, and test exports in supported Microsoft Word clients. Resolve known upload/OCR regressions and reconsider the preview cache before scaling across processes. A native reflowable Word editor would be a separate capability, not an implied feature of fixed-layout export.
