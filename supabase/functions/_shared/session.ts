import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface ParticipantSession {
  participantId: string;
  displayName: string;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validates a participant session for a room. The browser sends the opaque
 * session token (returned by join-room) in the `x-session-token` header. We
 * compare its SHA-256 against the stored hash and refresh last_seen_at.
 */
export async function requireSession(
  client: SupabaseClient,
  roomId: string,
  sessionToken: string | null,
): Promise<ParticipantSession | null> {
  if (!sessionToken) return null;
  const tokenHash = await sha256Hex(sessionToken);
  const { data } = await client
    .from("participants")
    .select("id, display_name")
    .eq("room_id", roomId)
    .eq("session_token_hash", tokenHash)
    .maybeSingle();
  if (!data) return null;
  await client.rpc("touch_participant_seen", { p_participant_id: data.id });
  return { participantId: data.id as string, displayName: data.display_name as string };
}
