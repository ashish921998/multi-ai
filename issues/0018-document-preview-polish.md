---
id: 0018
title: Document Preview Polish
status: closed
label: wayfinder:prototype
parent: 0001
blocked_by: [0015]
assignee: zcode
---

## Destination

Make durable documents comfortable to review without weakening the source-first
editing and active-content safety boundaries.

## Scope

- Add edit/preview modes.
- Render Markdown with tables, task lists, links, code, and other GFM syntax.
- Lazy-load the Markdown renderer so the room's initial bundle does not pay for
  it until a preview is shown.
- Show HTML as source rather than executing participant-authored active content.
- Keep the editor, comparison view, and controls usable on narrow screens.

## Resolution

Done. Markdown documents have a lazy-loaded GFM preview and styled technical
content; HTML remains inert source. The workspace, history, comparison, and
editor controls now reflow at tablet and mobile breakpoints.
