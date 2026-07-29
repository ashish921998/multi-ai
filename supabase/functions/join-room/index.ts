import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import { consumeRate, hashKey } from "../_shared/ratelimit.ts";
import {
  DEFAULT_RATE_LIMITS,
  generateParticipantId,
  verifyRoomPassword,
} from "../../../packages/shared/src/index.ts";

interface JoinRoomRequest {
  roomId?: string;
  password?: string;
  displayName?: string;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("fly-client-ip") ?? "unknown";
}

export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const body = (await req.json().catch(() => ({}))) as JoinRoomRequest;
  const roomId = body.roomId?.trim().toUpperCase();
  const password = body.password ?? "";
  const displayName = body.displayName?.trim();

  if (!roomId || !password || !displayName) {
    return errorResponse(400, "roomId, password, and displayName are required.");
  }
  if (displayName.length > 40) {
    return errorResponse(400, "Display name must be 40 characters or fewer.");
  }

  const ip = clientIp(req);
  const ipHash = await hashKey(ip);
  const client = adminClient();

  // 5 failed password attempts per IP per minute (issue 0007).
  const allowed = await consumeRate(
    client,
    "join_fail",
    ipHash,
    DEFAULT_RATE_LIMITS.failedPasswordPerIpPerMinute,
  );
  if (!allowed) return errorResponse(429, "Too many attempts from this network. Try again in a minute.");

  const { data: room } = await client
    .from("rooms")
    .select("id, title, password_hash, expires_at")
    .eq("id", roomId)
    .maybeSingle();
  if (!room) return errorResponse(404, "Room not found.");
  if (new Date(room.expires_at as string).getTime() < Date.now()) {
    return errorResponse(410, "This room has expired.");
  }

  const passwordOk = await verifyRoomPassword(password, room.password_hash as {
    hash: string;
    salt: string;
    iterations: number;
  });
  if (!passwordOk) return errorResponse(401, "Incorrect room password.");

  // Enforce 10 participants per room (issue 0007).
  const { count } = await client
    .from("participants")
    .select("id", { count: "exact", head: true })
    .eq("room_id", roomId);
  if ((count ?? 0) >= DEFAULT_RATE_LIMITS.participantsPerRoom) {
    return errorResponse(409, "This room is full (10 participants).");
  }

  // A display name must be unique within the room.
  const sessionToken = generateParticipantId() + "." + (await sha256Hex(cryptoRandom()));
  const sessionTokenHash = await sha256Hex(sessionToken);
  const participantId = generateParticipantId();

  const { error } = await client.from("participants").insert({
    id: participantId,
    room_id: roomId,
    display_name: displayName,
    session_token_hash: sessionTokenHash,
    ip_hash: ipHash,
  });
  if (error) {
    if (error.code === "23505") {
      return errorResponse(409, "That display name is already taken in this room.");
    }
    console.error("join-room insert failed", error);
    return errorResponse(500, "Could not join the room.");
  }

  await client.rpc("touch_room_activity", { p_room_id: roomId });

  return json({
    roomId,
    title: room.title,
    participantId,
    displayName,
    sessionToken,
  });
};

function cryptoRandom(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
