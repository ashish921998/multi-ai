/**
 * Live smoke test of the collaborative workspace document surface.
 *
 * Proves against a deployed Convex backend and the real local connector:
 *   1. a participant creates and reads plan.md;
 *   2. a real handoff gives Pi the current plan and auto-writes the response;
 *   3. participants build on Pi's version with optimistic concurrency;
 *   4. history is retained and restore creates a new latest version.
 *
 * Run: npx tsx e2e-documents.mts
 */
import { spawn } from "node:child_process";
import { ConvexClient } from "convex/browser";
import { api } from "./convex/api.ts";
import type { Id } from "./convex/_generated/dataModel.ts";

const CONVEX_URL = process.env.CONVEX_URL ?? "https://nautical-ermine-841.convex.cloud";
const DISCUSSION = "Add an explicit verification step and preserve the existing objective.";
const INITIAL_PLAN = "# Plan\n\n## Objective\n\nShip a collaborative workspace.";
const log = (message: string) => console.log(`[doc] ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForStdout(
  child: { stdout: NodeJS.ReadableStream },
  needle: string,
  timeoutMs = 40_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for: "${needle}"`)),
      timeoutMs,
    );
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).toString().includes(needle)) {
        clearTimeout(timeout);
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

  const room = await client.mutation(api.rooms.createRoom, { title: "Document Workspace Test" });
  const joined = await client.mutation(api.rooms.joinRoom, {
    roomId: room.roomId,
    password: room.password,
    displayName: "Author",
  });
  const sessionToken = joined.sessionToken;
  log(`room ${room.roomId}, joined as ${joined.displayName}`);

  // A human starts the durable artifact before Pi connects.
  const created = await client.mutation(api.documents.create, {
    roomId: room.roomId,
    sessionToken,
    path: "plan.md",
    body: INITIAL_PLAN,
    summary: "Initial human draft",
  });
  if (created.version !== 1) throw new Error("create should start at v1");
  log(`participant created ${created.path}@v${created.version}`);

  await client.mutation(api.messages.post, {
    roomId: room.roomId,
    sessionToken,
    text: DISCUSSION,
    screenshotIds: [],
  });

  const code = await client.mutation(api.connectCode.issue, {
    roomId: room.roomId,
    sessionToken,
  });
  const tsxPath = `${process.cwd()}/apps/connector/node_modules/.bin/tsx`;
  const child = spawn(
    "npx",
    [tsxPath, "apps/connector/src/cli.ts", "connect", room.roomId, code.connectionCode],
    {
      env: {
        ...process.env,
        CONVEX_URL,
        ROOM_AGENT_COMMAND: "",
        PATH: `${process.cwd()}/apps/connector/node_modules/.bin:${process.env.PATH ?? ""}`,
      },
      stdio: ["inherit", "pipe", "pipe"],
    },
  );
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[connector] ${chunk}`));

  try {
    await waitForStdout(child, "as the active agent");
    log("connector active");

    // The connector's EchoResponder builds on the exact plan snapshot and then
    // writes the complete response through the normal agent document path.
    await client.mutation(api.handoff.send, { roomId: room.roomId, sessionToken });

    let agentPlan: Awaited<ReturnType<typeof readPlan>> | null = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await sleep(400);
      const next = await readPlan(client, room.roomId, sessionToken, created.id);
      if (next.version >= 2) {
        agentPlan = next;
        break;
      }
    }
    if (!agentPlan) throw new Error("connector did not auto-write plan.md");
    if (agentPlan.version !== 2) throw new Error(`expected agent v2, got v${agentPlan.version}`);
    if (!agentPlan.body.includes(INITIAL_PLAN)) throw new Error("Pi did not preserve the existing plan");
    if (!agentPlan.body.includes(DISCUSSION)) throw new Error("Pi's plan did not include the new discussion");
    if (agentPlan.lastAuthorKind !== "agent") throw new Error("v2 should be authored by the agent");
    log("real handoff built on plan.md and auto-wrote v2 ✓");

    // A stale write cannot overwrite Pi's version.
    let staleRejected = false;
    try {
      await client.mutation(api.documents.update, {
        roomId: room.roomId,
        sessionToken,
        documentId: created.id,
        body: "stale",
        expectedVersion: 1,
      });
    } catch (error) {
      staleRejected = error instanceof Error && /changed since you last read/i.test(error.message);
    }
    if (!staleRejected) throw new Error("stale expectedVersion should have been rejected");
    log("OCC guard rejected a stale participant write ✓");

    // The participant builds on the agent's exact latest body.
    const humanBody = `${agentPlan.body}\n\n## Human review\n\nApproved with tests.`;
    const humanEdit = await client.mutation(api.documents.update, {
      roomId: room.roomId,
      sessionToken,
      documentId: created.id,
      body: humanBody,
      expectedVersion: 2,
      summary: "Human review",
    });
    if (humanEdit.version !== 3) throw new Error("participant update should create v3");
    log("participant built on Pi's v2 → v3 ✓");

    const history = await client.query(api.documents.history, {
      roomId: room.roomId,
      sessionToken,
      documentId: created.id,
    }) as Array<{ version: number; authorKind: "participant" | "agent" }>;
    if (history.length !== 3) throw new Error(`expected 3 versions, got ${history.length}`);
    if (history[0].version !== 3 || history[1].authorKind !== "agent") {
      throw new Error("history order or authorship is incorrect");
    }
    log(`history: ${history.map((entry) => `v${entry.version}(${entry.authorKind})`).join(" → ")} ✓`);

    const restored = await client.mutation(api.documents.restore, {
      roomId: room.roomId,
      sessionToken,
      documentId: created.id,
      version: 1,
      expectedVersion: 3,
    });
    const afterRestore = await readPlan(client, room.roomId, sessionToken, created.id);
    if (restored.version !== 4 || afterRestore.body !== INITIAL_PLAN) {
      throw new Error("restore should write v1's body as v4");
    }
    log("restored v1 as v4 without rewriting history ✓");

    const list = await client.query(api.documents.list, {
      roomId: room.roomId,
      sessionToken,
    });
    if (list.length !== 1 || list[0].version !== 4) throw new Error("document list mismatch");

    log("\n✅✅✅ COLLABORATIVE DOCUMENT WORKSPACE PASSED END-TO-END ✅✅✅");
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      sleep(2_000).then(() => { child.kill("SIGKILL"); }),
    ]);
    await client.close();
  }
}

async function readPlan(
  client: ConvexClient,
  roomId: string,
  sessionToken: string,
  documentId: string,
): Promise<{
  id: Id<"documents">;
  path: string;
  body: string;
  version: number;
  lastAuthorKind: "participant" | "agent";
}> {
  return client.query(api.documents.read, {
    roomId,
    sessionToken,
    documentId: documentId as Id<"documents">,
  });
}

main().catch((error) => {
  console.error(`\n❌ DOC SMOKE TEST FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
