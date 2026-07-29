/**
 * Fixed-window rate limiting (issue 0007).
 *
 * Each abuse limit (failed password attempts per IP, messages per participant,
 * room creation per IP) is enforced with a one-minute fixed window. The Edge
 * Functions persist the bucket snapshot alongside the thing it counts and call
 * `consumeWindow` on every attempt.
 */

import { RATE_WINDOW_MS } from "./config.ts";
import type { RateBucket, RateConsumeResult } from "./types.ts";

export interface ConsumeWindowInput {
  capacity: number;
  windowMs?: number;
}

/**
 * Attempts to consume one unit from a fixed-window counter. Returns the
 * updated bucket snapshot (which the caller should persist) and whether the
 * attempt was allowed.
 */
export function consumeWindow(
  bucket: RateBucket,
  now: number,
  input: ConsumeWindowInput,
): RateConsumeResult {
  const windowMs = input.windowMs ?? RATE_WINDOW_MS;
  const windowElapsed = now - bucket.windowStart;

  // Roll into a fresh window when the previous one has elapsed.
  if (bucket.count === 0 || windowElapsed >= windowMs || windowElapsed < 0) {
    const fresh: RateBucket = { count: 1, windowStart: now };
    return { allowed: true, bucket: fresh, remaining: input.capacity - 1 };
  }

  if (bucket.count >= input.capacity) {
    return { allowed: false, bucket, remaining: 0 };
  }

  const next: RateBucket = { count: bucket.count + 1, windowStart: bucket.windowStart };
  return { allowed: true, bucket: next, remaining: input.capacity - next.count };
}
