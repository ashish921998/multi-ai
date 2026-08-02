# Multi-AI Planning Room

A temporary space where a team and **one local coding agent** turn a discussion into a plan.

People join a room with a link and password, discuss a coding requirement with text and
screenshots, and hand the new discussion to Codex, Claude Code, Cursor, OpenCode, Pi, or
a custom local command. **No accounts, no tunnels, no hosted repositories**—the agent
stays on the participant's laptop and connects outward to a cloud relay.

> Implements the spec in [`docs/v1-room-backend-handoff.md`](./docs/v1-room-backend-handoff.md)
> and the closed design decisions in [`issues/`](./issues/) (0001–0010).

## Live

| | URL |
|---|---|
| 🌐 Web app | <https://multi-ai-egg.pages.dev> |
| ⚙️ Backend | `https://nautical-ermine-841.convex.cloud` (Convex) |

Open the web app → **Create room** → share the link and password → choose a harness
under **Connect an agent** and run the generated command.

## Architecture

```text
Browsers ──reactive query──▶ Convex cloud ◀──outbound── agent connector (local laptop)
                                  │
                     documents · file storage · functions · cron
```

- **`packages/shared`** — the cross-runtime contract (types + pure logic). Imported
  unchanged by the browser app, the connector, and the Convex functions. The heavily
  unit-tested seam: handoff batching, the active-agent lease, rate limits,
  password/code hashing, screenshot limits.
- **`convex/`** — the whole V1 backend is one Convex deployment.
  - `schema.ts` — tables, indexes, and the two single-document serialization points
    (`rooms.activeAgentConnectionId`, `rooms.activeHandoffId`) that replace the old
    SQL partial unique indexes for "one active agent" and "one handoff in flight".
  - `rooms.ts`, `messages.ts`, `screenshots.ts`, `connectCode.ts`, `agent.ts`,
    `handoff.ts` — queries/mutations.
  - `crons.ts` — the hourly `cleanup:deleteExpired` job (replaces `pg_cron`).
  - `lib/` — pure helpers (session validation, rate limiting, sequence allocation,
    lease reaping, handoff envelope construction) shared by the functions.
  - `api.ts` — re-exports the codegen client API tree (browser-safe function
    references); `_generated/` is produced by `npx convex dev`.
- **`apps/web`** — the browser app (Vite + React), deployed to Cloudflare Pages.
  Landing (create) → Join gate → collaborative workspace room. Participants and
  the connected agent edit the same versioned Markdown/HTML documents with optimistic
  concurrency, history, compare, and restore. **One reactive
  `useQuery(api.rooms.state)` subscription drives the room summary** — no polling;
  the selected document body and history are loaded lazily.
- **`apps/connector`** — the local `room` CLI. Connects with a one-time code, becomes
  the active agent, heartbeats the lease, **reactively subscribes to
  `agent.pendingHandoff`**, and streams the response back into the room timeline.
  It gives the agent the current `plan.md` and writes only against the version it read,
  so a concurrent participant edit is never silently overwritten.

```text
.
├── packages/shared/   # runtime-agnostic contract (DO NOT depend on Convex here)
├── convex/            # backend: schema, functions, lib helpers, tests
├── apps/web/          # Vite + React SPA → Cloudflare Pages
├── apps/connector/    # `room` CLI → Pi / Codex / Claude / Cursor / OpenCode / custom
└── docs/, issues/     # spec + closed design decisions
```

## Quick start (local dev)

```sh
pnpm install
pnpm test          # tests across shared / web / connector / convex
pnpm typecheck     # tsc --noEmit for every workspace + the convex backend
```

### 1. Backend — Convex

```sh
npx convex dev     # log in, create a deployment, generate convex/_generated,
                   # and print the deployment URL
```

This writes `.env.local` (`CONVEX_URL=…`) and generates `convex/_generated/`.

### 2. Browser app

```sh
cp apps/web/.env.example apps/web/.env.local   # set VITE_CONVEX_URL
pnpm --filter @multi-ai/web dev
```

### 3. Local agent connector

In the room UI, choose **Connect an agent**, select the harness, and run the displayed
command beside the repository:

```sh
CONVEX_URL=https://your-deployment.convex.cloud \
pnpm --filter @multi-ai/connector dev connect ROOM1234 ABCD-2345 --agent codex
```

Built-in harness names are `pi`, `codex`, `claude`, `cursor`, and `opencode`. Each uses
the harness's non-interactive plain-text mode and receives the room prompt on stdin; Codex
and Claude Code run in their read-only planning modes, and Cursor runs sandboxed. To
integrate another executable, pass fixed arguments separately:

```sh
CONVEX_URL=https://your-deployment.convex.cloud \
pnpm --filter @multi-ai/connector dev connect ROOM1234 ABCD-2345 \
  --agent custom --command ./my-agent --arg run --arg=--plain
```

The legacy `ROOM_AGENT_COMMAND` setting is a literal executable path, not a shell
command; put its arguments in `ROOM_AGENT_ARGS` as a JSON string array.

The connector terminates descendants in the custom harness's process tree/group when
the harness exits or the connector stops. Do not launch intentionally persistent
helpers: development servers, language servers, and similar child processes will also
be terminated. A process that deliberately detaches into a separate OS session may
escape cleanup; the connector stops waiting on its inherited stdout after the harness
exits, and custom harnesses should not detach persistent processes.

On SIGINT/SIGTERM, the connector gives an active handoff 5 seconds to record its final
status before forcing disconnect. Configure this shutdown-only bound with
`--shutdown-drain-timeout-ms=<milliseconds>` or
`ROOM_AGENT_SHUTDOWN_DRAIN_TIMEOUT_MS`; it does not limit normal harness runtime.

Add `--supports-vision` when the selected model can read the temporary image paths in
the handoff. The connector stays reactive and updates `plan.md` only if the version
the agent read is still current. Conflicts preserve the participant's edit and keep
the streamed response in the discussion timeline.

## Deploy

### Backend → Convex

```sh
npx convex deploy          # push functions to your production deployment
npx convex env set APP_BASE_URL https://your-app.pages.dev   # so invite links are correct
```

### Frontend → Cloudflare Pages

The app is a static Vite build with SPA routing (`apps/web/public/_redirects`
handles client-side route fallback).

```sh
pnpm --filter @multi-ai/web build
npx wrangler pages deploy apps/web/dist --project-name multi-ai
```

Then set `VITE_CONVEX_URL` to your deployment URL at build time
(`apps/web/.env.local` for local builds, or the Pages dashboard for CI).

## V1 boundaries (intentional)

- No user accounts, roles, repo syncing, or simultaneous active agents.
- Reading message text or screenshots requires joining with the password; the
  `rooms.state` query validates the session token in-function before returning content.
- Room data and screenshots are deleted **30 days** after the room's last activity.

## Hardening notes

- **One active agent per room** — a connect writes the same `rooms.activeAgentConnectionId`,
  so two concurrent connects conflict under Convex optimistic concurrency and only one wins.
- **One handoff in flight per room** — uses `rooms.activeHandoffId` the same way.
- **One-time connection codes** — consumed the instant it activates
  (`agentConnections.consumedAt`), inside the same serialized mutation that claims the
  slot, so a concurrent redeem retries and is rejected.
- **Scheduled cleanup** — `crons.ts` runs `cleanup:deleteExpired` hourly, deleting
  expired rooms' rows **and** their screenshot storage objects.
- **Vision images reach the agent** — when `ROOM_AGENT_SUPPORTS_VISION=true`, the
  connector resolves a viewable URL per handoff screenshot and downloads it to a temp
  file; non-vision agents get a text-only handoff with a limitation note.
- **Rate limits** — message and connection-code limits are keyed per participant;
  failed-password attempts are keyed per room (Convex does not expose caller IP, so
  per-IP room-creation limiting is a documented adaptation).

## Supabase → Convex migration

The V1 boundaries, the shared contract, the browser UI, and the connector's responder
logic are **unchanged**. What was rewritten:

| Supabase artifact | Convex replacement |
|---|---|
| 14 Edge Functions | queries/mutations in `convex/` |
| `0001–0004` migrations + RLS + `pg_cron` | `convex/schema.ts` + `convex/crons.ts` |
| Realtime opaque-ticker + fetch-on-tick | one reactive `useQuery(api.rooms.state)` |
| Supabase Storage bucket + signed URLs | Convex file storage + `screenshots.getUrl` |
| Partial unique indexes + `23505` catching | serialized in-mutation checks (Convex OCC) |
| `allocate_message_seq` RPC | per-room counter doc, read-modify-write in `allocateSeq` |
| `apps/web` HTTP client + realtime layer | Convex client (`useQuery`/`useMutation`) |
| `apps/connector` HTTP poll loop | reactive `ConvexClient.onUpdate` subscription |

`packages/shared/` is imported unchanged by the Convex functions.

## License

Private project.
