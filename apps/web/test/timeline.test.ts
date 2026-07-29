import { describe, it, expect } from "vitest";
import { computeScaledDimensions, mergeMessages } from "../src/lib/timeline.ts";

describe("computeScaledDimensions", () => {
  it("leaves small images untouched", () => {
    expect(computeScaledDimensions(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });

  it("scales a landscape image so the longest side is the max", () => {
    expect(computeScaledDimensions(4000, 2000, 2000)).toEqual({ width: 2000, height: 1000 });
  });

  it("scales a portrait image by its height", () => {
    expect(computeScaledDimensions(1500, 3000, 2000)).toEqual({ width: 1000, height: 2000 });
  });

  it("preserves aspect ratio and never upscales", () => {
    const out = computeScaledDimensions(2024, 2024, 2000);
    expect(out.width).toBe(2000);
    expect(out.height).toBe(2000);
  });

  it("ignores zero or negative dimensions", () => {
    expect(computeScaledDimensions(0, 0, 2000)).toEqual({ width: 0, height: 0 });
  });
});

describe("mergeMessages", () => {
  it("appends new messages and keeps the timeline sorted by seq", () => {
    const existing = [{ seq: 1, text: "a" }, { seq: 2, text: "b" }];
    const incoming = [{ seq: 4, text: "d" }, { seq: 3, text: "c" }];

    const result = mergeMessages(existing, incoming, 2);

    expect(result.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(result.lastSeq).toBe(4);
  });

  it("overwrites an existing seq with the fresher copy", () => {
    const existing = [{ seq: 1, text: "streaming…", status: "streaming" }];
    const incoming = [{ seq: 1, text: "final answer", status: "complete" }];

    const result = mergeMessages(existing, incoming, 1);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.text).toBe("final answer");
  });

  it("does not lose the last known seq when the incoming slice is empty", () => {
    const result = mergeMessages([{ seq: 5, text: "x" }], [], 5);
    expect(result.lastSeq).toBe(5);
  });
});
