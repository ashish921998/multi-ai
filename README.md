# Multiplayer AI Planning Room

A lightweight V1 where people join a room with a link + password, discuss a coding
requirement with text and screenshots, and hand the new discussion to one local Pi
agent that responds as a planning-focused coding agent. No accounts, no tunnels, no
hosted repositories — Pi stays local and connects outward to a cloud relay.

This implements the spec in [`docs/v1-room-backend-handoff.md`](./docs/v1-room-backend-handoff.md)
and the closed design decisions in [`issues/`](./issues/) (0001–0010).

## Architecture

```
Browsers ──HTTPS + realtime tickers──> Supabase cloud <──outbound── Pi connector (local)
                                           │
                                   Postgres · Realtime · Storage · Edge Functions
```

- **`packages/shared`** — the cross-runtime contract (types + pure logic). Imported
  unchanged by the browser app, the connector, and the Edge Functions. This is the
  heavily unit-tested seam: handoff batching, the active-agent lease, rate limits,
  password/code hashing, screenshot limits.
- **`supabase/`** — one hosted Supabase project is the whole V1 backend.
  - `migrations/0001_init.sql` — tables, RLS (service-role only), atomic sequence
    allocator, activity tracking, 30-day cleanup, private screenshot bucket.
  - `functions/` — 14 Deno Edge Functions: room create/join, room state, message
    post, screenshot upload + signed URLs, connection code, agent connect/heartbeat/
    disconnect, handoff send/fetch/respond, cleanup.
  - Realtime carries only **opaque tickers** (seq numbers, presence, agent status).
    All message/screenshot content is fetched through session-authenticated Edge
    Functions, so it stays behind the password gate.
- **`apps/web`** — the browser app (Vite + React), deployable to Cloudflare Pages.
  Landing (create) → Join gate → three-pane review-workspace room (context +
  participants + agent · read-only shared plan · discussion + composer).
- **`apps/connector`** — the local `room` CLI. Connects with a one-time code,
  becomes the active agent, heartbeats the lease, relays handoffs to a local agent
  command, and streams the response back into the room timeline.

## Run locally

```sh
pnpm install                 # install all workspaces
pnpm test                    # 68 tests across shared / web / connector
pnpm typecheck               # tsc --noEmit for every workspace

# Backend (needs Docker for the local Supabase stack):
supabase start
supabase db reset            # applies migrations/0001_init.sql
supabase functions serve --env-file .env.local

# Browser app:
cp apps/web/.env.example apps/web/.env.local   # fill in URL + keys
pnpm --filter @multi-ai/web dev

# Local Pi connector (run the command the room shows under "Connect a Pi"):
FUNCTIONS_URL=http://localhost:54321/functions/v1 \
SUPABASE_URL=http://localhost:54321 \
SUPABASE_ANON_KEY=<anon-key> \
ROOM_AGENT_COMMAND='cat' \                     # or point at your agent
ROOM_AGENT_SUPPORTS_VISION=false \            # true if the model reads images
pnpm --filter @multi-ai/connector dev connect ROOM1234 ABCD-2345
```

## V1 boundaries (intentional)

- No user accounts, roles, repo syncing, or simultaneous active agents.
- Realtime broadcast is open to anyone with the room id, but carries no content —
  only opaque tickers. Reading message text or screenshots requires joining with
  the password.
- Room data and screenshots are deleted 30 days after the room's last activity.
