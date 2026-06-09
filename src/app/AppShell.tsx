import { listen } from "@tauri-apps/api/event";
import {
  Bell,
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
  commitGit,
  discardGitPaths,
  getGitStatus,
  stageGitPaths,
  stashGit,
  unstageGitPaths,
} from "../features/git/git-api";
import { GitPanel } from "../features/git/GitPanel";
import {
  changeBadgeCount,
  confirmationTextForGitAction,
  replaceGitStatus,
  selectDiff,
  setGitError,
  setGitLoading,
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
  isSameOrDescendant,
  parentNameFromPath,
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
  database: "Database",
  settings: "Settings",
};

function languageForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) return "javascript";
  if (lower.endsWith(".rs")) return "rust";
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

function PanelBody({
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
  onGitOpenGraph,
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
  onGitOpenGraph: () => void;
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

  if (active !== "explorer") {
    return (
      <div className="panel-empty">
        <span>{panelTitles[active]}</span>
      </div>
    );
  }

  return (
    <FileTreePanel
      refreshKey={refreshKey}
      activeFilePath={activeFilePath}
      onOpenFile={onOpenFile}
      onCreateFile={onCreateFile}
      onRenamePath={onRenamePath}
      onDeletePath={onDeletePath}
    />
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
  const savedContentByPathRef = useRef<Record<string, string>>({});
  const openRequestRef = useRef(0);
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

  const activeWorkspace = useMemo(
    () =>
      registry.workspaces.find(
        (workspace) => workspace.id === activeWorkspaceId,
      ),
    [activeWorkspaceId, registry.workspaces],
  );
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

  useEffect(() => {
    setFindOpen(false);
    setFindFocusRequest(0);
    setFindQuery("");
    setTerminalError(null);
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

        updateTask(workspaceId, (task) => replaceTaskRuns(task, runs));
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
        language: languageForPath(path),
        readOnly: read.too_large,
      });
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

    const result = await renamePath(activeWorkspace.path, path, newName);
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

  async function refreshGitStatus(label = "Refresh") {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    updateGit(workspaceId, (git) => setGitLoading(setGitError(git, null), true));

    try {
      const status = await getGitStatus(workspaceRoot);
      updateGit(workspaceId, (git) => replaceGitStatus(git, status));
    } catch (error) {
      updateGit(workspaceId, (git) =>
        setGitError(git, `${label} failed: ${terminalErrorMessage(error)}`),
      );
    }
  }

  async function runGitStatusMutation(
    label: string,
    mutation: (workspaceRoot: string) => Promise<GitRepositoryStatus>,
  ) {
    if (!activeWorkspace || !activeWorkspaceId) {
      return;
    }

    const workspaceId = activeWorkspaceId;
    const workspaceRoot = activeWorkspace.path;
    updateGit(workspaceId, (git) => setGitLoading(setGitError(git, null), true));

    try {
      const status = await mutation(workspaceRoot);
      updateGit(workspaceId, (git) => replaceGitStatus(git, status));
    } catch (error) {
      updateGit(workspaceId, (git) =>
        setGitError(git, `${label} failed: ${terminalErrorMessage(error)}`),
      );
    }
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
    void runGitStatusMutation("Discard", (workspaceRoot) =>
      discardGitPaths(
        workspaceRoot,
        [path],
        confirmationTextForGitAction({ kind: "discard", paths: [path] }),
      ),
    );
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

  function openGitDiff(path: string, staged: boolean) {
    updateGit(activeWorkspaceId, (git) => selectDiff(git, { path, staged }));
    setSurface("git-diff");
    setActiveActivity("git");
  }

  function openGitGraph() {
    setSurface("git-graph");
    setActiveActivity("git");
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
      case "toggle-sidebar":
        setPanelOpen(!panelOpen);
        break;
      case "open-settings":
        setActiveActivity("settings");
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
          badges={{ git: changeBadgeCount(view.git.status) }}
          onSelect={setActiveActivity}
        />
        {panelOpen ? (
          <aside className="panel">
            {activeActivity === "git" ? null : (
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
              onGitOpenGraph={openGitGraph}
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
                    : surface === "editor"
                      ? "No file open"
                      : "Start"}
              </span>
            </div>

            <div
              className={`group-content${
                showEditor || surface === "terminal"
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
                        findOpen={findOpen}
                        findFocusRequest={findFocusRequest}
                        findQuery={findQuery}
                        onFindQueryChange={setFindQuery}
                        onContentChange={handleEditorContentChange}
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
                <div className="large-file-note">
                  {view.git.selectedDiff
                    ? `${
                        view.git.selectedDiff.staged ? "Staged" : "Changes"
                      } diff selected: ${view.git.selectedDiff.path}`
                    : "No Git diff selected"}
                </div>
              ) : surface === "git-graph" ? (
                <div className="large-file-note">Git graph view</div>
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
    </div>
  );
}
