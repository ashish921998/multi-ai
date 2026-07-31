/**
 * Room lookups and activity tracking.
 *
 * The public "room id" is the human `code` in the `/r/:code` URL; internally we
 * always resolve it to the Convex room document (and its `_id`). Activity is
 * bumped on joins, posts, and handoffs so the 30-day inactivity expiry (issue
 * 0004) stays accurate.
 */

import type { DatabaseReader, DatabaseWriter } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/** Resolves a room by its human code, or null when it does not exist. */
export async function lookupRoomByCode(
  db: DatabaseReader,
  code: string,
): Promise<Doc<"rooms"> | null> {
  return db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", code.toUpperCase()))
    .unique();
}

/** Bumps the room's `lastActivityAt`, used for the 30-day expiry. */
export async function touchActivity(db: DatabaseWriter, roomId: Id<"rooms">): Promise<void> {
  await db.patch(roomId, { lastActivityAt: Date.now() });
}
