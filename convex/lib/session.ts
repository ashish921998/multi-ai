/**
 * Session validation.
 *
 * The browser holds only the opaque session token returned by `joinRoom`. We
 * compare its SHA-256 against the stored `sessionTokenHash` (issue 0007: only
 * hashes are persisted). A validated session identifies the participant.
 */

import type { DatabaseReader } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { sha256Hex } from "./crypto";

export interface ParticipantSession {
  participantId: Id<"participants">;
  displayName: string;
}

/**
 * Resolves a participant from a room id + opaque session token, or null when the
 * session is invalid. Read-only, so it works in both queries and mutations.
 */
export async function getParticipant(
  db: DatabaseReader,
  roomId: Id<"rooms">,
  sessionToken: string | null | undefined,
): Promise<ParticipantSession | null> {
  if (!sessionToken) return null;
  const tokenHash = await sha256Hex(sessionToken);
  const participant = await db
    .query("participants")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .filter((q) => q.eq(q.field("sessionTokenHash"), tokenHash))
    .first();
  if (!participant) return null;
  return {
    participantId: participant._id,
    displayName: participant.displayName,
  };
}
