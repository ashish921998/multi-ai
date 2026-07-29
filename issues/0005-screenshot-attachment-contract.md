---
id: 0005
title: Screenshot Attachment Contract
status: closed
label: wayfinder:grilling
parent: 0001
blocked_by: [0002]
assignee: pi-agent
---

## Question

What screenshot formats, size limits, upload and preview behavior, retention rules, and Pi handoff representation are sufficient for useful design discussions while keeping V1 lightweight?

## Resolution

V1 accepts PNG, JPEG, and WebP screenshots through paste, drag-and-drop, or file selection. Each image is limited to 5 MB, each handoff to 10 screenshots, and very large images are resized in the browser before upload. Screenshots are private Supabase Storage objects deleted with the room after 30 days. Vision-capable Pi models receive image inputs; otherwise screenshots remain visible in the room, Pi receives the text only, and the room shows a clear limitation warning.
