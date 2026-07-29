import { useCallback, useEffect, useRef, useState } from "react";
import { api, type RoomStateResponse, type RoomStateMessage } from "./api.ts";
import { sessionStore, type RoomSession } from "./session.ts";
import { subscribeRoom } from "./realtime.ts";
import { mergeMessages } from "./lib/timeline.ts";

// ---------------------------------------------------------------------------
// useRoom — owns room state, realtime subscription, and the actions.
// ---------------------------------------------------------------------------

interface RoomState {
  loading: boolean;
  error: string | null;
  data: RoomStateResponse | null;
  lastSeq: number;
  banner: { kind: "info" | "warn" | "success"; text: string } | null;
}

export function useRoom(session: RoomSession | null, roomId: string) {
  const [state, setState] = useState<RoomState>({
    loading: true,
    error: null,
    data: null,
    lastSeq: 0,
    banner: null,
  });
  const onlineRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(
    async (sinceSeq: number) => {
      if (!session) return;
      try {
        const slice = await api.roomState(roomId, session.sessionToken, sinceSeq);
        setState((prev) => {
          const merged = mergeMessages<RoomStateMessage & { [k: string]: unknown }>(
            (prev.data?.messages ?? []) as never,
            slice.messages as never,
            prev.lastSeq,
          );
          const lastSeq = Math.max(prev.lastSeq, merged.lastSeq);
          return {
            ...prev,
            loading: false,
            error: null,
            lastSeq,
            data: { ...slice, messages: merged.messages as unknown as RoomStateMessage[] },
          };
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Lost contact with the room.";
        if (msg.toLowerCase().includes("session")) {
          sessionStore.clear(roomId);
        }
        setState((prev) => ({ ...prev, loading: false, error: msg }));
      }
    },
    [roomId, session],
  );

  // Initial load + realtime subscription + periodic refetch fallback.
  useEffect(() => {
    if (!session) return;
    void refresh(0);
    const sub = subscribeRoom(
      roomId,
      { participantId: session.participantId, displayName: session.displayName },
      {
        onTicker: (t) => {
          if (t.type === "message") {
            setState((prev) => {
              if (t.seq <= prev.lastSeq) return prev;
              return prev;
            });
            void refresh(stateRef.current.lastSeq);
          } else {
            void refresh(stateRef.current.lastSeq);
          }
        },
        onPresence: (ids) => {
          onlineRef.current = new Set(ids);
          setState((prev) => ({ ...prev }));
        },
      },
    );
    const interval = window.setInterval(() => void refresh(stateRef.current.lastSeq), 8000);
    return () => {
      sub.unsubscribe();
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, session?.sessionToken]);

  const stateRef = useRef(state);
  stateRef.current = state;

  const sendToAgent = useCallback(async () => {
    if (!session) return;
    setState((prev) => ({ ...prev, banner: { kind: "info", text: "Sending the new discussion to Pi…" } }));
    try {
      const result = await api.sendHandoff(roomId, session.sessionToken);
      setState((prev) => ({
        ...prev,
        banner: result.retry
          ? { kind: "warn", text: "Retrying the last handoff to Pi." }
          : { kind: "success", text: "Sent to Pi. The response will stream into the timeline." },
      }));
    } catch (e) {
      setState((prev) => ({
        ...prev,
        banner: { kind: "warn", text: e instanceof Error ? e.message : "Could not send to Pi." },
      }));
    }
  }, [roomId, session]);

  const requestConnectCode = useCallback(async () => {
    if (!session) return null;
    return api.connectCode(roomId, session.sessionToken);
  }, [roomId, session]);

  const post = useCallback(
    async (text: string, screenshotIds: string[]) => {
      if (!session) return;
      await api.postMessage(roomId, session.sessionToken, text, screenshotIds);
      await refresh(stateRef.current.lastSeq);
    },
    [refresh, roomId, session],
  );

  const upload = useCallback(
    async (blob: Blob, width: number, height: number) => {
      if (!session) return null;
      return api.uploadScreenshot(roomId, session.sessionToken, blob, width, height);
    },
    [roomId, session],
  );

  const signedUrlFor = useCallback(
    async (screenshotId: string) => {
      if (!session) return null;
      try {
        const r = await api.signedUrl(roomId, session.sessionToken, screenshotId);
        return r.signedUrl;
      } catch {
        return null;
      }
    },
    [roomId, session],
  );

  return { state, refresh, sendToAgent, requestConnectCode, post, upload, signedUrlFor, online: onlineRef };
}

