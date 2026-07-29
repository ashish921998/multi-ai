import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildHandoffEnvelope } from "../../../packages/shared/src/index.ts";
import type { HandoffEnvelope, RoomMessage, ScreenshotRef } from "../../../packages/shared/src/index.ts";

interface MessageRow {
  id: string;
  seq: number;
  author_kind: "participant" | "agent";
  author_participant_id: string | null;
  author_agent_connection_id: string | null;
  text: string;
  created_at: string;
}

interface ScreenshotRow {
  id: string;
  message_id: string;
  storage_path: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Builds the deterministic handoff envelope from a set of message rows. Shared by
 * send-handoff (which selects rows with seq > boundary) and agent-fetch-handoff
 * (which selects rows by the handoff's stored included_seqs). Both must produce
 * the identical envelope for the same batch (issue 0003).
 */
export async function buildEnvelopeFromRows(
  client: SupabaseClient,
  rows: MessageRow[],
  boundarySeq: number,
): Promise<HandoffEnvelope> {
  const ids = rows.map((r) => r.id);
  const participantIds = [
    ...new Set(
      rows
        .filter((r) => r.author_kind === "participant")
        .map((r) => r.author_participant_id as string),
    ),
  ];

  const [{ data: shots }, { data: participants }] = await Promise.all([
    ids.length
      ? client
          .from("screenshots")
          .select("id, message_id, storage_path, mime, width, height, bytes")
          .in("message_id", ids)
      : Promise.resolve({ data: [] as ScreenshotRow[] | null }),
    participantIds.length
      ? client.from("participants").select("id, display_name").in("id", participantIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string }[] | null }),
  ]);

  const nameById: Record<string, string> = {};
  for (const p of participants ?? []) nameById[p.id] = p.display_name;

  const messages: RoomMessage[] = rows.map((r) => {
    const mine = (shots ?? []).filter((s) => s.message_id === r.id);
    const screenshots: ScreenshotRef[] = mine.map((s) => ({
      id: s.id,
      path: s.storage_path,
      mime: s.mime as ScreenshotRef["mime"],
      width: s.width,
      height: s.height,
      bytes: s.bytes,
    }));
    const author =
      r.author_kind === "agent"
        ? { kind: "agent" as const, agentConnectionId: r.author_agent_connection_id ?? "" }
        : {
            kind: "participant" as const,
            participantId: r.author_participant_id ?? "",
            displayName: nameById[r.author_participant_id ?? ""] ?? "Participant",
          };
    return {
      id: r.id,
      roomId: "",
      seq: r.seq,
      author,
      content: { text: r.text, screenshots: screenshots.length ? screenshots : undefined },
      createdAt: r.created_at,
    };
  });

  return buildHandoffEnvelope(messages, { boundarySeq });
}

/** Storage paths for the screenshots attached to the given message ids. */
export async function screenshotPathsFor(
  client: SupabaseClient,
  messageIds: string[],
): Promise<ScreenshotRow[]> {
  if (!messageIds.length) return [];
  const { data } = await client
    .from("screenshots")
    .select("id, message_id, storage_path, mime, width, height, bytes")
    .in("message_id", messageIds);
  return (data ?? []) as ScreenshotRow[];
}
