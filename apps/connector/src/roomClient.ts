/**
 * Reactive Convex implementation of RoomAgentClient.
 *
 * Replaces the Supabase HTTP poll loop + realtime broadcast signal (decision:
 * reactive connector). The connector subscribes to `agent.pendingHandoff` via
 * `ConvexClient.onUpdate`, so it is notified the instant a handoff is created —
 * no polling. The `RoomAgentClient` interface is unchanged, so `connector.ts`
 * and its unit tests need no edits.
 *
 * The `agentConnectionId` returned by `connect` is the connector's bearer
 * credential: every later call is authorized by presenting it. It is an opaque,
 * unguessable id, so the connector never needs the participant's session token.
 */

import { ConvexClient } from "convex/browser";
import { api } from "../../../convex/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type {
  ConnectResult,
  PendingHandoff,
  RespondOptions,
  RoomAgentClient,
} from "./connector.ts";

const CONVEX_URL = process.env.CONVEX_URL ?? "";

/** Casts a client-held id to the branded Convex id type in one named place. */
const asConnId = (id: string): Id<"agentConnections"> => id as Id<"agentConnections">;

export class ConvexRoomAgentClient implements RoomAgentClient {
  #client: ConvexClient | null = null;
  #agentConnectionId: string | null = null;

  private client(): ConvexClient {
    if (!this.#client) {
      if (!CONVEX_URL) throw new Error("CONVEX_URL env var is not set.");
      this.#client = new ConvexClient(CONVEX_URL);
    }
    return this.#client;
  }

  async connect(
    roomId: string,
    connectionCode: string,
    supportsVision: boolean,
  ): Promise<ConnectResult> {
    const r = await this.client().mutation(api.agent.connect, {
      roomId,
      connectionCode,
      supportsVision,
    });
    this.#agentConnectionId = r.agentConnectionId;
    return {
      agentConnectionId: r.agentConnectionId,
      roomId: r.roomId,
      boundarySeq: r.boundarySeq,
      heartbeatIntervalMs: r.heartbeatIntervalMs,
    };
  }

  async fetchHandoff(agentConnectionId: string): Promise<PendingHandoff> {
    const handoff = await this.client().mutation(api.handoff.fetch, {
      agentConnectionId: asConnId(agentConnectionId),
    });
    if (!handoff.pending || !handoff.handoffId) return { pending: false };

    // Vision screenshots need viewable URLs; storage URLs are reader-only, so
    // they are resolved through the `visionUrl` query (one per image, ≤10).
    let screenshots: NonNullable<PendingHandoff["screenshots"]> = [];
    if (handoff.hasVisionContent && handoff.supportsVision) {
      for (const s of handoff.screenshots ?? []) {
        const { url } = await this.client().query(api.handoff.visionUrl, {
          agentConnectionId: asConnId(agentConnectionId),
          screenshotId: s.id as Id<"screenshots">,
        });
        if (url) {
          screenshots.push({
            messageId: s.messageId,
            mime: s.mime,
            signedUrl: url,
            width: s.width,
            height: s.height,
          });
        }
      }
    }

    const result: PendingHandoff = { pending: true, handoffId: handoff.handoffId };
    if (handoff.body !== undefined) result.body = handoff.body;
    if (handoff.includedSeqs !== undefined) result.includedSeqs = handoff.includedSeqs;
    if (handoff.hasVisionContent !== undefined) result.hasVisionContent = handoff.hasVisionContent;
    if (screenshots.length > 0) result.screenshots = screenshots;
    return result;
  }

  async respond(agentConnectionId: string, handoffId: string, opts: RespondOptions): Promise<void> {
    await this.client().mutation(api.handoff.respond, {
      agentConnectionId: asConnId(agentConnectionId),
      handoffId: handoffId as Id<"handoffs">,
      ...opts,
    });
  }

  async heartbeat(agentConnectionId: string): Promise<void> {
    await this.client().mutation(api.agent.heartbeat, {
      agentConnectionId: asConnId(agentConnectionId),
    });
  }

  async disconnect(agentConnectionId: string): Promise<void> {
    await this.client().mutation(api.agent.disconnect, {
      agentConnectionId: asConnId(agentConnectionId),
    });
  }

  async writeDocument(
    agentConnectionId: string,
    roomId: string,
    path: string,
    body: string,
  ): Promise<number> {
    // Issue 0013: OCC upsert of the agent's plan document. Authorized by the
    // agentConnectionId bearer only (resolveWriter accepts no session token).
    // `ConvexClient.query` is untyped, so the list rows are narrowed here.
    type DocSummary = { id: string; path: string; version: number };
    const docs = (await this.client().query(api.documents.list, {
      roomId,
      agentConnectionId: asConnId(agentConnectionId),
    })) as DocSummary[];
    const existing = docs.find((d: DocSummary) => d.path === path);

    if (!existing) {
      const created = await this.client().mutation(api.documents.create, {
        roomId,
        agentConnectionId: asConnId(agentConnectionId),
        path,
        body,
        summary: "Updated plan",
      });
      return created.version;
    }

    // Update with one OCC retry: if the version moved (another writer), re-read
    // and retry once with the fresh version. A second mismatch re-throws so the
    // connector logs a real failure rather than looping silently.
    try {
      const updated = await this.client().mutation(api.documents.update, {
        roomId,
        agentConnectionId: asConnId(agentConnectionId),
        documentId: existing.id as Id<"documents">,
        body,
        expectedVersion: existing.version,
        summary: "Updated plan",
      });
      return updated.version;
    } catch {
      const fresh = (await this.client().query(api.documents.list, {
        roomId,
        agentConnectionId: asConnId(agentConnectionId),
      })) as DocSummary[];
      const again = fresh.find((d: DocSummary) => d.path === path);
      if (!again) {
        // Document vanished between read and retry — treat as a create.
        const created = await this.client().mutation(api.documents.create, {
          roomId,
          agentConnectionId: asConnId(agentConnectionId),
          path,
          body,
          summary: "Updated plan",
        });
        return created.version;
      }
      const updated = await this.client().mutation(api.documents.update, {
        roomId,
        agentConnectionId: asConnId(agentConnectionId),
        documentId: again.id as Id<"documents">,
        body,
        expectedVersion: again.version,
        summary: "Updated plan",
      });
      return updated.version;
    }
  }

  onHandoffSignal(handler: () => void): () => void {
    const id = this.#agentConnectionId;
    if (!id) return () => {};
    const unsubscribe = this.client().onUpdate(
      api.agent.pendingHandoff,
      { agentConnectionId: asConnId(id) },
      (result) => {
        if (result.pending) handler();
      },
    );
    return () => unsubscribe();
  }

  /** Closes the underlying WebSocket. Call on shutdown. */
  async close(): Promise<void> {
    await this.#client?.close();
  }
}
