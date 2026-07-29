#!/usr/bin/env node
/**
 * `room` — the local Pi connector CLI.
 *
 * Usage:
 *   room connect <roomId> <connectionCode>
 *
 * In the room UI, choose "Connect a Pi" and run the displayed command. This
 * connector makes an outbound connection to the room relay, becomes the active
 * agent, and relays handoffs between the room and the local agent command.
 *
 * Environment:
 *   FUNCTIONS_URL        Edge Functions base URL (e.g. https://<project>.functions.supabase.co)
 *   SUPABASE_URL         Project URL (for realtime)
 *   SUPABASE_ANON_KEY    Project anon key (for realtime)
 *   ROOM_AGENT_COMMAND   Command that turns a stdin handoff into a stdout plan
 *                        (defaults to an echo responder for smoke testing)
 */

import { runConnector, type Scheduler } from "./connector.ts";
import { HttpRoomAgentClient } from "./roomClient.ts";
import { CommandResponder, EchoResponder } from "./responder.ts";

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
  const [subcommand, roomIdArg, codeArg] = process.argv.slice(2);
  if (subcommand !== "connect" || !roomIdArg || !codeArg) {
    // eslint-disable-next-line no-console
    console.error("Usage: room connect <roomId> <connectionCode>");
    process.exit(64);
  }

  const roomId = roomIdArg.toUpperCase();
  const connectionCode = codeArg;

  for (const envVar of ["FUNCTIONS_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"]) {
    if (!process.env[envVar]) {
      // eslint-disable-next-line no-console
      console.error(`Missing required env var: ${envVar}`);
      process.exit(1);
    }
  }

  const client = new HttpRoomAgentClient();
  const command = process.env.ROOM_AGENT_COMMAND;
  const responder = command ? new CommandResponder(command) : new EchoResponder();

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  log(`Connecting to room ${roomId}…`);
  try {
    await runConnector({
      client,
      responder,
      scheduler: new RealScheduler(),
      roomId,
      connectionCode,
      supportsVision: process.env.ROOM_AGENT_SUPPORTS_VISION === "true",
      pollIntervalMs: POLL_INTERVAL_MS,
      stopSignal: controller.signal,
      log,
    });
    process.exit(0);
  } catch (err) {
    log(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
