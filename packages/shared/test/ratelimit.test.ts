import { describe, it, expect } from "vitest";
import { consumeWindow } from "../src/ratelimit.ts";

const MIN = 60_000;

describe("consumeWindow", () => {
  it("allows events up to the capacity inside a window", () => {
    const now = 1_000;
    let bucket = { count: 0, windowStart: now };

    for (let i = 0; i < 5; i++) {
      const result = consumeWindow(bucket, now, { capacity: 5, windowMs: MIN });
      expect(result.allowed).toBe(true);
      bucket = result.bucket;
    }
    expect(bucket.count).toBe(5);
  });

  it("denies events once the capacity is exhausted in the window", () => {
    const now = 1_000;
    const full = { count: 5, windowStart: now };
    const result = consumeWindow(full, now, { capacity: 5, windowMs: MIN });

    expect(result.allowed).toBe(false);
    expect(result.bucket.count).toBe(5);
    expect(result.remaining).toBe(0);
  });

  it("resets the window and allows again once the window has elapsed", () => {
    const start = 1_000;
    let bucket = { count: 5, windowStart: start };

    const result = consumeWindow(bucket, start + MIN + 1, { capacity: 5, windowMs: MIN });
    expect(result.allowed).toBe(true);
    expect(result.bucket.count).toBe(1);
    expect(result.bucket.windowStart).toBe(start + MIN + 1);
    expect(result.remaining).toBe(4);
    bucket = result.bucket;
  });

  it("reports remaining capacity accurately", () => {
    const now = 1_000;
    const result = consumeWindow(
      { count: 3, windowStart: now },
      now,
      { capacity: 10, windowMs: MIN },
    );
    expect(result.remaining).toBe(6);
  });

  it("treats a brand-new bucket (count 0) as the first allowed event", () => {
    const now = 5_000;
    const result = consumeWindow({ count: 0, windowStart: now }, now, {
      capacity: 1,
      windowMs: MIN,
    });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });
});
