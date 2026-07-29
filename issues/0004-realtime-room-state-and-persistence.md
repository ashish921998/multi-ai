---
id: 0004
title: Realtime Room State and Persistence
status: closed
label: wayfinder:grilling
parent: 0001
blocked_by: []
assignee: pi-agent
---

## Question

What minimum room state must be stored and broadcast in real time, where should messages and attachments live, and how should 30-day inactivity expiry and reconnect behavior work without creating a durable workspace system?

## Resolution

Use a hosted Supabase project as the temporary source of truth. Postgres stores room metadata, participants, messages, handoffs, Pi status, and expiry timestamps; Supabase Realtime broadcasts room events and presence; Supabase Storage holds private screenshots. Clients reconnect by fetching missed sequence-numbered events. A cleanup job deletes room data and screenshots after 30 days of inactivity. The browser frontend can be deployed to Cloudflare Pages or Vercel, while Pi remains local and connects outward.

## Asset

- [V1 Room Backend Handoff](../docs/v1-room-backend-handoff.md) — a short explanation of the hosted relay, Supabase storage, browser access, and local Pi connection model.
