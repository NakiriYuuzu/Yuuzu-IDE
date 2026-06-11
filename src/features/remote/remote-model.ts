export const MAX_REMOTE_OUTPUT = 120_000;

export type RemoteAuthSource =
  | {
      Password: {
        secret_id: string;
      };
    }
  | {
      Key: {
        key_path: string;
        passphrase_secret_id: string | null;
      };
    }
  | "Agent";

export type RemoteAuthKind = "Password" | "Key" | "Agent";

export type RemoteHostProfile = {
  id: string;
  workspace_root: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth: RemoteAuthSource;
  default_remote_path: string;
  keepalive_seconds: number;
  connect_timeout_seconds: number;
  created_ms: number;
  updated_ms: number;
};

export type RemoteHostProfileInput = {
  id?: string;
  workspace_root: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_kind: RemoteAuthKind;
  password?: string;
  key_path?: string;
  key_passphrase?: string;
  default_remote_path: string;
  keepalive_seconds: number;
  connect_timeout_seconds: number;
};

export type RemoteConnectionStatus =
  | "Disconnected"
  | "Connecting"
  | "Connected"
  | "Failed";

export type RemoteConnectionSnapshot = {
  host_id: string;
  status: RemoteConnectionStatus;
  message: string | null;
  checked_ms: number;
};

export type SshTerminalSessionInfo = {
  id: string;
  host_id: string;
  workspace_id: string;
  name: string;
  running: boolean;
};

export type RemoteFileKind = "File" | "Directory" | "Symlink";

export type RemoteFileEntry = {
  host_id: string;
  path: string;
  name: string;
  kind: RemoteFileKind;
  size: number | null;
  modified_ms: number | null;
  link_target: string | null;
};

export type RemoteCommandResult = {
  host_id: string;
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
};

export type RemoteTransferResult = {
  remote_path: string;
  local_path: string;
  bytes: number;
};

export type RemoteViewState = {
  hosts: RemoteHostProfile[];
  activeHostId: string | null;
  mode: "ssh" | "sftp" | "commands";
  connectionByHostId: Record<string, RemoteConnectionSnapshot>;
  sshSessions: SshTerminalSessionInfo[];
  activeSshSessionId: string | null;
  sshOutputBySessionId: Record<string, string>;
  pendingSshOutputBySessionId: Record<string, string>;
  pendingSshExitBySessionId: Record<string, true>;
  ignoredSshSessionIds: Record<string, true>;
  sftpPathByHostId: Record<string, string>;
  sftpEntriesByHostPath: Record<string, RemoteFileEntry[]>;
  commandDraft: string;
  commandResults: RemoteCommandResult[];
  commandOutputByRunId: Record<string, string>;
  transfer: RemoteTransferResult | null;
  loading: boolean;
  error: string | null;
};

export function createRemoteState(): RemoteViewState {
  return {
    hosts: [],
    activeHostId: null,
    mode: "ssh",
    connectionByHostId: {},
    sshSessions: [],
    activeSshSessionId: null,
    sshOutputBySessionId: {},
    pendingSshOutputBySessionId: {},
    pendingSshExitBySessionId: {},
    ignoredSshSessionIds: {},
    sftpPathByHostId: {},
    sftpEntriesByHostPath: {},
    commandDraft: "",
    commandResults: [],
    commandOutputByRunId: {},
    transfer: null,
    loading: false,
    error: null,
  };
}

export function replaceRemoteHosts(
  state: RemoteViewState,
  hosts: RemoteHostProfile[],
): RemoteViewState {
  const activeHostId = chooseActiveHostId(state.activeHostId, hosts);

  return {
    ...state,
    hosts,
    activeHostId,
    error: null,
  };
}

export function selectRemoteHost(
  state: RemoteViewState,
  hostId: string,
): RemoteViewState {
  if (!state.hosts.some((host) => host.id === hostId)) {
    return state;
  }

  return {
    ...state,
    activeHostId: hostId,
    error: null,
  };
}

export function setRemoteMode(
  state: RemoteViewState,
  mode: RemoteViewState["mode"],
): RemoteViewState {
  return {
    ...state,
    mode,
  };
}

export function markRemoteConnection(
  state: RemoteViewState,
  snapshot: RemoteConnectionSnapshot,
): RemoteViewState {
  return {
    ...state,
    connectionByHostId: {
      ...state.connectionByHostId,
      [snapshot.host_id]: snapshot,
    },
  };
}

export function upsertSshTerminal(
  state: RemoteViewState,
  session: SshTerminalSessionInfo,
): RemoteViewState {
  const pendingExit = state.pendingSshExitBySessionId[session.id] === true;
  const nextSession = pendingExit ? { ...session, running: false } : session;
  const sessions = state.sshSessions.some((item) => item.id === session.id)
    ? state.sshSessions.map((item) =>
        item.id === session.id ? nextSession : item,
      )
    : [...state.sshSessions, nextSession];
  const pendingOutput = state.pendingSshOutputBySessionId[session.id] ?? "";

  return {
    ...state,
    sshSessions: sessions,
    activeSshSessionId: session.id,
    sshOutputBySessionId: {
      ...state.sshOutputBySessionId,
      [session.id]: appendBoundedOutput(
        state.sshOutputBySessionId[session.id] ?? "",
        pendingOutput,
      ),
    },
    pendingSshOutputBySessionId: withoutKey(
      state.pendingSshOutputBySessionId,
      session.id,
    ),
    pendingSshExitBySessionId: withoutKey(
      state.pendingSshExitBySessionId,
      session.id,
    ),
    ignoredSshSessionIds: withoutKey(state.ignoredSshSessionIds, session.id),
  };
}

export function appendSshTerminalOutput(
  state: RemoteViewState,
  sessionId: string,
  chunk: string,
): RemoteViewState {
  if (!state.sshSessions.some((session) => session.id === sessionId)) {
    return state;
  }

  return {
    ...state,
    sshOutputBySessionId: {
      ...state.sshOutputBySessionId,
      [sessionId]: appendBoundedOutput(
        state.sshOutputBySessionId[sessionId] ?? "",
        chunk,
      ),
    },
  };
}

export function bufferSshTerminalOutput(
  state: RemoteViewState,
  sessionId: string,
  chunk: string,
): RemoteViewState {
  if (state.ignoredSshSessionIds[sessionId]) {
    return state;
  }

  if (state.sshSessions.some((session) => session.id === sessionId)) {
    return appendSshTerminalOutput(state, sessionId, chunk);
  }

  return {
    ...state,
    pendingSshOutputBySessionId: {
      ...state.pendingSshOutputBySessionId,
      [sessionId]: appendBoundedOutput(
        state.pendingSshOutputBySessionId[sessionId] ?? "",
        chunk,
      ),
    },
  };
}

export function markSshTerminalExited(
  state: RemoteViewState,
  sessionId: string,
): RemoteViewState {
  if (!state.sshSessions.some((session) => session.id === sessionId)) {
    return state;
  }

  return {
    ...state,
    sshSessions: state.sshSessions.map((session) =>
      session.id === sessionId ? { ...session, running: false } : session,
    ),
  };
}

export function bufferSshTerminalExit(
  state: RemoteViewState,
  sessionId: string,
): RemoteViewState {
  if (state.ignoredSshSessionIds[sessionId]) {
    return state;
  }

  if (state.sshSessions.some((session) => session.id === sessionId)) {
    return markSshTerminalExited(state, sessionId);
  }

  return {
    ...state,
    pendingSshExitBySessionId: {
      ...state.pendingSshExitBySessionId,
      [sessionId]: true,
    },
  };
}

export function closeSshTerminal(
  state: RemoteViewState,
  sessionId: string,
): RemoteViewState {
  const sshSessions = state.sshSessions.filter(
    (session) => session.id !== sessionId,
  );

  return {
    ...state,
    sshSessions,
    activeSshSessionId:
      state.activeSshSessionId === sessionId
        ? (sshSessions[sshSessions.length - 1]?.id ?? null)
        : state.activeSshSessionId,
    sshOutputBySessionId: withoutKey(state.sshOutputBySessionId, sessionId),
    pendingSshOutputBySessionId: withoutKey(
      state.pendingSshOutputBySessionId,
      sessionId,
    ),
    pendingSshExitBySessionId: withoutKey(
      state.pendingSshExitBySessionId,
      sessionId,
    ),
    ignoredSshSessionIds: {
      ...state.ignoredSshSessionIds,
      [sessionId]: true,
    },
  };
}

export function setSftpEntries(
  state: RemoteViewState,
  hostId: string,
  path: string,
  entries: RemoteFileEntry[],
): RemoteViewState {
  return {
    ...state,
    sftpPathByHostId: {
      ...state.sftpPathByHostId,
      [hostId]: path,
    },
    sftpEntriesByHostPath: {
      ...state.sftpEntriesByHostPath,
      [`${hostId}:${path}`]: entries,
    },
  };
}

export function appendRemoteCommandOutput(
  state: RemoteViewState,
  runId: string,
  chunk: string,
): RemoteViewState {
  return {
    ...state,
    commandOutputByRunId: {
      ...state.commandOutputByRunId,
      [runId]: appendBoundedOutput(state.commandOutputByRunId[runId] ?? "", chunk),
    },
  };
}

export function setRemoteCommandResult(
  state: RemoteViewState,
  runId: string,
  result: RemoteCommandResult,
): RemoteViewState {
  return {
    ...state,
    commandResults: [result, ...state.commandResults].slice(0, 25),
    commandOutputByRunId: {
      ...state.commandOutputByRunId,
      [runId]: appendBoundedOutput(
        state.commandOutputByRunId[runId] ?? "",
        `${result.stdout}${result.stderr}`,
      ),
    },
  };
}

function appendBoundedOutput(previous: string, chunk: string): string {
  const output = `${previous}${chunk}`;
  return output.slice(Math.max(0, output.length - MAX_REMOTE_OUTPUT));
}

function chooseActiveHostId(
  requestedHostId: string | null,
  hosts: RemoteHostProfile[],
): string | null {
  if (requestedHostId && hosts.some((host) => host.id === requestedHostId)) {
    return requestedHostId;
  }

  return hosts[0]?.id ?? null;
}

function withoutKey<T>(
  value: Record<string, T>,
  key: string,
): Record<string, T> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}
