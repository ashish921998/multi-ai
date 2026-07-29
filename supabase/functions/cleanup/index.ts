import { preflight } from "../_shared/cors.ts";
import { json } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";

// Manual/ad-hoc cleanup trigger: deletes rooms (and all cascading data, plus
// their screenshot storage objects) that have been inactive for 30 days
// (issue 0004). On a live project this runs automatically on an hourly pg_cron
// schedule (see migration 0003); this function exists for manual runs and for
// environments without pg_cron.
export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  const client = adminClient();

  const { data, error } = await client.rpc("delete_expired_rooms");
  if (error) {
    console.error("delete_expired_rooms failed", error);
    return json({ ok: false, deleted: 0 }, 500);
  }

  return json({ ok: true, deleted: data ?? 0 });
};
