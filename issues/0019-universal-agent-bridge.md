---
id: 0019
title: Universal Agent Bridge
status: closed
label: wayfinder:prototype
parent: 0001
blocked_by: [0017]
assignee: zcode
---

## Destination

Let a participant connect the coding-agent harness already installed beside their
repository instead of requiring Pi.

## Scope

- Keep room leases, handoffs, streaming, attachments, and document OCC in one
  connector core.
- Add small built-in harness definitions for Pi, Codex, Claude Code, Cursor, and
  OpenCode.
- Add a generic executable integration that receives the prompt on stdin.
- Invoke processes without a shell and report non-zero exits.
- Let the room UI generate the command for the selected harness.
- Replace Pi-specific product language with agent-neutral language.
- Cover every harness definition and the subprocess path with tests.

## Resolution

Done. `room connect ... --agent <name>` supports the five built-in harnesses, while
`--agent custom --command <executable> --arg <value>` covers any plain-text command.
All harnesses share the same connector and concurrency behavior; only prompt
invocation varies. The browser now presents a harness selector and agent-neutral
status, handoff, document-history, and error copy.
