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
  writeTextFile,
} from "../features/files/file-api";
import {
  clearDraft,
  createDraftKey,
  loadDraft,
  saveDraft,
} from "../features/files/draft-store";
import {
  applySavedVersion,
  closeFileTab,
  markFileDirty,
  openFileTab,
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
import {
  useWorkspaceViewStore,
  workspaceViewStore,
  type Surface,
} from "./workspace-view-state";
import { useWorkspaceStore } from "./workspace-store";
import { WorkspaceSwitcher } from "./workspace-switcher";

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

function PanelBody({
  active,
  refreshKey,
  activeFilePath,
  onOpenFile,
  onCreateFile,
  onRenamePath,
  onDeletePath,
}: {
  active: ActivityId;
  refreshKey: number;
  activeFilePath: string | null;
  onOpenFile: (path: string) => void;
  onCreateFile: (relativePath: string) => Promise<void>;
  onRenamePath: (path: string, newName: string) => Promise<void>;
  onDeletePath: (path: string) => Promise<void>;
}) {
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

  function setActiveActivity(activeActivity: ActivityId) {
    updateView(activeWorkspaceId, { activeActivity });
  }

  function setPanelOpen(panelOpen: boolean) {
    updateView(activeWorkspaceId, { panelOpen });
  }

  function setSurface(surface: Surface) {
    updateView(activeWorkspaceId, { surface });
  }

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

  function runCommand(id: string) {
    switch (id) {
      case "open-editor":
        setSurface("editor");
        break;
      case "open-terminal":
        setSurface("terminal");
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
        <ActivityRail active={activeActivity} onSelect={setActiveActivity} />
        {panelOpen ? (
          <aside className="panel">
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
            <PanelBody
              active={activeActivity}
              refreshKey={fileTreeRefreshKey}
              activeFilePath={view.editor.activePath}
              onOpenFile={openFile}
              onCreateFile={createFileFromExplorer}
              onRenamePath={renamePathFromExplorer}
              onDeletePath={deletePathFromExplorer}
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
                    className={`tab${isActive ? " active" : ""}`}
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
                <div className="tab active">
                  <SquareTerminal className="ftype" aria-hidden="true" />
                  <span className="tlabel mono">terminal</span>
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
                  onClick={() => setSurface("terminal")}
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
                    ? "shell"
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
                        onContentChange={handleEditorContentChange}
                        onDirtyChange={() => undefined}
                      />
                    </Suspense>
                  )}
                </>
              ) : surface === "terminal" ? (
                <Suspense
                  fallback={
                    <div className="editor-loading">Loading terminal</div>
                  }
                >
                  <TerminalTab />
                </Suspense>
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
                        onClick={() => setSurface("terminal")}
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
