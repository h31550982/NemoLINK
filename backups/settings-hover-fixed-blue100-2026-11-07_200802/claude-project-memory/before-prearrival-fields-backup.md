---
name: before-prearrival-fields-backup
description: "app/src copy from 2026-11-05, before the Send to NEMO Pre-arrival step 2 field restyle (FormalityLedger)"
metadata:
  node_type: memory
  type: project
  originSessionId: 7a6ef74a-f2c3-4ce8-b3df-50238f688f2f
  modified: 2026-11-05T15:32:46.175Z
---

On 2026-11-05 step 2 of Send to NEMO: Pre-arrival (NoaWizardDialog + FormalityLedger.vue) was restyled. The changes: the "All fields" filter in blue and semibold; the ready line and the "N things only you can decide" title removed, and so was the port line; 12px meta text moved into hover tooltips, or dropped when the source is the port call; 14px Medium Text/200 values; an orange missing row; radio buttons for voyage type; no clear buttons; a source dot in front of the To NEMO value; solid Blue/500 row strokes and Blue/600 under the heads; inputs 48px tall with 10px padding above and below the text.

Before the change, `app/src` was copied to `~/Downloads/nemolink-versions/before-prearrival-fields-2026-11-05/app/src` and verified with `diff -rq`.

**Why:** the project is not a git repo; the user wants a restore point before UI changes.

**How to apply:** restore by rsyncing it over `app/src` only after the user confirms, then rebuild per [[app-docker-rebuild]]. Older: [[before-side-nav-popup-backup]].
