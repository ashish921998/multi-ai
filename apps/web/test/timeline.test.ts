import { describe, it, expect } from "vitest";
import { computeScaledDimensions } from "../src/lib/timeline.ts";

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
