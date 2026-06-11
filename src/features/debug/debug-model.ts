export const MAX_DEBUG_CONSOLE = 120_000;

export type DebugAdapterKind = "Lldb" | "Python" | "Custom" | string;
export type DebugRequestKind = "Launch" | "Attach" | string;
export type DebugSessionStatus =
  | "Starting"
  | "Running"
  | "Stopped"
  | "Exited"
  | "Disconnected"
  | "Failed"
  | string;

export type DebugEnvVar = {
  key: string;
  value: string;
};

export type DebugAttachConfig = {
  pid: number | null;
  host: string | null;
  port: number | null;
};

export type DebugLaunchConfigInput = {
  id?: string | null;
  workspace_root: string;
  name: string;
  adapter: DebugAdapterKind;
  request: DebugRequestKind;
  program: string;
  cwd: string;
  args: string[];
  env: DebugEnvVar[];
  stop_on_entry: boolean;
  attach: DebugAttachConfig | null;
};

export type DebugLaunchConfig = {
  id: string;
  workspace_root: string;
  name: string;
  adapter: DebugAdapterKind;
  request: DebugRequestKind;
  program: string;
  cwd: string;
  args: string[];
  env: DebugEnvVar[];
  stop_on_entry: boolean;
  attach: DebugAttachConfig | null;
  created_ms: number;
  updated_ms: number;
};

export type DebugSourceBreakpointInput = {
  line: number;
  condition: string | null;
  log_message: string | null;
};

export type DebugSourceBreakpoint = DebugSourceBreakpointInput & {
  verified: boolean;
};

export type DebugSessionInfo = {
  id: string;
  workspace_id: string;
  workspace_root: string;
  config_id: string;
  name: string;
  adapter: DebugAdapterKind;
  status: DebugSessionStatus;
  active_thread_id: number | null;
  stopped_reason: string | null;
  last_error: string | null;
  sequence: number;
};

export type DebugSessionEvent = {
  session_id: string;
  workspace_id: string;
  workspace_root: string;
  sequence: number;
  status: DebugSessionStatus;
  reason: string | null;
  thread_id?: number | null;
  active_thread_id?: number | null;
  config_id?: string;
  name?: string;
  adapter?: DebugAdapterKind;
  error?: string | null;
};

export type DebugConsoleEvent = {
  session_id: string;
  workspace_id: string;
  workspace_root: string;
  sequence: number;
  chunk: string;
};

export type DebugStackFrame = {
  id: number;
  name: string;
  source_path: string;
  line: number;
  column: number;
};

export type DebugScope = {
  name: string;
  variables_reference: number;
  expensive: boolean;
};

export type DebugVariable = {
  name: string;
  value: string;
  type: string | null;
  variables_reference: number;
};

export type DebugWatchExpression = {
  expression: string;
  value: string | null;
  type: string | null;
  variables_reference: number | null;
  error: string | null;
};

export type DebugViewState = {
  launchConfigs: DebugLaunchConfig[];
  activeConfigId: string | null;
  sessions: DebugSessionInfo[];
  activeSessionId: string | null;
  mode: "sessions" | "breakpoints" | "variables" | "console";
  breakpointsByPath: Record<string, DebugSourceBreakpoint[]>;
  stackBySessionId: Record<string, DebugStackFrame[]>;
  scopesByFrameId: Record<string, DebugScope[]>;
  variablesByReference: Record<string, DebugVariable[]>;
  watches: DebugWatchExpression[];
  consoleBySessionId: Record<string, string>;
  sessionSequenceById: Record<string, number>;
  consoleSequenceById: Record<string, number>;
  ignoredSessionIds: Record<string, true>;
  loading: boolean;
  error: string | null;
};

export function createDebugState(): DebugViewState {
  return {
    launchConfigs: [],
    activeConfigId: null,
    sessions: [],
    activeSessionId: null,
    mode: "sessions",
    breakpointsByPath: {},
    stackBySessionId: {},
    scopesByFrameId: {},
    variablesByReference: {},
    watches: [],
    consoleBySessionId: {},
    sessionSequenceById: {},
    consoleSequenceById: {},
    ignoredSessionIds: {},
    loading: false,
    error: null,
  };
}

export function replaceDebugLaunchConfigs(
  state: DebugViewState,
  launchConfigs: DebugLaunchConfig[],
): DebugViewState {
  return {
    ...state,
    launchConfigs,
    activeConfigId: chooseActiveConfigId(state.activeConfigId, launchConfigs),
    error: null,
  };
}

export function selectDebugConfig(
  state: DebugViewState,
  configId: string | null,
): DebugViewState {
  if (configId === null) {
    return { ...state, activeConfigId: null };
  }
  if (!state.launchConfigs.some((config) => config.id === configId)) {
    return state;
  }

  return {
    ...state,
    activeConfigId: configId,
    error: null,
  };
}

export function setDebugMode(
  state: DebugViewState,
  mode: DebugViewState["mode"],
): DebugViewState {
  return {
    ...state,
    mode,
  };
}

export function toggleDebugBreakpoint(
  state: DebugViewState,
  sourcePath: string,
  line: number,
): DebugViewState {
  const current = state.breakpointsByPath[sourcePath] ?? [];
  const exists = current.some((breakpoint) => breakpoint.line === line);
  const breakpoints = exists
    ? current.filter((breakpoint) => breakpoint.line !== line)
    : sortBreakpoints([
        ...current,
        {
          line,
          condition: null,
          log_message: null,
          verified: false,
        },
      ]);

  return {
    ...state,
    breakpointsByPath: {
      ...state.breakpointsByPath,
      [sourcePath]: breakpoints,
    },
  };
}

export function setDebugBreakpoints(
  state: DebugViewState,
  sourcePath: string,
  breakpoints: DebugSourceBreakpoint[],
): DebugViewState {
  return {
    ...state,
    breakpointsByPath: {
      ...state.breakpointsByPath,
      [sourcePath]: sortBreakpoints(breakpoints.map((breakpoint) => ({ ...breakpoint }))),
    },
  };
}

export function markDebugSessionEvent(
  state: DebugViewState,
  event: DebugSessionEvent,
): DebugViewState {
  if (state.ignoredSessionIds[event.session_id]) {
    return state;
  }

  const previousSequence = state.sessionSequenceById[event.session_id];
  if (previousSequence !== undefined && event.sequence < previousSequence) {
    return state;
  }

  const existing = state.sessions.find((session) => session.id === event.session_id);
  const nextSession: DebugSessionInfo = {
    id: event.session_id,
    workspace_id: event.workspace_id,
    workspace_root: event.workspace_root,
    config_id: event.config_id ?? existing?.config_id ?? "",
    name: event.name ?? existing?.name ?? event.session_id,
    adapter: event.adapter ?? existing?.adapter ?? "Custom",
    status: event.status,
    active_thread_id: resolveEventThreadId(event, existing),
    stopped_reason:
      event.reason === undefined ? (existing?.stopped_reason ?? null) : event.reason,
    last_error: event.error === undefined ? (existing?.last_error ?? null) : event.error,
    sequence: event.sequence,
  };
  const sessions = existing
    ? state.sessions.map((session) =>
        session.id === nextSession.id ? nextSession : session,
      )
    : [...state.sessions, nextSession];

  return {
    ...state,
    sessions,
    activeSessionId: chooseNextActiveSessionId(
      state.activeSessionId,
      nextSession,
      sessions,
    ),
    sessionSequenceById: {
      ...state.sessionSequenceById,
      [event.session_id]: event.sequence,
    },
    error: null,
  };
}

export function replaceDebugSessions(
  state: DebugViewState,
  sessions: DebugSessionInfo[],
): DebugViewState {
  const sessionSequenceById = sessions.reduce<Record<string, number>>(
    (sequences, session) => ({
      ...sequences,
      [session.id]: Math.max(
        sequences[session.id] ?? Number.NEGATIVE_INFINITY,
        session.sequence,
      ),
    }),
    { ...state.sessionSequenceById },
  );

  return {
    ...state,
    sessions,
    activeSessionId: chooseActiveSessionId(state.activeSessionId, sessions),
    sessionSequenceById,
    error: null,
  };
}

export function setDebugStack(
  state: DebugViewState,
  sessionId: string,
  frames: DebugStackFrame[],
): DebugViewState {
  return {
    ...state,
    activeSessionId: state.activeSessionId ?? sessionId,
    stackBySessionId: {
      ...state.stackBySessionId,
      [sessionId]: frames.map((frame) => ({ ...frame })),
    },
  };
}

export function setDebugScopes(
  state: DebugViewState,
  sessionId: string,
  frameId: number,
  scopes: DebugScope[],
): DebugViewState {
  return {
    ...state,
    scopesByFrameId: {
      ...state.scopesByFrameId,
      [`${sessionId}:${frameId}`]: scopes.map((scope) => ({ ...scope })),
    },
  };
}

export function storeDebugVariables(
  state: DebugViewState,
  sessionId: string,
  variablesReference: number,
  variables: DebugVariable[],
): DebugViewState {
  return {
    ...state,
    variablesByReference: {
      ...state.variablesByReference,
      [`${sessionId}:${variablesReference}`]: variables.map((variable) => ({
        ...variable,
      })),
    },
  };
}

export function addDebugWatch(
  state: DebugViewState,
  expression: string,
): DebugViewState {
  const normalized = expression.trim();
  if (
    normalized.length === 0 ||
    state.watches.some((watch) => watch.expression === normalized)
  ) {
    return state;
  }

  return {
    ...state,
    watches: [
      ...state.watches,
      {
        expression: normalized,
        value: null,
        type: null,
        variables_reference: null,
        error: null,
      },
    ],
  };
}

export function removeDebugWatch(
  state: DebugViewState,
  expression: string,
): DebugViewState {
  return {
    ...state,
    watches: state.watches.filter((watch) => watch.expression !== expression.trim()),
  };
}

export function updateDebugWatchResult(
  state: DebugViewState,
  expression: string,
  result: DebugVariable | string,
): DebugViewState {
  const normalized = expression.trim();
  if (normalized.length === 0) {
    return state;
  }

  const updatedWatch = toDebugWatchResult(normalized, result);
  const watches = state.watches.some((watch) => watch.expression === normalized)
    ? state.watches.map((watch) =>
        watch.expression === normalized ? updatedWatch : watch,
      )
    : [...state.watches, updatedWatch];

  return {
    ...state,
    watches,
  };
}

export function appendDebugConsole(
  state: DebugViewState,
  sessionId: string,
  chunk: string,
): DebugViewState;
export function appendDebugConsole(
  state: DebugViewState,
  event: DebugConsoleEvent,
): DebugViewState;
export function appendDebugConsole(
  state: DebugViewState,
  sessionOrEvent: string | DebugConsoleEvent,
  chunk?: string,
): DebugViewState {
  const event =
    typeof sessionOrEvent === "string"
      ? { session_id: sessionOrEvent, chunk }
      : sessionOrEvent;
  if (!event.chunk) {
    return state;
  }

  const sequence = "sequence" in event ? event.sequence : undefined;
  const previousSequence = state.consoleSequenceById[event.session_id];
  if (
    sequence !== undefined &&
    previousSequence !== undefined &&
    sequence < previousSequence
  ) {
    return state;
  }

  return {
    ...state,
    consoleBySessionId: {
      ...state.consoleBySessionId,
      [event.session_id]: appendBoundedOutput(
        state.consoleBySessionId[event.session_id] ?? "",
        event.chunk,
      ),
    },
    consoleSequenceById:
      sequence === undefined
        ? state.consoleSequenceById
        : {
            ...state.consoleSequenceById,
            [event.session_id]: sequence,
          },
  };
}

export function setDebugError(
  state: DebugViewState,
  error: string | null,
): DebugViewState {
  return {
    ...state,
    loading: false,
    error,
  };
}

export function beginDebugRequest(state: DebugViewState): DebugViewState {
  return {
    ...state,
    loading: true,
    error: null,
  };
}

function chooseActiveConfigId(
  requestedConfigId: string | null,
  launchConfigs: DebugLaunchConfig[],
): string | null {
  if (
    requestedConfigId &&
    launchConfigs.some((config) => config.id === requestedConfigId)
  ) {
    return requestedConfigId;
  }

  return launchConfigs[0]?.id ?? null;
}

function chooseActiveSessionId(
  requestedSessionId: string | null,
  sessions: DebugSessionInfo[],
): string | null {
  if (
    requestedSessionId &&
    sessions.some((session) => session.id === requestedSessionId)
  ) {
    return requestedSessionId;
  }

  return sessions[0]?.id ?? null;
}

function chooseNextActiveSessionId(
  currentActiveSessionId: string | null,
  changedSession: DebugSessionInfo,
  sessions: DebugSessionInfo[],
): string | null {
  if (!isTerminalDebugStatus(changedSession.status)) {
    return changedSession.id;
  }

  if (currentActiveSessionId !== changedSession.id) {
    return chooseActiveSessionId(currentActiveSessionId, sessions);
  }

  return (
    sessions.find((session) => !isTerminalDebugStatus(session.status))?.id ?? null
  );
}

function isTerminalDebugStatus(status: DebugSessionStatus): boolean {
  return status === "Disconnected" || status === "Exited" || status === "Failed";
}

function resolveEventThreadId(
  event: DebugSessionEvent,
  existing: DebugSessionInfo | undefined,
): number | null {
  if (Object.prototype.hasOwnProperty.call(event, "active_thread_id")) {
    return event.active_thread_id ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(event, "thread_id")) {
    return event.thread_id ?? null;
  }

  return existing?.active_thread_id ?? null;
}

function sortBreakpoints(
  breakpoints: DebugSourceBreakpoint[],
): DebugSourceBreakpoint[] {
  return [...breakpoints].sort((left, right) => left.line - right.line);
}

function toDebugWatchResult(
  expression: string,
  result: DebugVariable | string,
): DebugWatchExpression {
  if (typeof result === "string") {
    return {
      expression,
      value: null,
      type: null,
      variables_reference: null,
      error: result,
    };
  }

  return {
    expression,
    value: result.value,
    type: result.type,
    variables_reference: result.variables_reference,
    error: null,
  };
}

function appendBoundedOutput(previous: string, chunk: string): string {
  const output = `${previous}${chunk}`;
  return output.slice(Math.max(0, output.length - MAX_DEBUG_CONSOLE));
}
