import { describe, it, expect } from "vitest";
import {
  validateScreenshot,
  validateScreenshotBatch,
  DEFAULT_SCREENSHOT_LIMITS,
} from "../src/screenshots.ts";

describe("validateScreenshot", () => {
  it("accepts a png within the byte limit", () => {
    const result = validateScreenshot(
      { mime: "image/png", bytes: 1024 },
      DEFAULT_SCREENSHOT_LIMITS,
    );
    expect(result.ok).toBe(true);
  });

  it("accepts jpeg and webp", () => {
    expect(
      validateScreenshot({ mime: "image/jpeg", bytes: 1024 }, DEFAULT_SCREENSHOT_LIMITS).ok,
    ).toBe(true);
    expect(
      validateScreenshot({ mime: "image/webp", bytes: 1024 }, DEFAULT_SCREENSHOT_LIMITS).ok,
    ).toBe(true);
  });

  it("rejects a gif even though it is an image", () => {
    const result = validateScreenshot(
      { mime: "image/gif", bytes: 1024 },
      DEFAULT_SCREENSHOT_LIMITS,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/png|jpeg|webp/i);
  });

  it("rejects a file above the byte limit", () => {
    const result = validateScreenshot(
      { mime: "image/png", bytes: DEFAULT_SCREENSHOT_LIMITS.maxBytes + 1 },
      DEFAULT_SCREENSHOT_LIMITS,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/5\s*mb|too large|size/i);
  });
});

describe("validateScreenshotBatch", () => {
  it("allows a batch up to the per-handoff limit", () => {
    expect(validateScreenshotBatch(0, DEFAULT_SCREENSHOT_LIMITS).ok).toBe(true);
    expect(
      validateScreenshotBatch(DEFAULT_SCREENSHOT_LIMITS.maxPerHandoff, DEFAULT_SCREENSHOT_LIMITS).ok,
    ).toBe(true);
  });

  it("rejects a batch above the per-handoff limit", () => {
    const result = validateScreenshotBatch(
      DEFAULT_SCREENSHOT_LIMITS.maxPerHandoff + 1,
      DEFAULT_SCREENSHOT_LIMITS,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/10|too many|handoff/i);
  });
});
