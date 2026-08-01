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

import { parseArgs } from "node:util";
import { runConnector, type Scheduler } from "./connector.ts";
import { customHarness, getHarness, HARNESS_NAMES } from "./harnesses.ts";
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

function usage(): string {
  return [
    "Usage: room connect <roomId> <connectionCode> --agent <name>",
    "",
    `Built-in agents: ${HARNESS_NAMES.join(", ")}`,
    "Custom agent:   --agent custom --command <executable> [--arg <value> ...]",
    "Optional:       --supports-vision",
  ].join("\n");
}

function readCustomArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    throw new Error("ROOM_AGENT_ARGS must be a JSON array of strings.");
  }
  return parsed;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      agent: { type: "string", short: "a" },
      command: { type: "string" },
      arg: { type: "string", multiple: true },
      "supports-vision": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    // eslint-disable-next-line no-console
    console.log(usage());
    return;
  }

  const [subcommand, roomIdArg, codeArg] = positionals;
  const configuredCommand = values.command ?? process.env.ROOM_AGENT_COMMAND;
  const agentName = values.agent ?? (configuredCommand ? "custom" : undefined);
  if (subcommand !== "connect" || !roomIdArg || !codeArg || !agentName) {
    // eslint-disable-next-line no-console
    console.error(usage());
    process.exitCode = 64;
    return;
  }
  if (!process.env.CONVEX_URL) {
    // eslint-disable-next-line no-console
    console.error("Missing required env var: CONVEX_URL");
    process.exitCode = 1;
    return;
  }

  const harness = agentName === "custom"
    ? customHarness(
        configuredCommand ?? "",
        values.arg ?? readCustomArgs(process.env.ROOM_AGENT_ARGS),
      )
    : getHarness(agentName);
  const supportsVision = values["supports-vision"] === true
    || process.env.ROOM_AGENT_SUPPORTS_VISION === "true";

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const roomId = roomIdArg.toUpperCase();
  log(`Connecting ${harness.name} to room ${roomId}…`);
  try {
    await runConnector({
      client: new ConvexRoomAgentClient(),
      responder: new HarnessResponder(harness),
      scheduler: new RealScheduler(),
      roomId,
      connectionCode: codeArg,
      supportsVision,
      pollIntervalMs: POLL_INTERVAL_MS,
      stopSignal: controller.signal,
      log,
    });
  } catch (error) {
    log(`Fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 64;
});
