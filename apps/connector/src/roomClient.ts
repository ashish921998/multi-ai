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
  #closing: Promise<void> | null = null;
  #agentConnectionId: string | null = null;

  constructor(
    private readonly createClient: (url: string) => ConvexClient = (url) => new ConvexClient(url),
    private readonly convexUrl = CONVEX_URL,
  ) {}

  private client(): ConvexClient {
    if (this.#closing) throw new Error("Convex client is closed.");
    if (!this.#client) {
      if (!this.convexUrl) throw new Error("CONVEX_URL env var is not set.");
      this.#client = this.createClient(this.convexUrl);
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
    if (handoff.workspaceDocument) result.workspaceDocument = handoff.workspaceDocument;
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
    let disconnectFailed = false;
    let disconnectError: unknown;
    try {
      await this.client().mutation(api.agent.disconnect, {
        agentConnectionId: asConnId(agentConnectionId),
      });
    } catch (error) {
      disconnectFailed = true;
      disconnectError = error;
    }

    this.#agentConnectionId = null;
    try {
      await this.close();
    } catch (closeError) {
      if (disconnectFailed) {
        throw new AggregateError(
          [disconnectError, closeError],
          "Agent disconnect and Convex client close both failed.",
        );
      }
      throw closeError;
    }
    if (disconnectFailed) throw disconnectError;
  }

  async writeDocument(
    agentConnectionId: string,
    roomId: string,
    path: string,
    body: string,
    base: { id: string; version: number } | null,
  ): Promise<number> {
    if (!base) {
      // `documents.create` checks the indexed room/path pair transactionally. If
      // another collaborator created the path after the agent's snapshot, this fails
      // rather than replacing their document.
      const created = await this.client().mutation(api.documents.create, {
        roomId,
        agentConnectionId: asConnId(agentConnectionId),
        path,
        body,
        summary: "Agent created the plan",
      });
      return created.version;
    }

    // Address the exact document captured with the handoff instead of searching
    // the bounded workspace list. The mutation verifies room ownership and the
    // version precondition in one transaction.
    const updated = await this.client().mutation(api.documents.update, {
      roomId,
      agentConnectionId: asConnId(agentConnectionId),
      documentId: base.id as Id<"documents">,
      body,
      expectedVersion: base.version,
      summary: "Agent updated the plan",
    });
    return updated.version;
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
    if (!this.#closing) {
      const client = this.#client;
      this.#client = null;
      this.#closing = Promise.resolve().then(() => client?.close());
    }
    await this.#closing;
  }
}
