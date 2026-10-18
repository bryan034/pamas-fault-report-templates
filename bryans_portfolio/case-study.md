## Overview

Report Formatter is a private templated document management platform designed for a client's internal company use, rather than public self-service access. It turns PDF and Word (.docx) documents into reusable, fixed-layout report templates. Users review detected fields, configure defaults and calculations, link cropped photo readings through browser OCR, and save reports with photographs and annotations. Both template types use one editor and support PDF and DOCX downloads.

The intended production access model uses Cloudflare Tunnel and Access to expose a publicly reachable HTTPS address while restricting use to approved company members. An application administrator manages Owner/Editor/Viewer permissions across the platform. The protected-access configuration is implemented and documented; a live production rollout has not been verified. Tunnel provides connectivity, not application hosting: the Docker services and database still need an always-on origin host. [Protected deployment setup](../docs/cloudflare-tunnel.md).

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

Local Compose runs the frontend, shared API and PostgreSQL on loopback ports. The protected deployment overlay adds an outbound cloudflared connector: HTTPS requests pass through Cloudflare Access, then route to the frontend or Python API on the same hostname. Python verifies signed Access identities and checks application-wide Owner/Editor/Viewer grants on every data request; authenticating with Google does not by itself grant membership. The owner can grant or revoke roles through the application's access-management page. [Compose overlay](../compose.tunnel.yaml), [authorization](../backend/app/application_access.py), [Google identity setup](../docs/google-sign-in.md).

This approach reuses the Docker application without distributing software or local certificates to teammates. The trade-off is operational dependence on the origin host's uptime and internet connection; Access does not supply hosting, backups or per-document permissions. Cloudflare also processes proxied document traffic, so company-internal authorization is not a claim that the provider cannot access traffic. A separate cloud configuration uses a frontend Worker, private Python container gateway and Supabase private schema; it is an alternative hosting path, not something Tunnel automatically deploys. Both paths require account configuration and deployment checks. [Tunnel setup and limits](../docs/cloudflare-tunnel.md), [alternative cloud setup](../docs/cloudflare-deployment.md).

## Evidence & limitations

The Word-import verification recorded 133 passing backend tests inside the Python 3.12 service image, with one PostgreSQL-only skip and one pre-existing expected failure. Word checks include real LibreOffice conversion, original-source retention, revision/format isolation, native export text and rejected unsafe uploads. Rendered two-page Word fixtures were visually inspected. Browser checks exercise the shared editor and real Word import/save/download using a disposable converter service. Later access-control verification separately records offline signed-JWT, role enforcement and browser UI checks, without claiming a live Cloudflare deployment. [Word verification](../qa/word-templates.md), [access verification](../qa/application-access.md), [Word tests](../backend/tests/test_word_templates.py), [browser tests](../tests/browser/word-templates.spec.ts).

TypeScript checking and local/Cloudflare frontend builds passed. These checks do not establish complete test coverage, Microsoft Word rendering fidelity or production readiness. The access verification records a remaining cross-label OCR expected failure. The ordinary local stack has no login and is loopback-only; the documented protected Tunnel route uses public HTTPS certificates without installing a local CA on teammates' devices. Geometry/OCR suggestions need human review, and the process-local preview cache is not persistent storage.

## Further development

Complete and verify the client's protected production rollout: configure the domain, Tunnel, Access identity provider and owner account; test approved and unapproved users, role revocation, API routing, uploads and downloads on the real hostname. Provision an always-on origin and validate backups/restores before relying on it for company records. If choosing the separate Workers/Containers + Supabase hosting path, also validate Supabase permissions and container cold starts. Add versioned database migrations and parser/security update procedures, measure document-conversion memory use, and test exports in supported Microsoft Word clients. Resolve known upload/OCR regressions and reconsider the preview cache before scaling across processes. A native reflowable Word editor would be a separate capability, not an implied feature of fixed-layout export.
