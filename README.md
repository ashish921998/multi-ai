# Multiplayer AI Planning Room

A lightweight V1 where people join a room with a link + password, discuss a coding
requirement with text and screenshots, and hand the new discussion to one local Pi
agent that responds as a planning-focused coding agent. No accounts, no tunnels, no
hosted repositories — Pi stays local and connects outward to a cloud relay.

This implements the spec in [`docs/v1-room-backend-handoff.md`](./docs/v1-room-backend-handoff.md)
and the closed design decisions in [`issues/`](./issues/) (0001–0010).

## Architecture

```
Browsers ──reactive query──> Convex cloud <──outbound── Pi connector (local)
                                  │
                          documents · file storage · functions · cron
```

- **`packages/shared`** — the cross-runtime contract (types + pure logic). Imported
  unchanged by the browser app, the connector, and the Convex functions. This is the
  heavily unit-tested seam: handoff batching, the active-agent lease, rate limits,
  password/code hashing, screenshot limits.
- **`convex/`** — the whole V1 backend is one Convex deployment.
  - `schema.ts` — tables, indexes, and the two single-document serialization points
    (`rooms.activeAgentConnectionId`, `rooms.activeHandoffId`) that replace the old
    SQL partial unique indexes for "one active agent" and "one handoff in flight".
  - `rooms.ts`, `messages.ts`, `screenshots.ts`, `connectCode.ts`, `agent.ts`,
    `handoff.ts` — the queries/mutations ported from the 14 Edge Functions.
  - `crons.ts` — the hourly `cleanup:deleteExpired` job (replaces `pg_cron`).
  - `lib/` — pure helpers (session validation, rate limiting, sequence allocation,
    lease reaping, handoff envelope construction) imported by the functions.
  - `api.ts` + `_generated/` — a hand-maintained client API tree and the schema-aware
    builder shims (`npx convex dev` regenerates `_generated/` identically).
- **`apps/web`** — the browser app (Vite + React), deployable to Cloudflare Pages.
  Landing (create) → Join gate → three-pane review-workspace room (context +
  participants + agent · read-only shared plan · discussion + composer). **One
  reactive `useQuery(api.rooms.state)` subscription drives the whole room** — the
  opaque-ticker + fetch-on-tick realtime layer is gone (issue 0004).
- **`apps/connector`** — the local `room` CLI. Connects with a one-time code,
  becomes the active agent, heartbeats the lease, **reactively subscribes to
  `agent.pendingHandoff`** for handoffs, and streams the response back into the
  room timeline.

## Run locally

```sh
pnpm install                 # install all workspaces
pnpm test                    # 79 tests across shared / web / connector / convex
pnpm typecheck               # tsc --noEmit for every workspace + the convex backend

# Backend (needs a Convex account + project — the agent cannot provision this):
npx convex dev               # log in, create a deployment, generate convex/_generated
                            # and print the deployment URL

# Browser app:
cp apps/web/.env.example apps/web/.env.local   # set VITE_CONVEX_URL to the deployment URL
pnpm --filter @multi-ai/web dev

# Local Pi connector (run the command the room shows under "Connect a Pi"):
CONVEX_URL=https://your-deployment.convex.cloud \
ROOM_AGENT_COMMAND='cat' \                      # or point at your agent
ROOM_AGENT_SUPPORTS_VISION=false \             # true if the model reads images
pnpm --filter @multi-ai/connector dev connect ROOM1234 ABCD-2345
```

> **Note on the local stack.** This host has no Docker, so neither the old Supabase
> local stack nor a self-hosted Convex backend can run here. The practical path is a
> free Convex Cloud deployment via `npx convex dev` (interactive login). All code is
> written and typechecked against the schema before deploy.

## V1 boundaries (intentional)

- No user accounts, roles, repo syncing, or simultaneous active agents.
- Reading message text or screenshots requires joining with the password; the
  `rooms.state` query validates the session token in-function before returning any
  content.
- Room data and screenshots are deleted 30 days after the room's last activity.

## Hardening notes

- **One active agent per room** is enforced at the document level: a connect writes
  the same `rooms.activeAgentConnectionId` field, so two concurrent connects conflict
  under Convex optimistic concurrency and only one wins (replaces the old
  `one_active_agent_per_room` partial unique index).
- **One handoff in flight per room** uses `rooms.activeHandoffId` the same way.
- **One-time connection codes.** A code is consumed the instant it activates
  (`agentConnections.consumedAt`); the consume happens inside the same serialized
  mutation that claims the slot, so a concurrent redeem retries and is rejected.
- **Scheduled cleanup.** `crons.ts` runs `cleanup:deleteExpired` hourly at :03 UTC,
  deleting expired rooms' rows **and** their screenshot storage objects.
- **Vision images reach the agent.** When `ROOM_AGENT_SUPPORTS_VISION=true`, the
  connector resolves a viewable URL per handoff screenshot and downloads it to a
  temp file for the local agent; non-vision agents get a text-only handoff with a
  limitation note, and the room shows a warning banner.
- **Rate limits (issue 0007).** Message and connection-code limits are keyed per
  participant; failed-password attempts are keyed per room (Convex does not expose
  the caller IP without Convex Auth, so per-IP room-creation limiting is not
  available — a documented adaptation of the original per-IP intent).

## What changed in the Supabase → Convex migration

The V1 boundaries, the shared contract (`packages/shared`), the browser UI, and the
connector's responder logic are **unchanged**. What was rewritten:

| Supabase artifact | Convex replacement |
|---|---|
| 14 Edge Functions | queries/mutations in `convex/` |
| `0001–0004` migrations + RLS + `pg_cron` | `convex/schema.ts` + `convex/crons.ts` |
| Realtime opaque-ticker + fetch-on-tick | one reactive `useQuery(api.rooms.state)` |
| Supabase Storage bucket + signed URLs | Convex file storage + `screenshots.getUrl` |
| Partial unique indexes + `23505` catching | serialized in-mutation checks (Convex OCC) |
| `allocate_message_seq` RPC | per-room counter doc, read-modify-write in `allocateSeq` |
| `reap_stale_agent` RPC | reaping inside mutations + the `state` query computes health |
| `apps/web/src/api.ts`, `useRoom.ts`, `session.ts`, `realtime.ts` | Convex client (`useQuery`/`useMutation`) |
| `apps/connector/src/roomClient.ts` (HTTP poll loop) | reactive `ConvexClient.onUpdate` subscription |

`packages/shared/` is imported unchanged by the Convex functions — no more
`.ts`-extension / Deno wrangling.
