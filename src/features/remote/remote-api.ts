import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { call } from "../../lib/tauri";
import type {
  RemoteCommandResult,
  RemoteConnectionSnapshot,
  RemoteFileEntry,
  RemoteHostProfile,
  RemoteHostProfileInput,
  RemoteTransferResult,
  SshTerminalSessionInfo,
} from "./remote-model";

export type SshTerminalOutputEvent = {
  session_id: string;
  chunk: string;
};

export type SshTerminalExitEvent = {
  session_id: string;
  exit_code: number | null;
};

export function listRemoteHosts(
  workspaceRoot: string,
): Promise<RemoteHostProfile[]> {
  return call<RemoteHostProfile[]>("list_remote_hosts", { workspaceRoot });
}

export function saveRemoteHost(
  input: RemoteHostProfileInput,
): Promise<RemoteHostProfile> {
  return call<RemoteHostProfile>("save_remote_host", { input });
}

export function deleteRemoteHost(
  workspaceRoot: string,
  profileId: string,
): Promise<void> {
  return call<void>("delete_remote_host", { workspaceRoot, profileId });
}

export function connectRemoteHost(
  profileId: string,
): Promise<RemoteConnectionSnapshot> {
  return call<RemoteConnectionSnapshot>("connect_remote_host", { profileId });
}

export function disconnectRemoteHost(
  profileId: string,
): Promise<RemoteConnectionSnapshot> {
  return call<RemoteConnectionSnapshot>("disconnect_remote_host", { profileId });
}

export function listSshTerminalSessions(
  workspaceId: string,
): Promise<SshTerminalSessionInfo[]> {
  return call<SshTerminalSessionInfo[]>("list_ssh_terminal_sessions", {
    workspaceId,
  });
}

export function spawnSshTerminal(args: {
  workspaceId: string;
  workspaceRoot: string;
  profileId: string;
  rows: number;
  cols: number;
}): Promise<SshTerminalSessionInfo> {
  return call<SshTerminalSessionInfo>("spawn_ssh_terminal", args);
}

export function writeSshTerminal(
  sessionId: string,
  data: string,
): Promise<void> {
  return call<void>("write_ssh_terminal", { sessionId, data });
}

export function resizeSshTerminal(
  sessionId: string,
  rows: number,
  cols: number,
): Promise<void> {
  return call<void>("resize_ssh_terminal", { sessionId, rows, cols });
}

export function closeSshTerminalSession(
  sessionId: string,
): Promise<SshTerminalSessionInfo> {
  return call<SshTerminalSessionInfo>("close_ssh_terminal", { sessionId });
}

export function runRemoteCommand(
  profileId: string,
  command: string,
): Promise<RemoteCommandResult> {
  return call<RemoteCommandResult>("run_remote_command", { profileId, command });
}

export function listSftpDirectory(
  profileId: string,
  path: string,
): Promise<RemoteFileEntry[]> {
  return call<RemoteFileEntry[]>("list_sftp_directory", { profileId, path });
}

export function downloadSftpFile(args: {
  workspaceRoot: string;
  profileId: string;
  remotePath: string;
  localRelativePath: string;
}): Promise<RemoteTransferResult> {
  return call<RemoteTransferResult>("download_sftp_file", args);
}

export function uploadSftpFile(args: {
  workspaceRoot: string;
  profileId: string;
  localRelativePath: string;
  remotePath: string;
}): Promise<RemoteTransferResult> {
  return call<RemoteTransferResult>("upload_sftp_file", args);
}

export function listenSshTerminalOutput(
  handler: (event: SshTerminalOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<SshTerminalOutputEvent>(
    "workspace://ssh-terminal-output",
    (event) => handler(event.payload),
  );
}

export function listenSshTerminalExit(
  handler: (event: SshTerminalExitEvent) => void,
): Promise<UnlistenFn> {
  return listen<SshTerminalExitEvent>(
    "workspace://ssh-terminal-exit",
    (event) => handler(event.payload),
  );
}
