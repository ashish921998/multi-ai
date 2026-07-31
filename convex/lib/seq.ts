/**
 * Per-room monotonic message sequence allocation.
 *
 * Ports the `allocate_message_seq` RPC: a read-modify-write on the room's
 * counter document. Because Convex serializes mutations with optimistic
 * concurrency control, concurrent `postMessage` / agent-response calls that
 * both read and write the same `roomSeq` doc are retried until they no longer
 * collide — so sequence numbers are allocated atomically and never reused.
 */

import type { DatabaseWriter } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Allocates and returns the next sequence number for a room, creating the
 * counter on first use. The first message in a room receives seq `1`.
 */
export async function allocateSeq(db: DatabaseWriter, roomId: Id<"rooms">): Promise<number> {
  const counter = await db
    .query("roomSeq")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .unique();

  if (!counter) {
    await db.insert("roomSeq", { roomId, nextSeq: 2 });
    return 1;
  }

  const allocated = counter.nextSeq;
  await db.patch(counter._id, { nextSeq: allocated + 1 });
  return allocated;
}
