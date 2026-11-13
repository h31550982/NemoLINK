# Design rules

## Icons and report pages

- Do not show question-mark help controls or their help popups. Preserve existing action tooltips, contextual hover hints for NEMO codes, missing data, sources, and full values, and hover styling.
- Never underline icons, including icons inside links or buttons. Apply any text underline to a separate label span, never to the enclosing control.
- Keep the mobile port-call modules in their existing dialogs and bottom sheets until a separate mobile redesign is requested.
- Keep Edit port call in its existing drawer on desktop and its existing sheet on smaller screens. It is separate from the report page redesign.
- Every desktop report uses the shared `ReportHeadline.vue` component, matching “Reports headline / Desktop” in Figma 632:9852. Use a 22px semibold title, 14px medium vessel/port text underneath, and a 12px semibold uppercase step label with 0.6px letter spacing above it.
- Always leave 27px between the desktop report headline and its content, using `--nl-report-headline-content-gap`. Align the heading and report content with the page's side padding (the logo's edge), with no extra inset: `--nl-report-content-inset` is 0.
- The N logo always leads straight to the front page; the “Port call overview” back link in `ReportHeadline.vue` is the way back to the port call’s own list, and it shows however the report was opened (front-page badge or the overview’s rows). Phones use the arrow in the app header instead.
- The top back link on every desktop report always returns to that port call’s overview, which lists section completion statuses. Label it “Port call overview”; never link it to the previous section. Keep its semibold text and back arrow in the headline’s navigation row, without small helper text or a forward section link. On desktop, automatically open the next section after the final send is accepted in full; partial or rejected sends remain visible. Refresh the call before opening the next section. Keep the existing mobile send flow.
- On desktop reports, All details off shows only the ready banner when the report has no issues. All details on reveals the report content. Keep the report action bar visible at the bottom of the viewport without a divider, and reserve enough content space for its full height.
- Place the desktop All details toggle on the same top row as the Port call overview back link, aligned to the opposite edge and vertically centered with it.

## Row pattern rules

- Moored port-call overviews keep all report links accessible, including completed reports and reports with unmet prerequisites. Underline all clickable report links in these overviews, including completed ones.

- The port call overview's report rows (`PortCallProcess.vue`) have no divider strokes between them and none under the section headlines, at any width. They still use the 58px row height below.

For a list row with a label or link on the left, a status pill on the right, and a divider:

- Match the existing “What goes to NEMO” rows on mobile and tablet, at viewport widths up to 1023px.
- Use `min-height: var(--nl-row-mobile-min-height)` (58px), with no vertical row padding. Centre the label and pill vertically.
- Use a minimum height, not a fixed height: wrapped labels and supporting text must fit without clipping.
- Make row links stretch vertically within the row so the tap target follows its height.

The shared height token lives in `src/css/app.scss`. Reuse it whenever this row pattern is introduced.

## Removal confirmations

- Use `RemovalDialog.vue` for removal confirmations, matching Figma Critical Module `638:13174`: white 561px card, 24px padding, 8px corners, and adjacent Close and red Confirm buttons.
- Only port-call removal uses `kind="port-call"`, requiring the exact word `delete` before confirmation. Other removals use the variant without a text field.
- Keep the existing dark transparent dialog backdrop (ink at 40%). Keep NEMO cancellation reasons and audit-history information accurate.

## Standard table

The Ship forms table is THE table of the app (user 2026-11-13). Every table — NEMO tables (Ship forms, report pages), field tables (Pre-arrival, NOD, VID: Field · To NEMO · From), document rows, and any new table — uses the shared components; never build a table of your own.

- `src/components/StandardTable.vue` draws the table: the row-name column (sticky on the left, or last via `row-head-last`), column heads 12px SemiBold uppercase Text/100 with 0.72px letter spacing and ` *` on required columns, values Text/200, the row name Text/300 Medium, a dashed Blue/700 line under every row, every row at least as tall as a Ship forms Crew details row (59px: 6 + 4 + two 20px lines + 4 + 5) even when it has only one line of text, every cell's text centred vertically. No frame, no head surface. The NEMO code shows on a hover on a column's or row's name (`code`). Lines stay on one line and end in … with the whole text on hover. `fixed` gives set column widths (field tables: Field 278 · To NEMO 258 · From, 12px apart).
- `src/components/StandardCell.vue` is each value: tap to fill or fix it. Missing, to-check and disagreeing values use the missing-field orange (Orange/100 with the 3px Orange/300 bar), errors red. Keep the existing hover.
- Missing values are filled directly in their cell: tapping a missing cell turns it into the field itself (`editor` slot; `TableCellEditor.vue` for NEMO table cells). Enter or leaving the field saves, Esc puts it back. There is no separate Missing fields list, tab or missing/ready/entered filter chips on desktop. A value a form gave, or two forms disagreeing, still opens its own dialog.
- With All details off a table shows only the rows that need a person; rows filled there stay in view until the section changes.
- Admin and platform `q-table`s get the same look from `src/css/app.scss`.
- Phones keep their own views: MobileTable and the Fill all missing fields drawer for the ship's forms, the row cards and filter chips for field tables.

Template for a new table (copy this, never style a table of your own):

```vue
<StandardTable fixed row-head="Field" :row-head-width="290" :columns="columns" :rows="rows">
  <template #cell="{ row, column }">
    <StandardCell
      :state="isMissing(row, column) ? 'missing' : null"
      :editing="editingKey === `${row.key}:${column.key}`"
      @open="editingKey = `${row.key}:${column.key}`"
    >
      <div class="st-line">{{ valueOf(row, column) || 'missing' }}</div>
      <template #editor>
        <!-- the field itself, typed right in the cell; Enter/blur saves, Esc puts it back -->
      </template>
    </StandardCell>
  </template>
</StandardTable>
```

```ts
import StandardTable, { type StandardTableColumn, type StandardTableRow } from './StandardTable.vue';
import StandardCell from './StandardCell.vue';
const columns: StandardTableColumn[] = [
  { key: 'toNemo', label: 'To NEMO', width: 270 },   // width = column + its 12px gap
  { key: 'from', label: 'From' },
];
const rows: StandardTableRow[] = [{ key: 'draught', label: 'Actual maximum draught (m)', code: 'DE-…' }];
```

A list table (one row per person or item, many columns) leaves out `fixed` and the widths. Working examples: `NemoTable.vue` (Ship forms), `NodFormalityLedger.vue` (Pre-arrival, NOD), `FormalityItems.vue` (VID), `pages/admin/ShipsTab.vue` (Settings → Ships → ship data: Data and Certificates, a row opened with its details via `expanded` + the `detail` slot).

## Clearable fields

- Every editable field (q-input, q-select, DateField…) has an × on its right that empties it, shown while the pointer is over the field or while it has the focus (user 2026-11-13). Read-only and disabled fields have none.
- This is global: `src/boot/clearable-fields.ts` switches Quasar's `clearable` on for every q-input and q-select (a text field bound to a string empties to `''`, not `null`), and `src/css/app.scss` ("Clearable fields") shows the × only on hover or focus. Do not add `clearable` by hand or your own × buttons next to fields; a field that must not offer it passes `:clearable="false"`.
