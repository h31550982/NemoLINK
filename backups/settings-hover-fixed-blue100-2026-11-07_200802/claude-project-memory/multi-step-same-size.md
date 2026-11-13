---
name: multi-step-same-size
description: "A multi-step pop-up keeps one card size on every step; the size to match is Pre-arrival's (1240px wide, full height)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: dbe840f0-cc1d-4cb4-9845-121792c969ba
  modified: 2026-11-06T17:17:22.537Z
---

A pop-up with steps must be the same card size on every step. The size to match is the Pre-arrival pop-up: 1240px wide and `full-height` (window height minus 48px), whether All details is on or off. Pre-arrival (NoaWizardDialog) and Ship forms (FormsWizardDialog) use `:max-width-px="1240"` + `full-height` with no condition.

**Exception (user 2026-11-07):** VID (NemoWizardDialog) is 874px wide (806px content + 34px padding each side), still full height, so the step pills, All details and Send to NEMO line up with the content edges. Still the same size on every step.

**Why:** the user compared VID (740px wide, height following the content) with Pre-arrival and called it "still small". It took two wrong tries to get there. First I changed only the height, then I changed only the step pills (those are now all 36px, which is fine but was not the ask).

**How to apply:** any new wizard gets the Pre-arrival size. When the user says "card size", compare against Pre-arrival's pop-up, and answer with px numbers if unsure. Done 2026-11-06.
