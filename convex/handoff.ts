/**
 * Room-to-agent handoff (issue 0003).
 *
 * Ports `send-handoff`, `agent-fetch-handoff`, and `agent-respond`.
 *
 * The one-handoff-in-flight invariant is enforced by treating
 * `room.activeHandoffId` as the serialization point: a `send` that starts a
 * handoff writes that field, so two concurrent sends conflict under OCC and only
 * one wins (replacing the old `one_active_handoff_per_room` partial unique
 * index). The boundary advances only when the connector fetches (acknowledges
 * receipt); a failed handoff is retried with the same stored batch.
 *
 * Vision gating (issue 0005): `fetch` returns screenshot metadata; a connected
 * vision model then resolves viewable URLs through `visionUrl`. Storage URLs are
 * reader-only in Convex, so they cannot be minted inside the fetch mutation —
 * hence the separate query.
 */

import { mutation, query, type DatabaseReader } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { fail } from "./lib/errors";
import { getParticipant } from "./lib/session";
import { lookupRoomByCode, touchActivity } from "./lib/room";
import { allocateSeq } from "./lib/seq";
import { findHolder, isHealthy, reapStaleHolder } from "./lib/agent";
import { loadMessageContext } from "./lib/messages";
import { isActiveHandoff } from "./lib/status";
import { buildEnvelopeFromRows } from "./lib/handoff";
// (the set of statuses that block the next "Send to agent" lives in lib/status.ts)

// ---------------------------------------------------------------------------
// send — start (or retry) a handoff.
// ---------------------------------------------------------------------------

export const send = mutation({
  args: { roomId: v.string(), sessionToken: v.string() },
  handler: async (ctx, args): Promise<{
    handoffId: string;
    retry?: boolean;
    includedSeqs?: number[];
    nextBoundarySeq?: number;
    hasVisionContent?: boolean;
  }> => {
    const code = args.roomId.trim().toUpperCase();
    const room = await lookupRoomByCode(ctx.db, code);
    if (!room) fail("Room not found.");
    const me = await getParticipant(ctx.db, room._id, args.sessionToken);
    if (!me) fail("Invalid or expired session. Rejoin the room.");

    await reapStaleHolder(ctx.db, room);
    const room2 = await lookupRoomByCode(ctx.db, code);
    if (!room2) fail("Room not found.");

    // Reject if a handoff is already in flight for this room.
    if (room2.activeHandoffId) {
      const active = await ctx.db.get(room2.activeHandoffId);
      if (active && isActiveHandoff(active.status)) {
        fail("A handoff to the agent is already in progress.");
      }
    }

    const holder = await findHolder(ctx.db, room2);
    if (!holder || !isHealthy(holder)) {
      fail("No active Pi agent is connected. Someone connect a Pi first.");
    }

    // Retry path: re-send the most recent failed handoff with its stored batch.
    const failed = await ctx.db
      .query("handoffs")
      .withIndex("by_room_and_status", (q) => q.eq("roomId", room2._id).eq("status", "failed"))
      .order("desc")
      .first();
    if (failed) {
      await ctx.db.patch(failed._id, {
        status: "pending",
        agentConnectionId: holder._id,
        agentMessageId: undefined,
      });
      await ctx.db.patch(room2._id, { activeHandoffId: failed._id });
      return { handoffId: failed._id, retry: true };
    }

    // New handoff: build the deterministic envelope from messages after the
    // boundary. The composite index lets us push `seq > boundary` into the range
    // scan instead of loading the whole room history.
    const boundary = room2.handoffBoundary;
    const newRows = await ctx.db
      .query("messages")
      .withIndex("by_room_and_seq", (q) => q.eq("roomId", room2._id).gt("seq", boundary))
      .take(500);

    const { screenshots, participants } = await loadMessageContext(ctx.db, room2._id, newRows);

    const envelope = buildEnvelopeFromRows({
      rows: newRows,
      screenshots,
      participants,
      boundarySeq: boundary,
    });

    const handoffId = await ctx.db.insert("handoffs", {
      roomId: room2._id,
      boundarySeq: boundary,
      nextBoundarySeq: envelope.nextBoundarySeq,
      includedSeqs: envelope.includedSeqs,
      status: "pending",
      agentConnectionId: holder._id,
      createdAt: Date.now(),
    });
    await ctx.db.patch(room2._id, { activeHandoffId: handoffId });

    return {
      handoffId,
      includedSeqs: envelope.includedSeqs,
      nextBoundarySeq: envelope.nextBoundarySeq,
      hasVisionContent: envelope.hasVisionContent,
    };
  },
});

// ---------------------------------------------------------------------------
// fetch — acknowledge receipt: advance the boundary, mark delivered.
// ---------------------------------------------------------------------------

export const fetch = mutation({
  args: { agentConnectionId: v.id("agentConnections") },
  handler: async (ctx, args): Promise<{
    pending: boolean;
    handoffId?: string;
    body?: string;
    includedSeqs?: number[];
    hasVisionContent?: boolean;
    supportsVision?: boolean;
    screenshots?: Array<{
      id: string;
      messageId: string;
      storageId: string;
      mime: string;
      width: number;
      height: number;
    }>;
    workspaceDocument?: {
      id: string;
      path: string;
      body: string;
      version: number;
    };
  }> => {
    const conn = await ctx.db.get(args.agentConnectionId);
    if (!conn || conn.status !== "active") fail("This connection is no longer active.");
    const room = await ctx.db.get(conn.roomId);
    if (!room || room.activeAgentConnectionId !== args.agentConnectionId) {
      fail("This connection is no longer active.");
    }

    const handoff = await ctx.db
      .query("handoffs")
      .withIndex("by_agent_and_status", (q) =>
        q.eq("agentConnectionId", args.agentConnectionId).eq("status", "pending"),
      )
      .first();
    if (!handoff) return { pending: false };

    const boundary = handoff.boundarySeq;
    const includedSeqs = handoff.includedSeqs;
    // The stored batch is a small set of seqs; bound the message read by its max
    // so we never scan the whole room, then filter to the exact set.
    const maxSeq = includedSeqs.length ? Math.max(...includedSeqs) : -1;
    const rows = includedSeqs.length
      ? await ctx.db
          .query("messages")
          .withIndex("by_room_and_seq", (q) => q.eq("roomId", room._id).lte("seq", maxSeq))
          .collect()
      : [];
    const batchRows = rows
      .filter((m) => includedSeqs.includes(m.seq))
      .sort((a, b) => a.seq - b.seq);

    const { screenshots, participants } = await loadMessageContext(ctx.db, room._id, batchRows);

    const envelope = buildEnvelopeFromRows({
      rows: batchRows,
      screenshots,
      participants,
      boundarySeq: boundary,
    });

    let body = envelope.body;
    let handoffScreenshots: ScreenshotMeta[] = [];

    if (envelope.hasVisionContent) {
      if (conn.supportsVision) {
        handoffScreenshots = screenshots.map((s) => ({
          id: s._id,
          messageId: s.messageId!,
          storageId: s.storageId,
          mime: s.mime,
          width: s.width,
          height: s.height,
        }));
      } else {
        // Text-only handoff with a clear limitation note (issue 0005).
        body += `\n\n---\n\nNote: the room shared ${screenshots.length} screenshot(s) for visual context, but your configuration does not receive images. The screenshots remain visible to participants in the room.`;
      }
    }

    // Snapshot the canonical plan in the same transaction that acknowledges the
    // handoff. Pi's later write uses this version as its strict OCC base, so a
    // participant edit during generation can never be overwritten.
    const plan = await ctx.db
      .query("documents")
      .withIndex("by_room_and_path", (q) => q.eq("roomId", room._id).eq("path", "plan.md"))
      .unique();

    // Acknowledge receipt: advance the room boundary and mark delivered.
    await ctx.db.patch(room._id, { handoffBoundary: handoff.nextBoundarySeq });
    await ctx.db.patch(handoff._id, { status: "delivered" });

    return {
      pending: true,
      handoffId: handoff._id,
      body,
      includedSeqs: envelope.includedSeqs,
      hasVisionContent: envelope.hasVisionContent,
      supportsVision: conn.supportsVision,
      screenshots: handoffScreenshots,
      ...(plan
        ? {
            workspaceDocument: {
              id: plan._id,
              path: plan.path,
              body: plan.body,
              version: plan.version,
            },
          }
        : {}),
    };
  },
});

// Metadata for a screenshot carried by a delivered handoff (URLs resolved
// separately via `visionUrl`, since storage URLs are reader-only).
interface ScreenshotMeta {
  id: string;
  messageId: string;
  storageId: string;
  mime: string;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// respond — stream the agent's response into the timeline.
// ---------------------------------------------------------------------------

export const respond = mutation({
  args: {
    agentConnectionId: v.id("agentConnections"),
    handoffId: v.id("handoffs"),
    chunk: v.optional(v.string()),
    complete: v.optional(v.boolean()),
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ ok: true; status: string }> => {
    const conn = await ctx.db.get(args.agentConnectionId);
    if (!conn || conn.status !== "active") fail("This connection is no longer active.");
    const room = await ctx.db.get(conn.roomId);
    if (!room || room.activeAgentConnectionId !== args.agentConnectionId) {
      fail("This connection is no longer active.");
    }

    const handoff = await ctx.db.get(args.handoffId);
    if (!handoff || handoff.agentConnectionId !== args.agentConnectionId) {
      fail("Handoff not found for this connection.");
    }
    if (handoff.status === "complete") return { ok: true, status: "complete" };
    if (handoff.status === "failed" && !args.complete && !args.failed) {
      fail("This handoff previously failed. Retry it from the room.");
    }

    // ---- failure path -----------------------------------------------------
    if (args.failed) {
      await ctx.db.patch(args.handoffId, { status: "failed" });
      if (handoff.agentMessageId) {
        const prev = await currentText(ctx.db, handoff.agentMessageId);
        await ctx.db.patch(handoff.agentMessageId, {
          status: "complete",
          text: `${prev}\n\n_(response failed — retry available)_`,
        });
      }
      // Release the in-flight slot so the failed handoff can be retried.
      if (room.activeHandoffId === args.handoffId) {
        await ctx.db.patch(room._id, { activeHandoffId: undefined });
      }
      return { ok: true, status: "failed" };
    }

    // ---- streaming path ---------------------------------------------------
    let messageId = handoff.agentMessageId;
    const chunk = typeof args.chunk === "string" ? args.chunk : "";

    if (!messageId) {
      // First chunk: allocate a sequence and create the streaming agent message.
      const seq = await allocateSeq(ctx.db, room._id);
      messageId = await ctx.db.insert("messages", {
        roomId: room._id,
        seq,
        authorKind: "agent",
        authorAgentConnectionId: args.agentConnectionId,
        text: chunk,
        status: "streaming",
        createdAt: Date.now(),
      });
      await ctx.db.patch(args.handoffId, { status: "responding", agentMessageId: messageId });
    } else if (chunk) {
      const prev = await currentText(ctx.db, messageId);
      await ctx.db.patch(messageId, { text: prev + chunk });
    }

    // ---- completion -------------------------------------------------------
    if (args.complete) {
      await ctx.db.patch(messageId, { status: "complete" });
      await ctx.db.patch(args.handoffId, {
        status: "complete",
        completedAt: Date.now(),
      });
      if (room.activeHandoffId === args.handoffId) {
        await ctx.db.patch(room._id, { activeHandoffId: undefined });
      }
      await touchActivity(ctx.db, room._id);
      return { ok: true, status: "complete" };
    }

    return { ok: true, status: "streaming" };
  },
});

async function currentText(db: DatabaseReader, messageId: Id<"messages">): Promise<string> {
  const doc = await db.get(messageId);
  return doc?.text ?? "";
}

// ---------------------------------------------------------------------------
// visionUrl — a viewable URL for a handoff screenshot, gated on the active
// connection. Storage URLs are reader-only, so this is a query.
// ---------------------------------------------------------------------------

export const visionUrl = query({
  args: { agentConnectionId: v.id("agentConnections"), screenshotId: v.id("screenshots") },
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    const conn = await ctx.db.get(args.agentConnectionId);
    if (!conn || conn.status !== "active") return { url: null };
    const room = await ctx.db.get(conn.roomId);
    if (!room || room.activeAgentConnectionId !== args.agentConnectionId) {
      return { url: null };
    }
    const shot = await ctx.db.get(args.screenshotId);
    if (!shot || shot.roomId !== room._id) return { url: null };
    const url = await ctx.storage.getUrl(shot.storageId);
    return { url };
  },
});
