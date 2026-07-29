# V1 Room Backend Handoff

This document explains where a room lives and how `/room create` connects people without exposing a developer's laptop.

## The short version

`/room create` creates a room in the cloud. It does **not** host a website on the host's laptop and does **not** require an ngrok-style tunnel.

The recommended V1 shape is:

```text
Pi on participant laptop  ──outbound connection──┐
                                                  │
Browsers ──HTTPS/realtime──> Supabase cloud <─────┘
                                  │
                         temporary room data
                         and screenshots
```

The local Pi connector makes an outbound connection to the cloud. Because the connection starts from the laptop, the laptop does not need a public IP, open port, or inbound tunnel.

## What is hosted where?

### Browser app

Deploy the frontend to a normal web host such as Vercel or Cloudflare Pages. Participants open a URL such as:

```text
https://app.example.com/r/room-id
```

### Supabase project

Use one hosted Supabase project for V1:

- **Postgres** stores rooms, participants, messages, handoffs, agent status, and expiry timestamps.
- **Realtime** broadcasts new messages, presence, Pi status, and streamed responses.
- **Storage** holds screenshots in a private bucket.
- **Edge Functions** handle privileged operations such as creating rooms, checking passwords, issuing connection codes, and cleanup.

Supabase is a hosted backend service. We do not run a server or database on the host's laptop.

### Local Pi connector

Pi remains local. A Pi extension or command connects to the room service and relays messages:

```text
/room create
/room connect <one-time-code>
/room disconnect
```

The connector is responsible for passing a handoff to Pi as a normal user message and sending Pi's response back to the room. The repository, terminal, Pi session, provider credentials, and API keys stay on that participant's laptop.

## What happens during `/room create`?

1. Pi calls the room backend to create a room.
2. The backend creates a random room id, random password, and expiry timestamp.
3. The backend returns a join URL and password.
4. Pi opens the URL in the browser.
5. The local Pi connector establishes an outbound realtime connection and becomes the active agent.
6. The host shares the URL and password.

The URL is only an address. The password is the second part of the room access check.

## What happens when someone joins?

1. They open the shared URL.
2. They enter the room password and a display name.
3. The browser asks the backend to verify access.
4. The browser subscribes to the room's realtime events.
5. The backend sends the current room timeline and participant presence.

They do not install Pi, open a port, or connect to the host's laptop.

## What happens when someone sends to Pi?

1. Participants write messages and attach screenshots.
2. The room stores each message with a sequence number.
3. Someone clicks **Send to agent**.
4. The backend collects messages after the previous handoff boundary.
5. It sends one deterministic handoff to the active Pi connector.
6. The connector gives Pi a normal user message with the room context.
7. Pi streams its response back through the connector.
8. The backend stores and broadcasts the response to every browser.

If the active Pi disconnects, the room remains usable. Another participant can connect their own local Pi with a one-time code and take the active slot.

## What data is temporary?

The backend retains room messages and screenshots until 30 days after the room's last activity. A cleanup job then deletes the room data and private screenshot objects.

We do not retain:

- Repositories
- Worktrees
- Terminal output outside Pi responses sent to the room
- Pi credentials
- Provider API keys

A participant's Pi provider may separately retain the handoff according to that provider's policy.

## Why this is not a tunnel

A tunnel makes a laptop reachable from the public internet. We do not need that. The cloud relay is reachable by everyone, and Pi connects outward to it:

```text
Good:  laptop ──outbound──> cloud relay <──outbound── other browsers
Avoid: internet ──inbound tunnel──> laptop
```

This is similar to how a desktop chat client maintains a connection to a chat service.

## The backend concepts worth learning

Learn these in order:

1. **HTTP requests:** browser or Pi asks the backend to create a room or send data.
2. **Database rows:** persistent records for rooms, messages, and participants.
3. **Realtime/WebSockets:** a long-lived connection for instant room updates.
4. **Object storage:** a file bucket for screenshots, separate from the database.
5. **Authentication and authorization:** password verification, session tokens, and row-level access rules.
6. **Signed URLs:** temporary links that let an authorized participant view a private screenshot.
7. **TTL cleanup:** deleting records after their expiry time.

You do not need Ray, Kubernetes, a custom distributed system, or a public server running on a laptop for this V1.

## Suggested implementation order

1. Deploy a blank browser app.
2. Create a Supabase project and one private screenshot bucket.
3. Add room creation and password-protected joining.
4. Add persisted text messages and realtime updates.
5. Add the local Pi connector and one active-agent connection.
6. Add handoffs and streamed Pi responses.
7. Add screenshot uploads and cleanup.
8. Add reconnect, takeover, rate limits, and production hardening.
