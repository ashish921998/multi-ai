---
id: 0016
title: Document History, Compare, and Restore
status: closed
label: wayfinder:prototype
parent: 0001
blocked_by: [0015]
assignee: zcode
---

## Destination

Expose the version trail that the backend already records so collaborators can
inspect earlier save points, compare one with the live document, and restore it
without destroying later history.

## Scope

- Add an authenticated query for one immutable version body.
- Show the most recent 200 versions with author, summary, and timestamp.
- Compare a selected version and the live body side by side.
- Restore through the existing OCC mutation; restoration creates a new version.
- Disable restore while the participant has an unsaved local draft.

## Resolution

Done. `documents.readVersion` exposes one room-scoped save point, history reads
are bounded, and the room editor now includes version selection, side-by-side
comparison, conflict-safe restore, and clear restore-as-new-version language.
