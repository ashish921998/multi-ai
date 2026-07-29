import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import { broadcast, roomChannel } from "../_shared/realtime.ts";

interface RespondRequest {
  agentConnectionId?: string;
  handoffId?: string;
  chunk?: string;
  complete?: boolean;
  failed?: boolean;
}

// The connector streams Pi's response in chunks, then completes (or fails).
// Each chunk appends to one agent message in the timeline; the room is ticked so
// every browser refetches the streaming response (issue 0003).
export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const body = (await req.json().catch(() => ({}))) as RespondRequest;
  const agentConnectionId = body.agentConnectionId;
  const handoffId = body.handoffId;
  const chunk = typeof body.chunk === "string" ? body.chunk : "";
  if (!agentConnectionId || !handoffId) {
    return errorResponse(400, "agentConnectionId and handoffId are required.");
  }

  const client = adminClient();

  const { data: conn } = await client
    .from("agent_connections")
    .select("id, room_id, status")
    .eq("id", agentConnectionId)
    .maybeSingle();
  if (!conn) return errorResponse(404, "Connection not found.");
  if (conn.status !== "active") return errorResponse(409, "This connection is no longer active.");
  const roomId = conn.room_id as string;

  const { data: handoff } = await client
    .from("handoffs")
    .select("id, status, agent_message_id, next_boundary_seq")
    .eq("id", handoffId)
    .eq("agent_connection_id", agentConnectionId)
    .maybeSingle();
  if (!handoff) return errorResponse(404, "Handoff not found for this connection.");
  if (handoff.status === "complete") return json({ ok: true, status: "complete" });
  if (handoff.status === "failed" && !body.complete && !body.failed) {
    return errorResponse(409, "This handoff previously failed. Retry it from the room.");
  }

  // ---- failure path -------------------------------------------------------
  if (body.failed) {
    await client.from("handoffs").update({ status: "failed" }).eq("id", handoffId);
    if (handoff.agent_message_id) {
      await client
        .from("messages")
        .update({ status: "complete", text: ((await currentText(client, handoff.agent_message_id)) + "\n\n_(response failed — retry available)_") })
        .eq("id", handoff.agent_message_id);
      await broadcast(roomChannel(roomId), "message", { seq: await seqOf(client, handoff.agent_message_id) }).catch(() => {});
    }
    return json({ ok: true, status: "failed" });
  }

  // ---- streaming path -----------------------------------------------------
  let messageId = handoff.agent_message_id as string | null;

  if (!messageId) {
    // First chunk: allocate a sequence and create the streaming agent message.
    const { data: seq, error: seqError } = await client.rpc("allocate_message_seq", { p_room_id: roomId });
    if (seqError || seq === null) {
      console.error("allocate seq failed", seqError);
      return errorResponse(500, "Could not allocate a response sequence.");
    }
    const { data: inserted, error: insError } = await client
      .from("messages")
      .insert({
        room_id: roomId,
        seq: seq as number,
        author_kind: "agent",
        author_agent_connection_id: agentConnectionId,
        text: chunk,
        status: "streaming",
      })
      .select("id")
      .single();
    if (insError || !inserted) {
      console.error("agent message insert failed", insError);
      return errorResponse(500, "Could not start the response.");
    }
    messageId = inserted.id as string;
    await client
      .from("handoffs")
      .update({ status: "responding", agent_message_id: messageId })
      .eq("id", handoffId);
    await broadcast(roomChannel(roomId), "message", { seq: seq as number }).catch(() => {});
  } else if (chunk) {
    const prev = await currentText(client, messageId);
    await client.from("messages").update({ text: prev + chunk }).eq("id", messageId);
    await broadcast(roomChannel(roomId), "message", { seq: await seqOf(client, messageId) }).catch(() => {});
  }

  // ---- completion ---------------------------------------------------------
  if (body.complete) {
    await client.from("messages").update({ status: "complete" }).eq("id", messageId!);
    await client
      .from("handoffs")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", handoffId);
    await broadcast(roomChannel(roomId), "message", { seq: await seqOf(client, messageId!) }).catch(() => {});
    return json({ ok: true, status: "complete" });
  }

  return json({ ok: true, status: "streaming" });
};

async function currentText(client: ReturnType<typeof adminClient>, messageId: string): Promise<string> {
  const { data } = await client.from("messages").select("text").eq("id", messageId).maybeSingle();
  return (data?.text as string) ?? "";
}

async function seqOf(client: ReturnType<typeof adminClient>, messageId: string): Promise<number> {
  const { data } = await client.from("messages").select("seq").eq("id", messageId).maybeSingle();
  return (data?.seq as number) ?? 0;
}
