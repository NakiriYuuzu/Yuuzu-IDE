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
  outputBySessionId: Record<string, string>;
  pendingOutputBySessionId: Record<string, string>;
  cwdInput: string;
};

const MAX_OUTPUT_CHARS = 120_000;

function appendBoundedOutput(previous: string, chunk: string): string {
  const output = `${previous}${chunk}`;
  return output.slice(Math.max(0, output.length - MAX_OUTPUT_CHARS));
}

export function createTerminalState(): TerminalViewState {
  return {
    sessions: [],
    activeTerminalId: null,
    outputBySessionId: {},
    pendingOutputBySessionId: {},
    cwdInput: "",
  };
}

export function upsertTerminal(
  state: TerminalViewState,
  session: TerminalSessionInfo,
): TerminalViewState {
  const exists = state.sessions.some((item) => item.id === session.id);
  const sessions = exists
    ? state.sessions.map((item) => (item.id === session.id ? session : item))
    : [...state.sessions, session];
  const pendingOutput = state.pendingOutputBySessionId[session.id] ?? "";
  const pendingOutputBySessionId = { ...state.pendingOutputBySessionId };
  delete pendingOutputBySessionId[session.id];

  return {
    ...state,
    sessions,
    activeTerminalId: state.activeTerminalId ?? session.id,
    outputBySessionId: {
      ...state.outputBySessionId,
      [session.id]: appendBoundedOutput(
        state.outputBySessionId[session.id] ?? "",
        pendingOutput,
      ),
    },
    pendingOutputBySessionId,
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
  const outputBySessionId = { ...state.outputBySessionId };
  const pendingOutputBySessionId = { ...state.pendingOutputBySessionId };
  delete outputBySessionId[sessionId];
  delete pendingOutputBySessionId[sessionId];

  const activeTerminalId =
    state.activeTerminalId === sessionId
      ? sessions[sessions.length - 1]?.id ?? null
      : state.activeTerminalId;

  return {
    ...state,
    sessions,
    activeTerminalId,
    outputBySessionId,
    pendingOutputBySessionId,
  };
}

export function appendTerminalOutput(
  state: TerminalViewState,
  sessionId: string,
  chunk: string,
): TerminalViewState {
  if (!state.sessions.some((session) => session.id === sessionId)) {
    return state;
  }

  return {
    ...state,
    outputBySessionId: {
      ...state.outputBySessionId,
      [sessionId]: appendBoundedOutput(
        state.outputBySessionId[sessionId] ?? "",
        chunk,
      ),
    },
  };
}

export function bufferTerminalOutput(
  state: TerminalViewState,
  sessionId: string,
  chunk: string,
): TerminalViewState {
  return {
    ...state,
    pendingOutputBySessionId: {
      ...state.pendingOutputBySessionId,
      [sessionId]: appendBoundedOutput(
        state.pendingOutputBySessionId[sessionId] ?? "",
        chunk,
      ),
    },
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
