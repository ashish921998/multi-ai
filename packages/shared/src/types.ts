/**
 * Shared domain types for the Multiplayer AI Planning Room.
 *
 * Vocabulary comes from the project glossary (CONTEXT.md) and the closed
 * design decisions (issues 0001–0010). These types are imported by the
 * browser app, the local Pi connector, and the Supabase Edge Functions so
 * every layer agrees on the shape of a room, message, handoff, and lease.
 */

/** A message author is either a human participant or the active Pi agent. */
export type MessageAuthor =
  | { kind: "participant"; participantId: string; displayName: string }
  | { kind: "agent"; agentConnectionId: string };

/** Text body of a room message. Empty for an agent message that is still streaming. */
export interface MessageContent {
  text: string;
  /** Screenshots attached to this message (participant messages only). */
  screenshots?: ScreenshotRef[];
}

/** Reference to a private screenshot stored in Supabase Storage. */
export interface ScreenshotRef {
  id: string;
  /** Storage object path, e.g. `rooms/<roomId>/<screenshotId>.png`. */
  path: string;
  mime: ScreenshotMime;
  width: number;
  height: number;
  bytes: number;
}

export type ScreenshotMime = "image/png" | "image/jpeg" | "image/webp";

/**
 * A persisted room message with a monotonically increasing sequence number.
 * The sequence number is the reconnect and handoff boundary primitive.
 */
export interface RoomMessage {
  id: string;
  roomId: string;
  /** Increasing sequence number starting at 1. Never reused, never decreases. */
  seq: number;
  author: MessageAuthor;
  content: MessageContent;
  createdAt: string;
}

/**
 * A handoff is the deterministic batch of new messages since the previous
 * handoff boundary, packaged as one user-message envelope for the active Pi.
 * See issue 0003 (Room-to-Agent Handoff).
 */
export interface Handoff {
  id: string;
  roomId: string;
  /** Messages with seq > boundarySeq are included in this handoff. */
  boundarySeq: number;
  /** Sequence numbers included in the batch, ascending. */
  includedSeqs: number[];
  status: HandoffStatus;
  /** The connection that was active when the handoff was issued. */
  agentConnectionId: string | null;
  createdAt: string;
}

export type HandoffStatus =
  | "pending" // built, waiting to be delivered
  | "delivered" // Pi acknowledged receipt, boundary advanced
  | "responding" // Pi response streaming into the timeline
  | "complete" // response finished
  | "failed"; // delivery or response failed; retryable with the same batch

/**
 * An agent connection is a participant's live link between the room and their
 * local Pi. At most one connection per room holds the active lease.
 * See issues 0002 (Pi Connector Lifecycle) and 0006 (Single Active Agent Takeover).
 */
export interface AgentConnection {
  id: string;
  roomId: string;
  participantId: string;
  /** One-time code consumed by `/room connect <code>`. */
  connectionCode: string;
  status: AgentConnectionStatus;
  /** Epoch ms of the last heartbeat received. */
  lastHeartbeatAt: number;
  /** Epoch ms when the connection was created. */
  createdAt: number;
  /** Epoch ms when the connection was released, if applicable. */
  releasedAt: number | null;
}

export type AgentConnectionStatus =
  | "active" // holds the lease and is eligible to receive handoffs
  | "disconnected"; // explicitly released or expired by missed heartbeats

/** Configuration for the lease state machine (issue 0006). */
export interface LeaseConfig {
  /** A connection is considered offline after this many ms without a heartbeat. */
  heartbeatTimeoutMs: number;
}

/** Result of evaluating a single connection against the lease rules. */
export interface LeaseEvaluation {
  /** Whether the connection currently holds a healthy active lease. */
  isActive: boolean;
  /** Computed status to persist, or null when the stored status is already correct. */
  nextStatus: AgentConnectionStatus | null;
  /** Ms since the last heartbeat. */
  ageMs: number;
}

/** Result of deciding whether a new connection may acquire the active slot. */
export interface AcquireLeaseDecision {
  allowed: boolean;
  /** Reason the acquisition was denied, when not allowed. */
  reason: "slot-free" | "slot-held-by-other" | "same-connection";
}

/** Screenshot limits from issue 0005 (Screenshot Attachment Contract). */
export interface ScreenshotLimits {
  maxBytes: number;
  maxPerHandoff: number;
  acceptedMimes: readonly ScreenshotMime[];
}

/** Abuse-limit capacities from issue 0007 (Password Access and Abuse Boundaries). */
export interface RateLimits {
  participantsPerRoom: number;
  failedPasswordPerIpPerMinute: number;
  messagesPerParticipantPerMinute: number;
  roomCreationPerIpPerMinute: number;
}

/** Snapshot of a token-bucket rate limit for a windowed counter. */
export interface RateBucket {
  /** Count of events already consumed in the current window. */
  count: number;
  /** Epoch ms at the start of the current window. */
  windowStart: number;
}

export interface RateConsumeResult {
  allowed: boolean;
  bucket: RateBucket;
  /** Remaining capacity in the window after this attempt. */
  remaining: number;
}

/** The envelope handed to Pi as a single deterministic user message (issue 0003). */
export interface HandoffEnvelope {
  /** Stable, human + agent readable markdown body. Deterministic for a given batch. */
  body: string;
  /** Sequence numbers that were folded into the body, ascending. */
  includedSeqs: number[];
  /** The boundary to advance to once Pi acknowledges the handoff. */
  nextBoundarySeq: number;
  /** Whether any included message carried a vision screenshot. */
  hasVisionContent: boolean;
}
