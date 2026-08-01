import { lazy, Suspense, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { RoomState } from "../../../../convex/rooms";

type RoomDocument = RoomState["documents"][number];
type AgentMessage = RoomState["messages"][number];
type Banner = { kind: "info" | "warn" | "success"; text: string } | null;
type Draft = { body: string; expectedVersion: number };
const MarkdownPreview = lazy(() => import("./MarkdownPreview.tsx"));

type VersionSummary = {
  version: number;
  authorKind: "participant" | "agent";
  summary?: string;
  createdAt: number;
};

interface DocumentWorkspaceProps {
  roomId: string;
  sessionToken: string;
  documents: RoomDocument[];
  latestAgentPlan: AgentMessage | null;
  handoffInProgress: boolean;
  banner: Banner;
  sendToAgent: () => Promise<void>;
}

/**
 * The room's durable shared artifact. Humans and the active agent edit the same
 * versioned documents; chat remains the discussion and handoff channel.
 */
export function DocumentWorkspace(props: DocumentWorkspaceProps) {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const docs = [...props.documents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const selectedDoc = docs.find((doc) => doc.id === selectedDocId) ?? docs[0] ?? null;

  return (
    <section className="pane workspace-pane">
      <span className="kicker muted">SHARED WORKSPACE</span>
      <div className="workspace-toolbar">
        <span className="hint">
          {selectedDoc
            ? "A living document that everyone in the room can edit"
            : props.latestAgentPlan
              ? "Turn the agent's latest direction into a durable document"
              : "Create a plan for the room to build on"}
        </span>
        <div className="workspace-actions">
          <button type="button" className="btn secondary small" onClick={() => setCreating(true)}>
            New document
          </button>
          <button type="button" className="btn small" disabled={props.handoffInProgress} onClick={props.sendToAgent}>
            {props.handoffInProgress ? "Waiting for agent…" : "Send to agent ↗"}
          </button>
        </div>
      </div>

      {props.banner && <div className={`banner ${props.banner.kind}`}>{props.banner.text}</div>}

      {docs.length > 0 && selectedDoc && (
        <div className="doc-switcher" aria-label="Workspace documents">
          {docs.map((doc) => (
            <button type="button"
              key={doc.id}
              className={`doc-chip${doc.id === selectedDoc.id ? " active" : ""}`}
              onClick={() => setSelectedDocId(doc.id)}
              title={doc.path}
            >
              {doc.path}
              <span className="doc-ver">v{doc.version}</span>
            </button>
          ))}
        </div>
      )}

      {selectedDoc ? (
        <DocumentEditor
          key={selectedDoc.id}
          roomId={props.roomId}
          sessionToken={props.sessionToken}
          summary={selectedDoc}
        />
      ) : (
        <EmptyWorkspace
          latestAgentPlan={props.latestAgentPlan}
          onCreate={() => setCreating(true)}
        />
      )}

      {creating && (
        <NewDocumentDialog
          roomId={props.roomId}
          sessionToken={props.sessionToken}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setSelectedDocId(id);
            setCreating(false);
          }}
        />
      )}
    </section>
  );
}

function EmptyWorkspace(props: {
  latestAgentPlan: AgentMessage | null;
  onCreate: () => void;
}) {
  return (
    <div className="plan empty-workspace">
      <div className="plan-head">
        <h3>No workspace documents yet</h3>
      </div>
      <div className="plan-body">
        {props.latestAgentPlan
          ? props.latestAgentPlan.text
          : "Discuss the requirement, create a plan, or send the discussion to an agent to start plan.md."}
      </div>
      <div className="empty-workspace-action">
        <button type="button" className="btn secondary" onClick={props.onCreate}>
          Create the first document
        </button>
      </div>
    </div>
  );
}

function DocumentEditor(props: {
  roomId: string;
  sessionToken: string;
  summary: RoomDocument;
}) {
  const updateDocument = useMutation(api.documents.update);
  const doc = useQuery(api.documents.read, {
    roomId: props.roomId,
    sessionToken: props.sessionToken,
    documentId: props.summary.id as Id<"documents">,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "warn" | "success"; text: string } | null>(null);

  if (doc === undefined) {
    return <div className="plan"><div className="plan-body empty">Loading document…</div></div>;
  }

  const body = draft?.body ?? doc.body;
  const dirty = draft !== null && draft.body !== doc.body;
  const remoteChanged = dirty && draft.expectedVersion !== doc.version;

  async function save() {
    if (!draft || !dirty) return;
    if (draft.expectedVersion !== doc.version) {
      setNotice({
        kind: "warn",
        text: `A newer v${doc.version} arrived while you were editing. Your draft is preserved; load the latest version before saving.`,
      });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const result = await updateDocument({
        roomId: props.roomId,
        sessionToken: props.sessionToken,
        documentId: doc.id,
        body: draft.body,
        expectedVersion: draft.expectedVersion,
        summary: "Edited in the room",
      });
      setDraft(null);
      setNotice({ kind: "success", text: `Saved v${result.version}.` });
    } catch (error) {
      setNotice({ kind: "warn", text: errorMessage(error, "Could not save the document.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="plan document-editor">
      <div className="plan-head document-head">
        <div>
          <h3>{doc.path}</h3>
          <span className="hint">
            v{doc.version} · last edited by {doc.lastAuthorKind === "agent" ? "the agent" : "a participant"}
          </span>
        </div>
        <div className="document-head-actions">
          <div className="segmented" aria-label="Document view">
            <button type="button" className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}>Edit</button>
            <button type="button" className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>Preview</button>
          </div>
          <button type="button" className="btn ghost small" onClick={() => setHistoryOpen((open) => !open)}>
            {historyOpen ? "Hide history" : "History"}
          </button>
        </div>
      </div>

      {notice && <div className={`editor-notice ${notice.kind}`}>{notice.text}</div>}
      {remoteChanged && (
        <div className="conflict-banner" role="alert">
          <div>
            <strong>Newer version available.</strong>
            <span>Your local draft is still here and has not overwritten anyone else's work.</span>
          </div>
          <button type="button"
            className="btn secondary small"
            onClick={() => {
              setDraft(null);
              setNotice(null);
            }}
          >
            Load v{doc.version}
          </button>
        </div>
      )}

      {mode === "edit" ? (
        <textarea
          className="document-textarea"
          aria-label={`Edit ${doc.path}`}
          value={body}
          spellCheck
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next === doc.body ? null : {
              body: next,
              expectedVersion: draft?.expectedVersion ?? doc.version,
            });
            setNotice(null);
          }}
        />
      ) : (
        <DocumentPreview body={body} format={doc.format} />
      )}

      <div className="editor-footer">
        <span className="hint">
          {dirty ? `Unsaved changes based on v${draft.expectedVersion}` : "All changes saved"}
        </span>
        <div className="editor-footer-actions">
          {dirty && (
            <button type="button" className="btn ghost small" onClick={() => { setDraft(null); setNotice(null); }}>
              Discard
            </button>
          )}
          <button type="button" className="btn small" disabled={!dirty || busy || remoteChanged} onClick={save}>
            {busy ? "Saving…" : "Save new version"}
          </button>
        </div>
      </div>

      {historyOpen && (
        <VersionHistory
          roomId={props.roomId}
          sessionToken={props.sessionToken}
          documentId={doc.id}
          currentBody={doc.body}
          currentVersion={doc.version}
          format={doc.format}
          hasDraft={dirty}
          onRestored={(version) => {
            setDraft(null);
            setNotice({ kind: "success", text: `Restored as v${version}.` });
          }}
        />
      )}
    </div>
  );
}

function DocumentPreview(props: { body: string; format: "markdown" | "html" }) {
  if (!props.body) return <div className="plan-body empty">This document is empty.</div>;
  if (props.format === "html") {
    return (
      <pre className="plan-body html-source" aria-label="HTML source preview">
        {props.body}
      </pre>
    );
  }
  return (
    <div className="plan-body markdown-body">
      <Suspense fallback={<span className="hint">Rendering preview…</span>}>
        <MarkdownPreview body={props.body} />
      </Suspense>
    </div>
  );
}

function VersionHistory(props: {
  roomId: string;
  sessionToken: string;
  documentId: Id<"documents">;
  currentBody: string;
  currentVersion: number;
  format: "markdown" | "html";
  hasDraft: boolean;
  onRestored: (newVersion: number) => void;
}) {
  const history = useQuery(api.documents.history, {
    roomId: props.roomId,
    sessionToken: props.sessionToken,
    documentId: props.documentId,
  }) as VersionSummary[] | undefined;
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  return (
    <section className="version-history" aria-label="Document version history">
      <div className="version-list">
        <h4>Version history</h4>
        {history === undefined ? (
          <span className="hint">Loading history…</span>
        ) : (
          history.map((entry) => (
            <button type="button"
              key={entry.version}
              className={`version-row${selectedVersion === entry.version ? " active" : ""}`}
              onClick={() => setSelectedVersion(entry.version)}
            >
              <span><strong>v{entry.version}</strong> · {entry.authorKind === "agent" ? "agent" : "participant"}</span>
              <span className="hint">{entry.summary ?? "Saved"} · {formatDate(entry.createdAt)}</span>
            </button>
          ))
        )}
      </div>
      <div className="version-detail">
        {selectedVersion === null ? (
          <div className="version-placeholder">Choose a version to compare with the live document.</div>
        ) : (
          <VersionComparison
            roomId={props.roomId}
            sessionToken={props.sessionToken}
            documentId={props.documentId}
            version={selectedVersion}
            currentVersion={props.currentVersion}
            currentBody={props.currentBody}
            format={props.format}
            hasDraft={props.hasDraft}
            onRestored={props.onRestored}
          />
        )}
      </div>
    </section>
  );
}

function VersionComparison(props: {
  roomId: string;
  sessionToken: string;
  documentId: Id<"documents">;
  version: number;
  currentVersion: number;
  currentBody: string;
  format: "markdown" | "html";
  hasDraft: boolean;
  onRestored: (newVersion: number) => void;
}) {
  const restore = useMutation(api.documents.restore);
  const version = useQuery(api.documents.readVersion, {
    roomId: props.roomId,
    sessionToken: props.sessionToken,
    documentId: props.documentId,
    version: props.version,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (version === undefined) return <span className="hint">Loading version…</span>;

  async function restoreVersion() {
    setBusy(true);
    setError(null);
    try {
      const result = await restore({
        roomId: props.roomId,
        sessionToken: props.sessionToken,
        documentId: props.documentId,
        version: props.version,
        expectedVersion: props.currentVersion,
      });
      props.onRestored(result.version);
    } catch (restoreError) {
      setError(errorMessage(restoreError, "Could not restore this version."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="version-detail-head">
        <div>
          <strong>v{props.version} compared with live v{props.currentVersion}</strong>
          <div className="hint">Restoring creates a new version; it never deletes history.</div>
        </div>
        <button type="button"
          className="btn secondary small"
          disabled={busy || props.hasDraft || props.version === props.currentVersion}
          title={props.hasDraft ? "Save or discard your draft before restoring" : undefined}
          onClick={restoreVersion}
        >
          {busy ? "Restoring…" : "Restore as new version"}
        </button>
      </div>
      {error && <div className="editor-notice warn">{error}</div>}
      <div className="version-compare">
        <div>
          <span className="kicker muted">VERSION {props.version}</span>
          <DocumentPreview body={version.body} format={props.format} />
        </div>
        <div>
          <span className="kicker muted">LIVE VERSION {props.currentVersion}</span>
          <DocumentPreview body={props.currentBody} format={props.format} />
        </div>
      </div>
    </div>
  );
}

function NewDocumentDialog(props: {
  roomId: string;
  sessionToken: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const createDocument = useMutation(api.documents.create);
  const [path, setPath] = useState("plan.md");
  const [body, setBody] = useState("# Plan\n\n");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result = await createDocument({
        roomId: props.roomId,
        sessionToken: props.sessionToken,
        path,
        body,
        summary: "Created in the room",
      });
      props.onCreated(result.id);
    } catch (createError) {
      setError(errorMessage(createError, "Could not create the document."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <dialog open className="modal new-document-modal" aria-labelledby="new-document-title" onCancel={props.onClose} onClick={(event) => event.stopPropagation()}>
        <h3 id="new-document-title">New workspace document</h3>
        <p className="sub">Use a Markdown or HTML path. Everyone in the room, including the connected agent, can build on it.</p>
        <div className="field">
          <label htmlFor="document-path">Path</label>
          <input id="document-path" className="input" value={path} onChange={(event) => setPath(event.target.value)} placeholder="specs/api.md" />
        </div>
        <div className="field">
          <label htmlFor="document-body">Starting content</label>
          <textarea id="document-body" className="input new-document-body" value={body} onChange={(event) => setBody(event.target.value)} />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={props.onClose}>Cancel</button>
          <button type="button" className="btn" disabled={busy || !path.trim()} onClick={create}>
            {busy ? "Creating…" : "Create document"}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
