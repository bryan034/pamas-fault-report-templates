# Word template editing

PDF and Word uploads share the field-box builder: input/image fields, covers,
OCR links, calculations, styles and annotations. ONLYOFFICE performs private
server-side DOCX conversion. See [Word support](word-templates.md) for setup,
exports and layout limits.

Saved documents are preserved across upgrades. Where a stored Word template
requires conversion to the current field-box representation, an editor can open
it to create an overlay revision while retaining its original bytes/revision.
Documents with saved Word drafts require an explicit backup/migration first;
they are not silently flattened. Existing overlay drafts retain their pinned
layout. This compatibility path remains because it protects saved data.
