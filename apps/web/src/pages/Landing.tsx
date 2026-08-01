import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/api";
import "./landing.css";

interface CreateRoomResult {
  roomId: string;
  title: string;
  password: string;
  joinUrl: string;
  expiresInDays: number;
}

const NOTES = [
  "no accounts, just a link",
  "your agent stays on your laptop",
  "the room expires on its own",
];

// Plain ASCII, not box-drawing glyphs — those aren't reliably monospaced and
// shear the column alignment.
const DIAGRAM = `your team  -->  room  <--  agent (localhost)
                 |
              the plan`;

// What the typewriter types into the box, wandor-style — room names someone
// would actually open.
const PROMPTS = [
  "checkout rewrite — can we ship it by friday?",
  "why is onboarding slow?",
  "mobile nav refactor, before it gets worse",
  "v2 api: what breaks and who screams",
];

const TICKER = [
  "checkout rewrite",
  "why is onboarding slow",
  "mobile nav refactor",
  "kill the legacy cron",
  "v2 api breakage",
  "design tokens migration",
  "the flaky deploy",
  "auth session bug",
];

/** Types/deletes through `phrases` while `active`; freezes (keeps position) when not. */
function useTypewriter(phrases: string[], active: boolean) {
  const [text, setText] = useState("");
  const pos = useRef({ phrase: 0, char: 0, deleting: false });
  useEffect(() => {
    if (!active) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setText(phrases[0] ?? "");
      return;
    }
    let timer: number;
    const tick = () => {
      const s = pos.current;
      const full = phrases[s.phrase % phrases.length] ?? "";
      s.char += s.deleting ? -1 : 1;
      setText(full.slice(0, s.char));
      let delay = s.deleting ? 22 : 46 + Math.random() * 45;
      if (!s.deleting && s.char >= full.length) {
        s.deleting = true;
        delay = 2400; // linger on the finished phrase
      } else if (s.deleting && s.char <= 0) {
        s.deleting = false;
        s.phrase += 1;
        delay = 600;
      }
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, 700);
    return () => clearTimeout(timer);
  }, [phrases, active]);
  return text;
}

/* Demo timeline: each entry is when that step turns on (ms into the loop). */
const DEMO_AT = [500, 1700, 2900, 4300, 5300, 6400, 7300, 8200];
const DEMO_LOOP = 12500;

/** Steps 0..7 fire on schedule, then the whole loop restarts. */
function useDemoStep() {
  const [step, setStep] = useState(-1);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(DEMO_AT.length - 1);
      return;
    }
    const timers: number[] = [];
    const run = () => {
      timers.length = 0;
      setStep(-1);
      DEMO_AT.forEach((at, i) => timers.push(window.setTimeout(() => setStep(i), at)));
      timers.push(window.setTimeout(run, DEMO_LOOP));
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, []);
  return step;
}

/** Adds .is-in to .lp-reveal elements as they scroll into view. */
function useReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.querySelectorAll(".lp-reveal").forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.18 },
    );
    document.querySelectorAll(".lp-reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/* The ambient scene — the wandor skyline, translated. Instead of landmarks,
   scraps of a planning session drift at the hero's edges. */
function Scene() {
  return (
    <div className="lp-scene" aria-hidden="true">
      <div className="lp-card lp-card-1">
        <span className="lp-card-who">maya</span>
        can we cut scope on step 3?
      </div>
      <div className="lp-card lp-card-2">
        <span className="lp-card-who">ravi</span>
        <span className="lp-chip">▣ checkout-flow.png</span>
      </div>
      <div className="lp-card lp-card-3">
        <span className="lp-card-who">sam</span>
        the cart bug is the real blocker
      </div>
      <div className="lp-card lp-card-4">
        <span className="lp-card-who is-pi">agent · localhost</span>
        drafting plan
        <span className="lp-dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </div>
    </div>
  );
}

/* A miniature room replaying a session: three humans argue, the thread is
   handed to an agent, and the plan streams in. */
function Demo() {
  const step = useDemoStep();
  const on = (i: number) => (step >= i ? " is-on" : "");
  return (
    <div className="lp-demo" aria-hidden="true">
      <div className="lp-demo-bar">
        <span className="lp-demo-live" />
        <span className="lp-demo-code">ROOM K7Q9FXM2PW</span>
        <span className="lp-demo-meta">3 people · 1 agent</span>
      </div>
      <div className="lp-demo-body">
        <div className={"lp-demo-row" + on(0)}>
          <span className="lp-card-who">maya</span>
          <p>checkout keeps dying on step 3. users bail.</p>
        </div>
        <div className={"lp-demo-row" + on(1)}>
          <span className="lp-card-who">ravi</span>
          <p>
            <span className="lp-chip">▣ checkout-flow.png</span>
          </p>
        </div>
        <div className={"lp-demo-row" + on(2)}>
          <span className="lp-card-who">sam</span>
          <p>cart state resets on back-nav — that's the real bug</p>
        </div>
        <div className={"lp-demo-hand" + on(3)}>· · · handed to agent · · ·</div>
        <div className={"lp-demo-pi" + on(4)}>
          <span className="lp-card-who is-pi">
            {step >= 7 ? "agent · plan, v1" : "agent · drafting"}
            {step < 7 && (
              <span className="lp-dots">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            )}
          </span>
          <ol className="lp-demo-plan">
            <li className={on(5)}>reproduce: back-nav with a full cart</li>
            <li className={on(6)}>pin cart store to the session, not the route</li>
            <li className={on(7)}>ship behind a flag, watch the funnel</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  const navigate = useNavigate();
  const createRoom = useMutation(api.rooms.createRoom);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateRoomResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showJoin, setShowJoin] = useState(false);
  const [joinId, setJoinId] = useState("");
  const [copied, setCopied] = useState(false);
  const [focused, setFocused] = useState(false);

  const typewriterOn = !created && !focused && title === "";
  const typed = useTypewriter(PROMPTS, typewriterOn);
  useReveal();

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

  function copyInvite(room: CreateRoomResult) {
    navigator.clipboard?.writeText(`${room.joinUrl}\nPassword: ${room.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="lp">
      <svg className="lp-grain" aria-hidden="true">
        <filter id="lp-grain-filter">
          <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="4" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#lp-grain-filter)" />
      </svg>

      <div className="lp-inner">
        <header className="lp-top">
          <a className="lp-wordmark" href="/">
            planning room
          </a>
          <nav className="lp-nav">
            <a className="lp-link" href="#demo">
              Demo
            </a>
            <a className="lp-link" href="#how">
              How it works
            </a>
            <a
              className="lp-link"
              href="https://github.com/ashish921998/multi-ai"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </nav>
          <button className="lp-btn is-quiet is-small" onClick={() => setShowJoin(true)}>
            Join a room
          </button>
        </header>

        <main>
          <section className="lp-hero">
            <Scene />

            {created ? (
              <>
                <p className="lp-eyebrow lp-rise">Room is live</p>
                <h1 className="lp-rise d2">Send this to the room.</h1>
                <p className="lp-sub lp-rise d3">
                  Anyone with the link and password can join — up to ten people, no sign-up.
                </p>

                <div className="lp-box lp-rise d4">
                  <span className="lp-stamp" aria-hidden="true">
                    room live · no sign-up
                  </span>
                  <div className="lp-field">
                    <span className="lp-label">Room link</span>
                    <div className="lp-value">{created.joinUrl}</div>
                  </div>
                  <div className="lp-field">
                    <span className="lp-label">Password</span>
                    <div className="lp-value">{created.password}</div>
                  </div>

                  <div className="lp-box-foot is-actions">
                    <button className="lp-btn is-bare" onClick={() => setCreated(null)}>
                      Start another
                    </button>
                    <div className="lp-actions">
                      <button className="lp-btn is-quiet" onClick={() => copyInvite(created)}>
                        {copied ? "Copied" : "Copy invite"}
                      </button>
                      <button className="lp-btn" onClick={() => navigate(`/r/${created.roomId}`)}>
                        Open room
                      </button>
                    </div>
                  </div>
                </div>

                <p className="lp-hint lp-rise d5">
                  Goes away after {created.expiresInDays} days of quiet. Nothing to clean up.
                </p>
              </>
            ) : (
              <>
                <p className="lp-eyebrow lp-rise">A room for the messy part</p>
                <h1 className="lp-rise d2">
                  What are we{" "}
                  <span className="lp-accent">
                    building
                    <svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true">
                      <path d="M3 9 C 45 3, 110 11, 197 5" />
                    </svg>
                  </span>
                  ?
                </h1>
                <p className="lp-sub lp-rise d3">
                  Get the team and one local coding agent in the same room. Argue it out, paste
                  screenshots, hand it over—leave with a plan your agent already understands.
                </p>

                <div className="lp-box lp-rise d4">
                  <div className="lp-typewrap">
                    <input
                      className="lp-box-input"
                      aria-label="Room title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onFocus={() => setFocused(true)}
                      onBlur={() => setFocused(false)}
                      onKeyDown={(e) => e.key === "Enter" && !creating && create()}
                      placeholder={typewriterOn ? "" : "Name the room…"}
                      maxLength={120}
                    />
                    {typewriterOn && (
                      <div className="lp-type" aria-hidden="true">
                        {typed}
                        <span className="lp-caret" />
                      </div>
                    )}
                  </div>
                  {error && <div className="lp-error">{error}</div>}

                  <div className="lp-box-foot">
                    <button className="lp-btn is-bare" onClick={() => setShowJoin((v) => !v)}>
                      Have a code?
                    </button>
                    <button className="lp-btn" disabled={creating} onClick={create}>
                      {creating ? "Opening…" : "Open a room"}
                    </button>
                  </div>

                  {showJoin && (
                    <div className="lp-join">
                      <input
                        className="lp-input"
                        aria-label="Room code"
                        value={joinId}
                        onChange={(e) => setJoinId(e.target.value.toUpperCase())}
                        onKeyDown={(e) =>
                          e.key === "Enter" &&
                          joinId.trim().length >= 6 &&
                          navigate(`/r/${joinId.trim()}`)
                        }
                        placeholder="ROOM CODE"
                        autoFocus
                      />
                      <button
                        className="lp-btn is-quiet"
                        disabled={joinId.trim().length < 6}
                        onClick={() => navigate(`/r/${joinId.trim()}`)}
                      >
                        Join
                      </button>
                    </div>
                  )}
                </div>

                <p className="lp-hint lp-rise d5">You pick a display name when you walk in.</p>

                <div className="lp-notes lp-rise d6">
                  {NOTES.map((n) => (
                    <span className="lp-note" key={n}>
                      {n}
                    </span>
                  ))}
                </div>

                <a className="lp-cue lp-rise d7" href="#demo">
                  ↓ watch a room think
                </a>
              </>
            )}
          </section>

          <div className="lp-ticker" aria-hidden="true">
            <div className="lp-ticker-track">
              {[0, 1].map((half) => (
                <div className="lp-ticker-half" key={half}>
                  {TICKER.map((t) => (
                    <span key={t}>
                      {t} <b>·</b>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <section className="lp-section" id="demo">
            <div className="lp-demo-grid">
              <div className="lp-reveal">
                <p className="lp-eyebrow">Watch a room think</p>
                <h2>
                  The argument <span className="lp-serif">is</span> the spec.
                </h2>
                <p className="lp-body">
                  Nobody writes the requirements doc — the room is the requirements doc. Messages,
                  screenshots, and pushback pile up in one thread, and when it's ripe, you hand
                  the whole thing to your agent in one click.
                </p>
                <p className="lp-body">
                  Your agent reads everything—every message, every screenshot—and answers with a plan,
                  streamed back into the room where everyone can tear it apart.
                </p>
              </div>
              <div className="lp-reveal d2">
                <Demo />
              </div>
            </div>
          </section>

          <section className="lp-section" id="how">
            <p className="lp-eyebrow lp-center lp-reveal">How it works</p>
            <h2 className="lp-center lp-reveal d2">
              Three steps. The last one's <span className="lp-serif">not yours.</span>
            </h2>
            <div className="lp-how">
              <div className="lp-how-card lp-reveal">
                <span className="lp-how-num">01</span>
                <h3>Open a room</h3>
                <p>One click, one link, one password. Send it to whoever's in the fight — up to
                ten people, zero accounts.</p>
              </div>
              <div className="lp-how-card lp-reveal d2">
                <span className="lp-how-num">02</span>
                <h3>Argue it out</h3>
                <p>Messages, screenshots, pushback. Don't tidy it—the mess is the point, and your
                agent reads all of it.</p>
              </div>
              <div className="lp-how-card lp-reveal d3">
                <span className="lp-how-num">03</span>
                <h3>Hand it to your agent</h3>
                <p>One click hands the thread to Codex, Claude Code, Cursor, OpenCode, or Pi. It streams the plan
                back for everyone to attack.</p>
              </div>
            </div>

            <div className="lp-term lp-reveal" aria-hidden="true">
              <div className="lp-term-line">
                <b>$</b> room connect K7Q9 FXM2 --agent codex
              </div>
              <div className="lp-term-line is-ok">✓ connected — agent joined the room</div>
              <div className="lp-term-line is-ok">
                ✓ code stays on this laptop<span className="lp-caret" />
              </div>
            </div>
            <p className="lp-hint lp-center lp-reveal">
              The connector reaches <em>outward</em> from your machine. No tunnels, no hosted repos, nothing
              to revoke later.
            </p>
          </section>

          <footer className="lp-footer">
            <pre className="lp-diagram lp-reveal">{DIAGRAM}</pre>
            <div className="lp-footer-row lp-reveal d2">
              <span className="lp-wordmark">planning room</span>
              <span className="lp-footer-note">no accounts · no tunnels · rooms expire on their own</span>
              <a
                className="lp-link"
                href="https://github.com/ashish921998/multi-ai"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
