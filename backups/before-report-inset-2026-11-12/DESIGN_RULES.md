# Design rules

## Icons and report pages

- Do not show question-mark help controls or their help popups. Preserve existing action tooltips, contextual hover hints for NEMO codes, missing data, sources, and full values, and hover styling.
- Never underline icons, including icons inside links or buttons. Apply any text underline to a separate label span, never to the enclosing control.
- Keep the mobile port-call modules in their existing dialogs and bottom sheets until a separate mobile redesign is requested.
- Keep Edit port call in its existing drawer on desktop and its existing sheet on smaller screens. It is separate from the report page redesign.
- Every desktop report uses the shared `ReportHeadline.vue` component, matching “Reports headline / Desktop” in Figma 632:9852. Use a 22px semibold title, 14px medium vessel/port text underneath, and a 12px semibold uppercase step label with 0.6px letter spacing above it.
- Always leave 27px between the desktop report headline and its content, using `--nl-report-headline-content-gap`. Align the heading and report content with the shared 32px left inset, `--nl-report-content-inset`.
- The top back link on every desktop report always returns to that port call’s overview, which lists section completion statuses. Label it “Port call overview”; never link it to the previous section. Keep its semibold text and back arrow in the headline’s navigation row, without small helper text or a forward section link. On desktop, automatically open the next section after the final send is accepted in full; partial or rejected sends remain visible. Refresh the call before opening the next section. Keep the existing mobile send flow.
- On desktop reports, All details off shows only the ready banner when the report has no issues. All details on reveals the report content. Keep the report action bar visible at the bottom of the viewport without a divider, and reserve enough content space for its full height.
- Place the desktop All details toggle on the same top row as the Port call overview back link, aligned to the opposite edge and vertically centered with it.

## Row pattern rules

- Moored port-call overviews keep all report links accessible, including completed reports and reports with unmet prerequisites. Underline all clickable report links in these overviews, including completed ones.

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
