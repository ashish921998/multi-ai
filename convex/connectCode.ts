/**
 * Connection-code issuance.
 *
 * Ports the `connect-code` Edge Function. A participant mints a one-time code;
 * the local Pi connector redeems it with `agent.connect`. Only the hash is
 * persisted; the plaintext code is returned once to the participant (issue 0002).
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  generateConnectionCode,
  hashConnectionCode,
  normalizeConnectionCode,
} from "@multi-ai/shared";
import { fail } from "./lib/errors";
import { getParticipant } from "./lib/session";
import { lookupRoomByCode } from "./lib/room";
import { consumeRate } from "./lib/ratelimit";

export const issue = mutation({
  args: { roomId: v.string(), sessionToken: v.string() },
  handler: async (ctx, args): Promise<{
    connectionId: string;
    roomId: string;
    connectionCode: string;
    command: string;
  }> => {
    const code = args.roomId.trim().toUpperCase();
    const room = await lookupRoomByCode(ctx.db, code);
    if (!room) fail("Room not found.");
    const me = await getParticipant(ctx.db, room._id, args.sessionToken);
    if (!me) fail("Invalid or expired session. Rejoin the room.");

    // Throttle code generation so a participant cannot mint unlimited codes.
    const allowed = await consumeRate(ctx.db, "connect_code", me.participantId, 5);
    if (!allowed) fail("Too many connection codes. Try again in a minute.");

    // Hash the NORMALIZED form: `agent.connect` normalizes the typed code
    // (strips dashes/whitespace) before verifying, so the stored hash must be
    // of the same canonical form or the round-trip always fails.
    const rawCode = generateConnectionCode();
    const connectionCodeHash = await hashConnectionCode(normalizeConnectionCode(rawCode));
    const now = Date.now();
    const connectionId = await ctx.db.insert("agentConnections", {
      roomId: room._id,
      participantId: me.participantId,
      connectionCodeHash,
      status: "disconnected",
      supportsVision: false,
      lastHeartbeatAt: now,
      createdAt: now,
      releasedAt: now,
    });

    return {
      connectionId,
      roomId: code,
      connectionCode: rawCode,
      command: `room connect ${code} ${rawCode}`,
    };
  },
});
