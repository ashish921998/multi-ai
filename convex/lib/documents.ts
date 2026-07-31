/**
 * Document path validation + actor resolution for the workspace document model.
 *
 * This is the "build on" substrate: durable artifacts a room's humans and
 * active agent both read and edit in place, with every write recorded as a new
 * version. Path rules mirror the Workspaces contract (no reserved segments,
 * no traversal, known suffixes) so a workspace tree stays well-formed.
 *
 * NOTE: `validatePath` is pure and unit-tested. If agents ever need the same
 * rules client-side, lift it into `@multi-ai/shared` — for now it lives here so
 * `packages/shared` stays untouched.
 */

import type { DatabaseReader } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { fail } from "./errors";
import { getParticipant } from "./session";
import { isHealthy } from "./agent";

export type DocumentFormat = "markdown" | "html";

/** Ordered so `.markdown` is tested before `.md` (suffix greediness). */
const SUFFIX_TO_FORMAT: ReadonlyArray<[string, DocumentFormat]> = [
  [".markdown", "markdown"],
  [".md", "markdown"],
  [".html", "html"],
  [".htm", "html"],
];

export function inferFormat(path: string): DocumentFormat | null {
  const lower = path.toLowerCase();
  for (const [suffix, format] of SUFFIX_TO_FORMAT) {
    if (lower.endsWith(suffix)) return format;
  }
  return null;
}

export type PathCheck =
  | { ok: true; format: DocumentFormat }
  | { ok: false; reason: string };

const RESERVED_TOP_LEVEL = new Set(["refs"]);
const MAX_PATH_LENGTH = 512;

/**
 * Validates a workspace document path against the Workspaces contract:
 * no leading/trailing or double slashes, no `.`/`..`/`.git` segments, no
 * reserved `refs` prefix, no backslash/control/`?#%` characters, and a known
 * Markdown/HTML suffix. Returns the inferred format on success.
 */
export function validatePath(path: string): PathCheck {
  if (typeof path !== "string" || path.length === 0)
    return { ok: false, reason: "Path is required." };
  if (path.length > MAX_PATH_LENGTH)
    return { ok: false, reason: `Path is too long (max ${MAX_PATH_LENGTH} characters).` };
  if (path.startsWith("/") || path.endsWith("/"))
    return { ok: false, reason: "Path cannot start or end with '/'." };
  if (path.includes("//"))
    return { ok: false, reason: "Path cannot contain '//'." };
  if (/[\\?#%]/.test(path))
    return { ok: false, reason: "Path cannot contain '\\', '?', '#', or '%'." };
  if (/[\x00-\x1f]/.test(path))
    return { ok: false, reason: "Path cannot contain control characters." };

  const segments = path.split("/");
  for (const seg of segments) {
    if (seg === "." || seg === "..")
      return { ok: false, reason: "Path cannot contain '.' or '..' segments." };
    if (seg.toLowerCase() === ".git")
      return { ok: false, reason: "Path cannot contain a '.git' segment." };
  }
  if (RESERVED_TOP_LEVEL.has(segments[0]!.toLowerCase()))
    return { ok: false, reason: "'refs' is a reserved path." };

  const format = inferFormat(path);
  if (!format)
    return {
      ok: false,
      reason: "Path must end in .md, .markdown, .html, or .htm.",
    };
  return { ok: true, format };
}

export type Actor =
  | { kind: "participant"; actorId: Id<"participants">; displayName: string }
  | { kind: "agent"; actorId: Id<"agentConnections"> };

/**
 * Resolves who is acting on the workspace. An agent proves it holds the room's
 * active, healthy lease (`agentConnectionId`); a participant proves it with a
 * session token. Either can read and write documents — they are equal
 * collaborators on the artifact. Throws `ConvexError` on any auth failure.
 */
export async function resolveActor(
  db: DatabaseReader,
  room: Doc<"rooms">,
  auth: {
    sessionToken?: string | null;
    agentConnectionId?: Id<"agentConnections"> | null;
  },
): Promise<Actor> {
  if (auth.agentConnectionId) {
    if (room.activeAgentConnectionId !== auth.agentConnectionId)
      fail("This agent connection is no longer active for the room.");
    const conn = await db.get(auth.agentConnectionId);
    if (!conn || conn.status !== "active" || !isHealthy(conn))
      fail("This agent connection is no longer active.");
    return { kind: "agent", actorId: auth.agentConnectionId };
  }
  if (auth.sessionToken) {
    const participant = await getParticipant(db, room._id, auth.sessionToken);
    if (!participant) fail("Invalid or expired session. Rejoin the room.");
    return {
      kind: "participant",
      actorId: participant.participantId,
      displayName: participant.displayName,
    };
  }
  fail("Not authenticated. Join the room or connect an agent.");
}
