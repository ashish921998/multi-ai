import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import { requireSession } from "../_shared/session.ts";
import {
  generateId,
  validateScreenshot,
} from "../../../packages/shared/src/index.ts";

// Screenshots are uploaded as raw bytes with metadata in query params / headers.
// MIME is validated against the contract (png/jpeg/webp) and bytes against 5 MB.

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const roomId = req.headers.get("x-room-id")?.trim().toUpperCase();
  const mime = req.headers.get("x-screenshot-mime") ?? "";
  const width = Number(req.headers.get("x-screenshot-width") ?? 0);
  const height = Number(req.headers.get("x-screenshot-height") ?? 0);
  if (!roomId) return errorResponse(400, "x-room-id header is required.");

  const client = adminClient();
  const session = await requireSession(client, roomId, req.headers.get("x-session-token"));
  if (!session) return errorResponse(401, "Invalid or expired session. Rejoin the room.");

  const bytes = new Uint8Array(await req.arrayBuffer());
  const check = validateScreenshot({ mime, bytes: bytes.byteLength });
  if (!check.ok) return errorResponse(400, check.error ?? "Invalid screenshot.");

  const id = generateId("shot");
  const ext = EXT[mime] ?? "png";
  const path = `rooms/${roomId}/${id}.${ext}`;

  const { error: upError } = await client.storage
    .from("screenshots")
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (upError) {
    console.error("screenshot upload failed", upError);
    return errorResponse(500, "Could not store the screenshot.");
  }

  const { error: dbError } = await client.from("screenshots").insert({
    id,
    room_id: roomId,
    storage_path: path,
    mime,
    width: width || 0,
    height: height || 0,
    bytes: bytes.byteLength,
  });
  if (dbError) {
    console.error("screenshot insert failed", dbError);
    // Best-effort cleanup of the orphaned object.
    await client.storage.from("screenshots").remove([path]);
    return errorResponse(500, "Could not record the screenshot.");
  }

  return json({ id, mime, width: width || 0, height: height || 0, bytes: bytes.byteLength });
};
