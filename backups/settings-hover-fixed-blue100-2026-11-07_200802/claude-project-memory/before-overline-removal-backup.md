---
name: before-overline-removal-backup
description: "app/src copy from 2026-11-06, before the phone pop-up caps helper line (overline) was removed from all dialogs"
metadata:
  node_type: memory
  type: project
  originSessionId: 93ae933f-4b72-440b-8b91-dcef565096e2
  modified: 2026-11-06T17:08:28.698Z
---

On 2026-11-06 the user asked to remove the upper caps helper text from all cards. HouseDialog's `overline` prop, its markup and its `.house-dialog__overline` style were deleted, and so were the callers' overline props: NoaWizardDialog, FormsWizardDialog, NemoWizardDialog and ScheduleDialog. The line only ever showed on the phone sheet. Don't bring it back.

Backup: `~/Downloads/nemolink-versions/before-overline-removal-2026-11-06/app/src` (verified with diff -rq).

**Why:** the project is not a git repo; the user wants a restore point before UI changes.
**How to apply:** restore only after the user confirms, then rebuild per [[app-docker-rebuild]]. The Figma header frame 540:7541 still has the overline; leave it unless told otherwise ([[figma-hands-off]]).
