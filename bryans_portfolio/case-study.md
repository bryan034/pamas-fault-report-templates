## Overview

Report Formatter helps prepare thermal fault reports without manually rebuilding a fixed PDF form. Its implemented Fault Report template combines structured entry, separate equipment and infrared uploads, reviewable temperature suggestions, saved drafts, an exact-PDF preview, and downloadable reports. The catalog currently contains one working template.

## My contribution & project context

I designed the product and reviewed its AI-assisted implementation.

- Designed the fault-report entry, image upload, and OCR review workflow.
- Specified draft management, company reuse, and PDF layout fidelity requirements.
- Reviewed AI-assisted implementation of the editor, PDF service, and database-backed drafts.

## Technical approach

### Browser-assisted data capture

The editor keeps equipment and infrared images separate. Tesseract.js reads a cropped portion of the infrared image and suggests Bx1/Bx2 values for review. Users can also draw rectangles on either image; annotations persist with the draft and PDF. [Editor](../app/templates/fault-report/editor.tsx).

### PDF fidelity

The service overlays fitted text, images, and annotations onto a cleaned copy of the supplied form. The same generated PDF drives preview and download. This preserves the template layout, but coordinate-based fields need remapping when the source form changes. [PDF service](../backend/app/pdf_service.py).

### Draft architecture

A web catalog and fault-report service run alongside PostgreSQL. Drafts retain form data and uploaded images; the interface supports search, filtering, renaming, and deletion. The local-network stack has no login, so it is unsuitable for untrusted networks. [Compose configuration](../compose.yaml).

## Further development

Add another report template to validate the service-per-template design. Before wider deployment, add authentication, backups, and monitoring. Creating templates from arbitrary filled PDFs remains exploratory and would require field mapping and visual verification.
