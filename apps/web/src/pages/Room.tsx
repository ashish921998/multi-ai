import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.ts";
import { sessionStore, type RoomSession } from "../session.ts";
import { useRoom } from "../useRoom.ts";
import { ScreenshotImg } from "../components/ScreenshotImg.tsx";
import type { ConnectCodeResponse, RoomStateMessage, RoomStateResponse } from "../api.ts";

export function Room() {
  const params = useParams();
  const roomId = (params.roomId ?? "").toUpperCase();
  const [session, setSession] = useState<RoomSession | null>(() => sessionStore.get(roomId));

  if (!session) {
    return <JoinGate roomId={roomId} onJoined={(s) => setSession(s)} />;
  }
  return <RoomView roomId={roomId} session={session} onSessionLost={() => setSession(null)} />;
}

// ---------------------------------------------------------------------------
// Join gate
// ---------------------------------------------------------------------------

function JoinGate(props: { roomId: string; onJoined: (s: RoomSession) => void }) {
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.joinRoom(props.roomId, password, displayName.trim());
      const session: RoomSession = {
        roomId: r.roomId,
        participantId: r.participantId,
        displayName: r.displayName,
        sessionToken: r.sessionToken,
      };
      sessionStore.put(session);
      props.onJoined(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join the room.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">↗</span>
          <span>Planning Room</span>
        </div>
        <div className="topbar-meta">
          <span className="room-code">{props.roomId}</span>
        </div>
      </header>
      <main className="center-screen">
        <div className="card">
          <h1>Join the room</h1>
          <p className="sub">Enter the password and the name others will see.</p>
          <div className="field">
            <label>Display name</label>
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={40}
              placeholder="Your name"
            />
          </div>
          <div className="field">
            <label>Room password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Room password"
            />
          </div>
          {error && <div className="error">{error}</div>}
          <button
            className="btn"
            style={{ width: "100%" }}
            disabled={busy || !password || !displayName.trim()}
            onClick={join}
          >
            {busy ? "Joining…" : "Join room"}
          </button>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Room view (three-pane review workspace — Variant D)
// ---------------------------------------------------------------------------

function RoomView(props: {
  roomId: string;
  session: RoomSession;
  onSessionLost: () => void;
}) {
  const { state, sendToAgent, requestConnectCode, post, upload, signedUrlFor, online } = useRoom(
    props.session,
    props.roomId,
  );
  const [connectModal, setConnectModal] = useState<ConnectCodeResponse | null>(null);

  const data = state.data;
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data?.participants ?? []) m.set(p.id, p.displayName);
    return m;
  }, [data?.participants]);
  const handoffInProgress =
    state.data?.handoffStatus === "pending" ||
    state.data?.handoffStatus === "delivered" ||
    state.data?.handoffStatus === "responding";

  const latestAgentPlan = useMemo(() => {
    const msgs = data?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]!;
      if (m.authorKind === "agent" && m.text.trim()) return m;
    }
    return null;
  }, [data?.messages]);

  if (state.loading && !data) {
    return (
      <div className="app">
        <TopBar roomId={props.roomId} title="" />
        <main className="center-screen">
          <p className="hint">Loading the room…</p>
        </main>
      </div>
    );
  }
  if (state.error && !data) {
    return (
      <div className="app">
        <TopBar roomId={props.roomId} title="" />
        <main className="center-screen">
          <div className="card">
            <h1>Couldn't open the room</h1>
            <p className="sub">{state.error}</p>
            <button className="btn" onClick={props.onSessionLost}>
              Back to join
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar roomId={props.roomId} title={data?.room.title ?? ""} />
      <div className="room-layout">
        {/* LEFT: room context, participants, agent */}
        <aside className="pane left">
          <span className="kicker">ROOM CONTEXT</span>
          <h2>{data?.room.title ?? "Planning room"}</h2>
          <div className="divider" />
          <span className="kicker muted">PARTICIPANTS · {data?.participants.length ?? 0}</span>
          <div>
            {(data?.participants ?? []).map((p) => (
              <div key={p.id} className={"participant" + (online.current.has(p.id) ? " online" : "")}>
                <span className="avatar">{initials(p.displayName)}</span>
                <div>
                  <div className="name">{p.displayName}{p.isSelf ? " (you)" : ""}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="divider" />
          <span className="kicker muted">ACTIVE AGENT</span>
          <div className="agent-card">
            <div className="agent-icon">π</div>
            <div>
              <div className="title">{data?.agent.active ? "Pi connected" : "No Pi connected"}</div>
              <div className={"status" + (data?.agent.active ? "" : " idle")}>
                {data?.agent.active
                  ? handoffInProgress
                    ? "responding…"
                    : "active and ready"
                  : "anyone can connect"}
              </div>
            </div>
          </div>
          <button
            className="btn secondary"
            style={{ width: "100%", marginTop: 14 }}
            onClick={async () => {
              try {
                const c = await requestConnectCode();
                if (c) setConnectModal(c);
              } catch (e) {
                alert(e instanceof Error ? e.message : "Could not issue a code.");
              }
            }}
          >
            Connect a Pi
          </button>
        </aside>

        {/* CENTER: read-only shared plan (latest agent response) */}
        <section className="pane">
          <span className="kicker muted">SHARED PLAN · READ ONLY</span>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <span className="hint">{latestAgentPlan ? "Pi's latest direction" : "No plan yet"}</span>
            <button className="btn" disabled={handoffInProgress} onClick={sendToAgent}>
              {handoffInProgress ? "Waiting for Pi…" : "Send to agent ↗"}
            </button>
          </div>
          {state.banner && <div className={"banner " + state.banner.kind}>{state.banner.text}</div>}
          <div className="plan">
            <div className="plan-head">
              <h3>{data?.room.title ?? "Planning room"}</h3>
            </div>
            <div className={"plan-body" + (latestAgentPlan ? "" : " empty")}>
              {latestAgentPlan ? (
                <span className={latestAgentPlan.status === "streaming" ? "streaming-cursor" : undefined}>
                  {latestAgentPlan.text || "Pi is responding…"}
                </span>
              ) : (
                "Discuss the requirement, then choose Send to agent to ask Pi for a focused, testable plan."
              )}
            </div>
          </div>
        </section>

        {/* RIGHT: discussion + composer */}
        <aside className="pane discussion">
          <span className="kicker muted">DISCUSSION · {data?.messages.length ?? 0}</span>
          {visionWarning(data) && <div className="banner warn">{visionWarning(data)}</div>}
          <div className="messages">
            {(data?.messages ?? []).map((m) => (
              <Message key={m.id} m={m} me={props.session.participantId} nameMap={nameMap} signedUrlFor={signedUrlFor} />
            ))}
            {(data?.messages.length ?? 0) === 0 && (
              <p className="empty">No messages yet. Start the discussion below.</p>
            )}
          </div>
          <Composer post={post} upload={upload} />
        </aside>
      </div>

      {connectModal && <ConnectModal info={connectModal} onClose={() => setConnectModal(null)} />}
    </div>
  );
}

function TopBar(props: { roomId: string; title: string }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">↗</span>
        <span>{props.title || "Planning Room"}</span>
      </div>
      <div className="topbar-meta">
        <span className="live-dot" />
        <span>live</span>
        <span className="room-code">{props.roomId}</span>
        <button
          className="btn secondary small"
          onClick={() => navigator.clipboard?.writeText(window.location.href)}
        >
          Copy link
        </button>
      </div>
    </header>
  );
}

function Message(props: {
  m: RoomStateMessage;
  me: string;
  nameMap: Map<string, string>;
  signedUrlFor: (id: string) => Promise<string | null>;
}) {
  const isAgent = props.m.authorKind === "agent";
  const name = isAgent ? "Pi" : authorName(props.m, props.me, props.nameMap);
  return (
    <article className={"message" + (isAgent ? " agent" : "")}>
      <span className="avatar">{isAgent ? "π" : initials(name)}</span>
      <div className="body">
        <div className="head">
          <span className="name">{name}</span>
          <span className="time">{clock(props.m.createdAt)}</span>
        </div>
        <div className={"text" + (isAgent && props.m.status === "streaming" ? " streaming-cursor" : "")}>
          {props.m.text || (isAgent && props.m.status === "streaming" ? "Pi is responding…" : "")}
        </div>
        {props.m.screenshots.length > 0 && (
          <div className="shots">
            {props.m.screenshots.map((s) => (
              <ScreenshotImg key={s.id} screenshotId={s.id} mime={s.mime} signedUrlFor={props.signedUrlFor} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function Composer(props: {
  post: (text: string, screenshotIds: string[]) => Promise<void>;
  upload: (blob: Blob, width: number, height: number) => Promise<{ id: string } | null>;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ id: string; url: string; blob: Blob }[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const { resizeImage } = await import("../lib/images.ts");
        const resized = await resizeImage(file);
        const uploaded = await props.upload(resized.blob, resized.width, resized.height);
        if (uploaded) {
          setPending((p) => [...p, { id: uploaded.id, url: URL.createObjectURL(resized.blob), blob: resized.blob }]);
        }
      } catch (e) {
        alert(e instanceof Error ? e.message : "Could not attach the screenshot.");
      }
    }
  }

  async function send() {
    if (!text.trim() && pending.length === 0) return;
    setBusy(true);
    try {
      await props.post(text.trim(), pending.map((p) => p.id));
      setText("");
      pending.forEach((p) => URL.revokeObjectURL(p.url));
      setPending([]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not send the message.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="composer">
      {pending.length > 0 && (
        <div className="pending-shots">
          {pending.map((p) => (
            <div className="pending-shot" key={p.id}>
              <img src={p.url} alt="Pending screenshot" />
              <button onClick={() => setPending((arr) => arr.filter((x) => x.id !== p.id))}>×</button>
            </div>
          ))}
        </div>
      )}
      <textarea
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a requirement, question, or suggestion…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
        }}
      />
      <div className="composer-foot">
        <div className="composer-tools">
          <button className="icon-btn" title="Attach screenshot" onClick={() => fileRef.current?.click()}>＋</button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <span>Screenshots welcome</span>
        </div>
        <button className="btn" disabled={busy || (!text.trim() && pending.length === 0)} onClick={send}>
          {busy ? "Sending…" : "Send to room"}
        </button>
      </div>
    </div>
  );
}

function ConnectModal(props: { info: ConnectCodeResponse; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Connect your local Pi</h3>
        <p className="sub" style={{ color: "var(--muted)", marginTop: 4 }}>
          Run this once on the machine that has Pi and your repository. Pi makes an outbound
          connection — no port or tunnel needed.
        </p>
        <div className="code-block">{props.info.command}</div>
        <p className="hint">One-time code: {props.info.connectionCode}</p>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button
            className="btn secondary"
            onClick={() => navigator.clipboard?.writeText(props.info.command)}
          >
            Copy command
          </button>
          <button className="btn ghost" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function authorName(m: RoomStateMessage, me: string, nameMap: Map<string, string>): string {
  if (m.authorParticipantId === me) return "You";
  if (m.authorParticipantId) return nameMap.get(m.authorParticipantId) ?? "Participant";
  return "Someone";
}

/** Returns a vision-capability warning when the active agent can't see screenshots (issue 0005). */
function visionWarning(data: RoomStateResponse | null): string | null {
  if (!data || !data.agent.active || data.agent.supportsVision) return null;
  const hasShots = data.messages.some((m) => m.screenshots.length > 0);
  if (!hasShots) return null;
  return "The connected Pi model does not receive images, so screenshots are shared with the room but not with Pi.";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  return (parts[0]![0] ?? "?").toUpperCase();
}

function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
