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
  cwdInput: string;
};

const MAX_OUTPUT_CHARS = 120_000;

export function createTerminalState(): TerminalViewState {
  return {
    sessions: [],
    activeTerminalId: null,
    outputBySessionId: {},
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

  return {
    ...state,
    sessions,
    activeTerminalId: state.activeTerminalId ?? session.id,
    outputBySessionId: {
      ...state.outputBySessionId,
      [session.id]: state.outputBySessionId[session.id] ?? "",
    },
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
  delete outputBySessionId[sessionId];

  const activeTerminalId =
    state.activeTerminalId === sessionId
      ? sessions[sessions.length - 1]?.id ?? null
      : state.activeTerminalId;

  return { ...state, sessions, activeTerminalId, outputBySessionId };
}

export function appendTerminalOutput(
  state: TerminalViewState,
  sessionId: string,
  chunk: string,
): TerminalViewState {
  if (!state.sessions.some((session) => session.id === sessionId)) {
    return state;
  }

  const output = `${state.outputBySessionId[sessionId] ?? ""}${chunk}`;

  return {
    ...state,
    outputBySessionId: {
      ...state.outputBySessionId,
      [sessionId]: output.slice(Math.max(0, output.length - MAX_OUTPUT_CHARS)),
    },
  };
}
