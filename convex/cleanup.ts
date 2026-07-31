/**
 * Hourly cleanup (issue 0004).
 *
 * Replaces the `delete_expired_rooms()` pg_cron job and the manual `cleanup`
 * Edge Function. Rooms (and all their data) are deleted after 30 days of
 * inactivity; their screenshot storage objects are deleted too, so the scheduled
 * job fully reclaims both rows and bytes.
 *
 * `deleteExpired` is an internal mutation, so it can only be invoked by the cron
 * (and other backend functions) — never directly from a client.
 */

import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { ROOM_INACTIVITY_TTL_MS } from "@multi-ai/shared";

export const deleteExpired = internalMutation({
  args: {},
  handler: async (ctx, _args): Promise<{ deleted: number }> => {
    const cutoff = Date.now() - ROOM_INACTIVITY_TTL_MS;
    const expired = await ctx.db
      .query("rooms")
      .filter((q) => q.lt(q.field("lastActivityAt"), cutoff))
      .take(100);

    for (const room of expired) {
      await deleteRoomData(ctx, room._id);
      await ctx.db.delete(room._id);
    }
    return { deleted: expired.length };
  },
});

/**
 * Deletes every row that belongs to a room plus its screenshot storage objects.
 * Mirrors the cascading deletes and storage cleanup of the old SQL function.
 */
export async function deleteRoomData(ctx: MutationCtx, roomId: Id<"rooms">): Promise<void> {
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_room_and_seq", (q) => q.eq("roomId", roomId))
    .collect();
  for (const doc of messages) await ctx.db.delete(doc._id);

  const participants = await ctx.db
    .query("participants")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  for (const doc of participants) await ctx.db.delete(doc._id);

  const connections = await ctx.db
    .query("agentConnections")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  for (const doc of connections) await ctx.db.delete(doc._id);

  const handoffs = await ctx.db
    .query("handoffs")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  for (const doc of handoffs) await ctx.db.delete(doc._id);

  const seq = await ctx.db
    .query("roomSeq")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  for (const doc of seq) await ctx.db.delete(doc._id);

  // Screenshots: delete the storage object, then the row.
  const screenshots = await ctx.db
    .query("screenshots")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  for (const shot of screenshots) {
    await ctx.storage.delete(shot.storageId);
    await ctx.db.delete(shot._id);
  }

  // Workspace documents + their version history (issue 0011). Delete child
  // rows before parent rows. Both reads are bounded — a room's documents and
  // per-doc versions are each capped — so a room with a long history can't blow
  // the mutation's transaction limit. (`documentVersions` carries no `roomId`,
  // so each document's versions are reached via the `by_document` index.)
  const MAX_DOCS_TO_DELETE = 200;
  const MAX_VERSIONS_PER_DOC = 500;
  const docs = await ctx.db
    .query("documents")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .take(MAX_DOCS_TO_DELETE);
  for (const doc of docs) {
    const versions = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .take(MAX_VERSIONS_PER_DOC);
    for (const v of versions) await ctx.db.delete(v._id);
    await ctx.db.delete(doc._id);
  }

  // Rate buckets keyed by this room (join-fail throttling). Participant-keyed
  // buckets reset to zero within a minute and are left to roll over naturally.
  const buckets = await ctx.db
    .query("rateBuckets")
    .withIndex("by_scope_and_key", (q) => q.eq("scope", "join_fail").eq("key", roomId))
    .collect();
  for (const doc of buckets) await ctx.db.delete(doc._id);
}
