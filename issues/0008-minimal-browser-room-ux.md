---
id: 0008
title: Minimal Browser Room UX
status: closed
label: wayfinder:prototype
parent: 0001
blocked_by: [0002, 0003, 0004, 0005]
assignee: pi-agent
---

## Question

What is the smallest browser flow and screen that makes joining, discussing, sharing screenshots, connecting Pi, sending new messages, seeing agent status, and recovering from offline states obvious?

## Resolution

Adopt Variant C, the Briefing Room layout: an editorial requirement header, a single discussion timeline, a visible design-reference panel, participant presence, active-agent status, and one primary `Send to agent` action. The action sends all new messages and screenshots since the last handoff; the earlier prototype label `Send new context` was renamed because it was unclear. The prototype remains the visual reference for the chosen structure, not production code.

## Asset

- [Room UX prototype](../prototype/room-ux/) — three throwaway layouts, switchable with `?variant=A`, `?variant=B`, and `?variant=C`.
