---
name: before-vid-restyle-backup
description: "app/src copy from 2026-11-05, before the Send to NEMO port call (VID) pop-up went white/1240px like Pre-arrival and Ship forms"
metadata:
  node_type: memory
  type: project
  originSessionId: ff3ae478-0df2-4468-a932-fd776e4d6df6
  modified: 2026-11-05T21:31:50.520Z
---

On 2026-11-05 NemoWizardDialog.vue (Send to NEMO: Port call (VID) / Ship data) was restyled: no cards inside the card, white body, steps in the band, 1240px always (All details only changes height, full-height when on, as Ship forms), rows as Pre-arrival Confirm and send (label over value + Ready / Data missing / In NEMO pill), All details field table framed like FormalityLedger (FormalityItems `framed` prop, used only there).

Before the change, `app/src` was copied to `~/Downloads/nemolink-versions/before-vid-restyle-2026-11-05/app/src` and verified with `diff -rq`.

**Why:** the project is not a git repo; the user wants a restore point before UI changes.

**How to apply:** restore by rsyncing it over `app/src` only after the user confirms, then rebuild per [[app-docker-rebuild]]. Older: [[before-nemo-overview-card-backup]].
