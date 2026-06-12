/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  createAgentState,
  activeAgentSession,
  type AgentSession,
  type AgentViewState,
} from "../features/agents/agent-model";
import { createLanguageState } from "../features/language/language-model";
import { createDocsState } from "../features/docs/docs-model";
import {
  createDiagnosticsState,
  storeMetricSnapshot,
  type AppMetricSnapshot,
  type DiagnosticEvent,
} from "../features/diagnostics/diagnostics-model";
import {
  createBrowserState,
  type BrowserUrl,
  type BrowserScreenshot,
} from "../features/browser/browser-model";
import {
  createDatabaseState,
  type DatabaseQueryResult,
  type DatabaseQueryRequest,
  type DatabaseQueryHistoryEntry,
  type DatabaseProfile,
  type DatabaseViewState,
  type DatabaseSchema,
  type DatabaseTable,
} from "../features/database/database-model";
import { SshTerminalSurface } from "../features/remote/SshTerminalSurface";
import {
  createRemoteState,
  type RemoteHostProfile,
  type RemoteViewState,
} from "../features/remote/remote-model";
import {
  AppShell,
  collectAgentAvailableContext,
  activeLoadedFileForWorkspace,
  PanelBody,
  BrowserPreviewSplitSurface,
  shouldShowBrowserSplitEditor,
  openBrowserPreviewWithValidation,
  startBrowserValidationRequest,
  isLatestBrowserValidationRequest,
  startBrowserCaptureRequest,
  isLatestBrowserCaptureRequest,
  captureBrowserPreviewWithValidation,
  databaseTableSql,
  classifyDatabaseSql,
  executeDatabaseQueryRequest,
  inspectDatabaseProfileRequest,
  refreshDatabaseProfilesRequest,
  refreshRemoteHostsRequest,
  exportDatabaseQueryResultRequest,
  handleSshTerminalExitEvent,
  handleSshTerminalOutputEvent,
  knownWorkspaceIdForSshTerminal,
  remoteTransferFileName,
  activeDebugLineForFile,
  activeDebugSessionForState,
  applyDebugRefreshSnapshot,
  handleDebugConsoleEvent,
  handleDebugSessionEvent,
  runDebugCommandFromPalette,
  type BrowserCaptureRequestState,
  type BrowserValidationRequestState,
  type AgentAvailableContextSource,
} from "./AppShell";
import { ensureTestDom } from "./test-dom";
import { resetWorkspaceBootstrapForTests } from "./workspace-bootstrap";
import { workspaceStore } from "./workspace-store";
import { workspaceViewStore } from "./workspace-view-state";
import {
  createDebugState,
  replaceDebugLaunchConfigs,
  setDebugScopes,
  setDebugStack,
  storeDebugVariables,
  type DebugScope,
  type DebugLaunchConfig,
  type DebugSessionInfo,
  type DebugStackFrame,
  type DebugVariable,
  type DebugViewState,
} from "../features/debug/debug-model";
import {
  replaceExtensionStatuses,
  type ExtensionWorkspaceStatus,
} from "../features/extensions/extension-model";
import type { TextFileRead } from "../features/files/file-api";
import type { FileVersion } from "../features/files/file-model";
import {
  createRecoveryState,
  type UnsavedBackup,
} from "../features/recovery/recovery-model";
import {
  createSettingsState,
  selectSettingsCategory,
  type AppSettingsInput,
} from "../features/settings/settings-model";

ensureTestDom();

mock.module("../features/editor/EditorTab", () => ({
  EditorTab({
    content,
    onContentChange,
  }: {
    content: string;
    onContentChange: (content: string) => void;
  }) {
    return (
      <textarea
        aria-label="Mock editor"
        value={content}
        onChange={(event) => onContentChange(event.currentTarget.value)}
      />
    );
  },
}));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");

function makeSession(id: string, path = "src/app/AppShell.tsx"): AgentSession {
  return {
    id,
    workspace_root: "/repo",
    mode: "plan",
    prompt: "Draft",
    context_items: [
      {
        id: `file:${path}`,
        kind: "file",
        label: path,
        path,
        content: "shell",
        truncated: false,
      },
    ],
    transcript: [],
    created_ms: 1,
    updated_ms: 2,
  };
}

function databaseState(
  overrides: Partial<DatabaseViewState> = {},
): DatabaseViewState {
  return {
    ...createDatabaseState(),
    ...overrides,
  };
}

type WorkspaceContext = {
  workspaceId: string;
  workspaceRoot: string;
  profileId: string;
};

function setupWorkspace(
  overrides: Partial<WorkspaceContext> = {},
): WorkspaceContext {
  const workspaceId = overrides.workspaceId ?? "ws-task5";
  const workspaceRoot = overrides.workspaceRoot ?? "/repo";
  const profileId = overrides.profileId ?? "db-local";

  workspaceStore.getState().setRegistry({
    active_workspace_id: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        path: workspaceRoot,
        name: workspaceId,
        pinned: false,
      },
    ],
  });
  workspaceViewStore.getState().updateDatabase(workspaceId, () => ({
    ...createDatabaseState(),
    activeProfileId: profileId,
    profiles: [
      {
        id: profileId,
        workspace_root: workspaceRoot,
        name: `${profileId}.db`,
        kind: "SQLite",
        source: { SQLite: { path: `${workspaceRoot}/${profileId}.db` } },
        read_only: false,
        production: false,
        created_ms: 1,
        updated_ms: 1,
      },
    ],
  }));

  return { workspaceId, workspaceRoot, profileId };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });

  return { promise, resolve, reject };
}

function setDatabase(
  workspaceId: string,
  update: (state: DatabaseViewState) => DatabaseViewState,
): void {
  workspaceViewStore.getState().updateDatabase(workspaceId, update);
}

function setRemote(
  workspaceId: string,
  update: (state: RemoteViewState) => RemoteViewState,
): void {
  workspaceViewStore.getState().updateRemote(workspaceId, update);
}

function remoteHost(
  overrides: Partial<RemoteHostProfile> = {},
): RemoteHostProfile {
  return {
    id: overrides.id ?? "edge",
    workspace_root: overrides.workspace_root ?? "/repo",
    name: overrides.name ?? overrides.id ?? "edge",
    host: overrides.host ?? "edge.example.com",
    port: overrides.port ?? 22,
    username: overrides.username ?? "deploy",
    auth: overrides.auth ?? "Agent",
    default_remote_path: overrides.default_remote_path ?? "/srv/app",
    keepalive_seconds: overrides.keepalive_seconds ?? 30,
    connect_timeout_seconds: overrides.connect_timeout_seconds ?? 10,
    created_ms: overrides.created_ms ?? 1,
    updated_ms: overrides.updated_ms ?? 1,
  };
}

type PanelBodyProps = Parameters<typeof PanelBody>[0];

function panelBodyProps(overrides: Partial<PanelBodyProps> = {}): PanelBodyProps {
  return {
    active: "explorer",
    refreshKey: 0,
    activeFilePath: "src/app/AppShell.tsx",
    terminalSessions: [],
    activeTerminalId: null,
    terminalCwdInput: "",
    terminalError: null,
    taskState: {
      detectedTasks: [],
      runs: [],
      activeRunId: null,
      outputByRunId: {},
      problemsByRunId: {},
      pendingOutputByRunId: {},
      pendingFinishByRunId: {},
      contextPackByRunId: {},
      customCommand: "",
    },
    taskError: null,
    gitState: {
      status: null,
      loading: false,
      error: null,
      commitMessage: "",
      selectedDiff: null,
      diffByKey: {},
      branches: [],
      graph: [],
    },
    docsState: createDocsState(),
    contextPackNameById: {},
    gitDecorations: {},
    onOpenFile: () => {},
    onCreateFile: async () => {},
    onRenamePath: async () => {},
    onDeletePath: async () => {},
    onTerminalCwdInputChange: () => {},
    onNewTerminal: () => {},
    onActivateTerminal: () => {},
    onCloseTerminal: () => {},
    onRestartTerminal: () => {},
    onTaskCustomCommandChange: () => {},
    onRunTask: () => {},
    onRunCustomTask: () => {},
    onActivateTaskRun: () => {},
    onStopTaskRun: () => {},
    onRerunTaskRun: () => {},
    onGitRefresh: () => {},
    onGitCommitMessageChange: () => {},
    onGitCommit: () => {},
    onGitStage: () => {},
    onGitUnstage: () => {},
    onGitDiscard: () => {},
    onGitOpenDiff: () => {},
    onGitStash: () => {},
    onGitFetch: () => {},
    onGitPull: () => {},
    onGitPush: () => {},
    onGitCheckoutBranch: () => {},
    onGitCreateBranch: () => {},
    onGitOpenGraph: () => {},
    onDocsRefresh: () => {},
    onDocsSearch: () => {},
    onDocsOpenPreview: () => {},
    onDocsToggleSource: () => {},
    onDocsPackNameChange: () => {},
    onDocsCreatePack: () => {},
    onDocsSelectPack: () => {},
    onDocsDeletePack: () => {},
    onDocsUsePackForActiveTask: () => {},
    onDocsLinkPackToAgentSession: async () => {},
    agentState: createAgentState(),
    availableAgentContext: [],
    onAgentModeChange: () => {},
    onAgentPromptChange: () => {},
    onAgentToggleContext: () => {},
    onAgentStartSession: () => {},
    onAgentSelectSession: () => {},
    onAgentApprove: () => {},
    onAgentReject: () => {},
    onAgentExport: () => {},
    onLanguageOpenDiagnostic: () => {},
    onLanguageRefresh: () => {},
    onLanguageRestartServer: () => {},
    browserState: createBrowserState(),
    browserTargets: [],
    browserCanCapture: false,
    onBrowserUrlInputChange: () => {},
    onBrowserOpenUrl: () => {},
    onBrowserOpenTarget: () => {},
    onBrowserReload: () => {},
    onBrowserHardReload: () => {},
    onBrowserCapture: () => {},
    onBrowserSelectScreenshot: () => {},
    languageState: createLanguageState(),
    databaseState: createDatabaseState(),
    onDatabaseRefreshProfiles: () => {},
    onDatabaseSelectProfile: () => {},
    onDatabaseInspectProfile: () => {},
    onDatabaseOpenTable: () => {},
    onDatabaseDraftChange: () => {},
    onDatabaseRunQuery: () => {},
    onDatabaseConfirmQuery: () => {},
    onDatabaseCancelConfirmation: () => {},
    onDatabaseExportResult: () => {},
    onDatabaseSelectHistory: () => {},
    remoteState: createRemoteState(),
    onRemoteModeChange: () => {},
    onRemoteSelectHost: () => {},
    onRemoteRefresh: () => {},
    onRemoteCreateHost: () => {},
    onRemoteConnectHost: () => {},
    onRemoteOpenSsh: () => {},
    onRemoteOpenSftp: () => {},
    onRemoteRunCommand: () => {},
    onRemoteCommandDraftChange: () => {},
    onRemoteListSftpDirectory: () => {},
    onRemoteDownloadFile: () => {},
    onRemoteUploadFile: () => {},
    recoveryState: createRecoveryState(),
    onRecoveryRefresh: () => {},
    onRecoveryRestore: () => {},
    onRecoveryDiscard: () => {},
    diagnosticsState: createDiagnosticsState(),
    settingsState: createSettingsState(),
    onSettingsSelectCategory: () => {},
    onDiagnosticsRefresh: () => {},
    onKeybindingImportDraftChange: () => {},
    debugState: createDebugState(),
    onDebugModeChange: () => {},
    onDebugSelectConfig: () => {},
    onDebugStartSession: () => {},
    onDebugContinue: () => {},
    onDebugStepOver: () => {},
    onDebugPause: () => {},
    onDebugDisconnect: () => {},
    onDebugOpenFrame: () => {},
    onDebugAddWatch: () => {},
    onDebugRemoveWatch: () => {},
    onDebugEvaluate: () => {},
    ...overrides,
  };
}

function debugLaunchConfig(
  overrides: Partial<DebugLaunchConfig> = {},
): DebugLaunchConfig {
  return {
    id: overrides.id ?? "cfg-python",
    workspace_root: overrides.workspace_root ?? "/repo",
    name: overrides.name ?? "Python",
    adapter: overrides.adapter ?? "Python",
    request: overrides.request ?? "Launch",
    program: overrides.program ?? "app.py",
    cwd: overrides.cwd ?? ".",
    args: overrides.args ?? [],
    env: overrides.env ?? [],
    stop_on_entry: overrides.stop_on_entry ?? true,
    attach: overrides.attach ?? null,
    created_ms: overrides.created_ms ?? 1,
    updated_ms: overrides.updated_ms ?? 1,
  };
}

function debugSession(overrides: Partial<DebugSessionInfo> = {}): DebugSessionInfo {
  return {
    id: overrides.id ?? "session-1",
    workspace_id: overrides.workspace_id ?? "debug-workspace-a",
    workspace_root: overrides.workspace_root ?? "/repo-a",
    config_id: overrides.config_id ?? "cfg-python",
    name: overrides.name ?? "Python",
    adapter: overrides.adapter ?? "Python",
    status: overrides.status ?? "Running",
    active_thread_id: overrides.active_thread_id ?? null,
    stopped_reason: overrides.stopped_reason ?? null,
    last_error: overrides.last_error ?? null,
    sequence: overrides.sequence ?? 1,
  };
}

function extensionStatus({
  id = "yuuzu.debug-tools",
  name = "Debug Tools",
  enabled = true,
  commandId = `${id}.command`,
  commandLabel = `${name}: Command`,
}: {
  id?: string;
  name?: string;
  enabled?: boolean;
  commandId?: string;
  commandLabel?: string;
} = {}): ExtensionWorkspaceStatus {
  return {
    manifest: {
      id,
      name,
      version: "0.1.0",
      api_version: "0.1",
      description: `${name} extension`,
      builtin: true,
      contributes: {
        commands: [
          {
            id: commandId,
            label: commandLabel,
            group: "Extensions",
            description: `${commandLabel} command`,
            owner_extension_id: id,
          },
        ],
        themes: [],
        keybindings: [],
        snippets: [],
        workspace_hooks: [],
      },
    },
    enabled,
    disabled_by_workspace: !enabled,
    performance: {
      last_duration_ms: enabled ? 12 : null,
      slow_operation_count: 0,
      sample_count: enabled ? 1 : 0,
      class: "Ok",
    },
  };
}

type TauriInvokeCall = {
  command: string;
  args: Record<string, unknown>;
};

type TauriEventCallback = (event: {
  event: string;
  id: number;
  payload: unknown;
}) => void;

type AppShellTauriMockOptions = {
  workspaceId: string;
  workspaceRoot: string;
  textFiles?: Record<string, TextFileRead>;
  recoveryBackups?: UnsavedBackup[];
  settings?: AppSettingsInput;
  settingsResponses?: Array<AppSettingsInput | Promise<AppSettingsInput>>;
  importKeybindingsResponse?: AppSettingsInput | Promise<AppSettingsInput>;
  importKeybindingsResponses?: Array<AppSettingsInput | Promise<AppSettingsInput>>;
  importKeybindingsError?: unknown;
  metricSnapshot?: AppMetricSnapshot;
  metricSnapshotResponses?: Array<AppMetricSnapshot | Promise<AppMetricSnapshot>>;
  diagnosticEvents?: DiagnosticEvent[];
  diagnosticEventsResponses?: Array<
    DiagnosticEvent[] | Promise<DiagnosticEvent[]>
  >;
  listUnsavedBackupsResponses?: Array<
    UnsavedBackup[] | Promise<UnsavedBackup[]>
  >;
  saveUnsavedBackupResponses?: Array<UnsavedBackup | Promise<UnsavedBackup>>;
  launchConfigs?: DebugLaunchConfig[];
  debugSessions?: DebugSessionInfo[];
  startedSession?: DebugSessionInfo;
  debugStackFrames?: DebugStackFrame[] | Promise<DebugStackFrame[]>;
  debugScopesByFrameId?: Record<number, DebugScope[] | Promise<DebugScope[]>>;
  debugVariablesByReference?: Record<
    number,
    DebugVariable[] | Promise<DebugVariable[]>
  >;
  extensionStatuses?: ExtensionWorkspaceStatus[];
  setExtensionEnabledResponses?: Array<
    ExtensionWorkspaceStatus[] | Promise<ExtensionWorkspaceStatus[]>
  >;
  recordExtensionPerformanceResponses?: Array<
    ExtensionWorkspaceStatus[] | Promise<ExtensionWorkspaceStatus[]>
  >;
};

function appShellGitStatus(workspaceRoot: string) {
  return {
    workspace_root: workspaceRoot,
    repository_root: workspaceRoot,
    branch: "main",
    upstream: null,
    ahead: 0,
    behind: 0,
    clean: true,
    has_conflicts: false,
    changes: [],
  };
}

function installAppShellTauriMock(options: AppShellTauriMockOptions) {
  const invokeCalls: TauriInvokeCall[] = [];
  const callbacks = new Map<number, TauriEventCallback>();
  const listeners: Record<string, TauriEventCallback[]> = {};
  let callbackId = 1;
  let extensionStatuses = options.extensionStatuses ?? [];
  const setExtensionEnabledResponses = [
    ...(options.setExtensionEnabledResponses ?? []),
  ];
  const recordExtensionPerformanceResponses = [
    ...(options.recordExtensionPerformanceResponses ?? []),
  ];
  const settingsResponses = [...(options.settingsResponses ?? [])];
  const importKeybindingsResponses = [
    ...(options.importKeybindingsResponses ?? []),
  ];
  const metricSnapshotResponses = [...(options.metricSnapshotResponses ?? [])];
  const diagnosticEventsResponses = [
    ...(options.diagnosticEventsResponses ?? []),
  ];
  const saveUnsavedBackupResponses = [
    ...(options.saveUnsavedBackupResponses ?? []),
  ];
  const listUnsavedBackupsResponses = [
    ...(options.listUnsavedBackupsResponses ?? []),
  ];
  const registry = {
    active_workspace_id: options.workspaceId,
    workspaces: [
      {
        id: options.workspaceId,
        name: options.workspaceId,
        path: options.workspaceRoot,
        pinned: false,
      },
    ],
  };

  const internals = {
    transformCallback: (callback: TauriEventCallback) => {
      const id = callbackId;
      callbackId += 1;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id: number) => {
      callbacks.delete(id);
    },
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      invokeCalls.push({ command, args });

      if (command === "plugin:event|listen") {
        const event = String(args.event);
        const handlerId = Number(args.handler);
        const callback = callbacks.get(handlerId);
        if (callback) {
          listeners[event] = [...(listeners[event] ?? []), callback];
        }
        return `${event}:${listeners[event]?.length ?? 0}`;
      }
      if (command === "plugin:event|unlisten") {
        return null;
      }

      switch (command) {
        case "list_workspaces":
          return registry;
        case "list_workspace_tasks":
        case "list_task_runs":
        case "git_list_branches":
        case "docs_index":
        case "list_context_packs":
        case "list_agent_sessions":
        case "list_remote_hosts":
        case "list_ssh_terminal_sessions":
        case "list_database_profiles":
        case "lsp_server_status":
        case "lsp_workspace_diagnostics":
        case "scan_workspace":
        case "scan_directory":
          return [];
        case "load_settings":
          if (settingsResponses.length > 0) {
            return settingsResponses.shift();
          }

          return (
            options.settings ?? {
              schema_version: 2,
              density: "compact",
              color_theme: "dark",
              accent_color: "yuzu",
              update_channel: "manual",
              keybindings: [],
            }
          );
        case "save_settings":
          return args.settings;
        case "import_keybindings": {
          if (importKeybindingsResponses.length > 0) {
            return importKeybindingsResponses.shift();
          }
          if (options.importKeybindingsError) {
            throw options.importKeybindingsError;
          }
          if (options.importKeybindingsResponse) {
            return options.importKeybindingsResponse;
          }

          const mappings: Record<string, string> = {
            "workbench.action.showCommands": "open-command-palette",
            "workbench.action.files.save": "save-file",
            "workbench.action.terminal.new": "new-terminal",
            "workbench.action.quickOpen": "open-workspace",
          };
          const parsed = JSON.parse(String(args.content)) as Array<{
            command?: string;
            key?: string;
          }>;
          return {
            ...(options.settings ?? {
              schema_version: 2,
              density: "compact",
              color_theme: "dark",
              accent_color: "yuzu",
              update_channel: "manual",
            }),
            schema_version: 2,
            keybindings: parsed.flatMap((keybinding) => {
              const commandId = keybinding.command
                ? mappings[keybinding.command]
                : undefined;
              return commandId && keybinding.key
                ? [
                    {
                      command_id: commandId,
                      key: keybinding.key,
                      source: "vscode",
                    },
                  ]
                : [];
            }),
          };
        }
        case "metric_snapshot":
          if (metricSnapshotResponses.length > 0) {
            return metricSnapshotResponses.shift();
          }

          return (
            options.metricSnapshot ?? {
              timestamp_ms: 1,
              process_id: 42,
              memory_bytes: 104_857_600,
              uptime_ms: 120_000,
              workspace_count: Number(args.workspaceCount ?? 0),
              active_workspace_id: (args.activeWorkspaceId ?? null) as
                | string
                | null,
              docs_index_entries: Number(args.docsIndexEntries ?? 0),
              file_tree_entries: Number(args.fileTreeEntries ?? 0),
            }
          );
        case "list_diagnostic_events":
          if (diagnosticEventsResponses.length > 0) {
            return diagnosticEventsResponses.shift();
          }

          return options.diagnosticEvents ?? [];
        case "append_diagnostic_event":
          return {
            id: "event-startup",
            timestamp_ms: 1,
            level: String(args.level ?? "info"),
            source: String(args.source ?? "app"),
            message: String(args.message ?? "startup"),
          };
        case "read_text_file": {
          const path = String(args.path);
          return (
            options.textFiles?.[path] ?? {
              path,
              content: "",
              version: { modified_ms: 1, len: 0 },
              too_large: false,
            }
          );
        }
        case "list_unsaved_backups":
          if (listUnsavedBackupsResponses.length > 0) {
            return listUnsavedBackupsResponses.shift();
          }

          return options.recoveryBackups ?? [];
        case "save_unsaved_backup":
          if (saveUnsavedBackupResponses.length > 0) {
            return saveUnsavedBackupResponses.shift();
          }

          return {
            id: `backup-${String(args.workspaceId)}-${String(args.path)}`,
            workspace_id: String(args.workspaceId),
            workspace_root: String(args.workspaceRoot),
            path: String(args.path),
            content: String(args.content),
            version: (args.version ?? null) as FileVersion | null,
            updated_ms: 10,
          };
        case "discard_unsaved_backup":
          return null;
        case "debug_stack_trace":
          return options.debugStackFrames ?? [];
        case "debug_scopes":
          return options.debugScopesByFrameId?.[Number(args.frameId)] ?? [];
        case "debug_variables":
          return (
            options.debugVariablesByReference?.[Number(args.variablesReference)] ?? []
          );
        case "extension_statuses":
          return extensionStatuses;
        case "set_extension_enabled":
          if (setExtensionEnabledResponses.length > 0) {
            return setExtensionEnabledResponses.shift();
          }

          extensionStatuses = extensionStatuses.map((status) =>
            status.manifest.id === String(args.extensionId)
              ? {
                  ...status,
                  enabled: Boolean(args.enabled),
                  disabled_by_workspace: !Boolean(args.enabled),
                }
              : status,
          );
          return extensionStatuses;
        case "record_extension_performance":
          if (recordExtensionPerformanceResponses.length > 0) {
            return recordExtensionPerformanceResponses.shift();
          }

          return extensionStatuses;
        case "watch_workspace":
          return {
            workspace_root: args.workspaceRoot ?? options.workspaceRoot,
            watch_id: "watch-test",
          };
        case "unwatch_workspace":
          return null;
        case "git_status":
          return appShellGitStatus(String(args.workspaceRoot));
        case "debug_list_launch_configs":
          return options.launchConfigs ?? [];
        case "debug_list_sessions":
          return options.debugSessions ?? [];
        case "debug_start_session":
          return (
            options.startedSession ??
            debugSession({
              id: "session-started",
              workspace_id: String(args.workspaceId),
              workspace_root: String(args.workspaceRoot),
              config_id: String(args.configId),
              name: "Python",
            })
          );
        default:
          return null;
      }
    },
  };

  (window as unknown as { __TAURI_INTERNALS__: typeof internals }).__TAURI_INTERNALS__ =
    internals;

  return {
    invokeCalls,
    emit(event: string, payload: unknown) {
      for (const callback of listeners[event] ?? []) {
        callback({ event, id: 1, payload });
      }
    },
  };
}

function setupAppShellDebugWorkspace({
  workspaceId,
  workspaceRoot,
  launchConfigs = [debugLaunchConfig({ workspace_root: workspaceRoot })],
  debugSessions = [],
  activeSessionId = null,
  surface = "empty",
}: {
  workspaceId: string;
  workspaceRoot: string;
  launchConfigs?: DebugLaunchConfig[];
  debugSessions?: DebugSessionInfo[];
  activeSessionId?: string | null;
  surface?: "empty" | "debug-console";
}) {
  resetWorkspaceBootstrapForTests();
  workspaceStore.getState().setRegistry({
    active_workspace_id: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        path: workspaceRoot,
        name: workspaceId,
        pinned: false,
      },
    ],
  });
  workspaceViewStore.getState().updateView(workspaceId, {
    activeActivity: "explorer",
    panelOpen: true,
    surface,
  });
  workspaceViewStore.getState().updateDebug(workspaceId, () => ({
    ...replaceDebugLaunchConfigs(createDebugState(), launchConfigs),
    sessions: debugSessions,
    activeSessionId,
    consoleBySessionId: Object.fromEntries(
      debugSessions.map((session) => [session.id, "debug console output"]),
    ),
  }));
}

async function flushAppShellEffects() {
  for (let index = 0; index < 3; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderAppShellForDebug(
  options: AppShellTauriMockOptions & {
    initialSessions?: DebugSessionInfo[];
    initialActiveSessionId?: string | null;
    initialExtensionStatuses?: ExtensionWorkspaceStatus[];
    surface?: "empty" | "debug-console";
  },
) {
  const launchConfigs = options.launchConfigs ?? [
    debugLaunchConfig({ workspace_root: options.workspaceRoot }),
  ];
  const tauri = installAppShellTauriMock({
    ...options,
    launchConfigs,
  });
  setupAppShellDebugWorkspace({
    workspaceId: options.workspaceId,
    workspaceRoot: options.workspaceRoot,
    launchConfigs,
    debugSessions: options.initialSessions ?? [],
    activeSessionId: options.initialActiveSessionId ?? null,
    surface: options.surface,
  });
  if (options.initialExtensionStatuses) {
    workspaceViewStore.getState().updateExtension(options.workspaceId, (extension) =>
      replaceExtensionStatuses(extension, options.initialExtensionStatuses ?? []),
    );
  }

  let renderResult!: ReturnType<typeof render>;
  await act(async () => {
    renderResult = render(<AppShell />);
  });
  await flushAppShellEffects();

  return { renderResult, tauri };
}

afterEach(() => {
  cleanup();
});

describe("AppShell AppShell helpers", () => {
  test("remoteTransferFileName handles platform separators", () => {
    expect(remoteTransferFileName("dist\\app.js")).toBe("app.js");
    expect(remoteTransferFileName("dist/app.js")).toBe("app.js");
    expect(remoteTransferFileName("")).toBe("upload.bin");
    expect(remoteTransferFileName("dist/")).toBe("upload.bin");
    expect(remoteTransferFileName("dist\\")).toBe("upload.bin");
  });

  test("SshTerminalSurface uses contract props and stopped session copy", async () => {
    const onActivate = mock<(sessionId: string) => void>(() => {});
    const onInput = mock<(sessionId: string, data: string) => void>(() => {});
    const onNewTerminal = mock(() => {});
    const onClose = mock<(sessionId: string) => void>(() => {});
    const state = {
      ...createRemoteState(),
      sshSessions: [
        {
          id: "ssh-1",
          host_id: "edge",
          workspace_id: "workspace-a",
          name: "edge",
          running: true,
        },
        {
          id: "ssh-2",
          host_id: "edge",
          workspace_id: "workspace-a",
          name: "worker",
          running: false,
        },
      ],
      activeSshSessionId: "ssh-2",
    };

    let renderResult!: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(
        <SshTerminalSurface
          state={state}
          output="boot"
          onActivate={onActivate}
          onInput={onInput}
          onNewTerminal={onNewTerminal}
          onClose={onClose}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const activeTab = renderResult.getByRole("tab", {
      name: "worker stopped",
    });
    expect(activeTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(renderResult.getByRole("tab", { name: "edge" }));
    expect(onActivate).toHaveBeenCalledWith("ssh-1");

    fireEvent.click(renderResult.getByRole("button", { name: "New SSH terminal" }));
    expect(onNewTerminal).toHaveBeenCalled();

    fireEvent.click(
      renderResult.getByRole("button", { name: "Close SSH terminal" }),
    );
    expect(onClose).toHaveBeenCalledWith("ssh-2");
  });

  test("knownWorkspaceIdForSshTerminal resolves unknown session by remote host id", () => {
    workspaceStore.getState().setRegistry({
      active_workspace_id: "workspace-b",
      workspaces: [
        {
          id: "workspace-a",
          path: "/repo-a",
          name: "workspace-a",
          pinned: false,
        },
        {
          id: "workspace-b",
          path: "/repo-b",
          name: "workspace-b",
          pinned: false,
        },
      ],
    });
    setRemote("workspace-a", (remote) => ({
      ...remote,
      hosts: [remoteHost({ id: "edge", workspace_root: "/repo-a" })],
    }));
    setRemote("workspace-b", (remote) => ({
      ...remote,
      hosts: [remoteHost({ id: "worker", workspace_root: "/repo-b" })],
    }));

    expect(knownWorkspaceIdForSshTerminal("edge:ssh-1")).toBe("workspace-a");
    expect(knownWorkspaceIdForSshTerminal("missing:ssh-1")).toBeNull();
  });

  test("knownWorkspaceIdForSshTerminal drops ambiguous remote host ids", () => {
    workspaceStore.getState().setRegistry({
      active_workspace_id: "ambiguous-workspace-b",
      workspaces: [
        {
          id: "ambiguous-workspace-a",
          path: "/repo-ambiguous-a",
          name: "ambiguous-workspace-a",
          pinned: false,
        },
        {
          id: "ambiguous-workspace-b",
          path: "/repo-ambiguous-b",
          name: "ambiguous-workspace-b",
          pinned: false,
        },
      ],
    });
    setRemote("ambiguous-workspace-a", (remote) => ({
      ...remote,
      hosts: [remoteHost({ id: "edge", workspace_root: "/repo-ambiguous-a" })],
    }));
    setRemote("ambiguous-workspace-b", (remote) => ({
      ...remote,
      hosts: [remoteHost({ id: "edge", workspace_root: "/repo-ambiguous-b" })],
    }));

    expect(knownWorkspaceIdForSshTerminal("edge:ssh-1")).toBeNull();
  });

  test("handleSshTerminalOutputEvent buffers unknown session by owning remote host", () => {
    workspaceStore.getState().setRegistry({
      active_workspace_id: "listener-workspace-b",
      workspaces: [
        {
          id: "listener-workspace-a",
          path: "/repo-listener-a",
          name: "listener-workspace-a",
          pinned: false,
        },
        {
          id: "listener-workspace-b",
          path: "/repo-listener-b",
          name: "listener-workspace-b",
          pinned: false,
        },
      ],
    });
    setRemote("listener-workspace-a", (remote) => ({
      ...remote,
      hosts: [remoteHost({ id: "edge", workspace_root: "/repo-listener-a" })],
    }));
    setRemote("listener-workspace-b", (remote) => ({
      ...remote,
      hosts: [remoteHost({ id: "worker", workspace_root: "/repo-listener-b" })],
    }));

    handleSshTerminalOutputEvent({
      session_id: "edge:ssh-1",
      chunk: "boot\n",
    });

    const ownerRemote = workspaceViewStore
      .getState()
      .viewFor("listener-workspace-a").remote;
    const activeRemote = workspaceViewStore
      .getState()
      .viewFor("listener-workspace-b").remote;
    expect(ownerRemote.pendingSshOutputBySessionId["edge:ssh-1"]).toBe("boot\n");
    expect(activeRemote.pendingSshOutputBySessionId["edge:ssh-1"]).toBeUndefined();
  });

  test("handleSshTerminalOutputEvent drops truly unknown sessions", () => {
    workspaceStore.getState().setRegistry({
      active_workspace_id: "unknown-output-workspace-b",
      workspaces: [
        {
          id: "unknown-output-workspace-a",
          path: "/repo-unknown-output-a",
          name: "unknown-output-workspace-a",
          pinned: false,
        },
        {
          id: "unknown-output-workspace-b",
          path: "/repo-unknown-output-b",
          name: "unknown-output-workspace-b",
          pinned: false,
        },
      ],
    });
    setRemote("unknown-output-workspace-a", (remote) => ({
      ...remote,
      hosts: [remoteHost({ id: "edge", workspace_root: "/repo-unknown-output-a" })],
    }));
    setRemote("unknown-output-workspace-b", (remote) => ({
      ...remote,
      hosts: [
        remoteHost({ id: "worker", workspace_root: "/repo-unknown-output-b" }),
      ],
    }));

    handleSshTerminalOutputEvent({
      session_id: "missing:ssh-1",
      chunk: "lost\n",
    });

    const activeRemote = workspaceViewStore
      .getState()
      .viewFor("unknown-output-workspace-b").remote;
    expect(
      activeRemote.pendingSshOutputBySessionId["missing:ssh-1"],
    ).toBeUndefined();
  });

  test("handleSshTerminalOutputEvent drops ambiguous remote host ids", () => {
    workspaceStore.getState().setRegistry({
      active_workspace_id: "ambiguous-output-workspace-b",
      workspaces: [
        {
          id: "ambiguous-output-workspace-a",
          path: "/repo-ambiguous-output-a",
          name: "ambiguous-output-workspace-a",
          pinned: false,
        },
        {
          id: "ambiguous-output-workspace-b",
          path: "/repo-ambiguous-output-b",
          name: "ambiguous-output-workspace-b",
          pinned: false,
        },
      ],
    });
    setRemote("ambiguous-output-workspace-a", (remote) => ({
      ...remote,
      hosts: [
        remoteHost({ id: "edge", workspace_root: "/repo-ambiguous-output-a" }),
      ],
    }));
    setRemote("ambiguous-output-workspace-b", (remote) => ({
      ...remote,
      hosts: [
        remoteHost({ id: "edge", workspace_root: "/repo-ambiguous-output-b" }),
      ],
    }));

    handleSshTerminalOutputEvent({
      session_id: "edge:ssh-1",
      chunk: "ambiguous\n",
    });

    const firstRemote = workspaceViewStore
      .getState()
      .viewFor("ambiguous-output-workspace-a").remote;
    const secondRemote = workspaceViewStore
      .getState()
      .viewFor("ambiguous-output-workspace-b").remote;
    expect(firstRemote.pendingSshOutputBySessionId["edge:ssh-1"]).toBeUndefined();
    expect(secondRemote.pendingSshOutputBySessionId["edge:ssh-1"]).toBeUndefined();
  });

  test("handleSshTerminalExitEvent buffers unknown session by owning remote host", () => {
    workspaceStore.getState().setRegistry({
      active_workspace_id: "exit-workspace-b",
      workspaces: [
        {
          id: "exit-workspace-a",
          path: "/repo-exit-a",
          name: "exit-workspace-a",
          pinned: false,
        },
        {
          id: "exit-workspace-b",
          path: "/repo-exit-b",
          name: "exit-workspace-b",
          pinned: false,
        },
      ],
    });
    setRemote("exit-workspace-a", (remote) => ({
      ...remote,
      hosts: [remoteHost({ id: "edge", workspace_root: "/repo-exit-a" })],
    }));
    setRemote("exit-workspace-b", (remote) => ({
      ...remote,
      hosts: [remoteHost({ id: "worker", workspace_root: "/repo-exit-b" })],
    }));

    handleSshTerminalExitEvent({ session_id: "edge:ssh-2" });

    const ownerRemote = workspaceViewStore
      .getState()
      .viewFor("exit-workspace-a").remote;
    const activeRemote = workspaceViewStore
      .getState()
      .viewFor("exit-workspace-b").remote;
    expect(ownerRemote.pendingSshExitBySessionId["edge:ssh-2"]).toBe(true);
    expect(activeRemote.pendingSshExitBySessionId["edge:ssh-2"]).toBeUndefined();
  });

  test("refreshRemoteHostsRequest clears loading on stale workspace path success", async () => {
    const workspaceId = "remote-stale-success";
    const workspaceRoot = "/repo-remote-success";
    const previousHost = remoteHost({
      id: "previous",
      workspace_root: workspaceRoot,
    });
    const nextHost = remoteHost({
      id: "next",
      workspace_root: workspaceRoot,
    });
    const deferredHosts = createDeferred<RemoteHostProfile[]>();

    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: workspaceRoot,
          name: workspaceId,
          pinned: false,
        },
      ],
    });
    setRemote(workspaceId, (remote) => ({
      ...remote,
      loading: false,
      error: "previous remote load error",
      hosts: [previousHost],
    }));

    const request = refreshRemoteHostsRequest({
      workspaceId,
      workspaceRoot,
      requestId: 1,
      hasRegisteredWorkspace: (currentWorkspaceId) =>
        workspaceStore.getState().registry.workspaces.some(
          (workspace) => workspace.id === currentWorkspaceId,
        ),
      getWorkspaceRoot: (currentWorkspaceId) =>
        workspaceStore.getState().registry.workspaces.find(
          (workspace) => workspace.id === currentWorkspaceId,
        )?.path ?? null,
      isLatestRemoteHostsRequest: () => true,
      updateRemote: setRemote,
      listRemoteHosts: () => deferredHosts.promise,
      listSshTerminalSessions: async () => [],
    });

    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: `${workspaceRoot}-switched`,
          name: workspaceId,
          pinned: false,
        },
      ],
    });
    deferredHosts.resolve([nextHost]);
    await request;

    const remote = workspaceViewStore.getState().viewFor(workspaceId).remote;
    expect(remote.loading).toBe(false);
    expect(remote.error).toBeNull();
    expect(remote.hosts).toEqual([previousHost]);
  });

  test("refreshRemoteHostsRequest clears stale errors on workspace path failure", async () => {
    const workspaceId = "remote-stale-failure";
    const workspaceRoot = "/repo-remote-failure";
    const previousHost = remoteHost({
      id: "previous",
      workspace_root: workspaceRoot,
    });
    const deferredHosts = createDeferred<RemoteHostProfile[]>();

    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: workspaceRoot,
          name: workspaceId,
          pinned: false,
        },
      ],
    });
    setRemote(workspaceId, (remote) => ({
      ...remote,
      loading: false,
      error: "previous remote load error",
      hosts: [previousHost],
    }));

    const request = refreshRemoteHostsRequest({
      workspaceId,
      workspaceRoot,
      requestId: 1,
      hasRegisteredWorkspace: (currentWorkspaceId) =>
        workspaceStore.getState().registry.workspaces.some(
          (workspace) => workspace.id === currentWorkspaceId,
        ),
      getWorkspaceRoot: (currentWorkspaceId) =>
        workspaceStore.getState().registry.workspaces.find(
          (workspace) => workspace.id === currentWorkspaceId,
        )?.path ?? null,
      isLatestRemoteHostsRequest: () => true,
      updateRemote: setRemote,
      listRemoteHosts: () => deferredHosts.promise,
      listSshTerminalSessions: async () => [],
    });

    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: `${workspaceRoot}-switched`,
          name: workspaceId,
          pinned: false,
        },
      ],
    });
    deferredHosts.reject(new Error("remote host list failed"));
    await request;

    const remote = workspaceViewStore.getState().viewFor(workspaceId).remote;
    expect(remote.loading).toBe(false);
    expect(remote.error).toBeNull();
    expect(remote.hosts).toEqual([previousHost]);
  });

  test("refreshRemoteHostsRequest preserves active ssh session when refreshed session still exists", async () => {
    const workspaceId = "remote-active-session";
    const workspaceRoot = "/repo-remote-active";
    const host = remoteHost({
      id: "edge",
      workspace_root: workspaceRoot,
    });
    const firstSession = {
      id: "edge:ssh-1",
      host_id: "edge",
      workspace_id: workspaceId,
      name: "edge",
      running: true,
    };
    const secondSession = {
      id: "edge:ssh-2",
      host_id: "edge",
      workspace_id: workspaceId,
      name: "edge 2",
      running: true,
    };

    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: workspaceRoot,
          name: workspaceId,
          pinned: false,
        },
      ],
    });
    setRemote(workspaceId, (remote) => ({
      ...remote,
      hosts: [host],
      sshSessions: [firstSession],
      activeSshSessionId: firstSession.id,
    }));

    await refreshRemoteHostsRequest({
      workspaceId,
      workspaceRoot,
      requestId: 1,
      hasRegisteredWorkspace: () => true,
      getWorkspaceRoot: () => workspaceRoot,
      isLatestRemoteHostsRequest: () => true,
      updateRemote: setRemote,
      listRemoteHosts: async () => [host],
      listSshTerminalSessions: async () => [firstSession, secondSession],
    });

    const remote = workspaceViewStore.getState().viewFor(workspaceId).remote;
    expect(remote.activeSshSessionId).toBe(firstSession.id);
    expect(remote.sshSessions.map((session) => session.id)).toEqual([
      firstSession.id,
      secondSession.id,
    ]);
  });

  test("PanelBody renders BrowserPanel for browser activity", () => {
    const onBrowserOpenTarget = mock<(url: string) => void>(() => {});
    const state = {
      ...createBrowserState(),
      activeUrl: "http://localhost:5173",
      urlInput: "http://localhost:5173",
      activeTitle: "localhost:5173",
      status: "ready" as const,
    };

    const renderResult = render(
      <PanelBody
        active="browser"
        refreshKey={0}
        activeFilePath="src/app/AppShell.tsx"
        terminalSessions={[]}
        activeTerminalId={null}
        terminalCwdInput=""
        terminalError={null}
        taskState={{
          detectedTasks: [],
          runs: [],
          activeRunId: null,
          outputByRunId: {},
          problemsByRunId: {},
          pendingOutputByRunId: {},
          pendingFinishByRunId: {},
          contextPackByRunId: {},
          customCommand: "",
        }}
        taskError={null}
        gitState={{
          status: null,
          loading: false,
          error: null,
          commitMessage: "",
          selectedDiff: null,
          diffByKey: {},
          branches: [],
          graph: [],
        }}
        docsState={createDocsState()}
        contextPackNameById={{}}
        gitDecorations={{}}
        agentState={createAgentState()}
        availableAgentContext={[]}
        onAgentModeChange={() => {}}
        onAgentPromptChange={() => {}}
        onAgentToggleContext={() => {}}
        onAgentStartSession={() => {}}
        onAgentSelectSession={() => {}}
        onAgentApprove={() => {}}
        onAgentReject={() => {}}
        onAgentExport={() => {}}
        onOpenFile={() => Promise.resolve()}
        onCreateFile={async () => {}}
        onRenamePath={async () => {}}
        onDeletePath={async () => {}}
        onTerminalCwdInputChange={() => {}}
        onNewTerminal={() => Promise.resolve()}
        onActivateTerminal={() => {}}
        onCloseTerminal={() => Promise.resolve()}
        onRestartTerminal={() => Promise.resolve()}
        onTaskCustomCommandChange={() => {}}
        onRunTask={() => {}}
        onRunCustomTask={() => {}}
        onActivateTaskRun={() => {}}
        onStopTaskRun={() => Promise.resolve()}
        onRerunTaskRun={() => {}}
        onGitRefresh={() => Promise.resolve()}
        onGitCommitMessageChange={() => {}}
        onGitCommit={() => {}}
        onGitStage={() => {}}
        onGitUnstage={() => {}}
        onGitDiscard={() => {}}
        onGitOpenDiff={() => {}}
        onGitStash={() => {}}
        onGitFetch={() => {}}
        onGitPull={() => {}}
        onGitPush={() => {}}
        onGitCheckoutBranch={() => {}}
        onGitCreateBranch={() => {}}
        onGitOpenGraph={() => {}}
        onDocsRefresh={() => Promise.resolve()}
        onDocsSearch={() => {}}
        onDocsOpenPreview={() => Promise.resolve()}
        onDocsToggleSource={() => {}}
        onDocsPackNameChange={() => {}}
        onDocsCreatePack={() => Promise.resolve()}
        onDocsSelectPack={() => {}}
        onDocsDeletePack={() => Promise.resolve()}
        onDocsUsePackForActiveTask={() => Promise.resolve()}
        onDocsLinkPackToAgentSession={() => Promise.resolve()}
        onLanguageOpenDiagnostic={() => {}}
        onLanguageRefresh={() => Promise.resolve()}
        onLanguageRestartServer={() => {}}
        browserState={state}
        browserTargets={[
          {
            id: "t1",
            label: "Frontend",
            url: "http://localhost:5173",
            source: "task-command",
          },
          {
            id: "t2",
            label: "Admin",
            url: "http://localhost:5173/admin",
            source: "running-task-output",
          },
        ]}
        browserCanCapture={true}
        onBrowserUrlInputChange={() => {}}
        onBrowserOpenUrl={() => {}}
        onBrowserOpenTarget={onBrowserOpenTarget}
        onBrowserReload={() => {}}
        onBrowserHardReload={() => {}}
        onBrowserCapture={() => {}}
        onBrowserSelectScreenshot={() => {}}
        databaseState={createDatabaseState()}
        onDatabaseRefreshProfiles={() => {}}
        onDatabaseSelectProfile={() => {}}
        onDatabaseInspectProfile={() => {}}
        onDatabaseOpenTable={() => {}}
        onDatabaseDraftChange={() => {}}
        onDatabaseRunQuery={() => {}}
        onDatabaseConfirmQuery={() => {}}
        onDatabaseCancelConfirmation={() => {}}
        onDatabaseExportResult={() => {}}
        onDatabaseSelectHistory={() => {}}
        languageState={createLanguageState()}
      />,
    );

    expect(
      renderResult.getByRole("button", { name: "Open browser preview" }),
    ).toBeTruthy();
    expect(
      renderResult.getByRole("button", {
        name: "Open Frontend at http://localhost:5173",
      }),
    ).toBeTruthy();
    fireEvent.click(
      renderResult.getByRole("button", {
        name: "Open Frontend at http://localhost:5173",
      }),
    );
    expect(onBrowserOpenTarget).toHaveBeenCalledWith("http://localhost:5173");
  });

  test("PanelBody renders recovery backups for settings activity", () => {
    const renderResult = render(
      <PanelBody
        {...panelBodyProps({
          active: "settings",
          recoveryState: {
            ...createRecoveryState(),
            backups: [
              {
                id: "b1",
                workspace_id: "workspace-a",
                workspace_root: "/repo-a",
                path: "src/main.ts",
                version: null,
                updated_ms: 10,
                content_length: "dirty text".length,
              },
            ],
            selectedBackupId: "b1",
          },
        })}
      />,
    );

    expect(renderResult.getByText("src/main.ts")).toBeTruthy();
  });

  test("PanelBody renders diagnostics from settings diagnostics category", () => {
    const renderResult = render(
      <PanelBody
        {...panelBodyProps({
          active: "settings",
          settingsState: selectSettingsCategory(
            createSettingsState(),
            "diagnostics",
          ),
          diagnosticsState: storeMetricSnapshot(createDiagnosticsState(), {
            timestamp_ms: 1,
            process_id: 42,
            memory_bytes: 104_857_600,
            uptime_ms: 120_000,
            workspace_count: 1,
            active_workspace_id: "workspace-a",
            docs_index_entries: 17,
            file_tree_entries: 0,
          }),
        })}
      />,
    );

    expect(renderResult.getAllByText("Diagnostics").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(renderResult.getByText("100.0 MB")).toBeTruthy();
  });

  test("PanelBody disables browser capture when capture is unavailable", () => {
    const renderResult = render(
      <PanelBody
        active="browser"
        refreshKey={0}
        activeFilePath="src/app/AppShell.tsx"
        terminalSessions={[]}
        activeTerminalId={null}
        terminalCwdInput=""
        terminalError={null}
        taskState={{
          detectedTasks: [],
          runs: [],
          activeRunId: null,
          outputByRunId: {},
          problemsByRunId: {},
          pendingOutputByRunId: {},
          pendingFinishByRunId: {},
          contextPackByRunId: {},
          customCommand: "",
        }}
        taskError={null}
        gitState={{
          status: null,
          loading: false,
          error: null,
          commitMessage: "",
          selectedDiff: null,
          diffByKey: {},
          branches: [],
          graph: [],
        }}
        docsState={createDocsState()}
        contextPackNameById={{}}
        gitDecorations={{}}
        agentState={createAgentState()}
        availableAgentContext={[]}
        onAgentModeChange={() => {}}
        onAgentPromptChange={() => {}}
        onAgentToggleContext={() => {}}
        onAgentStartSession={() => {}}
        onAgentSelectSession={() => {}}
        onAgentApprove={() => {}}
        onAgentReject={() => {}}
        onAgentExport={() => {}}
        onOpenFile={() => Promise.resolve()}
        onCreateFile={async () => {}}
        onRenamePath={async () => {}}
        onDeletePath={async () => {}}
        onTerminalCwdInputChange={() => {}}
        onNewTerminal={() => Promise.resolve()}
        onActivateTerminal={() => {}}
        onCloseTerminal={() => Promise.resolve()}
        onRestartTerminal={() => Promise.resolve()}
        onTaskCustomCommandChange={() => {}}
        onRunTask={() => {}}
        onRunCustomTask={() => {}}
        onActivateTaskRun={() => {}}
        onStopTaskRun={() => Promise.resolve()}
        onRerunTaskRun={() => {}}
        onGitRefresh={() => Promise.resolve()}
        onGitCommitMessageChange={() => {}}
        onGitCommit={() => {}}
        onGitStage={() => {}}
        onGitUnstage={() => {}}
        onGitDiscard={() => {}}
        onGitOpenDiff={() => {}}
        onGitStash={() => {}}
        onGitFetch={() => {}}
        onGitPull={() => {}}
        onGitPush={() => {}}
        onGitCheckoutBranch={() => {}}
        onGitCreateBranch={() => {}}
        onGitOpenGraph={() => {}}
        onDocsRefresh={() => Promise.resolve()}
        onDocsSearch={() => {}}
        onDocsOpenPreview={() => Promise.resolve()}
        onDocsToggleSource={() => {}}
        onDocsPackNameChange={() => {}}
        onDocsCreatePack={() => Promise.resolve()}
        onDocsSelectPack={() => {}}
        onDocsDeletePack={() => Promise.resolve()}
        onDocsUsePackForActiveTask={() => Promise.resolve()}
        onDocsLinkPackToAgentSession={() => Promise.resolve()}
        onLanguageOpenDiagnostic={() => {}}
        onLanguageRefresh={() => Promise.resolve()}
        onLanguageRestartServer={() => {}}
        browserState={{
          ...createBrowserState(),
          activeUrl: "http://localhost:5173",
          activeTitle: "localhost:5173",
          status: "ready",
        }}
        browserTargets={[]}
        browserCanCapture={false}
        onBrowserUrlInputChange={() => {}}
        onBrowserOpenUrl={() => {}}
        onBrowserOpenTarget={() => {}}
        onBrowserReload={() => {}}
        onBrowserHardReload={() => {}}
        onBrowserCapture={() => {}}
        onBrowserSelectScreenshot={() => {}}
        databaseState={createDatabaseState()}
        onDatabaseRefreshProfiles={() => {}}
        onDatabaseSelectProfile={() => {}}
        onDatabaseInspectProfile={() => {}}
        onDatabaseOpenTable={() => {}}
        onDatabaseDraftChange={() => {}}
        onDatabaseRunQuery={() => {}}
        onDatabaseConfirmQuery={() => {}}
        onDatabaseCancelConfirmation={() => {}}
        onDatabaseExportResult={() => {}}
        onDatabaseSelectHistory={() => {}}
        languageState={createLanguageState()}
      />,
    );

    expect(
      (renderResult.getByRole("button", {
        name: "Capture browser screenshot",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("Browser split editor visibility remains enabled in browser-preview", () => {
    const loadedFile = {
      workspaceId: "workspace-1",
      path: "src/app/AppShell.tsx",
      content: "export const app = true;",
      language: "typescript",
      readOnly: false,
    };

    expect(
      shouldShowBrowserSplitEditor({
        surface: "browser-preview",
        activeWorkspaceId: "workspace-1",
        activePath: "src/app/AppShell.tsx",
        loadedFile,
      }),
    ).toBe(true);
  });

  test("Browser split layout renders editor and preview together", () => {
    const renderResult = render(
      <BrowserPreviewSplitSurface
        showEditor={true}
        editor={<div data-testid="browser-editor-panel">Editor</div>}
        preview={<div data-testid="browser-preview-panel">Preview</div>}
      />,
    );

    expect(renderResult.getByTestId("browser-editor-panel")).toBeTruthy();
    expect(renderResult.getByTestId("browser-preview-panel")).toBeTruthy();
    expect(
      renderResult.container.querySelector(".browser-split.has-editor"),
    ).toBeTruthy();
  });

  test("Browser split layout keeps preview only without editor", () => {
    const renderResult = render(
      <BrowserPreviewSplitSurface
        showEditor={false}
        editor={<div data-testid="browser-editor-panel">Editor</div>}
        preview={<div data-testid="browser-preview-panel">Preview</div>}
      />,
    );

    expect(renderResult.queryByTestId("browser-editor-panel")).toBeNull();
    expect(renderResult.getByTestId("browser-preview-panel")).toBeTruthy();
    expect(
      renderResult.container.querySelector(".browser-split.has-editor"),
    ).toBeNull();
  });

  test("PanelBody renders DebugPanel and routes debug callbacks", () => {
    const onDebugStartSession = mock(() => {});
    const onDebugModeChange = mock<(mode: DebugViewState["mode"]) => void>(() => {});
    const debugState = replaceDebugLaunchConfigs(createDebugState(), [
      debugLaunchConfig(),
    ]);

    const renderResult = render(
      <PanelBody
        {...panelBodyProps({
          active: "debug",
          debugState,
          onDebugStartSession,
          onDebugModeChange,
        })}
      />,
    );

    expect(renderResult.getByText("Debug")).toBeTruthy();
    fireEvent.click(renderResult.getByLabelText("Start debug session"));
    expect(onDebugStartSession).toHaveBeenCalledTimes(1);
    fireEvent.click(renderResult.getByRole("button", { name: "Breakpoints" }));
    expect(onDebugModeChange).toHaveBeenCalledWith("breakpoints");
  });

  test("activeDebugSessionForState does not fall back to the first session", () => {
    const withoutActive = {
      ...createDebugState(),
      sessions: [debugSession({ id: "session-first" })],
      activeSessionId: null,
    };
    const withActive = {
      ...withoutActive,
      sessions: [
        debugSession({ id: "session-first" }),
        debugSession({ id: "session-active" }),
      ],
      activeSessionId: "session-active",
    };

    expect(activeDebugSessionForState(withoutActive)).toBeNull();
    expect(activeDebugSessionForState(withActive)?.id).toBe("session-active");
  });

  test("activeDebugLineForFile uses only the selected session stack", () => {
    const state = setDebugStack(
      {
        ...createDebugState(),
        sessions: [
          debugSession({ id: "session-first" }),
          debugSession({ id: "session-active" }),
        ],
        activeSessionId: "session-active",
      },
      "session-active",
      [
        {
          id: 1,
          name: "main",
          source_path: "src/app/AppShell.tsx",
          line: 42,
          column: 1,
        },
      ],
    );

    expect(activeDebugLineForFile(state, "src/app/AppShell.tsx")).toBe(42);
    expect(activeDebugLineForFile(state, "src/other.ts")).toBeNull();
    expect(
      activeDebugLineForFile({ ...state, activeSessionId: null }, "src/app/AppShell.tsx"),
    ).toBeNull();
  });

  test("handleDebugSessionEvent updates only registered matching workspaces by sequence", () => {
    workspaceStore.getState().setRegistry({
      active_workspace_id: "debug-workspace-a",
      workspaces: [
        {
          id: "debug-workspace-a",
          path: "/repo-a",
          name: "debug-workspace-a",
          pinned: false,
        },
        {
          id: "debug-workspace-b",
          path: "/repo-b",
          name: "debug-workspace-b",
          pinned: false,
        },
      ],
    });

    handleDebugSessionEvent({
      session_id: "session-a",
      workspace_id: "debug-workspace-a",
      workspace_root: "/repo-a",
      sequence: 5,
      status: "Stopped",
      reason: "breakpoint",
    });
    handleDebugSessionEvent({
      session_id: "session-a",
      workspace_id: "debug-workspace-a",
      workspace_root: "/repo-a",
      sequence: 4,
      status: "Running",
      reason: null,
    });
    handleDebugSessionEvent({
      session_id: "session-wrong-root",
      workspace_id: "debug-workspace-a",
      workspace_root: "/repo-b",
      sequence: 1,
      status: "Running",
      reason: null,
    });

    const debug = workspaceViewStore
      .getState()
      .viewFor("debug-workspace-a").debug;
    expect(debug.sessions).toHaveLength(1);
    expect(debug.sessions[0]).toMatchObject({
      id: "session-a",
      status: "Stopped",
      sequence: 5,
    });
    expect(debug.sessionSequenceById["session-a"]).toBe(5);
  });

  test("handleDebugConsoleEvent appends output only to the matching active session", () => {
    workspaceStore.getState().setRegistry({
      active_workspace_id: "debug-console-workspace-a",
      workspaces: [
        {
          id: "debug-console-workspace-a",
          path: "/repo-a",
          name: "debug-console-workspace-a",
          pinned: false,
        },
        {
          id: "debug-console-workspace-b",
          path: "/repo-b",
          name: "debug-console-workspace-b",
          pinned: false,
        },
      ],
    });
    workspaceViewStore.getState().updateDebug("debug-console-workspace-a", () => ({
      ...createDebugState(),
      sessions: [
        debugSession({
          id: "session-a",
          workspace_id: "debug-console-workspace-a",
          workspace_root: "/repo-a",
        }),
        debugSession({
          id: "session-inactive",
          workspace_id: "debug-console-workspace-a",
          workspace_root: "/repo-a",
        }),
      ],
      activeSessionId: "session-a",
    }));
    workspaceViewStore.getState().updateDebug("debug-console-workspace-b", () => ({
      ...createDebugState(),
      sessions: [
        debugSession({
          id: "session-b",
          workspace_id: "debug-console-workspace-b",
          workspace_root: "/repo-b",
        }),
      ],
      activeSessionId: "session-b",
    }));

    handleDebugConsoleEvent({
      session_id: "session-a",
      workspace_id: "debug-console-workspace-a",
      workspace_root: "/repo-a",
      sequence: 1,
      chunk: "active\n",
    });
    handleDebugConsoleEvent({
      session_id: "session-inactive",
      workspace_id: "debug-console-workspace-a",
      workspace_root: "/repo-a",
      sequence: 1,
      chunk: "inactive\n",
    });
    handleDebugConsoleEvent({
      session_id: "session-b",
      workspace_id: "debug-console-workspace-b",
      workspace_root: "/repo-b",
      sequence: 1,
      chunk: "other workspace\n",
    });

    const firstDebug = workspaceViewStore
      .getState()
      .viewFor("debug-console-workspace-a").debug;
    const secondDebug = workspaceViewStore
      .getState()
      .viewFor("debug-console-workspace-b").debug;
    expect(firstDebug.consoleBySessionId["session-a"]).toBe("active\n");
    expect(firstDebug.consoleBySessionId["session-inactive"]).toBeUndefined();
    expect(secondDebug.consoleBySessionId["session-b"]).toBe("other workspace\n");
  });

  test("runDebugCommandFromPalette dispatches debug commands without session fallback", () => {
    const calls: string[] = [];
    const debugState = setDebugStack(
      {
        ...createDebugState(),
        sessions: [
          debugSession({ id: "session-first" }),
          debugSession({ id: "session-active" }),
        ],
        activeSessionId: "session-active",
      },
      "session-active",
      [
        {
          id: 1,
          name: "main",
          source_path: "src/app/AppShell.tsx",
          line: 12,
          column: 1,
        },
      ],
    );

    const context = {
      debugState,
      activeFilePath: "src/app/AppShell.tsx",
      onOpenDebug: () => calls.push("open"),
      onStartSession: () => calls.push("start"),
      onContinue: (sessionId: string) => calls.push(`continue:${sessionId}`),
      onStepOver: (sessionId: string) => calls.push(`step:${sessionId}`),
      onPause: (sessionId: string) => calls.push(`pause:${sessionId}`),
      onDisconnect: (sessionId: string) => calls.push(`disconnect:${sessionId}`),
      onToggleBreakpoint: (sourcePath: string, line: number) =>
        calls.push(`breakpoint:${sourcePath}:${line}`),
    };

    expect(runDebugCommandFromPalette("open-debug", context)).toBe(true);
    expect(runDebugCommandFromPalette("debug-start-session", context)).toBe(true);
    expect(runDebugCommandFromPalette("debug-continue", context)).toBe(true);
    expect(runDebugCommandFromPalette("debug-step-over", context)).toBe(true);
    expect(runDebugCommandFromPalette("debug-pause", context)).toBe(true);
    expect(runDebugCommandFromPalette("debug-disconnect", context)).toBe(true);
    expect(runDebugCommandFromPalette("debug-toggle-breakpoint", context)).toBe(
      true,
    );
    expect(calls).toEqual([
      "open",
      "start",
      "continue:session-active",
      "step:session-active",
      "pause:session-active",
      "disconnect:session-active",
      "breakpoint:src/app/AppShell.tsx:12",
    ]);

    const withoutActiveCalls: string[] = [];
    expect(
      runDebugCommandFromPalette("debug-continue", {
        ...context,
        debugState: { ...debugState, activeSessionId: null },
        onContinue: (sessionId) => withoutActiveCalls.push(sessionId),
      }),
    ).toBe(true);
    expect(withoutActiveCalls).toEqual([]);
    expect(runDebugCommandFromPalette("unknown", context)).toBe(false);
  });

  test("AppShell debug refresh keeps null active session after backend snapshots", async () => {
    const workspaceId = "debug-refresh-null";
    const workspaceRoot = "/repo-debug-refresh-null";
    const session = debugSession({
      id: "session-from-refresh",
      workspace_id: workspaceId,
      workspace_root: workspaceRoot,
    });

    await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      debugSessions: [session],
      initialActiveSessionId: null,
    });

    const debug = workspaceViewStore.getState().viewFor(workspaceId).debug;
    expect(debug.sessions.map((item) => item.id)).toContain("session-from-refresh");
    expect(debug.activeSessionId).toBeNull();
  });

  test("AppShell debug refresh clears stale active session instead of selecting first snapshot", async () => {
    const workspaceId = "debug-refresh-stale";
    const workspaceRoot = "/repo-debug-refresh-stale";
    const session = debugSession({
      id: "session-first-snapshot",
      workspace_id: workspaceId,
      workspace_root: workspaceRoot,
    });

    await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      debugSessions: [session],
      initialActiveSessionId: "missing-session",
    });

    const debug = workspaceViewStore.getState().viewFor(workspaceId).debug;
    expect(debug.sessions.map((item) => item.id)).toContain("session-first-snapshot");
    expect(debug.activeSessionId).toBeNull();
  });

  test("AppShell debug refresh preserves listener-active session missing from stale snapshot", () => {
    const workspaceId = "debug-refresh-listener-race";
    const workspaceRoot = "/repo-debug-refresh-listener-race";
    const config = debugLaunchConfig({ workspace_root: workspaceRoot });
    const listenerSession = debugSession({
      id: "session-listener-active",
      workspace_id: workspaceId,
      workspace_root: workspaceRoot,
      sequence: 7,
    });
    const state = {
      ...replaceDebugLaunchConfigs(createDebugState(), [config]),
      sessions: [listenerSession],
      activeSessionId: listenerSession.id,
      sessionSequenceById: { [listenerSession.id]: listenerSession.sequence },
    };

    const refreshed = applyDebugRefreshSnapshot(state, [config], []);

    expect(refreshed.sessions.map((session) => session.id)).toContain(
      listenerSession.id,
    );
    expect(refreshed.activeSessionId).toBe(listenerSession.id);
  });

  test("AppShell debug rail opens the Debug panel", async () => {
    const workspaceId = "debug-rail-contract";
    const workspaceRoot = "/repo-debug-rail-contract";
    const { renderResult } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
    });

    fireEvent.click(renderResult.getByRole("button", { name: "Debug" }));

    const view = workspaceViewStore.getState().viewFor(workspaceId);
    expect(view.activeActivity).toBe("debug");
    expect(view.panelOpen).toBe(true);
    expect(renderResult.getByLabelText("Start debug session")).toBeTruthy();
  });

  test("AppShell command palette open-debug switches to the Debug activity", async () => {
    const workspaceId = "debug-palette-open";
    const workspaceRoot = "/repo-debug-palette-open";
    const { renderResult } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
    });

    fireEvent.click(
      renderResult.getByRole("button", { name: /Search or run a command/ }),
    );
    fireEvent.click(
      renderResult.getByRole("button", { name: /Debug: Open panel/ }),
    );

    const view = workspaceViewStore.getState().viewFor(workspaceId);
    expect(view.activeActivity).toBe("debug");
    expect(view.panelOpen).toBe(true);
    expect(renderResult.getByLabelText("Start debug session")).toBeTruthy();
  });

  test("AppShell command palette opens and refreshes diagnostics metrics", async () => {
    const workspaceId = "diagnostics-palette-open";
    const workspaceRoot = "/repo-diagnostics-palette-open";
    const metricSnapshot: AppMetricSnapshot = {
      timestamp_ms: 1,
      process_id: 42,
      memory_bytes: 104_857_600,
      uptime_ms: 120_000,
      workspace_count: 1,
      active_workspace_id: workspaceId,
      docs_index_entries: 17,
      file_tree_entries: 0,
    };
    const { renderResult, tauri } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      metricSnapshot,
      diagnosticEvents: [
        {
          id: "event-1",
          timestamp_ms: 1,
          level: "info",
          source: "app",
          message: "Diagnostics refreshed",
        },
      ],
    });

    fireEvent.click(
      renderResult.getByRole("button", { name: /Search or run a command/ }),
    );
    fireEvent.click(
      renderResult.getByRole("button", { name: /Diagnostics: Open panel/ }),
    );
    await flushAppShellEffects();

    let view = workspaceViewStore.getState().viewFor(workspaceId);
    expect(view.activeActivity).toBe("settings");
    expect(view.settings.activeCategory).toBe("diagnostics");
    expect(view.panelOpen).toBe(true);
    expect(renderResult.getByText("mem 100.0 MB")).toBeTruthy();
    expect(renderResult.getByText("docs 17")).toBeTruthy();
    expect(
      tauri.invokeCalls.some(
        (call) =>
          call.command === "metric_snapshot" &&
          call.args.activeWorkspaceId === workspaceId &&
          call.args.docsIndexEntries === 0 &&
          call.args.fileTreeEntries === 0,
      ),
    ).toBe(true);
    const firstMetricCount = tauri.invokeCalls.filter(
      (call) => call.command === "metric_snapshot",
    ).length;

    fireEvent.click(
      renderResult.getByRole("button", { name: /Search or run a command/ }),
    );
    fireEvent.click(
      renderResult.getByRole("button", {
        name: /Diagnostics: Refresh metrics/,
      }),
    );
    await flushAppShellEffects();

    view = workspaceViewStore.getState().viewFor(workspaceId);
    expect(view.settings.activeCategory).toBe("diagnostics");
    expect(
      tauri.invokeCalls.filter((call) => call.command === "metric_snapshot")
        .length,
    ).toBeGreaterThan(firstMetricCount);
    expect(
      tauri.invokeCalls.some(
        (call) =>
          call.command === "list_diagnostic_events" && call.args.limit === 50,
      ),
    ).toBe(true);
  });

  test("AppShell loads settings per workspace and ignores stale switch responses", async () => {
    const workspaceA = "settings-load-a";
    const workspaceB = "settings-load-b";
    const workspaceRootA = "/repo-settings-load-a";
    const workspaceRootB = "/repo-settings-load-b";
    const firstSettingsLoad = createDeferred<AppSettingsInput>();
    const secondSettingsLoad = createDeferred<AppSettingsInput>();
    const tauri = installAppShellTauriMock({
      workspaceId: workspaceA,
      workspaceRoot: workspaceRootA,
      settingsResponses: [firstSettingsLoad.promise, secondSettingsLoad.promise],
    });
    resetWorkspaceBootstrapForTests();
    window.localStorage.clear();
    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceA,
      workspaces: [
        {
          id: workspaceA,
          path: workspaceRootA,
          name: workspaceA,
          pinned: false,
        },
        {
          id: workspaceB,
          path: workspaceRootB,
          name: workspaceB,
          pinned: false,
        },
      ],
    });

    await act(async () => {
      render(<AppShell />);
    });
    await flushAppShellEffects();

    expect(
      tauri.invokeCalls.filter((call) => call.command === "load_settings"),
    ).toHaveLength(1);

    await act(async () => {
      workspaceStore.getState().setRegistry({
        active_workspace_id: workspaceB,
        workspaces: [
          {
            id: workspaceA,
            path: workspaceRootA,
            name: workspaceA,
            pinned: false,
          },
          {
            id: workspaceB,
            path: workspaceRootB,
            name: workspaceB,
            pinned: false,
          },
        ],
      });
    });
    await flushAppShellEffects();

    expect(
      tauri.invokeCalls.filter((call) => call.command === "load_settings"),
    ).toHaveLength(2);

    secondSettingsLoad.resolve({
      schema_version: 2,
      density: "comfortable",
      color_theme: "light",
      accent_color: "yuzu",
      update_channel: "manual",
      keybindings: [],
    });
    await flushAppShellEffects();

    expect(
      workspaceViewStore.getState().viewFor(workspaceB).settings.settings
        ?.density,
    ).toBe("comfortable");

    firstSettingsLoad.resolve({
      schema_version: 2,
      density: "compact",
      color_theme: "dark",
      accent_color: "yuzu",
      update_channel: "manual",
      keybindings: [],
    });
    await flushAppShellEffects();

    expect(
      workspaceViewStore.getState().viewFor(workspaceB).settings.settings
        ?.density,
    ).toBe("comfortable");
  });

  test("AppShell imports keybindings and stores returned settings", async () => {
    const workspaceId = "settings-import-keybindings";
    const workspaceRoot = "/repo-settings-import-keybindings";
    const tauri = installAppShellTauriMock({
      workspaceId,
      workspaceRoot,
      settings: {
        schema_version: 2,
        density: "compact",
        color_theme: "dark",
        accent_color: "yuzu",
        update_channel: "manual",
        keybindings: [],
      },
    });
    resetWorkspaceBootstrapForTests();
    window.localStorage.clear();
    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: workspaceRoot,
          name: workspaceId,
          pinned: false,
        },
      ],
    });

    let renderResult: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(<AppShell />);
    });
    await flushAppShellEffects();

    fireEvent.click(
      renderResult!.getByRole("button", { name: /Search or run a command/ }),
    );
    fireEvent.click(
      renderResult!.getByRole("button", { name: /Keybindings: Import/ }),
    );
    fireEvent.input(renderResult!.getByLabelText("Paste keybindings JSON"), {
      target: {
        value:
          '[{"key":"cmd+s","command":"workbench.action.files.save"}]',
      },
    });
    fireEvent.click(
      renderResult!.getByRole("button", { name: "Import keybindings" }),
    );
    await flushAppShellEffects();

    expect(
      tauri.invokeCalls.some(
        (call) =>
          call.command === "import_keybindings" &&
          call.args.source === "vscode" &&
          call.args.content ===
            '[{"key":"cmd+s","command":"workbench.action.files.save"}]',
      ),
    ).toBe(true);
    expect(
      workspaceViewStore.getState().viewFor(workspaceId).settings.settings
        ?.keybindings,
    ).toEqual([
      {
        command_id: "save-file",
        key: "cmd+s",
        source: "vscode",
      },
    ]);
    expect(
      workspaceViewStore.getState().viewFor(workspaceId).settings
        .keybindingImportDraft,
    ).toBe("");
    expect(
      workspaceViewStore.getState().viewFor(workspaceId).settings
      .keybindingImportError,
    ).toBeNull();
  });

  test("AppShell shows scoped keybinding import errors without replacing settings error", async () => {
    const workspaceId = "settings-import-keybindings-error";
    const workspaceRoot = "/repo-settings-import-keybindings-error";
    installAppShellTauriMock({
      workspaceId,
      workspaceRoot,
      importKeybindingsError: "Invalid VS Code keybindings JSON",
    });
    resetWorkspaceBootstrapForTests();
    window.localStorage.clear();
    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: workspaceRoot,
          name: workspaceId,
          pinned: false,
        },
      ],
    });

    let renderResult: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(<AppShell />);
    });
    await flushAppShellEffects();
    await act(async () => {
      workspaceViewStore.getState().updateSettings(workspaceId, (settings) => ({
        ...settings,
        error: "Settings load failed",
      }));
    });
    await flushAppShellEffects();

    fireEvent.click(
      renderResult!.getByRole("button", { name: /Search or run a command/ }),
    );
    fireEvent.click(
      renderResult!.getByRole("button", { name: /Keybindings: Import/ }),
    );
    fireEvent.input(renderResult!.getByLabelText("Paste keybindings JSON"), {
      target: { value: "not json" },
    });
    fireEvent.click(
      renderResult!.getByRole("button", { name: "Import keybindings" }),
    );
    await flushAppShellEffects();

    const settingsState = workspaceViewStore
      .getState()
      .viewFor(workspaceId).settings;
    expect(settingsState.error).toBe("Settings load failed");
    expect(settingsState.keybindingImportError).toBe(
      "Invalid VS Code keybindings JSON",
    );
  });

  test("AppShell ignores stale keybinding import failures after newer success", async () => {
    const workspaceId = "settings-import-keybindings-stale";
    const workspaceRoot = "/repo-settings-import-keybindings-stale";
    const olderImport = createDeferred<AppSettingsInput>();
    const newerImport = createDeferred<AppSettingsInput>();
    installAppShellTauriMock({
      workspaceId,
      workspaceRoot,
      importKeybindingsResponses: [olderImport.promise, newerImport.promise],
    });
    resetWorkspaceBootstrapForTests();
    window.localStorage.clear();
    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: workspaceRoot,
          name: workspaceId,
          pinned: false,
        },
      ],
    });

    let renderResult: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(<AppShell />);
    });
    await flushAppShellEffects();

    fireEvent.click(
      renderResult!.getByRole("button", { name: /Search or run a command/ }),
    );
    fireEvent.click(
      renderResult!.getByRole("button", { name: /Keybindings: Import/ }),
    );
    fireEvent.input(renderResult!.getByLabelText("Paste keybindings JSON"), {
      target: {
        value:
          '[{"key":"cmd+s","command":"workbench.action.files.save"}]',
      },
    });
    fireEvent.click(
      renderResult!.getByRole("button", { name: "Import keybindings" }),
    );
    fireEvent.input(renderResult!.getByLabelText("Paste keybindings JSON"), {
      target: {
        value:
          '[{"key":"ctrl+`","command":"workbench.action.terminal.new"}]',
      },
    });
    fireEvent.click(
      renderResult!.getByRole("button", { name: "Import keybindings" }),
    );
    await flushAppShellEffects();

    newerImport.resolve({
      schema_version: 2,
      density: "compact",
      color_theme: "dark",
      accent_color: "yuzu",
      update_channel: "manual",
      keybindings: [
        {
          command_id: "new-terminal",
          key: "ctrl+`",
          source: "vscode",
        },
      ],
    });
    await flushAppShellEffects();

    olderImport.reject(new Error("Older import failed"));
    await flushAppShellEffects();

    const settingsState = workspaceViewStore
      .getState()
      .viewFor(workspaceId).settings;
    expect(settingsState.settings?.keybindings).toEqual([
      {
        command_id: "new-terminal",
        key: "ctrl+`",
        source: "vscode",
      },
    ]);
    expect(settingsState.keybindingImportError).toBeNull();
  });

  test("AppShell ignores stale diagnostics refresh responses", async () => {
    const workspaceId = "diagnostics-stale-refresh";
    const workspaceRoot = "/repo-diagnostics-stale-refresh";
    const olderMetric = createDeferred<AppMetricSnapshot>();
    const newerMetric = createDeferred<AppMetricSnapshot>();
    const olderEvents = createDeferred<DiagnosticEvent[]>();
    const newerEvents = createDeferred<DiagnosticEvent[]>();
    const tauri = installAppShellTauriMock({
      workspaceId,
      workspaceRoot,
      metricSnapshotResponses: [olderMetric.promise, newerMetric.promise],
      diagnosticEventsResponses: [olderEvents.promise, newerEvents.promise],
    });
    resetWorkspaceBootstrapForTests();
    window.localStorage.clear();
    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: workspaceRoot,
          name: workspaceId,
          pinned: false,
        },
      ],
    });
    workspaceViewStore.getState().updateView(workspaceId, {
      activeActivity: "settings",
      panelOpen: true,
      surface: "empty",
    });
    workspaceViewStore.getState().updateSettings(workspaceId, (settings) =>
      selectSettingsCategory(settings, "diagnostics"),
    );

    let renderResult!: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(<AppShell />);
    });
    await flushAppShellEffects();

    expect(
      tauri.invokeCalls.filter((call) => call.command === "metric_snapshot"),
    ).toHaveLength(1);

    fireEvent.click(renderResult.getByRole("button", { name: "Performance" }));
    await flushAppShellEffects();

    expect(
      tauri.invokeCalls.filter((call) => call.command === "metric_snapshot"),
    ).toHaveLength(2);

    newerMetric.resolve({
      timestamp_ms: 2,
      process_id: 200,
      memory_bytes: 209_715_200,
      uptime_ms: 240_000,
      workspace_count: 1,
      active_workspace_id: workspaceId,
      docs_index_entries: 20,
      file_tree_entries: 0,
    });
    newerEvents.resolve([
      {
        id: "newer-event",
        timestamp_ms: 2,
        level: "info",
        source: "frontend",
        message: "newer diagnostics",
      },
    ]);
    await flushAppShellEffects();

    expect(
      workspaceViewStore.getState().viewFor(workspaceId).diagnostics.metric
        ?.process_id,
    ).toBe(200);
    expect(
      workspaceViewStore.getState().viewFor(workspaceId).diagnostics.events[0]
        ?.message,
    ).toBe("newer diagnostics");

    olderMetric.resolve({
      timestamp_ms: 1,
      process_id: 100,
      memory_bytes: 104_857_600,
      uptime_ms: 120_000,
      workspace_count: 1,
      active_workspace_id: workspaceId,
      docs_index_entries: 10,
      file_tree_entries: 0,
    });
    olderEvents.resolve([
      {
        id: "older-event",
        timestamp_ms: 1,
        level: "info",
        source: "frontend",
        message: "older diagnostics",
      },
    ]);
    await flushAppShellEffects();

    expect(
      workspaceViewStore.getState().viewFor(workspaceId).diagnostics.metric
        ?.process_id,
    ).toBe(200);
    expect(
      workspaceViewStore.getState().viewFor(workspaceId).diagnostics.events[0]
        ?.message,
    ).toBe("newer diagnostics");
    expect(renderResult.getByText("mem 200.0 MB")).toBeTruthy();
  });

  test("AppShell command palette opens recovery and keybinding settings categories", async () => {
    const workspaceId = "settings-node13-palette";
    const workspaceRoot = "/repo-settings-node13-palette";
    const { renderResult } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
    });

    fireEvent.click(
      renderResult.getByRole("button", { name: /Search or run a command/ }),
    );
    fireEvent.click(
      renderResult.getByRole("button", { name: /Recovery: Open backups/ }),
    );
    await flushAppShellEffects();

    expect(workspaceViewStore.getState().viewFor(workspaceId).activeActivity).toBe(
      "settings",
    );
    expect(
      workspaceViewStore.getState().viewFor(workspaceId).settings.activeCategory,
    ).toBe("recovery");

    fireEvent.click(
      renderResult.getByRole("button", { name: /Search or run a command/ }),
    );
    fireEvent.click(
      renderResult.getByRole("button", { name: /Keybindings: Import/ }),
    );
    await flushAppShellEffects();

    expect(
      workspaceViewStore.getState().viewFor(workspaceId).settings.activeCategory,
    ).toBe("keybindings");
    expect(renderResult.getByText("VS Code JSON")).toBeTruthy();
  });

  test("AppShell saves a native recovery backup when loaded editor content changes", async () => {
    const workspaceId = "recovery-edit-contract";
    const workspaceRoot = "/repo-recovery-edit-contract";
    const fileVersion = { modified_ms: 7, len: 10 };
    const tauri = installAppShellTauriMock({
      workspaceId,
      workspaceRoot,
      textFiles: {
        "src/main.ts": {
          path: "src/main.ts",
          content: "saved text",
          version: fileVersion,
          too_large: false,
        },
      },
    });
    resetWorkspaceBootstrapForTests();
    window.localStorage.clear();
    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: workspaceRoot,
          name: workspaceId,
          pinned: false,
        },
      ],
    });
    workspaceViewStore.getState().updateView(workspaceId, {
      activeActivity: "explorer",
      panelOpen: true,
      surface: "editor",
    });
    workspaceViewStore.getState().updateEditor(workspaceId, () => ({
      tabs: [
        {
          path: "src/main.ts",
          name: "main.ts",
          dirty: false,
          tooLarge: false,
          version: fileVersion,
          externalChange: false,
        },
      ],
      activePath: "src/main.ts",
    }));

    let renderResult!: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(<AppShell />);
    });
    const editor = await renderResult.findByLabelText("Mock editor");

    await act(async () => {
      fireEvent.change(editor, { target: { value: "dirty text" } });
    });
    await flushAppShellEffects();

    const backupCall = tauri.invokeCalls.find(
      (call) => call.command === "save_unsaved_backup",
    );
    expect(backupCall?.args).toEqual({
      workspaceRoot,
      workspaceId,
      path: "src/main.ts",
      content: "dirty text",
      version: fileVersion,
    });
  });

  test("AppShell ignores stale recovery save responses after content is clean", async () => {
    const workspaceId = "recovery-race-contract";
    const workspaceRoot = "/repo-recovery-race-contract";
    const fileVersion = { modified_ms: 7, len: 10 };
    const backupId = "b1";
    const staleSave = createDeferred<UnsavedBackup>();
    const tauri = installAppShellTauriMock({
      workspaceId,
      workspaceRoot,
      textFiles: {
        "src/main.ts": {
          path: "src/main.ts",
          content: "saved text",
          version: fileVersion,
          too_large: false,
        },
      },
      recoveryBackups: [
        {
          id: backupId,
          workspace_id: workspaceId,
          workspace_root: workspaceRoot,
          path: "src/main.ts",
          content: "old dirty text",
          version: fileVersion,
          updated_ms: 10,
        },
      ],
      saveUnsavedBackupResponses: [staleSave.promise],
    });
    resetWorkspaceBootstrapForTests();
    window.localStorage.clear();
    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: workspaceRoot,
          name: workspaceId,
          pinned: false,
        },
      ],
    });
    workspaceViewStore.getState().updateView(workspaceId, {
      activeActivity: "settings",
      panelOpen: true,
      surface: "editor",
    });
    workspaceViewStore.getState().updateEditor(workspaceId, () => ({
      tabs: [
        {
          path: "src/main.ts",
          name: "main.ts",
          dirty: false,
          tooLarge: false,
          version: fileVersion,
          externalChange: false,
        },
      ],
      activePath: "src/main.ts",
    }));

    let renderResult!: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(<AppShell />);
    });
    const editor = await renderResult.findByLabelText("Mock editor");
    await flushAppShellEffects();
    expect(
      renderResult.getByRole("button", { name: "Restore src/main.ts" }),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.change(editor, { target: { value: "dirty text" } });
    });
    await flushAppShellEffects();
    expect(
      tauri.invokeCalls.some((call) => call.command === "save_unsaved_backup"),
    ).toBe(true);

    await act(async () => {
      fireEvent.change(editor, { target: { value: "saved text" } });
    });
    await flushAppShellEffects();
    expect(
      tauri.invokeCalls.some(
        (call) =>
          call.command === "discard_unsaved_backup" &&
          call.args.backupId === backupId,
      ),
    ).toBe(true);
    expect(
      workspaceViewStore.getState().viewFor(workspaceId).recovery.backups,
    ).toEqual([]);
    expect(
      renderResult.queryByRole("button", { name: "Restore src/main.ts" }),
    ).toBeNull();

    staleSave.resolve({
      id: backupId,
      workspace_id: workspaceId,
      workspace_root: workspaceRoot,
      path: "src/main.ts",
      content: "dirty text",
      version: fileVersion,
      updated_ms: 20,
    });
    await flushAppShellEffects();

    expect(
      workspaceViewStore.getState().viewFor(workspaceId).recovery.backups,
    ).toEqual([]);
    expect(
      renderResult.queryByRole("button", { name: "Restore src/main.ts" }),
    ).toBeNull();
  });

  test("AppShell restores backup content from a fresh recovery list", async () => {
    const workspaceId = "recovery-restore-contract";
    const workspaceRoot = "/repo-recovery-restore-contract";
    const fileVersion = { modified_ms: 7, len: 10 };
    const staleBackup: UnsavedBackup = {
      id: "b1",
      workspace_id: workspaceId,
      workspace_root: workspaceRoot,
      path: "src/main.ts",
      content: "stale state content",
      version: fileVersion,
      updated_ms: 10,
    };
    const freshBackup: UnsavedBackup = {
      ...staleBackup,
      content: "fresh restore content",
      updated_ms: 20,
    };
    installAppShellTauriMock({
      workspaceId,
      workspaceRoot,
      textFiles: {
        "src/main.ts": {
          path: "src/main.ts",
          content: "saved text",
          version: fileVersion,
          too_large: false,
        },
      },
      listUnsavedBackupsResponses: [[staleBackup], [freshBackup]],
    });
    resetWorkspaceBootstrapForTests();
    window.localStorage.clear();
    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: workspaceRoot,
          name: workspaceId,
          pinned: false,
        },
      ],
    });
    workspaceViewStore.getState().updateView(workspaceId, {
      activeActivity: "settings",
      panelOpen: true,
      surface: "editor",
    });
    workspaceViewStore.getState().updateEditor(workspaceId, () => ({
      tabs: [
        {
          path: "src/main.ts",
          name: "main.ts",
          dirty: false,
          tooLarge: false,
          version: fileVersion,
          externalChange: false,
        },
      ],
      activePath: "src/main.ts",
    }));

    let renderResult!: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(<AppShell />);
    });
    const editor = await renderResult.findByLabelText("Mock editor");
    await flushAppShellEffects();

    await act(async () => {
      fireEvent.click(
        renderResult.getByRole("button", { name: "Restore src/main.ts" }),
      );
    });
    await flushAppShellEffects();

    expect((editor as HTMLTextAreaElement).value).toBe("fresh restore content");
    expect(
      Object.prototype.hasOwnProperty.call(
        workspaceViewStore.getState().viewFor(workspaceId).recovery.backups[0],
        "content",
      ),
    ).toBe(false);
  });

  test("AppShell opens Extensions rail and loads workspace extension statuses", async () => {
    const workspaceId = "extensions-rail-contract";
    const workspaceRoot = "/repo-extensions-rail-contract";
    const { renderResult, tauri } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      extensionStatuses: [
        extensionStatus({ id: "yuuzu.core", name: "Yuuzu Core" }),
      ],
    });

    fireEvent.click(renderResult.getByRole("button", { name: "Extensions" }));
    await flushAppShellEffects();

    expect(renderResult.getByText("Yuuzu Core")).toBeTruthy();
    expect(
      tauri.invokeCalls.some(
        (call) =>
          call.command === "extension_statuses" &&
          call.args.workspaceRoot === workspaceRoot,
      ),
    ).toBe(true);
  });

  test("AppShell toggles extension enabled state for active workspace", async () => {
    const workspaceId = "extensions-toggle-contract";
    const workspaceRoot = "/repo-extensions-toggle-contract";
    const { renderResult, tauri } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      extensionStatuses: [
        extensionStatus({
          id: "yuuzu.debug-tools",
          name: "Debug Tools",
          enabled: true,
        }),
      ],
    });

    fireEvent.click(renderResult.getByRole("button", { name: "Extensions" }));
    await flushAppShellEffects();
    fireEvent.click(renderResult.getByLabelText("Disable Debug Tools"));
    await flushAppShellEffects();

    const toggleCall = tauri.invokeCalls.find(
      (call) => call.command === "set_extension_enabled",
    );
    expect(toggleCall?.args).toEqual({
      workspaceRoot,
      extensionId: "yuuzu.debug-tools",
      enabled: false,
    });
  });

  test("AppShell command palette hides disabled extension commands", async () => {
    const workspaceId = "extensions-palette-disabled";
    const workspaceRoot = "/repo-extensions-palette-disabled";
    const enabledCommandLabel = "Core Tools: Run task";
    const disabledCommandLabel = "Debug Tools: Inspect";
    const { renderResult } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      initialExtensionStatuses: [
        extensionStatus({
          id: "yuuzu.core-tools",
          name: "Core Tools",
          commandId: "yuuzu.core-tools.runTask",
          commandLabel: enabledCommandLabel,
        }),
        extensionStatus({
          id: "yuuzu.debug-tools",
          name: "Debug Tools",
          enabled: false,
          commandId: "yuuzu.debug-tools.inspect",
          commandLabel: disabledCommandLabel,
        }),
      ],
    });

    fireEvent.click(
      renderResult.getByRole("button", { name: /Search or run a command/ }),
    );

    expect(
      renderResult.getByRole("button", { name: new RegExp(enabledCommandLabel) }),
    ).toBeTruthy();
    expect(
      renderResult.queryByRole("button", {
        name: new RegExp(disabledCommandLabel),
      }),
    ).toBeNull();
  });

  test("AppShell keeps core palette commands active when extension statuses contribute matching ids", async () => {
    const workspaceId = "extensions-core-command-shadow";
    const workspaceRoot = "/repo-extensions-core-command-shadow";
    const { renderResult, tauri } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      initialExtensionStatuses: [
        extensionStatus({
          id: "yuuzu.core",
          name: "Yuuzu Core",
          commandId: "search-workspace",
          commandLabel: "Yuuzu Core: Search workspace",
        }),
      ],
    });

    fireEvent.click(
      renderResult.getByRole("button", { name: /Search or run a command/ }),
    );
    fireEvent.click(
      renderResult.getByRole("button", { name: /^Search workspace Search$/ }),
    );
    await flushAppShellEffects();

    const view = workspaceViewStore.getState().viewFor(workspaceId);
    expect(view.activeActivity).toBe("search");
    expect(view.panelOpen).toBe(true);
    expect(
      tauri.invokeCalls.some(
        (call) =>
          call.command === "record_extension_performance" &&
          (call.args.sample as { operation?: string } | undefined)?.operation ===
            "command:search-workspace",
      ),
    ).toBe(false);
  });

  test("AppShell hides yuuzu.core manifest commands from extension palette", async () => {
    const workspaceId = "extensions-core-command-manifest";
    const workspaceRoot = "/repo-extensions-core-command-manifest";
    const { renderResult, tauri } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      initialExtensionStatuses: [
        extensionStatus({
          id: "yuuzu.core",
          name: "Yuuzu Core",
          commandId: "open-command-palette",
          commandLabel: "Open Command Palette",
        }),
      ],
    });

    fireEvent.click(
      renderResult.getByRole("button", { name: /Search or run a command/ }),
    );

    const hasCoreManifestCommand = Boolean(
      renderResult.queryByText("Open Command Palette"),
    );
    expect(hasCoreManifestCommand).toBe(false);
    expect(
      tauri.invokeCalls.some(
        (call) => call.command === "record_extension_performance",
      ),
    ).toBe(false);
  });

  test("AppShell records slow extension command performance", async () => {
    const workspaceId = "extensions-command-performance";
    const workspaceRoot = "/repo-extensions-command-performance";
    const commandId = "yuuzu.debug-tools.profile";
    const commandLabel = "Debug Tools: Profile Project";
    const { renderResult, tauri } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      initialExtensionStatuses: [
        extensionStatus({
          id: "yuuzu.debug-tools",
          name: "Debug Tools",
          commandId,
          commandLabel,
        }),
      ],
    });

    fireEvent.click(
      renderResult.getByRole("button", { name: /Search or run a command/ }),
    );
    fireEvent.click(
      renderResult.getByRole("button", { name: new RegExp(commandLabel) }),
    );
    await flushAppShellEffects();

    const recordCall = tauri.invokeCalls.find(
      (call) => call.command === "record_extension_performance",
    );
    expect(recordCall?.args).toEqual({
      workspaceRoot,
      sample: {
        extension_id: "yuuzu.debug-tools",
        workspace_root: workspaceRoot,
        operation: `command:${commandId}`,
        duration_ms: 5,
        budget_ms: 50,
        recorded_ms: 0,
      },
    });
  });

  test("AppShell applies in-flight toggle response after extension command performance snapshot", async () => {
    const workspaceId = "extensions-toggle-performance-overlap";
    const workspaceRoot = "/repo-extensions-toggle-performance-overlap";
    const disableResponse = createDeferred<ExtensionWorkspaceStatus[]>();
    const commandId = "yuuzu.profiler.profile";
    const commandLabel = "Profiler: Profile Project";
    const { renderResult, tauri } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      extensionStatuses: [
        extensionStatus({
          id: "yuuzu.debug-tools",
          name: "Debug Tools",
          enabled: true,
        }),
        extensionStatus({
          id: "yuuzu.profiler",
          name: "Profiler",
          enabled: true,
          commandId,
          commandLabel,
        }),
      ],
      setExtensionEnabledResponses: [disableResponse.promise],
    });

    fireEvent.click(renderResult.getByRole("button", { name: "Extensions" }));
    await flushAppShellEffects();

    fireEvent.click(renderResult.getByLabelText("Disable Debug Tools"));
    expect(renderResult.getByLabelText("Enable Debug Tools")).toBeTruthy();

    fireEvent.click(
      renderResult.getByRole("button", { name: /Search or run a command/ }),
    );
    fireEvent.click(
      renderResult.getByRole("button", { name: new RegExp(commandLabel) }),
    );
    await flushAppShellEffects();

    expect(
      tauri.invokeCalls.some(
        (call) =>
          call.command === "record_extension_performance" &&
          (call.args.sample as { operation?: string } | undefined)?.operation ===
            `command:${commandId}`,
      ),
    ).toBe(true);

    await act(async () => {
      disableResponse.resolve([
        extensionStatus({
          id: "yuuzu.debug-tools",
          name: "Debug Tools",
          enabled: false,
        }),
        extensionStatus({
          id: "yuuzu.profiler",
          name: "Profiler",
          enabled: true,
          commandId,
          commandLabel,
        }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushAppShellEffects();

    const extension = workspaceViewStore.getState().viewFor(workspaceId).extension;
    const debugTools = extension.statuses.find(
      (status) => status.manifest.id === "yuuzu.debug-tools",
    );
    expect(debugTools?.enabled).toBe(false);
    expect(renderResult.getByLabelText("Enable Debug Tools")).toBeTruthy();
  });

  test("AppShell ignores stale extension performance snapshot after newer toggle snapshot", async () => {
    const workspaceId = "extensions-toggle-over-stale-performance";
    const workspaceRoot = "/repo-extensions-toggle-over-stale-performance";
    const stalePerformanceResponse = createDeferred<ExtensionWorkspaceStatus[]>();
    const commandId = "yuuzu.debug-tools.profile";
    const commandLabel = "Debug Tools: Profile Project";
    const initialStatuses = [
      extensionStatus({
        id: "yuuzu.debug-tools",
        name: "Debug Tools",
        enabled: true,
        commandId,
        commandLabel,
      }),
    ];
    const { renderResult } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      initialExtensionStatuses: initialStatuses,
      extensionStatuses: initialStatuses,
      recordExtensionPerformanceResponses: [stalePerformanceResponse.promise],
    });

    fireEvent.click(renderResult.getByRole("button", { name: "Extensions" }));
    await flushAppShellEffects();

    fireEvent.click(
      renderResult.getByRole("button", { name: /Search or run a command/ }),
    );
    fireEvent.click(
      renderResult.getByRole("button", { name: new RegExp(commandLabel) }),
    );
    await flushAppShellEffects();

    fireEvent.click(renderResult.getByLabelText("Disable Debug Tools"));
    await flushAppShellEffects();
    expect(renderResult.getByLabelText("Enable Debug Tools")).toBeTruthy();

    await act(async () => {
      stalePerformanceResponse.resolve([
        extensionStatus({
          id: "yuuzu.debug-tools",
          name: "Debug Tools",
          enabled: true,
          commandId,
          commandLabel,
        }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushAppShellEffects();

    const extension = workspaceViewStore.getState().viewFor(workspaceId).extension;
    const debugTools = extension.statuses.find(
      (status) => status.manifest.id === "yuuzu.debug-tools",
    );
    expect(debugTools?.enabled).toBe(false);
    expect(renderResult.getByLabelText("Enable Debug Tools")).toBeTruthy();
  });

  test("AppShell ignores stale extension toggle snapshots for the same workspace", async () => {
    const workspaceId = "extensions-toggle-stale";
    const workspaceRoot = "/repo-extensions-toggle-stale";
    const disableResponse = createDeferred<ExtensionWorkspaceStatus[]>();
    const enableResponse = createDeferred<ExtensionWorkspaceStatus[]>();
    const { renderResult } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      extensionStatuses: [
        extensionStatus({
          id: "yuuzu.debug-tools",
          name: "Debug Tools",
          enabled: true,
        }),
      ],
      setExtensionEnabledResponses: [
        disableResponse.promise,
        enableResponse.promise,
      ],
    });

    fireEvent.click(renderResult.getByRole("button", { name: "Extensions" }));
    await flushAppShellEffects();

    fireEvent.click(renderResult.getByLabelText("Disable Debug Tools"));
    expect(renderResult.getByLabelText("Enable Debug Tools")).toBeTruthy();

    fireEvent.click(renderResult.getByLabelText("Enable Debug Tools"));
    expect(renderResult.getByLabelText("Disable Debug Tools")).toBeTruthy();

    await act(async () => {
      enableResponse.resolve([
        extensionStatus({
          id: "yuuzu.debug-tools",
          name: "Debug Tools",
          enabled: true,
        }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushAppShellEffects();

    await act(async () => {
      disableResponse.resolve([
        extensionStatus({
          id: "yuuzu.debug-tools",
          name: "Debug Tools",
          enabled: false,
        }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushAppShellEffects();

    const extension = workspaceViewStore.getState().viewFor(workspaceId).extension;
    expect(extension.statuses[0]?.enabled).toBe(true);
    expect(renderResult.getByLabelText("Disable Debug Tools")).toBeTruthy();
  });

  test("AppShell ignores stale cross-extension toggle snapshots for the same workspace", async () => {
    const workspaceId = "extensions-toggle-cross-stale";
    const workspaceRoot = "/repo-extensions-toggle-cross-stale";
    const alphaResponse = createDeferred<ExtensionWorkspaceStatus[]>();
    const betaResponse = createDeferred<ExtensionWorkspaceStatus[]>();
    const { renderResult } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      extensionStatuses: [
        extensionStatus({
          id: "yuuzu.alpha-tools",
          name: "Alpha Tools",
          enabled: true,
        }),
        extensionStatus({
          id: "yuuzu.beta-tools",
          name: "Beta Tools",
          enabled: true,
        }),
      ],
      setExtensionEnabledResponses: [alphaResponse.promise, betaResponse.promise],
    });

    fireEvent.click(renderResult.getByRole("button", { name: "Extensions" }));
    await flushAppShellEffects();

    fireEvent.click(renderResult.getByLabelText("Disable Alpha Tools"));
    expect(renderResult.getByLabelText("Enable Alpha Tools")).toBeTruthy();

    fireEvent.click(renderResult.getByLabelText("Disable Beta Tools"));
    expect(renderResult.getByLabelText("Enable Beta Tools")).toBeTruthy();

    await act(async () => {
      betaResponse.resolve([
        extensionStatus({
          id: "yuuzu.alpha-tools",
          name: "Alpha Tools",
          enabled: false,
        }),
        extensionStatus({
          id: "yuuzu.beta-tools",
          name: "Beta Tools",
          enabled: false,
        }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushAppShellEffects();

    await act(async () => {
      alphaResponse.resolve([
        extensionStatus({
          id: "yuuzu.alpha-tools",
          name: "Alpha Tools",
          enabled: false,
        }),
        extensionStatus({
          id: "yuuzu.beta-tools",
          name: "Beta Tools",
          enabled: true,
        }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushAppShellEffects();

    const extension = workspaceViewStore.getState().viewFor(workspaceId).extension;
    const beta = extension.statuses.find(
      (status) => status.manifest.id === "yuuzu.beta-tools",
    );
    expect(beta?.enabled).toBe(false);
    expect(renderResult.getByLabelText("Enable Beta Tools")).toBeTruthy();
  });

  test("AppShell preserves pending extension toggle state when another toggle resolves", async () => {
    const workspaceId = "extensions-toggle-pending-cross";
    const workspaceRoot = "/repo-extensions-toggle-pending-cross";
    const alphaResponse = createDeferred<ExtensionWorkspaceStatus[]>();
    const betaResponse = createDeferred<ExtensionWorkspaceStatus[]>();
    const { renderResult } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      extensionStatuses: [
        extensionStatus({
          id: "yuuzu.alpha-tools",
          name: "Alpha Tools",
          enabled: true,
        }),
        extensionStatus({
          id: "yuuzu.beta-tools",
          name: "Beta Tools",
          enabled: true,
        }),
      ],
      setExtensionEnabledResponses: [alphaResponse.promise, betaResponse.promise],
    });

    fireEvent.click(renderResult.getByRole("button", { name: "Extensions" }));
    await flushAppShellEffects();

    fireEvent.click(renderResult.getByLabelText("Disable Alpha Tools"));
    expect(renderResult.getByLabelText("Enable Alpha Tools")).toBeTruthy();

    fireEvent.click(renderResult.getByLabelText("Disable Beta Tools"));
    expect(renderResult.getByLabelText("Enable Beta Tools")).toBeTruthy();

    await act(async () => {
      betaResponse.resolve([
        extensionStatus({
          id: "yuuzu.alpha-tools",
          name: "Alpha Tools",
          enabled: true,
        }),
        extensionStatus({
          id: "yuuzu.beta-tools",
          name: "Beta Tools",
          enabled: false,
        }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushAppShellEffects();

    let extension = workspaceViewStore.getState().viewFor(workspaceId).extension;
    let alpha = extension.statuses.find(
      (status) => status.manifest.id === "yuuzu.alpha-tools",
    );
    let beta = extension.statuses.find(
      (status) => status.manifest.id === "yuuzu.beta-tools",
    );
    expect(alpha?.enabled).toBe(false);
    expect(beta?.enabled).toBe(false);
    expect(renderResult.getByLabelText("Enable Alpha Tools")).toBeTruthy();
    expect(renderResult.getByLabelText("Enable Beta Tools")).toBeTruthy();

    await act(async () => {
      alphaResponse.resolve([
        extensionStatus({
          id: "yuuzu.alpha-tools",
          name: "Alpha Tools",
          enabled: false,
        }),
        extensionStatus({
          id: "yuuzu.beta-tools",
          name: "Beta Tools",
          enabled: false,
        }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushAppShellEffects();

    extension = workspaceViewStore.getState().viewFor(workspaceId).extension;
    alpha = extension.statuses.find(
      (status) => status.manifest.id === "yuuzu.alpha-tools",
    );
    beta = extension.statuses.find(
      (status) => status.manifest.id === "yuuzu.beta-tools",
    );
    expect(alpha?.enabled).toBe(false);
    expect(beta?.enabled).toBe(false);
  });

  test("AppShell stopped listener loads live scopes and variables for DebugPanel", async () => {
    const workspaceId = "debug-stopped-variables";
    const workspaceRoot = "/repo-debug-stopped-variables";
    const sessionId = "session-stopped-variables";
    const frame = {
      id: 7,
      name: "main",
      source_path: "src/app.py",
      line: 12,
      column: 1,
    };
    const scope = {
      name: "Locals",
      variables_reference: 100,
      expensive: false,
    };
    const variable = {
      name: "counter",
      value: "3",
      type: "int",
      variables_reference: 0,
    };
    const { renderResult, tauri } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      debugStackFrames: [frame],
      debugScopesByFrameId: { [frame.id]: [scope] },
      debugVariablesByReference: {
        [scope.variables_reference]: [variable],
      },
    });

    expect(
      workspaceViewStore
        .getState()
        .viewFor(workspaceId).debug.variablesByReference,
    ).toEqual({});

    await act(async () => {
      tauri.emit("workspace://debug-stopped", {
        session_id: sessionId,
        workspace_id: workspaceId,
        workspace_root: workspaceRoot,
        sequence: 2,
        status: "Stopped",
        reason: "breakpoint",
        thread_id: 11,
        active_thread_id: 11,
        config_id: "cfg-python",
        name: "Python",
        adapter: "Python",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushAppShellEffects();

    expect(
      tauri.invokeCalls
        .filter((call) => call.command === "debug_stack_trace")
        .map((call) => call.args),
    ).toEqual([
      { workspaceId, workspaceRoot, sessionId, threadId: 11 },
    ]);
    expect(
      tauri.invokeCalls
        .filter((call) => call.command === "debug_scopes")
        .map((call) => call.args),
    ).toEqual([
      { workspaceId, workspaceRoot, sessionId, frameId: frame.id },
    ]);
    expect(
      tauri.invokeCalls
        .filter((call) => call.command === "debug_variables")
        .map((call) => call.args),
    ).toEqual([
      {
        workspaceId,
        workspaceRoot,
        sessionId,
        variablesReference: scope.variables_reference,
      },
    ]);

    const debug = workspaceViewStore.getState().viewFor(workspaceId).debug;
    expect(debug.stackBySessionId[sessionId]).toEqual([frame]);
    expect(debug.scopesByFrameId[`${sessionId}:${frame.id}`]).toEqual([scope]);
    expect(debug.variablesByReference[`${sessionId}:${scope.variables_reference}`]).toEqual([
      variable,
    ]);

    fireEvent.click(renderResult.getByRole("button", { name: "Debug" }));
    fireEvent.click(renderResult.getByRole("button", { name: "Variables" }));
    expect(renderResult.getByText("counter")).toBeTruthy();
    expect(renderResult.getByText("3")).toBeTruthy();
  });

  test("AppShell ignores stale stopped variable loads after a newer sequence", async () => {
    const workspaceId = "debug-stopped-stale-variables";
    const workspaceRoot = "/repo-debug-stopped-stale-variables";
    const sessionId = "session-stale-variables";
    const staleVariables = createDeferred<DebugVariable[]>();
    const { tauri } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      debugStackFrames: [
        {
          id: 7,
          name: "main",
          source_path: "src/app.py",
          line: 12,
          column: 1,
        },
      ],
      debugScopesByFrameId: {
        7: [{ name: "Locals", variables_reference: 100, expensive: false }],
      },
      debugVariablesByReference: {
        100: staleVariables.promise,
      },
    });

    await act(async () => {
      tauri.emit("workspace://debug-stopped", {
        session_id: sessionId,
        workspace_id: workspaceId,
        workspace_root: workspaceRoot,
        sequence: 2,
        status: "Stopped",
        reason: "breakpoint",
        thread_id: 11,
        active_thread_id: 11,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushAppShellEffects();

    expect(
      tauri.invokeCalls.filter((call) => call.command === "debug_variables"),
    ).toHaveLength(1);

    await act(async () => {
      tauri.emit("workspace://debug-session", {
        session_id: sessionId,
        workspace_id: workspaceId,
        workspace_root: workspaceRoot,
        sequence: 3,
        status: "Running",
        reason: null,
        active_thread_id: 11,
      });
      staleVariables.resolve([
        {
          name: "staleCounter",
          value: "99",
          type: "int",
          variables_reference: 0,
        },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushAppShellEffects();

    const debug = workspaceViewStore.getState().viewFor(workspaceId).debug;
    expect(debug.sessionSequenceById[sessionId]).toBe(3);
    expect(debug.variablesByReference[`${sessionId}:100`]).toBeUndefined();
  });

  test("AppShell drops stopped stack refresh when workspace root changes before stack resolves", async () => {
    const workspaceId = "debug-stopped-root-switch";
    const workspaceRoot = "/repo-debug-stopped-root-switch";
    const sessionId = "session-root-switch";
    const stackFrames = createDeferred<DebugStackFrame[]>();
    const { tauri } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      debugStackFrames: stackFrames.promise,
      debugScopesByFrameId: {
        7: [{ name: "Locals", variables_reference: 100, expensive: false }],
      },
      debugVariablesByReference: {
        100: [
          {
            name: "counter",
            value: "3",
            type: "int",
            variables_reference: 0,
          },
        ],
      },
    });

    await act(async () => {
      tauri.emit("workspace://debug-stopped", {
        session_id: sessionId,
        workspace_id: workspaceId,
        workspace_root: workspaceRoot,
        sequence: 2,
        status: "Stopped",
        reason: "breakpoint",
        thread_id: 11,
        active_thread_id: 11,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      workspaceStore.getState().setRegistry({
        active_workspace_id: workspaceId,
        workspaces: [
          {
            id: workspaceId,
            path: `${workspaceRoot}-switched`,
            name: workspaceId,
            pinned: false,
          },
        ],
      });
      stackFrames.resolve([
        {
          id: 7,
          name: "main",
          source_path: "src/app.py",
          line: 12,
          column: 1,
        },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushAppShellEffects();

    const debug = workspaceViewStore.getState().viewFor(workspaceId).debug;
    expect(debug.sessionSequenceById[sessionId]).toBe(2);
    expect(debug.stackBySessionId[sessionId]).toBeUndefined();
    expect(
      tauri.invokeCalls.filter((call) => call.command === "debug_scopes"),
    ).toHaveLength(0);
    expect(debug.variablesByReference[`${sessionId}:100`]).toBeUndefined();
  });

  test("AppShell replaces stale session variables when a newer stopped refresh has missing variables", async () => {
    const workspaceId = "debug-stopped-replace-variables";
    const workspaceRoot = "/repo-debug-stopped-replace-variables";
    const sessionId = "session-replace-variables";
    const failedVariables = createDeferred<DebugVariable[]>();
    const session = debugSession({
      id: sessionId,
      workspace_id: workspaceId,
      workspace_root: workspaceRoot,
      status: "Stopped",
      active_thread_id: 11,
      sequence: 1,
    });
    const { renderResult, tauri } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      initialSessions: [session],
      initialActiveSessionId: sessionId,
      debugStackFrames: [
        {
          id: 8,
          name: "next",
          source_path: "src/app.py",
          line: 20,
          column: 1,
        },
      ],
      debugScopesByFrameId: {
        8: [{ name: "Locals", variables_reference: 200, expensive: false }],
      },
      debugVariablesByReference: {
        200: failedVariables.promise,
      },
    });

    await act(async () => {
      workspaceViewStore.getState().updateDebug(workspaceId, (debug) =>
        storeDebugVariables(
          setDebugScopes(
            setDebugStack(debug, sessionId, [
              {
                id: 7,
                name: "previous",
                source_path: "src/app.py",
                line: 12,
                column: 1,
              },
            ]),
            sessionId,
            7,
            [{ name: "Locals", variables_reference: 100, expensive: false }],
          ),
          sessionId,
          100,
          [
            {
              name: "staleCounter",
              value: "99",
              type: "int",
              variables_reference: 0,
            },
          ],
        ),
      );
    });

    fireEvent.click(renderResult.getByRole("button", { name: "Debug" }));
    fireEvent.click(renderResult.getByRole("button", { name: "Variables" }));
    expect(renderResult.getByText("staleCounter")).toBeTruthy();

    await act(async () => {
      tauri.emit("workspace://debug-stopped", {
        session_id: sessionId,
        workspace_id: workspaceId,
        workspace_root: workspaceRoot,
        sequence: 2,
        status: "Stopped",
        reason: "breakpoint",
        thread_id: 11,
        active_thread_id: 11,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushAppShellEffects();

    expect(
      tauri.invokeCalls.filter((call) => call.command === "debug_variables"),
    ).toHaveLength(1);

    await act(async () => {
      failedVariables.reject(new Error("variables unavailable"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushAppShellEffects();

    const debug = workspaceViewStore.getState().viewFor(workspaceId).debug;
    expect(debug.stackBySessionId[sessionId]?.map((frame) => frame.id)).toEqual([
      8,
    ]);
    expect(debug.scopesByFrameId[`${sessionId}:7`]).toBeUndefined();
    expect(debug.variablesByReference[`${sessionId}:100`]).toBeUndefined();
    expect(renderResult.queryByText("staleCounter")).toBeNull();
  });

  test("AppShell command palette starts debug with the active workspace identity", async () => {
    const workspaceId = "debug-palette-start";
    const workspaceRoot = "/repo-debug-palette-start";
    const config = debugLaunchConfig({
      id: "cfg-start",
      workspace_root: workspaceRoot,
    });
    const { renderResult, tauri } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      launchConfigs: [config],
      startedSession: debugSession({
        id: "session-started",
        workspace_id: workspaceId,
        workspace_root: workspaceRoot,
        config_id: config.id,
        name: "Python",
      }),
    });

    fireEvent.click(
      renderResult.getByRole("button", { name: /Search or run a command/ }),
    );
    fireEvent.click(
      renderResult.getByRole("button", { name: /Debug: Start session/ }),
    );
    await flushAppShellEffects();

    const startCall = tauri.invokeCalls.find(
      (call) => call.command === "debug_start_session",
    );
    expect(startCall?.args).toEqual({
      workspaceId,
      workspaceRoot,
      configId: "cfg-start",
    });
    expect(workspaceViewStore.getState().viewFor(workspaceId).surface).toBe(
      "debug-console",
    );
    expect(renderResult.getByText("debug console ready")).toBeTruthy();
  });

  test("AppShell wires all debug backend listeners on mount", async () => {
    const workspaceId = "debug-listener-contract";
    const workspaceRoot = "/repo-debug-listener-contract";
    const { tauri } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
    });

    const listenedEvents = tauri.invokeCalls
      .filter((call) => call.command === "plugin:event|listen")
      .map((call) => call.args.event);
    expect(listenedEvents).toContain("workspace://debug-session");
    expect(listenedEvents).toContain("workspace://debug-console");
    expect(listenedEvents).toContain("workspace://debug-stopped");
    expect(listenedEvents).toContain("workspace://debug-exited");
  });

  test("AppShell renders DebugConsoleSurface for the active debug console surface", async () => {
    const workspaceId = "debug-console-surface-contract";
    const workspaceRoot = "/repo-debug-console-surface-contract";
    const session = debugSession({
      id: "session-console-active",
      workspace_id: workspaceId,
      workspace_root: workspaceRoot,
      name: "Python",
    });
    const { renderResult } = await renderAppShellForDebug({
      workspaceId,
      workspaceRoot,
      debugSessions: [session],
      initialSessions: [session],
      initialActiveSessionId: session.id,
      surface: "debug-console",
    });

    expect(renderResult.getByText("debug console output")).toBeTruthy();
    expect(
      renderResult.getByLabelText("Continue debug session").hasAttribute("disabled"),
    ).toBe(false);
  });

  test("openBrowserPreviewWithValidation does not switch surface on invalid URL", async () => {
    const onOpenPanel = mock(() => {});
    const onSetSurface = mock(() => {});
    const onOpenUrl = mock(() => {});
    const onValidationError = mock(() => {});
    const requestState: BrowserValidationRequestState = {};
    const requestId = startBrowserValidationRequest(requestState, "w:1");

    await openBrowserPreviewWithValidation(
      {
        workspaceId: "w:1",
        value: "not-a-valid-url",
        requestId,
        isLatestRequest: (workspaceId, id) =>
          isLatestBrowserValidationRequest(requestState, workspaceId, id),
        onOpenPanel,
        onSetSurface,
        onOpenUrl,
        onValidationError,
      },
      async () => {
        throw new Error("invalid browser URL");
      },
    );

    expect(onOpenPanel).toHaveBeenCalledTimes(1);
    expect(onSetSurface).not.toHaveBeenCalled();
    expect(onOpenUrl).not.toHaveBeenCalled();
    expect(onValidationError).toHaveBeenCalledTimes(1);
  });

  test("openBrowserPreviewWithValidation sets browser surface only when URL validates", async () => {
    const parsedUrl = {
      url: "http://localhost:5173",
      host: "localhost",
      port: 5173,
    };
    const onOpenPanel = mock(() => {});
    const onSetSurface = mock(() => {});
    const onOpenUrl = mock(() => {});
    const onValidationError = mock(() => {});
    const requestState: BrowserValidationRequestState = {};
    const requestId = startBrowserValidationRequest(requestState, "w:1");

    await openBrowserPreviewWithValidation(
      {
        workspaceId: "w:1",
        value: " http://localhost:5173 ",
        requestId,
        isLatestRequest: (workspaceId, id) =>
          isLatestBrowserValidationRequest(requestState, workspaceId, id),
        onOpenPanel,
        onSetSurface,
        onOpenUrl,
        onValidationError,
      },
      async () => parsedUrl,
    );

    expect(onOpenPanel).toHaveBeenCalledTimes(1);
    expect(onOpenUrl).toHaveBeenCalledWith(parsedUrl);
    expect(onSetSurface).toHaveBeenCalledWith("browser-preview");
    expect(onValidationError).not.toHaveBeenCalled();
  });

  test("openBrowserPreviewWithValidation keeps surface unchanged for empty input", async () => {
    const onOpenPanel = mock(() => {});
    const onSetSurface = mock(() => {});
    const onOpenUrl = mock(() => {});
    const onValidationError = mock(() => {});
    const requestState: BrowserValidationRequestState = {};
    const requestId = startBrowserValidationRequest(requestState, "w:1");

    await openBrowserPreviewWithValidation(
      {
        workspaceId: "w:1",
        value: "   ",
        requestId,
        isLatestRequest: (workspaceId, id) =>
          isLatestBrowserValidationRequest(requestState, workspaceId, id),
        onOpenPanel,
        onSetSurface,
        onOpenUrl,
        onValidationError,
      },
      async () => {
        throw new Error("should not be called");
      },
    );

    expect(onOpenPanel).toHaveBeenCalledTimes(1);
    expect(onSetSurface).not.toHaveBeenCalled();
    expect(onOpenUrl).not.toHaveBeenCalled();
    expect(onValidationError).not.toHaveBeenCalled();
  });

  test("openBrowserPreviewWithValidation applies only latest validation result", async () => {
    const requestState: BrowserValidationRequestState = {};
    const onOpenPanel = mock(() => {});
    const onSetSurface = mock(() => {});
    const onOpenUrl = mock<(url: BrowserUrl) => void>(() => {});
    const onValidationError = mock<(error: unknown) => void>(() => {});

    const parsedFirst = {
      url: "http://localhost:5173",
      host: "localhost",
      port: 5173,
    };
    const parsedSecond = {
      url: "http://localhost:5174",
      host: "localhost",
      port: 5174,
    };
    let resolveFirst: (value: BrowserUrl | PromiseLike<BrowserUrl>) => void = () => {};
    let resolveSecond: (value: BrowserUrl | PromiseLike<BrowserUrl>) => void = () => {};
    const validateFirst = mock(() => {
      return new Promise<BrowserUrl>((resolve) => {
        resolveFirst = resolve;
      });
    });
    const validateSecond = mock(() => {
      return new Promise<BrowserUrl>((resolve) => {
        resolveSecond = resolve;
      });
    });

    const firstRequestId = startBrowserValidationRequest(requestState, "workspace-1");
    const secondRequestId = startBrowserValidationRequest(
      requestState,
      "workspace-1",
    );

    const first = openBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        value: "http://localhost:5173",
        requestId: firstRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserValidationRequest(requestState, workspaceId, requestId),
        onOpenPanel,
        onSetSurface,
        onOpenUrl,
        onValidationError,
      },
      validateFirst,
    );

    const second = openBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        value: "http://localhost:5174",
        requestId: secondRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserValidationRequest(requestState, workspaceId, requestId),
        onOpenPanel,
        onSetSurface,
        onOpenUrl,
        onValidationError,
      },
      validateSecond,
    );

    expect(onOpenPanel).toHaveBeenCalledTimes(2);

    resolveSecond(parsedSecond);
    await second;

    expect(onOpenUrl).toHaveBeenCalledTimes(1);
    expect(onSetSurface).toHaveBeenCalledTimes(1);
    expect(onOpenUrl).toHaveBeenCalledWith(parsedSecond);
    expect(onValidationError).not.toHaveBeenCalled();

    resolveFirst(parsedFirst);
    await first;

    expect(onOpenUrl).toHaveBeenCalledTimes(1);
    expect(onSetSurface).toHaveBeenCalledTimes(1);
    expect(onOpenUrl).toHaveBeenCalledWith(parsedSecond);
    expect(onValidationError).not.toHaveBeenCalled();
  });

  test("openBrowserPreviewWithValidation ignores stale validation failure after newer success", async () => {
    const requestState: BrowserValidationRequestState = {};
    const onOpenPanel = mock(() => {});
    const onSetSurface = mock(() => {});
    const onOpenUrl = mock<(url: BrowserUrl) => void>(() => {});
    const onValidationError = mock<(error: unknown) => void>(() => {});
    const parsed = {
      url: "http://localhost:5174",
      host: "localhost",
      port: 5174,
    };
    let rejectFirst: (reason?: unknown) => void = () => {};
    const validateFirst = mock(() => {
      return new Promise<BrowserUrl>((_resolve, reject) => {
        rejectFirst = reject;
      });
    });
    const validateSecond = mock(async () => parsed);

    const firstRequestId = startBrowserValidationRequest(requestState, "workspace-1");
    const secondRequestId = startBrowserValidationRequest(
      requestState,
      "workspace-1",
    );

    const first = openBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        value: "bad-url",
        requestId: firstRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserValidationRequest(requestState, workspaceId, requestId),
        onOpenPanel,
        onSetSurface,
        onOpenUrl,
        onValidationError,
      },
      validateFirst,
    );

    const second = openBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        value: "http://localhost:5174",
        requestId: secondRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserValidationRequest(requestState, workspaceId, requestId),
        onOpenPanel,
        onSetSurface,
        onOpenUrl,
        onValidationError,
      },
      validateSecond,
    );

    await second;

    rejectFirst(new Error("stale failure"));
    await first;

    expect(onOpenUrl).toHaveBeenCalledTimes(1);
    expect(onOpenUrl).toHaveBeenCalledWith(parsed);
    expect(onSetSurface).toHaveBeenCalledTimes(1);
    expect(onSetSurface).toHaveBeenCalledWith("browser-preview");
    expect(onValidationError).toHaveBeenCalledTimes(0);
  });

  test("captureBrowserPreviewWithValidation ignores stale capture success", async () => {
    const requestState: BrowserCaptureRequestState = {};
    const onSuccess = mock<(screenshot: BrowserScreenshot) => void>(() => {});
    const onFailure = mock<(error: unknown) => void>(() => {});
    let resolveFirst: (
      value: BrowserScreenshot | PromiseLike<BrowserScreenshot>,
    ) => void = () => {};
    let resolveSecond: (
      value: BrowserScreenshot | PromiseLike<BrowserScreenshot>,
    ) => void = () => {};

    const first = {
      id: "s1",
      workspace_root: "/repo",
      url: "http://localhost:5173",
      title: "localhost:5173",
      data_url: "data:image/png;base64,a",
      width: 1200,
      height: 700,
      captured_ms: 1,
    };
    const second = {
      id: "s2",
      workspace_root: "/repo",
      url: "http://localhost:5174",
      title: "localhost:5174",
      data_url: "data:image/png;base64,b",
      width: 1200,
      height: 700,
      captured_ms: 2,
    };

    const request = {
      workspaceRoot: "/repo",
      request: {
        url: "http://localhost:5173",
        title: "localhost:5173",
        bounds: { x: 0, y: 0, width: 1280, height: 720 },
      },
    };
    const requestDifferent = {
      workspaceRoot: "/repo",
      request: {
        url: "http://localhost:5174",
        title: "localhost:5174",
        bounds: { x: 0, y: 0, width: 1280, height: 720 },
      },
    };

    const firstRequestId = startBrowserCaptureRequest(requestState, "workspace-1");
    const secondRequestId = startBrowserCaptureRequest(requestState, "workspace-1");

    captureBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        requestId: firstRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserCaptureRequest(requestState, workspaceId, requestId),
        request,
        onSuccess,
        onFailure,
      },
      () =>
        new Promise<BrowserScreenshot>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    captureBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        requestId: secondRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserCaptureRequest(requestState, workspaceId, requestId),
        request: requestDifferent,
        onSuccess,
        onFailure,
      },
      () =>
        new Promise<BrowserScreenshot>((resolve) => {
          resolveSecond = resolve;
        }),
    );

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();

    resolveSecond(second);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(second);
    expect(onFailure).not.toHaveBeenCalled();

    resolveFirst(first);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  test("captureBrowserPreviewWithValidation ignores stale capture failure after newer success", async () => {
    const requestState: BrowserCaptureRequestState = {};
    const onSuccess = mock<(screenshot: BrowserScreenshot) => void>(() => {});
    const onFailure = mock<(error: unknown) => void>(() => {});
    let rejectFirst: (reason?: unknown) => void = () => {};

    const request = {
      workspaceRoot: "/repo",
      request: {
        url: "http://localhost:5173",
        title: "localhost:5173",
        bounds: { x: 0, y: 0, width: 1280, height: 720 },
      },
    };
    const requestDifferent = {
      workspaceRoot: "/repo",
      request: {
        url: "http://localhost:5174",
        title: "localhost:5174",
        bounds: { x: 0, y: 0, width: 1280, height: 720 },
      },
    };

    const firstRequestId = startBrowserCaptureRequest(requestState, "workspace-1");
    const secondRequestId = startBrowserCaptureRequest(requestState, "workspace-1");

    let secondSuccessComplete = false;

    captureBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        requestId: firstRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserCaptureRequest(requestState, workspaceId, requestId),
        request,
        onSuccess,
        onFailure,
      },
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );

    const screenshot = {
      id: "s2",
      workspace_root: "/repo",
      url: "http://localhost:5174",
      title: "localhost:5174",
      data_url: "data:image/png;base64,b",
      width: 1200,
      height: 700,
      captured_ms: 2,
    };
    captureBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        requestId: secondRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserCaptureRequest(requestState, workspaceId, requestId),
        request: requestDifferent,
        onSuccess: (value) => {
          secondSuccessComplete = true;
          onSuccess(value);
        },
        onFailure,
      },
      async () => screenshot,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(secondSuccessComplete).toBe(true);
    expect(onSuccess).toHaveBeenCalledWith(screenshot);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();

    rejectFirst(new Error("stale failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onFailure).toHaveBeenCalledTimes(0);
  });

  test("collects all bounded agent context pieces", () => {
    const source = {
      workspaceRoot: "/repo",
      activeWorkspaceId: "w:1",
      browserScreenshots: [
        {
          id: "shot-1",
          workspace_root: "/repo",
          url: "http://localhost:5173",
          title: "localhost:5173",
          data_url: "data:image/png;base64,shot",
          width: 1280,
          height: 720,
          captured_ms: 1700000000000,
        },
      ],
      loadedFile: {
        workspaceId: "w:1",
        path: "src/app/AppShell.tsx",
        content: "export const app = true;",
        language: "typescript",
        readOnly: false,
      },
      docsPreviews: [
        {
          path: "docs/guide.md",
          title: "Guide",
          content: "# Guide",
        },
        {
          path: "docs/faq.md",
          title: "FAQ",
          content: "# FAQ",
        },
      ],
      selectedDiff: {
        path: "src/app/AppShell.tsx",
        original_path: null,
        staged: false,
        binary: false,
        truncated: false,
        raw: "diff --git a/src/app/AppShell.tsx b/src/app/AppShell.tsx",
      },
      activeFileDiagnostics: [
        {
          path: "src/app/AppShell.tsx",
          range: {
            start_line: 3,
            start_character: 0,
            end_line: 3,
            end_character: 1,
          },
          severity: "error",
          message: "Unexpected token",
          source: null,
        },
      ],
      terminalSession: {
        id: "w:terminal-1",
        workspace_id: "w:1",
        name: "zsh",
        cwd: "/repo",
        shell: "/bin/zsh",
        running: true,
      },
      terminalOutput: "$ bun test",
    } as AgentAvailableContextSource;

    const contextItems = collectAgentAvailableContext(source);
    const labels = contextItems.map((item) => item.label);
    const contents = contextItems.map((item) => item.content);

    expect(labels).toContain("src/app/AppShell.tsx");
    expect(labels).toContain("Guide");
    expect(labels).toContain("FAQ");
    expect(labels).toContain("unstaged diff: src/app/AppShell.tsx");
    expect(labels).toContain("error: src/app/AppShell.tsx:4");
    expect(labels).toContain("zsh");
    expect(labels).toContain("Browser screenshot: localhost:5173");
    expect(contents).toContain("# Guide");
    expect(contents).toContain("# FAQ");
    expect(contents.some((entry) => entry.includes("URL: http://localhost:5173"))).toBe(
      true,
    );
  });

  test("collects bounded context excluding stale loaded file from inactive workspace", () => {
    const source = {
      workspaceRoot: "/repo",
      activeWorkspaceId: "w:1",
      browserScreenshots: [
        {
          id: "shot-other",
          workspace_root: "/old",
          url: "http://localhost:1234",
          title: "Other workspace",
          data_url: "data:image/png;base64,old",
          width: 640,
          height: 480,
          captured_ms: 1700000000002,
        },
      ],
      loadedFile: {
        workspaceId: "w:old",
        path: "src/legacy/AppShell.tsx",
        content: "export const legacy = false;",
        language: "typescript",
        readOnly: false,
      },
      docsPreviews: [
        {
          path: "docs/guide.md",
          title: "Guide",
          content: "# Guide",
        },
      ],
      selectedDiff: null,
      activeFileDiagnostics: [],
      terminalSession: {
        id: "w:terminal-2",
        workspace_id: "w:1",
        name: "bash",
        cwd: "/repo",
        shell: "/bin/bash",
        running: true,
      },
      terminalOutput: "$ bun test",
    };

    const contextItems = collectAgentAvailableContext(source);
    const labels = contextItems.map((item) => item.label);
    const contents = contextItems.map((item) => item.content);

    expect(labels).not.toContain("src/legacy/AppShell.tsx");
    expect(contents).not.toContain("export const legacy = false;");
    expect(labels).toContain("Guide");
    expect(labels).toContain("bash");
  });

  test("activeLoadedFileForWorkspace filters stale loaded files", () => {
    const staleLoadedFile = {
      workspaceId: "w:old",
      path: "src/legacy/AppShell.tsx",
      content: "export const legacy = false;",
      language: "typescript",
      readOnly: false,
    };

    const matched = activeLoadedFileForWorkspace(staleLoadedFile, "w:1");
    expect(matched).toBeNull();
  });

  test("PanelBody renders AgentPanel and routes callbacks", () => {
    const onAgentModeChange = mock(() => {});
    const onAgentPromptChange = mock(() => {});
    const onAgentToggleContext = mock(() => {});
    const onAgentStartSession = mock(() => {});
    const onAgentSelectSession = mock(() => {});
    const onAgentApprove = mock(() => {});
    const onAgentReject = mock(() => {});
    const onAgentExport = mock(() => {});

    const agentState: AgentViewState = {
      ...createAgentState(),
      sessions: [makeSession("agent-1")],
      activeSessionId: "agent-1",
    };

    const renderResult = render(
      <PanelBody
        active="agents"
        refreshKey={0}
        activeFilePath="src/app/AppShell.tsx"
        terminalSessions={[]}
        activeTerminalId={null}
        terminalCwdInput=""
        terminalError={null}
        taskState={{
          detectedTasks: [],
          runs: [],
          activeRunId: null,
          outputByRunId: {},
          problemsByRunId: {},
          pendingOutputByRunId: {},
          pendingFinishByRunId: {},
          contextPackByRunId: {},
          customCommand: "",
        }}
        taskError={null}
        gitState={{
          status: null,
          loading: false,
          error: null,
          commitMessage: "",
          selectedDiff: null,
          diffByKey: {},
          branches: [],
          graph: [],
        }}
        docsState={createDocsState()}
        contextPackNameById={{}}
        gitDecorations={{}}
        agentState={agentState}
        availableAgentContext={[]}
        onAgentModeChange={onAgentModeChange}
        onAgentPromptChange={onAgentPromptChange}
        onAgentToggleContext={onAgentToggleContext}
        onAgentStartSession={onAgentStartSession}
        onAgentSelectSession={onAgentSelectSession}
        onAgentApprove={onAgentApprove}
        onAgentReject={onAgentReject}
        onAgentExport={onAgentExport}
        onOpenFile={() => Promise.resolve()}
        onCreateFile={async () => {}}
        onRenamePath={async () => {}}
        onDeletePath={async () => {}}
        onTerminalCwdInputChange={() => {}}
        onNewTerminal={() => Promise.resolve()}
        onActivateTerminal={() => {}}
        onCloseTerminal={() => Promise.resolve()}
        onRestartTerminal={() => Promise.resolve()}
        onTaskCustomCommandChange={() => {}}
        onRunTask={() => {}}
        onRunCustomTask={() => {}}
        onActivateTaskRun={() => {}}
        onStopTaskRun={() => Promise.resolve()}
        onRerunTaskRun={() => {}}
        onGitRefresh={() => Promise.resolve()}
        onGitCommitMessageChange={() => {}}
        onGitCommit={() => {}}
        onGitStage={() => {}}
        onGitUnstage={() => {}}
        onGitDiscard={() => {}}
        onGitOpenDiff={() => {}}
        onGitStash={() => {}}
        onGitFetch={() => {}}
        onGitPull={() => {}}
        onGitPush={() => {}}
        onGitCheckoutBranch={() => {}}
        onGitCreateBranch={() => {}}
        onGitOpenGraph={() => {}}
        onDocsRefresh={() => Promise.resolve()}
        onDocsSearch={() => {}}
        onDocsOpenPreview={() => Promise.resolve()}
        onDocsToggleSource={() => {}}
        onDocsPackNameChange={() => {}}
        onDocsCreatePack={() => Promise.resolve()}
        onDocsSelectPack={() => {}}
        onDocsDeletePack={() => Promise.resolve()}
        onDocsUsePackForActiveTask={() => Promise.resolve()}
        onDocsLinkPackToAgentSession={() => Promise.resolve()}
        onLanguageOpenDiagnostic={() => {}}
        onLanguageRefresh={() => Promise.resolve()}
        onLanguageRestartServer={() => {}}
        browserState={createBrowserState()}
        browserTargets={[]}
        browserCanCapture={false}
        onBrowserUrlInputChange={() => {}}
        onBrowserOpenUrl={() => {}}
        onBrowserOpenTarget={() => {}}
        onBrowserReload={() => {}}
        onBrowserHardReload={() => {}}
        onBrowserCapture={() => {}}
        onBrowserSelectScreenshot={() => {}}
        databaseState={createDatabaseState()}
        onDatabaseRefreshProfiles={() => {}}
        onDatabaseSelectProfile={() => {}}
        onDatabaseInspectProfile={() => {}}
        onDatabaseOpenTable={() => {}}
        onDatabaseDraftChange={() => {}}
        onDatabaseRunQuery={() => {}}
        onDatabaseConfirmQuery={() => {}}
        onDatabaseCancelConfirmation={() => {}}
        onDatabaseExportResult={() => {}}
        onDatabaseSelectHistory={() => {}}
        languageState={createLanguageState()}
      />,
    );

    const activeSession = activeAgentSession(agentState);
    expect(activeSession?.id).toBe("agent-1");

    expect(renderResult.getByText("No context available")).toBeTruthy();
    fireEvent.click(renderResult.getByRole("button", { name: "edit" }));
    expect(onAgentModeChange).toHaveBeenCalledWith("edit");
    fireEvent.click(renderResult.getByLabelText("Export prompt"));
    expect(onAgentExport).toHaveBeenCalledTimes(1);
  });

  test("PanelBody renders DatabasePanel and routes database callbacks", () => {
    const onDatabaseRefreshProfiles = mock(() => {});
    const onDatabaseSelectProfile = mock<(profileId: string) => void>(() => {});
    const onDatabaseInspectProfile = mock<(profileId: string) => void>(() => {});
    const onDatabaseOpenTable = mock<(profileId: string, table: DatabaseTable) => void>(() => {});
    const onDatabaseDraftChange = mock<(query: string) => void>(() => {});
    const onDatabaseRunQuery = mock(() => {});
    const onDatabaseConfirmQuery = mock((_input: string) => {});
    const onDatabaseCancelConfirmation = mock(() => {});
    const onDatabaseExportResult = mock(() => {});
    const onDatabaseSelectHistory = mock<(entry: DatabaseQueryHistoryEntry) => void>(() => {});

    const renderResult = render(
      <PanelBody
        active="database"
        refreshKey={0}
        activeFilePath="src/app/AppShell.tsx"
        terminalSessions={[]}
        activeTerminalId={null}
        terminalCwdInput=""
        terminalError={null}
        taskState={{
          detectedTasks: [],
          runs: [],
          activeRunId: null,
          outputByRunId: {},
          problemsByRunId: {},
          pendingOutputByRunId: {},
          pendingFinishByRunId: {},
          contextPackByRunId: {},
          customCommand: "",
        }}
        taskError={null}
        gitState={{
          status: null,
          loading: false,
          error: null,
          commitMessage: "",
          selectedDiff: null,
          diffByKey: {},
          branches: [],
          graph: [],
        }}
        docsState={createDocsState()}
        contextPackNameById={{}}
        gitDecorations={{}}
        agentState={createAgentState()}
        availableAgentContext={[]}
        onAgentModeChange={() => {}}
        onAgentPromptChange={() => {}}
        onAgentToggleContext={() => {}}
        onAgentStartSession={() => {}}
        onAgentSelectSession={() => {}}
        onAgentApprove={() => {}}
        onAgentReject={() => {}}
        onAgentExport={() => {}}
        onOpenFile={() => Promise.resolve()}
        onCreateFile={async () => {}}
        onRenamePath={async () => {}}
        onDeletePath={async () => {}}
        onTerminalCwdInputChange={() => {}}
        onNewTerminal={() => Promise.resolve()}
        onActivateTerminal={() => {}}
        onCloseTerminal={() => Promise.resolve()}
        onRestartTerminal={() => Promise.resolve()}
        onTaskCustomCommandChange={() => {}}
        onRunTask={() => {}}
        onRunCustomTask={() => {}}
        onActivateTaskRun={() => {}}
        onStopTaskRun={() => Promise.resolve()}
        onRerunTaskRun={() => {}}
        onGitRefresh={() => Promise.resolve()}
        onGitCommitMessageChange={() => {}}
        onGitCommit={() => {}}
        onGitStage={() => {}}
        onGitUnstage={() => {}}
        onGitDiscard={() => {}}
        onGitOpenDiff={() => {}}
        onGitStash={() => {}}
        onGitFetch={() => {}}
        onGitPull={() => {}}
        onGitPush={() => {}}
        onGitCheckoutBranch={() => {}}
        onGitCreateBranch={() => {}}
        onGitOpenGraph={() => {}}
        onDocsRefresh={() => Promise.resolve()}
        onDocsSearch={() => {}}
        onDocsOpenPreview={() => Promise.resolve()}
        onDocsToggleSource={() => {}}
        onDocsPackNameChange={() => {}}
        onDocsCreatePack={() => Promise.resolve()}
        onDocsSelectPack={() => {}}
        onDocsDeletePack={() => Promise.resolve()}
        onDocsUsePackForActiveTask={() => Promise.resolve()}
        onDocsLinkPackToAgentSession={() => Promise.resolve()}
        onLanguageOpenDiagnostic={() => {}}
        onLanguageRefresh={() => Promise.resolve()}
        onLanguageRestartServer={() => {}}
        browserState={createBrowserState()}
        browserTargets={[]}
        browserCanCapture={false}
        onBrowserUrlInputChange={() => {}}
        onBrowserOpenUrl={() => {}}
        onBrowserOpenTarget={() => {}}
        onBrowserReload={() => {}}
        onBrowserHardReload={() => {}}
        onBrowserCapture={() => {}}
        onBrowserSelectScreenshot={() => {}}
        databaseState={databaseState({
          profiles: [
            {
              id: "db-local",
              workspace_root: "/repo",
              name: "local",
              kind: "SQLite",
              source: { SQLite: { path: "/repo/local.db" } },
              read_only: false,
              production: false,
              created_ms: 1,
              updated_ms: 1,
            },
          ],
          activeProfileId: "db-local",
          queryDraft: "SELECT 1",
          schemaByProfileId: {
            "db-local": {
              profile_id: "db-local",
              refreshed_ms: 1,
              tables: [
                {
                  schema: "main",
                  name: "users",
                  row_count: 3,
                  columns: [],
                },
              ],
            },
          },
          history: [
            {
              sql: "SELECT 1",
              kind: "Read",
              executed_ms: 5,
              affected_rows: null,
              row_count: 1,
            },
          ],
        })}
        onDatabaseRefreshProfiles={onDatabaseRefreshProfiles}
        onDatabaseSelectProfile={onDatabaseSelectProfile}
        onDatabaseInspectProfile={onDatabaseInspectProfile}
        onDatabaseOpenTable={onDatabaseOpenTable}
        onDatabaseDraftChange={onDatabaseDraftChange}
        onDatabaseRunQuery={onDatabaseRunQuery}
        onDatabaseConfirmQuery={onDatabaseConfirmQuery}
        onDatabaseCancelConfirmation={onDatabaseCancelConfirmation}
        onDatabaseExportResult={onDatabaseExportResult}
        onDatabaseSelectHistory={onDatabaseSelectHistory}
        languageState={createLanguageState()}
      />,
    );

    expect(renderResult.getByText("Databases")).toBeTruthy();
    fireEvent.click(
      renderResult.getByRole("button", {
        name: "Refresh database profiles",
      }),
    );
    expect(onDatabaseRefreshProfiles).toHaveBeenCalledTimes(1);

    fireEvent.click(
      renderResult.getByRole("button", {
        name: "Select local",
      }),
    );
    expect(onDatabaseSelectProfile).toHaveBeenCalledWith("db-local");

    fireEvent.click(
      renderResult.getByRole("button", {
        name: "Inspect schema local",
      }),
    );
    expect(onDatabaseInspectProfile).toHaveBeenCalledWith("db-local");

    fireEvent.click(
      renderResult.getByRole("button", {
        name: "Open table main.users",
      }),
    );
    expect(onDatabaseOpenTable).toHaveBeenCalledTimes(1);

    fireEvent.click(
      renderResult.getByRole("button", {
        name: "Run query",
      }),
    );
    expect(onDatabaseRunQuery).toHaveBeenCalledTimes(1);

    fireEvent.change(renderResult.getByLabelText("Database SQL query"), {
      target: { value: "SELECT * FROM audit_log" },
    });
    expect(onDatabaseDraftChange).toHaveBeenCalledWith("SELECT * FROM audit_log");

    fireEvent.click(
      renderResult.getByRole("button", {
        name: /Read\s+SELECT 1/i,
      }),
    );
    expect(onDatabaseSelectHistory).toHaveBeenCalledWith({
      sql: "SELECT 1",
      kind: "Read",
      executed_ms: 5,
      affected_rows: null,
      row_count: 1,
    });
  });

  test("executeDatabaseQueryRequest forwards exact confirmation text for confirmed SQL", async () => {
    const { workspaceId, workspaceRoot, profileId } = setupWorkspace();
    const calls: DatabaseQueryRequest[] = [];
    const executeDatabaseQuery = mock(async (request: DatabaseQueryRequest) => {
      calls.push(request);
      return {
        profile_id: profileId,
        sql: request.sql,
        classification: classifyDatabaseSql(request.sql),
        columns: [],
        rows: [],
        affected_rows: null,
        truncated: false,
        executed_ms: 11,
        history_id: "history-1",
      };
    });
    const refreshHistory = mock(async () => {});
    const onResultApplied = mock(() => {});
    const hasRegisteredWorkspace = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );
    const getWorkspaceRoot = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
      )?.path ?? null;

    await executeDatabaseQueryRequest({
      workspaceId,
      workspaceRoot,
      profileId,
      sql: "DROP TABLE users",
      requestId: 1,
      confirmation: "RUN DESTRUCTIVE SQL",
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseQuery: () => true,
      updateDatabase: setDatabase,
      executeDatabaseQuery,
      isActiveWorkspace: () => true,
      refreshHistory,
      onResultApplied,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].confirmation).toBe("RUN DESTRUCTIVE SQL");
    expect(refreshHistory).toHaveBeenCalledTimes(1);
    expect(onResultApplied).toHaveBeenCalledTimes(1);
  });

  test("executeDatabaseQueryRequest ignores stale query result when active profile changed", async () => {
    const { workspaceId, workspaceRoot, profileId } = setupWorkspace();
    const deferred = createDeferred<DatabaseQueryResult>();
    const executeDatabaseQuery = mock(() => deferred.promise);
    const refreshHistory = mock(async () => {});
    const onResultApplied = mock(() => {});
    const hasRegisteredWorkspace = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );
    const getWorkspaceRoot = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
      )?.path ?? null;

    const request = executeDatabaseQueryRequest({
      workspaceId,
      workspaceRoot,
      profileId,
      sql: "UPDATE users SET name = 'next'",
      requestId: 1,
      confirmation: null,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseQuery: () => true,
      updateDatabase: setDatabase,
      executeDatabaseQuery,
      isActiveWorkspace: () => true,
      refreshHistory,
      onResultApplied,
    });
    setDatabase(workspaceId, (database) => ({
      ...database,
      activeProfileId: `${profileId}-stale`,
    }));

    deferred.resolve({
      profile_id: profileId,
      sql: "UPDATE users SET name = 'next'",
      classification: classifyDatabaseSql("UPDATE users SET name = 'next'"),
      columns: [],
      rows: [],
      affected_rows: null,
      truncated: false,
      executed_ms: 9,
      history_id: "history-1",
    });

    await request;

    const database = workspaceViewStore.getState().viewFor(workspaceId).database;
    expect(onResultApplied).toHaveBeenCalledTimes(0);
    expect(refreshHistory).toHaveBeenCalledTimes(0);
    expect(database.loading).toBe(false);
    expect(database.activeResult).toBeNull();
    expect(database.error).toBeNull();
  });

  test("executeDatabaseQueryRequest does not write stale errors after profile switch", async () => {
    const { workspaceId, workspaceRoot, profileId } = setupWorkspace();
    const executeDatabaseQuery = mock(async () => {
      throw new Error("permission denied");
    });
    const hasRegisteredWorkspace = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );
    const getWorkspaceRoot = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
      )?.path ?? null;

    const request = executeDatabaseQueryRequest({
      workspaceId,
      workspaceRoot,
      profileId,
      sql: "UPDATE users SET name = 'next'",
      requestId: 1,
      confirmation: null,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseQuery: () => true,
      updateDatabase: setDatabase,
      executeDatabaseQuery,
      isActiveWorkspace: () => true,
      refreshHistory: async () => {},
      onResultApplied: () => {},
    });
    setDatabase(workspaceId, (database) => ({
      ...database,
      activeProfileId: `${profileId}-stale`,
    }));

    await request;

    const database = workspaceViewStore.getState().viewFor(workspaceId).database;
    expect(database.loading).toBe(false);
    expect(database.error).toBeNull();
  });

  test("inspectDatabaseProfileRequest clears loading on stale workspace path change", async () => {
    const { workspaceId, workspaceRoot, profileId } = setupWorkspace();
    const deferred = createDeferred<DatabaseSchema>();
    const inspectDatabaseSchema = mock(async () => deferred.promise);
    const updateDatabase = setDatabase;
    const hasRegisteredWorkspace = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );
    const getWorkspaceRoot = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
      )?.path ?? null;

    const request = inspectDatabaseProfileRequest({
      workspaceId,
      workspaceRoot,
      profileId,
      requestId: 1,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestInspectProfileRequest: () => true,
      updateDatabase,
      inspectDatabaseSchema,
    });

    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: `${workspaceRoot}-switched`,
          name: workspaceId,
          pinned: false,
        },
      ],
    });

    deferred.resolve({
      profile_id: profileId,
      refreshed_ms: 1,
      tables: [],
    });

    await request;

    const database = workspaceViewStore.getState().viewFor(workspaceId).database;
    expect(database.loading).toBe(false);
    expect(database.error).toBeNull();
    expect(database.schemaByProfileId[profileId]).toBeUndefined();
  });

  test("inspectDatabaseProfileRequest clears stale errors on workspace path change when inspect fails", async () => {
    const { workspaceId, workspaceRoot, profileId } = setupWorkspace();
    const deferred = createDeferred<DatabaseSchema>();
    const inspectDatabaseSchema = mock(async () => deferred.promise);
    const updateDatabase = setDatabase;
    const previousSchema: DatabaseSchema = {
      profile_id: profileId,
      refreshed_ms: 1,
      tables: [
        {
          schema: "main",
          name: "users",
          row_count: 5,
          columns: [],
        },
      ],
    };
    const hasRegisteredWorkspace = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );
    const getWorkspaceRoot = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
      )?.path ?? null;

    setDatabase(workspaceId, (database) => ({
      ...database,
      loading: true,
      error: "stale inspect error",
      schemaByProfileId: {
        [profileId]: previousSchema,
      },
    }));

    const request = inspectDatabaseProfileRequest({
      workspaceId,
      workspaceRoot,
      profileId,
      requestId: 1,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestInspectProfileRequest: () => true,
      updateDatabase,
      inspectDatabaseSchema,
    });

    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: `${workspaceRoot}-switched`,
          name: workspaceId,
          pinned: false,
        },
      ],
    });

    deferred.reject(new Error("database inspect failed"));

    await request;

    const database = workspaceViewStore.getState().viewFor(workspaceId).database;
    expect(database.loading).toBe(false);
    expect(database.error).toBeNull();
    expect(database.schemaByProfileId[profileId]).toEqual(previousSchema);
  });

  test("refreshDatabaseProfilesRequest does not write stale load errors after workspace path change", async () => {
    const { workspaceId, workspaceRoot, profileId } = setupWorkspace();
    const deferred = createDeferred<DatabaseProfile[]>();
    const listDatabaseProfiles = mock(async () => deferred.promise);
    const hasRegisteredWorkspace = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );
    const getWorkspaceRoot = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
      )?.path ?? null;

    setDatabase(workspaceId, (database) => ({
      ...database,
      loading: true,
      error: "previous profile load error",
      profiles: [
        {
          id: profileId,
          workspace_root: workspaceRoot,
          name: "local.db",
          kind: "SQLite",
          source: { SQLite: { path: `${workspaceRoot}/${profileId}.db` } },
          read_only: false,
          production: false,
          created_ms: 10,
          updated_ms: 11,
        },
      ],
    }));

    const request = refreshDatabaseProfilesRequest({
      workspaceId,
      workspaceRoot,
      requestId: 1,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseProfilesRequest: () => true,
      isActiveWorkspace: (currentWorkspaceId) =>
        workspaceStore.getState().registry.active_workspace_id === currentWorkspaceId,
      updateDatabase: setDatabase,
      listDatabaseProfiles,
    });

    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: `${workspaceRoot}-switched`,
          name: workspaceId,
          pinned: false,
        },
      ],
    });

    deferred.reject(new Error("database profile list failed"));

    await request;

    const database = workspaceViewStore.getState().viewFor(workspaceId).database;
    expect(database.loading).toBe(false);
    expect(database.error).toBeNull();
    expect(database.profiles).toEqual([
      {
        id: profileId,
        workspace_root: workspaceRoot,
        name: "local.db",
        kind: "SQLite",
        source: { SQLite: { path: `${workspaceRoot}/${profileId}.db` } },
        read_only: false,
        production: false,
        created_ms: 10,
        updated_ms: 11,
      },
    ]);
  });

  test("exportDatabaseQueryResultRequest does not write export when active result changed", async () => {
    const { workspaceId, workspaceRoot, profileId } = setupWorkspace();
    const initialResult = {
      profile_id: profileId,
      sql: "SELECT 1",
      classification: classifyDatabaseSql("SELECT 1"),
      columns: [],
      rows: [],
      affected_rows: null,
      truncated: false,
      executed_ms: 7,
      history_id: "history-1",
    };
    const replacementResult = {
      ...initialResult,
      executed_ms: 8,
      history_id: "history-2",
    };
    const deferred = createDeferred<{ path: string }>();
    const exportDatabaseQueryResult = mock(async () => deferred.promise);
    const hasRegisteredWorkspace = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );
    const getWorkspaceRoot = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
      )?.path ?? null;
    const isLatestDatabaseExportRequest = () => true;

    setDatabase(workspaceId, (database) => ({
      ...database,
      activeResult: initialResult,
      export: null,
    }));

    const request = exportDatabaseQueryResultRequest({
      workspaceId,
      workspaceRoot,
      requestId: 1,
      resultId: `${profileId}:history-1:7`,
      activeResult: initialResult,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseExportRequest,
      updateDatabase: setDatabase,
      exportDatabaseQueryResult,
    });

    setDatabase(workspaceId, (database) => ({
      ...database,
      activeResult: replacementResult,
    }));

    deferred.resolve({ path: "/tmp/export.csv" });
    await request;

    expect(workspaceViewStore.getState().viewFor(workspaceId).database.export).toBeNull();
  });

  test("databaseTableSql and classifyDatabaseSql return conservative SQL routing text", () => {
    expect(databaseTableSql("SQLite", { schema: null, name: "users" })).toBe(
      'SELECT * FROM "users" LIMIT 100',
    );
    expect(
      databaseTableSql("SQLite", { schema: "main", name: "users" }),
    ).toBe('SELECT * FROM "main"."users" LIMIT 100');
    expect(
      databaseTableSql("MsSql", { schema: "dbo", name: "audit_log" }),
    ).toBe('SELECT TOP 100 * FROM [dbo].[audit_log]');

    expect(classifyDatabaseSql("SELECT * FROM users").kind).toBe("Read");
    expect(
      classifyDatabaseSql("UPDATE users SET name = 'a'").confirmation_text,
    ).toBe("RUN MUTATION");
    expect(
      classifyDatabaseSql("DROP TABLE users").confirmation_text,
    ).toBe("RUN DESTRUCTIVE SQL");
    expect(
      classifyDatabaseSql("SELECT 1; DROP TABLE users").confirmation_text,
    ).toBe("RUN DESTRUCTIVE SQL");
    expect(classifyDatabaseSql("EXPLAIN ANALYZE DELETE FROM users").kind).toBe(
      "Mutation",
    );
    expect(classifyDatabaseSql("EXPLAIN ANALYZE DELETE FROM users").confirmation_text).toBe(
      "RUN MUTATION",
    );
    expect(classifyDatabaseSql("EXPLAIN SELECT 1").kind).toBe("Read");
    expect(
      classifyDatabaseSql("WITH cte AS (SELECT 1) DELETE FROM users").kind,
    ).toBe("Mutation");
    expect(
      classifyDatabaseSql(
        "WITH deleted AS (DELETE FROM users RETURNING *) SELECT * FROM deleted",
      ).kind,
    ).toBe("Mutation");
    expect(
      classifyDatabaseSql("WITH recent AS (SELECT 1) SELECT * FROM recent").kind,
    ).toBe("Read");
    expect(
      classifyDatabaseSql("PRAGMA journal_mode = WAL").kind,
    ).toBe("Destructive");
    expect(
      classifyDatabaseSql("UNKNOWN COMMAND something").kind,
    ).toBe("Destructive");
    expect(
      classifyDatabaseSql("SELECT '--'; DROP TABLE users").kind,
    ).toBe("Destructive");
    expect(
      classifyDatabaseSql("SELECT 'x -- y'; DROP TABLE users").confirmation_text,
    ).toBe("RUN DESTRUCTIVE SQL");
    expect(
      classifyDatabaseSql("SELECT '/*'; DROP TABLE users; SELECT '*/'").kind,
    ).toBe("Destructive");
    expect(classifyDatabaseSql("").requires_confirmation).toBe(true);
    expect(classifyDatabaseSql("").confirmation_text).toBe(
      "RUN DESTRUCTIVE SQL",
    );
  });
});
