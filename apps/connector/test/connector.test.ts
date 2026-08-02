import { describe, it, expect, vi } from "vitest";
import { runConnector, type RoomAgentClient, type AgentResponder } from "../src/connector.ts";

/** Fake scheduler that records every registered interval so tests can tick them. */
class FakeScheduler {
  callbacks: Array<{ ms: number; fn: () => void }> = [];
  every(ms: number, fn: () => void): () => void {
    const entry = { ms, fn };
    this.callbacks.push(entry);
    return () => {
      this.callbacks = this.callbacks.filter((c) => c !== entry);
    };
  }
  tick(groupMs: number) {
    for (const c of this.callbacks) if (c.ms === groupMs) c.fn();
  }
}

function makeClient(overrides: Partial<RoomAgentClient> = {}): RoomAgentClient & {
  calls: string[];
  writes: Array<{ path: string; body: string; base: { id: string; version: number } | null }>;
  handoffListeners: Array<() => void>;
  nextHandoff: () => void;
} {
  const calls: string[] = [];
  const writes: Array<{ path: string; body: string; base: { id: string; version: number } | null }> = [];
  const handoffListeners: Array<() => void> = [];
  let pendingHandoff = {
    pending: true,
    handoffId: "handoff-1",
    body: "# Room handoff\n\nNew discussion",
    includedSeqs: [3],
    hasVisionContent: false,
    screenshots: [],
    workspaceDocument: {
      id: "doc-1",
      path: "plan.md",
      body: "# Existing plan",
      version: 4,
    },
  };
  const base: RoomAgentClient = {
    async connect() {
      calls.push("connect");
      return {
        agentConnectionId: "conn-1",
        roomId: "ROOM1",
        boundarySeq: 0,
        heartbeatIntervalMs: 10000,
      };
    },
    async fetchHandoff() {
      calls.push("fetch");
      return pendingHandoff;
    },
    async respond(_id, _handoffId, opts) {
      calls.push(`respond:${opts.chunk ? "chunk" : opts.complete ? "complete" : "failed"}`);
    },
    async heartbeat() {
      calls.push("heartbeat");
    },
    async disconnect() {
      calls.push("disconnect");
    },
    async writeDocument(_id, _roomId, path, body, documentBase) {
      writes.push({ path, body, base: documentBase });
      return 1;
    },
    onHandoffSignal(handler) {
      handoffListeners.push(handler);
      return () => {};
    },
    ...overrides,
  };
  return Object.assign(base, {
    calls,
    writes,
    handoffListeners,
    nextHandoff: () => handoffListeners.forEach((h) => h()),
  });
}

function chunkedResponder(chunks: string[], shouldThrow = false): AgentResponder {
  return {
    async *stream() {
      if (shouldThrow) throw new Error("agent blew up");
      for (const c of chunks) yield c;
    },
  };
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function baseDeps(client: RoomAgentClient, responder: AgentResponder) {
  const controller = new AbortController();
  return {
    controller,
    deps: {
      client,
      responder,
      scheduler: new FakeScheduler(),
      roomId: "ROOM1",
      connectionCode: "ABCD-2345",
      supportsVision: false,
      pollIntervalMs: 5000,
      shutdownDrainTimeoutMs: 20,
      stopSignal: controller.signal,
      log: () => {},
    },
  };
}

describe("runConnector", () => {
  it("connects, heartbeats on the interval, and disconnects on stop", async () => {
    const client = makeClient();
    const { controller, deps } = baseDeps(client, chunkedResponder(["a"]));
    const scheduler = deps.scheduler as FakeScheduler;

    const done = runConnector(deps);
    await flush();

    expect(client.calls).toContain("connect");
    scheduler.tick(10000);
    expect(client.calls.filter((c) => c === "heartbeat")).toHaveLength(1);
    scheduler.tick(10000);
    expect(client.calls.filter((c) => c === "heartbeat")).toHaveLength(2);

    controller.abort();
    await done;
    expect(client.calls).toContain("disconnect");
  });

  it("disconnects after the shutdown drain limit when a handoff request stalls", async () => {
    const client = makeClient({
      async fetchHandoff() {
        return await new Promise<never>(() => {});
      },
    });
    const messages: string[] = [];
    const { controller, deps } = baseDeps(client, chunkedResponder(["unused"]));
    deps.log = (message) => messages.push(message);

    const done = runConnector(deps);
    await flush();
    client.nextHandoff();
    await flush();

    controller.abort();
    await Promise.race([
      done,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("connector shutdown stalled")), 200),
      ),
    ]);

    expect(client.calls).toContain("disconnect");
    expect(messages).toContain("Handoff did not settle within 20ms; forcing disconnect.");
  });

  it("resolves after the shutdown limit when disconnect stalls", async () => {
    const client = makeClient({
      async disconnect() {
        return await new Promise<never>(() => {});
      },
    });
    const messages: string[] = [];
    const { controller, deps } = baseDeps(client, chunkedResponder(["unused"]));
    deps.log = (message) => messages.push(message);

    const done = runConnector(deps);
    await flush();
    controller.abort();

    await Promise.race([
      done,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("connector shutdown stalled")), 200),
      ),
    ]);

    expect(messages).toContain("Disconnect failed: timed out after 20ms.");
    expect(messages.at(-1)).toBe("Disconnected.");
  });

  it("logs a disconnect failure and still resolves", async () => {
    const client = makeClient({
      async disconnect() {
        throw new Error("disconnect mutation failed");
      },
    });
    const messages: string[] = [];
    const { controller, deps } = baseDeps(client, chunkedResponder(["unused"]));
    deps.log = (message) => messages.push(message);

    const done = runConnector(deps);
    await flush();
    controller.abort();
    await done;

    expect(messages).toContain("Disconnect failed: Error: disconnect mutation failed");
    expect(messages.at(-1)).toBe("Disconnected.");
  });

  it("finalizes an active handoff before disconnecting on stop", async () => {
    const client = makeClient();
    const responder: AgentResponder = {
      async *stream(_handoff, signal) {
        yield "partial";
        await new Promise<void>((_resolve, reject) => {
          const stop = () => reject(new Error("agent stopped"));
          if (signal.aborted) stop();
          else signal.addEventListener("abort", stop, { once: true });
        });
      },
    };
    const { controller, deps } = baseDeps(client, responder);

    const done = runConnector(deps);
    await flush();
    client.nextHandoff();
    await flush();

    controller.abort();
    await done;

    expect(client.calls.indexOf("respond:failed")).toBeGreaterThan(-1);
    expect(client.calls.indexOf("respond:failed")).toBeLessThan(
      client.calls.indexOf("disconnect"),
    );
  });

  it("streams a handoff to the responder and completes it", async () => {
    const client = makeClient();
    const { controller, deps } = baseDeps(client, chunkedResponder(["Hello ", "world"]));

    const done = runConnector(deps);
    await flush();

    client.nextHandoff();
    await flush();

    expect(client.calls).toContain("fetch");
    expect(client.calls.filter((c) => c === "respond:chunk")).toHaveLength(2);
    expect(client.calls).toContain("respond:complete");

    controller.abort();
    await done;
  });

  it("writes the plan document after a completed handoff (issue 0013)", async () => {
    const client = makeClient();
    const { controller, deps } = baseDeps(client, chunkedResponder(["Hello ", "world"]));

    const done = runConnector(deps);
    await flush();

    client.nextHandoff();
    await flush();

    expect(client.writes).toEqual([
      { path: "plan.md", body: "Hello world", base: { id: "doc-1", version: 4 } },
    ]);

    controller.abort();
    await done;
  });

  it("does not overwrite a concurrent document edit when the OCC write fails", async () => {
    const messages: string[] = [];
    const client = makeClient({
      async writeDocument() {
        throw new Error("doc write unavailable");
      },
    });
    const { controller, deps } = baseDeps(client, chunkedResponder(["plan text"]));
    deps.log = (m) => messages.push(m);

    const done = runConnector(deps);
    await flush();

    client.nextHandoff();
    await flush();

    // The handoff still completed; the doc-write failure was only logged.
    expect(client.calls).toContain("respond:complete");
    expect(messages.some((m) => m.includes("doc write unavailable"))).toBe(true);

    controller.abort();
    await done;
  });

  it("marks the handoff failed when the responder throws", async () => {
    const client = makeClient();
    const { controller, deps } = baseDeps(client, chunkedResponder([], true));

    const done = runConnector(deps);
    await flush();

    client.nextHandoff();
    await flush();

    expect(client.calls).toContain("respond:failed");
    expect(client.calls).not.toContain("respond:complete");

    controller.abort();
    await done;
  });

  it("does not double-process a handoff that is already in flight", async () => {
    const client = makeClient();
    let resolveStream: () => void = () => {};
    const responder: AgentResponder = {
      async *stream() {
        await new Promise<void>((r) => (resolveStream = r));
        yield "done";
      },
    };
    const { controller, deps } = baseDeps(client, responder);
    const scheduler = deps.scheduler as FakeScheduler;

    const done = runConnector(deps);
    await flush();

    client.nextHandoff();
    await flush();
    // Fire the signal and the poll again while still streaming.
    client.nextHandoff();
    scheduler.tick(5000);
    await flush();

    resolveStream();
    await flush();

    expect(client.calls.filter((c) => c === "fetch")).toHaveLength(1);
    expect(client.calls.filter((c) => c === "respond:complete")).toHaveLength(1);

    controller.abort();
    await done;
  });

  it("polls for handoffs as a fallback when no signal arrives", async () => {
    const client = makeClient();
    const { controller, deps } = baseDeps(client, chunkedResponder(["x"]));
    const scheduler = deps.scheduler as FakeScheduler;

    const done = runConnector(deps);
    await flush();

    // No realtime signal — the poll discovers the handoff.
    scheduler.tick(5000);
    await flush();

    expect(client.calls).toContain("fetch");
    expect(client.calls).toContain("respond:complete");

    controller.abort();
    await done;
  });

  it("logs but keeps running when a transient fetch error occurs", async () => {
    const messages: string[] = [];
    const client = makeClient({
      async fetchHandoff() {
        throw new Error("transient");
      },
    });
    const { controller, deps } = baseDeps(client, chunkedResponder(["x"]));
    deps.log = (m) => messages.push(m);
    const scheduler = deps.scheduler as FakeScheduler;

    const done = runConnector(deps);
    await flush();

    scheduler.tick(5000);
    await flush();

    expect(messages.some((m) => m.includes("transient"))).toBe(true);

    controller.abort();
    await done;
  });
});
