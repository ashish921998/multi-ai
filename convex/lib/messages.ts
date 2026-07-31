/**
 * Loads the screenshots and participants that accompany a batch of messages.
 *
 * Centralizes the join that `handoff.send`, `handoff.fetch`, and `rooms.state`
 * all need, so it lives in exactly one place. Screenshots are queried through
 * the room index (bounded to one room) — never a full-table scan — and filtered
 * to the given messages.
 */

import type { DatabaseReader } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export interface MessageContext {
  screenshots: Doc<"screenshots">[];
  participants: Doc<"participants">[];
}

export async function loadMessageContext(
  db: DatabaseReader,
  roomId: Id<"rooms">,
  rows: Doc<"messages">[],
): Promise<MessageContext> {
  const messageIds = new Set(rows.map((m) => m._id));
  if (messageIds.size === 0) {
    const participants = await db
      .query("participants")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    return { screenshots: [], participants };
  }

  const [allShots, participants] = await Promise.all([
    db
      .query("screenshots")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect(),
    db
      .query("participants")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect(),
  ]);

  return {
    screenshots: allShots.filter((s) => s.messageId && messageIds.has(s.messageId)),
    participants,
  };
}
