import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import { broadcast, roomChannel } from "../_shared/realtime.ts";
import {
  HEARTBEAT_INTERVAL_MS,
  canAcquireActiveSlot,
  normalizeConnectionCode,
  verifyConnectionCode,
} from "../../../packages/shared/src/index.ts";

interface AgentConnectRequest {
  roomId?: string;
  connectionCode?: string;
  /** Whether the connecting model can receive image inputs (issue 0005). */
  supportsVision?: boolean;
}

export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const body = (await req.json().catch(() => ({}))) as AgentConnectRequest;
  const roomId = body.roomId?.trim().toUpperCase();
  const rawCode = normalizeConnectionCode(body.connectionCode ?? "");
  const supportsVision = body.supportsVision === true;
  if (!roomId || rawCode.length === 0) {
    return errorResponse(400, "roomId and connectionCode are required.");
  }

  const client = adminClient();

  // Find the pending connection this code belongs to.
  const { data: pending } = await client
    .from("agent_connections")
    .select("id, connection_code_hash, status")
    .eq("room_id", roomId)
    .eq("status", "disconnected")
    .order("created_at", { ascending: true });
  if (!pending || pending.length === 0) {
    return errorResponse(404, "No pending connection for this room. Generate a code in the room first.");
  }

  let connection: { id: string; connection_code_hash: unknown } | null = null;
  for (const row of pending) {
    const ok = await verifyConnectionCode(rawCode, row.connection_code_hash as {
      hash: string;
      salt: string;
      iterations: number;
    });
    if (ok) {
      connection = row;
      break;
    }
  }
  if (!connection) return errorResponse(401, "Invalid connection code.");

  // Reap any timed-out holder, then enforce the single-active-agent rule.
  await client.rpc("reap_stale_agent", { p_room_id: roomId });

  const { data: holder } = await client
    .from("agent_connections")
    .select("id, last_heartbeat_at")
    .eq("room_id", roomId)
    .eq("status", "active")
    .maybeSingle();

  const now = Date.now();
  const decision = canAcquireActiveSlot(
    holder
      ? {
          id: holder.id as string,
          roomId,
          participantId: "",
          connectionCode: "",
          status: "active",
          lastHeartbeatAt: new Date(holder.last_heartbeat_at as string).getTime(),
          createdAt: 0,
          releasedAt: null,
        }
      : null,
    now,
  );

  if (!decision.allowed) {
    return errorResponse(409, "Another Pi is already active in this room. Try again once it disconnects.");
  }

  // Acquire the slot and record whether this model can receive images.
  const { error } = await client
    .from("agent_connections")
    .update({
      status: "active",
      last_heartbeat_at: new Date(now).toISOString(),
      supports_vision: supportsVision,
    })
    .eq("id", connection.id);
  if (error) {
    console.error("agent-connect acquire failed", error);
    return errorResponse(500, "Could not activate the connection.");
  }

  const { data: latestHandoff } = await client
    .from("handoffs")
    .select("boundary_seq")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  await broadcast(roomChannel(roomId), "agent", { active: true }).catch(() => {});

  return json({
    agentConnectionId: connection.id,
    roomId,
    boundarySeq: latestHandoff?.boundary_seq ?? 0,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  });
};
