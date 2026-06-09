import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { call } from "../../lib/tauri";
import type { TerminalSessionInfo } from "./terminal-model";

export type TerminalOutputEvent = {
  session_id: string;
  chunk: string;
};

export type TerminalExitEvent = {
  session_id: string;
  exit_code: number | null;
};

export function listTerminalSessions(
  workspaceId: string,
): Promise<TerminalSessionInfo[]> {
  return call<TerminalSessionInfo[]>("list_terminal_sessions", { workspaceId });
}

export function spawnTerminalSession(args: {
  workspaceId: string;
  workspaceRoot: string;
  cwd: string;
  name?: string;
  rows: number;
  cols: number;
}): Promise<TerminalSessionInfo> {
  return call<TerminalSessionInfo>("spawn_terminal_session", args);
}

export function writeTerminalSession(
  sessionId: string,
  data: string,
): Promise<void> {
  return call<void>("write_terminal_session", { sessionId, data });
}

export function closeTerminalSession(
  sessionId: string,
): Promise<TerminalSessionInfo> {
  return call<TerminalSessionInfo>("close_terminal_session", { sessionId });
}

export function onTerminalOutput(
  handler: (event: TerminalOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<TerminalOutputEvent>("workspace://terminal-output", (event) =>
    handler(event.payload),
  );
}

export function onTerminalExit(
  handler: (event: TerminalExitEvent) => void,
): Promise<UnlistenFn> {
  return listen<TerminalExitEvent>("workspace://terminal-exit", (event) =>
    handler(event.payload),
  );
}
