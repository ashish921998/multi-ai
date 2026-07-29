---
id: 0003
title: Room-to-Agent Handoff
status: closed
label: wayfinder:grilling
parent: 0001
blocked_by: [0002]
assignee: pi-agent
---

## Question

What exact message batch should the room send when any participant clicks Send to agent, how is the new-message boundary recorded, and how should Pi responses and failed handoffs appear in the shared timeline?

## Resolution

Each room message receives an increasing sequence number. Send to agent packages every message after the previous handoff boundary, including participant names, timestamps, text, and screenshots, as one deterministic user-message envelope; no AI summarizer is added. The handoff boundary advances only after Pi acknowledges receipt. Pi responses stream into one timeline message, become complete when finished, and expose retry on failure using the same batch without duplicating messages.
