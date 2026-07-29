/**
 * Real implementation of RoomAgentClient that talks to the Supabase Edge
 * Functions and subscribes to the agent's realtime handoff channel.
 *
 * The agentConnectionId returned by `connect` is the connector's bearer
 * credential: every later call is authorized by presenting it. It is an opaque,
 * unguessable id, so the connector never needs the participant's session token.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ConnectResult,
  PendingHandoff,
  RespondOptions,
  RoomAgentClient,
} from "./connector.ts";

const FUNCTIONS_URL = (process.env.FUNCTIONS_URL ?? "").replace(/\/$/, "");
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";

export class HttpRoomAgentClient implements RoomAgentClient {
  #agentConnectionId: string | null = null;
  #supabase: SupabaseClient | null = null;

  private sb(): SupabaseClient {
    if (!this.#supabase) {
      this.#supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
      });
    }
    return this.#supabase;
  }

  async connect(roomId: string, connectionCode: string): Promise<ConnectResult> {
    const r = await post<{ agentConnectionId: string; roomId: string; boundarySeq: number; heartbeatIntervalMs: number }>(
      "agent-connect",
      { roomId, connectionCode },
    );
    this.#agentConnectionId = r.agentConnectionId;
    return r;
  }

  async fetchHandoff(agentConnectionId: string): Promise<PendingHandoff> {
    return post<PendingHandoff>("agent-fetch-handoff", { agentConnectionId });
  }

  async respond(agentConnectionId: string, handoffId: string, opts: RespondOptions): Promise<void> {
    await post("agent-respond", { agentConnectionId, handoffId, ...opts });
  }

  async heartbeat(agentConnectionId: string): Promise<void> {
    await post("agent-heartbeat", { agentConnectionId });
  }

  async disconnect(agentConnectionId: string): Promise<void> {
    await post("agent-disconnect", { agentConnectionId });
  }

  onHandoffSignal(handler: () => void): () => void {
    const id = this.#agentConnectionId;
    if (!id) return () => {};
    const channel = this.sb().channel(`agent:${id}`);
    channel.on("broadcast", { event: "handoff" }, () => handler()).subscribe();
    return () => {
      this.sb().removeChannel(channel);
    };
  }
}

async function post<T>(name: string, body: unknown): Promise<T> {
  if (!FUNCTIONS_URL) throw new Error("FUNCTIONS_URL env var is not set.");
  const response = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data?.error ?? `Request to ${name} failed (${response.status})`);
  }
  return data as T;
}
