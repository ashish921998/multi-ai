/**
 * Convex schema for the Multiplayer AI Planning Room.
 *
 * Ports `supabase/migrations/0001–0004` to Convex's reactive document model.
 *
 * Key mapping decisions:
 *   * The public "room id" is a human code (`rooms.code`, e.g. `K7Q9FXM2PW`),
 *     indexed unique. Internally every cross-table reference uses the Convex
 *     `Id<"rooms">`. Clients always pass the human `code` as `roomId`.
 *   * Only hashes are persisted: room passwords and connection codes use the
 *     PBKDF2 `PasswordHash` from @multi-ai/shared; session tokens use SHA-256
 *     (high-entropy random, no stretching needed).
 *   * Messages carry a per-room monotonic sequence number. Allocation is a
 *     read-modify-write on `roomSeq` inside a serialized mutation, so Convex
 *     optimistic-concurrency control gives the same atomicity as the old
 *     `allocate_message_seq` RPC.
 *   * Invariants the SQL enforced with partial unique indexes — "one active
 *     agent per room" and "one handoff in flight per room" — are enforced with
 *     serialized in-mutation checks (Convex OCC). One-time codes are guarded by
 *     a `consumedAt` field checked under the same transaction.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Persisted PBKDF2 hash record for room passwords and connection codes. */
const passwordHash = v.object({
  hash: v.string(),
  salt: v.string(),
  iterations: v.number(),
});

export default defineSchema({
  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------
  rooms: defineTable({
    /** Human-shareable room code; the value in the `/r/:code` URL. */
    code: v.string(),
    title: v.string(),
    passwordHash,
    createdAt: v.float64(),
    lastActivityAt: v.float64(),
    /** Epoch ms; created_at + 30 days (issue 0004). */
    expiresAt: v.float64(),
    /** SHA-256(ip) for creation rate limiting; absent in tests. */
    creatorIpHash: v.optional(v.string()),
    /** Messages with seq > this are new context for the next handoff. */
    handoffBoundary: v.float64(),
    /**
     * The connection currently holding the active-agent slot (issue 0006).
     * This single field is the serialization point for the single-active-agent
     * invariant: a connect that wants the slot writes this same field, so
     * concurrent connects conflict under OCC and only one wins (replacing the
     * old `one_active_agent_per_room` partial unique index).
     */
    activeAgentConnectionId: v.optional(v.id("agentConnections")),
    /**
     * The room's in-flight handoff, if any (issue 0003). The single
     * serialization point for the one-handoff-in-flight invariant, replacing
     * the old `one_active_handoff_per_room` partial unique index.
     */
    activeHandoffId: v.optional(v.id("handoffs")),
  }).index("by_code", ["code"]),

  // -------------------------------------------------------------------------
  // Participants
  // -------------------------------------------------------------------------
  participants: defineTable({
    roomId: v.id("rooms"),
    displayName: v.string(),
    /** SHA-256 of the opaque session token issued on join. */
    sessionTokenHash: v.string(),
    joinedAt: v.float64(),
    lastSeenAt: v.float64(),
    ipHash: v.optional(v.string()),
  })
    .index("by_room", ["roomId"])
    // Enforces the unique (room, display name) constraint at the lookup level.
    .index("by_room_and_name", ["roomId", "displayName"]),

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------
  messages: defineTable({
    roomId: v.id("rooms"),
    /** Increasing sequence number starting at 1. Never reused. */
    seq: v.float64(),
    authorKind: v.union(v.literal("participant"), v.literal("agent")),
    authorParticipantId: v.optional(v.id("participants")),
    authorAgentConnectionId: v.optional(v.id("agentConnections")),
    text: v.string(),
    status: v.union(v.literal("streaming"), v.literal("complete")),
    createdAt: v.float64(),
  })
    .index("by_room_and_seq", ["roomId", "seq"])
    .index("by_room_created", ["roomId", "createdAt"]),

  // -------------------------------------------------------------------------
  // Screenshots (Convex file storage holds the bytes)
  // -------------------------------------------------------------------------
  screenshots: defineTable({
    roomId: v.id("rooms"),
    /** Set when the screenshot is attached to a posted message. */
    messageId: v.optional(v.id("messages")),
    /** Convex file-storage id returned by generateUploadUrl. */
    storageId: v.id("_storage"),
    mime: v.string(),
    width: v.float64(),
    height: v.float64(),
    bytes: v.float64(),
    createdAt: v.float64(),
  })
    .index("by_message", ["messageId"])
    .index("by_room", ["roomId"]),

  // -------------------------------------------------------------------------
  // Agent connections (issues 0002, 0006)
  // -------------------------------------------------------------------------
  agentConnections: defineTable({
    roomId: v.id("rooms"),
    participantId: v.id("participants"),
    connectionCodeHash: passwordHash,
    status: v.union(v.literal("active"), v.literal("disconnected")),
    /** Whether the connecting model can receive image inputs (issue 0005). */
    supportsVision: v.boolean(),
    lastHeartbeatAt: v.float64(),
    createdAt: v.float64(),
    /** Epoch ms when the connection was released, if applicable. */
    releasedAt: v.float64(),
    /**
     * Set the instant a one-time code is consumed (review #1). Absent until the
     * code activates; checked under the same serialized mutation that flips
     * status to "active".
     */
    consumedAt: v.optional(v.float64()),
  })
    .index("by_room", ["roomId"])
    // Fast "find the room's active agent" lookup (single-active-agent rule).
    .index("by_room_and_status", ["roomId", "status"]),

  // -------------------------------------------------------------------------
  // Handoffs (issue 0003)
  // -------------------------------------------------------------------------
  handoffs: defineTable({
    roomId: v.id("rooms"),
    /** Messages with seq > this are included. */
    boundarySeq: v.float64(),
    /** Boundary the room advances to once Pi acknowledges the handoff. */
    nextBoundarySeq: v.float64(),
    /** Sequence numbers folded into the batch, ascending. */
    includedSeqs: v.array(v.float64()),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("responding"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    agentConnectionId: v.optional(v.id("agentConnections")),
    agentMessageId: v.optional(v.id("messages")),
    createdAt: v.float64(),
    completedAt: v.optional(v.float64()),
  })
    .index("by_room", ["roomId"])
    .index("by_room_and_status", ["roomId", "status"])
    .index("by_agent_and_status", ["agentConnectionId", "status"]),

  // -------------------------------------------------------------------------
  // Per-room monotonic sequence allocator.
  // -------------------------------------------------------------------------
  roomSeq: defineTable({
    roomId: v.id("rooms"),
    nextSeq: v.float64(),
  }).index("by_room", ["roomId"]),

  // -------------------------------------------------------------------------
  // Generic per-window rate-limit counters (issue 0007).
  // -------------------------------------------------------------------------
  rateBuckets: defineTable({
    scope: v.string(),
    key: v.string(),
    count: v.float64(),
    windowStart: v.float64(),
  }).index("by_scope_and_key", ["scope", "key"]),
});
