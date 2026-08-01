/**
 * Agent connection lifecycle (issues 0002, 0006).
 *
 * Ports `agent-connect`, `agent-heartbeat`, `agent-disconnect`, and adds
 * `pendingHandoff` — a reactive query the connector subscribes to instead of
 * the old poll loop + realtime broadcast signal.
 *
 * The single-active-agent invariant is enforced by treating
 * `room.activeAgentConnectionId` as the serialization point. A connect that
 * wants the slot writes that same field, so two concurrent connects (even on
 * different one-time codes) conflict under Convex optimistic concurrency and
 * only one wins — exactly what the old `one_active_agent_per_room` partial
 * unique index guaranteed. One-time codes are guarded the same way: the code's
 * `consumedAt` is flipped inside the same transaction, so a concurrent redeem of
 * the same code retries, sees it consumed, and is rejected (review #1).
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  HEARTBEAT_INTERVAL_MS,
  DEFAULT_LEASE_CONFIG,
  normalizeConnectionCode,
  verifyConnectionCode,
} from "@multi-ai/shared";
import { fail } from "./lib/errors";
import { lookupRoomByCode } from "./lib/room";
import { findHolder, isHealthy, reapStaleHolder } from "./lib/agent";

// ---------------------------------------------------------------------------
// connect — redeem a one-time code and acquire the active slot.
// ---------------------------------------------------------------------------

export const connect = mutation({
  args: {
    roomId: v.string(),
    connectionCode: v.string(),
    supportsVision: v.boolean(),
  },
  handler: async (ctx, args): Promise<{
    agentConnectionId: string;
    roomId: string;
    boundarySeq: number;
    heartbeatIntervalMs: number;
  }> => {
    const code = args.roomId.trim().toUpperCase();
    const rawCode = normalizeConnectionCode(args.connectionCode);
    if (!code || rawCode.length === 0) fail("roomId and connectionCode are required.");

    const room = await lookupRoomByCode(ctx.db, code);
    if (!room) fail("Room not found.");

    // Only disconnected, unconsumed codes are eligible. `by_room_and_status`
    // pushes the status filter into the index; consumedAt has no index so it is
    // filtered in JS. Ordered oldest-first so the first matching code wins.
    const pending = await ctx.db
      .query("agentConnections")
      .withIndex("by_room_and_status", (q) => q.eq("roomId", room._id).eq("status", "disconnected"))
      .collect();
    const unconsumed = pending.filter((c) => c.consumedAt === undefined);
    if (unconsumed.length === 0) {
      fail("No pending connection for this room. Generate a code in the room first.");
    }

    let connection: (typeof unconsumed)[number] | null = null;
    for (const row of unconsumed) {
      const ok = await verifyConnectionCode(rawCode, row.connectionCodeHash);
      if (ok) {
        connection = row;
        break;
      }
    }
    if (!connection) fail("Invalid connection code.");

    // Reap a timed-out holder before deciding, then enforce the single slot.
    // Re-read the room so the holder check sees the post-reap state.
    await reapStaleHolder(ctx.db, room);
    const freshRoom = await lookupRoomByCode(ctx.db, code);
    if (!freshRoom) fail("Room not found.");
    const holder = await findHolder(ctx.db, freshRoom);
    if (holder && isHealthy(holder)) {
      fail("Another agent is already active in this room. Try again once it disconnects.");
    }

    // Consume the code AND claim the slot. Both writes touch the room doc (via
    // activeAgentConnectionId), so a concurrent connect on a different code
    // conflicts and retries; a concurrent redeem of THIS code conflicts on the
    // connection doc and retries to find consumedAt set (review #1).
    await ctx.db.patch(connection._id, {
      status: "active",
      lastHeartbeatAt: Date.now(),
      supportsVision: args.supportsVision,
      consumedAt: Date.now(),
    });
    await ctx.db.patch(freshRoom._id, { activeAgentConnectionId: connection._id });

    return {
      agentConnectionId: connection._id,
      roomId: code,
      boundarySeq: freshRoom.handoffBoundary,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    };
  },
});

// ---------------------------------------------------------------------------
// heartbeat
// ---------------------------------------------------------------------------

export const heartbeat = mutation({
  args: { agentConnectionId: v.id("agentConnections") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const conn = await ctx.db.get(args.agentConnectionId);
    if (!conn) fail("Connection not found.");
    if (conn.roomId === undefined) fail("Connection not found.");
    const room = await ctx.db.get(conn.roomId);
    if (!room || room.activeAgentConnectionId !== args.agentConnectionId) {
      fail("This connection is no longer active.");
    }
    // A heartbeat from a connection already past the timeout is stale and must
    // not revive a slot that may have been taken over (issue 0006).
    const ageMs = Date.now() - conn.lastHeartbeatAt;
    if (ageMs > DEFAULT_LEASE_CONFIG.heartbeatTimeoutMs) {
      fail("This connection timed out and may have been replaced.");
    }
    await ctx.db.patch(args.agentConnectionId, { lastHeartbeatAt: Date.now() });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// disconnect — release the slot immediately (idempotent).
// ---------------------------------------------------------------------------

export const disconnect = mutation({
  args: { agentConnectionId: v.id("agentConnections") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const conn = await ctx.db.get(args.agentConnectionId);
    if (!conn) return { ok: true }; // idempotent
    if (conn.status === "active") {
      await ctx.db.patch(args.agentConnectionId, {
        status: "disconnected",
        releasedAt: Date.now(),
      });
      // Only clear the slot if this connection still holds it.
      const room = await ctx.db.get(conn.roomId);
      if (room && room.activeAgentConnectionId === args.agentConnectionId) {
        await ctx.db.patch(room._id, { activeAgentConnectionId: undefined });
      }
    }
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// pendingHandoff — reactive signal for the connector.
// ---------------------------------------------------------------------------

export const pendingHandoff = query({
  args: { agentConnectionId: v.id("agentConnections") },
  handler: async (ctx, args): Promise<{ pending: boolean; handoffId: string | null }> => {
    const conn = await ctx.db.get(args.agentConnectionId);
    if (!conn || conn.status !== "active") return { pending: false, handoffId: null };
    const room = await ctx.db.get(conn.roomId);
    if (!room || room.activeAgentConnectionId !== args.agentConnectionId) {
      return { pending: false, handoffId: null };
    }
    const handoff = await ctx.db
      .query("handoffs")
      .withIndex("by_agent_and_status", (q) =>
        q.eq("agentConnectionId", args.agentConnectionId).eq("status", "pending"),
      )
      .first();
    return { pending: handoff !== undefined, handoffId: handoff?._id ?? null };
  },
});
