---
id: 0017
title: Safe Agent Plan Build-On
status: closed
label: wayfinder:prototype
parent: 0001
blocked_by: [0015]
assignee: zcode
---

## Destination

Make Pi a real collaborator on `plan.md`: it reads the current document before
responding, receives instructions to return a complete updated document, and can
never overwrite a human edit that lands while it is working.

## Scope

- Snapshot `plan.md` body and version when the connector fetches a handoff.
- Include that snapshot in the local command prompt.
- Write the response against the exact snapshot version.
- Remove the old retry-against-latest behavior, which could silently replace a
  concurrent participant edit.
- Treat document conflicts as isolated side-effect failures; the already-streamed
  handoff response remains in discussion.

## Resolution

Done. Handoffs now carry the current plan snapshot, command responders are asked
to return the complete updated Markdown, and connector writes use the snapshot's
version as a strict OCC precondition. A concurrent create/edit produces a clear
log message and leaves the collaborator's version untouched. The deterministic
echo responder also builds on existing plan content for smoke tests.
