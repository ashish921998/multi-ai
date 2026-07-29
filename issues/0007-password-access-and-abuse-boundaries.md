---
id: 0007
title: Password Access and Abuse Boundaries
status: closed
label: wayfinder:grilling
parent: 0001
blocked_by: []
assignee: pi-agent
---

## Question

What access, password handling, participant limits, rate limits, and privacy boundaries are required for a link-and-password room whose content may be forwarded through a participant's local Pi provider?

## Resolution

Generate a random room password, store only its hash, and issue a temporary browser session token after successful joining. No accounts or join notice are required. Enforce silent server-side limits: 10 participants per room, 5 failed password attempts per IP per minute, 30 messages per participant per minute, screenshot limits from the attachment contract, and rate-limited room creation per IP.
