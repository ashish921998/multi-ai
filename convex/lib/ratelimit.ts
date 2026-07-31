/**
 * Fixed-window rate limiting backed by the `rateBuckets` table (issue 0007).
 *
 * The pure `consumeWindow` counter lives in @multi-ai/shared and is unit-tested
 * there. Here we persist its snapshot: read the bucket, consume, write it back.
 * Because Convex mutations are serialized by optimistic concurrency control,
 * concurrent attempts on the same (scope, key) retry against the latest count,
 * giving the same atomicity as the old `rate_buckets` upsert.
 */

import type { DatabaseWriter } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { consumeWindow, RATE_WINDOW_MS } from "@multi-ai/shared";

/**
 * Consumes one unit from a per-window counter. Returns whether the attempt was
 * allowed. Persisted so the window survives across requests.
 *
 * `key` is accepted as a string (rate buckets are keyed by room/participant ids,
 * which are strings at runtime).
 */
export async function consumeRate(
  db: DatabaseWriter,
  scope: string,
  key: string,
  capacity: number,
  now: number = Date.now(),
): Promise<boolean> {
  const existing = await db
    .query("rateBuckets")
    .withIndex("by_scope_and_key", (q) => q.eq("scope", scope).eq("key", key))
    .unique();

  const result = consumeWindow(
    {
      count: existing?.count ?? 0,
      windowStart: existing?.windowStart ?? now,
    },
    now,
    { capacity, windowMs: RATE_WINDOW_MS },
  );
  if (!result.allowed) return false;

  const next = {
    scope,
    key,
    count: result.bucket.count,
    windowStart: result.bucket.windowStart,
  };
  if (existing) {
    await db.patch(existing._id, next);
  } else {
    await db.insert("rateBuckets", next);
  }
  return true;
}

/** Re-exported so callers can type room id keys uniformly. */
export type { Id };
