# Word templates and cross-format report downloads

## Use the same builder

Choose **Create new template**, then select a PDF or Word **.docx** using the same
upload button (drag/drop also works). Save legacy `.doc` files as `.docx` in Word
first. Excel files still need to be exported to PDF.

Word imports are converted to a canonical PDF **inside the shared Python service**
using LibreOffice Writer. No Microsoft account, desktop Word, LLM or third-party
conversion API is involved. Review the converted pages before saving: unavailable
fonts or Word-specific features can affect pagination. The existing 20 MB upload
and 20 rendered-page limits still apply. Covers, fields, images, defaults,
calculations, OCR links, keyboard editing, alignment, shapes and revision-safe
drafts use the same editor and rendering code as PDF templates.

The service image includes LibreOffice Writer, Liberation fonts and python-docx.
Rebuild after updating source:

```bash
docker compose up --build -d
```

For standalone Python development, install LibreOffice Writer on that backend's
PATH or set `LIBREOFFICE_BINARY` to its executable. A missing converter produces
a visible service error; it does not prevent existing PDF work.

## Download choices

Every report supports **Download PDF**, **Download Word** and **Download original
format**. The last uses the file type of the report's pinned source revision:
PDF for a PDF template, DOCX for a Word template. Changing a template later does
not change the format/layout of existing reports. Draft cards download saved
values/photos, while the report editor downloads its current unsaved state.

The draft library has one Download button offering PDF or Word; it no longer
shows an original-template download button. The unchanged original upload is
still retained in the database and available to the authenticated source API.
Renaming/editing fields or saving future-report layout defaults does not
overwrite those original bytes.

## DOCX fidelity and editability

The app remains a **fixed-page form editor**, not a Word paragraph editor. Both
input types use this model deliberately so drag/resize, covers, OCR and report
annotations behave consistently.

DOCX report exports put template artwork, photos and annotations into positioned
page images. Report text, dates and calculated results are native, editable Word
text boxes placed using the PDF renderer's fitted text positions. Their original
paragraphs/tables are **not reconstructed** into a reflowable document. Font/colour
and line breaks are retained; changing exported text in Word may need manual
adjustment to its text box. Use the saved app draft for further geometry/photo/
annotation edits. Word software/font differences can change rendering; PDF is
the reference output. No Word-to-PDF-to-Word round-trip fidelity guarantee is made.

## Storage and upgrades

The additive `template_sources` table stores original file bytes, filename and
format keyed by immutable template revision. Existing PDF records without a source
row continue working via their original `source_pdf`. The canonical source PDF,
cleaned background and original DOCX are distinct records. Configuration saves
inherit the original source; a deliberate replacement upload gets a new source.

`create_all` creates the additional table at startup; no existing table is dropped
or column changed. Back up PostgreSQL before upgrades and include **all tables**
in backup/restore. Do not delete Docker volumes. Archived templates retain their
sources; confirmed permanent deletion removes source rows with all other records
for that template. Database backups and previously downloaded files are unaffected.

Cloudflare uses the same backend Dockerfile, so redeploy the backend image to get
the converter. This increases image size/startup work; measure container memory,
conversion latency and cold starts in staging before production rollout. The
existing Supabase private-schema role can create the new table; no browser DB
credential or cloud storage service is added.

## Conversion safeguards and checks

DOCX ZIP/XML validation bounds archive expansion/entry count and rejects encrypted
archives, macros, ActiveX, embedded objects, imported HTML, XML entities, external
resource relationships and external-content fields. Normal hyperlinks are allowed.
Each conversion has a disposable profile with macros disabled and link updating
off. A per-process semaphore limits simultaneous conversions to one, with a
15-second queue wait and 60-second conversion timeout. These safeguards are not
a guarantee against every document-parser vulnerability: keep the service image
patched, limit uploads to your trusted team, and monitor resource use.

Backend checks are in [test_word_templates.py](../backend/tests/test_word_templates.py):
source retention, revisions/format changes, Word exports, styling, multiline text,
photos/shapes and unsafe uploads. The real LibreOffice round-trip check runs when
`soffice` is present (the Docker image includes it); it is skipped in a host Python
environment without that dependency.

[Browser checks](../tests/browser/word-templates.spec.ts) cover PDF-to-DOCX downloads
and a full Word import/edit/save/download flow. The real Word case requires
`QA_WORD_API_URL` pointing to a **disposable** converter service with an isolated
database, never the saved local or production database. The normal Playwright
servers still use isolated SQLite. See [the verification record](../qa/word-templates.md).

LibreOffice's [command-line conversion documentation](https://help.libreoffice.org/latest/en-GB/text/shared/guide/start_parameters.html)
explains the headless/profile options; [python-docx sections](https://python-docx.readthedocs.io/en/stable/user/sections.html)
describe the page/section settings used for exports.
