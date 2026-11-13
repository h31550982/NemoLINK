---
name: port-call-order
description: Front-page port call order — Upcoming soonest ETA on top; Moored/Departed latest on top
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2c78176e-a748-4149-94dd-f072d942c0c3
  modified: 2026-11-06T22:21:42.111Z
---

Port calls are ordered "most recently arriving first" (user 2026-11-07): in Upcoming the call with the soonest ETA is on top; Moored keeps the latest arrival on top, Departed the latest departure on top. Calls without a time stay on top.

**Why:** the user's rule for the front-page lists; before this Upcoming had the furthest-away ETA on top.
**How to apply:** any new list or view of port calls follows the same order (app/src/lib/call-list.ts sortTime).
