import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient, appBaseUrl } from "../_shared/supabase.ts";
import { consumeRate, hashKey } from "../_shared/ratelimit.ts";
import {
  DEFAULT_RATE_LIMITS,
  ROOM_INACTIVITY_TTL_MS,
  generateId,
  generateRoomId,
  generateRoomPassword,
  hashRoomPassword,
} from "../../../packages/shared/src/index.ts";

const DAY = 24 * 60 * 60 * 1000;
const EXPIRES_IN = ROOM_INACTIVITY_TTL_MS;

interface CreateRoomRequest {
  title?: string;
}

export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const ip = clientIp(req);
  const ipHash = await hashKey(ip);

  const client = adminClient();
  const allowed = await consumeRate(
    client,
    "room_create",
    ipHash,
    DEFAULT_RATE_LIMITS.roomCreationPerIpPerMinute,
  );
  if (!allowed) return errorResponse(429, "Too many rooms created from this network. Try again in a minute.");

  let body: CreateRoomRequest = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    // empty body is fine — title defaults
  }
  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim().slice(0, 120)
    : "Planning room";

  let roomId = generateRoomId();
  // Guard against the astronomically unlikely id collision.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data } = await client.from("rooms").select("id").eq("id", roomId).maybeSingle();
    if (!data) break;
    roomId = generateRoomId();
  }

  const password = generateRoomPassword();
  const passwordHash = await hashRoomPassword(password);
  const now = Date.now();

  const { error } = await client.from("rooms").insert({
    id: roomId,
    title,
    password_hash: passwordHash,
    expires_at: new Date(now + EXPIRES_IN).toISOString(),
    creator_ip_hash: ipHash,
  });
  if (error) {
    console.error("create-room insert failed", error);
    return errorResponse(500, "Could not create the room.");
  }

  return json({
    roomId,
    title,
    password,
    joinUrl: `${appBaseUrl()}/r/${roomId}`,
    expiresInDays: Math.round(EXPIRES_IN / DAY),
  });
};

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("fly-client-ip") ?? "unknown";
}
