import { listen } from "@tauri-apps/api/event";
import {
  Bell,
  BookOpenText,
  ChevronDown,
  FileCode2,
  GitBranch,
  PanelLeft,
  Play,
  Plus,
  RotateCw,
  Save,
  SplitSquareHorizontal,
  SquareTerminal,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { ActivityRail, type ActivityId } from "./activity-rail";
import { CommandPalette } from "./CommandPalette";
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
  appendTerminalOutput,
  bufferTerminalExit,
  bufferTerminalOutput,
  closeTerminal,
  markTerminalExited,
  type TerminalSessionInfo,
  upsertTerminal,
} from "../features/terminal/terminal-model";
import {
  useWorkspaceViewStore,
  workspaceViewStore,
  type Surface,
} from "./workspace-view-state";
import { useWorkspaceStore, workspaceStore } from "./workspace-store";
import { WorkspaceSwitcher } from "./workspace-switcher";

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
  terminal: "Terminal",
  tasks: "Tasks",
  docs: "Docs",
  language: "Language",
  agents: "Agents",
  database: "Database",
  settings: "Settings",
};

export type AgentAvailableContextSource = {
  workspaceRoot: string;
  loadedFile: LoadedFile | null;
  docsPreviews: Array<
    Pick<DocPreview, "path" | "title" | "content">
  >;
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

export function collectAgentAvailableContext(
  source: AgentAvailableContextSource,
): AgentContextItem[] {
  const context: AgentContextItem[] = [];

  if (source.loadedFile) {
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

  return context;
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

function knownWorkspaceIdForTerminal(sessionId: string): string | null {
  const { views } = workspaceViewStore.getState();
  const match = Object.entries(views).find(([, workspaceView]) =>
    workspaceView.terminal.sessions.some((session) => session.id === sessionId),
  );

  return match?.[0] ?? workspaceIdFromTerminalSessionId(sessionId);
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
  languageState,
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
  languageState: LanguageViewState;
}) {
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
  const docsLoadRequestRef = useRef<DocsLoadRequestState>({});
  const agentSessionsLoadRef = useRef<Record<string, number>>({});
  const languageRefreshRequestRef = useRef<LanguageRefreshRequestState>({});
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
  const activeTerminalOutput = activeTerminal
    ? (view.terminal.outputBySessionId[activeTerminal.id] ?? "")
    : "";
  const activeTerminalName = activeTerminal?.name ?? "terminal";
  const activeTaskRun =
    view.task.runs.find((run) => run.id === view.task.activeRunId) ??
    view.task.runs[0] ??
    null;
  const activeTaskProblems = activeTaskRun
    ? (view.task.problemsByRunId[activeTaskRun.id] ?? [])
    : [];
  const languageDiagnosticBadge = selectDiagnosticBadge(view.language);
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

  const activeWorkspace = useMemo(
    () =>
      registry.workspaces.find(
        (workspace) => workspace.id === activeWorkspaceId,
      ),
    [activeWorkspaceId, registry.workspaces],
  );
  const activeLspDocumentPath =
    activeWorkspace && loadedFile
      ? lspDocumentPathForWorkspace(activeWorkspace.path, loadedFile.path)
      : null;
  const activeFileDiagnostics = activeLspDocumentPath
    ? diagnosticsForPath(view.language, activeLspDocumentPath)
    : [];
  const activeEditorTab =
    view.editor.tabs.find((tab) => tab.path === view.editor.activePath) ?? null;
  const activeEditorName = activeEditorTab?.name ?? "";
  const activeEditorParent = activeEditorTab
    ? parentNameFromPath(activeEditorTab.path)
    : "";
  const showEditor = surface === "editor";
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
        loadedFile,
        docsPreviews,
        selectedDiff: selectedGitDiff,
        activeFileDiagnostics,
        terminalSession: activeTerminal,
        terminalOutput: activeTerminalOutput,
      }),
    [
      activeWorkspace?.path,
      loadedFile,
      docsPreviews,
      selectedGitDiff,
      activeFileDiagnostics,
      activeTerminal,
      activeTerminalOutput,
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
    let disposed = false;
    const outputUnlisten = onTerminalOutput((event) => {
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
            appendTerminalOutput(terminal, event.session_id, event.chunk),
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
          bufferTerminalOutput(terminal, event.session_id, event.chunk),
        );
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
    } else {
      tryClearDraft(activeWorkspaceId, loadedFile.path);
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

  function runCommand(id: string) {
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
        setActiveActivity("settings");
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
          }}
          onSelect={setActiveActivity}
        />
        {panelOpen ? (
          <aside className="panel">
            {activeActivity === "git" ||
            activeActivity === "docs" ||
            activeActivity === "language" ? null : (
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
              languageState={view.language}
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
                    : surface === "docs-preview"
                      ? "docs"
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
                    : surface === "docs-preview"
                      ? docsPreviewPathLabel(view.docs, "Preview")
                    : surface === "editor"
                      ? "No file open"
                      : "Start"}
              </span>
            </div>

            <div
              className={`group-content${
                showEditor ||
                surface === "terminal" ||
                surface === "git-diff" ||
                surface === "git-graph" ||
                surface === "docs-preview"
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
                          output={activeTerminalOutput}
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
