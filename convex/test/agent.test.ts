import { describe, it, expect } from "vitest";
import { isHealthy, reapStaleHolder } from "../lib/agent";
import type { Doc } from "../_generated/dataModel";
import type { DatabaseWriter } from "../_generated/server";

// A minimal agent-connection document shaped like the schema (only the fields
// isHealthy consults are exercised).
function conn(overrides: Partial<Doc<"agentConnections">> = {}): Doc<"agentConnections"> {
  return {
    _id: "conn-1" as unknown as Doc<"agentConnections">["_id"],
    _creationTime: 0,
    roomId: "r1" as unknown as Doc<"agentConnections">["roomId"],
    participantId: "p1" as unknown as Doc<"agentConnections">["participantId"],
    connectionCodeHash: { hash: "h", salt: "s", iterations: 1 },
    status: "active",
    supportsVision: false,
    lastHeartbeatAt: 1_000,
    createdAt: 0,
    releasedAt: 0,
    ...overrides,
  };
}

describe("isHealthy", () => {
  it("is healthy while the heartbeat is within the 30s timeout", () => {
    expect(isHealthy(conn({ lastHeartbeatAt: 1_000 }), 5_000)).toBe(true);
    expect(isHealthy(conn({ lastHeartbeatAt: 1_000 }), 31_000 - 1)).toBe(true);
  });

  it("goes unhealthy once the heartbeat is older than 30s", () => {
    expect(isHealthy(conn({ lastHeartbeatAt: 1_000 }), 31_001)).toBe(false);
    expect(isHealthy(conn({ lastHeartbeatAt: 1_000 }), 60_000)).toBe(false);
  });

  it("is never healthy when the connection is already disconnected", () => {
    expect(isHealthy(conn({ status: "disconnected", lastHeartbeatAt: 5_000 }), 6_000)).toBe(false);
  });
});

describe("reapStaleHolder", () => {
  it("fails and releases the stale holder's unfinished handoff", async () => {
    const holder = conn({ lastHeartbeatAt: 1_000 });
    const room = {
      _id: "room-1",
      activeAgentConnectionId: holder._id,
      activeHandoffId: "handoff-1",
    } as unknown as Doc<"rooms">;
    const handoff = {
      _id: "handoff-1",
      agentConnectionId: holder._id,
      agentMessageId: "message-1",
      status: "responding",
    } as unknown as Doc<"handoffs">;
    const message = {
      _id: "message-1",
      text: "partial response",
      status: "streaming",
    } as unknown as Doc<"messages">;
    const docs = new Map<string, object>([
      [holder._id, holder],
      [handoff._id, handoff],
      [message._id, message],
      [room._id, room],
    ]);
    const db = {
      get: async (id: string) => docs.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        Object.assign(docs.get(id)!, patch);
      },
    } as unknown as DatabaseWriter;

    expect(await reapStaleHolder(db, room, 60_000)).toBe(true);
    expect(holder.status).toBe("disconnected");
    expect(handoff.status).toBe("failed");
    expect(message).toMatchObject({
      status: "complete",
      text: "partial response\n\n_(response failed — retry available)_",
    });
    expect(room.activeAgentConnectionId).toBeUndefined();
    expect(room.activeHandoffId).toBeUndefined();
  });
});
