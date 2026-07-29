---
id: 0002
title: Pi Connector Lifecycle
status: closed
label: wayfinder:grilling
parent: 0001
blocked_by: []
assignee: pi-agent
---

## Question

What is the simplest and safest lifecycle for a participant to connect a local Pi agent to a room, become the active agent, disconnect, reconnect, and allow another participant to take over?

## Resolution

Every participant joins the room in the browser and may use a one-time connection code with Pi's `/room connect <code>` flow. The first connected Pi becomes the active agent; while it is active, other participants cannot connect another agent. The active connection can be explicitly disconnected or released when its process exits or times out, after which any participant may connect and take over. No participant has special host or owner status.
