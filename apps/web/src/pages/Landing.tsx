import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/api";

interface CreateRoomResult {
  roomId: string;
  title: string;
  password: string;
  joinUrl: string;
  expiresInDays: number;
}

export function Landing() {
  const navigate = useNavigate();
  const createRoom = useMutation(api.rooms.createRoom);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateRoomResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinId, setJoinId] = useState("");

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const trimmed = title.trim();
      const result = (await createRoom(trimmed ? { title: trimmed } : {})) as CreateRoomResult;
      setCreated(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the room.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">↗</span>
          <span>Planning Room</span>
        </div>
      </header>

      <main className="center-screen">
        {created ? (
          <div className="card">
            <h1>Room ready</h1>
            <p className="sub">Share the link and password with up to 10 people.</p>

            <div className="field">
              <label>Room link</label>
              <div className="code-block">{created.joinUrl}</div>
            </div>
            <div className="field">
              <label>Password</label>
              <div className="code-block">{created.password}</div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn" onClick={() => navigate(`/r/${created.roomId}`)}>
                Open room
              </button>
              <button
                className="btn secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(`${created.joinUrl}\nPassword: ${created.password}`);
                }}
              >
                Copy invite
              </button>
              <button className="btn ghost" onClick={() => setCreated(null)}>
                New room
              </button>
            </div>
            <p className="hint" style={{ marginTop: 16 }}>
              Expires in {created.expiresInDays} days of inactivity.
            </p>
          </div>
        ) : (
          <div className="card">
            <h1>Start a planning room</h1>
            <p className="sub">
              A temporary space where a team and one local Pi agent turn a discussion into a plan.
            </p>

            <div className="field">
              <label>Room title (optional)</label>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Onboarding flow"
                maxLength={120}
              />
            </div>
            {error && <div className="error">{error}</div>}
            <button className="btn" style={{ width: "100%" }} disabled={creating} onClick={create}>
              {creating ? "Creating…" : "Create room"}
            </button>

            <div className="divider" />

            <div className="field">
              <label>Joining a room? Enter its code</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value.toUpperCase())}
                  placeholder="K7Q9FXM2PW"
                />
                <button
                  className="btn secondary"
                  disabled={joinId.trim().length < 6}
                  onClick={() => navigate(`/r/${joinId.trim()}`)}
                >
                  Go
                </button>
              </div>
            </div>
            <p className="hint">No account needed. You'll set a display name when you join.</p>
          </div>
        )}
      </main>
    </div>
  );
}
