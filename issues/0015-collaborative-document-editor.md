---
id: 0015
title: Collaborative Document Editor
status: closed
label: wayfinder:prototype
parent: 0001
blocked_by: [0011]
assignee: zcode
---

## Destination

Make the shared workspace match the equal-collaborator backend contract: joined
participants can create and edit the same Markdown/HTML documents as Pi instead
of seeing an agent-only, read-only plan pane.

## Scope

- Create documents by path from the room.
- Edit the selected document and save each edit as a new version.
- Send `expectedVersion` with every update.
- Preserve a local draft when a newer remote version arrives, clearly report the
  conflict, and require the participant to load the latest version before saving.
- Keep document bodies lazy: subscribe only to the selected document.

## Resolution

Done. The center pane is now a shared workspace with document creation, source
editing, save/discard state, and explicit optimistic-concurrency conflict UI.
The editor follows reactive server updates while clean and preserves local text
when a collaborator changes the document during an edit.
