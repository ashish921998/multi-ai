import { describe, it, expect } from "vitest";
import {
  buildEnvelopeFromRows,
  type EnvelopeInput,
  type MessageRow,
  type ScreenshotRow,
  type ParticipantRow,
} from "../lib/handoff";

function pRow(seq: number, participantId: string, text: string, createdAt: number): MessageRow {
  return {
    _id: `m${seq}`,
    seq,
    authorKind: "participant",
    authorParticipantId: participantId,
    text,
    createdAt,
  };
}

function aRow(seq: number, text: string, createdAt: number): MessageRow {
  return {
    _id: `m${seq}`,
    seq,
    authorKind: "agent",
    authorAgentConnectionId: "conn-1",
    text,
    createdAt,
  };
}

describe("buildEnvelopeFromRows", () => {
  it("includes only participant messages after the boundary, in seq order", () => {
    const input: EnvelopeInput = {
      rows: [
        aRow(1, "earlier agent plan", 1_000),
        pRow(2, "p1", "old message", 2_000),
        pRow(3, "p1", "new message", 3_000),
        aRow(4, "agent reply", 4_000),
        pRow(5, "p2", "another new", 5_000),
      ],
      screenshots: [],
      participants: [
        { _id: "p1", displayName: "Maya" },
        { _id: "p2", displayName: "Leo" },
      ],
      boundarySeq: 2,
    };

    const env = buildEnvelopeFromRows(input);

    expect(env.includedSeqs).toEqual([3, 5]);
    expect(env.nextBoundarySeq).toBe(5);
    // Agent responses are excluded from a handoff batch.
    expect(env.body).not.toContain("agent reply");
    expect(env.body).toContain("Maya");
    expect(env.body).toContain("Leo");
  });

  it("joins screenshots and participant names into the envelope", () => {
    const shots: ScreenshotRow[] = [
      {
        _id: "shot-1",
        messageId: "m3",
        storageId: "storage-1",
        mime: "image/png",
        width: 800,
        height: 600,
        bytes: 1234,
      },
    ];
    const input: EnvelopeInput = {
      rows: [pRow(3, "p1", "see this screen", 3_000)],
      screenshots: shots,
      participants: [{ _id: "p1", displayName: "Priya" }],
      boundarySeq: 0,
    };

    const env = buildEnvelopeFromRows(input);

    expect(env.hasVisionContent).toBe(true);
    expect(env.body).toContain("1 screenshot");
    expect(env.body).toContain("Priya");
  });

  it("is deterministic for the same batch regardless of input order", () => {
    const mk = (): EnvelopeInput => ({
      rows: [pRow(3, "p1", "first", 3_000), pRow(4, "p2", "second", 4_000)],
      screenshots: [],
      participants: [
        { _id: "p1", displayName: "A" },
        { _id: "p2", displayName: "B" },
      ],
      boundarySeq: 0,
    });
    const a = mk();
    const b: EnvelopeInput = { ...mk(), rows: [...mk().rows].reverse() };

    const env1 = buildEnvelopeFromRows(a);
    const env2 = buildEnvelopeFromRows(b);

    // Shared's buildHandoffEnvelope sorts by seq, so output is stable.
    expect(env1.body).toBe(env2.body);
    expect(env1.includedSeqs).toEqual([3, 4]);
  });

  it("produces an empty but well-formed envelope when nothing is new", () => {
    const env = buildEnvelopeFromRows({
      rows: [pRow(1, "p1", "already sent", 1_000)],
      screenshots: [],
      participants: [{ _id: "p1", displayName: "A" } as ParticipantRow],
      boundarySeq: 5,
    });

    expect(env.includedSeqs).toEqual([]);
    expect(env.nextBoundarySeq).toBe(5);
    expect(env.hasVisionContent).toBe(false);
  });
});
