export type AgentMode = "plan" | "edit" | "verify" | "review" | "report";
export type AgentContextKind = "file" | "doc" | "diff" | "diagnostic" | "terminal";
export type AgentTranscriptKind =
  | "user_prompt"
  | "assistant_message"
  | "tool_call"
  | "command_output"
  | "diff"
  | "verification"
  | "approval_request"
  | "report";
export type AgentEvidenceStatus = "pending" | "passed" | "failed" | "skipped";
export type AgentApprovalStatus = "pending" | "approved" | "rejected";

export type AgentContextItem = {
  id: string;
  kind: AgentContextKind;
  label: string;
  path: string | null;
  content: string;
  truncated: boolean;
};

export type AgentTranscriptEntry = {
  id: string;
  session_id: string;
  kind: AgentTranscriptKind;
  title: string;
  content: string;
  status: AgentEvidenceStatus | null;
  approval_status: AgentApprovalStatus | null;
  metadata: Record<string, unknown>;
  created_ms: number;
};

export type AgentTranscriptInput = {
  kind: AgentTranscriptKind;
  title: string;
  content: string;
  status: AgentEvidenceStatus | null;
  metadata: Record<string, unknown>;
};

export type AgentSession = {
  id: string;
  workspace_root: string;
  mode: AgentMode;
  prompt: string;
  context_items: AgentContextItem[];
  transcript: AgentTranscriptEntry[];
  created_ms: number;
  updated_ms: number;
};

export type AgentPromptExport = {
  session_id: string;
  filename: string;
  content: string;
};

export type AgentViewState = {
  sessions: AgentSession[];
  activeSessionId: string | null;
  mode: AgentMode;
  promptDraft: string;
  selectedContextIds: Record<string, true>;
  loading: boolean;
  error: string | null;
};

export function createAgentState(): AgentViewState {
  return {
    sessions: [],
    activeSessionId: null,
    mode: "plan",
    promptDraft: "",
    selectedContextIds: {},
    loading: false,
    error: null,
  };
}

export function replaceAgentSessions(
  state: AgentViewState,
  sessions: AgentSession[],
): AgentViewState {
  const sorted = [...sessions].sort((left, right) => right.updated_ms - left.updated_ms);
  const activeSessionId =
    sorted.find((session) => session.id === state.activeSessionId)?.id ??
    sorted[0]?.id ??
    null;
  return { ...state, sessions: sorted, activeSessionId, loading: false, error: null };
}

export function storeAgentSession(
  state: AgentViewState,
  session: AgentSession,
): AgentViewState {
  const exists = state.sessions.some((item) => item.id === session.id);
  const sessions = exists
    ? state.sessions.map((item) => (item.id === session.id ? session : item))
    : [session, ...state.sessions];
  return {
    ...state,
    sessions,
    activeSessionId: session.id,
    promptDraft: "",
    selectedContextIds: {},
    loading: false,
    error: null,
  };
}

export function activeAgentSession(state: AgentViewState): AgentSession | null {
  return state.sessions.find((session) => session.id === state.activeSessionId) ?? null;
}

export function selectAgentSession(
  state: AgentViewState,
  sessionId: string,
): AgentViewState {
  return state.sessions.some((session) => session.id === sessionId)
    ? { ...state, activeSessionId: sessionId }
    : state;
}

export function setAgentPromptDraft(
  state: AgentViewState,
  promptDraft: string,
): AgentViewState {
  return { ...state, promptDraft };
}

export function setAgentMode(
  state: AgentViewState,
  mode: AgentMode,
): AgentViewState {
  return { ...state, mode };
}

export function toggleAgentContext(
  state: AgentViewState,
  contextId: string,
  selected: boolean,
): AgentViewState {
  const selectedContextIds = { ...state.selectedContextIds };
  if (selected) {
    selectedContextIds[contextId] = true;
  } else {
    delete selectedContextIds[contextId];
  }
  return { ...state, selectedContextIds };
}

export function selectedContextItems(
  state: AgentViewState,
  available: AgentContextItem[],
): AgentContextItem[] {
  return available.filter((item) => state.selectedContextIds[item.id]);
}

export function agentContextSummary(session: AgentSession): string {
  const counts = new Map<AgentContextKind, number>();
  for (const item of session.context_items) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([kind, count]) => `${count} ${kind}${count === 1 ? "" : "s"}`)
    .join(" | ");
}

export function transcriptByKind(
  session: AgentSession,
  kind: AgentTranscriptKind,
): AgentTranscriptEntry[] {
  return session.transcript.filter((entry) => entry.kind === kind);
}

export function approvalEntries(session: AgentSession): AgentTranscriptEntry[] {
  return session.transcript.filter((entry) => entry.approval_status !== null);
}

export function agentBadgeCount(state: AgentViewState): string | null {
  const pending = state.sessions.reduce(
    (count, session) =>
      count +
      approvalEntries(session).filter((entry) => entry.approval_status === "pending").length,
    0,
  );
  return pending > 0 ? String(pending) : null;
}
