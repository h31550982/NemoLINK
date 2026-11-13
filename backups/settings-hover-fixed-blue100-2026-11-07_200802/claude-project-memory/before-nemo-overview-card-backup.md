---
name: before-nemo-overview-card-backup
description: "app/src copy from 2026-11-05, before Send to NEMO step 3 got the combined This goes to NEMO + reports dropdown card"
metadata:
  type: project
---

On 2026-11-05 the "This goes to NEMO" summary and the "DUE goes with it" lines in NoaWizardDialog.vue (Confirm and send step) were combined into one card that opens and closes, modelled on the Ship forms SectionFiles card: grey head with "Missing: …", Fill in below, chevron; two-column fields with orange Missing pills; "Reports that go with it" with state pills.

Before the change, `app/src` was copied to `~/Downloads/nemolink-versions/before-nemo-overview-card-2026-11-05/app/src` and verified with `diff -rq`.

**Why:** the project is not a git repo; the user wants a restore point before UI changes.

**How to apply:** restore by rsyncing it over `app/src` only after the user confirms, then rebuild per [[app-docker-rebuild]]. Older: [[before-prearrival-fields-backup]].
