import {
  Bot,
  Check,
  Download,
  FileText,
  Play,
  ShieldCheck,
  X,
} from "lucide-react";

import {
  activeAgentSession,
  agentContextSummary,
  approvalEntries,
  type AgentContextItem,
  type AgentMode,
  type AgentTranscriptEntry,
  type AgentViewState,
} from "./agent-model";

type AgentPanelProps = {
  state: AgentViewState;
  availableContext: AgentContextItem[];
  onModeChange: (mode: AgentMode) => void;
  onPromptChange: (prompt: string) => void;
  onToggleContext: (id: string, selected: boolean) => void;
  onStartSession: (prompt: string) => void;
  onSelectSession: (sessionId: string) => void;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
  onExport: () => void;
};

const MODES: AgentMode[] = ["plan", "edit", "verify", "review", "report"];

function ContextRow({
  item,
  selected,
  onToggle,
}: {
  item: AgentContextItem;
  selected: boolean;
  onToggle: (selected: boolean) => void;
}) {
  return (
    <label className="agent-context-row">
      <input
        type="checkbox"
        checked={selected}
        aria-label={`Use ${item.label} context`}
        onChange={(event) => onToggle(event.currentTarget.checked)}
      />
      <FileText aria-hidden="true" />
      <span className="agent-context-main">
        <span className="agent-context-title">{item.label}</span>
        <span className="agent-context-meta mono">
          {item.kind}
          {item.truncated ? " • truncated" : ""}
        </span>
      </span>
    </label>
  );
}

function TranscriptRow({
  entry,
  onApprove,
  onReject,
}: {
  entry: AgentTranscriptEntry;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const isApproval = entry.approval_status !== null;
  const isPending = entry.approval_status === "pending";
  const verificationCommand =
    entry.kind === "verification" &&
    typeof entry.metadata.command === "string"
      ? entry.metadata.command
      : "";

  return (
    <div className={`agent-transcript-row ${entry.kind}`}>
      <div className="agent-transcript-head">
        <span className="agent-transcript-title">{entry.title}</span>
        {entry.status ? (
          <span className={`badge2 agent-status ${entry.status}`}>
            {entry.status}
          </span>
        ) : null}
      </div>
      {verificationCommand ? (
        <div className="agent-transcript-meta mono">
          command: {verificationCommand}
        </div>
      ) : null}
      <pre className="agent-transcript-content">{entry.content}</pre>
      {isApproval ? (
        <div className="agent-approval-actions">
          <button
            type="button"
            className="btn sm primary"
            aria-label={`Approve ${entry.title}`}
            onClick={() => onApprove(entry.id)}
            disabled={!isPending}
          >
            <Check aria-hidden="true" />
            Approve
          </button>
          <button
            type="button"
            className="btn sm ghost"
            aria-label={`Reject ${entry.title}`}
            onClick={() => onReject(entry.id)}
            disabled={!isPending}
          >
            <X aria-hidden="true" />
            Reject
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AgentPanel({
  state,
  availableContext,
  onModeChange,
  onPromptChange,
  onToggleContext,
  onStartSession,
  onSelectSession,
  onApprove,
  onReject,
  onExport,
}: AgentPanelProps) {
  const activeSession = activeAgentSession(state);
  const pendingApprovals = activeSession ? approvalEntries(activeSession) : [];
  const canStartSession = state.promptDraft.trim().length > 0;

  return (
    <div className="panel-body agent-panel">
      <div className="agent-composer">
        <div className="agent-modes" aria-label="Agent mode">
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`btn sm ${state.mode === mode ? "primary" : "ghost"}`}
              onClick={() => onModeChange(mode)}
            >
              {mode}
            </button>
          ))}
        </div>

        <textarea
          aria-label="Agent prompt"
          className="input2 agent-prompt"
          value={state.promptDraft}
          onChange={(event) => onPromptChange(event.currentTarget.value)}
        />

        <button
          type="button"
          className="btn primary agent-start"
          disabled={!canStartSession}
          onClick={() => {
            if (canStartSession) {
              onStartSession(state.promptDraft);
            }
          }}
        >
          <Play aria-hidden="true" />
          Start session
        </button>
      </div>

      <div className="section-label">
        <span>Context</span>
        <span className="meta">{availableContext.length}</span>
      </div>
      <div className="agent-context-list">
        {availableContext.length > 0 ? (
          availableContext.map((item) => (
            <ContextRow
              key={item.id}
              item={item}
              selected={state.selectedContextIds[item.id] === true}
              onToggle={(selected) => onToggleContext(item.id, selected)}
            />
          ))
        ) : (
          <div className="panel-empty">No context available</div>
        )}
      </div>

      <div className="section-label">
        <span>Sessions</span>
        <span className="meta">{state.sessions.length}</span>
      </div>
      <div className="agent-session-list">
        {state.sessions.length > 0 ? (
          state.sessions.map((session) => (
            <button
              type="button"
              key={session.id}
              className={`agent-session-row row${state.activeSessionId === session.id ? " active" : ""}`}
              onClick={() => onSelectSession(session.id)}
            >
              <Bot aria-hidden="true" />
              <span className="agent-session-main">
                <span className="agent-session-mode">{session.mode}</span>
                <span className="agent-session-summary mono">
                  {agentContextSummary(session)}
                </span>
              </span>
            </button>
          ))
        ) : (
          <div className="panel-empty">No agent sessions</div>
        )}
      </div>

      {activeSession ? (
        <div className="agent-session-detail">
          <div className="agent-session-toolbar">
            <span className="badge2">
              <ShieldCheck aria-hidden="true" />
              {pendingApprovals.length} approvals
            </span>
            <button
              type="button"
              className="iconbtn"
              title="Export prompt"
              aria-label="Export prompt"
              onClick={onExport}
            >
              <Download aria-hidden="true" />
            </button>
          </div>

          {activeSession.transcript.length > 0 ? (
            activeSession.transcript.map((entry) => (
              <TranscriptRow
                key={entry.id}
                entry={entry}
                onApprove={onApprove}
                onReject={onReject}
              />
            ))
          ) : (
            <div className="panel-empty">No transcript entries</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
