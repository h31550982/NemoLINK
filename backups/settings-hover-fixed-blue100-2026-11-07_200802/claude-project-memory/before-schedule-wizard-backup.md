---
name: before-schedule-wizard-backup
description: app/src copy from 2026-11-03, before the New port call card restyle + Set schedule wizard (Figma 444:6905, 440:6767, 440:6983, 444:6971)
metadata:
  type: project
---

On 2026-11-03, before restyling the New port call card (FormCard.vue) and replacing its ETA/ETD date fields with the Set schedule wizard (ScheduleDialog.vue + SchedulePicker.vue), `app/src` was copied to `~/Downloads/nemolink-versions/before-schedule-wizard-2026-11-03/app/src` and verified with `diff -rq`.

**Why:** the project is not a git repo; the user wants a restore point before UI changes.

**How to apply:** restore by rsyncing that src over `app/src` only after the user confirms, then rebuild per [[app-docker-rebuild]]. Older: [[before-header-tools-backup]].
