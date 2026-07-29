import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Broadcasts an opaque ticker on a Supabase Realtime broadcast channel.
 *
 * V1 sends only opaque tickers (sequence numbers, presence ids, booleans) over
 * broadcast — never message text or screenshot content. Browsers receive the
 * ticker and re-fetch content through the session-authenticated Edge Functions.
 * Broadcast is best-effort: if it fails the browser's periodic refetch still
 * converges.
 */
export async function broadcast(
  channelName: string,
  event: string,
  payload: unknown,
): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return false;

  const client = createClient(url, key, { auth: { persistSession: false } });
  const channel = client.channel(channelName);

  const sent = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 2500);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channel
          .send({ type: "broadcast", event, payload })
          .then(() => {
            clearTimeout(timeout);
            resolve(true);
          })
          .catch(() => {
            clearTimeout(timeout);
            resolve(false);
          });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  });

  client.removeChannel(channel);
  return sent;
}

/** Channel name for room-wide tickers (browsers subscribe here). */
export function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}

/** Channel name for a specific agent connection (the connector subscribes here). */
export function agentChannel(agentConnectionId: string): string {
  return `agent:${agentConnectionId}`;
}
