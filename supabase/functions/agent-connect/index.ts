import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import { broadcast, roomChannel } from "../_shared/realtime.ts";
import {
  DEFAULT_LEASE_CONFIG,
  canAcquireActiveSlot,
  normalizeConnectionCode,
  verifyConnectionCode,
} from "../../../packages/shared/src/index.ts";

interface AgentConnectRequest {
  roomId?: string;
  connectionCode?: string;
}

export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const body = (await req.json().catch(() => ({}))) as AgentConnectRequest;
  const roomId = body.roomId?.trim().toUpperCase();
  const rawCode = normalizeConnectionCode(body.connectionCode ?? "");
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

  // Enforce the single-active-agent rule (issue 0006).
  const { data: activeHolder } = await client
    .from("agent_connections")
    .select("id, last_heartbeat_at")
    .eq("room_id", roomId)
    .eq("status", "active")
    .maybeSingle();

  const now = Date.now();
  if (activeHolder) {
    // Reap a timed-out holder so takeover is possible.
    const ageMs = now - new Date(activeHolder.last_heartbeat_at as string).getTime();
    if (ageMs > DEFAULT_LEASE_CONFIG.heartbeatTimeoutMs) {
      await client
        .from("agent_connections")
        .update({ status: "disconnected", released_at: new Date().toISOString() })
        .eq("id", activeHolder.id);
    }
  }

  const { data: holderAfterReap } = await client
    .from("agent_connections")
    .select("id, last_heartbeat_at")
    .eq("room_id", roomId)
    .eq("status", "active")
    .maybeSingle();

  const decision = canAcquireActiveSlot(
    holderAfterReap
      ? {
          id: holderAfterReap.id as string,
          roomId,
          participantId: "",
          connectionCode: "",
          status: "active",
          lastHeartbeatAt: new Date(holderAfterReap.last_heartbeat_at as string).getTime(),
          createdAt: 0,
          releasedAt: null,
        }
      : null,
    now,
  );

  if (!decision.allowed) {
    return errorResponse(409, "Another Pi is already active in this room. Try again once it disconnects.");
  }

  // Acquire the slot.
  const { error } = await client
    .from("agent_connections")
    .update({
      status: "active",
      last_heartbeat_at: new Date(now).toISOString(),
    })
    .eq("id", connection.id);
  if (error) {
    console.error("agent-connect acquire failed", error);
    return errorResponse(500, "Could not activate the connection.");
  }

  // Latest handoff boundary tells the connector where the room's context starts.
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
    heartbeatIntervalMs: 10000,
  });
};
