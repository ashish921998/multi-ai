import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import { requireSession } from "../_shared/session.ts";

interface RoomStateRequest {
  roomId?: string;
  sinceSeq?: number;
}

export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const body = (await req.json().catch(() => ({}))) as RoomStateRequest;
  const roomId = body.roomId?.trim().toUpperCase();
  const sinceSeq = typeof body.sinceSeq === "number" ? body.sinceSeq : 0;
  if (!roomId) return errorResponse(400, "roomId is required.");

  const client = adminClient();
  const session = await requireSession(client, roomId, req.headers.get("x-session-token"));
  if (!session) return errorResponse(401, "Invalid or expired session. Rejoin the room.");

  const { data: room } = await client
    .from("rooms")
    .select("id, title, created_at, expires_at")
    .eq("id", roomId)
    .maybeSingle();
  if (!room) return errorResponse(404, "Room not found.");

  // Expire the active agent lease if its heartbeats have gone silent.
  await client.rpc("reap_stale_agent", { p_room_id: roomId });

  const [{ data: participants }, { data: messages }] = await Promise.all([
    client
      .from("participants")
      .select("id, display_name, joined_at")
      .eq("room_id", roomId)
      .order("joined_at", { ascending: true }),
    client
      .from("messages")
      .select("id, seq, author_kind, author_participant_id, author_agent_connection_id, text, status, created_at")
      .eq("room_id", roomId)
      .gt("seq", sinceSeq)
      .order("seq", { ascending: true })
      .limit(200),
  ]);

  const messageIds = (messages ?? []).map((m) => m.id);
  const { data: screenshots } = messageIds.length
    ? await client
        .from("screenshots")
        .select("id, message_id, mime, width, height, bytes")
        .in("message_id", messageIds)
    : { data: [] };

  const { data: activeAgent } = await client
    .from("agent_connections")
    .select("id, participant_id, last_heartbeat_at, created_at, supports_vision")
    .eq("room_id", roomId)
    .eq("status", "active")
    .maybeSingle();

  const { data: latestHandoff } = await client
    .from("handoffs")
    .select("boundary_seq, status")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const connector = activeAgent
    ? (participants ?? []).find((p) => p.id === activeAgent.participant_id)
    : null;

  return json({
    room: {
      id: room.id,
      title: room.title,
      createdAt: room.created_at,
      expiresAt: room.expires_at,
    },
    me: { participantId: session.participantId, displayName: session.displayName },
    participants: (participants ?? []).map((p) => ({
      id: p.id,
      displayName: p.display_name,
      joinedAt: p.joined_at,
      isSelf: p.id === session.participantId,
    })),
    messages: (messages ?? []).map((m) => ({
      id: m.id,
      seq: m.seq,
      authorKind: m.author_kind,
      authorParticipantId: m.author_participant_id,
      authorAgentConnectionId: m.author_agent_connection_id,
      text: m.text,
      status: m.status,
      createdAt: m.created_at,
      screenshots: (screenshots ?? [])
        .filter((s) => s.message_id === m.id)
        .map((s) => ({
          id: s.id,
          mime: s.mime,
          width: s.width,
          height: s.height,
          bytes: s.bytes,
        })),
    })),
    agent: activeAgent
      ? {
          active: true,
          connectionId: activeAgent.id,
          connectorDisplayName: connector?.display_name ?? null,
          lastHeartbeatAt: activeAgent.last_heartbeat_at,
          supportsVision: Boolean(activeAgent.supports_vision),
        }
      : { active: false, supportsVision: false },
    boundarySeq: latestHandoff?.boundary_seq ?? 0,
    handoffStatus: latestHandoff?.status ?? null,
  });
};
