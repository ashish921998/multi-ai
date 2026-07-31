---
id: 0011
title: Workspace Documents Finish
status: open
label: wayfinder:prototype
parent: 0001
blocked_by: []
assignee: zcode
---

## Destination

The workspace documents substrate (commit `96efb65`) has a complete backend but
is not wired into the product. This ticket finishes it end-to-end as a
read-only-for-participants surface:

- Room cleanup reclaims `documents` and `documentVersions` rows (today they are
  orphaned when a room expires).
- The web room view surfaces the agent's workspace documents in the center
  "shared plan" pane: a selector across the room's docs and the selected doc's
  body, read-only. When no documents exist yet, the pane keeps showing the
  latest agent message so agent-less rooms behave exactly as before.

## Scope

- **Agent writes, participants read.** Only the active Pi creates/updates
  documents (via the existing `documents` mutations). Participants get no edit
  controls.
- Documents arrive through the existing single reactive `rooms.state`
  subscription (a bounded `documents` summary, no bodies). A doc's body is read
  lazily via `documents.read` for the selected document only.
- Display as preformatted text (`white-space: pre-wrap`), matching the current
  plan pane — no Markdown rendering dependency in this ticket.

## Out of scope

- Participant editing of documents.
- Document history / restore UI (backend exists; defer).
- A Markdown rendering library.

## Resolution

<!-- Filled on completion. -->
