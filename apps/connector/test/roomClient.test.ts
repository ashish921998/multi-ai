import { describe, expect, it, vi } from "vitest";
import { ConvexRoomAgentClient } from "../src/roomClient.ts";

describe("ConvexRoomAgentClient", () => {
  it("preserves both failures when disconnect and client close fail", async () => {
    const disconnectError = new Error("disconnect mutation failed");
    const closeError = new Error("socket close failed");
    const convexClient = {
      mutation: vi.fn().mockRejectedValue(disconnectError),
      close: vi.fn().mockRejectedValue(closeError),
    };
    const client = new ConvexRoomAgentClient(
      () => convexClient as never,
      "https://example.convex.cloud",
    );

    await expect(client.disconnect("connection-1")).rejects.toMatchObject({
      errors: [disconnectError, closeError],
    });
  });

  it("does not create a replacement client after shutdown begins", async () => {
    let finishClose!: () => void;
    const closing = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const convexClient = {
      mutation: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(() => closing),
    };
    const createClient = vi.fn(() => convexClient as never);
    const client = new ConvexRoomAgentClient(createClient, "https://example.convex.cloud");

    await client.heartbeat("connection-1");
    const closePromise = client.close();

    try {
      await expect(client.heartbeat("connection-1")).rejects.toThrow("closed");
      expect(createClient).toHaveBeenCalledTimes(1);
    } finally {
      finishClose();
      await closePromise;
    }
  });
});
