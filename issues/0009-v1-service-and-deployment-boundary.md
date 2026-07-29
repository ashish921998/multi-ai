---
id: 0009
title: V1 Service and Deployment Boundary
status: closed
label: wayfinder:grilling
parent: 0001
blocked_by: [0004, 0007]
assignee: pi-agent
---

## Question

What is the smallest deployable service boundary and operational model for the room relay, realtime updates, temporary storage, cleanup, and connection security, while keeping the product browser-only and free of distributed compute orchestration?

## Resolution

Deploy the static browser frontend to Cloudflare Pages. Use one hosted Supabase project for Postgres, Realtime, private screenshot storage, and Edge Functions handling room creation, joining, handoffs, connection state, and cleanup. Pi remains a local connector with an outbound connection. V1 has no separate Node server, custom WebSocket service, R2, Artifacts, Ray, or Kubernetes.
