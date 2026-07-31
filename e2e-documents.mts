/**
 * Live smoke test of the workspace document surface ("build on" substrate).
 *
 * Asserts the contract as shipped after issues 0011–0013:
 *   1. participant writes are REJECTED (agent-only — issue 0012)
 *   2. agent writes succeed, with OCC + restore (issue 0012)
 *   3. participant reads still work (issue 0011)
 *   4. a real handoff makes the connector auto-write `plan.md` (issue 0013)
 *
 * Run: npx tsx e2e-documents.mts
 */
import { spawn } from "node:child_process";
import { ConvexClient } from "convex/browser";
import { api } from "./convex/api.ts";
import type { Id } from "./convex/_generated/dataModel.ts";

const CONVEX_URL = process.env.CONVEX_URL ?? "https://nautical-ermine-841.convex.cloud";
const log = (m: string) => console.log(`[doc] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForStdout(child: { stdout: NodeJS.ReadableStream }, needle: string, timeoutMs = 40000): Promise<void> {
  return new Promise((resolve, reject) => {
    const buf: Buffer[] = [];
    const t = setTimeout(() => reject(new Error(`Timed out waiting for: "${needle}"`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      buf.push(chunk);
      if (Buffer.concat(buf).toString().includes(needle)) {
        clearTimeout(t);
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
  });
}

/** True if the call threw a ConvexError matching `pattern`. */
async function rejects(
  fn: () => Promise<unknown>,
  pattern: RegExp,
): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof Error && pattern.test(e.message);
  }
}

async function main() {
  const client = new ConvexClient(CONVEX_URL);
  log(`deployment: ${CONVEX_URL}`);

  // --- room + participant ---
  const room = await client.mutation(api.rooms.createRoom, { title: "Doc Workspace Test" });
  const joined = await client.mutation(api.rooms.joinRoom, {
    roomId: room.roomId, password: room.password, displayName: "Author",
  });
  const token = joined.sessionToken;
  log(`room ${room.roomId}, joined as ${joined.displayName}`);

  // --- connect the agent (the only legal writer) ---
  const code = await client.mutation(api.connectCode.issue, { roomId: room.roomId, sessionToken: token });
  const tsxPath = `${process.cwd()}/apps/connector/node_modules/.bin/tsx`;
  const child = spawn("npx", [tsxPath, "apps/connector/src/cli.ts", "connect", room.roomId, code.connectionCode], {
    env: { ...process.env, CONVEX_URL, PATH: `${process.cwd()}/apps/connector/node_modules/.bin:${process.env.PATH ?? ""}` },
    stdio: ["inherit", "pipe", "pipe"],
  });
  try {
    await waitForStdout(child, "as the active agent");

    const state = await client.query(api.rooms.state, { roomId: room.roomId, sessionToken: token });
    const agentConnId = state!.agent.connectionId as Id<"agentConnections">;
    log(`agent connected: ${agentConnId}`);

    // --- 1. AGENT CREATES A DOC (gives us a real id for the rejection checks) ---
    const created = await client.mutation(api.documents.create, {
      roomId: room.roomId, agentConnectionId: agentConnId,
      path: "spec.md", body: "# Spec\n\nv1 by agent.", summary: "Initial draft",
    });
    if (created.version !== 1) throw new Error("create should start at v1");
    log(`agent created "${created.path}" v${created.version} (${created.format}) ✓`);

    // --- 2. PARTICIPANT WRITES ARE REJECTED BY AUTHZ (issue 0012) ---
    // Uses the real doc id above so the validator passes and the agent-only
    // guard is what rejects the call.
    const createRejected = await rejects(
      () => client.mutation(api.documents.create, {
        roomId: room.roomId, sessionToken: token,
        path: "plan.md", body: "nope", summary: "human tries to create",
      }),
      /only the active .* agent/i,
    );
    if (!createRejected) throw new Error("participant create should be rejected");
    log("participant create rejected ✓");

    const updateRejected = await rejects(
      () => client.mutation(api.documents.update, {
        roomId: room.roomId, sessionToken: token, documentId: created.id,
        body: "nope", expectedVersion: 1,
      }),
      /only the active .* agent/i,
    );
    if (!updateRejected) throw new Error("participant update should be rejected");
    log("participant update rejected ✓");

    const restoreRejected = await rejects(
      () => client.mutation(api.documents.restore, {
        roomId: room.roomId, sessionToken: token, documentId: created.id,
        version: 1, expectedVersion: 1,
      }),
      /only the active .* agent/i,
    );
    if (!restoreRejected) throw new Error("participant restore should be rejected");
    log("participant restore rejected ✓");

    // --- 3. AGENT WRITES SUCCEED: OCC + update (issue 0012) ---
    const occRejected = await rejects(
      () => client.mutation(api.documents.update, {
        roomId: room.roomId, agentConnectionId: agentConnId, documentId: created.id,
        body: "stale", expectedVersion: 999,
      }),
      /changed since you last read/i,
    );
    if (!occRejected) throw new Error("stale expectedVersion should be rejected");
    log("OCC guard works: stale agent write rejected ✓");

    // Agent updates with the right version → v2.
    const agentEdit = await client.mutation(api.documents.update, {
      roomId: room.roomId, agentConnectionId: agentConnId, documentId: created.id,
      body: "# Spec\n\nv1 by agent.\n\n## Decisions\n- Convex", expectedVersion: 1, summary: "added decisions",
    });
    if (agentEdit.version !== 2) throw new Error("agent update should bump to v2");
    log(`agent wrote v${agentEdit.version} ✓`);

    // --- 4. PARTICIPANT READS STILL WORK (issue 0011) ---
    const read = await client.query(api.documents.read, {
      roomId: room.roomId, sessionToken: token, documentId: created.id,
    });
    if (read.lastAuthorKind !== "agent") throw new Error("latest author should be agent");
    if (read.version !== 2) throw new Error("participant should see v2");
    log(`participant read ok: "${read.path}" v${read.version}, authorKind=${read.lastAuthorKind} ✓`);

    const list = await client.query(api.documents.list, { roomId: room.roomId, sessionToken: token });
    if (list.length !== 1) throw new Error(`list should have 1 doc, got ${list.length}`);
    log(`participant list ok: ${list.map((d) => `${d.path}@v${d.version}`).join(", ")} ✓`);

    const hist = await client.query(api.documents.history, {
      roomId: room.roomId, sessionToken: token, documentId: created.id,
    });
    if (hist.length !== 2 || hist[0].version !== 2) throw new Error("history should be [v2, v1] newest-first");
    log(`participant history ok: ${hist.map((h) => `v${h.version}(${h.authorKind})`).join(" → ")} ✓`);

    // --- 5. CONNECTOR AUTO-WRITES plan.md ON A HANDOFF (issue 0013) ---
    await client.mutation(api.messages.post, {
      roomId: room.roomId, sessionToken: token,
      text: "Let's plan the document model end to end.", screenshotIds: [],
    });
    await client.mutation(api.handoff.send, { roomId: room.roomId, sessionToken: token });
    log("sent handoff; waiting for the connector to respond + write plan.md…");

    // Poll until an agent message completes (the connector streams the echo).
    const deadline = Date.now() + 30000;
    let agentDone = false;
    while (Date.now() < deadline) {
      await sleep(500);
      const s = await client.query(api.rooms.state, { roomId: room.roomId, sessionToken: token });
      const agentMsg = s?.messages.find((m) => m.authorKind === "agent");
      if (agentMsg && agentMsg.status === "complete") { agentDone = true; break; }
    }
    if (!agentDone) throw new Error("agent response did not complete in the timeline");
    log("agent responded in the timeline ✓");

    // plan.md should now exist with the echoed body.
    const docsAfter = await client.query(api.documents.list, { roomId: room.roomId, sessionToken: token });
    const plan = docsAfter.find((d) => d.path === "plan.md");
    if (!plan) throw new Error("connector did not create plan.md");
    const planBody = await client.query(api.documents.read, {
      roomId: room.roomId, sessionToken: token, documentId: plan.id,
    });
    if (!planBody.body.includes("Echo responder")) throw new Error("plan.md body missing the agent's response");
    log(`plan.md written by connector at v${plan.version} (${planBody.body.length} bytes) ✓`);

    log("\n✅✅✅ DOCUMENT SURFACE WORKS END-TO-END (agent-only writes + auto plan.md) ✅✅✅");
    process.exit(0);
  } finally {
    child.kill("SIGKILL");
    await client.close();
  }
}

main().catch((err) => {
  console.error(`\n❌ DOC SMOKE TEST FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
