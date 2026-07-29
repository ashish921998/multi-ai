import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import { buildEnvelopeFromRows, screenshotPathsFor } from "../_shared/handoff.ts";

interface FetchHandoffQuery {
  agentConnectionId?: string;
}

// The connector calls this after being notified (or polling). Fetching a pending
// handoff acknowledges receipt: the room boundary advances so the next handoff
// starts after this batch, and the handoff is marked delivered (issue 0003).
//
// Vision gating (issue 0005): when the batch carries screenshots but the active
// model does not receive images, the envelope keeps the text and gains a clear
// limitation note, and no signed image URLs are returned.
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
    .select("id, room_id, status, supports_vision")
    .eq("id", agentConnectionId)
    .maybeSingle();
  if (!conn) return errorResponse(404, "Connection not found.");
  if (conn.status !== "active") {
    return errorResponse(409, "This connection is no longer active.");
  }
  const roomId = conn.room_id as string;
  const supportsVision = Boolean(conn.supports_vision);

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
  const includedSeqs = handoff.included_seqs as number[];
  const { data: rows } = await client
    .from("messages")
    .select(
      "id, seq, author_kind, author_participant_id, author_agent_connection_id, text, created_at",
    )
    .eq("room_id", roomId)
    .in("seq", includedSeqs.length ? includedSeqs : [0])
    .order("seq", { ascending: true });

  const envelope = await buildEnvelopeFromRows(client, (rows ?? []) as never, boundary);

  let envelopeBody = envelope.body;
  let screenshots: Array<{ messageId: string; mime: string; width: number; height: number; signedUrl: string }> = [];

  if (envelope.hasVisionContent) {
    const messageIds = (rows ?? []).map((r) => r.id);
    const shots = await screenshotPathsFor(client, messageIds);
    if (supportsVision) {
      for (const s of shots) {
        const { data } = await client.storage.from("screenshots").createSignedUrl(s.storage_path, 300);
        if (data?.signedUrl) {
          screenshots.push({ messageId: s.message_id, mime: s.mime, width: s.width, height: s.height, signedUrl: data.signedUrl });
        }
      }
    } else {
      // Text-only handoff with a clear limitation note (issue 0005).
      envelopeBody += `\n\n---\n\nNote: the room shared ${shots.length} screenshot(s) for visual context, but your configuration does not receive images. The screenshots remain visible to participants in the room.`;
    }
  }

  // Acknowledge receipt: advance the room boundary and mark the handoff delivered.
  await client.from("rooms").update({ handoff_boundary: handoff.next_boundary_seq }).eq("id", roomId);
  await client.from("handoffs").update({ status: "delivered" }).eq("id", handoff.id);

  return json({
    pending: true,
    handoffId: handoff.id,
    body: envelopeBody,
    includedSeqs: envelope.includedSeqs,
    hasVisionContent: envelope.hasVisionContent,
    supportsVision,
    screenshots,
  });
};
