import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import { requireSession } from "../_shared/session.ts";
import { consumeRate } from "../_shared/ratelimit.ts";
import {
  generateConnectionCode,
  generateId,
  hashConnectionCode,
} from "../../../packages/shared/src/index.ts";

interface ConnectCodeRequest {
  roomId?: string;
}

export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const body = (await req.json().catch(() => ({}))) as ConnectCodeRequest;
  const roomId = body.roomId?.trim().toUpperCase();
  if (!roomId) return errorResponse(400, "roomId is required.");

  const client = adminClient();
  const session = await requireSession(client, roomId, req.headers.get("x-session-token"));
  if (!session) return errorResponse(401, "Invalid or expired session. Rejoin the room.");

  // Throttle code generation so a participant cannot mint unlimited codes.
  const allowed = await consumeRate(client, "connect_code", session.participantId, 5);
  if (!allowed) return errorResponse(429, "Too many connection codes. Try again in a minute.");

  const rawCode = generateConnectionCode();
  const codeHash = await hashConnectionCode(rawCode);
  const connectionId = generateId("conn");
  const now = new Date().toISOString();

  const { error } = await client.from("agent_connections").insert({
    id: connectionId,
    room_id: roomId,
    participant_id: session.participantId,
    connection_code_hash: codeHash,
    status: "disconnected",
    last_heartbeat_at: now,
    released_at: now,
  });
  if (error) {
    console.error("connect-code insert failed", error);
    return errorResponse(500, "Could not issue a connection code.");
  }

  // The participant gives both the room id and the code to their local Pi.
  return json({
    connectionId,
    roomId,
    connectionCode: rawCode,
    command: `room connect ${roomId} ${rawCode}`,
  });
};
