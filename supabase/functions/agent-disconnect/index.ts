import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import { broadcast, roomChannel } from "../_shared/realtime.ts";

interface DisconnectRequest {
  agentConnectionId?: string;
}

export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const body = (await req.json().catch(() => ({}))) as DisconnectRequest;
  const id = body.agentConnectionId;
  if (!id) return errorResponse(400, "agentConnectionId is required.");

  const client = adminClient();
  const { data: conn } = await client
    .from("agent_connections")
    .select("id, room_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!conn) return json({ ok: true }); // idempotent

  if (conn.status === "active") {
    await client
      .from("agent_connections")
      .update({ status: "disconnected", released_at: new Date().toISOString() })
      .eq("id", id);
    await broadcast(roomChannel(conn.room_id as string), "agent", { active: false }).catch(
      () => {},
    );
  }

  return json({ ok: true });
};
