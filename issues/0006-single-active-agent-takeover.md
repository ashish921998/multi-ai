---
id: 0006
title: Single Active Agent Takeover
status: closed
label: wayfinder:grilling
parent: 0001
blocked_by: [0002]
assignee: pi-agent
---

## Question

How does a room enforce one active Pi connection, detect disconnects, prevent stale agents from receiving handoffs, and let any participant take over without host or owner roles?

## Resolution

The first connected Pi receives an active lease and sends regular heartbeats. Explicit disconnect releases it immediately; missing heartbeats for 30 seconds marks it offline. A second Pi cannot forcibly take over a healthy connection, but any participant may connect after the lease ends. Stale connections lose permission to receive new handoffs.
