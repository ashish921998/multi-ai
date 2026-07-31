import { describe, it, expect } from "vitest";
import { isHealthy } from "../lib/agent";
import type { Doc } from "../../_generated/dataModel";

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
