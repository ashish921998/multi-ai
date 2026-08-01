---
id: 0014
title: Update E2E Documents Harness for Collaborative Contract
status: closed
label: wayfinder:prototype
parent: 0001
blocked_by: [0013, 0017]
assignee: zcode
---

## Destination

Keep `e2e-documents.mts` aligned with the equal-collaborator workspace contract
and cover the connector side effect that unit tests cannot prove against a real
deployment.

## What the rewritten harness proves

1. A participant creates and reads `plan.md`.
2. A real connector handoff reads the existing plan and automatically writes the
   complete response as agent-authored v2.
3. OCC rejects a stale participant write.
4. The participant builds on Pi's v2 as v3.
5. History records human → agent → human authorship newest-first.
6. Restoring v1 creates v4 and preserves the version trail.

## Out of scope

Deployment automation and destructive cleanup of the temporary smoke-test room.
Rooms remain covered by the normal 30-day expiry job.

## Resolution

Done. The harness now drives room creation, participant document creation, the
real connector CLI and handoff, connector auto-write, a subsequent participant
edit, history assertions, and restore. It no longer encodes the reverted
agent-only contract.

## Live verification

Verified against deployment `nautical-ermine-841` after a `npx convex dev --once`
push of the 0016/0017 backend. `npx tsx e2e-documents.mts` (run twice, exit 0
both times) proved the full collaborative contract on the live backend and the
real local connector:

- participant creates and reads `plan.md@v1`;
- a real handoff reads the existing plan and the connector auto-writes the
  response as agent-authored v2 (preserving the original objective);
- the OCC guard rejects a stale participant write
  (`Document changed since you last read it (yours v1, now v2)`);
- the participant builds on Pi's v2 → v3;
- history records `v3(participant) → v2(agent) → v1(participant)` newest-first;
- restoring v1 creates v4 without rewriting the version trail.
