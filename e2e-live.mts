/**
 * End-to-end connector test against the LIVE Convex deployment.
 *
 * Drives the real connector CLI binary through the full agent lifecycle:
 *   create room → join → issue connect code → spawn `room connect`
 *   → post message → send handoff → verify a custom stdin echo harness streams into timeline
 *   → SIGTERM → verify clean disconnect.
 *
 * Run: npx tsx e2e-live.mts
 */
import { spawn } from "node:child_process";
import { ConvexClient } from "convex/browser";
import { api } from "./convex/api.ts";

const CONVEX_URL = process.env.CONVEX_URL ?? "https://nautical-ermine-841.convex.cloud";
const MESSAGE_TEXT = "What is 2+2? Please plan the addition.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[e2e] ${m}`);

async function waitForStdout(child: { stdout: NodeJS.ReadableStream }, needle: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const buf: Buffer[] = [];
    const t = setTimeout(() => reject(new Error(`Timed out waiting for stdout: "${needle}"`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      buf.push(chunk);
      const text = Buffer.concat(buf).toString();
      if (text.includes(needle)) {
        clearTimeout(t);
        child.stdout.off("data", onData);
        resolve(text);
      }
    };
    child.stdout.on("data", onData);
  });
}

async function main() {
  const client = new ConvexClient(CONVEX_URL);
  log(`Using Convex deployment: ${CONVEX_URL}`);

  // 1. Create room
  const room = await client.mutation(api.rooms.createRoom, { title: "E2E Connector Test" });
  log(`Created room ${room.roomId} (password ${room.password})`);

  // 2. Join as participant
  const joined = await client.mutation(api.rooms.joinRoom, {
    roomId: room.roomId,
    password: room.password,
    displayName: "TestUser",
  });
  const sessionToken = joined.sessionToken;
  log(`Joined as ${joined.displayName} (participant ${joined.participantId})`);

  // 3. Issue connection code
  const code = await client.mutation(api.connectCode.issue, { roomId: room.roomId, sessionToken });
  log(`Issued one-time connect code: ${code.connectionCode}`);
  log(`Connector command: ${code.command}`);

  // 4. Post a participant message BEFORE the connector connects
  await client.mutation(api.messages.post, {
    roomId: room.roomId,
    sessionToken,
    text: MESSAGE_TEXT,
    screenshotIds: [],
  });
  log(`Posted participant message: "${MESSAGE_TEXT}"`);

  // 5. Spawn the REAL connector binary. Run tsx from the connector's own
  //    node_modules so the child does not depend on a global PATH entry.
  const tsxCli = `${process.cwd()}/apps/connector/node_modules/tsx/dist/cli.mjs`;
  const child = spawn(process.execPath, [
    tsxCli,
    "apps/connector/src/cli.ts",
    "connect",
    room.roomId,
    code.connectionCode,
    "--agent",
    "custom",
    "--command",
    process.execPath,
    "--arg=-e",
    "--arg=process.stdin.pipe(process.stdout)",
  ], {
    env: {
      ...process.env,
      CONVEX_URL,
      ROOM_AGENT_COMMAND: "",
      ROOM_AGENT_ARGS: "",
    },
    stdio: ["inherit", "pipe", "pipe"],
  });
  const connOut: string[] = [];
  child.stdout.on("data", (c: Buffer) => connOut.push(c.toString()));
  child.stderr.on("data", (c: Buffer) => process.stderr.write(`[connector stderr] ${c}`));

  try {
    // Wait for the connector to become the active agent.
    await waitForStdout(child, "as the active agent", 40000);
    log("Connector connected and is the active agent.");

    // Verify room state now shows the agent active.
    let state = await client.query(api.rooms.state, { roomId: room.roomId, sessionToken });
    if (!state?.agent.active) throw new Error("Room state does not show agent as active after connect.");
    log(`Room state confirms agent active (supportsVision=${state.agent.supportsVision}, boundarySeq=${state.boundarySeq}).`);

    // 6. Send the handoff to the agent.
    log("Sending handoff to agent…");
    await client.mutation(api.handoff.send, { roomId: room.roomId, sessionToken });

    // 7. Poll rooms.state until an agent message with status "complete" appears.
    let agentMsg: { text: string; status: string } | null = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await sleep(500);
      state = await client.query(api.rooms.state, { roomId: room.roomId, sessionToken });
      if (!state) continue;
      const found = state.messages.find((m) => m.authorKind === "agent");
      if (found) {
        agentMsg = { text: found.text, status: found.status };
        if (found.status === "complete") break;
      }
    }

    // 8. Assertions
    if (!agentMsg) throw new Error("No agent message appeared in the timeline.");
    log(`Agent message status: ${agentMsg.status}`);
    if (agentMsg.status !== "complete") throw new Error(`Agent message did not complete (status=${agentMsg.status}).`);

    const bodyOk = agentMsg.text.includes(MESSAGE_TEXT);
    log(`Participant message reached the custom harness: ${bodyOk}`);
    if (!bodyOk) throw new Error("Agent response did not include the original participant message.");

    // Verify handoff is no longer in flight.
    state = await client.query(api.rooms.state, { roomId: room.roomId, sessionToken });
    if (state!.handoffInProgress) throw new Error("handoffInProgress should be false after completion.");
    log(`handoffInProgress=${state!.handoffInProgress}, handoffStatus=${state!.handoffStatus}`);

    log("✓ Agent response streamed into the timeline successfully.");

    // 9. Clean disconnect via SIGTERM.
    log("Sending SIGTERM to connector…");
    const exitCode = await new Promise<number>((resolve) => {
      child.once("exit", resolve);
      child.kill("SIGTERM");
    });

    const fullOut = connOut.join("");
    const disconnectedOk = fullOut.includes("Disconnected.");
    log(`Connector exit code: ${exitCode}`);
    log(`Connector logged clean disconnect: ${disconnectedOk}`);
    if (!disconnectedOk) throw new Error("Connector did not log a clean disconnect.");

    // Verify room state shows the agent no longer active.
    state = await client.query(api.rooms.state, { roomId: room.roomId, sessionToken });
    if (state!.agent.active) throw new Error("Agent should be inactive after disconnect.");
    log("Room state confirms agent inactive after disconnect.");

    log("\n✅✅✅ END-TO-END CONNECTOR TEST PASSED ✅✅✅");
    log(`  room ${room.roomId}  |  agent response: ${agentMsg.text.slice(0, 60).replace(/\n/g, " ")}…`);
  } finally {
    child.kill("SIGKILL");
    await client.close();
  }
}

main().catch((err) => {
  console.error(`\n❌ E2E TEST FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
