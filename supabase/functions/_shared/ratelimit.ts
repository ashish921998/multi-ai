import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { consumeWindow, RATE_WINDOW_MS } from "../../../packages/shared/src/index.ts";

/**
 * Consumes one unit from a per-window rate-limit counter stored in
 * `rate_buckets`. Returns whether the attempt was allowed. The bucket snapshot
 * is upserted so concurrent calls converge on the persisted count.
 */
export async function consumeRate(
  client: SupabaseClient,
  scope: string,
  key: string,
  capacity: number,
  now: number = Date.now(),
): Promise<boolean> {
  const { data } = await client
    .from("rate_buckets")
    .select("count, window_start")
    .eq("scope", scope)
    .eq("key", key)
    .maybeSingle();

  const existing = (data ?? { count: 0, window_start: now }) as {
    count: number;
    window_start: number;
  };

  const result = consumeWindow(
    { count: existing.count, windowStart: existing.window_start },
    now,
    { capacity, windowMs: RATE_WINDOW_MS },
  );
  if (!result.allowed) return false;

  await client
    .from("rate_buckets")
    .upsert(
      {
        scope,
        key,
        count: result.bucket.count,
        window_start: result.bucket.windowStart,
      },
      { onConflict: "scope,key" },
    );

  return true;
}

/** SHA-256 hex of a string, used to key rate buckets by IP without storing it. */
export async function hashKey(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
