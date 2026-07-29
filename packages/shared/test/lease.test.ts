import { describe, it, expect } from "vitest";
import { evaluateLease, canAcquireActiveSlot, DEFAULT_LEASE_CONFIG } from "../src/lease.ts";
import type { AgentConnection } from "../src/types.ts";

function activeConnection(lastHeartbeatAt: number, id = "conn-1"): AgentConnection {
  return {
    id,
    roomId: "room-1",
    participantId: "p-1",
    connectionCode: "ABCD1234",
    status: "active",
    lastHeartbeatAt,
    createdAt: lastHeartbeatAt,
    releasedAt: null,
  };
}

const NOW = 1_700_000_000_000;

describe("evaluateLease", () => {
  it("reports a freshly-beaconed connection as active", () => {
    const conn = activeConnection(NOW);
    const result = evaluateLease(conn, NOW, DEFAULT_LEASE_CONFIG);

    expect(result.isActive).toBe(true);
    expect(result.nextStatus).toBeNull();
    expect(result.ageMs).toBe(0);
  });

  it("expires a connection that missed heartbeats past the timeout", () => {
    const conn = activeConnection(NOW - DEFAULT_LEASE_CONFIG.heartbeatTimeoutMs - 1);
    const result = evaluateLease(conn, NOW, DEFAULT_LEASE_CONFIG);

    expect(result.isActive).toBe(false);
    expect(result.nextStatus).toBe("disconnected");
  });

  it("keeps a connection active exactly at the timeout boundary", () => {
    const conn = activeConnection(NOW - DEFAULT_LEASE_CONFIG.heartbeatTimeoutMs);
    const result = evaluateLease(conn, NOW, DEFAULT_LEASE_CONFIG);

    expect(result.isActive).toBe(true);
    expect(result.nextStatus).toBeNull();
  });

  it("does not try to re-disconnect an already disconnected connection", () => {
    const conn = activeConnection(NOW - 60_000);
    conn.status = "disconnected";
    const result = evaluateLease(conn, NOW, DEFAULT_LEASE_CONFIG);

    expect(result.isActive).toBe(false);
    expect(result.nextStatus).toBeNull();
  });
});

describe("canAcquireActiveSlot", () => {
  it("allows acquisition when no connection currently holds the slot", () => {
    const decision = canAcquireActiveSlot(null, NOW, DEFAULT_LEASE_CONFIG);

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("slot-free");
  });

  it("denies acquisition while another healthy connection holds the slot", () => {
    const holder = activeConnection(NOW, "other-conn");
    const decision = canAcquireActiveSlot(holder, NOW, DEFAULT_LEASE_CONFIG);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("slot-held-by-other");
  });

  it("allows acquisition once the holding connection has expired", () => {
    const holder = activeConnection(NOW - DEFAULT_LEASE_CONFIG.heartbeatTimeoutMs - 1, "other-conn");
    const decision = canAcquireActiveSlot(holder, NOW, DEFAULT_LEASE_CONFIG);

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("slot-free");
  });

  it("allows re-acquisition by the same connection id (reconnect)", () => {
    const holder = activeConnection(NOW, "same-conn");
    const decision = canAcquireActiveSlot(holder, NOW, DEFAULT_LEASE_CONFIG, "same-conn");

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("same-connection");
  });
});
