---
name: title-head-surface
description: "#F4F4F6 (token --nl-g-head-surface) is the approved off-system surface for list column-head rows and the Ship forms files card head + its banner, from 2026-11-03"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0089f690-ab7c-489c-92b7-d784c89d8d0b
  modified: 2026-11-03T01:09:39.634Z
---

From 2026-11-03 #F4F4F6 is used, although it is not in the Figma design system, for:
- the headline row of lists: column heads such as CREW MEMBERS, FAMILY NAME (`.nt-table thead th`, `.nt-table thead .nt-first` in NemoTable.vue; that row also has no bottom stroke);
- the Ship forms files dropdown head (`.sf-head` in SectionFiles.vue) and its All-details-off banner (`.fw-status.wz-banner--ok` in FormsWizardDialog.vue), so they match the list head.

In code it is the token `--nl-g-head-surface` in app/src/css/app.scss.

History: first applied to the dropdown head by mistake and undone; the user then asked for the list head; then, the same day, asked for the dropdown head to match the list head after all ("tee sittenkin dropdown headerin taustaväristä sama kuin list itemin headerin").

**Why:** user's explicit instructions.
**How to apply:** list column-head rows and these status heads use `var(--nl-g-head-surface)`. It is an approved exception to the "guideline colours only" rule in [[figma-design-guideline]]. Orange/red status tints keep their own fills.
