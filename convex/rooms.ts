/**
 * Room lifecycle and the reactive room-state query.
 *
 * Ports the `create-room`, `join-room`, and `room-state` Edge Functions. The
 * big win of the Convex migration is `state`: instead of the opaque-ticker +
 * fetch-on-tick dance, the browser subscribes to this one query and receives a
 * fully session-gated, content-bearing snapshot that updates reactively as
 * participants, messages, and agent status change (issue 0004).
 */

import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  DEFAULT_RATE_LIMITS,
  ROOM_INACTIVITY_TTL_MS,
  generateParticipantId,
  generateRoomId,
  generateRoomPassword,
  hashRoomPassword,
  verifyRoomPassword,
} from "@multi-ai/shared";
import { fail } from "./lib/errors";
import { randomHex, sha256Hex } from "./lib/crypto";
import { getParticipant } from "./lib/session";
import { lookupRoomByCode, touchActivity } from "./lib/room";
import { consumeRate } from "./lib/ratelimit";
import { findHolder, isHealthy } from "./lib/agent";
import { isActiveHandoff } from "./lib/status";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// createRoom
// ---------------------------------------------------------------------------

export const createRoom = mutation({
  args: { title: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{
    roomId: string;
    title: string;
    password: string;
    joinUrl: string;
    expiresInDays: number;
  }> => {
    // NOTE: Convex does not expose the caller's IP to functions, so per-IP room
    // creation rate limiting (issue 0007) is not available without Convex Auth.
    // The web app could add an anonymous client fingerprint later; for V1 this
    // is the documented adaptation.

    const title =
      typeof args.title === "string" && args.title.trim()
        ? args.title.trim().slice(0, 120)
        : "Planning room";

    let code = generateRoomId();
    for (let attempt = 0; attempt < 4; attempt++) {
      const existing = await lookupRoomByCode(ctx.db, code);
      if (!existing) break;
      code = generateRoomId();
    }

    const password = generateRoomPassword();
    const passwordHash = await hashRoomPassword(password);
    const now = Date.now();
    await ctx.db.insert("rooms", {
      code,
      title,
      passwordHash,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: now + ROOM_INACTIVITY_TTL_MS,
      handoffBoundary: 0,
    });

    const appBaseUrl = (process.env.APP_BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");
    return {
      roomId: code,
      title,
      password,
      joinUrl: `${appBaseUrl}/r/${code}`,
      expiresInDays: Math.round(ROOM_INACTIVITY_TTL_MS / DAY_MS),
    };
  },
});

// ---------------------------------------------------------------------------
// joinRoom
// ---------------------------------------------------------------------------

export const joinRoom = mutation({
  args: {
    roomId: v.string(),
    password: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args): Promise<{
    roomId: string;
    title: string;
    participantId: string;
    displayName: string;
    sessionToken: string;
  }> => {
    const code = args.roomId.trim().toUpperCase();
    const displayName = args.displayName.trim();
    if (!displayName) fail("A display name is required.");
    if (displayName.length > 40) fail("Display name must be 40 characters or fewer.");

    const room = await lookupRoomByCode(ctx.db, code);
    if (!room) fail("Room not found.");
    if (room.expiresAt < Date.now()) fail("This room has expired.");

    const passwordOk = await verifyRoomPassword(args.password, room.passwordHash);
    if (!passwordOk) {
      // 5 failed attempts per room per minute (issue 0007). Keyed by room rather
      // than IP (Convex does not expose caller IP): this still bounds password
      // brute force on a specific room. Consumed only on an actual failure, so
      // legitimate joins never burn the failure budget.
      const allowed = await consumeRate(
        ctx.db,
        "join_fail",
        room._id,
        DEFAULT_RATE_LIMITS.failedPasswordPerIpPerMinute,
      );
      fail(allowed ? "Incorrect room password." : "Too many attempts. Try again in a minute.");
    }

    // Enforce 10 participants per room (issue 0007).
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    if (participants.length >= DEFAULT_RATE_LIMITS.participantsPerRoom) {
      fail(`This room is full (${DEFAULT_RATE_LIMITS.participantsPerRoom} participants).`);
    }

    const taken = participants.some((p) => p.displayName === displayName);
    if (taken) fail("That display name is already taken in this room.");

    const sessionToken = `${generateParticipantId()}.${await sha256Hex(randomHex(16))}`;
    const sessionTokenHash = await sha256Hex(sessionToken);
    const participantId = await ctx.db.insert("participants", {
      roomId: room._id,
      displayName,
      sessionTokenHash,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
    });

    await touchActivity(ctx.db, room._id);

    return {
      roomId: code,
      title: room.title,
      participantId,
      displayName,
      sessionToken,
    };
  },
});

// ---------------------------------------------------------------------------
// state (reactive, session-gated room snapshot)
// ---------------------------------------------------------------------------

export const state = query({
  args: {
    roomId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, args): Promise<RoomState | null> => {
    const code = args.roomId.trim().toUpperCase();
    const room = await lookupRoomByCode(ctx.db, code);
    if (!room) return null;

    const me = await getParticipant(ctx.db, room._id, args.sessionToken);
    if (!me) return null; // Invalid session → the client treats null as "rejoin".

    const now = Date.now();

    const [participants, messages, holder, activeHandoff] = await Promise.all([
      ctx.db
        .query("participants")
        .withIndex("by_room", (q) => q.eq("roomId", room._id))
        .order("asc")
        .collect(),
      ctx.db
        .query("messages")
        .withIndex("by_room_and_seq", (q) => q.eq("roomId", room._id))
        .order("asc")
        .take(500),
      findHolder(ctx.db, room),
      room.activeHandoffId ? ctx.db.get(room.activeHandoffId) : Promise.resolve(null),
    ]);

    // Group the room's screenshots by message once (room-bounded index, not a
    // full-table scan), so the per-message map is a Map lookup, not O(n*m).
    const messageIdSet = new Set(messages.map((m) => m._id));
    const shotsByMessage = new Map<string, Doc<"screenshots">[]>();
    if (messageIdSet.size > 0) {
      const all = await ctx.db
        .query("screenshots")
        .withIndex("by_room", (q) => q.eq("roomId", room._id))
        .collect();
      for (const s of all) {
        if (s.messageId && messageIdSet.has(s.messageId)) {
          const arr = shotsByMessage.get(s.messageId);
          if (arr) arr.push(s);
          else shotsByMessage.set(s.messageId, [s]);
        }
      }
    }

    const agentActive = holder !== null && isHealthy(holder, now);

    return {
      room: {
        id: code,
        title: room.title,
        createdAt: new Date(room.createdAt).toISOString(),
        expiresAt: new Date(room.expiresAt).toISOString(),
      },
      me: { participantId: me.participantId, displayName: me.displayName },
      participants: participants
        .map((p) => ({
          id: p._id,
          displayName: p.displayName,
          joinedAt: new Date(p.joinedAt).toISOString(),
          isSelf: p._id === me.participantId,
        }))
        .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
      messages: messages.map((m) => ({
        id: m._id,
        seq: m.seq,
        authorKind: m.authorKind,
        authorParticipantId: m.authorParticipantId ?? null,
        authorAgentConnectionId: m.authorAgentConnectionId ?? null,
        text: m.text,
        status: m.status,
        createdAt: new Date(m.createdAt).toISOString(),
        screenshots: (shotsByMessage.get(m._id) ?? []).map((s) => ({
          id: s._id,
          mime: s.mime,
          width: s.width,
          height: s.height,
          bytes: s.bytes,
        })),
      })),
      agent: holder
        ? {
            active: agentActive,
            connectionId: holder._id,
            connectorDisplayName:
              participants.find((p) => p._id === holder.participantId)?.displayName ?? null,
            lastHeartbeatAt: new Date(holder.lastHeartbeatAt).toISOString(),
            supportsVision: holder.supportsVision,
          }
        : { active: false, connectionId: null, connectorDisplayName: null, lastHeartbeatAt: null, supportsVision: false },
      boundarySeq: room.handoffBoundary,
      handoffStatus: activeHandoff?.status ?? null,
      handoffInProgress: activeHandoff ? isActiveHandoff(activeHandoff.status) : false,
    };
  },
});

export interface RoomState {
  room: { id: string; title: string; createdAt: string; expiresAt: string };
  me: { participantId: string; displayName: string };
  participants: {
    id: string;
    displayName: string;
    joinedAt: string;
    isSelf: boolean;
  }[];
  messages: {
    id: string;
    seq: number;
    authorKind: "participant" | "agent";
    authorParticipantId: string | null;
    authorAgentConnectionId: string | null;
    text: string;
    status: "streaming" | "complete";
    createdAt: string;
    screenshots: { id: string; mime: string; width: number; height: number; bytes: number }[];
  }[];
  agent: {
    active: boolean;
    connectionId: string | null;
    connectorDisplayName: string | null;
    lastHeartbeatAt: string | null;
    supportsVision: boolean;
  };
  boundarySeq: number;
  handoffStatus: string | null;
  handoffInProgress: boolean;
}
