# Row pattern rules

For a list row with a label or link on the left, a status pill on the right, and a divider:

- Match the existing “What goes to NEMO” rows on mobile and tablet, at viewport widths up to 1023px.
- Use `min-height: var(--nl-row-mobile-min-height)` (58px), with no vertical row padding. Centre the label and pill vertically.
- Use a minimum height, not a fixed height: wrapped labels and supporting text must fit without clipping.
- Make row links stretch vertically within the row so the tap target follows its height.

The shared height token lives in `src/css/app.scss`. Reuse it whenever this row pattern is introduced.
