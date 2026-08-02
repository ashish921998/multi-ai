/**
 * Deterministic handoff batching (issue 0003).
 *
 * "Send to agent" packages every participant message whose sequence number is
 * strictly greater than the previous handoff boundary into a single, stable
 * user-message envelope. The envelope is relayed to the agent verbatim—no AI
 * summarizer is added. The boundary advances only after the agent acknowledges
 * receipt, and a failed handoff can be retried with the same batch because the
 * output is a pure function of (messages, boundarySeq).
 */

import type { HandoffEnvelope, RoomMessage } from "./types.ts";

export interface BuildHandoffInput {
  /** Messages with seq strictly greater than this are included. */
  boundarySeq: number;
}

/**
 * Builds the deterministic handoff envelope for the messages after the
 * boundary. Prior agent responses are excluded so a handoff only carries new
 * participant context.
 */
export function buildHandoffEnvelope(
  messages: readonly RoomMessage[],
  input: BuildHandoffInput,
): HandoffEnvelope {
  const included = messages
    .filter((m) => m.author.kind === "participant" && m.seq > input.boundarySeq)
    .sort((a, b) => a.seq - b.seq);

  const includedSeqs = included.map((m) => m.seq);
  const nextBoundarySeq = included.length > 0 ? includedSeqs[includedSeqs.length - 1]! : input.boundarySeq;
  const hasVisionContent = included.some((m) => (m.content.screenshots?.length ?? 0) > 0);

  return {
    body: renderBody(included),
    includedSeqs,
    nextBoundarySeq,
    hasVisionContent,
  };
}

function renderBody(included: readonly RoomMessage[]): string {
  const lines: string[] = [];
  lines.push("# Room handoff");
  lines.push("");

  if (included.length === 0) {
    lines.push("No new messages have been added since your last handoff.");
    lines.push("");
    lines.push("If the participants ask you to plan, ask them what they would like you to focus on.");
    return lines.join("\n");
  }

  const totalShots = included.reduce((n, m) => n + (m.content.screenshots?.length ?? 0), 0);
  lines.push(
    `You are the active coding agent in a multiplayer planning room. ` +
      `${included.length} new participant message${included.length === 1 ? "" : "s"} ` +
      (totalShots > 0 ? `and ${totalShots} screenshot${totalShots === 1 ? "" : "s"} ` : "") +
      `have been added since your last handoff. Help the participants turn this into a concrete, implementation-ready plan.`,
  );
  lines.push("");
  lines.push("## New discussion");
  lines.push("");

  for (const message of included) {
    const time = formatTimestamp(message.createdAt);
    const author = message.author.kind === "participant" ? message.author.displayName : "agent";
    const shotCount = message.content.screenshots?.length ?? 0;
    const suffix = shotCount > 0 ? ` · ${shotCount} screenshot${shotCount === 1 ? "" : "s"}` : "";
    lines.push(`[${time}] ${author}${suffix}`);
    lines.push(message.content.text.trim() || "(no text)");
    if (shotCount > 0) {
      for (const shot of message.content.screenshots!) {
        lines.push(`(attached ${shot.mime}, ${shot.width}×${shot.height})`);
      }
    }
    lines.push("");
  }

  lines.push("## End of handoff");
  lines.push("Acknowledge these messages, then respond with a focused, testable plan.");
  return lines.join("\n");
}

/** Formats an ISO-8601 timestamp as a stable `HH:MM UTC` label. */
function formatTimestamp(iso: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (!match || match[1] === undefined || match[2] === undefined) return iso;
  return `${match[1]}:${match[2]} UTC`;
}
