#!/usr/bin/env node
/**
 * `room` — connect a local coding-agent harness to a planning room.
 *
 * Usage:
 *   room connect <roomId> <connectionCode> --agent <name>
 *
 * Built-in harnesses: pi, codex, claude, cursor, opencode.
 * A custom executable receives the prompt on stdin:
 *   room connect <roomId> <code> --agent custom --command ./my-agent --arg run
 */

import { parseCliCommand, usage } from "./cliOptions.ts";
import { runConnector, type Scheduler } from "./connector.ts";
import { customHarness, getHarness } from "./harnesses.ts";
import { ConvexRoomAgentClient } from "./roomClient.ts";
import { HarnessResponder } from "./responder.ts";

const POLL_INTERVAL_MS = 4000;

class RealScheduler implements Scheduler {
  every(ms: number, fn: () => void): () => void {
    const handle = setInterval(fn, ms);
    return () => clearInterval(handle);
  }
}

function log(message: string): void {
  const time = new Date().toLocaleTimeString();
  // eslint-disable-next-line no-console
  console.log(`[room ${time}] ${message}`);
}

async function main(): Promise<void> {
  let command;
  try {
    command = parseCliCommand(process.argv.slice(2), process.env);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    // eslint-disable-next-line no-console
    console.error(`\n${usage()}`);
    process.exitCode = 64;
    return;
  }

  if (command.kind === "help") {
    // eslint-disable-next-line no-console
    console.log(usage());
    return;
  }

  if (!process.env.CONVEX_URL) {
    // eslint-disable-next-line no-console
    console.error("Missing required env var: CONVEX_URL");
    process.exitCode = 1;
    return;
  }

  const harness = command.agent.kind === "custom"
    ? customHarness(command.agent.executable, command.agent.args)
    : getHarness(command.agent.name);

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const client = new ConvexRoomAgentClient();
  log(`Connecting ${harness.name} to room ${command.roomId}…`);
  try {
    await runConnector({
      client,
      responder: new HarnessResponder(harness),
      scheduler: new RealScheduler(),
      roomId: command.roomId,
      connectionCode: command.connectionCode,
      supportsVision: command.supportsVision,
      pollIntervalMs: POLL_INTERVAL_MS,
      shutdownDrainTimeoutMs: command.shutdownDrainTimeoutMs,
      stopSignal: controller.signal,
      log,
    });
  } catch (error) {
    log(`Fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    try {
      await client.close();
    } catch (error) {
      log(`Close failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}

void main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
