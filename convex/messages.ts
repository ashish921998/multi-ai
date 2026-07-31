/**
 * Participant message posting.
 *
 * Ports the `post-message` Edge Function. The per-room sequence number is
 * allocated atomically by `allocateSeq` (a read-modify-write on the room's
 * counter doc, serialized by Convex OCC). Attached screenshots are linked to the
 * new message. No broadcast is needed: the reactive `rooms.state` query updates
 * every subscribed browser automatically (issue 0004).
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  DEFAULT_RATE_LIMITS,
  validateScreenshotBatch,
} from "@multi-ai/shared";
import { fail } from "./lib/errors";
import { getParticipant } from "./lib/session";
import { lookupRoomByCode, touchActivity } from "./lib/room";
import { consumeRate } from "./lib/ratelimit";
import { allocateSeq } from "./lib/seq";

const MAX_TEXT = 4000;

export const post = mutation({
  args: {
    roomId: v.string(),
    sessionToken: v.string(),
    text: v.string(),
    screenshotIds: v.array(v.id("screenshots")),
  },
  handler: async (ctx, args): Promise<{
    id: string;
    seq: number;
    authorKind: "participant";
    authorParticipantId: string;
    authorDisplayName: string;
    text: string;
    createdAt: string;
  }> => {
    const code = args.roomId.trim().toUpperCase();
    const text = args.text.trim();
    const screenshotIds = args.screenshotIds;

    if (!text && screenshotIds.length === 0) fail("A message needs text or a screenshot.");
    if (text.length > MAX_TEXT) fail(`Message must be ${MAX_TEXT} characters or fewer.`);

    const room = await lookupRoomByCode(ctx.db, code);
    if (!room) fail("Room not found.");
    const me = await getParticipant(ctx.db, room._id, args.sessionToken);
    if (!me) fail("Invalid or expired session. Rejoin the room.");

    const batch = validateScreenshotBatch(screenshotIds.length);
    if (!batch.ok) fail(batch.error ?? "Too many screenshots.");

    // 30 messages per participant per minute (issue 0007).
    const allowed = await consumeRate(
      ctx.db,
      "message",
      me.participantId,
      DEFAULT_RATE_LIMITS.messagesPerParticipantPerMinute,
    );
    if (!allowed) fail("You are sending messages too quickly. Slow down a moment.");

    const seq = await allocateSeq(ctx.db, room._id);
    const messageId = await ctx.db.insert("messages", {
      roomId: room._id,
      seq,
      authorKind: "participant",
      authorParticipantId: me.participantId,
      text,
      status: "complete",
      createdAt: Date.now(),
    });

    if (screenshotIds.length > 0) {
      // Attach only screenshots that belong to this room and are not yet linked.
      const candidates = await ctx.db
        .query("screenshots")
        .withIndex("by_room", (q) => q.eq("roomId", room._id))
        .collect();
      for (const shot of candidates) {
        if (screenshotIds.includes(shot._id) && shot.messageId === undefined) {
          await ctx.db.patch(shot._id, { messageId });
        }
      }
    }

    await touchActivity(ctx.db, room._id);

    return {
      id: messageId,
      seq,
      authorKind: "participant",
      authorParticipantId: me.participantId,
      authorDisplayName: me.displayName,
      text,
      createdAt: new Date().toISOString(),
    };
  },
});
