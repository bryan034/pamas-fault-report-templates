# Field detection and OCR

## Two input paths

Digital PDFs (including converted Word documents) are analysed by Python with
pdfplumber and pypdf. Text positions, font names, drawn rectangles, fill colours,
table cells and interactive widgets are available without OCR.

Scanned pages are rendered by PDF.js in the browser, then recognised by
Tesseract.js's English model and locally served worker/WASM assets. The scanner
uses sparse-text segmentation, higher-resolution rendering, orange-background
normalisation and removal of long table rules in a temporary OCR copy. A targeted
block-mode retry reads the phase column, since sparse mode can omit a lone N.
Original
pixels are retained separately for border/column detection. Source documents are
not rewritten. Photo-region reading is a separate OCR path and is unchanged.

The scanner sends recognised words, page coordinates, candidate cells and shaded
regions to the application's authenticated Python layout endpoint. This shares
table semantics with digital-PDF analysis. No LLM or external OCR API is called;
the recognised layout travels to this app's backend, not a third-party AI service.

## Rules and limits

- Coloured cells containing labels are preserved. Dense bold/recognised column
  headers and text labels in the first column of label/value rows are not inputs.
  White background by itself is not a header signal: valid readings are white too.
- A RATED / MEASURED / % LOAD header plus at least two identifiable L1/L2/L3/N
  labels enables load-table inference. Phase text positions anchor rows even
  without horizontal rules. The first column and headers remain static.
- Each row gets Rated and Measured number fields, plus a calculated % Load field
  referencing that row's Measured and Rated IDs. The existing calculation engine
  evaluates measured / rated * 100 and appends `%`; it uses up to two decimal
  places (178 / 1000 becomes 17.8%). Missing inputs stay blank; zero denominators
  produce the existing validation error. Detected sample readings are not defaults.
- Cell deduplication and overlap checks remain in place. Interactive PDF widgets
  take precedence over overlapping inferred fields.
- Detected fields over white paper/white-filled cells or images get an attached
  white cover with the same ID and exact field bounds. Scanned pages are images,
  so all their accepted fields get covers, not only calculated/load-table fields.
  Covers remain below inputs. Repositioning an input detaches its cover and
  leaves the original background masked. Coloured label/header regions remain static.
  This applies to newly detected fields; saved templates are not rewritten.

This is heuristic detection, not a general understanding of every document.
Different labels, unusual merged cells, poor scans or ambiguous headings can
still require manual review. It does not infer arbitrary formulas. Re-import to
apply the new suggestions; existing saved layouts and draft revisions are not
changed automatically. Word pagination limitations are separate; see
[Word templates](word-templates.md).

## Checks

[Backend table tests](../backend/tests/test_table_detection.py) cover ruled and
unruled tables, blank values, protected headers/labels, formula references,
percentages, missing/zero inputs and scanned-layout validation.
[Browser test](../tests/browser/table-detection.spec.ts) uses real Tesseract on a
synthetic scanned load table, then saves and checks the inferred configuration in
a disposable test database. It does not claim accuracy on all documents.

## Whole-photo BX extraction while creating reports

Name text/number fields with BX1, BX2 or BX3 and place them beside their image
box. Upload a photo, then choose **Extract BX values from image**. This scans the
whole uploaded photo with local Tesseract, reconstructs visual text rows and reads
one temperature attached to each BX label. Readings retain at least one decimal
place (including `42.0`), and spaces around decimal points or commas are accepted.
Extra decimal precision is preserved; missing decimal points are never guessed.
A contrast pass retries missing values.
No saved crop coordinates, external OCR API or LLM is required.

The app matches fields using their current report page and geometry. With several
images it assigns fields to the nearest image, then picks the nearest matching
BX field in that group. It does not fill fields on another page, calculated fields,
labels naming more than one BX, or tied locations. Label spelling and readable
photo text matter; arbitrary thermal-image interpretation is not guaranteed.

Multiple conflicting readings, low-confidence recognition and missing labels do
not clear existing values. Edits made while OCR runs are preserved; removing or
replacing the image invalidates an older result. Review the extraction summary
and correct temperatures manually as needed. **Read image again** repeats the
last BX workflow. Existing named crop extraction remains available for other data.

## Report text sizing

Report text keeps its template font size unless a report font override is selected.
Input boxes grow to fit that size in the preview, PDF and Word export; text is never
shrunk to fit a small box. Boxes stay within the page, and text wraps when needed.
If the text cannot fit on the entire page at that size, shorten it or choose a
smaller font.

Report text begins at the top of a field and flows downward with a one-point
inset. In template editing, non-image field labels/defaults display at their
configured point size with equal padding and are centered on both axes. Input
boxes expand horizontally and vertically to contain that text; attached covers
retain their independently chosen bounds. Existing covers also retain their size
when an input is resized, moved or copied. Moving an input detaches its cover,
leaving the cover fixed at the original location. Detached covers are independently
selectable and remain even if that input is later deleted;
newly drawn fields initially cover the area drawn by the user. Image fields keep
their original dimensions and ordinary centered labels.

Report creation and draft editing support Undo/Redo buttons, Ctrl/Cmd+Z,
Ctrl/Cmd+Shift+Z and Ctrl+Y. Up to 100 changes are retained for the open session,
including values, formatting, field movement, annotations and uploaded photos.
A drag is one change; automatic preview layout adjustments do not consume undo
steps. Opening a report starts fresh history. Resetting a report can be undone;
undoing edits does not change a saved draft until it is saved again.
