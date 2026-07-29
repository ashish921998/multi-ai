import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import { requireSession } from "../_shared/session.ts";
import { broadcast, agentChannel } from "../_shared/realtime.ts";
import {
  DEFAULT_LEASE_CONFIG,
  buildHandoffEnvelope,
  generateId,
} from "../../../packages/shared/src/index.ts";
import type { RoomMessage, ScreenshotRef } from "../../../packages/shared/src/index.ts";

async function reapStaleAgent(client: ReturnType<typeof adminClient>, roomId: string) {
  const { data: active } = await client
    .from("agent_connections")
    .select("id, last_heartbeat_at")
    .eq("room_id", roomId)
    .eq("status", "active")
    .maybeSingle();
  if (!active) return;
  const ageMs = Date.now() - new Date(active.last_heartbeat_at as string).getTime();
  if (ageMs > DEFAULT_LEASE_CONFIG.heartbeatTimeoutMs) {
    await client
      .from("agent_connections")
      .update({ status: "disconnected", released_at: new Date().toISOString() })
      .eq("id", active.id);
  }
}

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
  await reapStaleAgent(client, roomId);

  const { data: agent } = await client
    .from("agent_connections")
    .select("id, last_heartbeat_at")
    .eq("room_id", roomId)
    .eq("status", "active")
    .maybeSingle();
  if (!agent) {
    return errorResponse(409, "No active Pi agent is connected. Someone connect a Pi first.");
  }

  // Retry path: a previously failed handoff can be re-sent with the same batch
  // of messages (issue 0003) without duplicating them in the timeline.
  const { data: failed } = await client
    .from("handoffs")
    .select("id")
    .eq("room_id", roomId)
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (failed) {
    await client
      .from("handoffs")
      .update({ status: "pending", agent_connection_id: agent.id as string, agent_message_id: null })
      .eq("id", failed.id as string);
    await broadcast(agentChannel(agent.id as string), "handoff", { handoffId: failed.id }).catch(() => {});
    return json({ handoffId: failed.id, retry: true });
  }

  // Only one handoff may be in flight at a time per room.
  const { data: inflight } = await client
    .from("handoffs")
    .select("id, status")
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

  const ids = (rows ?? []).map((r) => r.id);
  const { data: shots } = ids.length
    ? await client
        .from("screenshots")
        .select("id, message_id, storage_path, mime, width, height, bytes")
        .in("message_id", ids)
    : { data: [] };

  const messages: RoomMessage[] = (rows ?? []).map((r) => {
    const mine = (shots ?? []).filter((s) => s.message_id === r.id);
    const screenshots: ScreenshotRef[] = mine.map((s) => ({
      id: s.id as string,
      path: s.storage_path as string,
      mime: s.mime as ScreenshotRef["mime"],
      width: s.width as number,
      height: s.height as number,
      bytes: s.bytes as number,
    }));
    const author =
      r.author_kind === "agent"
        ? { kind: "agent" as const, agentConnectionId: r.author_agent_connection_id as string }
        : {
            kind: "participant" as const,
            participantId: r.author_participant_id as string,
            displayName: "", // filled below
          };
    return {
      id: r.id as string,
      roomId,
      seq: r.seq as number,
      author,
      content: { text: r.text as string, screenshots: screenshots.length ? screenshots : undefined },
      createdAt: r.created_at as string,
    };
  });

  // Fill participant display names for the envelope.
  const participantIds = [
    ...new Set(
      messages
        .filter((m) => m.author.kind === "participant")
        .map((m) => (m.author as { participantId: string }).participantId),
    ),
  ];
  let nameById: Record<string, string> = {};
  if (participantIds.length) {
    const { data: p } = await client
      .from("participants")
      .select("id, display_name")
      .in("id", participantIds);
    nameById = Object.fromEntries((p ?? []).map((x) => [x.id as string, x.display_name as string]));
  }
  for (const m of messages) {
    if (m.author.kind === "participant") {
      m.author.displayName = nameById[m.author.participantId] ?? "Participant";
    }
  }

  const envelope = buildHandoffEnvelope(messages, { boundarySeq: boundary });

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
    console.error("send-handoff insert failed", error);
    return errorResponse(500, "Could not start the handoff.");
  }

  await broadcast(agentChannel(agent.id as string), "handoff", { handoffId }).catch(() => {});

  return json({
    handoffId,
    includedSeqs: envelope.includedSeqs,
    nextBoundarySeq: envelope.nextBoundarySeq,
    hasVisionContent: envelope.hasVisionContent,
  });
};
