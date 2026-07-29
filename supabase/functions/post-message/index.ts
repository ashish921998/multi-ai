import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import { requireSession } from "../_shared/session.ts";
import { consumeRate } from "../_shared/ratelimit.ts";
import { broadcast, roomChannel } from "../_shared/realtime.ts";
import {
  DEFAULT_RATE_LIMITS,
  generateId,
  validateScreenshotBatch,
} from "../../../packages/shared/src/index.ts";

interface PostMessageRequest {
  roomId?: string;
  text?: string;
  screenshotIds?: string[];
}

const MAX_TEXT = 4000;

export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const body = (await req.json().catch(() => ({}))) as PostMessageRequest;
  const roomId = body.roomId?.trim().toUpperCase();
  const text = (body.text ?? "").trim();
  const screenshotIds = body.screenshotIds ?? [];

  if (!roomId) return errorResponse(400, "roomId is required.");
  if (!text && screenshotIds.length === 0) {
    return errorResponse(400, "A message needs text or a screenshot.");
  }
  if (text.length > MAX_TEXT) return errorResponse(400, `Message must be ${MAX_TEXT} characters or fewer.`);

  const client = adminClient();
  const session = await requireSession(client, roomId, req.headers.get("x-session-token"));
  if (!session) return errorResponse(401, "Invalid or expired session. Rejoin the room.");

  const batch = validateScreenshotBatch(screenshotIds.length);
  if (!batch.ok) return errorResponse(400, batch.error ?? "Too many screenshots.");

  // 30 messages per participant per minute (issue 0007).
  const allowed = await consumeRate(
    client,
    "message",
    session.participantId,
    DEFAULT_RATE_LIMITS.messagesPerParticipantPerMinute,
  );
  if (!allowed) return errorResponse(429, "You are sending messages too quickly. Slow down a moment.");

  // Allocate the sequence number atomically.
  const { data: seqRow, error: seqError } = await client.rpc("allocate_message_seq", {
    p_room_id: roomId,
  });
  if (seqError || seqRow === null) {
    console.error("allocate_message_seq failed", seqError);
    return errorResponse(500, "Could not post the message.");
  }
  const seq = seqRow as number;

  const messageId = generateId("msg");
  const { error } = await client.from("messages").insert({
    id: messageId,
    room_id: roomId,
    seq,
    author_kind: "participant",
    author_participant_id: session.participantId,
    text,
    status: "complete",
  });
  if (error) {
    console.error("post-message insert failed", error);
    return errorResponse(500, "Could not post the message.");
  }

  if (screenshotIds.length > 0) {
    const { error: attachError } = await client
      .from("screenshots")
      .update({ message_id: messageId })
      .in("id", screenshotIds)
      .eq("room_id", roomId);
    if (attachError) console.error("screenshot attach failed", attachError);
  }

  await broadcast(roomChannel(roomId), "message", { seq }).catch(() => {});

  return json({
    id: messageId,
    seq,
    authorKind: "participant",
    authorParticipantId: session.participantId,
    authorDisplayName: session.displayName,
    text,
    createdAt: new Date().toISOString(),
  });
};
