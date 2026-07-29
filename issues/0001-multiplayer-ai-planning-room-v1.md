---
id: 0001
title: Multiplayer AI Planning Room V1
status: closed
label: wayfinder:map
parent:
blocked_by: []
assignee:
---

## Destination

An implementation-ready V1 spec for a lightweight browser room where people join with a link, password, and display name; up to 10 equal participants collaborate in real time with text and screenshots; anyone can connect a local Pi agent; one Pi is active at a time; anyone can send all new room messages to that agent; Pi responds as a normal planning-focused coding agent; and rooms expire after 30 days of inactivity.

## Notes

Domain: multiplayer AI planning rooms. Consult the project glossary, the Plannotator sharing model, and Pi extension documentation when implementation begins. Keep V1 very simple and lightweight: browser-only, no accounts or roles, no repository syncing, no Ray/distributed compute, no simultaneous agents, and no direct code editor.

## Decisions so far

<!-- Closed child tickets appear here. Open tickets are discovered from the local tracker frontier. -->

- [Pi Connector Lifecycle](./0002-pi-connector-lifecycle.md) — Any participant can connect Pi through a one-time code; one active connection exists at a time and another participant can take over after it disconnects.
- [Room-to-Agent Handoff](./0003-room-to-agent-handoff.md) — Send all new messages as a sequence-numbered deterministic batch; advance only after acknowledgement and stream retryable Pi responses into the timeline.
- [Realtime Room State and Persistence](./0004-realtime-room-state-and-persistence.md) — Supabase is the temporary source of truth for room data, realtime events, presence, and private screenshots, with sequence-based reconnects and 30-day cleanup.
- [Screenshot Attachment Contract](./0005-screenshot-attachment-contract.md) — Support private PNG/JPEG/WebP screenshots with lightweight limits; forward them to vision-capable Pi models and warn/fallback to text otherwise.
- [Single Active Agent Takeover](./0006-single-active-agent-takeover.md) — The active Pi holds a heartbeat lease; explicit disconnect or 30 seconds without heartbeats frees the slot for any participant, while stale connections are rejected.
- [Password Access and Abuse Boundaries](./0007-password-access-and-abuse-boundaries.md) — Random hashed passwords and temporary browser sessions provide account-free access, with silent participant, join, message, upload, and room-creation limits.
- [Minimal Browser Room UX](./0008-minimal-browser-room-ux.md) — Adopt the Briefing Room layout: one discussion timeline, visible design reference, participant/agent status, and a clear `Send to agent` action.
- [Briefing Review Workspace Variant](./0010-briefing-review-workspace-variant.md) — Use the Plannotator-inspired three-pane structure with a read-only shared plan and discussion pane, while excluding their markup/review tools and preserving source licenses when adapting code.
- [V1 Service and Deployment Boundary](./0009-v1-service-and-deployment-boundary.md) — Deploy the frontend to Cloudflare Pages and use Supabase for the complete V1 backend surface; keep Pi local and avoid extra infrastructure.

## Not yet specified


## Out of scope

- User accounts, organizations, billing, teams, or durable workspaces.
- Owner, host, co-host, or other role-management concepts.
- Repository hosting, repository synchronization, shared worktrees, or cloud terminals.
- Simultaneous active agents or multi-agent conflict resolution.
- Live collaborative code editing, voice/video, and general document uploads.
