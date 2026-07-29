/**
 * Per-room session persistence. The session token is the only credential needed
 * to read room content and post messages; we keep it in localStorage keyed by
 * room id so a refresh or new tab keeps the participant in the room.
 */

export interface RoomSession {
  roomId: string;
  participantId: string;
  displayName: string;
  sessionToken: string;
}

const KEY = "multi-ai:sessions";

function read(): Record<string, RoomSession> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function write(sessions: Record<string, RoomSession>) {
  localStorage.setItem(KEY, JSON.stringify(sessions));
}

export const sessionStore = {
  get(roomId: string): RoomSession | null {
    return read()[roomId.toUpperCase()] ?? null;
  },
  put(session: RoomSession) {
    const all = read();
    all[session.roomId.toUpperCase()] = session;
    write(all);
  },
  clear(roomId: string) {
    const all = read();
    delete all[roomId.toUpperCase()];
    write(all);
  },
};
