/**
 * Screenshot validation (issue 0005).
 *
 * V1 accepts PNG, JPEG, and WebP. Each image is capped at 5 MB and each
 * handoff to 10 screenshots. Validation happens in the browser (before
 * resize/upload) and is re-enforced by the Edge Function that issues signed
 * URLs.
 */

import { DEFAULT_SCREENSHOT_LIMITS } from "./config.ts";
import type { ScreenshotLimits, ScreenshotMime } from "./types.ts";

export { DEFAULT_SCREENSHOT_LIMITS };

export interface ScreenshotValidation {
  ok: boolean;
  error?: string;
}

/** Validates a single screenshot's mime and size. */
export function validateScreenshot(
  candidate: { mime: string; bytes: number },
  limits: ScreenshotLimits = DEFAULT_SCREENSHOT_LIMITS,
): ScreenshotValidation {
  const accepted = limits.acceptedMimes.includes(candidate.mime as ScreenshotMime);
  if (!accepted) {
    const list = limits.acceptedMimes.join(", ");
    return { ok: false, error: `Unsupported screenshot type. Accepted: ${list}.` };
  }
  if (candidate.bytes > limits.maxBytes) {
    const mb = Math.round((limits.maxBytes / (1024 * 1024)) * 10) / 10;
    return { ok: false, error: `Screenshot is too large. The limit is ${mb} MB.` };
  }
  return { ok: true };
}

/** Validates that a handoff batch stays within the per-handoff screenshot cap. */
export function validateScreenshotBatch(
  count: number,
  limits: ScreenshotLimits = DEFAULT_SCREENSHOT_LIMITS,
): ScreenshotValidation {
  if (count > limits.maxPerHandoff) {
    return {
      ok: false,
      error: `Too many screenshots in one handoff. The limit is ${limits.maxPerHandoff} per handoff.`,
    };
  }
  return { ok: true };
}
