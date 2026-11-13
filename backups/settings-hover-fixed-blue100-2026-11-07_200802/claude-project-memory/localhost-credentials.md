---
name: localhost-credentials
description: Always show NEMOLink login credentials whenever the user asks about localhost (start/restart/login)
metadata:
  node_type: memory
  type: feedback
  originSessionId: a2200093-83a3-4ed2-9179-3ea234c76348
  modified: 2026-10-29T19:59:05.982Z
---

Whenever the user asks about localhost (starting, restarting, logging in, opening it), always end the reply with the login table:

| Käyttäjä | Salasana | Rooli |
|---|---|---|
| `admin@demo.example` | `demo-password-123` | admin (Demo Shipping Oy) |
| `platform@demo.example` | `demo-password-123` | superadmin / platform |

Plus any extra users created later (check `platform.user_account` if unsure).

**Why:** user asked explicitly ("anna aina tunnukset kun kysyn localhostia").
**How to apply:** any localhost-related reply → include URL http://localhost:3960 and the table. See [[app-docker-rebuild]]; Docker Desktop is often shut down, start it with `open -a Docker` first.
