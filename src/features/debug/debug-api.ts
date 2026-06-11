import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { call } from "../../lib/tauri";
import type {
  DebugConsoleEvent,
  DebugLaunchConfig,
  DebugLaunchConfigInput,
  DebugScope,
  DebugSessionEvent,
  DebugSessionInfo,
  DebugSourceBreakpoint,
  DebugSourceBreakpointInput,
  DebugStackFrame,
  DebugVariable,
} from "./debug-model";

export type DebugWorkspaceCommand = {
  workspaceId: string;
  workspaceRoot: string;
};

export type DebugStartSessionCommand = DebugWorkspaceCommand & {
  configId: string;
};

export type DebugSetBreakpointsCommand = DebugWorkspaceCommand & {
  sourcePath: string;
  breakpoints: DebugSourceBreakpointInput[];
};

export type DebugSessionCommand = DebugWorkspaceCommand & {
  sessionId: string;
};

export type DebugSetSessionBreakpointsCommand = DebugSessionCommand & {
  sourcePath: string;
  breakpoints: DebugSourceBreakpointInput[];
};

export type DebugStackTraceCommand = DebugSessionCommand & {
  threadId: number;
};

export type DebugScopesCommand = DebugSessionCommand & {
  frameId: number;
};

export type DebugVariablesCommand = DebugSessionCommand & {
  variablesReference: number;
};

export type DebugEvaluateCommand = DebugSessionCommand & {
  expression: string;
};

export type DebugStoppedEvent = DebugSessionEvent & {
  thread_id: number | null;
};

export type DebugExitedEvent = DebugSessionEvent;

export function listDebugLaunchConfigs(
  workspaceRoot: string,
): Promise<DebugLaunchConfig[]> {
  return call<DebugLaunchConfig[]>("debug_list_launch_configs", {
    workspaceRoot,
  });
}

export function saveDebugLaunchConfig(
  input: DebugLaunchConfigInput,
): Promise<DebugLaunchConfig> {
  return call<DebugLaunchConfig>("debug_save_launch_config", { input });
}

export function deleteDebugLaunchConfig(
  workspaceRoot: string,
  configId: string,
): Promise<void> {
  return call<void>("debug_delete_launch_config", { workspaceRoot, configId });
}

export function listDebugSessions(
  args: DebugWorkspaceCommand,
): Promise<DebugSessionInfo[]> {
  return call<DebugSessionInfo[]>("debug_list_sessions", args);
}

export function startDebugSession(
  args: DebugStartSessionCommand,
): Promise<DebugSessionInfo> {
  return call<DebugSessionInfo>("debug_start_session", args);
}

export function setDebugBreakpointsCommand(
  args: DebugSetBreakpointsCommand,
): Promise<DebugSourceBreakpoint[]> {
  return call<DebugSourceBreakpoint[]>("debug_set_breakpoints", args);
}

export function setDebugSessionBreakpoints(
  args: DebugSetSessionBreakpointsCommand,
): Promise<DebugSourceBreakpoint[]> {
  return call<DebugSourceBreakpoint[]>("debug_set_session_breakpoints", args);
}

export function continueDebugSession(
  args: DebugSessionCommand,
): Promise<DebugSessionInfo> {
  return call<DebugSessionInfo>("debug_continue", args);
}

export function stepOverDebugSession(
  args: DebugSessionCommand,
): Promise<DebugSessionInfo> {
  return call<DebugSessionInfo>("debug_step_over", args);
}

export function pauseDebugSession(
  args: DebugSessionCommand,
): Promise<DebugSessionInfo> {
  return call<DebugSessionInfo>("debug_pause", args);
}

export function disconnectDebugSession(
  args: DebugSessionCommand,
): Promise<DebugSessionInfo> {
  return call<DebugSessionInfo>("debug_disconnect", args);
}

export function getDebugStackTrace(
  args: DebugStackTraceCommand,
): Promise<DebugStackFrame[]> {
  return call<DebugStackFrame[]>("debug_stack_trace", args);
}

export function getDebugScopes(args: DebugScopesCommand): Promise<DebugScope[]> {
  return call<DebugScope[]>("debug_scopes", args);
}

export function getDebugVariables(
  args: DebugVariablesCommand,
): Promise<DebugVariable[]> {
  return call<DebugVariable[]>("debug_variables", args);
}

export function evaluateDebugExpression(
  args: DebugEvaluateCommand,
): Promise<DebugVariable> {
  return call<DebugVariable>("debug_evaluate", args);
}

export function getDebugSessionLogs(
  args: DebugWorkspaceCommand,
): Promise<string[]> {
  return call<string[]>("debug_session_logs", args);
}

export function listenDebugSession(
  handler: (event: DebugSessionEvent) => void,
): Promise<UnlistenFn> {
  return listen<DebugSessionEvent>("workspace://debug-session", (event) =>
    handler(event.payload),
  );
}

export function listenDebugConsole(
  handler: (event: DebugConsoleEvent) => void,
): Promise<UnlistenFn> {
  return listen<DebugConsoleEvent>("workspace://debug-console", (event) =>
    handler(event.payload),
  );
}

export function listenDebugStopped(
  handler: (event: DebugStoppedEvent) => void,
): Promise<UnlistenFn> {
  return listen<DebugStoppedEvent>("workspace://debug-stopped", (event) =>
    handler(event.payload),
  );
}

export function listenDebugExited(
  handler: (event: DebugExitedEvent) => void,
): Promise<UnlistenFn> {
  return listen<DebugExitedEvent>("workspace://debug-exited", (event) =>
    handler(event.payload),
  );
}
