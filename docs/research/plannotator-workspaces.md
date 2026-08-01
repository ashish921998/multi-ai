# Plannotator Workspaces — reference & gap analysis

> Research target: <https://help.plannotator.ai/workspaces> (43 docs, read in full).
> The user stated: *"this is what I was trying to create."* This file records what
> that product actually is, and the gap at the time of the original room build.
>
> **Implementation update:** the hybrid path in section 3 is now shipped. Rooms
> have participant-and-agent editable Markdown/HTML documents, optimistic
> concurrency, version history, compare/restore, Markdown preview, and a connector
> that reads and safely builds on `plan.md`. Accounts, MCP/API keys, comments,
> artifacts, permanent ownership, and multi-agent access remain outside room V1.

## 1. What Plannotator Workspaces IS

A **document-centric collaborative workspace** where the persistent artifact is a set
of **versioned Markdown / HTML files** organized by path:

```
plan.md
specs/api.md
decisions/0001-auth.md
diagrams/system.html
wireframes/onboarding.html
```

Humans **and agents** are both **first-class collaborative editors** of those documents.
A "plan" is not a chat message — it is a living document with version history, anchored
comments, and a raw-file identity.

### Core capabilities

| Area | What it does |
|---|---|
| **Documents** | Markdown + HTML files in a path-derived folder tree; 1.5 MiB doc bodies; 50 live connections/doc |
| **Live editing** | Multi-cursor Markdown editing, presence (avatars + pointers), automatic save points (2s), LF-only live edit, CRLF→LF convert |
| **Comments** | Anchored (text-selected) + global comments, one-level replies, resolve/reopen, guest names, **agent labels ("on behalf of")** |
| **Versions** | Every save point is history; open pinned version, compare-with-live (Markdown), restore-as-new-version, frozen raw URLs (`@<version>`) |
| **Artifacts** | Gallery of uploaded files (PNG/PDF/MP4/JSON/CSS/ZIP/JS…), 100 MiB each, versioned, sandboxed HTML preview, 1–100 GiB quota |
| **Fork** | Copy one document + its referenced assets into a new workspace (no comments/history) |

### Access model (grants ADD together)

- **Visibility**: Only you / Your organization / Anyone-link-view / Anyone-link-view-**and-edit** (`public`/`open`)
- **Guest links**: secret `?share=` tokens, view or edit, revocable, shown once
- **Accounts**: WorkOS (hosted) or OIDC / Cloudflare Access (self-hosted); secure cookies + CSRF
- **API keys** (`wsk_live_…`): SHA-256-hashed, act as the **owner**, separate key per tool, revocable

### How AGENTS connect (the key differentiator)

Agents are **collaborators with credentials**, not request/responders. Three equal paths:

1. **MCP** — `POST /mcp` (Streamable HTTP) + Bearer API key. Tools:
   `list_workspaces`, `list_documents`, `read_document`, `create_document`,
   `update_document`, `list_versions`, `restore_version`, `list_annotations`,
   `create_annotation`, `create_reply`, `resolve_annotation`, `publish_artifact`,
   `list_artifacts`, `get_artifact`, `list_artifact_versions`.
2. **HTTP API** — `/v1/openapi.yaml`, Bearer key, `If-Match: <version>` optimistic concurrency, full error set (400/401/403/404/409/410/412/413/422/429).
3. **Read-only Git** — `git clone https://host/git/<ws-id>.git`, API key as password, each save point = a commit, `push` rejected.

→ **No "handoff".** The agent reads/writes the same documents as humans, on its own
schedule, using the same version + comment system. Any number of agents, each with its
own key. The agent identity is a real account (the key owner).

### Persistence & lifecycle

- **Anonymous workspace**: 30-day expiry, refreshed by app/API/MCP/live activity (raw/Git reads do NOT refresh); **claim** before expiry to make it owned + permanent.
- **Owned workspace**: permanent, owner-controlled deletion, version history retained.

### Self-hosting (two equal paths)

- **Container**: one Node Docker image, local block-storage volume, OIDC, port 8790.
- **Cloudflare**: app Worker (Access-protected browser + public API origin) + cookieless usercontent Worker for raw links; backed by D1 + KV + R2 + Artifacts + Durable Objects.
- One org per self-hosted instance; no hosted team/billing UI.

### Plans

Free ($0, personal + link sharing) · Organization ($10/seat/mo or $102/yr) · Self-Hosted (quote). 14-day org trial, seats = active members.

## 2. The gap: what we built vs. what this is

| Dimension | **Plannotator Workspaces** (intent) | **Our Multi-AI Room** (built) |
|---|---|---|
| Core artifact | **Versioned documents** (plan.md, specs/, decisions/) | **Chat timeline** (messages + screenshots) |
| What "the plan" is | A living document, edited over time | A single agent message produced once |
| Agent role | **First-class document editor** (reads/writes/comments/versions) | **Transient responder** to a one-shot handoff |
| Agent connection | **API key → MCP / HTTP / Git** (pull, stateless, many agents) | **One-time code → reactive handoff** (push, stateful, **one** agent) |
| Agent identity | Real account (key owner) | Anonymous, ephemeral, local CLI |
| Collaboration | Live multi-cursor edit, presence, anchored comment threads, compare/restore | Linear chat + screenshots |
| Access | Accounts + orgs + API keys + guest links + visibility levels | Password-join, no accounts |
| Persistence | Permanent (claimed) or 30-day (anon), **versioned**, forkable | 30-day ephemeral, no versions |
| Multi-agent | Unlimited | One active agent (lease) |

### The blunt version

Our build is **not** Workspaces. By Plannotator's own product map, what we built maps
to a *different* Plannotator product — **"Open-source Plannotator: private feedback
returned to one active coding-agent session."** Workspaces is explicitly *"shared plans
or technical documents that several people or agents need to read and change."*

We built a **chat room with a handoff responder**. Workspaces is a **collaborative
document editor where agents are teammates with API keys.** The center of gravity is
different: **documents vs. messages**, **edit-vs-read vs. ask-vs-respond**.

## 3. The strategic fork

1. **Pivot to the Workspaces model** — documents as the core artifact, agents-as-editors
   via API-key + MCP, version history, comments, fork. This is a large rebuild: it's a
   different product. Closest single change that captures the spirit: make the "plan" a
   **persistent Markdown document** the agent edits (not a chat message), and expose an
   **MCP endpoint** keyed per-workspace so any agent can read/write it.
2. **Keep our model, reposition** — we're genuinely a good fit for the "private feedback
   to one local agent" niche (Plannotator's open-source product). Lean into that: local
   Pi, relay-only cloud, no accounts. Don't chase Workspaces.
3. **Hybrid (incremental path to 1)** — keep the room + handoff, but add a persistent
   Markdown "plan document" to each room that the agent *edits* (not overwrites) across
   handoffs, with simple version history. Lowest-risk way to move toward the Workspaces
   feel without a rewrite.

## 4. Source pages read (43)

Start: overview, share-your-first-plan, create-and-organize-a-workspace,
review-plans-and-technical-decisions · Accounts: sign-in/out, personal-vs-org,
create-org, manage-members · Sharing: who-can-access, share-a-workspace,
manage-guest-links, copy-a-raw-link, fork-a-document · Documents: files-and-folders,
edit-together, comments-and-replies, versions-and-restore, artifacts,
file-types-and-limits · Agents: api-keys, api, mcp, git · Billing: plans-trials-seats,
after-a-trial-ends, manage-a-subscription, priority-support · Self-hosting: overview,
container install/configure/backup/update, cloudflare deploy/configure-access/update,
troubleshoot · Security: access-and-sessions, active-content, retention-and-deletion ·
Troubleshooting: sign-in, access-and-sharing, live-collaboration, api-mcp-git, billing.
