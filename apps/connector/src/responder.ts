/**
 * Agent responders turn a handoff envelope into a streamed response.
 *
 * The default `CommandResponder` shells out to a local command (configured via
 * the `ROOM_AGENT_COMMAND` env var). It feeds the deterministic handoff envelope
 * to the command's stdin and streams its stdout back to the room as the Pi
 * response. Point this at `pi` (or any agent that reads a prompt from stdin and
 * writes a plan to stdout) so the repository, credentials, and API keys stay on
 * the participant's own laptop.
 */

import { spawn } from "node:child_process";
import type { AgentResponder, PendingHandoff } from "./connector.ts";

export class CommandResponder implements AgentResponder {
  constructor(private command: string) {}

  async *stream(handoff: PendingHandoff, signal: AbortSignal): AsyncIterable<string> {
    const body = handoff.body ?? "";
    const child = spawn(this.command, { shell: true, stdio: ["pipe", "pipe", "inherit"] });

    signal.addEventListener("abort", () => {
      child.kill("SIGTERM");
    });

    child.stdin.end(body);

    yield* iterateStdout(child.stdout);
  }
}

async function* iterateStdout(stdout: NodeJS.ReadableStream): AsyncIterable<string> {
  const decoder = new TextDecoder();
  for await (const chunk of stdout as AsyncIterable<Buffer>) {
    yield decoder.decode(chunk, { stream: true });
  }
  yield decoder.decode();
}

/** A responder that just echoes the envelope — handy for local smoke tests. */
export class EchoResponder implements AgentResponder {
  async *stream(handoff: PendingHandoff): AsyncIterable<string> {
    yield `# Echo responder\n\nI received the handoff with ${handoff.includedSeqs?.length ?? 0} new message(s).\n\n`;
    yield "```\n" + (handoff.body ?? "") + "\n```";
  }
}
