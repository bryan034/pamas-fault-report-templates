# Direct editing and responsive report controls

Updated 15 October 2026. This follows the [previous report-flow upgrade](report-flow.md).

## Changes

- The clean-template return button is blue and says Continue editing template. The sticky imported-field list is removed. Select a box directly on the PDF; its field/cover settings appear immediately below Preview report creation flow. Calculation warnings follow these settings. A separate Extract Data from Image sidebar section retains sample selection, cropping, extracted readings and field-linking logic.
- A click on a report field opens a transparent editor inside its box. Changes use the same state/update handlers as the sidebar, including during the unsaved template trial. Text, number, date, time, and legacy select/checkbox types are supported; computed fields remain read-only and image boxes retain image drop/move behaviour. Built-in fields retain their text length limits.
- Dragging beyond a small pointer threshold moves a field instead of opening the text editor; edge/corner handles still resize it. While actively typing, browser-native controls are used. On leaving the field, the existing PDF-rendered texture resumes, using the same backend rendering as exports.
- Selecting a preview field highlights the matching sidebar input and reveals it within the independently scrolling desktop sidebar, without scrolling the PDF column. Clicking away clears field/shape selection and exits the drawing tool. Clicking toolbar controls preserves the field being formatted.
- Rectangle insertion is now one-shot, matching ticks: each tool activation creates at most one shape. Shapes remain editable through hover handles and delete controls after drawing mode ends.
- Both report editors, including trials, have a draggable, keyboard-accessible divider. Left/right arrows resize; Home/End select the minimum/maximum. Controls use responsive CSS Grid to reflow as sidebar width changes. No Bootstrap dependency is added to the existing Tailwind/CSS application. Width is browser-memory UI state, not report/template data; mobile remains stacked.
- Save draft is transparent when the trimmed report title is empty. It remains clickable to explain the problem, but its handler blocks the save and opens a centered Report title required dialog. Add report title returns focus to that input. Entering a title restores the blue save button. This applies to new and existing reports in both services; the unsaved trial does not offer draft saving.
- The future-defaults dialog uses a viewport-constrained width, wrapping text and actions, and scrollable content on short screens. Desktop and mobile regression checks verify that its text/buttons stay inside the dialog and that the dialog itself stays inside the viewport.

## Verification and safety

Four new browser scenarios cover builder organization and trial typing, saved report inline persistence/sidebar reveal/deselection, pointer and keyboard sidebar resizing with multi-column reflow, one-shot rectangles, title validation/no database write, bounded desktop/mobile dialogs, and built-in inline text/numeric entry. Existing browser tests select fields directly on the PDF instead of the removed list and explicitly reselect fields after clicking away.

Results: 29 normally passing browser scenarios plus one expected legacy OCR failure (Playwright reports `30 passed`); 117 backend tests passed, one PostgreSQL-specific test skipped, and four existing strict expected failures retained. Eight helper/OCR tests and TypeScript checks passed. Desktop/mobile popup and responsive-sidebar screenshots were visually inspected. No 100% coverage claim is made.

The backend/PDF/database schema is unchanged in this update. Browser checks use isolated temporary SQLite databases, never production drafts or Docker volumes. No production containers were rebuilt/restarted. Existing known OCR/input/PDF-mask expected failures are described in the previous QA notes; they are not claimed as passing functionality.

## Supporting code

- [Builder](../app/templates/new/template-builder.tsx)
- [Shared direct preview editing](../components/report-preview.tsx)
- [Resizable workspace and sidebar reveal](../components/resizable-report-workspace.tsx)
- [Title-required dialog](../components/report-title-required.tsx), [shared alert dialog](../components/ui/alert-dialog.tsx)
- [Uploaded report editor](../app/templates/custom/template-editor.tsx), [built-in report editor](../app/templates/fault-report/editor.tsx)
- [Responsive styling](../app/globals.css), [new browser regressions](../tests/browser/direct-editing.spec.ts)

Apply updated source with `docker compose up --build -d` from the project root. Do not remove volumes as an upgrade step.
