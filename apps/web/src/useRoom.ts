import { useCallback, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/api";
import type { RoomState } from "../../../convex/rooms";
import type { Id } from "../../../convex/_generated/dataModel";
import type { RoomSession } from "./session.ts";

// ---------------------------------------------------------------------------
// useRoom — one reactive Convex subscription drives the whole room.
//
// This replaces the old opaque-ticker + fetch-on-tick realtime layer: a single
// `useQuery(api.rooms.state, { roomId, sessionToken })` returns a fully
// session-gated snapshot that updates live as participants, messages, and agent
// status change (issue 0004). Mutations are issued through `useMutation`; the
// reactive query picks up their results automatically.
// ---------------------------------------------------------------------------

type Banner = { kind: "info" | "warn" | "success"; text: string } | null;

export function useRoom(session: RoomSession | null, roomId: string): {
  state: RoomState | null | undefined;
  banner: Banner;
  sendToAgent: () => Promise<void>;
  requestConnectCode: () => Promise<{ connectionId: string; roomId: string; connectionCode: string; command: string } | null>;
  post: (text: string, screenshotIds: string[]) => Promise<void>;
  upload: (blob: Blob, width: number, height: number) => Promise<{ id: string } | null>;
  session: RoomSession | null;
} {
  const state = useQuery(
    api.rooms.state,
    session ? { roomId, sessionToken: session.sessionToken } : "skip",
  );

  const sendHandoff = useMutation(api.handoff.send);
  const issueCode = useMutation(api.connectCode.issue);
  const postMessage = useMutation(api.messages.post);
  const generateUploadUrl = useMutation(api.screenshots.generateUploadUrl);
  const registerScreenshot = useMutation(api.screenshots.register);

  const [banner, setBanner] = useState<Banner>(null);

  const sendToAgent = useCallback(async () => {
    if (!session) return;
    setBanner({ kind: "info", text: "Sending the new discussion to Pi…" });
    try {
      const result = await sendHandoff({ roomId, sessionToken: session.sessionToken });
      setBanner(
        result.retry
          ? { kind: "warn", text: "Retrying the last handoff to Pi." }
          : { kind: "success", text: "Sent to Pi. The response will stream into the timeline." },
      );
    } catch (e) {
      setBanner({ kind: "warn", text: e instanceof Error ? e.message : "Could not send to Pi." });
    }
  }, [roomId, session, sendHandoff]);

  const requestConnectCode = useCallback(async () => {
    if (!session) return null;
    return issueCode({ roomId, sessionToken: session.sessionToken });
  }, [roomId, session, issueCode]);

  const post = useCallback(
    async (text: string, screenshotIds: string[]) => {
      if (!session) return;
      await postMessage({
        roomId,
        sessionToken: session.sessionToken,
        text,
        screenshotIds: screenshotIds as Id<"screenshots">[],
      });
    },
    [roomId, session, postMessage],
  );

  const upload = useCallback(
    async (blob: Blob, width: number, height: number) => {
      if (!session) return null;
      const { uploadUrl } = await generateUploadUrl({
        roomId,
        sessionToken: session.sessionToken,
      });
      const postResult = await fetch(uploadUrl, {
        method: "POST",
        headers: { "content-type": blob.type },
        body: blob,
      });
      if (!postResult.ok) {
        throw new Error(`Screenshot upload failed (${postResult.status}).`);
      }
      const { storageId } = (await postResult.json()) as { storageId: string };
      const ref = await registerScreenshot({
        roomId,
        sessionToken: session.sessionToken,
        storageId: storageId as Id<"_storage">,
        mime: blob.type,
        width,
        height,
      });
      return { id: ref.id };
    },
    [roomId, session, generateUploadUrl, registerScreenshot],
  );

  return { state, banner, sendToAgent, requestConnectCode, post, upload, session };
}

export type { RoomState };
