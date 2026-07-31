/**
 * Live smoke test of the workspace document surface ("build on" substrate).
 *
 * Proves the three primitives against the live Convex deployment:
 *   1. durable documents (create/read/list)
 *   2. agent + participant co-editing (both write the same doc)
 *   3. version history with optimistic concurrency + restore
 *
 * Run: npx tsx e2e-documents.mts
 */
import { spawn } from "node:child_process";
import { ConvexClient } from "convex/browser";
import { api } from "./convex/api.ts";

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

  // --- connect the agent (so it can co-edit) ---
  const code = await client.mutation(api.connectCode.issue, { roomId: room.roomId, sessionToken: token });
  const tsxPath = `${process.cwd()}/apps/connector/node_modules/.bin/tsx`;
  const child = spawn("npx", [tsxPath, "apps/connector/src/cli.ts", "connect", room.roomId, code.connectionCode], {
    env: { ...process.env, CONVEX_URL, PATH: `${process.cwd()}/apps/connector/node_modules/.bin:${process.env.PATH ?? ""}` },
    stdio: ["inherit", "pipe", "pipe"],
  });
  try {
    await waitForStdout(child, "as the active agent");

    // find the agent's connection id via room state
    const state = await client.query(api.rooms.state, { roomId: room.roomId, sessionToken: token });
    const agentConnId = state!.agent.connectionId;
    log(`agent connected: ${agentConnId}`);

    // --- 1. CREATE a document as the participant ---
    const created = await client.mutation(api.documents.create, {
      roomId: room.roomId, sessionToken: token,
      path: "plan.md", body: "# Plan\n\nv1 by human.", summary: "Initial draft",
    });
    log(`created "${created.path}" v${created.version} (${created.format})`);
    if (created.version !== 1) throw new Error("create should start at v1");

    // --- READ it back ---
    const doc = await client.query(api.documents.read, {
      roomId: room.roomId, sessionToken: token, documentId: created.id,
    });
    if (doc.body !== "# Plan\n\nv1 by human.") throw new Error("read body mismatch");
    if (doc.lastAuthorKind !== "participant") throw new Error("first author should be participant");
    log(`read ok: "${doc.path}" v${doc.version}, authorKind=${doc.lastAuthorKind}`);

    // --- 2. STALE WRITE is rejected (optimistic concurrency) ---
    let occRejected = false;
    try {
      await client.mutation(api.documents.update, {
        roomId: room.roomId, sessionToken: token, documentId: created.id,
        body: "stale", expectedVersion: 999,
      });
    } catch (e) {
      occRejected = e instanceof Error && /changed since you last read/i.test(e.message);
    }
    if (!occRejected) throw new Error("stale expectedVersion should have been rejected");
    log("OCC guard works: stale write rejected ✓");

    // --- 3. AGENT co-edits the SAME document ("build on") ---
    const agentEdit = await client.mutation(api.documents.update, {
      roomId: room.roomId, agentConnectionId: agentConnId, documentId: created.id,
      body: "# Plan\n\nv1 by human.\n\n## Decisions\n- Use Convex (added by agent)",
      expectedVersion: 1, summary: "Agent added decisions section",
    });
    if (agentEdit.version !== 2) throw new Error("agent update should bump to v2");
    log(`agent wrote v${agentEdit.version} on the same doc — human & agent co-editing ✓`);

    // --- 4. PARTICIPANT builds on the agent's version ---
    const humanEdit = await client.mutation(api.documents.update, {
      roomId: room.roomId, sessionToken: token, documentId: created.id,
      body: "# Plan\n\nv1 by human.\n\n## Decisions\n- Use Convex (added by agent)\n\n## Open questions\n- auth?",
      expectedVersion: 2, summary: "Added open questions",
    });
    log(`participant built on agent's v2 → v${humanEdit.version} ✓`);

    // --- 5. HISTORY shows the accumulation ---
    const hist = await client.query(api.documents.history, {
      roomId: room.roomId, sessionToken: token, documentId: created.id,
    });
    if (hist.length !== 3) throw new Error(`expected 3 versions, got ${hist.length}`);
    if (hist[0].version !== 3) throw new Error("history should be newest-first");
    log(`history: ${hist.map((h) => `v${h.version}(${h.authorKind})`).join(" → ")} ✓`);

    // --- 6. RESTORE v1 as a NEW version ---
    const restored = await client.mutation(api.documents.restore, {
      roomId: room.roomId, sessionToken: token, documentId: created.id,
      version: 1, expectedVersion: 3,
    });
    if (restored.version !== 4) throw new Error("restore should create v4");
    const after = await client.query(api.documents.read, {
      roomId: room.roomId, sessionToken: token, documentId: created.id,
    });
    if (after.body !== "# Plan\n\nv1 by human.") throw new Error("restore should bring back v1 body");
    log(`restored v1 → now v${restored.version} with v1's body, history intact ✓`);

    // --- LIST ---
    const list = await client.query(api.documents.list, { roomId: room.roomId, sessionToken: token });
    if (list.length !== 1) throw new Error("list should have 1 doc");
    log(`list: ${list.map((d) => `${d.path}@v${d.version}`).join(", ")} ✓`);

    log("\n✅✅✅ DOCUMENT WORKSPACE SURFACE WORKS END-TO-END ✅✅✅");
    log("  human + agent co-edited the same document, with OCC + version history + restore");
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
