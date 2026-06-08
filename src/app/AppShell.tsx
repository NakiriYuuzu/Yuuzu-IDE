import {
  Bell,
  ChevronDown,
  Code2,
  FileCode2,
  GitBranch,
  PanelLeft,
  Play,
  Plus,
  RotateCw,
  SplitSquareHorizontal,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ActivityRail, type ActivityId } from "./activity-rail";
import { useWorkspaceStore } from "./workspace-store";
import { WorkspaceSwitcher } from "./workspace-switcher";

const panelTitles: Record<ActivityId, string> = {
  explorer: "Explorer",
  search: "Search",
  git: "Source Control",
  terminal: "Terminal",
  database: "Database",
  settings: "Settings",
};

const explorerRows = [
  { name: "src", kind: "folder", depth: 0 },
  { name: "app", kind: "folder", depth: 1 },
  { name: "AppShell.tsx", kind: "tsx", depth: 2, selected: true },
  { name: "workspace-switcher.tsx", kind: "tsx", depth: 2 },
  { name: "features", kind: "folder", depth: 1 },
  { name: "workspace-api.ts", kind: "ts", depth: 2 },
  { name: "src-tauri", kind: "folder", depth: 0 },
  { name: "workspace.rs", kind: "rs", depth: 1 },
];

function PanelBody({ active }: { active: ActivityId }) {
  if (active !== "explorer") {
    return (
      <div className="panel-empty">
        <span>{panelTitles[active]}</span>
      </div>
    );
  }

  return (
    <div className="panel-body">
      <div className="section-label">
        <span>Yuuzu IDE</span>
        <ChevronDown aria-hidden="true" />
      </div>
      {explorerRows.map((row) => (
        <div
          className={`row${row.selected ? " sel" : ""}`}
          key={`${row.name}-${row.depth}`}
          style={{ paddingLeft: 8 + row.depth * 13 }}
        >
          <span className="tw">{row.kind === "folder" ? "▾" : ""}</span>
          <FileCode2 className={`ico-${row.kind}`} aria-hidden="true" />
          <span className="nm mono">{row.name}</span>
          {row.selected ? <span className="meta">open</span> : null}
        </div>
      ))}
      <div className="section-label">
        <span>Outline</span>
      </div>
      {["WorkspaceSwitcher", "ActivityRail", "AppShell"].map((name) => (
        <div className="row" key={name} style={{ paddingLeft: 12 }}>
          <Code2 aria-hidden="true" />
          <span className="nm mono">{name}</span>
        </div>
      ))}
    </div>
  );
}

export function AppShell() {
  const [activeActivity, setActiveActivity] =
    useState<ActivityId>("explorer");
  const [panelOpen, setPanelOpen] = useState(true);
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
                <button type="button" className="iconbtn" title="Refresh">
                  <RotateCw aria-hidden="true" />
                </button>
              </div>
            </div>
            <PanelBody active={activeActivity} />
          </aside>
        ) : null}

        <main className="editor-region">
          <section className="group focus">
            <div className="tabstrip">
              <div className="tab active">
                <FileCode2 className="ftype ico-tsx" aria-hidden="true" />
                <span className="tlabel mono">AppShell.tsx</span>
                <span className="close">
                  <X aria-hidden="true" />
                </span>
              </div>
              <div className="tab">
                <FileCode2 className="ftype ico-ts" aria-hidden="true" />
                <span className="tlabel mono">workspace-api.ts</span>
              </div>
              <div className="tabstrip-tail">
                <button type="button" className="iconbtn" title="New tab">
                  <Plus aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="breadcrumb">
              <span className="crumb">src</span>
              <ChevronDown aria-hidden="true" />
              <span className="crumb">app</span>
              <ChevronDown aria-hidden="true" />
              <span className="crumb">AppShell.tsx</span>
            </div>

            <div className="group-content">
              <div className="workspace-hero">
                <div>
                  <span className="eyebrow">Node 0 workspace shell</span>
                  <h1>{activeWorkspace?.name ?? "Yuuzu IDE"}</h1>
                  <p className="mono">
                    {activeWorkspace?.path ??
                      "Waiting for the Tauri workspace registry"}
                  </p>
                </div>
                <button type="button" className="btn primary">
                  <Play aria-hidden="true" />
                  Start session
                </button>
              </div>

              <div className="control-grid">
                <section>
                  <div className="section-label">
                    <span>Open controls</span>
                  </div>
                  {["Explorer seeded", "Registry transient", "Rust invoke ready"].map(
                    (item) => (
                      <div className="row" key={item}>
                        <span className="tw">•</span>
                        <span className="nm">{item}</span>
                        <span className="meta">ok</span>
                      </div>
                    ),
                  )}
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
