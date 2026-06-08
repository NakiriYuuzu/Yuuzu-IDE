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
  X,
} from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";

import { ActivityRail, type ActivityId } from "./activity-rail";
import { FileTreePanel } from "../features/workspace/FileTreePanel";
import { useWorkspaceStore } from "./workspace-store";
import { WorkspaceSwitcher } from "./workspace-switcher";

const EditorTab = lazy(() =>
  import("../features/editor/EditorTab").then((module) => ({
    default: module.EditorTab,
  })),
);

type Surface = "empty" | "editor";

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
}: {
  active: ActivityId;
  refreshKey: number;
}) {
  if (active !== "explorer") {
    return (
      <div className="panel-empty">
        <span>{panelTitles[active]}</span>
      </div>
    );
  }

  return <FileTreePanel refreshKey={refreshKey} />;
}

export function AppShell() {
  const [activeActivity, setActiveActivity] =
    useState<ActivityId>("explorer");
  const [panelOpen, setPanelOpen] = useState(true);
  const [fileTreeRefreshKey, setFileTreeRefreshKey] = useState(0);
  const [surface, setSurface] = useState<Surface>("empty");
  const registry = useWorkspaceStore((state) => state.registry);

  const activeWorkspace = useMemo(
    () =>
      registry.workspaces.find(
        (workspace) => workspace.id === registry.active_workspace_id,
      ),
    [registry],
  );

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
        <button type="button" className="kbd">
          Search or run a command <kbd>⌘K</kbd>
        </button>
        <div className="tb-actions">
          <button
            type="button"
            className={`iconbtn${panelOpen ? " on" : ""}`}
            title="Toggle sidebar"
            aria-label="Toggle sidebar"
            onClick={() => setPanelOpen((value) => !value)}
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
                <button type="button" className="iconbtn" title="New item">
                  <Plus aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="iconbtn"
                  title="Refresh"
                  onClick={() => setFileTreeRefreshKey((value) => value + 1)}
                >
                  <RotateCw aria-hidden="true" />
                </button>
              </div>
            </div>
            <PanelBody
              active={activeActivity}
              refreshKey={fileTreeRefreshKey}
            />
          </aside>
        ) : null}

        <main className="editor-region">
          <section className="group focus">
            <div className="tabstrip">
              {surface === "editor" ? (
                <div className="tab active">
                  <FileCode2 className="ftype ico-ts" aria-hidden="true" />
                  <span className="tlabel mono">server.ts</span>
                  <button
                    type="button"
                    className="close"
                    title="Close editor"
                    aria-label="Close editor"
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
              </div>
            </div>

            <div className="breadcrumb">
              <span className="crumb">src</span>
              <ChevronDown aria-hidden="true" />
              <span className="crumb">
                {surface === "editor" ? "features" : "app"}
              </span>
              <ChevronDown aria-hidden="true" />
              <span className="crumb">
                {surface === "editor" ? "server.ts" : "AppShell.tsx"}
              </span>
            </div>

            <div
              className={`group-content${
                surface === "editor" ? " editor-content" : ""
              }`}
            >
              {surface === "editor" ? (
                <Suspense
                  fallback={<div className="editor-loading">Loading editor</div>}
                >
                  <EditorTab />
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
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => setSurface("editor")}
                    >
                      <Play aria-hidden="true" />
                      Open editor
                    </button>
                  </div>

                  <div className="control-grid">
                    <section>
                      <div className="section-label">
                        <span>Open controls</span>
                      </div>
                      {[
                        "Explorer seeded",
                        "Registry transient",
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
    </div>
  );
}
