---
name: figma-hands-off
description: Never touch Figma or edit any existing Figma frame unless the user explicitly tells me to
metadata:
  node_type: memory
  type: feedback
  originSessionId: ff3ae478-0df2-4468-a932-fd776e4d6df6
  modified: 2026-11-05T21:32:50.718Z
---

Do not touch Figma at all, and never edit an already-created Figma frame, unless the user explicitly asks for that specific change (user 2026-11-05, in caps: "ÄLÄ koske figmaan").

**Why:** after an app restyle I offered to update the earlier Send to NEMO Figma frames; the user wants Figma changes only on their explicit command.

**How to apply:** after code/UI changes, don't offer or perform Figma syncs; a "push X to Figma" request covers only creating what was asked, never modifying existing frames. Related: [[figma-design-guideline]].
