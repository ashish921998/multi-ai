/**
 * Deterministic handoff envelope construction (issue 0003).
 *
 * "Send to agent" packages every participant message after the boundary into one
 * stable user-message envelope. The deterministic rendering lives in
 * @multi-ai/shared (`buildHandoffEnvelope`); this module maps stored message,
 * screenshot, and participant rows into the shared `RoomMessage[]` shape and
 * hands off. It is a pure function of its inputs, so it can be unit-tested
 * without a live Convex deployment — and `send` and `agentFetch` produce an
 * identical envelope for the same batch.
 */

import { buildHandoffEnvelope } from "@multi-ai/shared";
import type { HandoffEnvelope, RoomMessage, ScreenshotRef } from "@multi-ai/shared";

export interface MessageRow {
  _id: string;
  seq: number;
  authorKind: "participant" | "agent";
  authorParticipantId?: string;
  authorAgentConnectionId?: string;
  text: string;
  createdAt: number;
}

export interface ScreenshotRow {
  _id: string;
  messageId?: string;
  storageId: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

export interface ParticipantRow {
  _id: string;
  displayName: string;
}

export interface EnvelopeInput {
  rows: MessageRow[];
  screenshots: ScreenshotRow[];
  participants: ParticipantRow[];
  boundarySeq: number;
}

/**
 * Builds the deterministic handoff envelope from the raw rows. Screenshots and
 * participant display names are joined in; prior agent responses are excluded by
 * `buildHandoffEnvelope` so a handoff carries only new participant context.
 */
export function buildEnvelopeFromRows(input: EnvelopeInput): HandoffEnvelope {
  const nameById = new Map<string, string>();
  for (const p of input.participants) nameById.set(p._id, p.displayName);

  const messages: RoomMessage[] = input.rows.map((r) => {
    const shots = r.authorParticipantId
      ? input.screenshots.filter((s) => s.messageId === r._id)
      : [];
    const author =
      r.authorKind === "agent"
        ? { kind: "agent" as const, agentConnectionId: r.authorAgentConnectionId ?? "" }
        : {
            kind: "participant" as const,
            participantId: r.authorParticipantId ?? "",
            displayName: nameById.get(r.authorParticipantId ?? "") ?? "Participant",
          };
    const content: RoomMessage["content"] = { text: r.text };
    if (shots.length > 0) {
      content.screenshots = toScreenshotRefs(shots);
    }
    return {
      id: r._id,
      roomId: "",
      seq: r.seq,
      author,
      content,
      createdAt: new Date(r.createdAt).toISOString(),
    };
  });

  return buildHandoffEnvelope(messages, { boundarySeq: input.boundarySeq });
}

function toScreenshotRefs(shots: ScreenshotRow[]): ScreenshotRef[] {
  return shots.map((s) => ({
    id: s._id,
    path: s.storageId,
    mime: s.mime as ScreenshotRef["mime"],
    width: s.width,
    height: s.height,
    bytes: s.bytes,
  }));
}
