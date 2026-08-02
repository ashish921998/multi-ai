import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation } from "convex/react";
import {
  BUILT_IN_AGENT_HARNESSES,
  isHarnessName,
  type HarnessName,
} from "@multi-ai/shared";
import { api } from "../../../../convex/api";
import type { RoomState } from "../../../../convex/rooms";
import { sessionStore, type RoomSession } from "../session.ts";
import { useRoom } from "../useRoom.ts";
import { DocumentWorkspace } from "../components/DocumentWorkspace.tsx";
import { ScreenshotImg } from "../components/ScreenshotImg.tsx";
import {
  buildConnectorCommand,
  parseCustomArguments,
} from "../lib/connectorCommand.ts";
import { errorMessage } from "../lib/errors.ts";
import "./landing.css";

type RoomMessage = RoomState["messages"][number];
type RoomParticipant = RoomState["participants"][number];

interface ConnectCodeResult {
  connectionId: string;
  roomId: string;
  connectionCode: string;
  command: string;
}

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
  const joinRoom = useMutation(api.rooms.joinRoom);
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const r = await joinRoom({
        roomId: props.roomId,
        password,
        displayName: displayName.trim(),
      });
      const session: RoomSession = {
        roomId: r.roomId,
        participantId: r.participantId,
        displayName: r.displayName,
        sessionToken: r.sessionToken,
      };
      sessionStore.put(session);
      props.onJoined(session);
    } catch (e) {
      setError(errorMessage(e, "Could not join the room."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lp lp-join-page">
      <svg className="lp-grain" aria-hidden="true">
        <filter id="lp-join-grain-filter">
          <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="4" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#lp-join-grain-filter)" />
      </svg>

      <div className="lp-inner lp-join-page-inner">
        <header className="lp-top">
          <Link className="lp-wordmark" to="/">
            planning room
          </Link>
          <span className="lp-room-code">{props.roomId}</span>
        </header>

        <main className="lp-join-main">
          <p className="lp-eyebrow lp-rise">You&apos;re invited</p>
          <h1 className="lp-join-title lp-rise d2">
            Step into the <span className="lp-serif">room.</span>
          </h1>
          <p className="lp-sub lp-rise d3">
            Use the password from your invite and pick the name everyone will see.
          </p>

          <form
            className="lp-box lp-join-box lp-rise d4"
            onSubmit={(event) => {
              event.preventDefault();
              void join();
            }}
          >
            <div className="lp-field">
              <label className="lp-label" htmlFor="join-display-name">
                Display name
              </label>
              <input
                id="join-display-name"
                className="lp-input lp-join-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={40}
                placeholder="Your name"
                autoComplete="name"
                autoFocus
              />
            </div>
            <div className="lp-field">
              <label className="lp-label" htmlFor="join-room-password">
                Room password
              </label>
              <input
                id="join-room-password"
                className="lp-input lp-join-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div className="lp-error lp-join-error" role="alert">
                {error}
              </div>
            )}
            <div className="lp-box-foot lp-join-actions">
              <Link className="lp-btn is-bare" to="/">
                Wrong room?
              </Link>
              <button
                type="submit"
                className="lp-btn"
                disabled={busy || !password || !displayName.trim()}
              >
                {busy ? "Joining…" : "Join the room"}
              </button>
            </div>
          </form>

          <p className="lp-hint lp-rise d5">No account needed. The room expires on its own.</p>
        </main>
      </div>
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
  const { state, banner, sendToAgent, requestConnectCode, post, upload } = useRoom(
    props.session,
    props.roomId,
  );
  const [connectModal, setConnectModal] = useState<ConnectCodeResult | null>(null);

  // `undefined` = still loading; `null` = invalid/expired session → rejoin.
  const data = state ?? null;
  if (data === null && state === undefined) {
    return (
      <div className="app">
        <TopBar roomId={props.roomId} title="" />
        <main className="center-screen">
          <p className="hint">Loading the room…</p>
        </main>
      </div>
    );
  }
  if (data === null) {
    sessionStore.clear(props.roomId);
    return (
      <div className="app">
        <TopBar roomId={props.roomId} title="" />
        <main className="center-screen">
          <div className="card">
            <h1>Couldn't open the room</h1>
            <p className="sub">Your session is invalid or the room has expired. Rejoin to continue.</p>
            <button type="button" className="btn" onClick={props.onSessionLost}>
              Back to join
            </button>
          </div>
        </main>
      </div>
    );
  }

  const nameMap = new Map(data.participants.map((participant) => [participant.id, participant.displayName]));
  const handoffInProgress = data.handoffInProgress;
  const latestAgentPlan = [...data.messages].reverse().find(
    (message) => message.authorKind === "agent" && Boolean(message.text.trim()),
  ) ?? null;

  return (
    <div className="app">
      <TopBar roomId={props.roomId} title={data.room.title} />
      <div className="room-layout">
        {/* LEFT: room context, participants, agent */}
        <aside className="pane left">
          <span className="kicker">ROOM CONTEXT</span>
          <h2>{data.room.title}</h2>
          <div className="divider" />
          <span className="kicker muted">PARTICIPANTS · {data.participants.length}</span>
          <div>
            {data.participants.map((p: RoomParticipant) => (
              <div key={p.id} className="participant online">
                <span className="avatar">{initials(p.displayName)}</span>
                <div>
                  <div className="name">
                    {p.displayName}
                    {p.isSelf ? " (you)" : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="divider" />
          <span className="kicker muted">ACTIVE AGENT</span>
          <div className="agent-card">
            <div className="agent-icon">AI</div>
            <div>
              <div className="title">{data.agent.active ? "Agent connected" : "No agent connected"}</div>
              <div className={"status" + (data.agent.active ? "" : " idle")}>
                {data.agent.active
                  ? handoffInProgress
                    ? "responding…"
                    : "active and ready"
                  : "anyone can connect"}
              </div>
            </div>
          </div>
          <button type="button"
            className="btn secondary"
            style={{ width: "100%", marginTop: 14 }}
            onClick={async () => {
              try {
                const c = await requestConnectCode();
                if (c) setConnectModal(c as ConnectCodeResult);
              } catch (e) {
                alert(errorMessage(e, "Could not issue a code."));
              }
            }}
          >
            Connect an agent
          </button>
        </aside>

        <DocumentWorkspace
          roomId={props.roomId}
          sessionToken={props.session.sessionToken}
          documents={data.documents}
          latestAgentPlan={latestAgentPlan}
          handoffInProgress={handoffInProgress}
          banner={banner}
          sendToAgent={sendToAgent}
        />

        {/* RIGHT: discussion + composer */}
        <aside className="pane discussion">
          <span className="kicker muted">DISCUSSION · {data.messages.length}</span>
          {visionWarning(data) && <div className="banner warn">{visionWarning(data)}</div>}
          <div className="messages">
            {data.messages.map((m: RoomMessage) => (
              <Message
                key={m.id}
                m={m}
                me={props.session.participantId}
                nameMap={nameMap}
                roomId={props.roomId}
                sessionToken={props.session.sessionToken}
              />
            ))}
            {data.messages.length === 0 && (
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
        <button type="button"
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
  m: RoomMessage;
  me: string;
  nameMap: Map<string, string>;
  roomId: string;
  sessionToken: string;
}) {
  const isAgent = props.m.authorKind === "agent";
  const name = isAgent ? "Agent" : authorName(props.m, props.me, props.nameMap);
  return (
    <article className={"message" + (isAgent ? " agent" : "")}>
      <span className="avatar">{isAgent ? "AI" : initials(name)}</span>
      <div className="body">
        <div className="head">
          <span className="name">{name}</span>
          <span className="time">{clock(props.m.createdAt)}</span>
        </div>
        <div className={"text" + (isAgent && props.m.status === "streaming" ? " streaming-cursor" : "")}>
          {props.m.text || (isAgent && props.m.status === "streaming" ? "The agent is responding…" : "")}
        </div>
        {props.m.screenshots.length > 0 && (
          <div className="shots">
            {props.m.screenshots.map((s) => (
              <ScreenshotImg
                key={s.id}
                roomId={props.roomId}
                sessionToken={props.sessionToken}
                screenshotId={s.id}
              />
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
  const [pending, setPending] = useState<{ id: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    const { resizeImage } = await import("../lib/images.ts");
    const additions = await Promise.all(images.map(async (file) => {
      try {
        const resized = await resizeImage(file);
        const uploaded = await props.upload(resized.blob, resized.width, resized.height);
        return uploaded
          ? { id: uploaded.id, url: URL.createObjectURL(resized.blob) }
          : null;
      } catch (error) {
        alert(errorMessage(error, "Could not attach the screenshot."));
        return null;
      }
    }));
    setPending((current) => [
      ...current,
      ...additions.filter((addition): addition is { id: string; url: string } => addition !== null),
    ]);
  }

  function removePending(id: string) {
    setPending((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return current.filter((item) => item.id !== id);
    });
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
      alert(errorMessage(e, "Could not send the message."));
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
              <button type="button" aria-label="Remove screenshot" onClick={() => removePending(p.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      <label className="sr-only" htmlFor="room-message">Message</label>
      <textarea
        id="room-message"
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
          <button type="button" className="icon-btn" title="Attach screenshot" onClick={() => fileRef.current?.click()}>
            ＋
          </button>
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
        <button type="button" className="btn" disabled={busy || (!text.trim() && pending.length === 0)} onClick={send}>
          {busy ? "Sending…" : "Send to room"}
        </button>
      </div>
    </div>
  );
}

type HarnessChoice = HarnessName | "custom";

function ConnectModal(props: { info: ConnectCodeResult; onClose: () => void }) {
  const [harness, setHarness] = useState<HarnessChoice>("codex");
  const [customExecutable, setCustomExecutable] = useState("");
  const [customArgs, setCustomArgs] = useState("");
  const [supportsVision, setSupportsVision] = useState(false);
  const command = buildConnectorCommand(
    props.info.command,
    harness === "custom"
      ? {
          kind: "custom",
          executable: customExecutable,
          args: parseCustomArguments(customArgs),
          supportsVision,
        }
      : { kind: "builtIn", name: harness, supportsVision },
  );
  const displayedCommand = command ?? `${props.info.command} --agent custom --command <executable>`;

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Connect a local coding agent</h3>
        <p className="sub" style={{ color: "var(--muted)", marginTop: 4 }}>
          Choose a harness and run the command beside your repository. The connector only makes
          outbound connections—no port or tunnel needed.
        </p>
        <div className="field">
          <label htmlFor="agent-harness">Agent harness</label>
          <select
            id="agent-harness"
            className="input"
            value={harness}
            onChange={(event) => {
              const selection = event.target.value;
              if (selection === "custom" || isHarnessName(selection)) setHarness(selection);
            }}
          >
            {BUILT_IN_AGENT_HARNESSES.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.label}</option>
            ))}
            <option value="custom">Custom command</option>
          </select>
        </div>
        {harness === "custom" && (
          <>
            <div className="field">
              <label htmlFor="custom-agent-command">Executable</label>
              <input
                id="custom-agent-command"
                className="input"
                value={customExecutable}
                onChange={(event) => setCustomExecutable(event.target.value)}
                placeholder="./my-agent"
              />
              <span className="hint">
                Use a command on PATH or an absolute/relative path. Shell expansions such as ~,
                $HOME, and globs are not applied.
              </span>
            </div>
            <div className="field">
              <label htmlFor="custom-agent-args">Arguments (one per line)</label>
              <textarea
                id="custom-agent-args"
                className="input"
                value={customArgs}
                onChange={(event) => setCustomArgs(event.target.value)}
                placeholder={"run\n--plain"}
                rows={3}
              />
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="agent-supports-vision">Screenshot support</label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400 }}>
            <input
              id="agent-supports-vision"
              type="checkbox"
              checked={supportsVision}
              onChange={(event) => setSupportsVision(event.target.checked)}
            />
            This agent and model can read local image files
          </label>
        </div>
        <div className="code-block">{displayedCommand}</div>
        <p className="hint">One-time code: {props.info.connectionCode}</p>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button type="button"
            className="btn secondary"
            disabled={!command}
            onClick={() => {
              if (command) void navigator.clipboard?.writeText(command);
            }}
          >
            Copy command
          </button>
          <button type="button" className="btn ghost" onClick={props.onClose}>
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

function authorName(m: RoomMessage, me: string, nameMap: Map<string, string>): string {
  if (m.authorParticipantId === me) return "You";
  if (m.authorParticipantId) return nameMap.get(m.authorParticipantId) ?? "Participant";
  return "Someone";
}

/** Returns a vision-capability warning when the active agent can't see screenshots (issue 0005). */
function visionWarning(data: RoomState): string | null {
  if (!data.agent.active || data.agent.supportsVision) return null;
  const hasShots = data.messages.some((m) => m.screenshots.length > 0);
  if (!hasShots) return null;
  return "The connected agent does not receive images, so screenshots stay visible in the room but are omitted from its handoff.";
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
