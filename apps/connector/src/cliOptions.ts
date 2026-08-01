import { parseArgs } from "node:util";
import {
  BUILT_IN_AGENT_HARNESSES,
  isHarnessName,
  type HarnessName,
} from "@multi-ai/shared";

export type AgentSelection =
  | { kind: "builtIn"; name: HarnessName }
  | { kind: "custom"; executable: string; args: readonly string[] };

export type CliCommand =
  | { kind: "help" }
  | {
      kind: "connect";
      roomId: string;
      connectionCode: string;
      agent: AgentSelection;
      supportsVision: boolean;
    };

export function usage(): string {
  const names = BUILT_IN_AGENT_HARNESSES.map((harness) => harness.id).join(", ");
  return [
    "Usage: room connect <roomId> <connectionCode> --agent <name>",
    "",
    `Built-in agents: ${names}`,
    "Custom agent:   --agent custom --command <executable> [--arg=<value> ...]",
    "Optional:       --supports-vision",
  ].join("\n");
}

export function parseCliCommand(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): CliCommand {
  const { values, positionals } = parseArgs({
    args: argv,
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

  if (values.help) return { kind: "help" };

  if (positionals.length !== 3 || positionals[0] !== "connect") {
    throw new Error("Expected the connect command, room ID, and connection code.");
  }

  const [, roomId, connectionCode] = positionals;
  if (!roomId || !connectionCode) {
    throw new Error("A room ID and connection code are required.");
  }

  const configuredCommand = values.command ?? env.ROOM_AGENT_COMMAND;
  const agentName = values.agent ?? (configuredCommand ? "custom" : undefined);
  if (!agentName) throw new Error("Choose an agent with --agent <name>.");

  let agent: AgentSelection;
  if (agentName === "custom") {
    if (!configuredCommand?.trim()) {
      throw new Error("A custom harness requires --command <executable>.");
    }
    agent = {
      kind: "custom",
      executable: configuredCommand.trim(),
      args: values.arg ?? (values.command === undefined ? readCustomArgs(env.ROOM_AGENT_ARGS) : []),
    };
  } else {
    if (!isHarnessName(agentName)) {
      throw new Error(`Unknown agent harness "${agentName}".`);
    }
    if (values.command !== undefined || values.arg !== undefined) {
      throw new Error("--command and --arg can only be used with --agent custom.");
    }
    agent = { kind: "builtIn", name: agentName };
  }

  return {
    kind: "connect",
    roomId: roomId.toUpperCase(),
    connectionCode,
    agent,
    supportsVision:
      values["supports-vision"] === true || env.ROOM_AGENT_SUPPORTS_VISION === "true",
  };
}

function readCustomArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ROOM_AGENT_ARGS must be a JSON array of strings.");
  }
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    throw new Error("ROOM_AGENT_ARGS must be a JSON array of strings.");
  }
  return parsed;
}
