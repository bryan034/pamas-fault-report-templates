# Attached covers, selection and compact report toolbar

Implemented:

- Pasting an input/image creates an exact-bounds matching cover, including when
  the source field is from an older template without a cover. Moving/resizing
  the field updates its cover; deleting the field removes it. New image boxes
  also receive covers. Standalone cover editing remains available.
- Ctrl-click (or Cmd-click on Mac) toggles multi-selection in the template
  canvas. Drag/arrow keys move the selection; copy/paste and Delete operate on
  the group. A field's cover is not copied twice when both are selected.
  Undo/redo retains the existing five-step limit. Formatting/resize controls
  continue to apply to the primary/last selected field.
- Saving shows a centred success dialog, then navigates to the template's
  report library after 1.5 seconds. Open template navigates immediately.
- Field settings include Left/Centre/Right text alignment for non-image fields.
  The top toolbar also exposes the selected field's alignment; both controls
  stay synchronized. Selecting another field shows that field's own alignment.
  It updates label/default previews and is saved as the new-report default;
  report-specific alignment overrides remain independent.
- The sticky report toolbar is one compact row. Narrow screens scroll tools
  horizontally instead of wrapping or widening the whole page. The preview
  heading/subheading are removed, but preview errors remain visible below.
- Report downloads offer PDF and Word only; original source files and the
  backend's original-format export support are not deleted.

Automated checks:

- `node --experimental-strip-types --test tests/template-editing.test.mjs`:
  attachment geometry, old fields, selection deduplication, grouped movement,
  bounds and cover colour preservation.
- `PLAYWRIGHT_BROWSERS_PATH=.playwright npx playwright test tests/browser/direct-editing.spec.ts`:
  immediate naming, covering, resize, persistence, group copy/move/delete/undo,
  image covers, save confirmation/redirect, and toolbar at desktop/tablet/mobile
  sizes. Tests use the temporary database configured in playwright.config.ts,
  not the saved PostgreSQL volume.

These tests do not prove compatibility with every browser or Cloudflare Tunnel
availability; no public tunnel is required for these editor changes.
