/**
 * Realtime subscription for a room.
 *
 * The browser subscribes to a per-room Supabase Realtime **broadcast** channel.
 * The channel carries only opaque tickers — a new message sequence number, an
 * agent status change, or a handoff event — never message content. On each
 * ticker the caller refetches the new content through the authenticated Edge
 * Functions. Presence is tracked on the same channel so the participant list
 * reflects who is currently online.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  if (!client) client = createClient(URL, ANON, { auth: { persistSession: false } });
  return client;
}

export type RoomTicker =
  | { type: "message"; seq: number }
  | { type: "agent"; active: boolean }
  | { type: "presence" };

export interface RealtimeHandlers {
  onTicker: (ticker: RoomTicker) => void;
  onPresence: (participantIds: string[]) => void;
}

export interface RealtimeSubscription {
  unsubscribe: () => void;
  track: (participantId: string, displayName: string) => void;
}

/**
 * Subscribes to the room's broadcast + presence channel. Returns a handle whose
 * `track` method announces this participant for presence.
 */
export function subscribeRoom(roomId: string, me: { participantId: string; displayName: string }, handlers: RealtimeHandlers): RealtimeSubscription {
  const channel = supabase().channel(`room:${roomId}`, {
    config: { presence: { key: me.participantId } },
  });

  channel
    .on("broadcast", { event: "message" }, (msg: { payload?: { seq?: number } }) => {
      const seq = msg.payload?.seq;
      if (typeof seq === "number") handlers.onTicker({ type: "message", seq });
    })
    .on("broadcast", { event: "agent" }, (msg: { payload?: { active?: boolean } }) => {
      handlers.onTicker({ type: "agent", active: Boolean(msg.payload?.active) });
    })
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      handlers.onPresence(Object.keys(state));
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ id: me.participantId, name: me.displayName });
        handlers.onTicker({ type: "presence" });
      }
    });

  return {
    unsubscribe: () => {
      supabase().removeChannel(channel);
    },
    track: (participantId: string, displayName: string) => {
      channel.track({ id: participantId, name: displayName });
    },
  };
}
