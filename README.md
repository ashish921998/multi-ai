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
pnpm test                    # 72 tests across shared / web / connector
pnpm typecheck               # tsc --noEmit for every workspace

# Backend (needs Docker for the local Supabase stack):
supabase start
supabase db reset            # applies migrations 0001–0003
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

## Hardening notes

- **One-time connection codes.** A Pi connection code is consumed the instant it
  activates (`agent_connections.consumed_at`); reuse returns `410`. After a Pi
  disconnects, reconnecting requires a fresh code from the room.
- **One handoff in flight per room** is enforced at the database level
  (`one_active_handoff_per_room` partial unique index), so two simultaneous
  "Send to agent" clicks cannot both start.
- **Scheduled cleanup.** `pg_cron` runs `delete_expired_rooms()` hourly at :03,
  which deletes expired rooms' rows **and** their screenshot storage objects.
  The `cleanup` Edge Function is kept for manual runs.
- **Vision images reach the agent.** When `ROOM_AGENT_SUPPORTS_VISION=true`, the
  connector downloads each handoff screenshot to a temp file and appends its
  path to the agent command's stdin; non-vision agents get a text-only handoff
  with a limitation note, and the room shows a warning banner.
- **Dependencies.** `react-router-dom` is pinned to `^7.18.2`, which patches the
  advisories present in 6.30.4. The lone residual `react-router` advisory
  (GHSA-qwww-vcr4-c8h2, RSC CSRF) requires React Server Components / data-router
  server actions — this client-only app uses neither, and its fix
  (`react-router@8.3.0`) requires React 19. Other `pnpm audit` findings
  (vite/vitest/esbuild) are dev-only and not in the shipped bundle.
