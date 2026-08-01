/**
 * Local Pi connector — orchestrates the room agent protocol.
 *
 * The connector is the participant's outbound link between a room and their
 * local Pi session (issues 0002, 0003, 0006). It:
 *   1. connects with a one-time code and becomes the active agent,
 *   2. heartbeats on the lease interval to keep the slot,
 *   3. listens (and polls as a fallback) for handoffs,
 *   4. streams Pi's response back into the room timeline,
 *   5. disconnects cleanly on stop.
 *
 * The protocol client and the agent responder are injected, so this module is
 * fully unit-testable without a Convex deployment or a real Pi session.
 */

export interface ConnectResult {
  agentConnectionId: string;
  roomId: string;
  boundarySeq: number;
  heartbeatIntervalMs: number;
}

/**
 * The canonical plan document the agent upserts after each completed handoff
 * (issue 0013). A single accumulating artifact rather than one doc per turn —
 * the plan evolves in place.
 */
export const PLAN_DOC_PATH = "plan.md";

export interface WorkspaceDocumentSnapshot {
  id: string;
  path: string;
  body: string;
  version: number;
}

export interface PendingHandoff {
  pending: boolean;
  handoffId?: string;
  body?: string;
  includedSeqs?: number[];
  hasVisionContent?: boolean;
  screenshots?: Array<{
    messageId: string;
    mime: string;
    signedUrl: string;
    width?: number;
    height?: number;
  }>;
  /** The plan version Pi read before responding, used as the OCC write base. */
  workspaceDocument?: WorkspaceDocumentSnapshot;
}

export interface RespondOptions {
  chunk?: string;
  complete?: boolean;
  failed?: boolean;
}

/**
 * The room protocol surface the connector talks to. The real implementation
 * The real implementation is the Convex client; tests inject a fake.
 */
export interface RoomAgentClient {
  connect(roomId: string, connectionCode: string, supportsVision: boolean): Promise<ConnectResult>;
  fetchHandoff(agentConnectionId: string): Promise<PendingHandoff>;
  respond(agentConnectionId: string, handoffId: string, opts: RespondOptions): Promise<void>;
  heartbeat(agentConnectionId: string): Promise<void>;
  disconnect(agentConnectionId: string): Promise<void>;
  /**
   * Writes a workspace document only if it is still at the snapshot Pi read.
   * A null snapshot means Pi observed that the path did not exist. A concurrent
   * human edit is a conflict, never an invitation to overwrite.
   */
  writeDocument(
    agentConnectionId: string,
    roomId: string,
    path: string,
    body: string,
    base: Pick<WorkspaceDocumentSnapshot, "id" | "version"> | null,
  ): Promise<number>;
  /** Subscribes to a realtime handoff signal; returns an unsubscribe. */
  onHandoffSignal(handler: () => void): () => void;
}

/**
 * Turns a handoff envelope into a streamed response. The default implementation
 * shells out to a local command (e.g. `pi`); tests inject a fake.
 */
export interface AgentResponder {
  stream(envelope: PendingHandoff, signal: AbortSignal): AsyncIterable<string>;
}

export interface Scheduler {
  every(ms: number, fn: () => void): () => void;
}

export interface ConnectorDeps {
  client: RoomAgentClient;
  responder: AgentResponder;
  scheduler: Scheduler;
  roomId: string;
  connectionCode: string;
  supportsVision: boolean;
  pollIntervalMs: number;
  stopSignal: AbortSignal;
  log: (message: string) => void;
}

/**
 * Runs the connector until `stopSignal` aborts. Resolves after a clean
 * disconnect. Never rejects — errors are logged and the loop continues where
 * possible.
 */
export async function runConnector(deps: ConnectorDeps): Promise<void> {
  const { client, responder, scheduler, stopSignal, log, roomId, connectionCode, supportsVision } = deps;

  const result = await client.connect(roomId, connectionCode, supportsVision);
  const agentConnectionId = result.agentConnectionId;
  log(`Connected to room ${result.roomId} as the active agent.`);

  let inFlight = false;
  const disposers: Array<() => void> = [];

  const handleHandoff = async () => {
    if (inFlight || stopSignal.aborted) return;
    inFlight = true;
    try {
      const handoff = await client.fetchHandoff(agentConnectionId);
      if (!handoff.pending || !handoff.handoffId) return;

      log(`Received handoff ${handoff.handoffId} (${handoff.includedSeqs?.length ?? 0} new messages).`);

      try {
        let produced = false;
        const chunks: string[] = [];
        for await (const chunk of responder.stream(handoff, stopSignal)) {
          produced = true;
          chunks.push(chunk);
          await client.respond(agentConnectionId, handoff.handoffId, { chunk });
        }
        if (!produced) {
          // Allow an empty-but-successful stream to still complete the handoff.
          await client.respond(agentConnectionId, handoff.handoffId, { complete: true });
        } else {
          await client.respond(agentConnectionId, handoff.handoffId, { complete: true });
        }
        log(`Completed handoff ${handoff.handoffId}.`);

        // Persist the agent's full response as the durable plan document
        // (issue 0013). This is a best-effort side effect: a failure is logged
        // but never fails the handoff, which already completed above.
        if (produced) {
          try {
            await client.writeDocument(
              agentConnectionId,
              result.roomId,
              PLAN_DOC_PATH,
              chunks.join(""),
              handoff.workspaceDocument
                ? {
                    id: handoff.workspaceDocument.id,
                    version: handoff.workspaceDocument.version,
                  }
                : null,
            );
          } catch (err) {
            log(`Could not write plan document: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        await client.respond(agentConnectionId, handoff.handoffId, { failed: true }).catch(() => {});
        log(`Handoff ${handoff.handoffId} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch (err) {
      log(`Handoff error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      inFlight = false;
    }
  };

  disposers.push(scheduler.every(result.heartbeatIntervalMs, () => {
    client.heartbeat(agentConnectionId).catch((e) => log(`Heartbeat failed: ${String(e)}`));
  }));
  disposers.push(scheduler.every(deps.pollIntervalMs, () => {
    void handleHandoff();
  }));
  disposers.push(client.onHandoffSignal(() => {
    void handleHandoff();
  }));

  return new Promise<void>((resolve) => {
    const finish = () => {
      for (const dispose of disposers) dispose();
      client
        .disconnect(agentConnectionId)
        .catch((e) => log(`Disconnect failed: ${String(e)}`))
        .finally(() => {
          log("Disconnected.");
          resolve();
        });
    };
    if (stopSignal.aborted) {
      finish();
    } else {
      stopSignal.addEventListener("abort", finish, { once: true });
    }
  });
}
