/**
 * Workspace documents — the "build on" substrate.
 *
 * A room (workspace) holds durable Markdown/HTML documents organized by path.
 * Both joined participants and the room's active agent read and edit them in
 * place; every edit is a new version. This is the inversion from the chat
 * model: the plan is a document that accumulates, not a message that scrolls
 * away.
 *
 * The surface mirrors the Workspaces MCP tool set — `list`, `read`, `create`,
 * `update`, `history`, `restore` — with `expectedVersion` optimistic
 * concurrency on writes (the "If-Match" equivalent) so concurrent edits never
 * silently clobber. Restore re-writes an older body as a NEW latest version,
 * preserving history (it never rewrites it).
 *
 * Auth: an agent passes its `agentConnectionId` (must be the room's active,
 * healthy holder); a participant passes its `sessionToken`. Both are equal
 * collaborators — see `resolveActor`.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { fail } from "./lib/errors";
import { lookupRoomByCode, touchActivity } from "./lib/room";
import { validatePath, resolveActor, resolveWriter, type Actor } from "./lib/documents";

/** 1.5 MiB — matches the Workspaces document-body limit. */
const MAX_BODY = 1_572_864;

const authArgs = {
  sessionToken: v.optional(v.string()),
  agentConnectionId: v.optional(v.id("agentConnections")),
};

function authorOf(actor: Actor): { lastAuthorId: string; lastAuthorKind: "participant" | "agent" } {
  return { lastAuthorId: actor.actorId, lastAuthorKind: actor.kind };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Lists every document in the workspace (path order), without bodies. */
export const list = query({
  args: { roomId: v.string(), ...authArgs },
  handler: async (ctx, args) => {
    const room = await lookupRoomByCode(ctx.db, args.roomId.trim().toUpperCase());
    if (!room) fail("Room not found.");
    await resolveActor(ctx.db, room, args);

    const docs = await ctx.db
      .query("documents")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    return docs
      .map((d) => ({
        id: d._id,
        path: d.path,
        format: d.format,
        version: d.version,
        updatedAt: d.updatedAt,
        lastAuthorKind: d.lastAuthorKind,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  },
});

/** Returns the current body + version of one document. */
export const read = query({
  args: { roomId: v.string(), documentId: v.id("documents"), ...authArgs },
  handler: async (ctx, args) => {
    const room = await lookupRoomByCode(ctx.db, args.roomId.trim().toUpperCase());
    if (!room) fail("Room not found.");
    await resolveActor(ctx.db, room, args);

    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.roomId !== room._id) fail("Document not found.");
    return {
      id: doc._id,
      path: doc.path,
      body: doc.body,
      format: doc.format,
      version: doc.version,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      lastAuthorKind: doc.lastAuthorKind,
    };
  },
});

/** Lists a document's save points, newest first (no bodies). */
export const history = query({
  args: { roomId: v.string(), documentId: v.id("documents"), ...authArgs },
  handler: async (ctx, args) => {
    const room = await lookupRoomByCode(ctx.db, args.roomId.trim().toUpperCase());
    if (!room) fail("Room not found.");
    await resolveActor(ctx.db, room, args);

    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.roomId !== room._id) fail("Document not found.");

    const versions = await ctx.db
      .query("documentVersions")
      .withIndex("by_document_and_version", (q) => q.eq("documentId", doc._id))
      .collect();
    return versions
      .map((vRow) => ({
        version: vRow.version,
        authorKind: vRow.authorKind,
        summary: vRow.summary,
        createdAt: vRow.createdAt,
      }))
      .sort((a, b) => b.version - a.version);
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Creates a document at a full path. Format is inferred from the suffix. Path
 * uniqueness per room is enforced by lookup + OCC (a racing create lands first
 * and the second sees it). v1 is recorded as the first save point.
 */
export const create = mutation({
  args: {
    roomId: v.string(),
    path: v.string(),
    body: v.string(),
    summary: v.optional(v.string()),
    ...authArgs,
  },
  handler: async (ctx, args) => {
    const path = args.path.trim();
    const check = validatePath(path);
    if (!check.ok) fail(check.reason);
    if (args.body.length > MAX_BODY) fail(`Document body must be ${MAX_BODY} bytes or fewer.`);

    const room = await lookupRoomByCode(ctx.db, args.roomId.trim().toUpperCase());
    if (!room) fail("Room not found.");
    const actor = await resolveWriter(ctx.db, room, args);

    const existing = await ctx.db
      .query("documents")
      .withIndex("by_room_and_path", (q) => q.eq("roomId", room._id).eq("path", path))
      .unique();
    if (existing) fail(`A document already exists at "${path}".`);

    const now = Date.now();
    const id = await ctx.db.insert("documents", {
      roomId: room._id,
      path,
      body: args.body,
      format: check.format,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...authorOf(actor),
    });
    await ctx.db.insert("documentVersions", {
      documentId: id,
      version: 1,
      body: args.body,
      authorId: actor.actorId,
      authorKind: actor.kind,
      summary: args.summary ?? "Created",
      createdAt: now,
    });
    await touchActivity(ctx.db, room._id);
    return { id, path, version: 1, format: check.format };
  },
});

/**
 * Updates a document's body. `expectedVersion` must match the current version
 * or the write is rejected with a "read latest and retry" error — the
 * optimistic-concurrency guarantee that lets a human and an agent edit the same
 * document without one silently overwriting the other. Each update is a new
 * version + a new save point.
 */
export const update = mutation({
  args: {
    roomId: v.string(),
    documentId: v.id("documents"),
    body: v.string(),
    expectedVersion: v.float64(),
    summary: v.optional(v.string()),
    ...authArgs,
  },
  handler: async (ctx, args) => {
    if (args.body.length > MAX_BODY) fail(`Document body must be ${MAX_BODY} bytes or fewer.`);

    const room = await lookupRoomByCode(ctx.db, args.roomId.trim().toUpperCase());
    if (!room) fail("Room not found.");
    const actor = await resolveWriter(ctx.db, room, args);

    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.roomId !== room._id) fail("Document not found.");

    if (doc.version !== args.expectedVersion) {
      fail(
        `Document changed since you last read it (yours v${args.expectedVersion}, now v${doc.version}). Read the latest and retry.`,
      );
    }

    const nextVersion = doc.version + 1;
    const now = Date.now();
    await ctx.db.patch(doc._id, {
      body: args.body,
      version: nextVersion,
      updatedAt: now,
      ...authorOf(actor),
    });
    await ctx.db.insert("documentVersions", {
      documentId: doc._id,
      version: nextVersion,
      body: args.body,
      authorId: actor.actorId,
      authorKind: actor.kind,
      ...(args.summary !== undefined ? { summary: args.summary } : {}),
      createdAt: now,
    });
    await touchActivity(ctx.db, room._id);
    return { id: doc._id, version: nextVersion };
  },
});

/**
 * Restores an earlier version by writing its body as a NEW latest version.
 * History is never rewritten — the restore itself becomes the newest save point,
 * so the "build on" trail stays intact and reversible.
 */
export const restore = mutation({
  args: {
    roomId: v.string(),
    documentId: v.id("documents"),
    /** The version whose body to restore. */
    version: v.float64(),
    /** The version the caller believes is current (OCC guard). */
    expectedVersion: v.float64(),
    ...authArgs,
  },
  handler: async (ctx, args) => {
    const room = await lookupRoomByCode(ctx.db, args.roomId.trim().toUpperCase());
    if (!room) fail("Room not found.");
    const actor = await resolveWriter(ctx.db, room, args);

    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.roomId !== room._id) fail("Document not found.");
    if (doc.version !== args.expectedVersion) {
      fail(
        `Document changed since you last read it (yours v${args.expectedVersion}, now v${doc.version}). Read the latest and retry.`,
      );
    }

    const target = await ctx.db
      .query("documentVersions")
      .withIndex("by_document_and_version", (q) =>
        q.eq("documentId", doc._id).eq("version", args.version),
      )
      .unique();
    if (!target) fail(`Version ${args.version} not found.`);

    const nextVersion = doc.version + 1;
    const now = Date.now();
    await ctx.db.patch(doc._id, {
      body: target.body,
      version: nextVersion,
      updatedAt: now,
      ...authorOf(actor),
    });
    await ctx.db.insert("documentVersions", {
      documentId: doc._id,
      version: nextVersion,
      body: target.body,
      authorId: actor.actorId,
      authorKind: actor.kind,
      summary: `Restored v${args.version}`,
      createdAt: now,
    });
    await touchActivity(ctx.db, room._id);
    return { id: doc._id, version: nextVersion };
  },
});
