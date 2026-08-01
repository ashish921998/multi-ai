# Room Backend Handoff

This document explains where a room lives and how local coding-agent harnesses
participate without exposing a developer's laptop.

## The short version

The browser and connector both make outbound connections to Convex:

```text
Codex / Claude Code / Cursor / OpenCode / Pi / custom command
                         │
                  local connector
                         │ outbound
                         ▼
Browsers ───────────▶ Convex cloud
                         │
             rooms · documents · screenshots
```

The laptop needs no public address, open port, or tunnel. Repository access,
provider credentials, and the coding-agent process stay local.

## Hosted parts

### Browser app

The static React app runs on Cloudflare Pages. Participants open a room URL, enter
the password and a display name, then receive a session-scoped reactive view.

### Convex backend

Convex stores rooms, participants, messages, handoffs, agent leases, versioned
workspace documents, and screenshot metadata. Private storage holds screenshot
bytes. Queries and mutations enforce room sessions, one-time connection codes,
one active-agent lease, optimistic document concurrency, and cleanup.

### Local agent connector

A participant chooses a harness in the room and runs:

```text
room connect <room-id> <one-time-code> --agent <harness>
```

Built-in harnesses are `codex`, `claude`, `cursor`, `opencode`, and `pi`. A custom
executable can receive the same prompt on stdin. The connector:

1. redeems the one-time code and claims the active-agent lease;
2. heartbeats while connected;
3. receives deterministic room handoffs reactively;
4. starts the selected harness beside the repository;
5. streams plain-text output into the room;
6. writes `plan.md` only against the exact version included in the handoff.

The harness is the only varying part. Room transport, retries, attachments,
streaming, and document concurrency stay in the shared connector core.

## Room lifecycle

1. A participant creates a temporary room in the browser.
2. The backend returns a random room ID, password, and expiry.
3. Other participants join with the URL and password.
4. Any participant may issue a one-time agent connection code.
5. One local connector claims the active-agent lease.
6. Participants discuss the task and attach screenshots.
7. **Send to agent** packages messages after the previous completed boundary.
8. The connector gives that handoff and the current `plan.md` snapshot to the
   selected harness.
9. The response streams to every browser and becomes a new document version if
   the snapshot is still current.

If a participant edits the document while the agent is responding, the stale
agent write is rejected rather than overwriting the participant. The streamed
response remains in the discussion for recovery.

If the active connector disconnects or misses its lease heartbeat, another
participant can issue a code and connect any supported harness.

## Screenshot handling

Screenshots remain private in Convex storage. For a vision-enabled connector, a
short-lived URL is resolved and downloaded into a temporary local directory. The
prompt contains those local paths. The directory is deleted after the harness
finishes.

## Temporary data

Rooms and their documents, messages, connection rows, and private screenshot
objects are deleted 30 days after the room's last activity.

The service does not receive or retain:

- repositories or worktrees;
- terminal output other than the response intentionally sent to the room;
- harness credentials;
- provider API keys.

The selected model provider may separately retain prompts according to its own
policy.

## Why this is not a tunnel

```text
Good:  laptop ──outbound──▶ cloud relay ◀──outbound── browsers
Avoid: internet ──inbound tunnel──▶ laptop
```

Only the cloud relay is publicly reachable. The local connector behaves like a
desktop chat client maintaining an outbound connection.
