import { listen } from "@tauri-apps/api/event";
import {
  Bell,
  BookOpenText,
  Bug,
  ChevronDown,
  FileCode2,
  Database,
  Folder,
  GitBranch,
  Globe,
  PanelLeft,
  Play,
  Plus,
  RotateCw,
  Save,
  Server,
  SplitSquareHorizontal,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ActivityRail, type ActivityId } from "./activity-rail";
import { CommandPalette } from "./CommandPalette";
import { BrowserPanel } from "../features/browser/BrowserPanel";
import { BrowserPreviewSurface } from "../features/browser/BrowserPreviewSurface";
import {
  continueDebugSession,
  disconnectDebugSession,
  evaluateDebugExpression,
  getDebugScopes,
  getDebugStackTrace,
  getDebugVariables,
  listDebugLaunchConfigs,
  listDebugSessions,
  listenDebugConsole,
  listenDebugExited,
  listenDebugSession,
  listenDebugStopped,
  pauseDebugSession,
  setDebugBreakpointsCommand,
  startDebugSession,
  stepOverDebugSession,
} from "../features/debug/debug-api";
import { DebugConsoleSurface } from "../features/debug/DebugConsoleSurface";
import { DebugPanel } from "../features/debug/DebugPanel";
import {
  addDebugWatch,
  appendDebugConsole,
  beginDebugRequest,
  createDebugState,
  markDebugSessionEvent,
  removeDebugWatch,
  replaceDebugLaunchConfigs,
  replaceDebugStackSnapshot,
  replaceDebugSessions,
  selectDebugConfig,
  setDebugBreakpoints,
  setDebugError,
  setDebugMode,
  toggleDebugBreakpoint,
  updateDebugWatchResult,
  type DebugLaunchConfig,
  type DebugConsoleEvent,
  type DebugSessionEvent,
  type DebugSessionInfo,
  type DebugSourceBreakpointInput,
  type DebugStackFrame,
  type DebugViewState,
} from "../features/debug/debug-model";
import {
  DatabasePanel,
} from "../features/database/DatabasePanel";
import { DatabaseResultView } from "../features/database/DatabaseResultView";
import { ExtensionPanel } from "../features/extensions/ExtensionPanel";
import {
  listExtensionStatuses,
  recordExtensionPerformance,
  setExtensionEnabled,
} from "../features/extensions/extension-api";
import {
  createExtensionState,
  extensionBadgeCount,
  extensionCommands,
  replaceExtensionStatuses,
  setExtensionError,
  setExtensionLoading,
  toggleExtensionStatus,
  type ExtensionCommandContribution,
  type ExtensionViewState,
  type ExtensionWorkspaceStatus,
} from "../features/extensions/extension-model";
import {
  appendDiagnosticEvent,
  listDiagnosticEvents,
  metricSnapshot,
} from "../features/diagnostics/diagnostics-api";
import {
  createDiagnosticsState,
  formatBytes,
  storeDiagnosticEvents,
  storeMetricSnapshot,
  type DiagnosticsViewState,
} from "../features/diagnostics/diagnostics-model";
import { RemotePanel } from "../features/remote/RemotePanel";
import { SshTerminalSurface } from "../features/remote/SshTerminalSurface";
import {
  closeSshTerminalSession,
  connectRemoteHost,
  downloadSftpFile,
  listRemoteHosts,
  listSftpDirectory,
  listSshTerminalSessions,
  listenSshTerminalExit,
  listenSshTerminalOutput,
  runRemoteCommand,
  saveRemoteHost,
  spawnSshTerminal,
  uploadSftpFile,
  writeSshTerminal,
} from "../features/remote/remote-api";
import {
  bufferSshTerminalExit,
  closeSshTerminal,
  markRemoteConnection,
  markSshTerminalExited,
  recordRemoteTransfer,
  replaceRemoteHosts,
  selectRemoteHost,
  setRemoteCommandResult,
  setRemoteMode,
  setSftpEntries,
  upsertSshTerminal,
  type RemoteHostProfile,
  type RemoteViewState,
  type SshTerminalSessionInfo,
} from "../features/remote/remote-model";
import {
  discardUnsavedBackup,
  listUnsavedBackups,
  saveUnsavedBackup,
} from "../features/recovery/recovery-api";
import {
  createRecoveryState,
  discardRecoveryBackup,
  restoreRecoveryBackup,
  storeRecoveryBackups,
  type RecoveryViewState,
  type UnsavedBackup,
} from "../features/recovery/recovery-model";
import {
  importKeybindings,
  loadSettings,
} from "../features/settings/settings-api";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import {
  createSettingsState,
  selectSettingsCategory,
  setKeybindingImportDraft,
  setKeybindingImportError,
  setSettingsError,
  storeSettings,
  type SettingsCategory,
  type SettingsViewState,
} from "../features/settings/settings-model";
import {
  beginDatabaseQuery,
  databaseBadgeCount,
  type DatabaseKind,
  MAX_DATABASE_ROWS,
  type DatabaseExport,
  type DatabaseQueryRequest,
  type DatabaseQueryResult,
  type DatabaseSchema,
  type DatabaseQueryHistoryEntry,
  type DatabaseProfile,
  type DatabaseTable,
  type QueryClassification,
  type QueryKind,
  replaceDatabaseProfiles,
  requireDatabaseConfirmation,
  selectDatabaseProfile,
  storeDatabaseQueryResult,
  storeDatabaseSchema,
  updateDatabaseDraft,
  type DatabaseViewState,
} from "../features/database/database-model";
import {
  executeDatabaseQuery,
  exportDatabaseQueryResult,
  inspectDatabaseSchema,
  listDatabaseProfiles,
  listDatabaseQueryHistory,
} from "../features/database/database-api";
import {
  createContextPack,
  deleteContextPack,
  getDocPreview,
  getDocsIndex,
  listContextPacks,
  linkContextPack,
  searchDocs,
} from "../features/docs/docs-api";
import { DocsPanel } from "../features/docs/DocsPanel";
import { MarkdownPreview } from "../features/docs/MarkdownPreview";
import {
  activeDocPreview,
  type DocPreview,
  beginDocPreview,
  contextPackByLinkedTaskRunId,
  createDocsRequestIdentity,
  docsBadgeCount,
  docsPreviewPathLabel,
  isCurrentDocsLoadRequest,
  nextDocsLoadRequest,
  replaceDocsIndex,
  selectDocSource,
  selectedDocPaths,
  shouldApplyDocPreview,
  shouldApplyDocsResult,
  storeDocPreview,
  storeContextPack,
  updateContextPackDraftName,
  type DocsLoadRequestState,
  type DocsRequestIdentity,
  type DocsViewState,
} from "../features/docs/docs-model";
import {
  exportAgentPrompt,
  listAgentSessions,
  startAgentSession,
  updateAgentApproval,
} from "../features/agents/agent-api";
import {
  activeAgentSession,
  agentBadgeCount,
  agentContextFromDiagnostic,
  agentContextFromDoc,
  agentContextFromDiff,
  agentContextFromFile,
  agentContextFromTerminal,
  replaceAgentSessions,
  selectAgentSession,
  selectedContextItems,
  setAgentMode,
  setAgentPromptDraft,
  storeAgentSession,
  toggleAgentContext,
  type AgentContextItem,
  type AgentMode,
  type AgentViewState,
} from "../features/agents/agent-model";
import { AgentPanel } from "../features/agents/AgentPanel";
import {
  closeLanguageDocument,
  getLanguageServerStatus,
  getLanguageServerLogs,
  getWorkspaceDiagnostics,
  openLanguageDocument,
  restartLanguageServer as restartLanguageServerCommand,
  requestLanguageCodeActions,
  requestLanguageCompletion,
  requestLanguageDefinition,
  requestLanguageHover,
  requestLanguageReferences,
  requestLanguageRename,
} from "../features/language/language-api";
import {
  isCurrentLanguageRefreshRequest,
  nextLanguageRefreshRequest,
  replaceDiagnostics,
  diagnosticsForPath,
  isLspSupportedDocumentPath,
  lspDocumentChangesForWorkspacePaths,
  lspDocumentPathForWorkspace,
  replaceServerStatuses,
  storeServerLogs,
  selectDiagnosticBadge,
  type LspDiagnostic,
  type LanguageRefreshRequestState,
  type LanguageServerStatus,
  type LanguageViewState,
} from "../features/language/language-model";
import {
  browserScreenshotToContext,
  type BrowserScreenshot,
  type BrowserViewState,
  type BrowserUrl,
  type DevServerTarget,
  detectDevServerTargets,
  hardReloadBrowser,
  openBrowserUrl,
  reloadBrowser,
  setBrowserError,
  setBrowserUrlInput,
  storeBrowserScreenshot,
  updateBrowserBounds,
} from "../features/browser/browser-model";
import {
  validateBrowserUrl,
  captureBrowserPreview,
} from "../features/browser/browser-api";
import {
  createLoadedFileKey,
  isLoadedEditorForActiveFile,
  shouldLoadActiveEditor,
  updateLoadedFileContent,
  type LoadedFile,
} from "./editor-buffer-state";
import {
  createTextFile,
  deletePath,
  renamePath,
  readTextFile,
  unwatchWorkspace,
  watchWorkspace,
  writeTextFile,
  type WatchWorkspaceHandle,
} from "../features/files/file-api";
import {
  clearDraft,
  createDraftKey,
  loadDraft,
  saveDraft,
} from "../features/files/draft-store";
import {
  checkoutGitBranch,
  commitGit,
  createGitBranch,
  discardGitPaths,
  fetchGit,
  getGitCommitGraph,
  getGitDiffFile,
  getGitStatus,
  listGitBranches,
  pullGit,
  pushGit,
  rebaseGitOnto,
  resetGitHard,
  stageGitPaths,
  stashGit,
  unstageGitPaths,
} from "../features/git/git-api";
import { GitDiffView } from "../features/git/GitDiffView";
import { GitGraphView } from "../features/git/GitGraphView";
import { GitPanel } from "../features/git/GitPanel";
import { LanguagePanel } from "../features/language/LanguagePanel";
import {
  changeBadgeCount,
  confirmationTextForGitAction,
  decorationMapFromStatus,
  replaceGitStatus,
  selectDiff,
  setGitError,
  setGitLoading,
  shouldRefreshGitAfterFileEvent,
  shouldRefreshGitAfterTask,
  statusBranchLabel,
  storeBranches,
  storeDiff,
  storeGraph,
  type GitConfirmationAction,
  updateGitCommitMessage,
  type GitRepositoryStatus,
  type GitViewState,
} from "../features/git/git-model";
import {
  applySavedVersion,
  closeFileTab,
  markExternalChangeFromDisk,
  markFileDirty,
  openFileTab,
  shouldApplyWorkspaceFileChangedEvent,
  type FileVersion,
  type WatchedWorkspaceIdentity,
} from "../features/files/file-model";
import {
  fileIconClassFromName,
  gitDecorationForPath,
  isSameOrDescendant,
  parentNameFromPath,
  relativePathFromWorkspace,
  removeEditorPath,
  renameEditorPath,
  replacePathPrefix,
  surfaceAfterEditorRemoval,
} from "../features/workspace/file-tree-model";
import { FileTreePanel } from "../features/workspace/FileTreePanel";
import { SearchPanel } from "../features/workspace/SearchPanel";
import { TaskPanel } from "../features/tasks/TaskPanel";
import {
  listTaskRuns,
  listWorkspaceTasks,
  onTaskFinished,
  onTaskOutput,
  runWorkspaceTask as invokeRunWorkspaceTask,
  stopTaskRun,
} from "../features/tasks/task-api";
import {
  activateTaskRun,
  appendTaskOutput,
  finishTaskRun,
  linkTaskRunContextPack,
  replaceTaskRunContextPacks,
  replaceDetectedTasks,
  replaceTaskRuns,
  rerunnableTaskForState,
  runningTaskRunForState,
  setCustomCommand,
  setTaskErrorForWorkspace,
  stopTaskRunInState,
  taskErrorForWorkspace,
  upsertTaskRun,
  type TaskErrorByWorkspace,
  type TaskRun,
  type TaskViewState,
  type WorkspaceTask,
} from "../features/tasks/task-model";
import { TerminalPanel } from "../features/terminal/TerminalPanel";
import {
  closeTerminalSession,
  onTerminalExit,
  onTerminalOutput,
  spawnTerminalSession,
  writeTerminalSession,
} from "../features/terminal/terminal-api";
import {
  activateTerminal,
  bufferTerminalExit,
  closeTerminal,
  markTerminalExited,
  type TerminalSessionInfo,
  upsertTerminal,
} from "../features/terminal/terminal-model";
import {
  appendTerminalReplayOutput,
  clearTerminalReplayOutput,
  replayTerminalOutput,
} from "../features/terminal/terminal-replay-buffer";
import {
  useWorkspaceViewStore,
  workspaceViewStore,
  type Surface,
} from "./workspace-view-state";
import { useWorkspaceStore, workspaceStore } from "./workspace-store";
import { WorkspaceSwitcher } from "./workspace-switcher";
import {
  commandItemsForPalette,
  isCoreExtensionContribution,
  registeredCoreCommandIds,
} from "./command-registry";

type FileChangedPayload = {
  workspace_root: string;
  path: string;
  version: FileVersion | null;
};

type GitConfirmationRequest = {
  action: GitConfirmationAction;
  title: string;
  detail: string;
  run: (confirmation: string) => Promise<unknown>;
};

type RecoverySaveIntent =
  | {
      state: "dirty";
      workspaceRoot: string;
      content: string;
      version: FileVersion | null;
      epoch: number;
    }
  | {
      state: "clean";
      workspaceRoot: string;
      epoch: number;
    };

const EditorTab = lazy(() =>
  import("../features/editor/EditorTab").then((module) => ({
    default: module.EditorTab,
  })),
);

const TerminalTab = lazy(() =>
  import("../features/terminal/TerminalTab").then((module) => ({
    default: module.TerminalTab,
  })),
);

const panelTitles: Record<ActivityId, string> = {
  explorer: "Explorer",
  search: "Search",
  git: "Source Control",
  debug: "Debug",
  terminal: "Terminal",
  tasks: "Tasks",
  docs: "Docs",
  language: "Language",
  agents: "Agents",
  remote: "Remote",
  database: "Database",
  extensions: "Extensions",
  browser: "Browser",
  settings: "Settings",
};

const coreCommandIdSet = new Set(registeredCoreCommandIds());

export type AgentAvailableContextSource = {
  workspaceRoot: string;
  activeWorkspaceId: string | null;
  loadedFile: LoadedFile | null;
  docsPreviews: Array<
    Pick<DocPreview, "path" | "title" | "content">
  >;
  browserScreenshots: BrowserScreenshot[];
  selectedDiff:
    | {
        path: string;
        original_path: string | null;
        staged: boolean;
        binary: boolean;
        truncated: boolean;
        raw: string;
      }
    | null;
  activeFileDiagnostics: LspDiagnostic[];
  terminalSession: TerminalSessionInfo | null;
  terminalOutput: string;
};

export function activeLoadedFileForWorkspace(
  loadedFile: LoadedFile | null,
  activeWorkspaceId: string | null,
): LoadedFile | null {
  if (activeWorkspaceId === null || loadedFile === null) {
    return null;
  }

  return loadedFile.workspaceId === activeWorkspaceId ? loadedFile : null;
}

export function collectAgentAvailableContext(
  source: AgentAvailableContextSource,
): AgentContextItem[] {
  const context: AgentContextItem[] = [];

  if (
    source.activeWorkspaceId &&
    source.loadedFile &&
    source.loadedFile.workspaceId === source.activeWorkspaceId
  ) {
    context.push(
      agentContextFromFile({
        workspaceRoot: source.workspaceRoot,
        path: source.loadedFile.path,
        content: source.loadedFile.content,
      }),
    );
  }

  for (const docsPreview of source.docsPreviews) {
    context.push(
      agentContextFromDoc({
        path: docsPreview.path,
        title: docsPreview.title,
        content: docsPreview.content,
      }),
    );
  }

  if (source.selectedDiff) {
    context.push(
      agentContextFromDiff({
        path: source.selectedDiff.path,
        staged: source.selectedDiff.staged,
        raw: source.selectedDiff.raw,
      }),
    );
  }

  for (const diagnostic of source.activeFileDiagnostics) {
    context.push(
      agentContextFromDiagnostic({
        path: diagnostic.path,
        message: diagnostic.message,
        severity: diagnostic.severity,
        line: diagnostic.range.start_line + 1,
      }),
    );
  }

  if (source.terminalSession) {
    context.push(
      agentContextFromTerminal({
        sessionId: source.terminalSession.id,
        name: source.terminalSession.name,
        output: source.terminalOutput,
      }),
    );
  }

  for (const screenshot of source.browserScreenshots) {
    if (screenshot.workspace_root !== source.workspaceRoot) {
      continue;
    }
    context.push(browserScreenshotToContext(screenshot));
  }

  return context;
}

export type BrowserSplitEditorParams = {
  surface: Surface;
  activeWorkspaceId: string | null;
  activePath: string | null;
  loadedFile: LoadedFile | null;
};

export function shouldShowBrowserSplitEditor({
  surface,
  activeWorkspaceId,
  activePath,
  loadedFile,
}: BrowserSplitEditorParams): boolean {
  return (
    surface === "browser-preview" &&
    activeWorkspaceId !== null &&
    activePath !== null &&
    loadedFile?.workspaceId === activeWorkspaceId &&
    loadedFile.path === activePath
  );
}

type BrowserPreviewSplitSurfaceProps = {
  showEditor: boolean;
  editor: ReactNode;
  preview: ReactNode;
};

export function BrowserPreviewSplitSurface({
  showEditor,
  editor,
  preview,
}: BrowserPreviewSplitSurfaceProps) {
  return (
    <div className={`browser-split${showEditor ? " has-editor" : ""}`}>
      {showEditor ? (
        <div className="browser-split-editor">{editor}</div>
      ) : null}
      {preview}
    </div>
  );
}

type OpenBrowserPreviewParams = {
  workspaceId: string;
  value: string;
  requestId: number;
  isLatestRequest: (workspaceId: string, requestId: number) => boolean;
  onOpenPanel: () => void;
  onSetSurface: (surface: Surface) => void;
  onOpenUrl: (parsed: BrowserUrl) => void;
  onValidationError: (error: unknown) => void;
};

export type BrowserValidationRequestState = {
  [workspaceId: string]: number;
};

export function startBrowserValidationRequest(
  state: BrowserValidationRequestState,
  workspaceId: string,
): number {
  const next = (state[workspaceId] ?? 0) + 1;
  state[workspaceId] = next;
  return next;
}

export function isLatestBrowserValidationRequest(
  state: BrowserValidationRequestState,
  workspaceId: string,
  requestId: number,
): boolean {
  return state[workspaceId] === requestId;
}

export function openBrowserPreviewWithValidation(
  {
    workspaceId,
    value,
    requestId,
    isLatestRequest,
    onOpenPanel,
    onSetSurface,
    onOpenUrl,
    onValidationError,
  }: OpenBrowserPreviewParams,
  validate: (value: string) => Promise<BrowserUrl>,
): Promise<void> {
  if (!workspaceId) {
    onOpenPanel();
    return Promise.resolve();
  }

  const trimmed = value.trim();
  if (!trimmed) {
    onOpenPanel();
    return Promise.resolve();
  }

  onOpenPanel();
  return validate(trimmed)
    .then((parsedUrl) => {
      if (!isLatestRequest(workspaceId, requestId)) {
        return;
      }

      onOpenUrl(parsedUrl);
      onSetSurface("browser-preview");
    })
    .catch((error) => {
      if (!isLatestRequest(workspaceId, requestId)) {
        return;
      }

      onValidationError(error);
    });
}

export type BrowserCaptureRequestState = {
  [workspaceId: string]: number;
};

export function startBrowserCaptureRequest(
  state: BrowserCaptureRequestState,
  workspaceId: string,
): number {
  const next = (state[workspaceId] ?? 0) + 1;
  state[workspaceId] = next;
  return next;
}

export function isLatestBrowserCaptureRequest(
  state: BrowserCaptureRequestState,
  workspaceId: string,
  requestId: number,
): boolean {
  return state[workspaceId] === requestId;
}

type CaptureBrowserPreviewResultParams = {
  workspaceId: string;
  requestId: number;
  isLatestRequest: (workspaceId: string, requestId: number) => boolean;
  request: {
    workspaceRoot: string;
    request: {
      url: string;
      title: string;
      bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    };
  };
  onSuccess: (screenshot: BrowserScreenshot) => void;
  onFailure: (error: unknown) => void;
};

export function captureBrowserPreviewWithValidation(
  {
    workspaceId,
    requestId,
    isLatestRequest,
    request,
    onSuccess,
    onFailure,
  }: CaptureBrowserPreviewResultParams,
  capture: (
    args: CaptureBrowserPreviewResultParams["request"],
  ) => Promise<BrowserScreenshot>,
) {
  void capture(request)
    .then((screenshot) => {
      if (!isLatestRequest(workspaceId, requestId)) {
        return;
      }

      onSuccess(screenshot);
    })
    .catch((error) => {
      if (!isLatestRequest(workspaceId, requestId)) {
        return;
      }

      onFailure(error);
    });
}

function languageForPath(path: string): string {
  const lower = path.toLowerCase();
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts")
  ) {
    return "typescript";
  }
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return "javascript";
  }
  if (lower.endsWith(".rs")) return "rust";
  if (
    lower.endsWith(".py") ||
    lower.endsWith(".pyw") ||
    lower.endsWith(".pyi")
  ) {
    return "python";
  }
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".toml")) return "toml";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  return "plaintext";
}

function localStorageOrNull(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function tryLoadDraft(workspaceId: string, path: string): string | null {
  const storage = localStorageOrNull();
  if (!storage) {
    return null;
  }

  try {
    return loadDraft(storage, createDraftKey(workspaceId, path));
  } catch {
    return null;
  }
}

function trySaveDraft(workspaceId: string, path: string, content: string): void {
  const storage = localStorageOrNull();
  if (!storage) {
    return;
  }

  try {
    saveDraft(storage, createDraftKey(workspaceId, path), content);
  } catch {
    // Draft persistence is best-effort so browser storage failures do not break editing.
  }
}

function tryClearDraft(workspaceId: string, path: string): void {
  const storage = localStorageOrNull();
  if (!storage) {
    return;
  }

  try {
    clearDraft(storage, createDraftKey(workspaceId, path));
  } catch {
    // Clearing drafts is also best-effort.
  }
}

function workspaceIdFromTerminalSessionId(sessionId: string): string | null {
  const marker = ":terminal-";
  const markerIndex = sessionId.indexOf(marker);
  return markerIndex > 0 ? sessionId.slice(0, markerIndex) : null;
}

function workspaceIdFromTaskRunId(runId: string): string | null {
  const marker = ":task-";
  const markerIndex = runId.indexOf(marker);
  return markerIndex > 0 ? runId.slice(0, markerIndex) : null;
}

function quoteIdentifierDouble(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteIdentifierBracket(value: string): string {
  return `[${value.replace(/\]/g, "]]")}]`;
}

export function databaseTableSql(
  kind: DatabaseKind,
  table: { schema: string | null; name: string },
): string {
  const escapedName = {
    SQLite: quoteIdentifierDouble(table.name),
    PostgreSQL: quoteIdentifierDouble(table.name),
    MsSql: quoteIdentifierBracket(table.name),
  }[kind];
  if (kind === "MsSql") {
    if (table.schema) {
      return `SELECT TOP 100 * FROM ${quoteIdentifierBracket(table.schema)}.${escapedName}`;
    }

    return `SELECT TOP 100 * FROM ${escapedName}`;
  }

  if (table.schema) {
    return `SELECT * FROM ${quoteIdentifierDouble(table.schema)}.${escapedName} LIMIT 100`;
  }

  return `SELECT * FROM ${escapedName} LIMIT 100`;
}

function stripDatabaseSqlComments(sql: string): string {
  let cursor = 0;
  let normalized = "";

  while (cursor < sql.length) {
    const char = sql[cursor];
    if (char === "'" || char === '"') {
      const end = char === "'" ? skipSingleQuote(sql, cursor) : skipDoubleQuote(sql, cursor);
      normalized += sql.slice(cursor, end);
      cursor = end;
      continue;
    }

    if (char === "-" && sql[cursor + 1] === "-") {
      cursor = skipLineComment(sql, cursor);
      normalized += " ";
      continue;
    }

    if (char === "/" && sql[cursor + 1] === "*") {
      cursor = skipBlockComment(sql, cursor);
      normalized += " ";
      continue;
    }

    normalized += char;
    cursor += 1;
  }

  return normalized;
}

type DatabaseQueryRunResultContext = {
  workspaceId: string;
  workspaceRoot: string;
  profileId: string;
  sql: string;
  requestId: number;
  confirmation: string | null;
  hasRegisteredWorkspace: (workspaceId: string) => boolean;
  getWorkspaceRoot: (workspaceId: string) => string | null;
  isLatestDatabaseQuery: (workspaceId: string, requestId: number) => boolean;
  updateDatabase: (
    workspaceId: string,
    update: (database: DatabaseViewState) => DatabaseViewState,
  ) => void;
  executeDatabaseQuery: (request: DatabaseQueryRequest) => Promise<DatabaseQueryResult>;
  isActiveWorkspace: (workspaceId: string) => boolean;
  refreshHistory: (
    workspaceId: string,
    workspaceRoot: string,
    profileId: string,
  ) => Promise<void>;
  onResultApplied: () => void;
};

export async function executeDatabaseQueryRequest({
  workspaceId,
  workspaceRoot,
  profileId,
  sql,
  requestId,
  confirmation,
  hasRegisteredWorkspace,
  getWorkspaceRoot,
  isLatestDatabaseQuery,
  updateDatabase,
  executeDatabaseQuery: executeRequest,
  isActiveWorkspace,
  refreshHistory,
  onResultApplied,
}: DatabaseQueryRunResultContext): Promise<void> {
  const trimmed = sql.trim();
  if (!trimmed) {
    updateDatabase(workspaceId, (database) => ({
      ...database,
      loading: false,
      error: "Database query is empty",
      confirmation: null,
    }));
    return;
  }

  const request: DatabaseQueryRequest = {
    profile_id: profileId,
    sql: trimmed,
    limit: MAX_DATABASE_ROWS,
    ...(confirmation ? { confirmation } : {}),
  };

  updateDatabase(workspaceId, beginDatabaseQuery);

  const isActiveRequest = () =>
    isLatestDatabaseQuery(workspaceId, requestId) &&
    hasRegisteredWorkspace(workspaceId);

  try {
    const result = await executeRequest(request);

    if (!isActiveRequest()) {
      return;
    }

    if (getWorkspaceRoot(workspaceId) !== workspaceRoot) {
      updateDatabase(workspaceId, (database) => ({
        ...database,
        loading: false,
        error: null,
      }));
      return;
    }

    const currentDatabase = workspaceViewStore.getState().viewFor(workspaceId).database;
    const shouldApplyResult =
      currentDatabase.activeProfileId === profileId &&
      currentDatabase.activeProfileId === result.profile_id;

    if (!shouldApplyResult) {
      updateDatabase(workspaceId, (database) => ({
        ...database,
        loading: false,
        error: null,
      }));
      return;
    }

    updateDatabase(workspaceId, (database) =>
      storeDatabaseQueryResult(database, result),
    );
    if (isActiveWorkspace(workspaceId)) {
      onResultApplied();
    }
    await refreshHistory(workspaceId, workspaceRoot, profileId);
  } catch (error) {
    if (!isActiveRequest()) {
      return;
    }

    if (getWorkspaceRoot(workspaceId) !== workspaceRoot) {
      updateDatabase(workspaceId, (database) => ({
        ...database,
        loading: false,
        error: null,
      }));
      return;
    }

    const currentDatabase = workspaceViewStore.getState().viewFor(workspaceId).database;
    updateDatabase(workspaceId, (database) => ({
      ...database,
      loading: false,
      error:
        currentDatabase.activeProfileId === profileId
          ? `Database query failed: ${terminalErrorMessage(error)}`
          : null,
    }));
  }
}

type InspectDatabaseProfileRunContext = {
  workspaceId: string;
  workspaceRoot: string;
  profileId: string;
  requestId: number;
  hasRegisteredWorkspace: (workspaceId: string) => boolean;
  getWorkspaceRoot: (workspaceId: string) => string | null;
  isLatestInspectProfileRequest: (workspaceId: string, requestId: number) => boolean;
  updateDatabase: (
    workspaceId: string,
    update: (database: DatabaseViewState) => DatabaseViewState,
  ) => void;
  inspectDatabaseSchema: (profileId: string) => Promise<DatabaseSchema>;
};

export async function inspectDatabaseProfileRequest({
  workspaceId,
  workspaceRoot,
  profileId,
  requestId,
  hasRegisteredWorkspace,
  getWorkspaceRoot,
  isLatestInspectProfileRequest,
  updateDatabase,
  inspectDatabaseSchema: inspectSchema,
}: InspectDatabaseProfileRunContext): Promise<void> {
  try {
    const schema = await inspectSchema(profileId);

    if (!isLatestInspectProfileRequest(workspaceId, requestId)) {
      return;
    }

    const currentDatabase = workspaceViewStore.getState().viewFor(workspaceId).database;
    if (
      !hasRegisteredWorkspace(workspaceId) ||
      getWorkspaceRoot(workspaceId) !== workspaceRoot ||
      currentDatabase.activeProfileId !== profileId
    ) {
      updateDatabase(workspaceId, (database) => ({
        ...database,
        loading: false,
        error: null,
      }));
      return;
    }

    updateDatabase(workspaceId, (database) =>
      storeDatabaseSchema(
        {
          ...database,
          loading: false,
          error: null,
        },
        schema,
      ),
    );
  } catch (error) {
    if (!isLatestInspectProfileRequest(workspaceId, requestId)) {
      return;
    }

    const currentDatabase = workspaceViewStore.getState().viewFor(workspaceId).database;
    if (
      !hasRegisteredWorkspace(workspaceId) ||
      getWorkspaceRoot(workspaceId) !== workspaceRoot ||
      currentDatabase.activeProfileId !== profileId
    ) {
      updateDatabase(workspaceId, (database) => ({
        ...database,
        loading: false,
        error: null,
      }));
      return;
    }

    updateDatabase(workspaceId, (database) => ({
      ...database,
      loading: false,
      error: `Inspect schema failed: ${terminalErrorMessage(error)}`,
    }));
  }
}

type ExportDatabaseResultRequestContext = {
  workspaceId: string;
  workspaceRoot: string;
  requestId: number;
  resultId: string;
  activeResult: DatabaseQueryResult;
  hasRegisteredWorkspace: (workspaceId: string) => boolean;
  getWorkspaceRoot: (workspaceId: string) => string | null;
  isLatestDatabaseExportRequest: (workspaceId: string, requestId: number) => boolean;
  updateDatabase: (
    workspaceId: string,
    update: (database: DatabaseViewState) => DatabaseViewState,
  ) => void;
  exportDatabaseQueryResult: (
    workspaceRoot: string,
    result: DatabaseQueryResult,
  ) => Promise<DatabaseExport>;
};

type RefreshDatabaseProfilesRunContext = {
  workspaceId: string;
  workspaceRoot: string;
  requestId: number;
  hasRegisteredWorkspace: (workspaceId: string) => boolean;
  getWorkspaceRoot: (workspaceId: string) => string | null;
  isLatestDatabaseProfilesRequest: (
    workspaceId: string,
    requestId: number,
  ) => boolean;
  isActiveWorkspace: (workspaceId: string) => boolean;
  updateDatabase: (
    workspaceId: string,
    update: (database: DatabaseViewState) => DatabaseViewState,
  ) => void;
  listDatabaseProfiles: (workspaceRoot: string) => Promise<DatabaseProfile[]>;
};

export async function refreshDatabaseProfilesRequest({
  workspaceId,
  workspaceRoot,
  requestId,
  hasRegisteredWorkspace,
  getWorkspaceRoot,
  isLatestDatabaseProfilesRequest,
  isActiveWorkspace,
  updateDatabase,
  listDatabaseProfiles: listProfiles,
}: RefreshDatabaseProfilesRunContext): Promise<void> {
  try {
    const profiles = await listProfiles(workspaceRoot);

    if (!isLatestDatabaseProfilesRequest(workspaceId, requestId)) {
      return;
    }

    if (
      !hasRegisteredWorkspace(workspaceId) ||
      getWorkspaceRoot(workspaceId) !== workspaceRoot ||
      !isActiveWorkspace(workspaceId)
    ) {
      return;
    }

    updateDatabase(workspaceId, (database) =>
      replaceDatabaseProfiles(database, profiles),
    );
  } catch (error) {
    if (!isLatestDatabaseProfilesRequest(workspaceId, requestId)) {
      return;
    }

    if (
      !hasRegisteredWorkspace(workspaceId) ||
      getWorkspaceRoot(workspaceId) !== workspaceRoot ||
      !isActiveWorkspace(workspaceId)
    ) {
      updateDatabase(workspaceId, (database) => ({
        ...database,
        loading: false,
        error: null,
      }));
      return;
    }

    updateDatabase(workspaceId, (database) => ({
      ...database,
      error: `Load database profiles failed: ${terminalErrorMessage(error)}`,
    }));
  }
}

type RefreshRemoteHostsRunContext = {
  workspaceId: string;
  workspaceRoot: string;
  requestId: number;
  hasRegisteredWorkspace: (workspaceId: string) => boolean;
  getWorkspaceRoot: (workspaceId: string) => string | null;
  isLatestRemoteHostsRequest: (
    workspaceId: string,
    requestId: number,
  ) => boolean;
  updateRemote: (
    workspaceId: string,
    update: (remote: RemoteViewState) => RemoteViewState,
  ) => void;
  listRemoteHosts: (workspaceRoot: string) => Promise<RemoteHostProfile[]>;
  listSshTerminalSessions: (
    workspaceId: string,
  ) => Promise<SshTerminalSessionInfo[]>;
};

export async function refreshRemoteHostsRequest({
  workspaceId,
  workspaceRoot,
  requestId,
  hasRegisteredWorkspace,
  getWorkspaceRoot,
  isLatestRemoteHostsRequest,
  updateRemote,
  listRemoteHosts: listHosts,
  listSshTerminalSessions: listSessions,
}: RefreshRemoteHostsRunContext): Promise<void> {
  updateRemote(workspaceId, (remote) => ({
    ...remote,
    loading: true,
    error: null,
  }));

  try {
    const [hosts, sessions] = await Promise.all([
      listHosts(workspaceRoot),
      listSessions(workspaceId),
    ]);

    if (!isLatestRemoteHostsRequest(workspaceId, requestId)) {
      return;
    }

    if (
      !hasRegisteredWorkspace(workspaceId) ||
      getWorkspaceRoot(workspaceId) !== workspaceRoot
    ) {
      updateRemote(workspaceId, (remote) => ({
        ...remote,
        loading: false,
        error: null,
      }));
      return;
    }

    updateRemote(workspaceId, (remote) => {
      const previousActiveSshSessionId = remote.activeSshSessionId;
      const resetSessions = replaceRemoteHosts(
        {
          ...remote,
          sshSessions: [],
          activeSshSessionId: null,
          loading: false,
          error: null,
        },
        hosts,
      );

      const refreshedRemote = sessions.reduce(
        (nextRemote, session) => upsertSshTerminal(nextRemote, session),
        resetSessions,
      );
      const hasPreviousActiveSession =
        previousActiveSshSessionId !== null &&
        sessions.some((session) => session.id === previousActiveSshSessionId);

      return hasPreviousActiveSession
        ? {
            ...refreshedRemote,
            activeSshSessionId: previousActiveSshSessionId,
          }
        : refreshedRemote;
    });
  } catch (error) {
    if (!isLatestRemoteHostsRequest(workspaceId, requestId)) {
      return;
    }

    if (
      !hasRegisteredWorkspace(workspaceId) ||
      getWorkspaceRoot(workspaceId) !== workspaceRoot
    ) {
      updateRemote(workspaceId, (remote) => ({
        ...remote,
        loading: false,
        error: null,
      }));
      return;
    }

    updateRemote(workspaceId, (remote) => ({
      ...remote,
      loading: false,
      error: `Load remotes failed: ${terminalErrorMessage(error)}`,
    }));
  }
}

function databaseResultId(
  result: Pick<DatabaseQueryResult, "profile_id" | "history_id" | "executed_ms"> | null,
): string {
  if (result === null) {
    return ":(:):";
  }

  return `${result.profile_id}:${result.history_id}:${result.executed_ms}`;
}

export async function exportDatabaseQueryResultRequest({
  workspaceId,
  workspaceRoot,
  requestId,
  resultId,
  activeResult,
  hasRegisteredWorkspace,
  getWorkspaceRoot,
  isLatestDatabaseExportRequest,
  updateDatabase,
  exportDatabaseQueryResult: exportResult,
}: ExportDatabaseResultRequestContext): Promise<void> {
  try {
    const data = await exportResult(workspaceRoot, activeResult);

    if (!isLatestDatabaseExportRequest(workspaceId, requestId)) {
      return;
    }

    const currentResult = workspaceViewStore.getState().viewFor(workspaceId).database
      .activeResult;
    if (
      !hasRegisteredWorkspace(workspaceId) ||
      getWorkspaceRoot(workspaceId) !== workspaceRoot ||
      databaseResultId(currentResult) !== resultId
    ) {
      return;
    }

    updateDatabase(workspaceId, (state) => ({
      ...state,
      export: data,
    }));
  } catch (error) {
    if (!isLatestDatabaseExportRequest(workspaceId, requestId)) {
      return;
    }

    const currentResult = workspaceViewStore.getState().viewFor(workspaceId).database
      .activeResult;
    if (
      !hasRegisteredWorkspace(workspaceId) ||
      getWorkspaceRoot(workspaceId) !== workspaceRoot ||
      databaseResultId(currentResult) !== resultId
    ) {
      return;
    }

    updateDatabase(workspaceId, (state) => ({
      ...state,
      error: `Export failed: ${terminalErrorMessage(error)}`,
    }));
  }
}

function combineQueryKinds(left: QueryKind, right: QueryKind): QueryKind {
  if (left === "Destructive" || right === "Destructive") {
    return "Destructive";
  }

  if (left === "Mutation" || right === "Mutation") {
    return "Mutation";
  }

  return "Read";
}

function sqlTokenAt(sql: string, index: number): {
  token: string;
  nextIndex: number;
} | null {
  let cursor = index;
  while (cursor < sql.length) {
    const char = sql[cursor];
    if (/\s/.test(char)) {
      cursor += 1;
      continue;
    }

    if (char === "-" && sql[cursor + 1] === "-") {
      cursor += 2;
      while (cursor < sql.length && sql[cursor] !== "\n") {
        cursor += 1;
      }
      continue;
    }

    if (char === "/" && sql[cursor + 1] === "*") {
      cursor += 2;
      while (cursor < sql.length - 1) {
        if (sql[cursor] === "*" && sql[cursor + 1] === "/") {
          cursor += 2;
          break;
        }
        cursor += 1;
      }
      continue;
    }

    break;
  }

  if (cursor >= sql.length) {
    return null;
  }

  if (sql[cursor] === "'" || sql[cursor] === '"') {
    return null;
  }

  const tokenStart = cursor;
  while (cursor < sql.length) {
    const char = sql[cursor];
    if (
      /[A-Za-z_]/.test(char) ||
      /[0-9]/.test(char) ||
      char === "." ||
      char === "_"
    ) {
      cursor += 1;
      continue;
    }

    break;
  }

  const token = sql.slice(tokenStart, cursor).trim().toUpperCase();
  if (!token) {
    return null;
  }

  return { token, nextIndex: cursor };
}

function skipSingleQuote(sql: string, index: number): number {
  let cursor = index + 1;
  while (cursor < sql.length) {
    if (sql[cursor] === "'") {
      if (sql[cursor + 1] === "'") {
        cursor += 2;
        continue;
      }

      return cursor + 1;
    }

    cursor += 1;
  }

  return sql.length;
}

function skipDoubleQuote(sql: string, index: number): number {
  let cursor = index + 1;
  while (cursor < sql.length) {
    if (sql[cursor] === '"') {
      if (sql[cursor + 1] === '"') {
        cursor += 2;
        continue;
      }

      return cursor + 1;
    }

    cursor += 1;
  }

  return sql.length;
}

function skipLineComment(sql: string, index: number): number {
  let cursor = index + 2;
  while (cursor < sql.length && sql[cursor] !== "\n") {
    cursor += 1;
  }

  return cursor;
}

function skipBlockComment(sql: string, index: number): number {
  let cursor = index + 2;
  while (cursor < sql.length - 1) {
    if (sql[cursor] === "*" && sql[cursor + 1] === "/") {
      return cursor + 2;
    }

    cursor += 1;
  }

  return sql.length;
}

function skipSqlWhitespaceAndComments(sql: string, index: number): number {
  let cursor = index;
  while (cursor < sql.length) {
    const char = sql[cursor];
    if (/\s/.test(char)) {
      cursor += 1;
      continue;
    }

    if (char === "-" && sql[cursor + 1] === "-") {
      cursor = skipLineComment(sql, cursor);
      continue;
    }

    if (char === "/" && sql[cursor + 1] === "*") {
      cursor = skipBlockComment(sql, cursor);
      continue;
    }

    break;
  }

  return cursor;
}

function skipNestedParentheses(sql: string, index: number): number {
  if (sql[index] !== "(") {
    return -1;
  }

  let depth = 0;
  let cursor = index;
  while (cursor < sql.length) {
    const char = sql[cursor];
    if (char === "'") {
      cursor = skipSingleQuote(sql, cursor);
      continue;
    }

    if (char === '"') {
      cursor = skipDoubleQuote(sql, cursor);
      continue;
    }

    if (char === "-" && sql[cursor + 1] === "-") {
      cursor = skipLineComment(sql, cursor);
      continue;
    }

    if (char === "/" && sql[cursor + 1] === "*") {
      cursor = skipBlockComment(sql, cursor);
      continue;
    }

    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return cursor + 1;
      }
    }

    cursor += 1;
  }

  return -1;
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let cursor = 0;
  let statementStart = 0;

  while (cursor < sql.length) {
    const char = sql[cursor];
    if (char === "'") {
      cursor = skipSingleQuote(sql, cursor);
      continue;
    }

    if (char === '"') {
      cursor = skipDoubleQuote(sql, cursor);
      continue;
    }

    if (char === "-" && sql[cursor + 1] === "-") {
      cursor = skipLineComment(sql, cursor);
      continue;
    }

    if (char === "/" && sql[cursor + 1] === "*") {
      cursor = skipBlockComment(sql, cursor);
      continue;
    }

    if (char === ";") {
      const statement = sql.slice(statementStart, cursor).trim();
      if (statement) {
        statements.push(statement);
      }
      cursor += 1;
      statementStart = cursor;
      continue;
    }

    cursor += 1;
  }

  const trailing = sql.slice(statementStart).trim();
  if (trailing) {
    statements.push(trailing);
  }

  return statements;
}

function classifyQueryToken(token: string): QueryKind {
  if (token === "SELECT" || token === "SHOW" || token === "DESCRIBE") {
    return "Read";
  }

  if (token === "INSERT" || token === "UPDATE" || token === "DELETE" || token === "MERGE" || token === "CALL") {
    return "Mutation";
  }

  if (
    token === "DROP" ||
    token === "TRUNCATE" ||
    token === "ALTER" ||
    token === "CREATE" ||
    token === "REINDEX" ||
    token === "VACUUM"
  ) {
    return "Destructive";
  }

  return "Destructive";
}

function queryKindAfterExplain(sql: string, index: number): QueryKind {
  let cursor = index;
  while (true) {
    const tokenResult = sqlTokenAt(sql, cursor);
    if (!tokenResult) {
      return "Destructive";
    }

    const token = tokenResult.token;
    cursor = skipSqlWhitespaceAndComments(sql, tokenResult.nextIndex);

    if (
      token === "ANALYZE" ||
      token === "FORMAT" ||
      token === "COSTS" ||
      token === "BUFFERS" ||
      token === "SETTINGS" ||
      token === "TIMING" ||
      token === "SUMMARY"
    ) {
      continue;
    }

    if (token === "WITH") {
      return queryKindWithStatement(sql, cursor);
    }

    return classifyQueryToken(token);
  }
}

function queryKindWithStatement(sql: string, index: number): QueryKind {
  let cursor = skipSqlWhitespaceAndComments(sql, index);
  if (sql.slice(cursor, cursor + 9).toUpperCase() === "RECURSIVE") {
    cursor = skipSqlWhitespaceAndComments(
      sql,
      cursor + 9,
    );
  }

  let kind: QueryKind = "Read";
  while (true) {
    cursor = skipSqlWhitespaceAndComments(sql, cursor);
    const name = sqlTokenAt(sql, cursor);
    if (!name) {
      return "Destructive";
    }

    cursor = skipSqlWhitespaceAndComments(sql, name.nextIndex);
    if (sql[cursor] === "(") {
      const close = skipNestedParentheses(sql, cursor);
      if (close < 0) {
        return "Destructive";
      }

      cursor = skipSqlWhitespaceAndComments(sql, close);
    }

    const asToken = sqlTokenAt(sql, cursor);
    if (!asToken || asToken.token !== "AS") {
      return "Destructive";
    }

    cursor = skipSqlWhitespaceAndComments(sql, asToken.nextIndex);
    if (sql[cursor] !== "(") {
      return "Destructive";
    }

    const close = skipNestedParentheses(sql, cursor);
    if (close < 0) {
      return "Destructive";
    }

    const bodySql = sql.slice(cursor + 1, close - 1).trim();
    if (!bodySql) {
      return "Destructive";
    }

    kind = combineQueryKinds(kind, statementQueryKind(bodySql));
    cursor = skipSqlWhitespaceAndComments(sql, close);

    if (sql[cursor] === ",") {
      cursor = cursor + 1;
      continue;
    }

    break;
  }

  const outer = sqlTokenAt(sql, cursor);
  if (!outer) {
    return kind;
  }

  if (outer.token === "WITH") {
    return combineQueryKinds(kind, queryKindWithStatement(sql, outer.nextIndex));
  }

  return combineQueryKinds(kind, classifyQueryToken(outer.token));
}

function statementQueryKind(statement: string): QueryKind {
  const first = sqlTokenAt(statement, 0);
  if (!first) {
    return "Destructive";
  }

  if (first.token === "WITH") {
    return queryKindWithStatement(statement, first.nextIndex);
  }

  if (first.token === "EXPLAIN") {
    return queryKindAfterExplain(statement, first.nextIndex);
  }

  return classifyQueryToken(first.token);
}

export function classifyDatabaseSql(sql: string): QueryClassification {
  const normalized = stripDatabaseSqlComments(sql).trim();
  if (!normalized) {
    return {
      kind: "Destructive",
      requires_confirmation: true,
      confirmation_text: "RUN DESTRUCTIVE SQL",
      reason: "destructive or unknown SQL requires explicit confirmation",
    };
  }

  const normalizedSql = normalized.replace(/\s+/g, " ");
  const statements = splitSqlStatements(normalizedSql);

  let queryKind: QueryKind = "Read";
  for (const statement of statements) {
    queryKind = combineQueryKinds(queryKind, statementQueryKind(statement));
  }

  if (statements.length === 0) {
    queryKind = "Destructive";
  }

  if (queryKind === "Read") {
    return {
      kind: queryKind,
      requires_confirmation: false,
      confirmation_text: "",
      reason: "read-only statement",
    };
  }

  if (queryKind === "Mutation") {
    return {
      kind: queryKind,
      requires_confirmation: true,
      confirmation_text: "RUN MUTATION",
      reason: "mutating SQL requires visible confirmation",
    };
  }

  return {
    kind: queryKind,
    requires_confirmation: true,
    confirmation_text: "RUN DESTRUCTIVE SQL",
    reason: "destructive or unknown SQL requires explicit confirmation",
  };
}

function knownWorkspaceIdForTerminal(sessionId: string): string | null {
  const { views } = workspaceViewStore.getState();
  const match = Object.entries(views).find(([, workspaceView]) =>
    workspaceView.terminal.sessions.some((session) => session.id === sessionId),
  );

  return match?.[0] ?? workspaceIdFromTerminalSessionId(sessionId);
}

export function remoteHostIdFromSshTerminalSessionId(
  sessionId: string,
): string | null {
  const marker = ":ssh-";
  const markerIndex = sessionId.indexOf(marker);
  return markerIndex > 0 ? sessionId.slice(0, markerIndex) : null;
}

export function knownWorkspaceIdForSshTerminal(sessionId: string): string | null {
  const { views } = workspaceViewStore.getState();
  const registeredWorkspaceIds = new Set(
    workspaceStore.getState().registry.workspaces.map((workspace) => workspace.id),
  );
  const sessionMatch = Object.entries(views).find(
    ([workspaceId, workspaceView]) =>
      registeredWorkspaceIds.has(workspaceId) &&
      workspaceView.remote.sshSessions.some(
        (session) => session.id === sessionId,
      ),
  );
  if (sessionMatch) {
    return sessionMatch[0];
  }

  const hostId = remoteHostIdFromSshTerminalSessionId(sessionId);
  if (!hostId) {
    return null;
  }

  const hostMatches = Object.entries(views).filter(
    ([workspaceId, workspaceView]) =>
      registeredWorkspaceIds.has(workspaceId) &&
      workspaceView.remote.hosts.some((host) => host.id === hostId),
  );

  return hostMatches.length === 1 ? hostMatches[0][0] : null;
}

type SshTerminalOutputEvent = {
  session_id: string;
  chunk: string;
};

type SshTerminalExitEvent = {
  session_id: string;
};

export function handleTerminalOutputEvent(event: {
  session_id: string;
  chunk: string;
}): void {
  const workspaceId = knownWorkspaceIdForTerminal(event.session_id);
  if (!workspaceId) {
    return;
  }

  const currentView = workspaceViewStore.getState().viewFor(workspaceId);
  if (currentView.terminal.ignoredSessionIds[event.session_id]) {
    return;
  }

  const hasSession = currentView.terminal.sessions.some(
    (session) => session.id === event.session_id,
  );
  if (!hasSession) {
    const derivedWorkspaceId = workspaceIdFromTerminalSessionId(
      event.session_id,
    );
    if (
      derivedWorkspaceId !== workspaceId ||
      !hasRegisteredWorkspace(workspaceId)
    ) {
      return;
    }
  }

  appendTerminalReplayOutput(event.session_id, event.chunk);
}

export function handleSshTerminalOutputEvent(
  event: SshTerminalOutputEvent,
): void {
  const workspaceId = knownWorkspaceIdForSshTerminal(event.session_id);
  if (!workspaceId) {
    return;
  }

  const currentView = workspaceViewStore.getState().viewFor(workspaceId);
  if (currentView.remote.ignoredSshSessionIds[event.session_id]) {
    return;
  }

  appendTerminalReplayOutput(event.session_id, event.chunk);
}

export function handleSshTerminalExitEvent(
  event: SshTerminalExitEvent,
): void {
  const workspaceId = knownWorkspaceIdForSshTerminal(event.session_id);
  if (!workspaceId) {
    return;
  }

  const currentView = workspaceViewStore.getState().viewFor(workspaceId);
  const hasSession = currentView.remote.sshSessions.some(
    (session) => session.id === event.session_id,
  );

  workspaceViewStore.getState().updateRemote(workspaceId, (remote) =>
    hasSession
      ? markSshTerminalExited(remote, event.session_id)
      : bufferSshTerminalExit(remote, event.session_id),
  );
}

function knownWorkspaceIdForTaskRun(runId: string): string | null {
  const { views } = workspaceViewStore.getState();
  const match = Object.entries(views).find(([, workspaceView]) =>
    workspaceView.task.runs.some((run) => run.id === runId),
  );

  return match?.[0] ?? workspaceIdFromTaskRunId(runId);
}

function gitDiffCacheKey(path: string, staged: boolean): string {
  return `${staged ? "staged" : "unstaged"}:${path}`;
}

function hasRegisteredWorkspace(workspaceId: string): boolean {
  return workspaceStore
    .getState()
    .registry.workspaces.some((workspace) => workspace.id === workspaceId);
}

function terminalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function activeDebugSessionForState(
  state: DebugViewState,
): DebugSessionInfo | null {
  if (!state.activeSessionId) {
    return null;
  }

  return (
    state.sessions.find((session) => session.id === state.activeSessionId) ??
    null
  );
}

export function activeDebugLineForFile(
  state: DebugViewState,
  sourcePath: string | null,
): number | null {
  const activeSession = activeDebugSessionForState(state);
  if (!activeSession || !sourcePath) {
    return null;
  }

  return (
    state.stackBySessionId[activeSession.id]?.find(
      (frame) => frame.source_path === sourcePath,
    )?.line ?? null
  );
}

export function applyDebugRefreshSnapshot(
  state: DebugViewState,
  launchConfigs: DebugLaunchConfig[],
  sessions: DebugSessionInfo[],
): DebugViewState {
  const previousActiveSessionId = state.activeSessionId;
  const refreshed = replaceDebugSessions(
    replaceDebugLaunchConfigs(state, launchConfigs),
    sessions,
  );
  const activeSessionId =
    previousActiveSessionId &&
    refreshed.sessions.some((session) => session.id === previousActiveSessionId)
      ? previousActiveSessionId
      : null;

  return {
    ...refreshed,
    activeSessionId,
  };
}

function activeDebugConsoleText(state: DebugViewState): string {
  const activeSession = activeDebugSessionForState(state);
  return activeSession ? (state.consoleBySessionId[activeSession.id] ?? "") : "";
}

type DebugCommandDispatchContext = {
  debugState: DebugViewState;
  activeFilePath: string | null;
  onOpenDebug: () => void;
  onStartSession: () => void;
  onContinue: (sessionId: string) => void;
  onStepOver: (sessionId: string) => void;
  onPause: (sessionId: string) => void;
  onDisconnect: (sessionId: string) => void;
  onToggleBreakpoint: (sourcePath: string, line: number) => void;
};

export function runDebugCommandFromPalette(
  id: string,
  context: DebugCommandDispatchContext,
): boolean {
  const activeSession = activeDebugSessionForState(context.debugState);

  switch (id) {
    case "open-debug":
      context.onOpenDebug();
      return true;
    case "debug-start-session":
      context.onStartSession();
      return true;
    case "debug-continue":
      if (activeSession) {
        context.onContinue(activeSession.id);
      }
      return true;
    case "debug-step-over":
      if (activeSession) {
        context.onStepOver(activeSession.id);
      }
      return true;
    case "debug-pause":
      if (activeSession) {
        context.onPause(activeSession.id);
      }
      return true;
    case "debug-disconnect":
      if (activeSession) {
        context.onDisconnect(activeSession.id);
      }
      return true;
    case "debug-toggle-breakpoint": {
      const line = activeDebugLineForFile(
        context.debugState,
        context.activeFilePath,
      );
      if (context.activeFilePath && line) {
        context.onToggleBreakpoint(context.activeFilePath, line);
      }
      return true;
    }
    default:
      return false;
  }
}

export function knownWorkspaceIdForDebugEvent(
  event: Pick<DebugSessionEvent, "workspace_id" | "workspace_root">,
): string | null {
  const workspace =
    workspaceStore
      .getState()
      .registry.workspaces.find(
        (item) => item.id === event.workspace_id,
      ) ?? null;

  if (!workspace || workspace.path !== event.workspace_root) {
    return null;
  }

  return workspace.id;
}

export function handleDebugSessionEvent(event: DebugSessionEvent): void {
  const workspaceId = knownWorkspaceIdForDebugEvent(event);
  if (!workspaceId) {
    return;
  }

  workspaceViewStore
    .getState()
    .updateDebug(workspaceId, (debug) => markDebugSessionEvent(debug, event));
}

export function handleDebugConsoleEvent(event: DebugConsoleEvent): void {
  const workspaceId = knownWorkspaceIdForDebugEvent(event);
  if (!workspaceId) {
    return;
  }

  const debug = workspaceViewStore.getState().viewFor(workspaceId).debug;
  const activeSession = activeDebugSessionForState(debug);
  if (activeSession?.id !== event.session_id) {
    return;
  }

  workspaceViewStore
    .getState()
    .updateDebug(workspaceId, (state) => appendDebugConsole(state, event));
}

export function remoteTransferFileName(
  path: string,
  fallback = "upload.bin",
): string {
  if (!path || /[\\/]$/.test(path)) {
    return fallback;
  }

  return path.split(/[\\/]/).pop() || fallback;
}

function isMissingTerminalSessionError(error: unknown): boolean {
  return terminalErrorMessage(error).includes("missing terminal session");
}

export function PanelBody({
  active,
  refreshKey,
  activeFilePath,
  terminalSessions,
  activeTerminalId,
  terminalCwdInput,
  terminalError,
  taskState,
  taskError,
  gitState,
  docsState,
  contextPackNameById,
  gitDecorations,
  onOpenFile,
  onCreateFile,
  onRenamePath,
  onDeletePath,
  onTerminalCwdInputChange,
  onNewTerminal,
  onActivateTerminal,
  onCloseTerminal,
  onRestartTerminal,
  onTaskCustomCommandChange,
  onRunTask,
  onRunCustomTask,
  onActivateTaskRun,
  onStopTaskRun,
  onRerunTaskRun,
  onGitRefresh,
  onGitCommitMessageChange,
  onGitCommit,
  onGitStage,
  onGitUnstage,
  onGitDiscard,
  onGitOpenDiff,
  onGitStash,
  onGitFetch,
  onGitPull,
  onGitPush,
  onGitCheckoutBranch,
  onGitCreateBranch,
  onGitOpenGraph,
  onDocsRefresh,
  onDocsSearch,
  onDocsOpenPreview,
  onDocsToggleSource,
  onDocsPackNameChange,
  onDocsCreatePack,
  onDocsSelectPack,
  onDocsDeletePack,
  onDocsUsePackForActiveTask,
  onDocsLinkPackToAgentSession,
  agentState,
  availableAgentContext,
  onAgentModeChange,
  onAgentPromptChange,
  onAgentToggleContext,
  onAgentStartSession,
  onAgentSelectSession,
  onAgentApprove,
  onAgentReject,
  onAgentExport,
  onLanguageOpenDiagnostic,
  onLanguageRefresh,
  onLanguageRestartServer,
  browserState,
  browserTargets,
  browserCanCapture,
  onBrowserUrlInputChange,
  onBrowserOpenUrl,
  onBrowserOpenTarget,
  onBrowserReload,
  onBrowserHardReload,
  onBrowserCapture,
  onBrowserSelectScreenshot,
  languageState,
  databaseState,
  onDatabaseRefreshProfiles,
  onDatabaseSelectProfile,
  onDatabaseInspectProfile,
  onDatabaseOpenTable,
  onDatabaseDraftChange,
  onDatabaseRunQuery,
  onDatabaseConfirmQuery,
  onDatabaseCancelConfirmation,
  onDatabaseExportResult,
  onDatabaseSelectHistory,
  extensionState,
  onExtensionRefresh = () => {},
  onExtensionSelect = () => {},
  onExtensionToggle = () => {},
  remoteState,
  onRemoteModeChange = () => {},
  onRemoteSelectHost = () => {},
  onRemoteRefresh = () => {},
  onRemoteCreateHost = () => {},
  onRemoteConnectHost = () => {},
  onRemoteOpenSsh = () => {},
  onRemoteOpenSftp = () => {},
  onRemoteRunCommand = () => {},
  onRemoteCommandDraftChange = () => {},
  onRemoteListSftpDirectory = () => {},
  onRemoteDownloadFile = () => {},
  onRemoteUploadFile = () => {},
  recoveryState = createRecoveryState(),
  onRecoveryRefresh = () => {},
  onRecoveryRestore = () => {},
  onRecoveryDiscard = () => {},
  diagnosticsState = createDiagnosticsState(),
  settingsState = createSettingsState(),
  onSettingsSelectCategory = () => {},
  onDiagnosticsRefresh = () => {},
  onKeybindingImportDraftChange = () => {},
  onImportKeybindings = () => {},
  debugState,
  onDebugModeChange = () => {},
  onDebugSelectConfig = () => {},
  onDebugStartSession = () => {},
  onDebugContinue = () => {},
  onDebugStepOver = () => {},
  onDebugPause = () => {},
  onDebugDisconnect = () => {},
  onDebugOpenFrame = () => {},
  onDebugAddWatch = () => {},
  onDebugRemoveWatch = () => {},
  onDebugEvaluate = () => {},
}: {
  active: ActivityId;
  refreshKey: number;
  activeFilePath: string | null;
  terminalSessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  terminalCwdInput: string;
  terminalError: string | null;
  taskState: TaskViewState;
  taskError: string | null;
  gitState: GitViewState;
  docsState: DocsViewState;
  contextPackNameById: Record<string, string>;
  gitDecorations: ReturnType<typeof decorationMapFromStatus>;
  onOpenFile: (path: string) => void;
  onCreateFile: (relativePath: string) => Promise<void>;
  onRenamePath: (path: string, newName: string) => Promise<void>;
  onDeletePath: (path: string) => Promise<void>;
  onTerminalCwdInputChange: (value: string) => void;
  onNewTerminal: () => void;
  onActivateTerminal: (id: string) => void;
  onCloseTerminal: (id: string) => void;
  onRestartTerminal: (id: string) => void;
  onTaskCustomCommandChange: (value: string) => void;
  onRunTask: (task: WorkspaceTask) => void;
  onRunCustomTask: (command: string) => void;
  onActivateTaskRun: (runId: string) => void;
  onStopTaskRun: (runId: string) => void;
  onRerunTaskRun: (run: TaskRun) => void;
  onGitRefresh: () => void;
  onGitCommitMessageChange: (message: string) => void;
  onGitCommit: (options: { amend: boolean; pushAfter: boolean }) => void;
  onGitStage: (path: string) => void;
  onGitUnstage: (path: string) => void;
  onGitDiscard: (path: string) => void;
  onGitOpenDiff: (path: string, staged: boolean) => void;
  onGitStash: () => void;
  onGitFetch: () => void;
  onGitPull: () => void;
  onGitPush: () => void;
  onGitCheckoutBranch: (branch: string) => void;
  onGitCreateBranch: (name: string) => void;
  onGitOpenGraph: () => void;
  onDocsRefresh: () => void;
  onDocsSearch: (query: string) => void;
  onDocsOpenPreview: (path: string) => void;
  onDocsToggleSource: (path: string, selected: boolean) => void;
  onDocsPackNameChange: (name: string) => void;
  onDocsCreatePack: () => void;
  onDocsSelectPack: (id: string) => void;
  onDocsDeletePack: (id: string) => void;
  onDocsUsePackForActiveTask: (id: string) => void;
  onDocsLinkPackToAgentSession: (
    id: string,
    agentSessionId: string,
  ) => Promise<void>;
  agentState: AgentViewState;
  availableAgentContext: AgentContextItem[];
  onAgentModeChange: (mode: AgentMode) => void;
  onAgentPromptChange: (prompt: string) => void;
  onAgentToggleContext: (id: string, selected: boolean) => void;
  onAgentStartSession: (prompt: string) => void;
  onAgentSelectSession: (sessionId: string) => void;
  onAgentApprove: (approvalId: string) => void;
  onAgentReject: (approvalId: string) => void;
  onAgentExport: () => void;
  onLanguageOpenDiagnostic: (diagnostic: LspDiagnostic & { path: string }) => void;
  onLanguageRefresh: () => void;
  onLanguageRestartServer: (server: LanguageServerStatus) => void;
  browserState: BrowserViewState;
  browserTargets: DevServerTarget[];
  browserCanCapture: boolean;
  onBrowserUrlInputChange: (value: string) => void;
  onBrowserOpenUrl: (value: string) => void;
  onBrowserOpenTarget: (url: string) => void;
  onBrowserReload: () => void;
  onBrowserHardReload: () => void;
  onBrowserCapture: () => void;
  onBrowserSelectScreenshot: (id: string) => void;
  languageState: LanguageViewState;
  databaseState: DatabaseViewState;
  onDatabaseRefreshProfiles: () => void;
  onDatabaseSelectProfile: (profileId: string) => void;
  onDatabaseInspectProfile: (profileId: string) => void;
  onDatabaseOpenTable: (profileId: string, table: DatabaseTable) => void;
  onDatabaseDraftChange: (query: string) => void;
  onDatabaseRunQuery: () => void;
  onDatabaseConfirmQuery: (input: string) => void;
  onDatabaseCancelConfirmation: () => void;
  onDatabaseExportResult: () => void;
  onDatabaseSelectHistory: (entry: DatabaseQueryHistoryEntry) => void;
  extensionState?: ExtensionViewState;
  onExtensionRefresh?: () => void;
  onExtensionSelect?: (extensionId: string) => void;
  onExtensionToggle?: (extensionId: string, enabled: boolean) => void;
  remoteState?: RemoteViewState;
  onRemoteModeChange?: (mode: RemoteViewState["mode"]) => void;
  onRemoteSelectHost?: (hostId: string) => void;
  onRemoteRefresh?: () => void;
  onRemoteCreateHost?: () => void;
  onRemoteConnectHost?: (hostId: string) => void;
  onRemoteOpenSsh?: (hostId: string) => void;
  onRemoteOpenSftp?: (hostId: string) => void;
  onRemoteRunCommand?: () => void;
  onRemoteCommandDraftChange?: (value: string) => void;
  onRemoteListSftpDirectory?: (hostId: string, path: string) => void;
  onRemoteDownloadFile?: (path: string) => void;
  onRemoteUploadFile?: (path: string) => void;
  recoveryState?: RecoveryViewState;
  onRecoveryRefresh?: () => void;
  onRecoveryRestore?: (backupId: string) => void;
  onRecoveryDiscard?: (backupId: string) => void;
  diagnosticsState?: DiagnosticsViewState;
  settingsState?: SettingsViewState;
  onSettingsSelectCategory?: (category: SettingsCategory) => void;
  onDiagnosticsRefresh?: () => void;
  onKeybindingImportDraftChange?: (draft: string) => void;
  onImportKeybindings?: () => void;
  debugState?: DebugViewState;
  onDebugModeChange?: (mode: DebugViewState["mode"]) => void;
  onDebugSelectConfig?: (configId: string) => void;
  onDebugStartSession?: () => void;
  onDebugContinue?: (sessionId: string) => void;
  onDebugStepOver?: (sessionId: string) => void;
  onDebugPause?: (sessionId: string) => void;
  onDebugDisconnect?: (sessionId: string) => void;
  onDebugOpenFrame?: (frame: DebugStackFrame) => void;
  onDebugAddWatch?: (expression: string) => void;
  onDebugRemoveWatch?: (watch: number | string) => void;
  onDebugEvaluate?: (expression: string) => void;
}) {
  if (active === "extensions") {
    return (
      <ExtensionPanel
        state={extensionState ?? createExtensionState()}
        onRefresh={onExtensionRefresh}
        onSelectExtension={onExtensionSelect}
        onToggleExtension={onExtensionToggle}
      />
    );
  }

  if (active === "debug") {
    return (
      <DebugPanel
        state={debugState ?? createDebugState()}
        onModeChange={onDebugModeChange}
        onSelectConfig={onDebugSelectConfig}
        onStartSession={onDebugStartSession}
        onContinue={onDebugContinue}
        onStepOver={onDebugStepOver}
        onPause={onDebugPause}
        onDisconnect={onDebugDisconnect}
        onOpenFrame={onDebugOpenFrame}
        onAddWatch={onDebugAddWatch}
        onRemoveWatch={onDebugRemoveWatch}
        onEvaluate={onDebugEvaluate}
      />
    );
  }

  if (active === "git") {
    return (
      <GitPanel
        state={gitState}
        onRefresh={onGitRefresh}
        onCommitMessageChange={onGitCommitMessageChange}
        onCommit={onGitCommit}
        onStage={onGitStage}
        onUnstage={onGitUnstage}
        onDiscard={onGitDiscard}
        onOpenDiff={onGitOpenDiff}
        onStash={onGitStash}
        onFetch={onGitFetch}
        onPull={onGitPull}
        onPush={onGitPush}
        onCheckoutBranch={onGitCheckoutBranch}
        onCreateBranch={onGitCreateBranch}
        onOpenGraph={onGitOpenGraph}
      />
    );
  }

  if (active === "search") {
    return <SearchPanel onOpenFile={onOpenFile} />;
  }

  if (active === "terminal") {
    return (
      <TerminalPanel
        sessions={terminalSessions}
        activeTerminalId={activeTerminalId}
        cwdInput={terminalCwdInput}
        error={terminalError}
        onCwdInputChange={onTerminalCwdInputChange}
        onNewTerminal={onNewTerminal}
        onActivateTerminal={onActivateTerminal}
        onCloseTerminal={onCloseTerminal}
        onRestartTerminal={onRestartTerminal}
      />
    );
  }

  if (active === "tasks") {
    return (
      <TaskPanel
        detectedTasks={taskState.detectedTasks}
        runs={taskState.runs}
        activeRunId={taskState.activeRunId}
        outputByRunId={taskState.outputByRunId}
        problemsByRunId={taskState.problemsByRunId}
        contextPackNameById={contextPackNameById}
        contextPackByRunId={taskState.contextPackByRunId}
        customCommand={taskState.customCommand}
        error={taskError}
        onCustomCommandChange={onTaskCustomCommandChange}
        onRunTask={onRunTask}
        onRunCustomTask={onRunCustomTask}
        onActivateRun={onActivateTaskRun}
        onStopRun={onStopTaskRun}
        onRerunRun={onRerunTaskRun}
      />
    );
  }

  if (active === "docs") {
    return (
      <DocsPanel
        state={docsState}
        onRefresh={onDocsRefresh}
        onSearch={onDocsSearch}
        onOpenPreview={onDocsOpenPreview}
        onToggleSource={onDocsToggleSource}
        onPackNameChange={onDocsPackNameChange}
        onCreatePack={onDocsCreatePack}
        onSelectPack={onDocsSelectPack}
        onDeletePack={onDocsDeletePack}
        activeTaskRunId={taskState.activeRunId ?? taskState.runs[0]?.id ?? null}
        onUsePackForActiveTask={onDocsUsePackForActiveTask}
        onLinkPackToAgentSession={onDocsLinkPackToAgentSession}
      />
    );
  }

  if (active === "language") {
    return (
      <LanguagePanel
        state={languageState}
        onOpenDiagnostic={onLanguageOpenDiagnostic}
        onRefresh={onLanguageRefresh}
        onRestartServer={onLanguageRestartServer}
      />
    );
  }

  if (active === "agents") {
    return (
      <AgentPanel
        state={agentState}
        availableContext={availableAgentContext}
        onModeChange={onAgentModeChange}
        onPromptChange={onAgentPromptChange}
        onToggleContext={onAgentToggleContext}
        onStartSession={onAgentStartSession}
        onSelectSession={onAgentSelectSession}
        onApprove={onAgentApprove}
        onReject={onAgentReject}
        onExport={onAgentExport}
      />
    );
  }

  if (active === "browser") {
    return (
      <BrowserPanel
        state={browserState}
        devServerTargets={browserTargets}
        canCapture={browserCanCapture}
        onUrlInputChange={onBrowserUrlInputChange}
        onOpenUrl={onBrowserOpenUrl}
        onOpenTarget={onBrowserOpenTarget}
        onReload={onBrowserReload}
        onHardReload={onBrowserHardReload}
        onCapture={onBrowserCapture}
        onSelectScreenshot={onBrowserSelectScreenshot}
      />
    );
  }

  if (active === "database") {
    return (
      <DatabasePanel
        state={databaseState}
        onRefreshProfiles={onDatabaseRefreshProfiles}
        onSelectProfile={onDatabaseSelectProfile}
        onInspectSchema={onDatabaseInspectProfile}
        onOpenTable={onDatabaseOpenTable}
        onQueryDraftChange={onDatabaseDraftChange}
        onRunQuery={onDatabaseRunQuery}
        onConfirmQuery={onDatabaseConfirmQuery}
        onCancelConfirmation={onDatabaseCancelConfirmation}
        onExportResult={onDatabaseExportResult}
        onSelectHistory={onDatabaseSelectHistory}
      />
    );
  }

  if (active === "remote" && remoteState) {
    return (
      <RemotePanel
        state={remoteState}
        onModeChange={onRemoteModeChange}
        onSelectHost={onRemoteSelectHost}
        onRefresh={onRemoteRefresh}
        onCreateHost={onRemoteCreateHost}
        onConnectHost={onRemoteConnectHost}
        onOpenSsh={onRemoteOpenSsh}
        onOpenSftp={onRemoteOpenSftp}
        onRunCommand={onRemoteRunCommand}
        onCommandDraftChange={onRemoteCommandDraftChange}
        onListSftpDirectory={onRemoteListSftpDirectory}
        onDownloadFile={onRemoteDownloadFile}
        onUploadFile={onRemoteUploadFile}
      />
    );
  }

  if (active === "settings") {
    return (
      <SettingsPanel
        state={settingsState}
        recoveryState={recoveryState}
        diagnosticsState={diagnosticsState}
        onSelectCategory={onSettingsSelectCategory}
        onRecoveryRefresh={onRecoveryRefresh}
        onRecoveryRestore={onRecoveryRestore}
        onRecoveryDiscard={onRecoveryDiscard}
        onDiagnosticsRefresh={onDiagnosticsRefresh}
        onKeybindingImportDraftChange={onKeybindingImportDraftChange}
        onImportKeybindings={onImportKeybindings}
      />
    );
  }

  if (active === "explorer") {
    return (
      <FileTreePanel
        refreshKey={refreshKey}
        activeFilePath={activeFilePath}
        onOpenFile={onOpenFile}
        onCreateFile={onCreateFile}
        onRenamePath={onRenamePath}
        onDeletePath={onDeletePath}
        gitDecorations={gitDecorations}
      />
    );
  }

  return (
    <div className="panel-empty">
      <span>{panelTitles[active]}</span>
    </div>
  );
}

export function AppShell() {
  const [fileTreeRefreshKey, setFileTreeRefreshKey] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [loadedFile, setLoadedFile] = useState<LoadedFile | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [taskErrorsByWorkspace, setTaskErrorsByWorkspace] =
    useState<TaskErrorByWorkspace>({});
  const [findOpen, setFindOpen] = useState(false);
  const [findFocusRequest, setFindFocusRequest] = useState(0);
  const [findQuery, setFindQuery] = useState("");
  const [gitConfirmation, setGitConfirmation] =
    useState<GitConfirmationRequest | null>(null);
  const [gitConfirmationInput, setGitConfirmationInput] = useState("");
  const savedContentByPathRef = useRef<Record<string, string>>({});
  const openRequestRef = useRef(0);
  const databaseProfilesLoadRef = useRef<Record<string, number>>({});
  const databaseInspectProfileRequestRef = useRef<Record<string, number>>({});
  const databaseQueryRequestRef = useRef<Record<string, number>>({});
  const databaseExportRequestRef = useRef<Record<string, number>>({});
  const remoteHostsLoadRef = useRef<Record<string, number>>({});
  const debugLoadRequestRef = useRef<Record<string, number>>({});
  const extensionStatusRequestRef = useRef<Record<string, number>>({});
  const extensionToggleRequestRef = useRef<Record<string, number>>({});
  const extensionStateEpochRef = useRef<Record<string, number>>({});
  const extensionPendingToggleRef = useRef<Record<string, number>>({});
  const recoveryLoadRequestRef = useRef<Record<string, number>>({});
  const recoverySaveEpochRef = useRef<Record<string, number>>({});
  const recoverySaveIntentRef = useRef<Record<string, RecoverySaveIntent>>({});
  const settingsLoadRequestRef = useRef<Record<string, number>>({});
  const keybindingImportRequestRef = useRef<Record<string, number>>({});
  const settingsLoadedWorkspaceRef = useRef<Set<string>>(new Set());
  const diagnosticsRefreshRequestRef = useRef<Record<string, number>>({});
  const diagnosticsStartupEventRef = useRef(false);
  const docsLoadRequestRef = useRef<DocsLoadRequestState>({});
  const agentSessionsLoadRef = useRef<Record<string, number>>({});
  const languageRefreshRequestRef = useRef<LanguageRefreshRequestState>({});
  const browserValidationRequestRef = useRef<BrowserValidationRequestState>({});
  const browserCaptureRequestRef = useRef<BrowserCaptureRequestState>({});
  const docsSearchRequestRef = useRef<DocsRequestIdentity>({
    requestId: 0,
    workspaceId: null,
    workspacePath: null,
    query: "",
  });
  const registry = useWorkspaceStore((state) => state.registry);
  const activeWorkspaceId = registry.active_workspace_id;
  const view = useWorkspaceViewStore((state) => state.viewFor(activeWorkspaceId));
  const updateView = useWorkspaceViewStore((state) => state.updateView);
  const updateEditor = useWorkspaceViewStore((state) => state.updateEditor);
  const activeActivity = view.activeActivity;
  const panelOpen = view.panelOpen;
  const surface = view.surface;
  const terminalSessions = view.terminal.sessions;
  const activeTerminal =
    terminalSessions.find(
      (session) => session.id === view.terminal.activeTerminalId,
    ) ??
    terminalSessions[0] ??
    null;
  const activeTerminalId = activeTerminal?.id ?? null;
  const activeTerminalName = activeTerminal?.name ?? "terminal";
  const activeSshSession =
    view.remote.sshSessions.find(
      (session) => session.id === view.remote.activeSshSessionId,
    ) ??
    view.remote.sshSessions[0] ??
    null;
  const activeDebugSession = activeDebugSessionForState(view.debug);
  const activeDebugOutput = activeDebugConsoleText(view.debug);
  const activeRemoteHost =
    view.remote.hosts.find((host) => host.id === view.remote.activeHostId) ??
    null;
  const activeSftpPath = activeRemoteHost
    ? (view.remote.sftpPathByHostId[activeRemoteHost.id] ||
      activeRemoteHost.default_remote_path ||
      "/")
    : "/";
  const activeTaskRun =
    view.task.runs.find((run) => run.id === view.task.activeRunId) ??
    view.task.runs[0] ??
    null;
  const activeTaskProblems = activeTaskRun
    ? (view.task.problemsByRunId[activeTaskRun.id] ?? [])
    : [];
  const languageDiagnosticBadge = selectDiagnosticBadge(view.language);
  const databaseBadge = databaseBadgeCount(view.database);
  const extensionBadge = extensionBadgeCount(view.extension);
  const commandPaletteCommands = useMemo(() => {
    const disabledExtensionIds = new Set(
      view.extension.statuses
        .filter((status) => !status.enabled)
        .map((status) => status.manifest.id),
    );

    return commandItemsForPalette(
      extensionCommands(view.extension),
      disabledExtensionIds,
    );
  }, [view.extension]);
  const contextPackNameById = useMemo(
    () =>
      Object.fromEntries(
        view.docs.contextPacks.map((pack) => [pack.id, pack.name]),
      ),
    [view.docs.contextPacks],
  );
  const taskError = taskErrorForWorkspace(
    taskErrorsByWorkspace,
    activeWorkspaceId,
  );

  function setActiveActivity(activeActivity: ActivityId) {
    updateView(activeWorkspaceId, { activeActivity });
  }

  function setPanelOpen(panelOpen: boolean) {
    updateView(activeWorkspaceId, { panelOpen });
  }

  function setSurface(surface: Surface) {
    updateView(activeWorkspaceId, { surface });
  }

  function setWorkspaceTaskError(
    workspaceId: string | null,
    error: string | null,
  ) {
    setTaskErrorsByWorkspace((errors) =>
      setTaskErrorForWorkspace(errors, workspaceId, error),
    );
  }

  const updateTerminal = useWorkspaceViewStore(
    (state) => state.updateTerminal,
  );
  const updateTask = useWorkspaceViewStore((state) => state.updateTask);
  const updateGit = useWorkspaceViewStore((state) => state.updateGit);
  const updateDocs = useWorkspaceViewStore((state) => state.updateDocs);
  const updateLanguage = useWorkspaceViewStore((state) => state.updateLanguage);
  const updateAgent = useWorkspaceViewStore((state) => state.updateAgent);
  const updateBrowser = useWorkspaceViewStore((state) => state.updateBrowser);
  const updateDatabase = useWorkspaceViewStore((state) => state.updateDatabase);
  const updateRemote = useWorkspaceViewStore((state) => state.updateRemote);
  const updateRecovery = useWorkspaceViewStore((state) => state.updateRecovery);
  const updateDiagnostics = useWorkspaceViewStore(
    (state) => state.updateDiagnostics,
  );
  const updateSettings = useWorkspaceViewStore((state) => state.updateSettings);
  const updateDebug = useWorkspaceViewStore((state) => state.updateDebug);
  const updateExtension = useWorkspaceViewStore(
    (state) => state.updateExtension,
  );

  const activeWorkspace = useMemo(
    () =>
      registry.workspaces.find(
        (workspace) => workspace.id === activeWorkspaceId,
      ),
    [activeWorkspaceId, registry.workspaces],
  );
  const activeLoadedFile = activeLoadedFileForWorkspace(
    loadedFile,
    activeWorkspaceId,
  );
  const browserTargets = useMemo(
    () =>
      detectDevServerTargets({
        detectedTasks: view.task.detectedTasks,
        runs: view.task.runs,
        outputByRunId: view.task.outputByRunId,
      }),
    [view.task.detectedTasks, view.task.outputByRunId, view.task.runs],
  );
  const browserCanCapture = Boolean(activeWorkspace);
  const activeLspDocumentPath =
    activeWorkspace && activeLoadedFile
      ? lspDocumentPathForWorkspace(activeWorkspace.path, activeLoadedFile.path)
      : null;
  const activeFileDiagnostics = activeLspDocumentPath
    ? diagnosticsForPath(view.language, activeLspDocumentPath)
    : [];
  const activeEditorTab =
    view.editor.tabs.find((tab) => tab.path === view.editor.activePath) ?? null;
  const activeDebugBreakpoints = view.editor.activePath
    ? (view.debug.breakpointsByPath[view.editor.activePath] ?? [])
    : [];
  const activeDebugLine = activeDebugLineForFile(
    view.debug,
    view.editor.activePath,
  );
  const activeEditorName = activeEditorTab?.name ?? "";
  const activeEditorParent = activeEditorTab
    ? parentNameFromPath(activeEditorTab.path)
    : "";
  const showEditor = surface === "editor";
  const splitBrowserSurface =
    shouldShowBrowserSplitEditor({
      surface,
      activeWorkspaceId,
      activePath: view.editor.activePath,
      loadedFile,
    });
  const showLoadedEditor = isLoadedEditorForActiveFile({
    surface,
    activeWorkspaceId,
    activePath: view.editor.activePath,
    loadedFile,
  });
  const selectedGitDiff = view.git.selectedDiff
    ? (view.git.diffByKey[
        gitDiffCacheKey(view.git.selectedDiff.path, view.git.selectedDiff.staged)
      ] ?? null)
    : null;
  const gitDecorations = useMemo(
    () => decorationMapFromStatus(view.git.status),
    [view.git.status],
  );
  const gitConfirmationText = gitConfirmation
    ? confirmationTextForGitAction(gitConfirmation.action)
    : "";
  const gitConfirmationReady =
    gitConfirmation !== null && gitConfirmationInput === gitConfirmationText;
  const activeDocsPreview = activeDocPreview(view.docs);
  const activeDocsPreviewPath = view.docs.activePreviewPath;
  const activeDocsPreviewPathLabel = docsPreviewPathLabel(
    view.docs,
    "Docs preview",
  );
  const docsPreviews = Object.values(view.docs.previewByPath);
  const availableAgentContext = useMemo(
    () =>
      collectAgentAvailableContext({
        workspaceRoot: activeWorkspace?.path ?? "",
        activeWorkspaceId: activeWorkspace?.id ?? null,
        loadedFile: activeLoadedFile,
        docsPreviews,
        browserScreenshots: view.browser.screenshots,
        selectedDiff: selectedGitDiff,
        activeFileDiagnostics,
        terminalSession: activeTerminal,
        terminalOutput: activeTerminal
          ? replayTerminalOutput(activeTerminal.id)
          : "",
      }),
    [
      activeWorkspace?.path,
      activeWorkspace?.id,
      loadedFile,
      docsPreviews,
      view.browser.screenshots,
      selectedGitDiff,
      activeFileDiagnostics,
      activeTerminal,
    ],
  );

  useEffect(() => {
    setFindOpen(false);
    setFindFocusRequest(0);
    setFindQuery("");
    setTerminalError(null);
    setGitConfirmation(null);
    setGitConfirmationInput("");
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (
      !activeWorkspaceId ||
      settingsLoadedWorkspaceRef.current.has(activeWorkspaceId)
    ) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const requestId = (settingsLoadRequestRef.current[workspaceId] ?? 0) + 1;
    settingsLoadRequestRef.current[workspaceId] = requestId;

    updateSettings(workspaceId, (settings) => ({
      ...settings,
      loading: true,
      error: null,
    }));

    void loadSettings()
      .then((settings) => {
        if (
          settingsLoadRequestRef.current[workspaceId] !== requestId ||
          !hasRegisteredWorkspace(workspaceId)
        ) {
          return;
        }

        settingsLoadedWorkspaceRef.current.add(workspaceId);
        updateSettings(workspaceId, (state) => storeSettings(state, settings));
      })
      .catch((error) => {
        if (
          settingsLoadRequestRef.current[workspaceId] !== requestId ||
          !hasRegisteredWorkspace(workspaceId)
        ) {
          return;
        }

        updateSettings(workspaceId, (state) =>
          setSettingsError(state, String(error)),
        );
      });
  }, [activeWorkspaceId, updateSettings]);

  useEffect(() => {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    void refreshDatabaseProfilesForWorkspace(activeWorkspaceId, activeWorkspace.path);
  }, [activeWorkspaceId, activeWorkspace?.path]);

  useEffect(() => {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    void refreshRemoteHostsForWorkspace(activeWorkspaceId, activeWorkspace.path);
  }, [activeWorkspaceId, activeWorkspace?.path]);

  useEffect(() => {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    void refreshDebugForWorkspace(activeWorkspaceId, activeWorkspace.path);
  }, [activeWorkspaceId, activeWorkspace?.path]);

  useEffect(() => {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    void refreshRecoveryForWorkspace(activeWorkspaceId, activeWorkspace.path);
  }, [activeWorkspaceId, activeWorkspace?.path]);

  useEffect(() => {
    if (activeActivity !== "settings" || !panelOpen || !activeWorkspaceId) {
      return;
    }

    void refreshDiagnosticsForWorkspace(activeWorkspaceId);
  }, [activeActivity, panelOpen, activeWorkspaceId]);

  useEffect(() => {
    if (
      activeActivity !== "extensions" ||
      !panelOpen ||
      !activeWorkspace ||
      !activeWorkspaceId
    ) {
      return;
    }

    void refreshExtensionsForWorkspace(activeWorkspaceId, activeWorkspace.path);
  }, [activeActivity, panelOpen, activeWorkspaceId, activeWorkspace?.path]);

  useEffect(() => {
    let disposed = false;
    const outputUnlisten = onTerminalOutput((event) => {
      if (disposed) {
        return;
      }

      handleTerminalOutputEvent(event);
    });
    const exitUnlisten = onTerminalExit((event) => {
      if (disposed) {
        return;
      }

      const workspaceId = knownWorkspaceIdForTerminal(event.session_id);
      if (!workspaceId) {
        return;
      }

      const currentView = workspaceViewStore.getState().viewFor(workspaceId);
      const hasSession = currentView.terminal.sessions.some(
        (session) => session.id === event.session_id,
      );
      const derivedWorkspaceId = workspaceIdFromTerminalSessionId(
        event.session_id,
      );

      if (hasSession) {
        workspaceViewStore
          .getState()
          .updateTerminal(workspaceId, (terminal) =>
            markTerminalExited(terminal, event.session_id),
          );
        return;
      }

      if (
        derivedWorkspaceId !== workspaceId ||
        !hasRegisteredWorkspace(workspaceId)
      ) {
        return;
      }

      workspaceViewStore
        .getState()
        .updateTerminal(workspaceId, (terminal) =>
          bufferTerminalExit(terminal, event.session_id),
        );
    });

    return () => {
      disposed = true;
      void outputUnlisten.then((dispose) => dispose()).catch(() => {});
      void exitUnlisten.then((dispose) => dispose()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const sessionUnlisten = listenDebugSession((event) => {
      if (!disposed) {
        handleDebugSessionEvent(event);
      }
    });
    const consoleUnlisten = listenDebugConsole((event) => {
      if (!disposed) {
        handleDebugConsoleEvent(event);
      }
    });
    const stoppedUnlisten = listenDebugStopped((event) => {
      if (disposed) {
        return;
      }
      handleDebugSessionEvent(event);
      void loadDebugStackForEvent(event);
    });
    const exitedUnlisten = listenDebugExited((event) => {
      if (!disposed) {
        handleDebugSessionEvent(event);
      }
    });

    return () => {
      disposed = true;
      void sessionUnlisten.then((dispose) => dispose()).catch(() => {});
      void consoleUnlisten.then((dispose) => dispose()).catch(() => {});
      void stoppedUnlisten.then((dispose) => dispose()).catch(() => {});
      void exitedUnlisten.then((dispose) => dispose()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const outputUnlisten = listenSshTerminalOutput((event) => {
      if (disposed) {
        return;
      }

      handleSshTerminalOutputEvent(event);
    });
    const exitUnlisten = listenSshTerminalExit((event) => {
      if (disposed) {
        return;
      }

      handleSshTerminalExitEvent(event);
    });

    return () => {
      disposed = true;
      void outputUnlisten.then((dispose) => dispose()).catch(() => {});
      void exitUnlisten.then((dispose) => dispose()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const outputUnlisten = onTaskOutput((event) => {
      if (disposed) {
        return;
      }

      const workspaceId = knownWorkspaceIdForTaskRun(event.run_id);
      if (!workspaceId) {
        return;
      }

      const currentView = workspaceViewStore.getState().viewFor(workspaceId);
      const hasRun = currentView.task.runs.some(
        (run) => run.id === event.run_id,
      );
      const derivedWorkspaceId = workspaceIdFromTaskRunId(event.run_id);

      if (hasRun) {
        workspaceViewStore
          .getState()
          .updateTask(workspaceId, (task) =>
            appendTaskOutput(task, event.run_id, event.chunk),
          );
        return;
      }

      if (
        derivedWorkspaceId !== workspaceId ||
        !hasRegisteredWorkspace(workspaceId)
      ) {
        return;
      }

      workspaceViewStore
        .getState()
        .updateTask(workspaceId, (task) =>
          appendTaskOutput(task, event.run_id, event.chunk),
        );
    });
    const finishedUnlisten = onTaskFinished((event) => {
      if (disposed) {
        return;
      }

      const workspaceId = knownWorkspaceIdForTaskRun(event.run_id);
      if (!workspaceId) {
        return;
      }

      const currentRegistry = workspaceStore.getState().registry;
      const currentWorkspace =
        currentRegistry.workspaces.find(
          (workspace) => workspace.id === workspaceId,
        ) ?? null;
      const currentView = workspaceViewStore.getState().viewFor(workspaceId);
      const hasRun = currentView.task.runs.some(
        (run) => run.id === event.run_id,
      );
      const derivedWorkspaceId = workspaceIdFromTaskRunId(event.run_id);

      if (hasRun) {
        workspaceViewStore
          .getState()
          .updateTask(workspaceId, (task) =>
            finishTaskRun(task, event.run_id, event.exit_code),
          );
        if (
          currentWorkspace &&
          shouldRefreshGitAfterTask({
            activeWorkspaceId: currentRegistry.active_workspace_id,
            runWorkspaceId: workspaceId,
            exitCode: event.exit_code,
          })
        ) {
          void refreshGitStatusForWorkspace(
            workspaceId,
            currentWorkspace.path,
            "Refresh",
          );
        }
        return;
      }

      if (
        derivedWorkspaceId !== workspaceId ||
        !hasRegisteredWorkspace(workspaceId)
      ) {
        return;
      }

      workspaceViewStore
        .getState()
        .updateTask(workspaceId, (task) =>
          finishTaskRun(task, event.run_id, event.exit_code),
        );
      if (
        currentWorkspace &&
        shouldRefreshGitAfterTask({
          activeWorkspaceId: currentRegistry.active_workspace_id,
          runWorkspaceId: workspaceId,
          exitCode: event.exit_code,
        })
      ) {
        void refreshGitStatusForWorkspace(
          workspaceId,
          currentWorkspace.path,
          "Refresh",
        );
      }
    });

    return () => {
      disposed = true;
      void outputUnlisten.then((dispose) => dispose()).catch(() => {});
      void finishedUnlisten.then((dispose) => dispose()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    let disposed = false;

    void listWorkspaceTasks(workspaceRoot)
      .then((tasks) => {
        if (disposed) {
          return;
        }

        updateTask(workspaceId, (task) => replaceDetectedTasks(task, tasks));
        setWorkspaceTaskError(workspaceId, null);
      })
      .catch((error) => {
        if (!disposed) {
          setWorkspaceTaskError(
            workspaceId,
            `Detect failed: ${terminalErrorMessage(error)}`,
          );
        }
      });

    void listTaskRuns(workspaceId)
      .then((runs) => {
        if (disposed) {
          return;
        }

        const contextPackByRunId = contextPackByLinkedTaskRunId(
          workspaceViewStore.getState().viewFor(workspaceId).docs.contextPacks,
        );
        updateTask(workspaceId, (task) =>
          replaceTaskRuns(task, runs, {
            ...task.contextPackByRunId,
            ...contextPackByRunId,
          }),
        );
      })
      .catch((error) => {
        if (!disposed) {
          setWorkspaceTaskError(
            workspaceId,
            `History failed: ${terminalErrorMessage(error)}`,
          );
        }
      });

    return () => {
      disposed = true;
    };
  }, [activeWorkspaceId, activeWorkspace?.path, updateTask]);

  useEffect(() => {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    let disposed = false;

    updateGit(workspaceId, (git) => setGitLoading(setGitError(git, null), true));

    void getGitStatus(workspaceRoot)
      .then((status) => {
        if (disposed) {
          return;
        }

        updateGit(workspaceId, (git) => replaceGitStatus(git, status));
        void listGitBranches(workspaceRoot)
          .then((branches) => {
            if (disposed) {
              return;
            }

            updateGit(workspaceId, (git) => storeBranches(git, branches));
          })
          .catch((error) => {
            if (!disposed) {
              updateGit(workspaceId, (git) =>
                setGitError(
                  git,
                  `Branches failed: ${terminalErrorMessage(error)}`,
                ),
              );
            }
          });
      })
      .catch((error) => {
        if (!disposed) {
          updateGit(workspaceId, (git) =>
            setGitError(git, `Status failed: ${terminalErrorMessage(error)}`),
          );
        }
      });

    return () => {
      disposed = true;
    };
  }, [activeWorkspaceId, activeWorkspace?.path, updateGit]);

  useEffect(() => {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const request = nextDocsLoadRequest(
      docsLoadRequestRef.current,
      workspaceId,
    );
    docsLoadRequestRef.current = request.state;
    const requestId = request.requestId;

    updateDocs(workspaceId, (docs) => ({
      ...docs,
      loading: true,
      error: null,
    }));

    void Promise.all([getDocsIndex(workspaceRoot), listContextPacks(workspaceRoot)])
      .then(([index, contextPacks]) => {
        const currentWorkspace =
          workspaceStore
            .getState()
            .registry.workspaces.find((workspace) => workspace.id === workspaceId) ??
          null;

        if (
          !isCurrentDocsLoadRequest(
            docsLoadRequestRef.current,
            workspaceId,
            requestId,
          ) ||
          workspaceStore.getState().registry.active_workspace_id !== workspaceId ||
          currentWorkspace?.path !== workspaceRoot
        ) {
          return;
        }

        updateDocs(workspaceId, (docs) => ({
          ...replaceDocsIndex(docs, index),
          contextPacks,
          loading: false,
          error: null,
        }));
        updateTask(workspaceId, (task) =>
          replaceTaskRunContextPacks(
            task,
            contextPackByLinkedTaskRunId(contextPacks),
          ),
        );
      })
      .catch((error) => {
        if (
          !isCurrentDocsLoadRequest(
            docsLoadRequestRef.current,
            workspaceId,
            requestId,
          )
        ) {
          return;
        }

        updateDocs(workspaceId, (docs) => ({
          ...docs,
          loading: false,
          error: `Docs failed: ${terminalErrorMessage(error)}`,
        }));
    });
  }, [activeWorkspaceId, activeWorkspace?.path, updateDocs]);

  useEffect(() => {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    let disposed = false;
    const requestId = (agentSessionsLoadRef.current[workspaceId] ?? 0) + 1;
    agentSessionsLoadRef.current = {
      ...agentSessionsLoadRef.current,
      [workspaceId]: requestId,
    };

    void listAgentSessions(workspaceRoot)
      .then((sessions) => {
        if (disposed) {
          return;
        }

        const currentWorkspace = workspaceStore
          .getState()
          .registry.workspaces.find((workspace) => workspace.id === workspaceId) ??
          null;

        if (
          agentSessionsLoadRef.current[workspaceId] !== requestId ||
          workspaceStore.getState().registry.active_workspace_id !== workspaceId ||
          currentWorkspace?.path !== workspaceRoot
        ) {
          return;
        }

        updateAgent(workspaceId, (agent) =>
          replaceAgentSessions(agent, sessions),
        );
      })
      .catch((error) => {
        if (disposed) {
          return;
        }

        if (agentSessionsLoadRef.current[workspaceId] !== requestId) {
          return;
        }

        if (!hasRegisteredWorkspace(workspaceId)) {
          return;
        }

        const currentWorkspace = workspaceStore
          .getState()
          .registry.workspaces.find((workspace) => workspace.id === workspaceId) ??
          null;
        if (!currentWorkspace || currentWorkspace.path !== workspaceRoot) {
          return;
        }

        updateAgent(workspaceId, (agent) => ({
          ...agent,
          loading: false,
          error: `Load sessions failed: ${terminalErrorMessage(error)}`,
        }));
      });

    return () => {
      disposed = true;
    };
  }, [activeWorkspaceId, activeWorkspace?.path, updateAgent]);

  useEffect(() => {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    let disposed = false;
    let watchHandle: WatchWorkspaceHandle | null = null;
    let watchedWorkspace: WatchedWorkspaceIdentity | null = null;

    void watchWorkspace(workspaceRoot)
      .then((handle) => {
        if (disposed) {
          void unwatchWorkspace(handle).catch(() => {});
          return;
        }

        watchHandle = handle;
        watchedWorkspace = {
          workspaceId,
          registryRoot: workspaceRoot,
          watchedRoot: handle.workspace_root,
        };
      })
      .catch(() => {});

    const unlisten = listen<FileChangedPayload>(
      "workspace://file-changed",
      (event) => {
        const currentRegistry = workspaceStore.getState().registry;
        const watched = watchedWorkspace;
        const currentWorkspace =
          currentRegistry.workspaces.find(
            (workspace) => workspace.id === workspaceId,
          ) ?? null;

        if (
          currentWorkspace?.path !== watched?.registryRoot ||
          !shouldApplyWorkspaceFileChangedEvent({
            activeWorkspaceId: currentRegistry.active_workspace_id,
            eventWorkspaceRoot: event.payload.workspace_root,
            watchedWorkspace: watched,
          })
        ) {
          return;
        }

        updateEditor(workspaceId, (editor) =>
          markExternalChangeFromDisk(
            editor,
            event.payload.path,
            event.payload.version,
          ),
        );
        const eventPath =
          watched === null
            ? event.payload.path
            : (relativePathFromWorkspace(
                watched.watchedRoot,
                event.payload.path,
              ) ?? event.payload.path);
        if (
          currentWorkspace &&
          shouldRefreshGitAfterFileEvent({
            activeWorkspaceId: currentRegistry.active_workspace_id,
            eventWorkspaceId: workspaceId,
            path: eventPath,
          })
        ) {
          void refreshGitStatusForWorkspace(
            workspaceId,
            currentWorkspace.path,
            "Refresh",
          );
        }
      },
    );

    return () => {
      disposed = true;
      void unlisten.then((dispose) => dispose()).catch(() => {});
      if (watchHandle) {
        void unwatchWorkspace(watchHandle).catch(() => {});
      }
    };
  }, [activeWorkspaceId, activeWorkspace?.path, updateEditor]);

  async function refreshRecoveryForWorkspace(
    workspaceId: string,
    workspaceRoot: string,
  ) {
    const requestId = (recoveryLoadRequestRef.current[workspaceId] ?? 0) + 1;
    recoveryLoadRequestRef.current[workspaceId] = requestId;
    updateRecovery(workspaceId, (recovery) => ({
      ...recovery,
      loading: true,
      error: null,
    }));

    try {
      const backups = await listUnsavedBackups({ workspaceRoot, workspaceId });
      if (recoveryLoadRequestRef.current[workspaceId] !== requestId) {
        return;
      }

      updateRecovery(workspaceId, (recovery) =>
        storeRecoveryBackups(recovery, backups),
      );
    } catch (error) {
      if (recoveryLoadRequestRef.current[workspaceId] !== requestId) {
        return;
      }

      updateRecovery(workspaceId, (recovery) => ({
        ...recovery,
        loading: false,
        error: `Recovery failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  async function refreshDiagnosticsForWorkspace(workspaceId: string) {
    const requestId =
      (diagnosticsRefreshRequestRef.current[workspaceId] ?? 0) + 1;
    diagnosticsRefreshRequestRef.current[workspaceId] = requestId;

    updateDiagnostics(workspaceId, (diagnostics) => ({
      ...diagnostics,
      loading: true,
      error: null,
    }));

    try {
      const registrySnapshot = workspaceStore.getState().registry;
      const viewSnapshot = workspaceViewStore.getState().viewFor(workspaceId);
      const [metric, events] = await Promise.all([
        metricSnapshot({
          workspaceCount: registrySnapshot.workspaces.length,
          activeWorkspaceId: registrySnapshot.active_workspace_id,
          docsIndexEntries: viewSnapshot.docs.index.length,
          fileTreeEntries: 0,
        }),
        listDiagnosticEvents({ limit: 50 }),
      ]);

      if (
        diagnosticsRefreshRequestRef.current[workspaceId] !== requestId ||
        !hasRegisteredWorkspace(workspaceId)
      ) {
        return;
      }

      updateDiagnostics(workspaceId, (diagnostics) =>
        storeDiagnosticEvents(storeMetricSnapshot(diagnostics, metric), events),
      );

      if (!diagnosticsStartupEventRef.current) {
        diagnosticsStartupEventRef.current = true;
        void appendDiagnosticEvent({
          level: "info",
          source: "frontend",
          message: "Diagnostics refreshed",
        }).catch(() => {});
      }
    } catch (error) {
      if (
        diagnosticsRefreshRequestRef.current[workspaceId] !== requestId ||
        !hasRegisteredWorkspace(workspaceId)
      ) {
        return;
      }

      updateDiagnostics(workspaceId, (diagnostics) => ({
        ...diagnostics,
        loading: false,
        error: `Diagnostics failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  function recoverySaveKey(workspaceId: string, path: string): string {
    return `${workspaceId}\n${path}`;
  }

  function nextRecoverySaveEpoch(workspaceId: string, path: string): number {
    const key = recoverySaveKey(workspaceId, path);
    const epoch = (recoverySaveEpochRef.current[key] ?? 0) + 1;
    recoverySaveEpochRef.current[key] = epoch;
    return epoch;
  }

  function isLatestRecoverySaveEpoch(
    workspaceId: string,
    path: string,
    epoch: number,
  ): boolean {
    return recoverySaveEpochRef.current[recoverySaveKey(workspaceId, path)] === epoch;
  }

  function markRecoverySaveDirty(
    workspaceId: string,
    workspaceRoot: string,
    path: string,
    content: string,
    version: FileVersion | null,
  ): number {
    const epoch = nextRecoverySaveEpoch(workspaceId, path);
    recoverySaveIntentRef.current[recoverySaveKey(workspaceId, path)] = {
      state: "dirty",
      workspaceRoot,
      content,
      version,
      epoch,
    };
    return epoch;
  }

  function markRecoverySaveClean(
    workspaceId: string,
    workspaceRoot: string,
    path: string,
  ): void {
    const epoch = nextRecoverySaveEpoch(workspaceId, path);
    recoverySaveIntentRef.current[recoverySaveKey(workspaceId, path)] = {
      state: "clean",
      workspaceRoot,
      epoch,
    };
  }

  function discardResolvedRecoveryBackup(
    workspaceId: string,
    workspaceRoot: string,
    path: string,
    backupId: string,
  ) {
    void discardUnsavedBackup({
      workspaceRoot,
      workspaceId,
      backupId,
    })
      .then(() => {
        updateRecovery(workspaceId, (recovery) =>
          discardRecoveryBackup(recovery, backupId),
        );
        const key = recoverySaveKey(workspaceId, path);
        const intent = recoverySaveIntentRef.current[key];
        const currentTab = workspaceViewStore
          .getState()
          .viewFor(workspaceId)
          .editor.tabs.find((tab) => tab.path === path);
        if (
          intent?.state === "dirty" &&
          intent.workspaceRoot === workspaceRoot &&
          intent.epoch === recoverySaveEpochRef.current[key] &&
          currentTab?.dirty
        ) {
          saveRecoveryBackup(
            workspaceId,
            workspaceRoot,
            path,
            intent.content,
            intent.version,
          );
        }
      })
      .catch((error) => {
        updateRecovery(workspaceId, (recovery) => ({
          ...recovery,
          error: `Discard failed: ${terminalErrorMessage(error)}`,
        }));
      });
  }

  function reconcileStaleRecoverySave(
    workspaceId: string,
    workspaceRoot: string,
    path: string,
    backup: UnsavedBackup,
  ) {
    const currentWorkspace = workspaceStore
      .getState()
      .registry.workspaces.find((workspace) => workspace.id === workspaceId);
    if (currentWorkspace?.path !== workspaceRoot) {
      return;
    }

    const key = recoverySaveKey(workspaceId, path);
    const intent = recoverySaveIntentRef.current[key];
    const currentTab = workspaceViewStore
      .getState()
      .viewFor(workspaceId)
      .editor.tabs.find((tab) => tab.path === path);

    if (!intent || intent.state === "clean" || !currentTab?.dirty) {
      discardResolvedRecoveryBackup(workspaceId, workspaceRoot, path, backup.id);
      return;
    }

    if (
      intent.workspaceRoot === workspaceRoot &&
      intent.epoch === recoverySaveEpochRef.current[key] &&
      backup.content !== intent.content
    ) {
      saveRecoveryBackup(
        workspaceId,
        workspaceRoot,
        path,
        intent.content,
        intent.version,
      );
    }
  }

  function saveRecoveryBackup(
    workspaceId: string,
    workspaceRoot: string,
    path: string,
    content: string,
    version: FileVersion | null,
  ) {
    const saveEpoch = markRecoverySaveDirty(
      workspaceId,
      workspaceRoot,
      path,
      content,
      version,
    );
    void saveUnsavedBackup({
      workspaceRoot,
      workspaceId,
      path,
      content,
      version,
    })
      .then((backup) => {
        if (!isLatestRecoverySaveEpoch(workspaceId, path, saveEpoch)) {
          reconcileStaleRecoverySave(workspaceId, workspaceRoot, path, backup);
          return;
        }

        const currentWorkspace = workspaceStore
          .getState()
          .registry.workspaces.find((workspace) => workspace.id === workspaceId);
        const currentView = workspaceViewStore.getState().viewFor(workspaceId);
        const currentTab = currentView.editor.tabs.find(
          (tab) => tab.path === path,
        );
        if (
          currentWorkspace?.path !== workspaceRoot ||
          currentView.editor.activePath !== path
        ) {
          return;
        }
        if (!currentTab?.dirty) {
          discardResolvedRecoveryBackup(workspaceId, workspaceRoot, path, backup.id);
          return;
        }

        updateRecovery(workspaceId, (recovery) =>
          storeRecoveryBackups(recovery, [
            ...recovery.backups.filter((item) => item.id !== backup.id),
            backup,
          ]),
        );
      })
      .catch((error) => {
        updateRecovery(workspaceId, (recovery) => ({
          ...recovery,
          error: `Recovery failed: ${terminalErrorMessage(error)}`,
        }));
      });
  }

  function discardRecoveryBackupForPath(
    workspaceId: string,
    workspaceRoot: string,
    path: string,
  ) {
    markRecoverySaveClean(workspaceId, workspaceRoot, path);
    const backup = workspaceViewStore
      .getState()
      .viewFor(workspaceId)
      .recovery.backups.find((item) => item.path === path);
    if (!backup) {
      return;
    }

    discardResolvedRecoveryBackup(workspaceId, workspaceRoot, path, backup.id);
  }

  async function restoreRecoveryBackupById(backupId: string) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const backupSummary = workspaceViewStore
      .getState()
      .viewFor(activeWorkspaceId)
      .recovery.backups.find((item) => item.id === backupId);
    if (!backupSummary) {
      return;
    }

    updateRecovery(activeWorkspaceId, (recovery) =>
      restoreRecoveryBackup(recovery, backupId),
    );
    setEditorError(null);

    let backupContent = "";
    let backupVersion = backupSummary.version;
    try {
      const freshBackups = await listUnsavedBackups({
        workspaceRoot: activeWorkspace.path,
        workspaceId: activeWorkspaceId,
      });
      const fullBackup = freshBackups.find((item) => item.id === backupId);
      updateRecovery(activeWorkspaceId, (recovery) => {
        const stored = storeRecoveryBackups(recovery, freshBackups);
        return stored.backups.some((item) => item.id === backupId)
          ? {
              ...stored,
              selectedBackupId: backupId,
              restoringBackupId: backupId,
            }
          : stored;
      });
      if (!fullBackup) {
        updateRecovery(activeWorkspaceId, (recovery) => ({
          ...recovery,
          restoringBackupId: null,
          error: "Restore failed: backup is no longer available",
        }));
        return;
      }

      backupContent = fullBackup.content;
      backupVersion = fullBackup.version;
    } catch (error) {
      updateRecovery(activeWorkspaceId, (recovery) => ({
        ...recovery,
        restoringBackupId: null,
        error: `Restore failed: ${terminalErrorMessage(error)}`,
      }));
      return;
    }

    let savedContent = "";
    let version = backupVersion;
    try {
      const read = await readTextFile(activeWorkspace.path, backupSummary.path);
      savedContent = read.content ?? "";
      version = read.version;
    } catch {
      savedContent =
        savedContentByPathRef.current[
          createLoadedFileKey(activeWorkspaceId, backupSummary.path)
        ] ?? "";
    }

    savedContentByPathRef.current[
      createLoadedFileKey(activeWorkspaceId, backupSummary.path)
    ] = savedContent;
    updateEditor(activeWorkspaceId, (editor) =>
      openFileTab(editor, {
        path: backupSummary.path,
        name: backupSummary.path.split(/[\\/]/).pop() ?? backupSummary.path,
        dirty: true,
        tooLarge: false,
        version,
        externalChange: false,
      }),
    );
    setLoadedFile({
      workspaceId: activeWorkspaceId,
      path: backupSummary.path,
      content: backupContent,
      language: languageForPath(backupSummary.path),
      readOnly: false,
    });
    if (isLspSupportedDocumentPath(backupSummary.path)) {
      void openLanguageDocument({
        workspaceId: activeWorkspaceId,
        workspaceRoot: activeWorkspace.path,
        path: lspDocumentPathForWorkspace(activeWorkspace.path, backupSummary.path),
        content: backupContent,
      }).catch(() => {});
    }
    setSurface("editor");
    updateRecovery(activeWorkspaceId, (recovery) => ({
      ...recovery,
      restoringBackupId: null,
    }));
  }

  async function discardRecoveryBackupById(backupId: string) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const backup = workspaceViewStore
      .getState()
      .viewFor(activeWorkspaceId)
      .recovery.backups.find((item) => item.id === backupId);
    if (!backup) {
      return;
    }
    nextRecoverySaveEpoch(activeWorkspaceId, backup.path);

    try {
      await discardUnsavedBackup({
        workspaceRoot: activeWorkspace.path,
        workspaceId: activeWorkspaceId,
        backupId: backup.id,
      });
      updateRecovery(activeWorkspaceId, (recovery) =>
        discardRecoveryBackup(recovery, backup.id),
      );
    } catch (error) {
      updateRecovery(activeWorkspaceId, (recovery) => ({
        ...recovery,
        error: `Discard failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  async function openFile(path: string) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const requestId = openRequestRef.current + 1;
    openRequestRef.current = requestId;
    setEditorError(null);

    try {
      const read = await readTextFile(activeWorkspace.path, path);
      if (requestId !== openRequestRef.current) {
        return;
      }

      const name = path.split(/[\\/]/).pop() ?? path;
      const diskContent = read.content ?? "";
      const draft = read.too_large ? null : tryLoadDraft(activeWorkspaceId, path);
      const content = draft ?? diskContent;
      const language = languageForPath(path);
      const fileKey = createLoadedFileKey(activeWorkspaceId, path);

      savedContentByPathRef.current[fileKey] = diskContent;
      updateEditor(activeWorkspaceId, (editor) =>
        openFileTab(editor, {
          path,
          name,
          dirty: draft !== null,
          tooLarge: read.too_large,
          version: read.version,
          externalChange: false,
        }),
      );
      setLoadedFile({
        workspaceId: activeWorkspaceId,
        path,
        content,
        language,
        readOnly: read.too_large,
      });
      if (isLspSupportedDocumentPath(path)) {
        void openLanguageDocument({
          workspaceId: activeWorkspaceId,
          workspaceRoot: activeWorkspace.path,
          path: lspDocumentPathForWorkspace(activeWorkspace.path, path),
          content,
        }).catch(() => {});
      }
      setSurface("editor");
    } catch (err) {
      if (requestId !== openRequestRef.current) {
        return;
      }

      setLoadedFile(null);
      setEditorError(err instanceof Error ? err.message : String(err));
      setSurface("editor");
    }
  }

  useEffect(() => {
    if (surface !== "editor") {
      return;
    }

    if (!activeWorkspace || !activeWorkspaceId || !view.editor.activePath) {
      setLoadedFile(null);
      setEditorError(null);
      return;
    }

    if (
      shouldLoadActiveEditor({
        surface,
        activeWorkspaceId,
        activePath: view.editor.activePath,
        loadedFile,
      })
    ) {
      void openFile(view.editor.activePath);
    }
  }, [activeWorkspaceId, activeWorkspace?.path, surface, view.editor.activePath]);

  function handleEditorContentChange(content: string) {
    if (
      !activeWorkspaceId ||
      !loadedFile ||
      !isLoadedEditorForActiveFile({
        surface,
        activeWorkspaceId,
        activePath: view.editor.activePath,
        loadedFile,
      })
    ) {
      return;
    }

    const fileKey = createLoadedFileKey(activeWorkspaceId, loadedFile.path);
    const savedContent = savedContentByPathRef.current[fileKey] ?? "";
    const dirty = content !== savedContent;
    setLoadedFile((current) =>
      updateLoadedFileContent(
        current,
        activeWorkspaceId,
        loadedFile.path,
        content,
      ),
    );
    updateEditor(activeWorkspaceId, (editor) =>
      markFileDirty(editor, loadedFile.path, dirty),
    );

    if (dirty) {
      trySaveDraft(activeWorkspaceId, loadedFile.path, content);
      const activeTab = view.editor.tabs.find(
        (tab) => tab.path === loadedFile.path,
      );
      if (activeWorkspace) {
        saveRecoveryBackup(
          activeWorkspaceId,
          activeWorkspace.path,
          loadedFile.path,
          content,
          activeTab?.version ?? null,
        );
      }
    } else {
      tryClearDraft(activeWorkspaceId, loadedFile.path);
      if (activeWorkspace) {
        discardRecoveryBackupForPath(
          activeWorkspaceId,
          activeWorkspace.path,
          loadedFile.path,
        );
      }
    }
  }

  async function saveActiveFile() {
    const currentView = workspaceViewStore
      .getState()
      .viewFor(activeWorkspaceId);
    const activePath = currentView.editor.activePath;
    const activeTab = currentView.editor.tabs.find(
      (tab) => tab.path === activePath,
    );
    if (
      !activeWorkspace ||
      !activeWorkspaceId ||
      !activePath ||
      !activeTab ||
      !loadedFile ||
      loadedFile.workspaceId !== activeWorkspaceId ||
      loadedFile.path !== activePath ||
      loadedFile.readOnly
    ) {
      return;
    }

    setEditorError(null);

    try {
      const content = loadedFile.content;
      const result = await writeTextFile(
        activeWorkspace.path,
        activePath,
        content,
        activeTab.version,
      );
      if (result.version) {
        savedContentByPathRef.current[
          createLoadedFileKey(activeWorkspaceId, activePath)
        ] = content;
        updateEditor(activeWorkspaceId, (editor) =>
          applySavedVersion(editor, activePath, result.version!),
        );
        tryClearDraft(activeWorkspaceId, activePath);
        discardRecoveryBackupForPath(
          activeWorkspaceId,
          activeWorkspace.path,
          activePath,
        );

        if (
          isLspSupportedDocumentPath(activePath) &&
          loadedFile.workspaceId === activeWorkspaceId &&
          loadedFile.path === activePath
        ) {
          void openLanguageDocument({
            workspaceId: activeWorkspaceId,
            workspaceRoot: activeWorkspace.path,
            path: lspDocumentPathForWorkspace(activeWorkspace.path, activePath),
            content,
          }).catch(() => {});
        }
      }
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createFileFromExplorer(relativePath: string) {
    if (!activeWorkspace) {
      return;
    }

    const result = await createTextFile(activeWorkspace.path, relativePath);
    await openFile(result.path);
    setFileTreeRefreshKey((value) => value + 1);
  }

  async function promptCreateFileAtWorkspaceRoot() {
    if (!activeWorkspace) {
      return;
    }

    const relativePath = window.prompt(`New file in ${activeWorkspace.name}`, "");
    const trimmed = relativePath?.trim();
    if (!trimmed) {
      return;
    }

    await createFileFromExplorer(trimmed);
  }

  async function renamePathFromExplorer(path: string, newName: string) {
    if (!activeWorkspace) {
      return;
    }

    const loadedBeforeRename = loadedFile;
    const openPathsBeforeRename = workspaceViewStore
      .getState()
      .viewFor(activeWorkspaceId)
      .editor.tabs.map((tab) => tab.path);
    const result = await renamePath(activeWorkspace.path, path, newName);
    if (activeWorkspaceId) {
      for (const change of lspDocumentChangesForWorkspacePaths(
        activeWorkspace.path,
        openPathsBeforeRename,
        path,
        result.path,
      )) {
        if (change.closePath) {
          void closeLanguageDocument({
            workspaceId: activeWorkspaceId,
            workspaceRoot: activeWorkspace.path,
            path: change.closePath,
          }).catch(() => {});
        }

        if (
          change.openPath &&
          loadedBeforeRename?.workspaceId === activeWorkspaceId &&
          loadedBeforeRename.path === change.previousPath
        ) {
          void openLanguageDocument({
            workspaceId: activeWorkspaceId,
            workspaceRoot: activeWorkspace.path,
            path: change.openPath,
            content: loadedBeforeRename.content,
          }).catch(() => {});
        }
      }
    }
    updateEditor(activeWorkspaceId, (editor) =>
      renameEditorPath(editor, path, result.path, result.version),
    );
    setLoadedFile((current) => {
      if (
        !activeWorkspaceId ||
        !current ||
        current.workspaceId !== activeWorkspaceId ||
        !isSameOrDescendant(current.path, path)
      ) {
        return current;
      }

      const nextPath = replacePathPrefix(current.path, path, result.path);
      const previousKey = createLoadedFileKey(activeWorkspaceId, current.path);
      const nextKey = createLoadedFileKey(activeWorkspaceId, nextPath);
      const savedContent = savedContentByPathRef.current[previousKey];
      if (savedContent !== undefined) {
        delete savedContentByPathRef.current[previousKey];
        savedContentByPathRef.current[nextKey] = savedContent;
      }

      return {
        ...current,
        path: nextPath,
        language: languageForPath(nextPath),
      };
    });
    setFileTreeRefreshKey((value) => value + 1);
  }

  async function deletePathFromExplorer(path: string) {
    if (!activeWorkspace) {
      return;
    }

    const openPathsBeforeDelete = workspaceViewStore
      .getState()
      .viewFor(activeWorkspaceId)
      .editor.tabs.map((tab) => tab.path);
    await deletePath(activeWorkspace.path, path);
    const currentView = workspaceViewStore
      .getState()
      .viewFor(activeWorkspaceId);
    const nextEditor = removeEditorPath(currentView.editor, path);
    const nextSurface = surfaceAfterEditorRemoval(
      currentView.surface,
      currentView.editor,
      nextEditor,
    );
    const removedLoadedFile = loadedFile
      ? loadedFile.workspaceId === activeWorkspaceId &&
        isSameOrDescendant(loadedFile.path, path)
      : false;
    if (
      activeWorkspaceId
    ) {
      for (const change of lspDocumentChangesForWorkspacePaths(
        activeWorkspace.path,
        openPathsBeforeDelete,
        path,
        null,
      )) {
        if (change.closePath) {
          void closeLanguageDocument({
            workspaceId: activeWorkspaceId,
            workspaceRoot: activeWorkspace.path,
            path: change.closePath,
          }).catch(() => {});
        }
      }
    }
    updateEditor(activeWorkspaceId, (editor) => removeEditorPath(editor, path));
    if (nextSurface !== currentView.surface) {
      updateView(activeWorkspaceId, { surface: nextSurface });
    }
    if (removedLoadedFile) {
      setLoadedFile(null);
      setEditorError(null);
    }
    if (removedLoadedFile && nextSurface === "editor" && nextEditor.activePath) {
      void openFile(nextEditor.activePath);
    }
    setFileTreeRefreshKey((value) => value + 1);
  }

  function closeEditorTab(path: string) {
    const nextEditor = closeFileTab(view.editor, path);
    if (
      isLspSupportedDocumentPath(path) &&
      activeWorkspaceId &&
      activeWorkspace
    ) {
      void closeLanguageDocument({
        workspaceId: activeWorkspaceId,
        workspaceRoot: activeWorkspace.path,
        path: lspDocumentPathForWorkspace(activeWorkspace.path, path),
      }).catch(() => {});
    }
    updateEditor(activeWorkspaceId, () => nextEditor);

    if (view.editor.activePath !== path) {
      return;
    }

    if (
      loadedFile?.workspaceId === activeWorkspaceId &&
      loadedFile.path === path
    ) {
      setLoadedFile(null);
      setEditorError(null);
    }

    if (surface !== "editor") {
      return;
    }

    if (nextEditor.activePath) {
      void openFile(nextEditor.activePath);
      return;
    }

    setSurface("empty");
  }

  function updateTerminalCwdInput(value: string) {
    updateTerminal(activeWorkspaceId, (terminal) => ({
      ...terminal,
      cwdInput: value,
    }));
  }

  function activateTerminalById(sessionId: string) {
    const workspaceId = knownWorkspaceIdForTerminal(sessionId);
    if (!workspaceId) {
      return;
    }

    updateTerminal(workspaceId, (terminal) =>
      activateTerminal(terminal, sessionId),
    );
    updateView(workspaceId, {
      activeActivity: "terminal",
      surface: "terminal",
    });
  }

  async function newTerminal() {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const currentView = workspaceViewStore.getState().viewFor(workspaceId);
    const cwd = currentView.terminal.cwdInput.trim() || workspaceRoot;

    try {
      const session = await spawnTerminalSession({
        workspaceId,
        workspaceRoot,
        cwd,
        rows: 24,
        cols: 80,
      });

      updateTerminal(workspaceId, (terminal) =>
        activateTerminal(upsertTerminal(terminal, session), session.id),
      );
      updateView(workspaceId, {
        activeActivity: "terminal",
        surface: "terminal",
      });
      setTerminalError(null);
    } catch (error) {
      setTerminalError(`Start failed: ${terminalErrorMessage(error)}`);
    }
  }

  async function closeRemoteTerminalForLocalRemoval(
    sessionId: string,
    failureLabel: string,
  ): Promise<boolean> {
    try {
      await closeTerminalSession(sessionId);
      setTerminalError(null);
      return true;
    } catch (error) {
      if (isMissingTerminalSessionError(error)) {
        setTerminalError(null);
        return true;
      }

      setTerminalError(`${failureLabel}: ${terminalErrorMessage(error)}`);
      return false;
    }
  }

  async function closeTerminalById(sessionId: string) {
    const workspaceId = knownWorkspaceIdForTerminal(sessionId);
    const canRemove = await closeRemoteTerminalForLocalRemoval(
      sessionId,
      "Close failed",
    );

    if (!canRemove || !workspaceId) {
      return;
    }

    updateTerminal(workspaceId, (terminal) =>
      closeTerminal(terminal, sessionId),
    );
    clearTerminalReplayOutput(sessionId);
  }

  async function restartTerminalById(sessionId: string) {
    const workspaceId = knownWorkspaceIdForTerminal(sessionId);
    if (!workspaceId) {
      return;
    }

    const currentView = workspaceViewStore.getState().viewFor(workspaceId);
    const previousSession =
      currentView.terminal.sessions.find((session) => session.id === sessionId) ??
      null;
    const workspace =
      workspaceStore
        .getState()
        .registry.workspaces.find(
          (item) => item.id === (previousSession?.workspace_id ?? workspaceId),
        ) ?? null;

    if (!workspace) {
      return;
    }

    const canRemove = await closeRemoteTerminalForLocalRemoval(
      sessionId,
      "Restart failed",
    );
    if (!canRemove) {
      return;
    }

    updateTerminal(workspaceId, (terminal) =>
      closeTerminal(terminal, sessionId),
    );
    clearTerminalReplayOutput(sessionId);

    try {
      const session = await spawnTerminalSession({
        workspaceId,
        workspaceRoot: workspace.path,
        cwd: previousSession?.cwd ?? workspace.path,
        name: previousSession?.name,
        rows: 24,
        cols: 80,
      });

      updateTerminal(workspaceId, (terminal) =>
        activateTerminal(upsertTerminal(terminal, session), session.id),
      );
      updateView(workspaceId, {
        activeActivity: "terminal",
        surface: "terminal",
      });
      setTerminalError(null);
    } catch (error) {
      setTerminalError(`Restart failed: ${terminalErrorMessage(error)}`);
    }
  }

  function writeTerminalInput(sessionId: string, data: string) {
    void writeTerminalSession(sessionId, data).catch((error) => {
      setTerminalError(`Input failed: ${terminalErrorMessage(error)}`);
    });
  }

  function updateTaskCustomCommand(value: string) {
    updateTask(activeWorkspaceId, (task) => setCustomCommand(task, value));
  }

  function activateTaskRunById(runId: string) {
    const workspaceId = knownWorkspaceIdForTaskRun(runId);
    if (!workspaceId) {
      return;
    }

    updateTask(workspaceId, (task) => activateTaskRun(task, runId));
    updateView(workspaceId, {
      activeActivity: "tasks",
      panelOpen: true,
    });
  }

  async function runTaskCommand(task: {
    label: string;
    command: string;
    cwd: string;
  }) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;

    try {
      const run = await invokeRunWorkspaceTask({
        workspaceId,
        workspaceRoot,
        label: task.label,
        command: task.command,
        cwd: task.cwd,
      });

      updateTask(workspaceId, (state) =>
        activateTaskRun(upsertTaskRun(state, run), run.id),
      );
      updateView(workspaceId, {
        activeActivity: "tasks",
        panelOpen: true,
      });
      setWorkspaceTaskError(workspaceId, null);
    } catch (error) {
      setWorkspaceTaskError(
        workspaceId,
        `Run failed: ${terminalErrorMessage(error)}`,
      );
      updateView(workspaceId, {
        activeActivity: "tasks",
        panelOpen: true,
      });
    }
  }

  function runDetectedTask(task: WorkspaceTask) {
    void runTaskCommand({
      label: task.label,
      command: task.command,
      cwd: task.cwd,
    });
  }

  function runCustomTask(command: string) {
    const trimmed = command.trim();
    if (!trimmed || !activeWorkspace) {
      return;
    }

    void runTaskCommand({
      label: trimmed,
      command: trimmed,
      cwd: activeWorkspace.path,
    });
  }

  async function stopTaskRunById(runId: string) {
    const workspaceId = knownWorkspaceIdForTaskRun(runId) ?? activeWorkspaceId;
    if (!workspaceId) {
      return;
    }

    try {
      const stopped = await stopTaskRun(runId);
      updateTask(workspaceId, (task) =>
        activateTaskRun(
          upsertTaskRun(stopTaskRunInState(task, runId), stopped),
          runId,
        ),
      );
      setWorkspaceTaskError(workspaceId, null);
    } catch (error) {
      setWorkspaceTaskError(
        workspaceId,
        `Stop failed: ${terminalErrorMessage(error)}`,
      );
      updateView(workspaceId, {
        activeActivity: "tasks",
        panelOpen: true,
      });
    }
  }

  function rerunTaskRun(run?: TaskRun) {
    const state = workspaceViewStore.getState().viewFor(activeWorkspaceId).task;
    const task = run
      ? { label: run.label, command: run.command, cwd: run.cwd }
      : rerunnableTaskForState(state);

    if (!task) {
      setActiveActivity("tasks");
      setPanelOpen(true);
      return;
    }

    void runTaskCommand(task);
  }

  function runTaskFromPalette() {
    const taskState = workspaceViewStore.getState().viewFor(activeWorkspaceId).task;
    const customCommand = taskState.customCommand.trim();

    if (customCommand) {
      runCustomTask(customCommand);
      return;
    }

    const firstDetectedTask = taskState.detectedTasks[0];
    if (firstDetectedTask) {
      runDetectedTask(firstDetectedTask);
      return;
    }

    setActiveActivity("tasks");
    setPanelOpen(true);
  }

  function stopActiveTaskRun() {
    const taskState = workspaceViewStore.getState().viewFor(activeWorkspaceId).task;
    const run = runningTaskRunForState(taskState);

    if (!run) {
      setActiveActivity("tasks");
      setPanelOpen(true);
      return;
    }

    void stopTaskRunById(run.id);
  }

  function updateGitMessage(message: string) {
    updateGit(activeWorkspaceId, (git) =>
      updateGitCommitMessage(git, message),
    );
  }

  async function refreshGitBranchesForWorkspace(
    workspaceId: string,
    workspaceRoot: string,
    label = "Branches",
  ): Promise<boolean> {
    try {
      const branches = await listGitBranches(workspaceRoot);
      updateGit(workspaceId, (git) => storeBranches(git, branches));
      return true;
    } catch (error) {
      updateGit(workspaceId, (git) =>
        setGitError(git, `${label} failed: ${terminalErrorMessage(error)}`),
      );
      return false;
    }
  }

  async function refreshGitStatusForWorkspace(
    workspaceId: string,
    workspaceRoot: string,
    label = "Refresh",
  ): Promise<void> {
    updateGit(workspaceId, (git) => setGitLoading(setGitError(git, null), true));

    try {
      const status = await getGitStatus(workspaceRoot);
      updateGit(workspaceId, (git) => replaceGitStatus(git, status));
      await refreshGitBranchesForWorkspace(workspaceId, workspaceRoot);
    } catch (error) {
      updateGit(workspaceId, (git) =>
        setGitError(git, `${label} failed: ${terminalErrorMessage(error)}`),
      );
    }
  }

  async function refreshGitStatus(label = "Refresh") {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    await refreshGitStatusForWorkspace(
      activeWorkspaceId,
      activeWorkspace.path,
      label,
    );
  }

  async function runGitStatusMutation(
    label: string,
    mutation: (workspaceRoot: string) => Promise<GitRepositoryStatus>,
  ): Promise<boolean> {
    if (!activeWorkspace || !activeWorkspaceId) {
      return false;
    }

    return runGitStatusMutationForWorkspace(
      activeWorkspaceId,
      activeWorkspace.path,
      label,
      mutation,
    );
  }

  async function runGitStatusMutationForWorkspace(
    workspaceId: string,
    workspaceRoot: string,
    label: string,
    mutation: (workspaceRoot: string) => Promise<GitRepositoryStatus>,
  ): Promise<boolean> {
    updateGit(workspaceId, (git) => setGitLoading(setGitError(git, null), true));

    try {
      const status = await mutation(workspaceRoot);
      updateGit(workspaceId, (git) => replaceGitStatus(git, status));
      await refreshGitBranchesForWorkspace(workspaceId, workspaceRoot);
      return true;
    } catch (error) {
      updateGit(workspaceId, (git) =>
        setGitError(git, `${label} failed: ${terminalErrorMessage(error)}`),
      );
      return false;
    }
  }

  function openGitConfirmation(request: GitConfirmationRequest) {
    setGitConfirmation(request);
    setGitConfirmationInput("");
  }

  function closeGitConfirmation() {
    setGitConfirmation(null);
    setGitConfirmationInput("");
  }

  async function confirmGitAction() {
    const request = gitConfirmation;
    if (!request) {
      return;
    }

    const confirmation = confirmationTextForGitAction(request.action);
    if (gitConfirmationInput !== confirmation) {
      return;
    }

    closeGitConfirmation();
    await request.run(confirmation);
  }

  function stageGitPath(path: string) {
    void runGitStatusMutation("Stage", (workspaceRoot) =>
      stageGitPaths(workspaceRoot, [path]),
    );
  }

  function unstageGitPath(path: string) {
    void runGitStatusMutation("Unstage", (workspaceRoot) =>
      unstageGitPaths(workspaceRoot, [path]),
    );
  }

  function discardGitPath(path: string) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    openGitConfirmation({
      action: { kind: "discard", paths: [path] },
      title: "Discard file changes",
      detail: path,
      run: (confirmation) =>
        runGitStatusMutationForWorkspace(
          workspaceId,
          workspaceRoot,
          "Discard",
          (root) => discardGitPaths(root, [path], confirmation),
        ),
    });
  }

  function commitFromGitPanel(options: { amend: boolean; pushAfter: boolean }) {
    const message = workspaceViewStore
      .getState()
      .viewFor(activeWorkspaceId)
      .git.commitMessage.trim();

    if (!message) {
      return;
    }

    const label = options.amend
      ? "Amend"
      : options.pushAfter
        ? "Commit & Push"
        : "Commit";

    void runGitStatusMutation(label, (workspaceRoot) =>
      commitGit(workspaceRoot, message, options.amend, options.pushAfter),
    );
  }

  function stashFromGitPanel() {
    void runGitStatusMutation("Stash", (workspaceRoot) =>
      stashGit(workspaceRoot, "", true),
    );
  }

  async function loadGitDiff(path: string, staged: boolean) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    updateGit(workspaceId, (git) => setGitLoading(setGitError(git, null), true));

    try {
      const diff = await getGitDiffFile(workspaceRoot, path, staged);
      updateGit(workspaceId, (git) => setGitLoading(storeDiff(git, diff), false));
    } catch (error) {
      updateGit(workspaceId, (git) =>
        setGitError(git, `Diff failed: ${terminalErrorMessage(error)}`),
      );
    }
  }

  async function loadGitGraph(label = "Graph") {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    updateGit(workspaceId, (git) => setGitLoading(setGitError(git, null), true));

    try {
      const graph = await getGitCommitGraph(workspaceRoot, 120);
      updateGit(workspaceId, (git) =>
        setGitLoading(storeGraph(git, graph), false),
      );
    } catch (error) {
      updateGit(workspaceId, (git) =>
        setGitError(git, `${label} failed: ${terminalErrorMessage(error)}`),
      );
    }
  }

  async function refreshGraphAfterStatusMutation(
    label: string,
    mutation: (workspaceRoot: string) => Promise<GitRepositoryStatus>,
  ) {
    const changed = await runGitStatusMutation(label, mutation);

    if (
      changed &&
      workspaceViewStore.getState().viewFor(activeWorkspaceId).surface ===
        "git-graph"
    ) {
      await loadGitGraph();
    }
  }

  function fetchFromGitPanel() {
    void refreshGraphAfterStatusMutation("Fetch", fetchGit);
  }

  function pullFromGitPanel() {
    void refreshGraphAfterStatusMutation("Pull", pullGit);
  }

  function pushFromGitPanel() {
    void refreshGraphAfterStatusMutation("Push", pushGit);
  }

  async function createBranchFromGitPanel(name: string) {
    const branchName = name.trim();

    if (!activeWorkspace || !activeWorkspaceId || branchName.length === 0) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    updateGit(workspaceId, (git) => setGitLoading(setGitError(git, null), true));

    try {
      await createGitBranch(workspaceRoot, branchName);
      const refreshed = await refreshGitBranchesForWorkspace(
        workspaceId,
        workspaceRoot,
      );

      if (refreshed) {
        updateGit(workspaceId, (git) => setGitLoading(git, false));
      }
    } catch (error) {
      updateGit(workspaceId, (git) =>
        setGitError(
          git,
          `Create branch failed: ${terminalErrorMessage(error)}`,
        ),
      );
    }
  }

  function checkoutBranchFromGitPanel(branch: string) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const currentBranch = workspaceViewStore
      .getState()
      .viewFor(activeWorkspaceId).git.status?.branch;

    if (branch === currentBranch) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    openGitConfirmation({
      action: { kind: "checkout", branch },
      title: "Checkout branch",
      detail: branch,
      run: (confirmation) =>
        runGitStatusMutationForWorkspace(
          workspaceId,
          workspaceRoot,
          "Checkout",
          (root) => checkoutGitBranch(root, branch, confirmation),
        ),
    });
  }

  function resetHardFromGitPanel() {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    openGitConfirmation({
      action: { kind: "reset-hard" },
      title: "Reset hard",
      detail: "Discard all tracked working tree changes.",
      run: (confirmation) =>
        runGitStatusMutationForWorkspace(
          workspaceId,
          workspaceRoot,
          "Reset hard",
          (root) => resetGitHard(root, confirmation),
        ),
    });
  }

  function rebaseOntoFromGitPanel(target: string) {
    const trimmedTarget = target.trim();
    if (!activeWorkspace || !activeWorkspaceId || !trimmedTarget) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    openGitConfirmation({
      action: { kind: "rebase", target: trimmedTarget },
      title: "Rebase branch",
      detail: trimmedTarget,
      run: (confirmation) =>
        runGitStatusMutationForWorkspace(
          workspaceId,
          workspaceRoot,
          "Rebase",
          (root) => rebaseGitOnto(root, trimmedTarget, confirmation),
        ),
    });
  }

  function openGitDiff(path: string, staged: boolean) {
    updateGit(activeWorkspaceId, (git) => selectDiff(git, { path, staged }));
    setSurface("git-diff");
    setActiveActivity("git");
    void loadGitDiff(path, staged);
  }

  function openGitGraph() {
    setSurface("git-graph");
    setActiveActivity("git");
    void loadGitGraph();
  }

  function openDocsPanel() {
    setActiveActivity("docs");
    setPanelOpen(true);
  }

  function invalidateDocsLoadRequests(workspaceId: string) {
    docsLoadRequestRef.current = nextDocsLoadRequest(
      docsLoadRequestRef.current,
      workspaceId,
    ).state;
  }

  async function refreshDocsIndex() {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const request = nextDocsLoadRequest(
      docsLoadRequestRef.current,
      workspaceId,
    );
    docsLoadRequestRef.current = request.state;
    const requestId = request.requestId;

    updateDocs(workspaceId, (docs) => ({
      ...docs,
      loading: true,
      error: null,
    }));

    try {
      const [index, contextPacks] = await Promise.all([
        getDocsIndex(workspaceRoot),
        listContextPacks(workspaceRoot),
      ]);

      if (
        !isCurrentDocsLoadRequest(
          docsLoadRequestRef.current,
          workspaceId,
          requestId,
        ) ||
        workspaceStore.getState().registry.active_workspace_id !== workspaceId
      ) {
        return;
      }

      updateDocs(workspaceId, (docs) => ({
        ...replaceDocsIndex(docs, index),
        contextPacks,
        loading: false,
        error: null,
      }));
      updateTask(workspaceId, (task) =>
        replaceTaskRunContextPacks(
          task,
          contextPackByLinkedTaskRunId(contextPacks),
        ),
      );
    } catch (error) {
      if (
        !isCurrentDocsLoadRequest(
          docsLoadRequestRef.current,
          workspaceId,
          requestId,
        )
      ) {
        return;
      }

      updateDocs(workspaceId, (docs) => ({
        ...docs,
        loading: false,
        error: `Refresh failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  function searchDocsPanel(query: string) {
    updateDocs(activeWorkspaceId, (docs) => ({
      ...docs,
      searchQuery: query,
      searchResult: query.trim() ? docs.searchResult : null,
      error: null,
    }));

    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const trimmedQuery = query.trim();
    const request = createDocsRequestIdentity({
      requestId: docsSearchRequestRef.current.requestId + 1,
      workspaceId: activeWorkspaceId,
      workspacePath: activeWorkspace.path,
      query: trimmedQuery,
    });
    docsSearchRequestRef.current = request;

    if (!trimmedQuery) {
      return;
    }

    void searchDocs(activeWorkspace.path, trimmedQuery)
      .then((result) => {
        const currentWorkspace =
          workspaceStore
            .getState()
            .registry.workspaces.find(
              (workspace) => workspace.id === request.workspaceId,
            ) ?? null;
        const current = createDocsRequestIdentity({
          requestId: docsSearchRequestRef.current.requestId,
          workspaceId: workspaceStore.getState().registry.active_workspace_id,
          workspacePath: currentWorkspace?.path ?? null,
          query: workspaceViewStore
            .getState()
            .viewFor(request.workspaceId).docs.searchQuery,
        });

        if (!shouldApplyDocsResult(request, current)) {
          return;
        }

        updateDocs(request.workspaceId, (docs) => ({
          ...docs,
          searchResult: result,
          error: null,
        }));
      })
      .catch((error) => {
        if (docsSearchRequestRef.current.requestId !== request.requestId) {
          return;
        }

        updateDocs(request.workspaceId, (docs) => ({
          ...docs,
          error: `Search failed: ${terminalErrorMessage(error)}`,
        }));
      });
  }

  async function openDocsPreview(path: string) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    openDocsPanel();
    setSurface("docs-preview");
    updateDocs(workspaceId, (docs) => beginDocPreview(docs, path));

    try {
      const preview = await getDocPreview(workspaceRoot, path);
      if (workspaceStore.getState().registry.active_workspace_id !== workspaceId) {
        return;
      }

      updateDocs(workspaceId, (docs) =>
        shouldApplyDocPreview(docs, path) && preview.path === path
          ? storeDocPreview(docs, preview)
          : docs,
      );
    } catch (error) {
      if (workspaceStore.getState().registry.active_workspace_id !== workspaceId) {
        return;
      }

      updateDocs(workspaceId, (docs) =>
        shouldApplyDocPreview(docs, path)
          ? {
              ...docs,
              error: `Preview failed: ${terminalErrorMessage(error)}`,
            }
          : docs,
      );
    }
  }

  function toggleDocsSource(path: string, selected: boolean) {
    updateDocs(activeWorkspaceId, (docs) =>
      selectDocSource(docs, path, selected),
    );
  }

  function updateDocsPackName(name: string) {
    updateDocs(activeWorkspaceId, (docs) =>
      updateContextPackDraftName(docs, name),
    );
  }

  async function createDocsContextPack() {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const docs = workspaceViewStore.getState().viewFor(workspaceId).docs;
    const name = docs.packDraftName.trim();
    const docPaths = selectedDocPaths(docs);

    if (!name || docPaths.length === 0) {
      openDocsPanel();
      return;
    }

    try {
      const pack = await createContextPack({
        workspaceRoot: activeWorkspace.path,
        name,
        docPaths,
      });
      invalidateDocsLoadRequests(workspaceId);
      updateDocs(workspaceId, (state) => storeContextPack(state, pack));
      openDocsPanel();
    } catch (error) {
      updateDocs(workspaceId, (state) => ({
        ...state,
        error: `Create pack failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  function selectDocsContextPack(id: string) {
    updateDocs(activeWorkspaceId, (docs) => ({
      ...docs,
      activePackId: id,
    }));
  }

  async function deleteDocsContextPack(id: string) {
    if (!activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;

    try {
      await deleteContextPack(id);
      invalidateDocsLoadRequests(workspaceId);
      const currentDocs = workspaceViewStore.getState().viewFor(workspaceId).docs;
      const contextPacks = currentDocs.contextPacks.filter(
        (pack) => pack.id !== id,
      );
      updateDocs(workspaceId, (docs) => ({
        ...docs,
        contextPacks,
        activePackId: docs.activePackId === id ? null : docs.activePackId,
        error: null,
      }));
      updateTask(workspaceId, (task) =>
        replaceTaskRunContextPacks(
          task,
          contextPackByLinkedTaskRunId(contextPacks),
        ),
      );
    } catch (error) {
      updateDocs(workspaceId, (docs) => ({
        ...docs,
        error: `Delete pack failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  async function linkPackToActiveTask(packId: string) {
    if (!activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const taskState = workspaceViewStore.getState().viewFor(workspaceId).task;
    const run =
      taskState.runs.find((item) => item.id === taskState.activeRunId) ??
      taskState.runs[0] ??
      null;

    if (!run) {
      openDocsPanel();
      return;
    }

    try {
      const pack = await linkContextPack({
        id: packId,
        taskRunId: run.id,
      });
      invalidateDocsLoadRequests(workspaceId);
      updateDocs(workspaceId, (state) => storeContextPack(state, pack));
      updateTask(workspaceId, (state) =>
        linkTaskRunContextPack(state, run.id, pack.id),
      );
      openDocsPanel();
    } catch (error) {
      updateDocs(workspaceId, (state) => ({
        ...state,
        error: `Link pack failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  async function linkPackToAgentSession(
    packId: string,
    agentSessionId: string,
  ) {
    if (!activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const trimmedAgentSessionId = agentSessionId.trim();

    if (!trimmedAgentSessionId) {
      return;
    }

    try {
      const pack = await linkContextPack({
        id: packId,
        agentSessionId: trimmedAgentSessionId,
      });
      invalidateDocsLoadRequests(workspaceId);
      updateDocs(workspaceId, (state) => storeContextPack(state, pack));
      openDocsPanel();
    } catch (error) {
      updateDocs(workspaceId, (state) => ({
        ...state,
        error: `Link agent failed: ${terminalErrorMessage(error)}`,
      }));
      throw error;
    }
  }

  function openLanguagePanel() {
    setActiveActivity("language");
    setPanelOpen(true);
  }

  function openBrowserPanel() {
    setActiveActivity("browser");
    setPanelOpen(true);
  }

  function openBrowserPreview(value: string) {
    const workspaceId = activeWorkspaceId ?? "";
    const requestId =
      workspaceId.length > 0
        ? startBrowserValidationRequest(
            browserValidationRequestRef.current,
            workspaceId,
          )
        : 0;

    openBrowserPreviewWithValidation(
      {
        workspaceId,
        value,
        onOpenPanel: openBrowserPanel,
        onSetSurface: setSurface,
        requestId,
        isLatestRequest: (targetWorkspaceId, targetRequestId) =>
          isLatestBrowserValidationRequest(
            browserValidationRequestRef.current,
            targetWorkspaceId,
            targetRequestId,
          ),
        onOpenUrl: (parsedUrl) => {
          if (!workspaceId) {
            return;
          }

          updateBrowser(workspaceId, (browser) =>
            openBrowserUrl(browser, parsedUrl),
          );
        },
        onValidationError: (error) => {
          if (!workspaceId) {
            return;
          }

          updateBrowser(
            workspaceId,
            (browser) => setBrowserError(browser, terminalErrorMessage(error)),
          );
        },
      },
      validateBrowserUrl,
    );
  }

  function updateBrowserUrlInput(value: string) {
    if (!activeWorkspaceId) {
      return;
    }

    updateBrowser(activeWorkspaceId, (browser) =>
      setBrowserUrlInput(browser, value),
    );
  }

  function reloadBrowserPreview() {
    if (!activeWorkspaceId) {
      return;
    }

    updateBrowser(activeWorkspaceId, (browser) => reloadBrowser(browser));
  }

  function hardReloadBrowserPreview() {
    if (!activeWorkspaceId) {
      return;
    }

    updateBrowser(activeWorkspaceId, (browser) => hardReloadBrowser(browser));
  }

  function captureBrowserScreenshot() {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const state = workspaceViewStore.getState().viewFor(workspaceId).browser;
    if (!state.activeUrl || !state.bounds) {
      updateBrowser(
        workspaceId,
        (browser) =>
          setBrowserError(
            browser,
            state.bounds
              ? "No active browser URL"
              : "Browser preview bounds are not ready",
          ),
      );
      return;
    }
    const requestId = startBrowserCaptureRequest(
      browserCaptureRequestRef.current,
      workspaceId,
    );

    const request = {
      workspaceRoot: activeWorkspace.path,
      request: {
        url: state.activeUrl,
        title: state.activeTitle ?? state.activeUrl,
        bounds: state.bounds,
      },
    };

    captureBrowserPreviewWithValidation(
      {
        workspaceId,
        requestId,
        isLatestRequest: (targetWorkspaceId, targetRequestId) =>
          isLatestBrowserCaptureRequest(
            browserCaptureRequestRef.current,
            targetWorkspaceId,
            targetRequestId,
          ),
        request,
        onSuccess: (screenshot) =>
          updateBrowser(workspaceId, (browser) =>
            storeBrowserScreenshot(browser, screenshot),
          ),
        onFailure: (error) =>
          updateBrowser(workspaceId, (browser) =>
            setBrowserError(
              browser,
              `Capture failed: ${terminalErrorMessage(error)}`,
            ),
          ),
      },
      captureBrowserPreview,
    );
  }

  function selectBrowserScreenshot(id: string) {
    if (!activeWorkspaceId) {
      return;
    }

    updateBrowser(activeWorkspaceId, (browser) => ({
      ...browser,
      selectedScreenshotId: id,
    }));
  }

  function openRemotePanel() {
    setActiveActivity("remote");
    setPanelOpen(true);
  }

  async function refreshRemoteHostsForWorkspace(
    workspaceId: string,
    workspaceRoot: string,
  ) {
    const requestId = (remoteHostsLoadRef.current[workspaceId] ?? 0) + 1;
    remoteHostsLoadRef.current = {
      ...remoteHostsLoadRef.current,
      [workspaceId]: requestId,
    };

    await refreshRemoteHostsRequest({
      workspaceId,
      workspaceRoot,
      requestId,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestRemoteHostsRequest: (currentWorkspaceId, currentRequestId) =>
        remoteHostsLoadRef.current[currentWorkspaceId] === currentRequestId,
      updateRemote,
      listRemoteHosts,
      listSshTerminalSessions,
    });
  }

  function refreshRemoteHosts() {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    void refreshRemoteHostsForWorkspace(activeWorkspaceId, activeWorkspace.path);
  }

  async function createRemoteHostFromPrompt() {
    if (!activeWorkspace) {
      return;
    }

    const target = window.prompt(
      "SSH host as user@hostname[:port]",
      "deploy@edge.example.com",
    );
    if (!target) {
      return;
    }

    const match = target.match(/^([^@\s]+)@([^:\s]+)(?::([0-9]{1,5}))?$/);
    if (!match) {
      updateRemote(activeWorkspaceId, (remote) => ({
        ...remote,
        error: "Use user@hostname[:port]",
      }));
      return;
    }

    const [, username, host, portValue] = match;
    try {
      const profile = await saveRemoteHost({
        workspace_root: activeWorkspace.path,
        name: host,
        host,
        port: portValue ? Number(portValue) : 22,
        username,
        auth_kind: "Agent",
        default_remote_path: ".",
        keepalive_seconds: 30,
        connect_timeout_seconds: 10,
      });
      updateRemote(activeWorkspaceId, (remote) =>
        replaceRemoteHosts(remote, [
          ...remote.hosts.filter((item) => item.id !== profile.id),
          profile,
        ]),
      );
    } catch (error) {
      updateRemote(activeWorkspaceId, (remote) => ({
        ...remote,
        error: `Save host failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  function selectRemoteHostById(hostId: string) {
    if (!activeWorkspaceId) {
      return;
    }

    updateRemote(activeWorkspaceId, (remote) => selectRemoteHost(remote, hostId));
  }

  function setRemoteWorkbenchMode(mode: RemoteViewState["mode"]) {
    updateRemote(activeWorkspaceId, (remote) => setRemoteMode(remote, mode));
  }

  function activeRemoteHostId(hostId?: string): string | null {
    const remote = workspaceViewStore.getState().viewFor(activeWorkspaceId).remote;
    return hostId ?? remote.activeHostId ?? remote.hosts[0]?.id ?? null;
  }

  async function connectActiveRemoteHost(hostId?: string) {
    if (!activeWorkspaceId) {
      openRemotePanel();
      return;
    }

    const profileId = activeRemoteHostId(hostId);
    if (!profileId) {
      openRemotePanel();
      return;
    }

    updateRemote(activeWorkspaceId, (remote) =>
      markRemoteConnection(
        {
          ...selectRemoteHost(remote, profileId),
          loading: true,
          error: null,
        },
        {
          host_id: profileId,
          status: "Connecting",
          message: null,
          checked_ms: Date.now(),
        },
      ),
    );

    try {
      const snapshot = await connectRemoteHost(profileId);
      updateRemote(activeWorkspaceId, (remote) => ({
        ...markRemoteConnection(remote, snapshot),
        loading: false,
        error: null,
      }));
    } catch (error) {
      updateRemote(activeWorkspaceId, (remote) => ({
        ...remote,
        loading: false,
        error: `Connect failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  async function openSshForHost(hostId?: string) {
    if (!activeWorkspace || !activeWorkspaceId) {
      openRemotePanel();
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const profileId = activeRemoteHostId(hostId);
    if (!profileId) {
      openRemotePanel();
      return;
    }

    updateRemote(workspaceId, (remote) => ({
      ...setRemoteMode(selectRemoteHost(remote, profileId), "ssh"),
      loading: true,
      error: null,
    }));

    try {
      const session = await spawnSshTerminal({
        workspaceId,
        workspaceRoot,
        profileId,
        rows: 24,
        cols: 80,
      });

      updateRemote(workspaceId, (remote) => ({
        ...upsertSshTerminal(remote, session),
        loading: false,
        error: null,
      }));
      updateView(workspaceId, {
        activeActivity: "remote",
        panelOpen: true,
        surface: "ssh-terminal",
      });
    } catch (error) {
      updateRemote(workspaceId, (remote) => ({
        ...remote,
        loading: false,
        error: `Open SSH failed: ${terminalErrorMessage(error)}`,
      }));
      openRemotePanel();
    }
  }

  function openSftpForHost(hostId?: string) {
    if (!activeWorkspaceId) {
      openRemotePanel();
      return;
    }

    const workspaceId = activeWorkspaceId;
    const remote = workspaceViewStore.getState().viewFor(workspaceId).remote;
    const profileId = hostId ?? remote.activeHostId ?? remote.hosts[0]?.id ?? null;
    const host = remote.hosts.find((item) => item.id === profileId) ?? null;
    if (!profileId || !host) {
      openRemotePanel();
      return;
    }

    const path = remote.sftpPathByHostId[profileId] || host.default_remote_path || "/";
    updateRemote(workspaceId, (current) =>
      setRemoteMode(selectRemoteHost(current, profileId), "sftp"),
    );
    updateView(workspaceId, {
      activeActivity: "remote",
      panelOpen: true,
      surface: "sftp-browser",
    });
    void listRemoteDirectory(profileId, path);
  }

  function writeSshInput(sessionId: string, data: string) {
    void writeSshTerminal(sessionId, data).catch((error) => {
      const workspaceId = knownWorkspaceIdForSshTerminal(sessionId) ?? activeWorkspaceId;
      if (!workspaceId) {
        return;
      }

      updateRemote(workspaceId, (remote) => ({
        ...remote,
        error: `SSH input failed: ${terminalErrorMessage(error)}`,
      }));
    });
  }

  async function closeSshById(sessionId: string) {
    const workspaceId = knownWorkspaceIdForSshTerminal(sessionId) ?? activeWorkspaceId;
    if (!workspaceId) {
      return;
    }

    try {
      await closeSshTerminalSession(sessionId);
      updateRemote(workspaceId, (remote) => closeSshTerminal(remote, sessionId));
      clearTerminalReplayOutput(sessionId);
    } catch (error) {
      updateRemote(workspaceId, (remote) => ({
        ...remote,
        error: `Close SSH failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  function updateRemoteCommandDraft(value: string) {
    updateRemote(activeWorkspaceId, (remote) => ({
      ...remote,
      commandDraft: value,
      error: null,
    }));
  }

  function runActiveRemoteCommand() {
    if (!activeWorkspaceId) {
      openRemotePanel();
      return;
    }

    const workspaceId = activeWorkspaceId;
    const remote = workspaceViewStore.getState().viewFor(workspaceId).remote;
    const profileId = remote.activeHostId;
    const command = remote.commandDraft.trim();
    if (!profileId || !command) {
      openRemotePanel();
      return;
    }

    const runId = `${profileId}:${Date.now()}`;
    updateRemote(workspaceId, (current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    void runRemoteCommand(profileId, command)
      .then((result) => {
        updateRemote(workspaceId, (current) => ({
          ...setRemoteCommandResult(current, runId, result),
          loading: false,
          error: null,
        }));
      })
      .catch((error) => {
        updateRemote(workspaceId, (current) => ({
          ...current,
          loading: false,
          error: `Run command failed: ${terminalErrorMessage(error)}`,
        }));
      });
  }

  async function listRemoteDirectory(hostId: string, path: string) {
    const workspaceId = activeWorkspaceId;
    if (!workspaceId) {
      return;
    }

    updateRemote(workspaceId, (remote) => ({
      ...remote,
      loading: true,
      error: null,
    }));

    try {
      const entries = await listSftpDirectory(hostId, path);
      updateRemote(workspaceId, (remote) => ({
        ...setSftpEntries(remote, hostId, path, entries),
        loading: false,
        error: null,
      }));
    } catch (error) {
      updateRemote(workspaceId, (remote) => ({
        ...remote,
        loading: false,
        error: `SFTP list failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  async function downloadRemoteFile(remotePath: string) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const remote = workspaceViewStore.getState().viewFor(workspaceId).remote;
    if (!remote.activeHostId) {
      return;
    }

    const localRelativePath = window.prompt(
      "Download to workspace path",
      `downloads/${remoteTransferFileName(remotePath, "remote-file")}`,
    );
    if (!localRelativePath) {
      return;
    }

    try {
      const transfer = await downloadSftpFile({
        workspaceRoot,
        profileId: remote.activeHostId,
        remotePath,
        localRelativePath,
      });
      updateRemote(workspaceId, (current) =>
        recordRemoteTransfer(current, transfer),
      );
    } catch (error) {
      updateRemote(workspaceId, (current) => ({
        ...current,
        error: `Download failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  async function uploadRemoteFile(remoteDirectory: string) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const remote = workspaceViewStore.getState().viewFor(workspaceId).remote;
    if (!remote.activeHostId) {
      return;
    }

    const localRelativePath = window.prompt("Upload workspace path", "dist/app.js");
    if (!localRelativePath) {
      return;
    }

    const fileName = remoteTransferFileName(localRelativePath);
    try {
      const transfer = await uploadSftpFile({
        workspaceRoot,
        profileId: remote.activeHostId,
        localRelativePath,
        remotePath: `${remoteDirectory.replace(/\/$/, "")}/${fileName}`,
      });
      updateRemote(workspaceId, (current) =>
        recordRemoteTransfer(current, transfer),
      );
    } catch (error) {
      updateRemote(workspaceId, (current) => ({
        ...current,
        error: `Upload failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  function openAgentsPanel() {
    setActiveActivity("agents");
    setPanelOpen(true);
  }

  function selectedAgentContextItems(agentState: AgentViewState): AgentContextItem[] {
    return selectedContextItems(agentState, availableAgentContext);
  }

  function selectedAgentDocPaths(contextItems: AgentContextItem[]): string[] {
    const docPaths = new Set<string>();

    for (const item of contextItems) {
      if (item.kind === "doc" && item.path) {
        docPaths.add(item.path);
      }
    }

    return [...docPaths];
  }

  async function linkSelectedDocsForSession(
    workspaceId: string,
    sessionId: string,
    selectedContext: AgentContextItem[],
  ) {
    const selectedDocPaths = selectedAgentDocPaths(selectedContext);
    if (selectedDocPaths.length === 0) {
      return;
    }

    const workspaceState = workspaceViewStore.getState().viewFor(workspaceId);
    const matchingPacks = workspaceState.docs.contextPacks.filter((pack) =>
      pack.doc_paths.some((path) => selectedDocPaths.includes(path)),
    );

    if (matchingPacks.length === 0) {
      return;
    }

    for (const pack of matchingPacks) {
      const linkedPack = await linkContextPack({
        id: pack.id,
        agentSessionId: sessionId,
      });
      updateDocs(workspaceId, (state) => storeContextPack(state, linkedPack));
    }
  }

  async function handleAgentStartSessionFromCallback(
    prompt: string,
    options: { openPanel?: boolean } = {},
  ) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const state = workspaceViewStore.getState().viewFor(workspaceId);
    const currentPrompt = prompt.trim();
    const selectedContext = selectedAgentContextItems(state.agent);

    if (!currentPrompt || selectedContext.length === 0) {
      openAgentsPanel();
      return;
    }

    updateAgent(workspaceId, (agent) => ({ ...agent, loading: true, error: null }));

    try {
      const session = await startAgentSession({
        workspaceRoot,
        mode: state.agent.mode,
        prompt: currentPrompt,
        contextItems: selectedContext,
      });

      const currentWorkspace =
        workspaceStore
          .getState()
          .registry.workspaces.find((item) => item.id === workspaceId) ??
        null;
      if (
        !hasRegisteredWorkspace(workspaceId) ||
        currentWorkspace?.path !== workspaceRoot ||
        workspaceStore.getState().registry.active_workspace_id !== workspaceId
      ) {
        return;
      }

      updateAgent(workspaceId, (agent) => storeAgentSession(agent, session));
      await linkSelectedDocsForSession(workspaceId, session.id, selectedContext);

      if (options.openPanel) {
        openAgentsPanel();
      }
    } catch (error) {
      updateAgent(workspaceId, (agent) => ({
        ...agent,
        loading: false,
        error: `Start session failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  function handleAgentModeChange(mode: AgentMode) {
    if (!activeWorkspaceId) {
      return;
    }

    updateAgent(activeWorkspaceId, (agent) => setAgentMode(agent, mode));
  }

  function handleAgentPromptChange(prompt: string) {
    if (!activeWorkspaceId) {
      return;
    }

    updateAgent(activeWorkspaceId, (agent) => setAgentPromptDraft(agent, prompt));
  }

  function handleAgentContextToggle(id: string, selected: boolean) {
    if (!activeWorkspaceId) {
      return;
    }

    updateAgent(activeWorkspaceId, (agent) => toggleAgentContext(agent, id, selected));
  }

  function handleAgentSelectSession(sessionId: string) {
    if (!activeWorkspaceId) {
      return;
    }

    updateAgent(activeWorkspaceId, (agent) =>
      selectAgentSession(agent, sessionId),
    );
  }

  async function handleAgentApproval(approvalId: string, status: "approved" | "rejected") {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const session = activeAgentSession(workspaceViewStore.getState().viewFor(activeWorkspaceId).agent);
    if (!session) {
      return;
    }

    try {
      const updated = await updateAgentApproval({
        sessionId: session.id,
        approvalId,
        status,
      });
      updateAgent(activeWorkspaceId, (agent) => storeAgentSession(agent, updated));
    } catch (error) {
      updateAgent(activeWorkspaceId, (agent) => ({
        ...agent,
        error: `Approval failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  async function handleAgentExport() {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const agentState = workspaceViewStore.getState().viewFor(activeWorkspaceId).agent;
    const session = activeAgentSession(agentState);
    if (!session) {
      openAgentsPanel();
      return;
    }

    try {
      const result = await exportAgentPrompt(session.id);

      if (typeof window === "undefined" || typeof document === "undefined") {
        return;
      }

      if (typeof Blob === "undefined" || typeof URL === "undefined") {
        return;
      }

      const blob = new Blob([result.content], {
        type: "text/markdown;charset=utf-8",
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      updateAgent(activeWorkspaceId, (agent) => ({
        ...agent,
        error: `Export failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  function openLanguageDiagnostic(diagnostic: LspDiagnostic & { path: string }) {
    setSurface("editor");
    void openFile(diagnostic.path);
  }

  function onLanguageHover(line: number, character: number) {
    if (
      !activeWorkspace ||
      !activeWorkspaceId ||
      !loadedFile ||
      loadedFile.workspaceId !== activeWorkspaceId
    ) {
      return Promise.resolve(null);
    }

    if (!isLspSupportedDocumentPath(loadedFile.path)) {
      return Promise.resolve(null);
    }

    return requestLanguageHover({
      workspaceId: activeWorkspaceId,
      workspaceRoot: activeWorkspace.path,
      path: lspDocumentPathForWorkspace(activeWorkspace.path, loadedFile.path),
      line,
      character,
    }).then((hover) => hover?.contents ?? null);
  }

  function onLanguageGoToDefinition(line: number, character: number) {
    if (
      !activeWorkspace ||
      !activeWorkspaceId ||
      !loadedFile ||
      loadedFile.workspaceId !== activeWorkspaceId ||
      !isLspSupportedDocumentPath(loadedFile.path)
    ) {
      return Promise.resolve();
    }

    return requestLanguageDefinition({
      workspaceId: activeWorkspaceId,
      workspaceRoot: activeWorkspace.path,
      path: lspDocumentPathForWorkspace(activeWorkspace.path, loadedFile.path),
      line,
      character,
    });
  }

  function onLanguageReferences(line: number, character: number) {
    if (
      !activeWorkspace ||
      !activeWorkspaceId ||
      !loadedFile ||
      loadedFile.workspaceId !== activeWorkspaceId ||
      !isLspSupportedDocumentPath(loadedFile.path)
    ) {
      return Promise.resolve();
    }

    return requestLanguageReferences({
      workspaceId: activeWorkspaceId,
      workspaceRoot: activeWorkspace.path,
      path: lspDocumentPathForWorkspace(activeWorkspace.path, loadedFile.path),
      line,
      character,
    });
  }

  function onLanguageCompletion(line: number, character: number) {
    if (
      !activeWorkspace ||
      !activeWorkspaceId ||
      !loadedFile ||
      loadedFile.workspaceId !== activeWorkspaceId ||
      !isLspSupportedDocumentPath(loadedFile.path)
    ) {
      return Promise.resolve([]);
    }

    return requestLanguageCompletion({
      workspaceId: activeWorkspaceId,
      workspaceRoot: activeWorkspace.path,
      path: lspDocumentPathForWorkspace(activeWorkspace.path, loadedFile.path),
      line,
      character,
    });
  }

  function onLanguageCodeActions(line: number, character: number) {
    if (
      !activeWorkspace ||
      !activeWorkspaceId ||
      !loadedFile ||
      loadedFile.workspaceId !== activeWorkspaceId ||
      !isLspSupportedDocumentPath(loadedFile.path)
    ) {
      return Promise.resolve([]);
    }

    return requestLanguageCodeActions({
      workspaceId: activeWorkspaceId,
      workspaceRoot: activeWorkspace.path,
      path: lspDocumentPathForWorkspace(activeWorkspace.path, loadedFile.path),
      line,
      character,
    });
  }

  function onLanguageRename(line: number, character: number, newName: string) {
    if (
      !activeWorkspace ||
      !activeWorkspaceId ||
      !loadedFile ||
      loadedFile.workspaceId !== activeWorkspaceId ||
      !isLspSupportedDocumentPath(loadedFile.path)
    ) {
      return Promise.resolve();
    }

    return requestLanguageRename({
      workspaceId: activeWorkspaceId,
      workspaceRoot: activeWorkspace.path,
      path: lspDocumentPathForWorkspace(activeWorkspace.path, loadedFile.path),
      line,
      character,
      newName,
    });
  }

  async function refreshLanguageStatus(
    workspaceId: string,
    workspaceRoot: string,
    requestId: number,
    rootBeforeRefresh: string,
  ) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    updateLanguage(workspaceId, (language) => ({
      ...language,
      loading: true,
      error: null,
    }));

    try {
      const [servers, diagnostics] = await Promise.all([
        getLanguageServerStatus(workspaceRoot),
        getWorkspaceDiagnostics({
          workspaceId,
          workspaceRoot,
        }),
      ]);

      if (
        !isCurrentLanguageRefreshRequest(
          languageRefreshRequestRef.current,
          workspaceId,
          workspaceRoot,
          requestId,
        )
      ) {
        return;
      }

      if (!hasRegisteredWorkspace(workspaceId)) {
        updateLanguage(workspaceId, (language) => ({ ...language, loading: false }));
        return;
      }

      const currentWorkspace = workspaceStore
        .getState()
        .registry.workspaces.find((workspace) => workspace.id === workspaceId);
      if (!currentWorkspace || currentWorkspace.path !== rootBeforeRefresh) {
        updateLanguage(workspaceId, (language) => ({ ...language, loading: false }));
        return;
      }

      updateLanguage(workspaceId, (language) =>
        replaceDiagnostics(replaceServerStatuses(language, servers), diagnostics),
      );
    } catch (error) {
      if (
        !isCurrentLanguageRefreshRequest(
          languageRefreshRequestRef.current,
          workspaceId,
          workspaceRoot,
          requestId,
        )
      ) {
        return;
      }

      if (!hasRegisteredWorkspace(workspaceId)) {
        updateLanguage(workspaceId, (language) => ({ ...language, loading: false }));
        return;
      }

      updateLanguage(workspaceId, (language) => ({
        ...language,
        loading: false,
        error: `Refresh diagnostics failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  async function refreshLanguageLogs(
    workspaceId: string,
    workspaceRoot: string,
    requestId: number,
  ) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    try {
      const logs = await getLanguageServerLogs({
        workspaceId,
        workspaceRoot,
      });

      if (
        !isCurrentLanguageRefreshRequest(
          languageRefreshRequestRef.current,
          workspaceId,
          workspaceRoot,
          requestId,
        )
      ) {
        return;
      }

      if (!hasRegisteredWorkspace(workspaceId)) {
        return;
      }

      const currentWorkspace = workspaceStore
        .getState()
        .registry.workspaces.find((workspace) => workspace.id === workspaceId);
      if (!currentWorkspace || currentWorkspace.path !== workspaceRoot) {
        return;
      }

      updateLanguage(workspaceId, (language) => storeServerLogs(language, logs));
    } catch (error) {
      if (
        !isCurrentLanguageRefreshRequest(
          languageRefreshRequestRef.current,
          workspaceId,
          workspaceRoot,
          requestId,
        )
      ) {
        return;
      }

      if (!hasRegisteredWorkspace(workspaceId)) {
        return;
      }

      updateLanguage(workspaceId, (language) => ({
        ...language,
        error: `Refresh language logs failed: ${terminalErrorMessage(error)}`,
      }));
    }
  }

  async function refreshLanguageData() {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const rootBeforeRefresh = workspaceRoot;
    const request = nextLanguageRefreshRequest(
      languageRefreshRequestRef.current,
      workspaceId,
      workspaceRoot,
    );
    languageRefreshRequestRef.current = request.state;
    const requestId = request.requestId;

    await Promise.all([
      refreshLanguageStatus(workspaceId, workspaceRoot, requestId, rootBeforeRefresh),
      refreshLanguageLogs(workspaceId, workspaceRoot, requestId),
    ]);
  }

  function languageRestartPathForStatus(
    workspaceRoot: string,
    status: LanguageServerStatus,
  ): string {
    if (
      loadedFile &&
      loadedFile.workspaceId === activeWorkspaceId &&
      status.language.toLowerCase() === loadedFile.language
    ) {
      return lspDocumentPathForWorkspace(workspaceRoot, loadedFile.path);
    }

    if (status.language === "Rust") {
      return "src/main.rs";
    }
    if (status.language === "TypeScript") {
      return "src/main.ts";
    }
    if (status.language === "JavaScript") {
      return "src/main.js";
    }

    return "main.py";
  }

  function restartLanguageServer(server: LanguageServerStatus) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const path = languageRestartPathForStatus(workspaceRoot, server);

    restartLanguageServerCommand({
      workspaceId,
      workspaceRoot,
      path,
    })
      .then(() => {
        void refreshLanguageData();
      })
      .catch((error) => {
        updateLanguage(workspaceId, (language) => ({
          ...language,
          error: `Restart failed: ${terminalErrorMessage(error)}`,
        }));
      });
  }

  function restartActiveLanguageServer() {
    if (
      !activeWorkspace ||
      !activeWorkspaceId ||
      !loadedFile ||
      loadedFile.workspaceId !== activeWorkspaceId ||
      !isLspSupportedDocumentPath(loadedFile.path)
    ) {
      if (view.language.serverStatuses[0]) {
        restartLanguageServer(view.language.serverStatuses[0]);
      }

      return;
    }

    const path = lspDocumentPathForWorkspace(
      activeWorkspace.path,
      loadedFile.path,
    );

    restartLanguageServerCommand({
      workspaceId: activeWorkspaceId,
      workspaceRoot: activeWorkspace.path,
      path,
    })
      .then(() => {
        void refreshLanguageData();
    })
      .catch((error) => {
        updateLanguage(activeWorkspaceId, (language) => ({
          ...language,
          error: `Restart failed: ${terminalErrorMessage(error)}`,
        }));
      });
  }

  async function refreshDatabaseProfilesForWorkspace(
    workspaceId: string,
    workspaceRoot: string,
  ): Promise<void> {
    const requestId = (databaseProfilesLoadRef.current[workspaceId] ?? 0) + 1;
    databaseProfilesLoadRef.current = {
      ...databaseProfilesLoadRef.current,
      [workspaceId]: requestId,
    };

    await refreshDatabaseProfilesRequest({
      workspaceId,
      workspaceRoot,
      requestId,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseProfilesRequest,
      isActiveWorkspace: (currentWorkspaceId) =>
        workspaceStore.getState().registry.active_workspace_id === currentWorkspaceId,
      updateDatabase,
      listDatabaseProfiles,
    });
  }

  function refreshDatabaseProfiles() {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    void refreshDatabaseProfilesForWorkspace(activeWorkspaceId, activeWorkspace.path);
  }

  function selectDatabaseProfileForWorkspace(profileId: string) {
    if (!activeWorkspaceId) {
      return;
    }

    updateDatabase(activeWorkspaceId, (database) =>
      selectDatabaseProfile(database, profileId),
    );
  }

  function getWorkspaceRoot(workspaceId: string): string | null {
    return (
      workspaceStore
        .getState()
        .registry.workspaces.find((workspace) => workspace.id === workspaceId)
        ?.path ?? null
    );
  }

  function isLatestDatabaseInspectProfileRequest(
    workspaceId: string,
    requestId: number,
  ) {
    return (
      databaseInspectProfileRequestRef.current[workspaceId] === requestId
    );
  }

  function isLatestDatabaseProfilesRequest(workspaceId: string, requestId: number) {
    return databaseProfilesLoadRef.current[workspaceId] === requestId;
  }

  function isLatestDatabaseQueryRequest(workspaceId: string, requestId: number) {
    return databaseQueryRequestRef.current[workspaceId] === requestId;
  }

  function isLatestDatabaseExportRequest(workspaceId: string, requestId: number) {
    return databaseExportRequestRef.current[workspaceId] === requestId;
  }

  async function inspectDatabaseProfile(profileId: string) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const requestId = (databaseInspectProfileRequestRef.current[workspaceId] ?? 0) + 1;
    databaseInspectProfileRequestRef.current = {
      ...databaseInspectProfileRequestRef.current,
      [workspaceId]: requestId,
    };

    selectDatabaseProfileForWorkspace(profileId);
    updateDatabase(workspaceId, (database) => ({
      ...database,
      error: null,
      loading: true,
      confirmation: null,
    }));

    await inspectDatabaseProfileRequest({
      workspaceId,
      workspaceRoot,
      profileId,
      requestId,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestInspectProfileRequest: isLatestDatabaseInspectProfileRequest,
      updateDatabase,
      inspectDatabaseSchema,
    });
  }

  function updateDatabaseDraftQuery(query: string) {
    if (!activeWorkspaceId) {
      return;
    }

    updateDatabase(activeWorkspaceId, (database) =>
      updateDatabaseDraft(database, query),
    );
  }

  async function refreshDatabaseHistory(
    workspaceId: string,
    workspaceRoot: string,
    profileId: string,
  ) {
    if (!workspaceId || !workspaceRoot || !profileId) {
      return;
    }

    try {
      const history = await listDatabaseQueryHistory(profileId);

      if (!hasRegisteredWorkspace(workspaceId)) {
        return;
      }

      const currentWorkspace = workspaceStore
        .getState()
        .registry.workspaces.find((workspace) => workspace.id === workspaceId);
      if (!currentWorkspace || currentWorkspace.path !== workspaceRoot) {
        return;
      }

      const currentProfile = workspaceViewStore
        .getState()
        .viewFor(workspaceId).database.activeProfileId;
      if (currentProfile !== profileId) {
        return;
      }

      updateDatabase(workspaceId, (database) => ({
        ...database,
        history,
      }));
    } catch {
      // History errors do not block query results.
    }
  }

  function runDatabaseQuery() {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const database = workspaceViewStore.getState().viewFor(workspaceId).database;
    const profileId = database.activeProfileId;

    if (profileId === null) {
      updateDatabase(workspaceId, (current) => ({
        ...current,
        error: "Select a database profile first",
      }));
      return;
    }

    const classification = classifyDatabaseSql(database.queryDraft);
    if (classification.requires_confirmation) {
      updateDatabase(workspaceId, (current) =>
        requireDatabaseConfirmation(current, classification),
      );
      return;
    }

    updateDatabase(workspaceId, (current) => ({
      ...current,
      confirmation: null,
      error: null,
    }));
    const requestId = (databaseQueryRequestRef.current[workspaceId] ?? 0) + 1;
    databaseQueryRequestRef.current = {
      ...databaseQueryRequestRef.current,
      [workspaceId]: requestId,
    };
    void executeDatabaseQueryRequest({
      workspaceId,
      workspaceRoot,
      profileId,
      sql: database.queryDraft,
      requestId,
      confirmation: null,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseQuery: isLatestDatabaseQueryRequest,
      updateDatabase,
      executeDatabaseQuery,
      isActiveWorkspace: (currentWorkspaceId) =>
        workspaceStore.getState().registry.active_workspace_id === currentWorkspaceId,
      refreshHistory: refreshDatabaseHistory,
      onResultApplied: () => {
        setActiveActivity("database");
        setPanelOpen(true);
        setSurface("database-result");
      },
    });
  }

  function openDatabaseTable(profileId: string, table: DatabaseTable) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const profile = workspaceViewStore
      .getState()
      .viewFor(workspaceId)
      .database.profiles.find((item) => item.id === profileId);

    if (!profile) {
      updateDatabase(workspaceId, (current) => ({
        ...current,
        error: "Selected database profile not found",
      }));
      return;
    }

    const query = databaseTableSql(profile.kind, table);
    updateDatabase(workspaceId, (database) =>
      selectDatabaseProfile(updateDatabaseDraft(database, query), profileId),
    );
    const requestId = (databaseQueryRequestRef.current[workspaceId] ?? 0) + 1;
    databaseQueryRequestRef.current = {
      ...databaseQueryRequestRef.current,
      [workspaceId]: requestId,
    };
    void executeDatabaseQueryRequest({
      workspaceId,
      workspaceRoot,
      profileId,
      sql: query,
      requestId,
      confirmation: null,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseQuery: isLatestDatabaseQueryRequest,
      updateDatabase,
      executeDatabaseQuery,
      isActiveWorkspace: (currentWorkspaceId) =>
        workspaceStore.getState().registry.active_workspace_id === currentWorkspaceId,
      refreshHistory: refreshDatabaseHistory,
      onResultApplied: () => {
        setActiveActivity("database");
        setPanelOpen(true);
        setSurface("database-result");
      },
    });
  }

  function confirmDatabaseQuery(input: string) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const database = workspaceViewStore.getState().viewFor(workspaceId).database;
    const confirmation = database.confirmation;
    const profileId = database.activeProfileId;

    if (!confirmation || !profileId) {
      return;
    }

    if (input !== confirmation.confirmationText) {
      return;
    }

    updateDatabase(workspaceId, (current) => ({
      ...current,
      confirmation: null,
      error: null,
    }));
    const requestId = (databaseQueryRequestRef.current[workspaceId] ?? 0) + 1;
    databaseQueryRequestRef.current = {
      ...databaseQueryRequestRef.current,
      [workspaceId]: requestId,
    };
    void executeDatabaseQueryRequest({
      workspaceId,
      workspaceRoot,
      profileId,
      sql: database.queryDraft,
      requestId,
      confirmation: confirmation.confirmationText,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseQuery: isLatestDatabaseQueryRequest,
      updateDatabase,
      executeDatabaseQuery,
      isActiveWorkspace: (currentWorkspaceId) =>
        workspaceStore.getState().registry.active_workspace_id === currentWorkspaceId,
      refreshHistory: refreshDatabaseHistory,
      onResultApplied: () => {
        setActiveActivity("database");
        setPanelOpen(true);
        setSurface("database-result");
      },
    });
  }

  function cancelDatabaseConfirmation() {
    if (!activeWorkspaceId) {
      return;
    }

    updateDatabase(activeWorkspaceId, (database) => ({
      ...database,
      confirmation: null,
      loading: false,
    }));
  }

  function selectDatabaseHistory(entry: DatabaseQueryHistoryEntry) {
    if (!activeWorkspaceId) {
      return;
    }

    updateDatabase(activeWorkspaceId, (database) =>
      updateDatabaseDraft(database, entry.sql),
    );
  }

  async function exportDatabaseResult() {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const database = workspaceViewStore.getState().viewFor(workspaceId).database;

    if (!database.activeResult) {
      return;
    }

    const requestId = (databaseExportRequestRef.current[workspaceId] ?? 0) + 1;
    databaseExportRequestRef.current = {
      ...databaseExportRequestRef.current,
      [workspaceId]: requestId,
    };
    const resultId = databaseResultId(database.activeResult);

    void exportDatabaseQueryResultRequest({
      workspaceId,
      workspaceRoot,
      requestId,
      resultId,
      activeResult: database.activeResult,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseExportRequest,
      updateDatabase,
      exportDatabaseQueryResult,
    });
  }

  function nextExtensionStatusRequestId(workspaceId: string): number {
    const requestId = (extensionStatusRequestRef.current[workspaceId] ?? 0) + 1;
    extensionStatusRequestRef.current = {
      ...extensionStatusRequestRef.current,
      [workspaceId]: requestId,
    };

    return requestId;
  }

  function currentExtensionStateEpoch(workspaceId: string): number {
    return extensionStateEpochRef.current[workspaceId] ?? 0;
  }

  function bumpExtensionStateEpoch(workspaceId: string): number {
    const epoch = currentExtensionStateEpoch(workspaceId) + 1;
    extensionStateEpochRef.current = {
      ...extensionStateEpochRef.current,
      [workspaceId]: epoch,
    };
    return epoch;
  }

  function hasPendingExtensionToggle(workspaceId: string): boolean {
    return (extensionPendingToggleRef.current[workspaceId] ?? 0) > 0;
  }

  function beginExtensionToggleMutation(workspaceId: string) {
    bumpExtensionStateEpoch(workspaceId);
    extensionPendingToggleRef.current = {
      ...extensionPendingToggleRef.current,
      [workspaceId]: (extensionPendingToggleRef.current[workspaceId] ?? 0) + 1,
    };
  }

  function finishExtensionToggleMutation(workspaceId: string) {
    const nextPending = Math.max(
      0,
      (extensionPendingToggleRef.current[workspaceId] ?? 0) - 1,
    );
    extensionPendingToggleRef.current = {
      ...extensionPendingToggleRef.current,
      [workspaceId]: nextPending,
    };
    bumpExtensionStateEpoch(workspaceId);
  }

  function extensionToggleRequestKey(
    workspaceId: string,
    extensionId: string,
  ): string {
    return `${workspaceId}::${extensionId}`;
  }

  function nextExtensionToggleRequestId(
    workspaceId: string,
    extensionId: string,
  ): number {
    const key = extensionToggleRequestKey(workspaceId, extensionId);
    const requestId = (extensionToggleRequestRef.current[key] ?? 0) + 1;
    extensionToggleRequestRef.current = {
      ...extensionToggleRequestRef.current,
      [key]: requestId,
    };

    return requestId;
  }

  function isLatestExtensionStatusRequest(
    workspaceId: string,
    requestId: number,
  ) {
    return extensionStatusRequestRef.current[workspaceId] === requestId;
  }

  function isLatestExtensionToggleRequest(
    workspaceId: string,
    extensionId: string,
    requestId: number,
  ) {
    return (
      extensionToggleRequestRef.current[
        extensionToggleRequestKey(workspaceId, extensionId)
      ] === requestId
    );
  }

  function canApplyExtensionStatusSnapshot(
    workspaceId: string,
    workspaceRoot: string,
    requestId: number,
    requestEpoch: number,
  ): boolean {
    return (
      isLatestExtensionStatusRequest(workspaceId, requestId) &&
      currentExtensionStateEpoch(workspaceId) === requestEpoch &&
      !hasPendingExtensionToggle(workspaceId) &&
      hasRegisteredWorkspace(workspaceId) &&
      getWorkspaceRoot(workspaceId) === workspaceRoot
    );
  }

  function canApplyExtensionToggleResult(
    workspaceId: string,
    workspaceRoot: string,
    extensionId: string,
    requestId: number,
  ): boolean {
    return (
      isLatestExtensionToggleRequest(workspaceId, extensionId, requestId) &&
      hasRegisteredWorkspace(workspaceId) &&
      getWorkspaceRoot(workspaceId) === workspaceRoot
    );
  }

  function patchToggledExtensionStatus(
    extension: ExtensionViewState,
    extensionId: string,
    statuses: ExtensionWorkspaceStatus[],
  ): ExtensionViewState {
    const toggledStatus = statuses.find(
      (status) => status.manifest.id === extensionId,
    );

    if (!toggledStatus) {
      return setExtensionError(
        extension,
        `Toggle extension failed: missing status for ${extensionId}`,
      );
    }

    return replaceExtensionStatuses(
      extension,
      extension.statuses.map((status) =>
        status.manifest.id === extensionId ? toggledStatus : status,
      ),
    );
  }

  async function refreshExtensionsForWorkspace(
    workspaceId: string,
    workspaceRoot: string,
  ): Promise<void> {
    const requestId = nextExtensionStatusRequestId(workspaceId);
    const requestEpoch = currentExtensionStateEpoch(workspaceId);
    updateExtension(workspaceId, setExtensionLoading);

    try {
      const statuses = await listExtensionStatuses(workspaceRoot);

      if (
        !canApplyExtensionStatusSnapshot(
          workspaceId,
          workspaceRoot,
          requestId,
          requestEpoch,
        )
      ) {
        return;
      }

      updateExtension(workspaceId, (extension) =>
        replaceExtensionStatuses(extension, statuses),
      );
    } catch (error) {
      if (!isLatestExtensionStatusRequest(workspaceId, requestId)) {
        return;
      }

      if (
        !hasRegisteredWorkspace(workspaceId) ||
        getWorkspaceRoot(workspaceId) !== workspaceRoot
      ) {
        updateExtension(workspaceId, (extension) => ({
          ...extension,
          loading: false,
          error: null,
        }));
        return;
      }

      if (
        currentExtensionStateEpoch(workspaceId) !== requestEpoch ||
        hasPendingExtensionToggle(workspaceId)
      ) {
        return;
      }

      updateExtension(workspaceId, (extension) =>
        setExtensionError(
          extension,
          `Load extensions failed: ${terminalErrorMessage(error)}`,
        ),
      );
    }
  }

  function refreshExtensions() {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    void refreshExtensionsForWorkspace(activeWorkspaceId, activeWorkspace.path);
  }

  function openExtensionsPanel() {
    setActiveActivity("extensions");
    setPanelOpen(true);
  }

  function selectExtension(extensionId: string) {
    updateExtension(activeWorkspaceId, (extension) => ({
      ...extension,
      activeExtensionId: extensionId,
    }));
  }

  function toggleExtensionEnabled(extensionId: string, enabled: boolean) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const requestId = nextExtensionToggleRequestId(workspaceId, extensionId);
    beginExtensionToggleMutation(workspaceId);
    updateExtension(workspaceId, (extension) =>
      toggleExtensionStatus(extension, extensionId, enabled),
    );

    void setExtensionEnabled({
      workspaceRoot,
      extensionId,
      enabled,
    })
      .then((statuses) => {
        finishExtensionToggleMutation(workspaceId);
        if (
          !canApplyExtensionToggleResult(
            workspaceId,
            workspaceRoot,
            extensionId,
            requestId,
          )
        ) {
          return;
        }

        updateExtension(workspaceId, (extension) =>
          patchToggledExtensionStatus(extension, extensionId, statuses),
        );
      })
      .catch((error) => {
        finishExtensionToggleMutation(workspaceId);
        if (
          !canApplyExtensionToggleResult(
            workspaceId,
            workspaceRoot,
            extensionId,
            requestId,
          )
        ) {
          return;
        }

        updateExtension(workspaceId, (extension) =>
          setExtensionError(
            extension,
            `Toggle extension failed: ${terminalErrorMessage(error)}`,
          ),
        );
      });
  }

  function enabledExtensionCommandForId(
    commandId: string,
  ): ExtensionCommandContribution | null {
    if (coreCommandIdSet.has(commandId)) {
      return null;
    }

    const extension = workspaceViewStore.getState().viewFor(activeWorkspaceId)
      .extension;

    for (const status of extension.statuses) {
      if (!status.enabled) {
        continue;
      }

      const command = status.manifest.contributes.commands.find(
        (item) => item.id === commandId,
      );
      if (command && !isCoreExtensionContribution(command)) {
        return command;
      }
    }

    return null;
  }

  function recordExtensionCommandPerformance(
    command: ExtensionCommandContribution,
  ) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const requestId = nextExtensionStatusRequestId(workspaceId);
    const requestEpoch = currentExtensionStateEpoch(workspaceId);
    void recordExtensionPerformance({
      workspaceRoot,
      sample: {
        extension_id: command.owner_extension_id,
        workspace_root: workspaceRoot,
        operation: `command:${command.id}`,
        duration_ms: 5,
        budget_ms: 50,
        recorded_ms: 0,
      },
    })
      .then((statuses) => {
        if (
          !canApplyExtensionStatusSnapshot(
            workspaceId,
            workspaceRoot,
            requestId,
            requestEpoch,
          )
        ) {
          return;
        }

        updateExtension(workspaceId, (extension) =>
          replaceExtensionStatuses(extension, statuses),
        );
      })
      .catch((error) => {
        if (
          !canApplyExtensionStatusSnapshot(
            workspaceId,
            workspaceRoot,
            requestId,
            requestEpoch,
          )
        ) {
          return;
        }

        updateExtension(workspaceId, (extension) =>
          setExtensionError(
            extension,
            `Record extension performance failed: ${terminalErrorMessage(error)}`,
          ),
        );
      });
  }

  function isLatestDebugLoadRequest(workspaceId: string, requestId: number) {
    return debugLoadRequestRef.current[workspaceId] === requestId;
  }

  async function refreshDebugForWorkspace(
    workspaceId: string,
    workspaceRoot: string,
  ): Promise<void> {
    const requestId = (debugLoadRequestRef.current[workspaceId] ?? 0) + 1;
    debugLoadRequestRef.current = {
      ...debugLoadRequestRef.current,
      [workspaceId]: requestId,
    };
    updateDebug(workspaceId, beginDebugRequest);

    try {
      const [launchConfigs, sessions] = await Promise.all([
        listDebugLaunchConfigs(workspaceRoot),
        listDebugSessions({ workspaceId, workspaceRoot }),
      ]);

      if (
        !isLatestDebugLoadRequest(workspaceId, requestId) ||
        !hasRegisteredWorkspace(workspaceId) ||
        getWorkspaceRoot(workspaceId) !== workspaceRoot
      ) {
        return;
      }

      updateDebug(workspaceId, (debug) => ({
        ...applyDebugRefreshSnapshot(debug, launchConfigs, sessions),
        loading: false,
        error: null,
      }));
    } catch (error) {
      if (!isLatestDebugLoadRequest(workspaceId, requestId)) {
        return;
      }

      if (
        !hasRegisteredWorkspace(workspaceId) ||
        getWorkspaceRoot(workspaceId) !== workspaceRoot
      ) {
        updateDebug(workspaceId, (debug) => ({
          ...debug,
          loading: false,
          error: null,
        }));
        return;
      }

      updateDebug(workspaceId, (debug) =>
        setDebugError(
          debug,
          `Load debug configs failed: ${terminalErrorMessage(error)}`,
        ),
      );
    }
  }

  function openDebugPanel() {
    setActiveActivity("debug");
    setPanelOpen(true);
  }

  function selectDebugLaunchConfig(configId: string) {
    updateDebug(activeWorkspaceId, (debug) => selectDebugConfig(debug, configId));
  }

  function setDebugWorkbenchMode(mode: DebugViewState["mode"]) {
    updateDebug(activeWorkspaceId, (debug) => setDebugMode(debug, mode));
  }

  function applyDebugSessionCommandResult(
    workspaceId: string,
    workspaceRoot: string,
    session: DebugSessionInfo,
  ) {
    if (
      !hasRegisteredWorkspace(workspaceId) ||
      getWorkspaceRoot(workspaceId) !== workspaceRoot
    ) {
      return;
    }

    updateDebug(workspaceId, (debug) => replaceDebugSessions(debug, [session]));
  }

  async function startActiveDebugSession() {
    openDebugPanel();
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const debug = workspaceViewStore.getState().viewFor(workspaceId).debug;
    const configId = debug.activeConfigId;

    if (!configId) {
      updateDebug(workspaceId, (state) =>
        setDebugError(state, "Select a debug launch configuration first"),
      );
      return;
    }

    updateDebug(workspaceId, beginDebugRequest);
    try {
      const session = await startDebugSession({
        workspaceId,
        workspaceRoot,
        configId,
      });
      applyDebugSessionCommandResult(workspaceId, workspaceRoot, session);
      updateView(workspaceId, {
        activeActivity: "debug",
        panelOpen: true,
        surface: "debug-console",
      });
    } catch (error) {
      updateDebug(workspaceId, (state) =>
        setDebugError(
          state,
          `Start debug session failed: ${terminalErrorMessage(error)}`,
        ),
      );
    }
  }

  function runDebugSessionCommand(
    sessionId: string,
    action: (args: {
      workspaceId: string;
      workspaceRoot: string;
      sessionId: string;
    }) => Promise<DebugSessionInfo>,
    failureLabel: string,
  ) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    void action({ workspaceId, workspaceRoot, sessionId })
      .then((session) =>
        applyDebugSessionCommandResult(workspaceId, workspaceRoot, session),
      )
      .catch((error) => {
        updateDebug(workspaceId, (state) =>
          setDebugError(state, `${failureLabel}: ${terminalErrorMessage(error)}`),
        );
      });
  }

  function continueDebugById(sessionId: string) {
    runDebugSessionCommand(sessionId, continueDebugSession, "Continue failed");
  }

  function stepOverDebugById(sessionId: string) {
    runDebugSessionCommand(sessionId, stepOverDebugSession, "Step over failed");
  }

  function pauseDebugById(sessionId: string) {
    runDebugSessionCommand(sessionId, pauseDebugSession, "Pause failed");
  }

  function disconnectDebugById(sessionId: string) {
    runDebugSessionCommand(sessionId, disconnectDebugSession, "Disconnect failed");
  }

  function breakpointInputsForBackend(
    breakpoints: DebugViewState["breakpointsByPath"][string],
  ): DebugSourceBreakpointInput[] {
    return breakpoints.map((breakpoint) => ({
      line: breakpoint.line,
      condition: breakpoint.condition,
      log_message: breakpoint.log_message,
    }));
  }

  function toggleDebugBreakpointAt(sourcePath: string, line: number) {
    if (!activeWorkspace || !activeWorkspaceId || line <= 0) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    const currentDebug = workspaceViewStore.getState().viewFor(workspaceId).debug;
    const nextDebug = toggleDebugBreakpoint(currentDebug, sourcePath, line);
    const breakpoints = nextDebug.breakpointsByPath[sourcePath] ?? [];

    updateDebug(workspaceId, () => nextDebug);
    void setDebugBreakpointsCommand({
      workspaceId,
      workspaceRoot,
      sourcePath,
      breakpoints: breakpointInputsForBackend(breakpoints),
    })
      .then((verifiedBreakpoints) => {
        if (
          !hasRegisteredWorkspace(workspaceId) ||
          getWorkspaceRoot(workspaceId) !== workspaceRoot
        ) {
          return;
        }

        updateDebug(workspaceId, (debug) =>
          setDebugBreakpoints(debug, sourcePath, verifiedBreakpoints),
        );
      })
      .catch((error) => {
        updateDebug(workspaceId, (debug) =>
          setDebugError(
            debug,
            `Set breakpoints failed: ${terminalErrorMessage(error)}`,
          ),
        );
      });
  }

  function toggleLoadedFileBreakpoint(line: number) {
    if (!loadedFile || loadedFile.workspaceId !== activeWorkspaceId) {
      return;
    }

    toggleDebugBreakpointAt(loadedFile.path, line);
  }

  function openDebugFrame(frame: DebugStackFrame) {
    void openFile(frame.source_path);
  }

  function addDebugWatchExpression(expression: string) {
    updateDebug(activeWorkspaceId, (debug) => addDebugWatch(debug, expression));
  }

  function removeDebugWatchExpression(watch: number | string) {
    updateDebug(activeWorkspaceId, (debug) => {
      const expression =
        typeof watch === "number" ? debug.watches[watch]?.expression : watch;
      return expression ? removeDebugWatch(debug, expression) : debug;
    });
  }

  function evaluateDebugWatchExpression(expression: string) {
    const activeSession = activeDebugSessionForState(view.debug);
    if (!activeWorkspace || !activeWorkspaceId || !activeSession) {
      updateDebug(activeWorkspaceId, (debug) =>
        updateDebugWatchResult(debug, expression, "no active debug session"),
      );
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    void evaluateDebugExpression({
      workspaceId,
      workspaceRoot,
      sessionId: activeSession.id,
      expression,
    })
      .then((variable) => {
        updateDebug(workspaceId, (debug) =>
          updateDebugWatchResult(debug, expression, variable),
        );
      })
      .catch((error) => {
        updateDebug(workspaceId, (debug) =>
          updateDebugWatchResult(debug, expression, terminalErrorMessage(error)),
        );
      });
  }

  async function loadDebugStackForEvent(event: DebugSessionEvent) {
    const workspaceId = knownWorkspaceIdForDebugEvent(event);
    const threadId = event.thread_id ?? event.active_thread_id ?? null;
    if (!workspaceId || threadId === null) {
      return;
    }

    try {
      const frames = await getDebugStackTrace({
        workspaceId,
        workspaceRoot: event.workspace_root,
        sessionId: event.session_id,
        threadId,
      });
      if (!isCurrentDebugStoppedRefresh(workspaceId, event)) {
        return;
      }

      const scopesByFrameId: Record<
        number,
        Awaited<ReturnType<typeof getDebugScopes>>
      > = {};
      const variablesByReference: Record<
        number,
        Awaited<ReturnType<typeof getDebugVariables>>
      > = {};

      updateDebug(workspaceId, (state) =>
        replaceDebugStackSnapshot(state, event.session_id, frames),
      );

      for (const frame of frames) {
        let scopes: Awaited<ReturnType<typeof getDebugScopes>>;
        try {
          scopes = await getDebugScopes({
            workspaceId,
            workspaceRoot: event.workspace_root,
            sessionId: event.session_id,
            frameId: frame.id,
          });
        } catch {
          continue;
        }

        if (!isCurrentDebugStoppedRefresh(workspaceId, event)) {
          return;
        }

        scopesByFrameId[frame.id] = scopes;

        for (const scope of scopes) {
          if (scope.variables_reference === 0) {
            continue;
          }

          try {
            const variables = await getDebugVariables({
              workspaceId,
              workspaceRoot: event.workspace_root,
              sessionId: event.session_id,
              variablesReference: scope.variables_reference,
            });
            if (!isCurrentDebugStoppedRefresh(workspaceId, event)) {
              return;
            }
            variablesByReference[scope.variables_reference] = variables;
          } catch {
            // Variable refresh is best-effort per scope.
          }
        }
      }

      if (!isCurrentDebugStoppedRefresh(workspaceId, event)) {
        return;
      }

      updateDebug(workspaceId, (state) =>
        replaceDebugStackSnapshot(
          state,
          event.session_id,
          frames,
          scopesByFrameId,
          variablesByReference,
        ),
      );
    } catch {
      // Stack refresh is best-effort; session event state remains authoritative.
    }
  }

  function isCurrentDebugStoppedRefresh(
    workspaceId: string,
    event: DebugSessionEvent,
  ) {
    const debug = workspaceViewStore.getState().viewFor(workspaceId).debug;
    return (
      hasRegisteredWorkspace(workspaceId) &&
      getWorkspaceRoot(workspaceId) === event.workspace_root &&
      debug.sessionSequenceById[event.session_id] === event.sequence
    );
  }

  function openSettingsCategory(
    category: SettingsCategory,
    options: { refresh?: boolean } = {},
  ) {
    updateSettings(activeWorkspaceId, (settings) =>
      selectSettingsCategory(settings, category),
    );
    setActiveActivity("settings");
    setPanelOpen(true);

    if (
      (options.refresh ?? true) &&
      (category === "diagnostics" || category === "performance") &&
      activeWorkspaceId
    ) {
      void refreshDiagnosticsForWorkspace(activeWorkspaceId);
    }
  }

  async function importActiveKeybindings() {
    if (!activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const content =
      workspaceViewStore.getState().viewFor(workspaceId).settings
        .keybindingImportDraft;
    const requestId =
      (keybindingImportRequestRef.current[workspaceId] ?? 0) + 1;
    keybindingImportRequestRef.current[workspaceId] = requestId;

    try {
      const imported = await importKeybindings({
        source: "vscode",
        content,
      });

      if (
        keybindingImportRequestRef.current[workspaceId] !== requestId ||
        !hasRegisteredWorkspace(workspaceId)
      ) {
        return;
      }

      updateSettings(workspaceId, (settings) => ({
        ...storeSettings(settings, imported),
        keybindingImportDraft: "",
        keybindingImportError: null,
      }));
    } catch (error) {
      if (
        keybindingImportRequestRef.current[workspaceId] !== requestId ||
        !hasRegisteredWorkspace(workspaceId)
      ) {
        return;
      }

      updateSettings(workspaceId, (settings) =>
        setKeybindingImportError(settings, terminalErrorMessage(error)),
      );
    }
  }

  function runCommand(id: string) {
    if (
      runDebugCommandFromPalette(id, {
        debugState: view.debug,
        activeFilePath: view.editor.activePath,
        onOpenDebug: openDebugPanel,
        onStartSession: () => void startActiveDebugSession(),
        onContinue: continueDebugById,
        onStepOver: stepOverDebugById,
        onPause: pauseDebugById,
        onDisconnect: disconnectDebugById,
        onToggleBreakpoint: toggleDebugBreakpointAt,
      })
    ) {
      setPaletteOpen(false);
      return;
    }

    const extensionCommand = enabledExtensionCommandForId(id);
    if (extensionCommand) {
      recordExtensionCommandPerformance(extensionCommand);
      setPaletteOpen(false);
      return;
    }

    switch (id) {
      case "save-file":
        void saveActiveFile();
        break;
      case "find-in-file":
        setSurface("editor");
        setFindOpen(true);
        setFindFocusRequest((value) => value + 1);
        break;
      case "search-workspace":
        setActiveActivity("search");
        setPanelOpen(true);
        break;
      case "open-editor":
        setSurface("editor");
        break;
      case "open-terminal":
        setSurface("terminal");
        setActiveActivity("terminal");
        break;
      case "new-terminal":
        void newTerminal();
        break;
      case "run-task":
        runTaskFromPalette();
        break;
      case "rerun-task":
        rerunTaskRun();
        break;
      case "stop-task":
        stopActiveTaskRun();
        break;
      case "git-reset-hard":
        resetHardFromGitPanel();
        break;
      case "git-rebase-main":
        rebaseOntoFromGitPanel("main");
        break;
      case "toggle-sidebar":
        setPanelOpen(!panelOpen);
        break;
      case "open-settings":
        openSettingsCategory(view.settings.activeCategory);
        break;
      case "open-diagnostics":
        openSettingsCategory("diagnostics");
        break;
      case "refresh-diagnostics":
        openSettingsCategory("diagnostics", { refresh: false });
        if (activeWorkspaceId) {
          void refreshDiagnosticsForWorkspace(activeWorkspaceId);
        }
        break;
      case "open-recovery":
        openSettingsCategory("recovery");
        break;
      case "import-keybindings":
        openSettingsCategory("keybindings");
        break;
      case "open-docs":
        openDocsPanel();
        break;
      case "refresh-docs-index":
        void refreshDocsIndex();
        break;
      case "create-context-pack":
        void createDocsContextPack();
        break;
      case "open-language":
        openLanguagePanel();
        break;
      case "language-refresh":
        void refreshLanguageData();
        break;
      case "language-restart":
        restartActiveLanguageServer();
        break;
      case "open-agents":
        openAgentsPanel();
        break;
      case "open-browser-preview":
        openBrowserPreview(view.browser.urlInput);
        break;
      case "browser-reload":
        reloadBrowserPreview();
        break;
      case "browser-hard-reload":
        hardReloadBrowserPreview();
        break;
      case "browser-capture-screenshot":
        captureBrowserScreenshot();
        break;
      case "open-remote":
        setActiveActivity("remote");
        setPanelOpen(true);
        break;
      case "remote-connect":
        void connectActiveRemoteHost();
        break;
      case "remote-open-ssh":
        void openSshForHost();
        break;
      case "remote-open-sftp":
        openSftpForHost();
        break;
      case "open-database":
        setActiveActivity("database");
        setPanelOpen(true);
        break;
      case "database-refresh":
        refreshDatabaseProfiles();
        break;
      case "open-extensions":
        openExtensionsPanel();
        break;
      case "extension-refresh":
        refreshExtensions();
        break;
      case "agent-start-session": {
        if (!activeWorkspaceId) {
          openAgentsPanel();
          break;
        }

        const agentState = workspaceViewStore.getState().viewFor(activeWorkspaceId)
          .agent;
        const selectedContext = selectedContextItems(
          agentState,
          availableAgentContext,
        );
        if (!agentState.promptDraft.trim() || selectedContext.length === 0) {
          openAgentsPanel();
          break;
        }

        void handleAgentStartSessionFromCallback(agentState.promptDraft, {
          openPanel: true,
        });
        break;
      }
      case "agent-export-prompt":
        void handleAgentExport();
        break;
      case "open-workspace":
      case "switch-workspace":
        break;
    }

    setPaletteOpen(false);
  }

  return (
    <div className="yz" data-theme="dark">
      <header className="titlebar">
        <div className="traffic" aria-hidden="true">
          <i className="r" />
          <i className="y" />
          <i className="g" />
        </div>
        <WorkspaceSwitcher />
        <div className="tb-spacer" />
        <span className="badge2 green">
          <span className="d" />
          dev :1420
        </span>
        <button
          type="button"
          className="kbd"
          aria-haspopup="dialog"
          aria-expanded={paletteOpen}
          onClick={() => setPaletteOpen(true)}
        >
          Search or run a command <kbd>⌘K</kbd>
        </button>
        <div className="tb-actions">
          <button
            type="button"
            className={`iconbtn${panelOpen ? " on" : ""}`}
            title="Toggle sidebar"
            aria-label="Toggle sidebar"
            onClick={() => setPanelOpen(!panelOpen)}
          >
            <PanelLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            className="iconbtn"
            title="Split editor"
            aria-label="Split editor"
          >
            <SplitSquareHorizontal aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="body">
        <ActivityRail
          active={activeActivity}
          badges={{
            git: changeBadgeCount(view.git.status),
            docs: docsBadgeCount(view.docs),
            agents: agentBadgeCount(view.agent),
            language: languageDiagnosticBadge,
            database: databaseBadge,
            extensions: extensionBadge,
            debug: activeDebugSession ? "1" : null,
          }}
          onSelect={(activity) => {
            setActiveActivity(activity);
            if (activity === "debug" || activity === "extensions") {
              setPanelOpen(true);
            }
          }}
        />
        {panelOpen ? (
          <aside className="panel">
            {activeActivity === "git" ||
            activeActivity === "docs" ||
            activeActivity === "language" ||
            activeActivity === "debug" ||
            activeActivity === "remote" ||
            activeActivity === "extensions" ||
            activeActivity === "settings" ? null : (
              <div className="panel-head">
                <span className="panel-title">{panelTitles[activeActivity]}</span>
                <div className="panel-acts">
                  {activeActivity === "explorer" ? (
                    <>
                      <button
                        type="button"
                        className="iconbtn"
                        title={`New file in ${activeWorkspace?.name ?? "workspace"}`}
                        aria-label={`New file in ${
                          activeWorkspace?.name ?? "workspace"
                        }`}
                        disabled={!activeWorkspace}
                        onClick={() => void promptCreateFileAtWorkspaceRoot()}
                      >
                        <Plus aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="iconbtn"
                        title={`Refresh ${
                          activeWorkspace?.name ?? "workspace"
                        } explorer`}
                        aria-label={`Refresh ${
                          activeWorkspace?.name ?? "workspace"
                        } explorer`}
                        disabled={!activeWorkspace}
                        onClick={() =>
                          setFileTreeRefreshKey((value) => value + 1)
                        }
                      >
                        <RotateCw aria-hidden="true" />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            )}
            <PanelBody
              active={activeActivity}
              refreshKey={fileTreeRefreshKey}
              activeFilePath={view.editor.activePath}
              terminalSessions={terminalSessions}
              activeTerminalId={activeTerminalId}
              terminalCwdInput={view.terminal.cwdInput}
              terminalError={terminalError}
              taskState={view.task}
              taskError={taskError}
              gitState={view.git}
              docsState={view.docs}
              contextPackNameById={contextPackNameById}
              gitDecorations={gitDecorations}
              onOpenFile={openFile}
              onCreateFile={createFileFromExplorer}
              onRenamePath={renamePathFromExplorer}
              onDeletePath={deletePathFromExplorer}
              onTerminalCwdInputChange={updateTerminalCwdInput}
              onNewTerminal={() => void newTerminal()}
              onActivateTerminal={activateTerminalById}
              onCloseTerminal={(id) => void closeTerminalById(id)}
              onRestartTerminal={(id) => void restartTerminalById(id)}
              onTaskCustomCommandChange={updateTaskCustomCommand}
              onRunTask={runDetectedTask}
              onRunCustomTask={runCustomTask}
              onActivateTaskRun={activateTaskRunById}
              onStopTaskRun={(id) => void stopTaskRunById(id)}
              onRerunTaskRun={rerunTaskRun}
              onGitRefresh={() => void refreshGitStatus()}
              onGitCommitMessageChange={updateGitMessage}
              onGitCommit={commitFromGitPanel}
              onGitStage={stageGitPath}
              onGitUnstage={unstageGitPath}
              onGitDiscard={discardGitPath}
              onGitOpenDiff={openGitDiff}
              onGitStash={stashFromGitPanel}
              onGitFetch={fetchFromGitPanel}
              onGitPull={pullFromGitPanel}
              onGitPush={pushFromGitPanel}
              onGitCheckoutBranch={(branch) =>
                void checkoutBranchFromGitPanel(branch)
              }
              onGitCreateBranch={(name) => void createBranchFromGitPanel(name)}
              onGitOpenGraph={openGitGraph}
              onDocsRefresh={() => void refreshDocsIndex()}
              onDocsSearch={searchDocsPanel}
              onDocsOpenPreview={(path) => void openDocsPreview(path)}
              onDocsToggleSource={toggleDocsSource}
              onDocsPackNameChange={updateDocsPackName}
              onDocsCreatePack={() => void createDocsContextPack()}
              onDocsSelectPack={selectDocsContextPack}
              onDocsDeletePack={(id) => void deleteDocsContextPack(id)}
              onDocsUsePackForActiveTask={(id) =>
                void linkPackToActiveTask(id)
              }
              onDocsLinkPackToAgentSession={linkPackToAgentSession}
              agentState={view.agent}
              availableAgentContext={availableAgentContext}
              onAgentModeChange={handleAgentModeChange}
              onAgentPromptChange={handleAgentPromptChange}
              onAgentToggleContext={handleAgentContextToggle}
              onAgentStartSession={(prompt) =>
                void handleAgentStartSessionFromCallback(prompt)
              }
              onAgentSelectSession={handleAgentSelectSession}
              onAgentApprove={(approvalId) =>
                void handleAgentApproval(approvalId, "approved")
              }
              onAgentReject={(approvalId) =>
                void handleAgentApproval(approvalId, "rejected")
              }
              onAgentExport={() => void handleAgentExport()}
              onLanguageOpenDiagnostic={openLanguageDiagnostic}
              onLanguageRefresh={() => void refreshLanguageData()}
              onLanguageRestartServer={restartLanguageServer}
              browserState={view.browser}
              browserTargets={browserTargets}
              browserCanCapture={browserCanCapture}
              onBrowserUrlInputChange={(value) => updateBrowserUrlInput(value)}
              onBrowserOpenUrl={(value) => openBrowserPreview(value)}
              onBrowserOpenTarget={(url) => openBrowserPreview(url)}
              onBrowserReload={() => reloadBrowserPreview()}
              onBrowserHardReload={() => hardReloadBrowserPreview()}
              onBrowserCapture={() => captureBrowserScreenshot()}
              onBrowserSelectScreenshot={(id) => selectBrowserScreenshot(id)}
              databaseState={view.database}
              onDatabaseRefreshProfiles={() => refreshDatabaseProfiles()}
              onDatabaseSelectProfile={(profileId) =>
                selectDatabaseProfileForWorkspace(profileId)
              }
              onDatabaseInspectProfile={(profileId) =>
                void inspectDatabaseProfile(profileId)
              }
              onDatabaseOpenTable={(profileId, table) =>
                openDatabaseTable(profileId, table)
              }
              onDatabaseDraftChange={(query) => updateDatabaseDraftQuery(query)}
              onDatabaseRunQuery={() => runDatabaseQuery()}
              onDatabaseConfirmQuery={(input) => confirmDatabaseQuery(input)}
              onDatabaseCancelConfirmation={() =>
                cancelDatabaseConfirmation()
              }
              onDatabaseExportResult={() => void exportDatabaseResult()}
              onDatabaseSelectHistory={(entry) => selectDatabaseHistory(entry)}
              extensionState={view.extension}
              onExtensionRefresh={() => refreshExtensions()}
              onExtensionSelect={selectExtension}
              onExtensionToggle={toggleExtensionEnabled}
              remoteState={view.remote}
              onRemoteModeChange={setRemoteWorkbenchMode}
              onRemoteSelectHost={selectRemoteHostById}
              onRemoteRefresh={() => refreshRemoteHosts()}
              onRemoteCreateHost={() => void createRemoteHostFromPrompt()}
              onRemoteConnectHost={(hostId) =>
                void connectActiveRemoteHost(hostId)
              }
              onRemoteOpenSsh={(hostId) => void openSshForHost(hostId)}
              onRemoteOpenSftp={(hostId) => openSftpForHost(hostId)}
              onRemoteRunCommand={() => runActiveRemoteCommand()}
              onRemoteCommandDraftChange={updateRemoteCommandDraft}
              onRemoteListSftpDirectory={(hostId, path) =>
                void listRemoteDirectory(hostId, path)
              }
              onRemoteDownloadFile={(path) => void downloadRemoteFile(path)}
              onRemoteUploadFile={(path) => void uploadRemoteFile(path)}
              recoveryState={view.recovery}
              onRecoveryRefresh={() => {
                if (activeWorkspace && activeWorkspaceId) {
                  void refreshRecoveryForWorkspace(
                    activeWorkspaceId,
                    activeWorkspace.path,
                  );
                }
              }}
              onRecoveryRestore={(backupId) =>
                void restoreRecoveryBackupById(backupId)
              }
              onRecoveryDiscard={(backupId) =>
                void discardRecoveryBackupById(backupId)
              }
              diagnosticsState={view.diagnostics}
              settingsState={view.settings}
              onSettingsSelectCategory={(category) => {
                updateSettings(activeWorkspaceId, (settings) =>
                  selectSettingsCategory(settings, category),
                );
                if (
                  (category === "diagnostics" || category === "performance") &&
                  activeWorkspaceId
                ) {
                  void refreshDiagnosticsForWorkspace(activeWorkspaceId);
                }
              }}
              onDiagnosticsRefresh={() => {
                if (activeWorkspaceId) {
                  void refreshDiagnosticsForWorkspace(activeWorkspaceId);
                }
              }}
              onKeybindingImportDraftChange={(draft) =>
                updateSettings(activeWorkspaceId, (settings) =>
                  setKeybindingImportDraft(settings, draft),
                )
              }
              onImportKeybindings={() => void importActiveKeybindings()}
              languageState={view.language}
              debugState={view.debug}
              onDebugModeChange={setDebugWorkbenchMode}
              onDebugSelectConfig={selectDebugLaunchConfig}
              onDebugStartSession={() => void startActiveDebugSession()}
              onDebugContinue={continueDebugById}
              onDebugStepOver={stepOverDebugById}
              onDebugPause={pauseDebugById}
              onDebugDisconnect={disconnectDebugById}
              onDebugOpenFrame={openDebugFrame}
              onDebugAddWatch={addDebugWatchExpression}
              onDebugRemoveWatch={removeDebugWatchExpression}
              onDebugEvaluate={evaluateDebugWatchExpression}
            />
          </aside>
        ) : null}

        <main className="editor-region">
          <section className="group focus">
            <div className="tabstrip">
              {view.editor.tabs.map((tab) => {
                const isActive =
                  surface === "editor" && tab.path === view.editor.activePath;
                const iconClass = fileIconClassFromName(tab.name);
                const tabRelativePath = activeWorkspace
                  ? relativePathFromWorkspace(activeWorkspace.path, tab.path)
                  : null;
                const tabGitDecoration =
                  tabRelativePath === null
                    ? null
                    : gitDecorationForPath(gitDecorations, tabRelativePath);

                return (
                  <div
                    className={`tab${isActive ? " active" : ""}${
                      tab.externalChange ? " external" : ""
                    }`}
                    key={tab.path}
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={0}
                    title={tab.path}
                    onClick={() => void openFile(tab.path)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void openFile(tab.path);
                      }
                    }}
                  >
                    <FileCode2
                      className={`ftype ${iconClass}`}
                      aria-hidden="true"
                    />
                    <span className={`tlabel mono${tab.dirty ? " dirty" : ""}`}>
                      {tab.name}
                    </span>
                    {tabGitDecoration ? (
                      <span
                        className={`git-decoration-token git-token-${tabGitDecoration}`}
                        aria-label={`Git status ${tabGitDecoration}`}
                      >
                        {tabGitDecoration}
                      </span>
                    ) : null}
                    {tab.externalChange ? (
                      <span className="meta">changed</span>
                    ) : null}
                    {tab.dirty ? (
                      <span
                        className="dirtydot"
                        aria-label="Unsaved changes"
                      />
                    ) : null}
                    <button
                      type="button"
                      className="close"
                      title={`Close ${tab.name}`}
                      aria-label={`Close ${tab.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeEditorTab(tab.path);
                      }}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              {surface === "terminal" ? (
                <div className="tab active" title={activeTerminal?.cwd}>
                  <SquareTerminal className="ftype" aria-hidden="true" />
                  <span className="tlabel mono">{activeTerminalName}</span>
                  <button
                    type="button"
                    className="close"
                    title="Close terminal"
                    aria-label="Close terminal"
                    onClick={() => setSurface("empty")}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              ) : null}
              {surface === "ssh-terminal" ? (
                <div
                  className="tab active"
                  title={activeSshSession?.name ?? "SSH terminal"}
                >
                  <Server className="ftype" aria-hidden="true" />
                  <span className="tlabel mono">
                    {activeSshSession?.name ?? "SSH"}
                  </span>
                  <button
                    type="button"
                    className="close"
                    title="Close SSH terminal"
                    aria-label="Close SSH terminal"
                    onClick={() => setSurface("empty")}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              ) : null}
              {surface === "sftp-browser" ? (
                <div className="tab active" title={activeSftpPath}>
                  <Folder className="ftype" aria-hidden="true" />
                  <span className="tlabel mono">
                    {activeRemoteHost?.name ?? "SFTP"}
                  </span>
                  <button
                    type="button"
                    className="close"
                    title="Close SFTP browser"
                    aria-label="Close SFTP browser"
                    onClick={() => setSurface("empty")}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              ) : null}
              {surface === "docs-preview" ? (
                <div
                  className="tab active"
                  title={activeDocsPreviewPathLabel}
                >
                  <BookOpenText className="ftype" aria-hidden="true" />
                  <span className="tlabel mono">
                    {activeDocsPreview?.title ??
                      activeDocsPreviewPath ??
                      "Docs Preview"}
                  </span>
                  <button
                    type="button"
                    className="close"
                    title="Close docs preview"
                    aria-label="Close docs preview"
                    onClick={() => setSurface("empty")}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              ) : null}
              {surface === "browser-preview" ? (
                <div
                  className="tab active"
                  title={view.browser.activeUrl ?? "Browser"}
                >
                  <Globe className="ftype" aria-hidden="true" />
                  <span className="tlabel mono">
                    {view.browser.activeTitle ?? "Browser"}
                  </span>
                  <button
                    type="button"
                    className="close"
                    title="Close browser preview"
                    aria-label="Close browser preview"
                    onClick={() => setSurface("empty")}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              ) : null}
              {surface === "database-result" ? (
                <div
                  className="tab active"
                  title={view.database.activeResult?.sql ?? "Database result"}
                >
                  <Database className="ftype" aria-hidden="true" />
                  <span className="tlabel mono">Database</span>
                  <button
                    type="button"
                    className="close"
                    title="Close database result"
                    aria-label="Close database result"
                    onClick={() => {
                      setSurface("empty");
                      setActiveActivity("database");
                    }}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              ) : null}
              {surface === "debug-console" ? (
                <div
                  className="tab active"
                  title={activeDebugSession?.name ?? "Debug Console"}
                >
                  <Bug className="ftype" aria-hidden="true" />
                  <span className="tlabel mono">
                    {activeDebugSession?.name ?? "Debug Console"}
                  </span>
                  <button
                    type="button"
                    className="close"
                    title="Close debug console"
                    aria-label="Close debug console"
                    onClick={() => {
                      setSurface("empty");
                      setActiveActivity("debug");
                    }}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              ) : null}
              <div className="tabstrip-tail">
                <button
                  type="button"
                  className="iconbtn"
                  title="Open editor"
                  aria-label="Open editor"
                  onClick={() => setSurface("editor")}
                >
                  <Plus aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="iconbtn"
                  title="Open terminal"
                  aria-label="Open terminal"
                  onClick={() => {
                    setSurface("terminal");
                    setActiveActivity("terminal");
                  }}
                >
                  <SquareTerminal aria-hidden="true" />
                </button>
              </div>
            </div>

              <div className="breadcrumb">
                <span className="crumb">
                  {activeWorkspace?.name ?? "workspace"}
                </span>
                <ChevronDown aria-hidden="true" />
                <span className="crumb">
                  {activeEditorTab
                    ? activeEditorParent
                    : surface === "terminal"
                      ? "terminal"
                      : surface === "ssh-terminal"
                        ? "remote"
                      : surface === "sftp-browser"
                        ? "remote"
                      : surface === "browser-preview"
                        ? "browser"
                      : surface === "docs-preview"
                        ? "docs"
                        : surface === "database-result"
                          ? "database"
                          : surface === "debug-console"
                            ? "debug"
                          : surface === "editor"
                            ? "editor"
                            : "workspace"}
                </span>
                <ChevronDown aria-hidden="true" />
                <span className="crumb">
                  {activeEditorTab
                    ? activeEditorName
                    : surface === "terminal"
                      ? activeTerminalName
                      : surface === "ssh-terminal"
                        ? (activeSshSession?.name ?? "SSH terminal")
                      : surface === "sftp-browser"
                        ? activeSftpPath
                      : surface === "browser-preview"
                        ? (view.browser.activeTitle ?? "Start")
                      : surface === "docs-preview"
                        ? docsPreviewPathLabel(view.docs, "Preview")
                        : surface === "database-result"
                          ? "Database result"
                          : surface === "debug-console"
                            ? (activeDebugSession?.name ?? "Debug Console")
                          : surface === "editor"
                            ? "No file open"
                            : "Start"}
                </span>
              </div>

              <div
                className={`group-content${
                  showEditor ||
                  surface === "terminal" ||
                  surface === "ssh-terminal" ||
                  surface === "sftp-browser" ||
                  surface === "git-diff" ||
                  surface === "git-graph" ||
                  surface === "docs-preview" ||
                  surface === "browser-preview" ||
                  surface === "database-result" ||
                  surface === "debug-console"
                    ? " editor-content"
                    : ""
                }`}
              >
              {showEditor ? (
                <>
                  <div className="editor-toolbar">
                    <span className="path-label mono">
                      {activeEditorTab?.path ?? "No file open"}
                    </span>
                    <button
                      type="button"
                      className="btn"
                      disabled={
                        !showLoadedEditor ||
                        (loadedFile?.readOnly ?? true) ||
                        !activeEditorTab?.dirty
                      }
                      onClick={() => void saveActiveFile()}
                    >
                      <Save aria-hidden="true" />
                      Save
                    </button>
                  </div>

                  {editorError ? (
                    <div className="large-file-note">{editorError}</div>
                  ) : !activeEditorTab ? (
                    <div className="large-file-note">No file open</div>
                  ) : !showLoadedEditor ? (
                    <div className="editor-loading">Loading editor</div>
                  ) : loadedFile!.readOnly ? (
                    <div className="large-file-note">
                      This file is too large to edit. It was opened read-only.
                    </div>
                  ) : (
                    <Suspense
                      fallback={
                        <div className="editor-loading">Loading editor</div>
                      }
                    >
                      <EditorTab
                        workspaceId={activeWorkspaceId ?? ""}
                        filePath={loadedFile!.path}
                        content={loadedFile!.content}
                        language={loadedFile!.language}
                        readOnly={loadedFile!.readOnly}
                        diagnostics={activeFileDiagnostics}
                        findOpen={findOpen}
                        findFocusRequest={findFocusRequest}
                        findQuery={findQuery}
                        onFindQueryChange={setFindQuery}
                        onContentChange={handleEditorContentChange}
                        onHover={onLanguageHover}
                        onGoToDefinition={onLanguageGoToDefinition}
                        onReferences={onLanguageReferences}
                        onCompletion={onLanguageCompletion}
                        onCodeActions={onLanguageCodeActions}
                        onRename={onLanguageRename}
                        debugBreakpoints={activeDebugBreakpoints}
                        activeDebugLine={activeDebugLine}
                        onToggleBreakpoint={toggleLoadedFileBreakpoint}
                        onDirtyChange={() => undefined}
                      />
                    </Suspense>
                  )}
                </>
              ) : surface === "terminal" ? (
                <div className="terminal-surface">
                  {activeTerminal ? (
                    <>
                      <div className="term-tabs" role="tablist">
                        {terminalSessions.map((session) => {
                          const selected = session.id === activeTerminal.id;

                          return (
                            <button
                              type="button"
                              className={`tt${selected ? " active" : ""}`}
                              role="tab"
                              aria-selected={selected}
                              title={session.cwd}
                              key={session.id}
                              onClick={() => activateTerminalById(session.id)}
                            >
                              <SquareTerminal aria-hidden="true" />
                              <span className="tt-label">{session.name}</span>
                            </button>
                          );
                        })}
                        <div className="term-tabs-spacer" />
                        <button
                          type="button"
                          className="iconbtn"
                          title="New terminal"
                          aria-label="New terminal"
                          onClick={() => void newTerminal()}
                        >
                          <Plus aria-hidden="true" />
                        </button>
                      </div>
                      {terminalError ? (
                        <div className="terminal-inline-error" role="alert">
                          {terminalError}
                        </div>
                      ) : null}
                      <Suspense
                        fallback={
                          <div className="editor-loading">
                            Loading terminal
                          </div>
                        }
                      >
                        <TerminalTab
                          key={activeTerminal.id}
                          sessionId={activeTerminal.id}
                          onInput={writeTerminalInput}
                        />
                      </Suspense>
                    </>
                  ) : (
                    <div className="terminal-empty-state">
                      <SquareTerminal aria-hidden="true" />
                      <span>No terminal sessions</span>
                      {terminalError ? (
                        <div className="terminal-inline-error" role="alert">
                          {terminalError}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => void newTerminal()}
                      >
                        <Play aria-hidden="true" />
                        Start terminal
                      </button>
                    </div>
                  )}
                </div>
              ) : surface === "ssh-terminal" ? (
                <SshTerminalSurface
                  state={view.remote}
                  onActivate={(sessionId) =>
                    updateRemote(activeWorkspaceId, (remote) => ({
                      ...remote,
                      activeSshSessionId: sessionId,
                    }))
                  }
                  onInput={writeSshInput}
                  onNewTerminal={() => void openSshForHost()}
                  onClose={(sessionId) => void closeSshById(sessionId)}
                />
              ) : surface === "sftp-browser" ? (
                <div className="terminal-surface">
                  <RemotePanel
                    state={{ ...view.remote, mode: "sftp" }}
                    onModeChange={setRemoteWorkbenchMode}
                    onSelectHost={selectRemoteHostById}
                    onRefresh={refreshRemoteHosts}
                    onCreateHost={() => void createRemoteHostFromPrompt()}
                    onConnectHost={(hostId) => void connectActiveRemoteHost(hostId)}
                    onOpenSsh={(hostId) => void openSshForHost(hostId)}
                    onOpenSftp={(hostId) => openSftpForHost(hostId)}
                    onRunCommand={runActiveRemoteCommand}
                    onCommandDraftChange={updateRemoteCommandDraft}
                    onListSftpDirectory={(hostId, path) =>
                      void listRemoteDirectory(hostId, path)
                    }
                    onDownloadFile={(path) => void downloadRemoteFile(path)}
                    onUploadFile={(path) => void uploadRemoteFile(path)}
                  />
                </div>
              ) : surface === "git-diff" ? (
                <GitDiffView
                  diff={selectedGitDiff}
                  selectedPath={view.git.selectedDiff?.path ?? null}
                  loading={view.git.loading}
                  error={view.git.error}
                  onRefresh={() => {
                    const selection = workspaceViewStore
                      .getState()
                      .viewFor(activeWorkspaceId).git.selectedDiff;

                    if (selection) {
                      void loadGitDiff(selection.path, selection.staged);
                    }
                  }}
                />
              ) : surface === "git-graph" ? (
                <GitGraphView
                  graph={view.git.graph}
                  branchLabel={statusBranchLabel(view.git.status)}
                  loading={view.git.loading}
                  error={view.git.error}
                  onFetch={fetchFromGitPanel}
                  onRefresh={() => void loadGitGraph()}
                />
              ) : surface === "docs-preview" ? (
                <MarkdownPreview
                  preview={activeDocsPreview}
                  selectedPath={activeDocsPreviewPath}
                  loading={
                    activeDocsPreviewPath !== null &&
                    activeDocsPreview === null &&
                    view.docs.error === null
                  }
                  error={view.docs.error}
                  onRefresh={() => {
                    if (activeDocsPreviewPath) {
                      void openDocsPreview(activeDocsPreviewPath);
                    }
                  }}
                />
              ) : surface === "browser-preview" ? (
                <BrowserPreviewSplitSurface
                  showEditor={splitBrowserSurface}
                  editor={
                    activeEditorTab && splitBrowserSurface ? (
                      <Suspense
                        fallback={<div className="editor-loading">Loading editor</div>}
                      >
                        <EditorTab
                          workspaceId={activeWorkspaceId ?? ""}
                          filePath={loadedFile!.path}
                          content={loadedFile!.content}
                          language={loadedFile!.language}
                          readOnly={loadedFile!.readOnly}
                          diagnostics={activeFileDiagnostics}
                          findOpen={findOpen}
                          findFocusRequest={findFocusRequest}
                          findQuery={findQuery}
                          onFindQueryChange={setFindQuery}
                          onContentChange={handleEditorContentChange}
                          onHover={onLanguageHover}
                          onGoToDefinition={onLanguageGoToDefinition}
                          onReferences={onLanguageReferences}
                          onCompletion={onLanguageCompletion}
                          onCodeActions={onLanguageCodeActions}
                          onRename={onLanguageRename}
                          debugBreakpoints={activeDebugBreakpoints}
                          activeDebugLine={activeDebugLine}
                          onToggleBreakpoint={toggleLoadedFileBreakpoint}
                          onDirtyChange={() => undefined}
                        />
                      </Suspense>
                    ) : null
                  }
                  preview={
                    <BrowserPreviewSurface
                      workspaceId={activeWorkspaceId}
                      url={view.browser.activeUrl}
                      title={view.browser.activeTitle}
                      reloadVersion={view.browser.reloadVersion}
                      hardReloadVersion={view.browser.hardReloadVersion}
                      onBoundsChange={(bounds) =>
                        updateBrowser(activeWorkspaceId, (browser) =>
                          updateBrowserBounds(browser, bounds),
                        )
                      }
                      onError={(message) =>
                        updateBrowser(activeWorkspaceId, (browser) =>
                          setBrowserError(browser, message),
                        )
                      }
                    />
                  }
                />
              ) : surface === "database-result" ? (
                <DatabaseResultView
                  result={view.database.activeResult}
                  loading={view.database.loading}
                  error={view.database.error}
                />
              ) : surface === "debug-console" ? (
                <DebugConsoleSurface
                  session={activeDebugSession}
                  consoleText={activeDebugOutput}
                  onContinue={continueDebugById}
                  onStepOver={stepOverDebugById}
                  onPause={pauseDebugById}
                  onDisconnect={disconnectDebugById}
                />
              ) : (
                <>
                  <div className="workspace-hero">
                    <div>
                      <span className="eyebrow">Node 0 workspace shell</span>
                      <h1>{activeWorkspace?.name ?? "Yuuzu IDE"}</h1>
                      <p className="mono">
                        {activeWorkspace?.path ??
                          "Waiting for the Tauri workspace registry"}
                      </p>
                    </div>
                    <div className="hero-actions">
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => setSurface("editor")}
                      >
                        <Play aria-hidden="true" />
                        Open editor
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setSurface("terminal");
                          setActiveActivity("terminal");
                        }}
                      >
                        <SquareTerminal aria-hidden="true" />
                        Open terminal
                      </button>
                    </div>
                  </div>

                  <div className="control-grid">
                    <section>
                      <div className="section-label">
                        <span>Open controls</span>
                      </div>
                      {[
                        "Explorer persisted",
                        "Registry persisted",
                        "Rust invoke ready",
                      ].map((item) => (
                        <div className="row" key={item}>
                          <span className="tw">•</span>
                          <span className="nm">{item}</span>
                          <span className="meta">ok</span>
                        </div>
                      ))}
                    </section>
                    <section>
                      <div className="section-label">
                        <span>Workspace registry</span>
                      </div>
                      {registry.workspaces.map((workspace) => (
                        <div className="row" key={workspace.id}>
                          <GitBranch aria-hidden="true" />
                          <span className="nm">{workspace.name}</span>
                          <span className="meta">
                            {workspace.id === registry.active_workspace_id
                              ? "active"
                              : "idle"}
                          </span>
                        </div>
                      ))}
                    </section>
                  </div>
                </>
              )}
            </div>
          </section>
        </main>
      </div>

      <footer className="statusbar">
        <div className="sb accent">
          <GitBranch aria-hidden="true" />
          main
        </div>
        <div className="sb">registry {registry.workspaces.length}</div>
        <div className="sb">tasks {view.task.runs.length}</div>
        <div className="sb">problems {activeTaskProblems.length}</div>
        {languageDiagnosticBadge ? (
          <div className="sb">diagnostics {languageDiagnosticBadge}</div>
        ) : null}
        {view.diagnostics.metric ? (
          <>
            <div className="sb">
              mem {formatBytes(view.diagnostics.metric.memory_bytes)}
            </div>
            <div className="sb">
              docs {view.diagnostics.metric.docs_index_entries}
            </div>
          </>
        ) : null}
        <div className="sb-spacer" />
        <div className="sb">
          <span className="live" />
          tauri
        </div>
        <div className="sb">TypeScript</div>
        <div className="sb">
          <Bell aria-hidden="true" />
        </div>
      </footer>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onRun={runCommand}
        commands={commandPaletteCommands}
      />
      {gitConfirmation ? (
        <div className="git-confirm-backdrop">
          <div
            className="git-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="git-confirm-title"
          >
            <div>
              <h2 id="git-confirm-title">{gitConfirmation.title}</h2>
              <p>{gitConfirmation.detail}</p>
            </div>
            <div className="git-confirm-danger">
              Type <span className="mono">{gitConfirmationText}</span> to
              continue.
            </div>
            <input
              className="input2 mono"
              value={gitConfirmationInput}
              aria-label="Git confirmation text"
              autoFocus
              onChange={(event) => setGitConfirmationInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  closeGitConfirmation();
                }
                if (event.key === "Enter" && gitConfirmationReady) {
                  void confirmGitAction();
                }
              }}
            />
            <div className="git-confirm-actions">
              <button
                type="button"
                className="btn"
                onClick={closeGitConfirmation}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!gitConfirmationReady}
                onClick={() => void confirmGitAction()}
              >
                Run
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
