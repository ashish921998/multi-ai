/**
 * Agent responders turn a handoff envelope into a streamed response.
 *
 * The default `CommandResponder` shells out to a local command (configured via
 * the `ROOM_AGENT_COMMAND` env var). It feeds the deterministic handoff envelope
 * to the command's stdin and streams its stdout back to the room as the Pi
 * response. Point this at `pi` (or any agent that reads a prompt from stdin and
 * writes a plan to stdout) so the repository, credentials, and API keys stay on
 * the participant's own laptop.
 *
 * Vision (issue 0005, review #2): when a handoff carries screenshots, each one
 * is downloaded from its short-lived signed URL to a temp file and the file
 * paths are appended to the stdin prompt as an attachment manifest. A
 * vision-capable command (ROOM_AGENT_SUPPORTS_VISION=true) can then read those
 * images directly from disk; the bytes never have to round-trip through stdin.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentResponder, PendingHandoff } from "./connector.ts";

interface AttachmentFile {
  /** Absolute path the agent command can open(). */
  path: string;
  mime: string;
  width?: number;
  height?: number;
}

export class CommandResponder implements AgentResponder {
  constructor(private command: string) {}

  async *stream(handoff: PendingHandoff, signal: AbortSignal): AsyncIterable<string> {
    const attachments = await materializeScreenshots(handoff.screenshots ?? [], signal);
    const stdin = composeStdin(handoff.body ?? "", attachments);

    const child = spawn(this.command, { shell: true, stdio: ["pipe", "pipe", "inherit"] });

    signal.addEventListener("abort", () => {
      child.kill("SIGTERM");
    });

    child.stdin.end(stdin);

    try {
      yield* iterateStdout(child.stdout);
    } finally {
      if (attachments.dir) {
        await rm(attachments.dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}

async function* iterateStdout(stdout: NodeJS.ReadableStream): AsyncIterable<string> {
  const decoder = new TextDecoder();
  for await (const chunk of stdout as AsyncIterable<Buffer>) {
    yield decoder.decode(chunk, { stream: true });
  }
  yield decoder.decode();
}

/**
 * Downloads each screenshot to a temp dir so a local command can read them.
 * Returns { dir: null, files: [] } when there is nothing to download or if the
 * download fails entirely; per-image failures are skipped rather than fatal so a
 * single unreachable image never blocks the whole handoff.
 */
export async function materializeScreenshots(
  shots: NonNullable<PendingHandoff["screenshots"]>,
  signal: AbortSignal,
): Promise<{ dir: string | null; files: AttachmentFile[] }> {
  if (!shots.length) return { dir: null, files: [] };

  const dir = await mkdtemp(join(tmpdir(), "room-handoff-"));
  const files: AttachmentFile[] = [];

  await Promise.all(
    shots.map(async (s, i) => {
      try {
        const res = await fetch(s.signedUrl, { signal });
        if (!res.ok) return;
        const buf = new Uint8Array(await res.arrayBuffer());
        const path = join(dir, `image-${i}${mimeToExt(s.mime)}`);
        await writeFile(path, buf);
        const file: AttachmentFile = { path, mime: s.mime };
        if (s.width !== undefined && s.height !== undefined) {
          file.width = s.width;
          file.height = s.height;
        }
        files.push(file);
      } catch {
        // Skip — a missing image must not abort the handoff.
      }
    }),
  );

  return { dir, files };
}

/** Builds the text fed to the command's stdin: the envelope plus an attachment
 * manifest listing the downloaded image paths. */
export function composeStdin(body: string, attachments: { files: AttachmentFile[] }): string {
  if (!attachments.files.length) return body;
  const lines = attachments.files.map((f) => {
    const dims = f.width && f.height ? `, ${f.width}x${f.height}` : "";
    return `- ${f.path} (${f.mime}${dims})`;
  });
  return `${body}\n\n--- Attachments (local image files, readable from disk) ---\n${lines.join("\n")}\n`;
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/bmp":
      return ".bmp";
    default:
      return ".img";
  }
}

/** A responder that just echoes the envelope — handy for local smoke tests. */
export class EchoResponder implements AgentResponder {
  async *stream(handoff: PendingHandoff): AsyncIterable<string> {
    yield `# Echo responder\n\nI received the handoff with ${handoff.includedSeqs?.length ?? 0} new message(s).\n\n`;
    yield "```\n" + (handoff.body ?? "") + "\n```";
  }
}
