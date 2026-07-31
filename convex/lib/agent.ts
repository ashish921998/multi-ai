/**
 * Active-agent lease enforcement (issues 0002, 0006).
 *
 * The room document is the source of truth for "who holds the active slot"
 * (`activeAgentConnectionId`). A connection holds a healthy lease while it is
 * marked active and its last heartbeat is within the timeout. The pure lease
 * math lives in @multi-ai/shared (`evaluateLease`); here we apply it to the
 * stored connection and, when stale, release the slot so a new Pi may connect.
 */

import type { DatabaseReader, DatabaseWriter } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { evaluateLease } from "@multi-ai/shared";

/** The connection currently holding the room's active slot, or null. */
export async function findHolder(
  db: DatabaseReader,
  room: Doc<"rooms">,
): Promise<Doc<"agentConnections"> | null> {
  if (!room.activeAgentConnectionId) return null;
  const conn = await db.get(room.activeAgentConnectionId);
  // A holder that was already marked disconnected should not block new connects.
  if (!conn || conn.status === "disconnected") return null;
  return conn;
}

/** Whether a holder currently holds a *healthy* (non-timed-out) lease. */
export function isHealthy(
  holder: Doc<"agentConnections">,
  now: number = Date.now(),
): boolean {
  return evaluateLease(toLeaseConnection(holder), now).isActive;
}

/**
 * Releases the active slot if the current holder has missed its heartbeats.
 * Returns whether a stale holder was reaped. Call this before any slot decision
 * (connect, send-handoff) so a timed-out Pi does not block the room.
 */
export async function reapStaleHolder(
  db: DatabaseWriter,
  room: Doc<"rooms">,
  now: number = Date.now(),
): Promise<boolean> {
  const holder = await findHolder(db, room);
  if (!holder) return false;
  if (isHealthy(holder, now)) return false;

  await db.patch(holder._id, {
    status: "disconnected",
    releasedAt: now,
  });
  await db.patch(room._id, { activeAgentConnectionId: undefined });
  return true;
}

/** Maps a stored connection doc to the @multi-ai/shared lease shape. */
function toLeaseConnection(conn: Doc<"agentConnections">) {
  return {
    id: conn._id,
    roomId: conn.roomId,
    participantId: conn.participantId,
    connectionCode: "",
    status: conn.status,
    lastHeartbeatAt: conn.lastHeartbeatAt,
    createdAt: conn.createdAt,
    releasedAt: conn.releasedAt ?? null,
  };
}
