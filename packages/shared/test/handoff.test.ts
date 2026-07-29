import { describe, it, expect } from "vitest";
import { buildHandoffEnvelope } from "../src/handoff.ts";
import type { RoomMessage } from "../src/types.ts";

function participantMessage(
  seq: number,
  displayName: string,
  text: string,
  createdAt: string,
  screenshots?: RoomMessage["content"]["screenshots"],
): RoomMessage {
  return {
    id: `m${seq}`,
    roomId: "room-1",
    seq,
    author: { kind: "participant", participantId: `p-${displayName}`, displayName },
    content: { text, screenshots },
    createdAt,
  };
}

function agentMessage(seq: number, text: string, createdAt: string): RoomMessage {
  return {
    id: `m${seq}`,
    roomId: "room-1",
    seq,
    author: { kind: "agent", agentConnectionId: "conn-1" },
    content: { text },
    createdAt,
  };
}

describe("buildHandoffEnvelope", () => {
  it("includes only messages whose seq is strictly greater than the boundary", () => {
    const messages = [
      participantMessage(1, "Maya", "earlier message", "2024-01-01T10:00:00Z"),
      participantMessage(2, "Priya", "boundary message", "2024-01-01T10:01:00Z"),
      participantMessage(3, "Leo", "new message", "2024-01-01T10:02:00Z"),
    ];

    const env = buildHandoffEnvelope(messages, { boundarySeq: 2 });

    expect(env.includedSeqs).toEqual([3]);
    expect(env.nextBoundarySeq).toBe(3);
  });

  it("includes participant name, timestamp, and text for each message", () => {
    const messages = [
      participantMessage(3, "Leo", "We need a shorter onboarding flow.", "2024-01-01T10:02:00Z"),
    ];

    const env = buildHandoffEnvelope(messages, { boundarySeq: 0 });

    expect(env.body).toContain("Leo");
    expect(env.body).toContain("We need a shorter onboarding flow.");
    expect(env.body).toContain("10:02 UTC");
  });

  it("does not add any summarizer commentary of its own", () => {
    const messages = [
      participantMessage(3, "Leo", "Just the facts.", "2024-01-01T10:02:00Z"),
    ];
    const env = buildHandoffEnvelope(messages, { boundarySeq: 0 });

    // The envelope must relay participant text verbatim, not editorialize.
    expect(env.body).not.toMatch(/summary|tl;dr|in conclusion|to summarize/i);
    expect(env.body).toContain("Just the facts.");
  });

  it("is deterministic: identical input yields identical output regardless of input order", () => {
    const a = participantMessage(3, "Leo", "First new message.", "2024-01-01T10:02:00Z");
    const b = participantMessage(4, "Maya", "Second new message.", "2024-01-01T10:03:00Z");

    const env1 = buildHandoffEnvelope([a, b], { boundarySeq: 0 });
    const env2 = buildHandoffEnvelope([b, a], { boundarySeq: 0 });

    expect(env1.body).toBe(env2.body);
    expect(env1.includedSeqs).toEqual([3, 4]);
  });

  it("excludes prior agent responses from a new handoff batch", () => {
    const messages = [
      participantMessage(3, "Leo", "new requirement", "2024-01-01T10:02:00Z"),
      agentMessage(4, "Here is my earlier plan.", "2024-01-01T10:03:00Z"),
      participantMessage(5, "Maya", "follow-up question", "2024-01-01T10:04:00Z"),
    ];

    const env = buildHandoffEnvelope(messages, { boundarySeq: 0 });

    expect(env.includedSeqs).toEqual([3, 5]);
    expect(env.body).not.toContain("Here is my earlier plan.");
    expect(env.body).toContain("follow-up question");
  });

  it("reports vision content when a batch carries a screenshot", () => {
    const messages = [
      participantMessage(3, "Priya", "see the new screen", "2024-01-01T10:02:00Z", [
        {
          id: "shot-1",
          path: "rooms/r/shot-1.png",
          mime: "image/png",
          width: 800,
          height: 600,
          bytes: 12345,
        },
      ]),
    ];

    const env = buildHandoffEnvelope(messages, { boundarySeq: 0 });

    expect(env.hasVisionContent).toBe(true);
    expect(env.body).toContain("1 screenshot");
  });

  it("produces an empty but well-formed envelope when there are no new messages", () => {
    const env = buildHandoffEnvelope([], { boundarySeq: 7 });

    expect(env.includedSeqs).toEqual([]);
    expect(env.nextBoundarySeq).toBe(7);
    expect(env.hasVisionContent).toBe(false);
    expect(env.body.length).toBeGreaterThan(0);
  });

  it("is idempotent for retries: the same batch replays the same body", () => {
    const messages = [
      participantMessage(3, "Leo", "retryable message", "2024-01-01T10:02:00Z"),
    ];

    const first = buildHandoffEnvelope(messages, { boundarySeq: 0 });
    const retry = buildHandoffEnvelope(messages, { boundarySeq: 0 });

    expect(retry.body).toBe(first.body);
    expect(retry.nextBoundarySeq).toBe(first.nextBoundarySeq);
  });
});
