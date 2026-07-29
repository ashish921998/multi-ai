import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import { requireSession } from "../_shared/session.ts";
import { broadcast, agentChannel } from "../_shared/realtime.ts";
import { buildEnvelopeFromRows } from "../_shared/handoff.ts";
import { generateId } from "../../../packages/shared/src/index.ts";

interface SendHandoffRequest {
  roomId?: string;
}

export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const body = (await req.json().catch(() => ({}))) as SendHandoffRequest;
  const roomId = body.roomId?.trim().toUpperCase();
  if (!roomId) return errorResponse(400, "roomId is required.");

  const client = adminClient();
  const session = await requireSession(client, roomId, req.headers.get("x-session-token"));
  if (!session) return errorResponse(401, "Invalid or expired session. Rejoin the room.");

  // Reap a stale active agent connection before any decision.
  await client.rpc("reap_stale_agent", { p_room_id: roomId });

  const { data: agent } = await client
    .from("agent_connections")
    .select("id")
    .eq("room_id", roomId)
    .eq("status", "active")
    .maybeSingle();
  if (!agent) {
    return errorResponse(409, "No active Pi agent is connected. Someone connect a Pi first.");
  }

  // Retry path: a previously failed handoff can be re-sent with the same batch
  // of messages (issue 0003) without duplicating them in the timeline. The
  // one_active_handoff_per_room index (review #4) makes the reset-to-pending
  // safe under concurrency: if another handoff is now in flight, this raises
  // SQLSTATE 23505, mapped to a 409.
  const { data: failed } = await client
    .from("handoffs")
    .select("id")
    .eq("room_id", roomId)
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (failed) {
    const { error: retryError } = await client
      .from("handoffs")
      .update({ status: "pending", agent_connection_id: agent.id, agent_message_id: null })
      .eq("id", failed.id);
    if (retryError?.code === "23505") {
      return errorResponse(409, "A handoff to the agent is already in progress.");
    }
    await broadcast(agentChannel(agent.id), "handoff", { handoffId: failed.id }).catch(() => {});
    return json({ handoffId: failed.id, retry: true });
  }

  // Only one handoff may be in flight at a time per room.
  const { data: inflight } = await client
    .from("handoffs")
    .select("id")
    .eq("room_id", roomId)
    .in("status", ["pending", "delivered", "responding"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (inflight) {
    return errorResponse(409, "A handoff to the agent is already in progress.");
  }

  // Build the deterministic envelope from messages after the room boundary.
  const { data: room } = await client
    .from("rooms")
    .select("handoff_boundary")
    .eq("id", roomId)
    .maybeSingle();
  const boundary = (room?.handoff_boundary as number | undefined) ?? 0;

  const { data: rows } = await client
    .from("messages")
    .select(
      "id, seq, author_kind, author_participant_id, author_agent_connection_id, text, created_at",
    )
    .eq("room_id", roomId)
    .gt("seq", boundary)
    .order("seq", { ascending: true })
    .limit(500);

  const envelope = await buildEnvelopeFromRows(client, (rows ?? []) as never, boundary);

  const handoffId = generateId("handoff");
  const { error } = await client.from("handoffs").insert({
    id: handoffId,
    room_id: roomId,
    boundary_seq: boundary,
    next_boundary_seq: envelope.nextBoundarySeq,
    included_seqs: envelope.includedSeqs,
    status: "pending",
    agent_connection_id: agent.id,
  });
  if (error) {
    // A concurrent send-handoff won the race and inserted the room's one
    // active handoff first (review #4).
    if (error.code === "23505") {
      return errorResponse(409, "A handoff to the agent is already in progress.");
    }
    console.error("send-handoff insert failed", error);
    return errorResponse(500, "Could not start the handoff.");
  }

  await broadcast(agentChannel(agent.id), "handoff", { handoffId }).catch(() => {});

  return json({
    handoffId,
    includedSeqs: envelope.includedSeqs,
    nextBoundarySeq: envelope.nextBoundarySeq,
    hasVisionContent: envelope.hasVisionContent,
  });
};
