---
name: before-ata-atd-picker-backup
description: "app/src copy from 2026-11-06, before the ATA/ATD pop-up (ActualSheet) became the Set schedule picker"
metadata:
  node_type: memory
  type: project
  originSessionId: ff3ae478-0df2-4468-a932-fd776e4d6df6
  modified: 2026-11-05T22:18:32.809Z
---

On 2026-11-06 ActualSheet.vue (the ATA / ATD send pop-up) was rebuilt as the opened port call's actual-time pen dialog: Set schedule picker (SchedulePicker, new `notAfter` prop so no future day/slot), title "Actual arrival (ATA)" / "Actual departure (ATD)", "Local time in <port>", 960px large card. Kept: the CTA "Confirm ATA HH:MM and send" with its 24px send icon and ⌘+Enter hint, the Send-the-NOA-first warning, the Customs-confirmation note. Dropped: −/+ 5-minute steps, the exact date-time field, logbook/AIS/Now chips (it still opens on the first source's time), Berth and Versus ETA cards.

Before the change, `app/src` was copied to `~/Downloads/nemolink-versions/before-ata-atd-picker-2026-11-06/app/src` and verified with `diff -rq`.

**Why:** the project is not a git repo; the user wants a restore point before UI changes.

**How to apply:** restore by rsyncing it over `app/src` only after the user confirms, then rebuild per [[app-docker-rebuild]]. Older: [[before-nod-restyle-backup]].
