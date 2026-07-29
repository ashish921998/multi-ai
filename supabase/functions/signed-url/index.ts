import { preflight } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/response.ts";
import { adminClient } from "../_shared/supabase.ts";
import { requireSession } from "../_shared/session.ts";

interface SignedUrlRequest {
  roomId?: string;
  screenshotId?: string;
}

export default async (req: Request): Promise<Response> => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const body = (await req.json().catch(() => ({}))) as SignedUrlRequest;
  const roomId = body.roomId?.trim().toUpperCase();
  const screenshotId = body.screenshotId;
  if (!roomId || !screenshotId) return errorResponse(400, "roomId and screenshotId are required.");

  const client = adminClient();
  const session = await requireSession(client, roomId, req.headers.get("x-session-token"));
  if (!session) return errorResponse(401, "Invalid or expired session. Rejoin the room.");

  const { data: shot } = await client
    .from("screenshots")
    .select("storage_path")
    .eq("id", screenshotId)
    .eq("room_id", roomId)
    .maybeSingle();
  if (!shot) return errorResponse(404, "Screenshot not found.");

  const { data, error } = await client.storage
    .from("screenshots")
    .createSignedUrl(shot.storage_path as string, 60);
  if (error || !data?.signedUrl) {
    console.error("signed-url failed", error);
    return errorResponse(500, "Could not create a viewable link.");
  }

  return json({ signedUrl: data.signedUrl, expiresIn: 60 });
};
