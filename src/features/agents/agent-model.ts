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

const MAX_AGENT_CONTEXT_CHARS = 120_000;

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
  if (exists) {
    return { ...state, sessions, loading: false, error: null };
  }

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

export function verificationSummary(session: AgentSession): string {
  let passed = 0;
  let failed = 0;

  for (const entry of session.transcript) {
    if (entry.kind !== "verification") {
      continue;
    }
    if (entry.status === "passed") {
      passed += 1;
    } else if (entry.status === "failed") {
      failed += 1;
    }
  }

  return `${passed} passed | ${failed} failed`;
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

function boundContext(content: string): { content: string; truncated: boolean } {
  if (content.length <= MAX_AGENT_CONTEXT_CHARS) {
    return { content, truncated: false };
  }

  return {
    content: content.slice(content.length - MAX_AGENT_CONTEXT_CHARS),
    truncated: true,
  };
}

function workspaceRelativePath(workspaceRoot: string, path: string): string {
  const normalize = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/u, "");
  const root = normalize(workspaceRoot);
  const normalized = normalize(path);
  const normalizedLower = normalized.toLowerCase();
  const rootLower = root.toLowerCase();
  const isWindowsRoot = /^[a-z]:/iu.test(root);

  const isDirectMatch = isWindowsRoot
    ? normalizedLower === rootLower
    : normalized === root;
  if (isDirectMatch) {
    return "";
  }

  const hasRootPrefix = isWindowsRoot
    ? normalizedLower.startsWith(`${rootLower}/`)
    : normalized.startsWith(`${root}/`);

  const safeBoundary = hasRootPrefix && normalized.charAt(root.length) === "/";

  return safeBoundary ? normalized.slice(root.length + 1) : normalized;
}

function shortHash(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let hash = 1469598103934665603n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash *= 1099511628211n;
    hash &= 0xffff_ffff_ffff_ffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export function agentContextFromFile(args: {
  workspaceRoot: string;
  path: string;
  content: string;
}): AgentContextItem {
  const relativePath = workspaceRelativePath(args.workspaceRoot, args.path);
  const bounded = boundContext(args.content);

  return {
    id: `file:${relativePath}`,
    kind: "file",
    label: relativePath,
    path: relativePath,
    content: bounded.content,
    truncated: bounded.truncated,
  };
}

export function agentContextFromDoc(args: {
  path: string;
  title: string;
  content: string;
}): AgentContextItem {
  const bounded = boundContext(args.content);

  return {
    id: `doc:${args.path}`,
    kind: "doc",
    label: args.title || args.path,
    path: args.path,
    content: bounded.content,
    truncated: bounded.truncated,
  };
}

export function agentContextFromDiff(args: {
  path: string;
  staged: boolean;
  raw: string;
}): AgentContextItem {
  const bounded = boundContext(args.raw);
  const stage = args.staged ? "staged" : "unstaged";

  return {
    id: `diff:${stage}:${args.path}`,
    kind: "diff",
    label: `${stage} diff: ${args.path}`,
    path: args.path,
    content: bounded.content,
    truncated: bounded.truncated,
  };
}

export function agentContextFromDiagnostic(args: {
  path: string;
  message: string;
  severity: string;
  line: number;
}): AgentContextItem {
  const bounded = boundContext(args.message);
  const label = `${args.severity}: ${args.path}:${args.line}`;
  return {
    id: `diagnostic:${args.path}:${args.line}:${args.severity}:${shortHash(args.message)}`,
    kind: "diagnostic",
    label,
    path: args.path,
    content: bounded.content,
    truncated: bounded.truncated,
  };
}

export function agentContextFromTerminal(args: {
  sessionId: string;
  name: string;
  output: string;
}): AgentContextItem {
  const bounded = boundContext(args.output);
  return {
    id: `terminal:${args.sessionId}`,
    kind: "terminal",
    label: args.name,
    path: null,
    content: bounded.content,
    truncated: bounded.truncated,
  };
}
