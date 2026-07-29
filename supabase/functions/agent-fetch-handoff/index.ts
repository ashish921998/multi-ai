import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import {
  buildHandoffEnvelope,
} from "../../../packages/shared/src/index.ts";
import type { RoomMessage, ScreenshotRef } from "../../../packages/shared/src/index.ts";

interface FetchHandoffQuery {
  agentConnectionId?: string;
}

// The connector calls this after being notified (or polling). Fetching a pending
// handoff acknowledges receipt: the room boundary advances so the next handoff
// starts after this batch, and the handoff is marked delivered (issue 0003).
export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const body = (await req.json().catch(() => ({}))) as FetchHandoffQuery;
  const agentConnectionId = body.agentConnectionId;
  if (!agentConnectionId) return errorResponse(400, "agentConnectionId is required.");

  const client = adminClient();

  const { data: conn } = await client
    .from("agent_connections")
    .select("id, room_id, status")
    .eq("id", agentConnectionId)
    .maybeSingle();
  if (!conn) return errorResponse(404, "Connection not found.");
  if (conn.status !== "active") {
    return errorResponse(409, "This connection is no longer active.");
  }
  const roomId = conn.room_id as string;

  // Look for a pending handoff assigned to this connection.
  const { data: handoff } = await client
    .from("handoffs")
    .select("id, boundary_seq, next_boundary_seq, included_seqs, status")
    .eq("agent_connection_id", agentConnectionId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!handoff) {
    return json({ pending: false });
  }

  const boundary = handoff.boundary_seq as number;
  const { data: rows } = await client
    .from("messages")
    .select(
      "id, seq, author_kind, author_participant_id, author_agent_connection_id, text, created_at",
    )
    .eq("room_id", roomId)
    .in("seq", (handoff.included_seqs as number[]).length ? (handoff.included_seqs as number[]) : [0])
    .order("seq", { ascending: true });

  const ids = (rows ?? []).map((r) => r.id);
  const { data: shots } = ids.length
    ? await client
        .from("screenshots")
        .select("id, message_id, storage_path, mime, width, height, bytes")
        .in("message_id", ids)
    : { data: [] };

  const participantIds = [
    ...new Set(
      (rows ?? [])
        .filter((r) => r.author_kind === "participant")
        .map((r) => r.author_participant_id as string),
    ),
  ];
  let nameById: Record<string, string> = {};
  if (participantIds.length) {
    const { data: p } = await client.from("participants").select("id, display_name").in("id", participantIds);
    nameById = Object.fromEntries((p ?? []).map((x) => [x.id as string, x.display_name as string]));
  }

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
            displayName: nameById[r.author_participant_id as string] ?? "Participant",
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

  const envelope = buildHandoffEnvelope(messages, { boundarySeq: boundary });

  // Build short-lived signed URLs so a vision-capable Pi can read the screenshots.
  const screenshots = [];
  for (const s of shots ?? []) {
    const { data } = await client.storage.from("screenshots").createSignedUrl(s.storage_path as string, 300);
    if (data?.signedUrl) {
      screenshots.push({
        messageId: s.message_id,
        mime: s.mime,
        width: s.width,
        height: s.height,
        signedUrl: data.signedUrl,
      });
    }
  }

  // Acknowledge receipt: advance the room boundary and mark the handoff delivered.
  await client.from("rooms").update({ handoff_boundary: handoff.next_boundary_seq }).eq("id", roomId);
  await client
    .from("handoffs")
    .update({ status: "delivered" })
    .eq("id", handoff.id as string);

  return json({
    pending: true,
    handoffId: handoff.id,
    body: envelope.body,
    includedSeqs: envelope.includedSeqs,
    hasVisionContent: envelope.hasVisionContent,
    screenshots,
  });
};
