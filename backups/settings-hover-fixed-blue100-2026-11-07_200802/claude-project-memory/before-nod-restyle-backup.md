---
name: before-nod-restyle-backup
description: "app/src copy from 2026-11-05, before Send to NEMO: NOD became a white 820px pop-up like the VID one"
metadata:
  node_type: memory
  type: project
  originSessionId: ff3ae478-0df2-4468-a932-fd776e4d6df6
  modified: 2026-11-05T21:56:12.745Z
---

On 2026-11-05 NodDialog.vue was restyled like Send to NEMO (VID): white, no cards inside, Heading/22 title with help beside it, 820px, no footer Close; "This goes to NEMO" as label-over-value rows with Ready / Data missing pills; the fill table (NodFormalityLedger `code-on-hover` prop) drops the NEMO code column (hover on the field name) and has 48px rows.

Before the change, `app/src` was copied to `~/Downloads/nemolink-versions/before-nod-restyle-2026-11-05/app/src` and verified with `diff -rq`.

**Why:** the project is not a git repo; the user wants a restore point before UI changes.

**How to apply:** restore by rsyncing it over `app/src` only after the user confirms, then rebuild per [[app-docker-rebuild]]. Older: [[before-vid-restyle-backup]].
