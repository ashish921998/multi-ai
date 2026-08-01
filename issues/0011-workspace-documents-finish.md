---
id: 0011
title: Workspace Documents Finish
status: closed
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

Done (commit `9af8aee`). Cleanup now reclaims `documents` + `documentVersions`
(bounded reads per doc). A bounded documents summary is folded into the single
reactive `rooms.state` query. The web room view surfaces the agent's documents
read-only in the center "shared plan" pane, falling back to Pi's latest message
when no documents exist. Participants are read-only in the UI; backend
enforcement of agent-only writes was deferred to issue 0012.

## Follow-up

The agent-only direction was subsequently reverted in commit `70b2ade`: joined
participants and the active agent are equal document collaborators. Issue 0015
replaces this ticket's read-only browser surface with the collaborative editor.
