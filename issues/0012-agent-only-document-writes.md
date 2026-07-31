---
id: 0012
title: Agent-Only Document Writes
status: open
label: wayfinder:prototype
parent: 0001
blocked_by: [0011]
assignee: zcode
---

## Destination

Issue 0011 made workspace documents **read-only for participants in the UI**,
but the backend still authenticates participants and the active agent
identically in `documents.create`/`update`/`restore`. A participant with a
session token can write documents by calling the API directly. This ticket
enforces the "agent writes, participants read" model in the backend so it does
not depend on UI convention.

## Scope

- Add a write-auth helper alongside `resolveActor` that resolves the actor and
  rejects unless it is the room's active, healthy agent.
- Route `create`, `update`, and `restore` through it.
- Leave `list`, `read`, and `history` open to both participants and agents
  (read-only viewing is the product).

## Out of scope

- Wiring the connector to actually call these write mutations (separate ticket).
- Read-path or `lastAuthorKind` typing changes.

## Resolution

<!-- Filled on completion. -->
