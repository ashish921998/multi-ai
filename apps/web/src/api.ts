/**
 * Thin client for the room Edge Functions. The browser holds only the anon key
 * (via VITE_SUPABASE_ANON_KEY for realtime). All content calls go through these
 * functions and authenticate with the opaque session token from join-room.
 */

const FUNCTIONS_URL = (import.meta.env.VITE_FUNCTIONS_URL ?? "").replace(/\/$/, "");

if (!FUNCTIONS_URL) {
  // eslint-disable-next-line no-console
  console.warn("VITE_FUNCTIONS_URL is not set; room API calls will fail.");
}

export interface CreateRoomResponse {
  roomId: string;
  title: string;
  password: string;
  joinUrl: string;
  expiresInDays: number;
}

export interface JoinRoomResponse {
  roomId: string;
  title: string;
  participantId: string;
  displayName: string;
  sessionToken: string;
}

export interface RoomStateResponse {
  room: { id: string; title: string; createdAt: string; expiresAt: string };
  me: { participantId: string; displayName: string };
  participants: {
    id: string;
    displayName: string;
    joinedAt: string;
    isSelf: boolean;
  }[];
  messages: RoomStateMessage[];
  agent: {
    active: boolean;
    connectionId?: string;
    connectorDisplayName?: string;
    lastHeartbeatAt?: string;
    supportsVision?: boolean;
  };
  boundarySeq: number;
  handoffStatus: string | null;
}

export interface RoomStateMessage {
  id: string;
  seq: number;
  authorKind: "participant" | "agent";
  authorParticipantId: string | null;
  authorAgentConnectionId: string | null;
  text: string;
  status: "streaming" | "complete";
  createdAt: string;
  screenshots: { id: string; mime: string; width: number; height: number; bytes: number }[];
}

export interface PostMessageResponse {
  id: string;
  seq: number;
  authorKind: "participant";
  authorParticipantId: string;
  authorDisplayName: string;
  text: string;
  createdAt: string;
}

export interface ScreenshotRef {
  id: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

export interface ConnectCodeResponse {
  connectionId: string;
  roomId: string;
  connectionCode: string;
  command: string;
}

export interface HandoffResponse {
  handoffId: string;
  retry?: boolean;
  includedSeqs?: number[];
  nextBoundarySeq?: number;
  hasVisionContent?: boolean;
}

async function call<T>(name: string, init: RequestInit & { json?: unknown }): Promise<T> {
  const { json: body, headers, ...rest } = init;
  const request: RequestInit = {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...((headers as Record<string, string>) ?? {}),
    },
  };
  if (body !== undefined) {
    request.body = JSON.stringify(body);
  } else if (rest.body !== undefined) {
    request.body = rest.body;
  }
  const response = await fetch(`${FUNCTIONS_URL}/${name}`, request);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new RoomApiError(data?.error ?? `Request failed (${response.status})`, response.status);
  }
  return data as T;
}

export class RoomApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "RoomApiError";
  }
}

function sessionHeaders(sessionToken: string): Record<string, string> {
  return { "x-session-token": sessionToken };
}

export const api = {
  createRoom: (title?: string) =>
    call<CreateRoomResponse>("create-room", { method: "POST", json: { title } }),

  joinRoom: (roomId: string, password: string, displayName: string) =>
    call<JoinRoomResponse>("join-room", {
      method: "POST",
      json: { roomId, password, displayName },
    }),

  roomState: (roomId: string, sessionToken: string, sinceSeq = 0) =>
    call<RoomStateResponse>("room-state", {
      method: "POST",
      json: { roomId, sinceSeq },
      headers: sessionHeaders(sessionToken),
    }),

  postMessage: (roomId: string, sessionToken: string, text: string, screenshotIds: string[] = []) =>
    call<PostMessageResponse>("post-message", {
      method: "POST",
      json: { roomId, text, screenshotIds },
      headers: sessionHeaders(sessionToken),
    }),

  uploadScreenshot: async (
    roomId: string,
    sessionToken: string,
    blob: Blob,
    width: number,
    height: number,
  ): Promise<ScreenshotRef> => {
    const response = await fetch(`${FUNCTIONS_URL}/upload-screenshot`, {
      method: "POST",
      headers: {
        ...sessionHeaders(sessionToken),
        "x-room-id": roomId,
        "x-screenshot-mime": blob.type,
        "x-screenshot-width": String(width),
        "x-screenshot-height": String(height),
        "content-type": blob.type,
      },
      body: blob,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new RoomApiError(data?.error ?? "Upload failed", response.status);
    return data as ScreenshotRef;
  },

  signedUrl: (roomId: string, sessionToken: string, screenshotId: string) =>
    call<{ signedUrl: string; expiresIn: number }>("signed-url", {
      method: "POST",
      json: { roomId, screenshotId },
      headers: sessionHeaders(sessionToken),
    }),

  connectCode: (roomId: string, sessionToken: string) =>
    call<ConnectCodeResponse>("connect-code", {
      method: "POST",
      json: { roomId },
      headers: sessionHeaders(sessionToken),
    }),

  sendHandoff: (roomId: string, sessionToken: string) =>
    call<HandoffResponse>("send-handoff", {
      method: "POST",
      json: { roomId },
      headers: sessionHeaders(sessionToken),
    }),
};
