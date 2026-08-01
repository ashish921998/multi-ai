/**
 * Agent responders turn a handoff envelope into a streamed response.
 *
 * `HarnessResponder` delegates one prompt to a local coding-agent harness and
 * streams its plain-text stdout back to the room. Every harness receives the
 * prompt on stdin, and the connector never uses a shell, so room content stays
 * out of process arguments and cannot become shell syntax.
 *
 * Screenshots are downloaded to short-lived local files and listed in the
 * prompt. The harness can read those files without moving repository access or
 * provider credentials off the participant's laptop.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentResponder,
  PendingHandoff,
  WorkspaceDocumentSnapshot,
} from "./connector.ts";
import type { AgentHarness } from "./harnesses.ts";

interface AttachmentFile {
  /** Absolute path the agent command can open(). */
  path: string;
  mime: string;
  width?: number;
  height?: number;
}

export class HarnessResponder implements AgentResponder {
  constructor(private harness: AgentHarness) {}

  async *stream(handoff: PendingHandoff, signal: AbortSignal): AsyncIterable<string> {
    throwIfStopped(signal, this.harness.name);
    const attachments = await materializeScreenshots(handoff.screenshots ?? [], signal);

    try {
      throwIfStopped(signal, this.harness.name);
      const prompt = composePrompt(
        handoff.body ?? "",
        attachments,
        handoff.workspaceDocument ?? null,
      );
      yield* runHarness(this.harness, prompt, signal);
    } finally {
      if (attachments.dir) {
        await rm(attachments.dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}

type ProcessOutcome = { exitCode: number } | { error: Error };

async function* runHarness(
  harness: AgentHarness,
  prompt: string,
  signal: AbortSignal,
): AsyncIterable<string> {
  throwIfStopped(signal, harness.name);
  const child = spawn(harness.executable, harness.args, {
    stdio: ["pipe", "pipe", "inherit"],
  });
  let stdinError: Error | undefined;
  child.stdin.once("error", (error) => {
    stdinError = error;
  });
  const completion = new Promise<ProcessOutcome>((resolve) => {
    child.once("error", (error) => resolve({ error }));
    child.once("close", (code) => resolve({ exitCode: code ?? 1 }));
  });

  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const stopChild = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    forceKillTimer ??= setTimeout(() => child.kill("SIGKILL"), 1_000);
    forceKillTimer.unref();
  };

  signal.addEventListener("abort", stopChild, { once: true });
  if (signal.aborted) stopChild();
  child.stdin.end(prompt);

  try {
    yield* iterateStdout(child.stdout);
    const outcome = await completion;
    if (signal.aborted) throw new Error(`${harness.name} was stopped.`);
    if ("error" in outcome) throw outcome.error;
    if (stdinError) throw stdinError;
    if (outcome.exitCode !== 0) {
      throw new Error(`${harness.name} exited with code ${outcome.exitCode}.`);
    }
  } finally {
    signal.removeEventListener("abort", stopChild);
    if (child.exitCode === null && child.signalCode === null) stopChild();
    await completion;
    if (forceKillTimer) clearTimeout(forceKillTimer);
  }
}

function throwIfStopped(signal: AbortSignal, harnessName: string): void {
  if (signal.aborted) throw new Error(`${harnessName} was stopped.`);
}

async function* iterateStdout(stdout: NodeJS.ReadableStream): AsyncIterable<string> {
  const decoder = new TextDecoder();
  for await (const chunk of stdout as AsyncIterable<Buffer>) {
    const text = decoder.decode(chunk, { stream: true });
    if (text) yield text;
  }
  const tail = decoder.decode();
  if (tail) yield tail;
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

/**
 * Builds the harness prompt from the new discussion, the exact plan version the
 * agent will update, and any downloaded attachments. Supplying `null` explicitly
 * means plan.md does not exist yet; omitting the argument preserves the old
 * envelope-only helper behavior used by callers outside the room connector.
 */
export function composePrompt(
  body: string,
  attachments: { files: AttachmentFile[] },
  workspaceDocument?: WorkspaceDocumentSnapshot | null,
): string {
  let prompt = body;
  if (workspaceDocument !== undefined) {
    const current = workspaceDocument
      ? `Current ${workspaceDocument.path} (v${workspaceDocument.version}):\n\n${workspaceDocument.body}`
      : "No plan.md exists yet.";
    prompt += `\n\n--- Shared workspace document ---\n${current}\n\nUpdate the plan using the new discussion above. Return ONLY the complete Markdown contents for plan.md, including the useful existing content you are keeping. Do not wrap the document in a code fence and do not describe the edit.`;
  }
  if (attachments.files.length) {
    const lines = attachments.files.map((file) => {
      const dims = file.width && file.height ? `, ${file.width}x${file.height}` : "";
      return `- ${file.path} (${file.mime}${dims})`;
    });
    prompt += `\n\n--- Attachments (local image files, readable from disk) ---\n${lines.join("\n")}\n`;
  }
  return prompt;
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
