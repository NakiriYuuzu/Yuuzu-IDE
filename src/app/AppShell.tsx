import {
  Bell,
  ChevronDown,
  FileCode2,
  GitBranch,
  PanelLeft,
  Play,
  Plus,
  RotateCw,
  SplitSquareHorizontal,
  SquareTerminal,
  X,
} from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";

import { ActivityRail, type ActivityId } from "./activity-rail";
import { CommandPalette } from "./CommandPalette";
import {
  createTextFile,
  deletePath,
  renamePath,
} from "../features/files/file-api";
import {
  closeFileTab,
  openFileTab,
  type FileVersion,
} from "../features/files/file-model";
import {
  editorTabForPath,
  fileIconClassFromName,
  parentNameFromPath,
  removeEditorPath,
  renameEditorPath,
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
  const activeEditorIconClass = fileIconClassFromName(activeEditorName);
  const showEditor = surface === "editor" && activeEditorTab !== null;

  function openFile(path: string, version: FileVersion | null = null) {
    updateEditor(activeWorkspaceId, (editor) =>
      openFileTab(editor, editorTabForPath(path, version)),
    );
    setSurface("editor");
  }

  async function createFileFromExplorer(relativePath: string) {
    if (!activeWorkspace) {
      return;
    }

    const result = await createTextFile(activeWorkspace.path, relativePath);
    openFile(result.path, result.version);
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
    updateEditor(activeWorkspaceId, (editor) => removeEditorPath(editor, path));
    if (nextSurface !== currentView.surface) {
      updateView(activeWorkspaceId, { surface: nextSurface });
    }
    setFileTreeRefreshKey((value) => value + 1);
  }

  function closeActiveEditor() {
    if (!activeEditorTab) {
      setSurface("empty");
      return;
    }

    const nextEditor = closeFileTab(view.editor, activeEditorTab.path);
    updateEditor(activeWorkspaceId, () => nextEditor);
    if (!nextEditor.activePath) {
      setSurface("empty");
    }
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
              {showEditor ? (
                <div className="tab active">
                  <FileCode2
                    className={`ftype ${activeEditorIconClass}`}
                    aria-hidden="true"
                  />
                  <span className="tlabel mono">{activeEditorName}</span>
                  <button
                    type="button"
                    className="close"
                    title="Close editor"
                    aria-label="Close editor"
                    onClick={closeActiveEditor}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              ) : null}
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
              <span className="crumb">src</span>
              <ChevronDown aria-hidden="true" />
              <span className="crumb">
                {showEditor
                  ? activeEditorParent
                  : surface === "terminal"
                    ? "terminal"
                    : "app"}
              </span>
              <ChevronDown aria-hidden="true" />
              <span className="crumb">
                {showEditor
                  ? activeEditorName
                  : surface === "terminal"
                    ? "shell"
                    : "AppShell.tsx"}
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
                <Suspense
                  fallback={<div className="editor-loading">Loading editor</div>}
                >
                  <EditorTab />
                </Suspense>
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
