export type TerminalSessionInfo = {
  id: string;
  workspace_id: string;
  name: string;
  cwd: string;
  shell: string;
  running: boolean;
};

export type TerminalViewState = {
  sessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  pendingExitBySessionId: Record<string, boolean>;
  ignoredSessionIds: Record<string, boolean>;
  cwdInput: string;
};

export function createTerminalState(): TerminalViewState {
  return {
    sessions: [],
    activeTerminalId: null,
    pendingExitBySessionId: {},
    ignoredSessionIds: {},
    cwdInput: "",
  };
}

export function upsertTerminal(
  state: TerminalViewState,
  session: TerminalSessionInfo,
): TerminalViewState {
  const exists = state.sessions.some((item) => item.id === session.id);
  const pendingExit = state.pendingExitBySessionId[session.id] === true;
  const nextSession = pendingExit ? { ...session, running: false } : session;
  const sessions = exists
    ? state.sessions.map((item) =>
        item.id === session.id ? nextSession : item,
      )
    : [...state.sessions, nextSession];
  const pendingExitBySessionId = { ...state.pendingExitBySessionId };
  const ignoredSessionIds = { ...state.ignoredSessionIds };
  delete pendingExitBySessionId[session.id];
  delete ignoredSessionIds[session.id];

  return {
    ...state,
    sessions,
    activeTerminalId: state.activeTerminalId ?? session.id,
    pendingExitBySessionId,
    ignoredSessionIds,
  };
}

export function activateTerminal(
  state: TerminalViewState,
  sessionId: string,
): TerminalViewState {
  return state.sessions.some((session) => session.id === sessionId)
    ? { ...state, activeTerminalId: sessionId }
    : state;
}

export function closeTerminal(
  state: TerminalViewState,
  sessionId: string,
): TerminalViewState {
  const sessions = state.sessions.filter((session) => session.id !== sessionId);
  const pendingExitBySessionId = { ...state.pendingExitBySessionId };
  const ignoredSessionIds = { ...state.ignoredSessionIds, [sessionId]: true };
  delete pendingExitBySessionId[sessionId];

  const activeTerminalId =
    state.activeTerminalId === sessionId
      ? sessions[sessions.length - 1]?.id ?? null
      : state.activeTerminalId;

  return {
    ...state,
    sessions,
    activeTerminalId,
    pendingExitBySessionId,
    ignoredSessionIds,
  };
}

export function markTerminalExited(
  state: TerminalViewState,
  sessionId: string,
): TerminalViewState {
  if (!state.sessions.some((session) => session.id === sessionId)) {
    return state;
  }

  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === sessionId ? { ...session, running: false } : session,
    ),
  };
}

export function bufferTerminalExit(
  state: TerminalViewState,
  sessionId: string,
): TerminalViewState {
  if (state.ignoredSessionIds[sessionId]) {
    return state;
  }

  return {
    ...state,
    pendingExitBySessionId: {
      ...state.pendingExitBySessionId,
      [sessionId]: true,
    },
  };
}
