import { preflight } from "../_shared/cors.ts";
import { json } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";

// Scheduled cleanup: deletes rooms (and all cascading data, including screenshot
// objects) that have been inactive for 30 days (issue 0004). Run on a schedule
// via pg_cron or a cron-triggered Edge Function invocation.
export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  const client = adminClient();

  // Collect expired rooms' screenshot paths so we can delete the storage objects.
  const { data: expired } = await client
    .from("rooms")
    .select("id")
    .lt("last_activity_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .limit(500);

  const roomIds = (expired ?? []).map((r) => r.id as string);
  if (roomIds.length) {
    const { data: shots } = await client
      .from("screenshots")
      .select("storage_path")
      .in("room_id", roomIds);
    const paths = (shots ?? []).map((s) => s.storage_path as string);
    if (paths.length) {
      await client.storage.from("screenshots").remove(paths).catch((e) => {
        console.error("screenshot cleanup failed", e);
      });
    }
  }

  const { data, error } = await client.rpc("delete_expired_rooms");
  if (error) {
    console.error("delete_expired_rooms failed", error);
    return json({ ok: false, deleted: 0 }, 500);
  }

  return json({ ok: true, deleted: data ?? 0 });
};
