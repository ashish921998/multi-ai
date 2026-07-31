---
id: 0013
title: Agent Writes the Plan Document
status: open
label: wayfinder:prototype
parent: 0001
blocked_by: [0012]
assignee: zcode
---

## Destination

Issues 0011 (UI reads documents) and 0012 (backend accepts agent writes) left
the pipeline open at one end: **nothing writes documents yet**, so the
shared-plan pane always shows the empty fallback. This ticket makes the
connector write the agent's response into a durable workspace document on each
completed handoff, so a room's plan accumulates instead of scrolling away.

## Decisions

- **Trigger:** after each handoff completes, upsert the agent's full response
  into a single canonical document `plan.md` (create on first write, update with
  optimistic concurrency on later writes).
- **Timeline:** keep both — the response still streams into the chat timeline,
  and `plan.md` is written as a side effect. A document-write failure is logged
  and never fails the handoff.

## Out of scope

- Parsing multiple tagged document blocks from agent output (single `plan.md`).
- Replacing the chat response with the document.
- Document history/restore UI and Markdown rendering.

## Resolution

<!-- Filled on completion. -->
