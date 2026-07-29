import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import { DEFAULT_LEASE_CONFIG } from "../../../packages/shared/src/index.ts";

interface HeartbeatRequest {
  agentConnectionId?: string;
}

export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const body = (await req.json().catch(() => ({}))) as HeartbeatRequest;
  const id = body.agentConnectionId;
  if (!id) return errorResponse(400, "agentConnectionId is required.");

  const client = adminClient();
  const { data: conn } = await client
    .from("agent_connections")
    .select("id, room_id, status, last_heartbeat_at")
    .eq("id", id)
    .maybeSingle();
  if (!conn) return errorResponse(404, "Connection not found.");
  if (conn.status !== "active") {
    return errorResponse(409, "This connection is no longer active.");
  }

  const ageMs = Date.now() - new Date(conn.last_heartbeat_at as string).getTime();
  // A heartbeat arriving from a connection already past the timeout is stale and
  // must not revive a slot that may have been taken over (issue 0006).
  if (ageMs > DEFAULT_LEASE_CONFIG.heartbeatTimeoutMs) {
    return errorResponse(409, "This connection timed out and may have been replaced.");
  }

  await client
    .from("agent_connections")
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq("id", id);

  return json({ ok: true });
};
