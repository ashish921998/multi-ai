---
id: 0014
title: Update e2e-documents Harness to Agent-Only Contract
status: open
label: wayfinder:prototype
parent: 0001
blocked_by: [0013]
assignee: zcode
---

## Destination

`e2e-documents.mts` was written before issues 0012/0013 and now asserts the old
contract (participant writes succeed). It will fail against the current backend.
Rewrite it to assert the contract as shipped, then run it live as the
end-to-end smoke test the documents feature otherwise lacks.

## What the rewritten harness proves

1. Participant `create`/`update`/`restore` are **rejected** (0012).
2. Agent `create`/`update` **succeed**; OCC rejects a stale `expectedVersion`;
   `restore` writes a new version (0012).
3. Participant `list`/`read`/`history` still work (0011).
4. A real handoff causes the connector to **auto-write `plan.md`** with the
   streamed response body (0013).

## Out of scope

Markdown rendering, branch/PR hygiene, new unit tests.

## Resolution

<!-- Filled on completion. -->
