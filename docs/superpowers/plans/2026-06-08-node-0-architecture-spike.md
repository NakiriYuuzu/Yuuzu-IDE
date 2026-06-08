# Node 0 Architecture Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a measurable Tauri 2 + Vite + React + shadcn architecture spike that proves Yuuzu-IDE can run a multi-workspace shell with one main WebView and Rust-owned core services.

**Architecture:** Tauri owns the native desktop process and Rust core. React renders the workbench inside one main WebView. Rust commands expose workspace registry, file tree scanning, and PTY lifecycle; React consumes bounded payloads and lazy-loads Monaco/xterm only when their surfaces open.

**Tech Stack:** Tauri 2, Rust, Tokio, Vite, React, TypeScript, shadcn/ui, Tailwind CSS, Monaco Editor, xterm.js, portable-pty, serde, tracing.

---

## Current Workspace Notes

- Current directory: `/Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide`
- Current workspace is not a git repository. Task 1 initializes git so later task commit steps are valid.
- Existing docs to preserve:
  - `roadmap.md`
  - `docs/architecture/tech-stack.md`
  - `docs/ui-design/**`

## File Structure

After this plan, the repository should have this high-level shape:

```txt
.
├── .gitignore
├── package.json
├── bun.lock
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── components.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── app/
│   │   ├── AppShell.tsx
│   │   ├── activity-rail.tsx
│   │   ├── command-palette.tsx
│   │   ├── workspace-switcher.tsx
│   │   └── workspace-store.ts
│   ├── components/
│   │   └── ui/
│   │       ├── button.tsx
│   │       ├── dialog.tsx
│   │       ├── input.tsx
│   │       ├── scroll-area.tsx
│   │       └── separator.tsx
│   ├── features/
│   │   ├── editor/
│   │   │   ├── EditorTab.tsx
│   │   │   └── load-monaco.ts
│   │   ├── terminal/
│   │   │   ├── TerminalTab.tsx
│   │   │   └── load-xterm.ts
│   │   └── workspace/
│   │       ├── FileTreePanel.tsx
│   │       └── workspace-api.ts
│   └── lib/
│       ├── tauri.ts
│       └── utils.ts
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── commands.rs
│       ├── metrics.rs
│       ├── pty.rs
│       ├── workspace.rs
│       └── workspace_scan.rs
├── scripts/
│   └── measure-node0.sh
└── docs/
    ├── architecture/
    │   └── tech-stack.md
    └── superpowers/
        └── plans/
            └── 2026-06-08-node-0-architecture-spike.md
```

## Task 1: Repository Baseline

**Files:**
- Create: `.gitignore`
- Modify: no product source files
- Test: shell checks only

- [ ] **Step 1: Initialize git repository**

Run:

```bash
git init
```

Expected: `.git/` is created and `git status --short` can run without `fatal: not a git repository`.

- [ ] **Step 2: Add generated-file ignore rules**

Create `.gitignore` with:

```gitignore
.DS_Store
node_modules/
dist/
target/
src-tauri/target/
.superpowers/
.vscode/
.idea/
*.log
```

- [ ] **Step 3: Verify docs are still visible**

Run:

```bash
test -f roadmap.md
test -f docs/architecture/tech-stack.md
test -f docs/superpowers/plans/2026-06-08-node-0-architecture-spike.md
```

Expected: all commands exit with code `0`.

- [ ] **Step 4: Commit baseline**

Run:

```bash
git add .gitignore roadmap.md docs/architecture/tech-stack.md docs/superpowers/plans/2026-06-08-node-0-architecture-spike.md
git commit -m "docs: define node 0 architecture spike"
```

Expected: commit succeeds.

## Task 2: Scaffold Tauri React App

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/index.css`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Test: `bun run build`, `bun run tauri build --debug`

- [ ] **Step 1: Scaffold Tauri app**

Run:

```bash
bun create tauri-app@latest .
```

When prompted, select:

```txt
Package manager: bun
Frontend language: TypeScript / JavaScript
Frontend framework: React
Frontend bundler: Vite
```

Expected: Tauri/Vite/React files are created in the current directory without removing existing `docs/` files.

- [ ] **Step 2: Install dependencies**

Run:

```bash
bun install
```

Expected: `bun.lock` exists and install finishes without dependency errors.

- [ ] **Step 3: Replace `src/App.tsx` with a minimal shell marker**

Use this content:

```tsx
export default function App() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Yuuzu-IDE</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Node 0 architecture spike
          </p>
        </div>
      </section>
    </main>
  )
}
```

- [ ] **Step 4: Run frontend build**

Run:

```bash
bun run build
```

Expected: Vite build completes and writes `dist/`.

- [ ] **Step 5: Run Tauri debug build**

Run:

```bash
bun run tauri build --debug
```

Expected: Rust and frontend builds complete. Debug bundle artifacts are generated under `src-tauri/target/`.

- [ ] **Step 6: Commit scaffold**

Run:

```bash
git add package.json bun.lock index.html vite.config.ts tsconfig.json tsconfig.node.json src src-tauri
git commit -m "feat: scaffold tauri react app"
```

Expected: commit succeeds.

## Task 3: Install shadcn UI Foundation

**Files:**
- Create: `components.json`
- Modify: `src/index.css`
- Modify: `src/lib/utils.ts`
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/dialog.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/scroll-area.tsx`
- Create: `src/components/ui/separator.tsx`
- Test: `bun run build`

- [ ] **Step 1: Initialize shadcn for Vite**

Run:

```bash
bunx shadcn@latest init -t vite
```

When prompted, select:

```txt
Style: New York
Base color: Neutral
CSS variables: yes
Icon library: lucide
```

Expected: `components.json`, Tailwind setup, and `src/lib/utils.ts` are created or updated.

- [ ] **Step 2: Add required UI components**

Run:

```bash
bunx shadcn@latest add button dialog input scroll-area separator
```

Expected: component files exist under `src/components/ui/`.

- [ ] **Step 3: Ensure `src/index.css` defines app-level sizing**

Confirm `src/index.css` contains:

```css
@import "tailwindcss";

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
}
```

If shadcn generated additional theme variables, keep them and add only the sizing rules above.

- [ ] **Step 4: Build after shadcn setup**

Run:

```bash
bun run build
```

Expected: build completes with no TypeScript or CSS errors.

- [ ] **Step 5: Commit UI foundation**

Run:

```bash
git add components.json src/index.css src/lib src/components
git commit -m "feat: add shadcn ui foundation"
```

Expected: commit succeeds.

## Task 4: Add Rust Workspace Registry Command

**Files:**
- Create: `src-tauri/src/workspace.rs`
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `cargo test --manifest-path src-tauri/Cargo.toml workspace`

- [ ] **Step 1: Add workspace model tests**

Create `src-tauri/src/workspace.rs` with:

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub pinned: bool,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceRegistry {
    pub active_workspace_id: Option<String>,
    pub workspaces: Vec<Workspace>,
}

impl WorkspaceRegistry {
    pub fn add_workspace(&mut self, workspace: Workspace) {
        if self.workspaces.iter().any(|item| item.id == workspace.id) {
            return;
        }

        if self.active_workspace_id.is_none() {
            self.active_workspace_id = Some(workspace.id.clone());
        }

        self.workspaces.push(workspace);
    }

    pub fn switch_workspace(&mut self, id: &str) -> bool {
        if self.workspaces.iter().any(|workspace| workspace.id == id) {
            self.active_workspace_id = Some(id.to_string());
            return true;
        }

        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace(id: &str, name: &str) -> Workspace {
        Workspace {
            id: id.to_string(),
            name: name.to_string(),
            path: PathBuf::from(format!("/tmp/{id}")),
            pinned: false,
        }
    }

    #[test]
    fn first_workspace_becomes_active() {
        let mut registry = WorkspaceRegistry::default();

        registry.add_workspace(workspace("api", "yuuzu-api"));

        assert_eq!(registry.active_workspace_id, Some("api".to_string()));
        assert_eq!(registry.workspaces.len(), 1);
    }

    #[test]
    fn duplicate_workspace_id_is_ignored() {
        let mut registry = WorkspaceRegistry::default();

        registry.add_workspace(workspace("api", "yuuzu-api"));
        registry.add_workspace(workspace("api", "duplicate"));

        assert_eq!(registry.workspaces.len(), 1);
        assert_eq!(registry.workspaces[0].name, "yuuzu-api");
    }

    #[test]
    fn switch_workspace_changes_active_workspace() {
        let mut registry = WorkspaceRegistry::default();
        registry.add_workspace(workspace("api", "yuuzu-api"));
        registry.add_workspace(workspace("web", "yuuzu-web"));

        assert!(registry.switch_workspace("web"));

        assert_eq!(registry.active_workspace_id, Some("web".to_string()));
    }

    #[test]
    fn switch_missing_workspace_returns_false() {
        let mut registry = WorkspaceRegistry::default();
        registry.add_workspace(workspace("api", "yuuzu-api"));

        assert!(!registry.switch_workspace("missing"));
        assert_eq!(registry.active_workspace_id, Some("api".to_string()));
    }
}
```

- [ ] **Step 2: Run workspace tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace
```

Expected: tests pass.

- [ ] **Step 3: Add Tauri commands**

Create `src-tauri/src/commands.rs` with:

```rust
use crate::workspace::{Workspace, WorkspaceRegistry};
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub registry: Mutex<WorkspaceRegistry>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            registry: Mutex::new(WorkspaceRegistry::default()),
        }
    }
}

#[tauri::command]
pub fn list_workspaces(state: State<'_, AppState>) -> Result<WorkspaceRegistry, String> {
    let registry = state.registry.lock().map_err(|err| err.to_string())?;
    Ok(registry.clone())
}

#[tauri::command]
pub fn add_workspace(state: State<'_, AppState>, workspace: Workspace) -> Result<WorkspaceRegistry, String> {
    let mut registry = state.registry.lock().map_err(|err| err.to_string())?;
    registry.add_workspace(workspace);
    Ok(registry.clone())
}

#[tauri::command]
pub fn switch_workspace(state: State<'_, AppState>, id: String) -> Result<WorkspaceRegistry, String> {
    let mut registry = state.registry.lock().map_err(|err| err.to_string())?;
    if !registry.switch_workspace(&id) {
        return Err(format!("workspace not found: {id}"));
    }
    Ok(registry.clone())
}
```

- [ ] **Step 4: Wire commands in `src-tauri/src/lib.rs`**

Set `src-tauri/src/lib.rs` to:

```rust
mod commands;
mod workspace;

use commands::{add_workspace, list_workspaces, switch_workspace, AppState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_workspaces,
            add_workspace,
            switch_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Verify Rust build**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
bun run tauri build --debug
```

Expected: Rust tests pass and Tauri debug build succeeds.

- [ ] **Step 6: Commit workspace registry**

Run:

```bash
git add src-tauri/src/workspace.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add workspace registry commands"
```

Expected: commit succeeds.

## Task 5: Add React Workspace Shell

**Files:**
- Create: `src/lib/tauri.ts`
- Create: `src/features/workspace/workspace-api.ts`
- Create: `src/app/workspace-store.ts`
- Create: `src/app/activity-rail.tsx`
- Create: `src/app/workspace-switcher.tsx`
- Create: `src/app/AppShell.tsx`
- Modify: `src/App.tsx`
- Test: `bun run build`

- [ ] **Step 1: Add Tauri invoke wrapper**

Create `src/lib/tauri.ts`:

```ts
import { invoke } from "@tauri-apps/api/core"

export function call<T>(command: string, args?: Record<string, unknown>) {
  return invoke<T>(command, args)
}
```

- [ ] **Step 2: Add workspace API**

Create `src/features/workspace/workspace-api.ts`:

```ts
import { call } from "@/lib/tauri"

export type Workspace = {
  id: string
  name: string
  path: string
  pinned: boolean
}

export type WorkspaceRegistry = {
  active_workspace_id: string | null
  workspaces: Workspace[]
}

export function listWorkspaces() {
  return call<WorkspaceRegistry>("list_workspaces")
}

export function addWorkspace(workspace: Workspace) {
  return call<WorkspaceRegistry>("add_workspace", { workspace })
}

export function switchWorkspace(id: string) {
  return call<WorkspaceRegistry>("switch_workspace", { id })
}
```

- [ ] **Step 3: Add transient UI store**

Create `src/app/workspace-store.ts`:

```ts
import { create } from "zustand"
import type { WorkspaceRegistry } from "@/features/workspace/workspace-api"

type WorkspaceState = {
  registry: WorkspaceRegistry
  setRegistry: (registry: WorkspaceRegistry) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  registry: {
    active_workspace_id: null,
    workspaces: [],
  },
  setRegistry: (registry) => set({ registry }),
}))
```

- [ ] **Step 4: Install UI state dependency**

Run:

```bash
bun add zustand
```

Expected: `zustand` is added to `package.json`.

- [ ] **Step 5: Add activity rail**

Create `src/app/activity-rail.tsx`:

```tsx
import { Database, FileText, GitBranch, Search, Settings, Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"

const items = [
  { id: "explorer", label: "Explorer", icon: FileText },
  { id: "search", label: "Search", icon: Search },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "database", label: "Database", icon: Database },
  { id: "settings", label: "Settings", icon: Settings },
]

export function ActivityRail() {
  return (
    <nav className="flex h-full w-12 flex-col items-center border-r bg-muted/40 py-2">
      {items.map((item) => (
        <Button key={item.id} size="icon" variant="ghost" title={item.label}>
          <item.icon className="size-4" />
        </Button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 6: Add workspace switcher**

Create `src/app/workspace-switcher.tsx`:

```tsx
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { addWorkspace, listWorkspaces, switchWorkspace } from "@/features/workspace/workspace-api"
import { useWorkspaceStore } from "@/app/workspace-store"

const seedWorkspaces = [
  { id: "api", name: "yuuzu-api", path: "/tmp/yuuzu-api", pinned: true },
  { id: "web", name: "yuuzu-web", path: "/tmp/yuuzu-web", pinned: false },
  { id: "cli", name: "yuuzu-cli", path: "/tmp/yuuzu-cli", pinned: false },
]

export function WorkspaceSwitcher() {
  const registry = useWorkspaceStore((state) => state.registry)
  const setRegistry = useWorkspaceStore((state) => state.setRegistry)

  useEffect(() => {
    void listWorkspaces()
      .then(async (current) => {
        let next = current
        for (const workspace of seedWorkspaces) {
          next = await addWorkspace(workspace)
        }
        setRegistry(next)
      })
      .catch((error) => {
        console.error("failed to load workspaces", error)
      })
  }, [setRegistry])

  return (
    <div className="border-b p-2">
      <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
        Workspaces
      </div>
      <div className="flex gap-2">
        {registry.workspaces.map((workspace) => {
          const active = registry.active_workspace_id === workspace.id
          return (
            <Button
              key={workspace.id}
              variant={active ? "default" : "outline"}
              size="sm"
              onClick={() => {
                void switchWorkspace(workspace.id).then(setRegistry)
              }}
            >
              {workspace.name}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Add app shell**

Create `src/app/AppShell.tsx`:

```tsx
import { ActivityRail } from "@/app/activity-rail"
import { WorkspaceSwitcher } from "@/app/workspace-switcher"
import { Button } from "@/components/ui/button"

export function AppShell() {
  return (
    <main className="flex h-screen overflow-hidden bg-background text-foreground">
      <ActivityRail />
      <section className="flex min-w-0 flex-1 flex-col">
        <WorkspaceSwitcher />
        <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr]">
          <aside className="border-r bg-muted/20 p-3">
            <div className="text-sm font-medium">Explorer</div>
            <div className="mt-2 rounded-md border bg-background p-3 text-sm text-muted-foreground">
              File tree scan is added in the next task.
            </div>
          </aside>
          <section className="flex min-w-0 flex-col">
            <div className="flex h-10 items-center gap-2 border-b px-3">
              <Button size="sm" variant="secondary">Open editor</Button>
              <Button size="sm" variant="secondary">Open terminal</Button>
            </div>
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Node 0 workbench shell
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}
```

- [ ] **Step 8: Render app shell**

Set `src/App.tsx` to:

```tsx
import { AppShell } from "@/app/AppShell"

export default function App() {
  return <AppShell />
}
```

- [ ] **Step 9: Build shell**

Run:

```bash
bun run build
bun run tauri build --debug
```

Expected: frontend and Tauri debug builds pass.

- [ ] **Step 10: Commit workspace shell**

Run:

```bash
git add package.json bun.lock src
git commit -m "feat: add workspace shell"
```

Expected: commit succeeds.

## Task 6: Add File Tree Scan Command

**Files:**
- Create: `src-tauri/src/workspace_scan.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Create: `src/features/workspace/FileTreePanel.tsx`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src/app/AppShell.tsx`
- Test: `cargo test --manifest-path src-tauri/Cargo.toml scan`

- [ ] **Step 1: Add scan module with tests**

Create `src-tauri/src/workspace_scan.rs`:

```rust
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileTreeEntry {
    pub name: String,
    pub path: PathBuf,
    pub is_dir: bool,
}

pub fn scan_top_level(path: &Path) -> Result<Vec<FileTreeEntry>, String> {
    let read_dir = fs::read_dir(path).map_err(|err| err.to_string())?;
    let mut entries = Vec::new();

    for item in read_dir {
        let item = item.map_err(|err| err.to_string())?;
        let item_path = item.path();
        let name = item
            .file_name()
            .to_string_lossy()
            .to_string();

        if name == ".git" || name == "node_modules" || name == "target" {
            continue;
        }

        entries.push(FileTreeEntry {
            name,
            path: item_path.clone(),
            is_dir: item_path.is_dir(),
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn scan_top_level_sorts_directories_first_and_ignores_heavy_dirs() {
        let temp = tempfile::tempdir().expect("temp dir");
        fs::create_dir(temp.path().join("src")).expect("src dir");
        fs::create_dir(temp.path().join("node_modules")).expect("node_modules dir");
        let mut file = fs::File::create(temp.path().join("README.md")).expect("readme");
        writeln!(file, "# test").expect("write readme");

        let entries = scan_top_level(temp.path()).expect("scan");

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "src");
        assert!(entries[0].is_dir);
        assert_eq!(entries[1].name, "README.md");
        assert!(!entries[1].is_dir);
    }
}
```

- [ ] **Step 2: Add tempfile dev dependency**

Modify `src-tauri/Cargo.toml` and add this under `[dev-dependencies]`:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: Add scan command**

Append to `src-tauri/src/commands.rs`:

```rust
use crate::workspace_scan::{scan_top_level, FileTreeEntry};

#[tauri::command]
pub fn scan_workspace(path: String) -> Result<Vec<FileTreeEntry>, String> {
    scan_top_level(std::path::Path::new(&path))
}
```

- [ ] **Step 4: Wire scan command**

Update `src-tauri/src/lib.rs`:

```rust
mod commands;
mod workspace;
mod workspace_scan;

use commands::{add_workspace, list_workspaces, scan_workspace, switch_workspace, AppState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_workspaces,
            add_workspace,
            switch_workspace,
            scan_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Run scan tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml scan
```

Expected: scan test passes.

- [ ] **Step 6: Add frontend scan API**

Append to `src/features/workspace/workspace-api.ts`:

```ts
export type FileTreeEntry = {
  name: string
  path: string
  is_dir: boolean
}

export function scanWorkspace(path: string) {
  return call<FileTreeEntry[]>("scan_workspace", { path })
}
```

- [ ] **Step 7: Add file tree panel**

Create `src/features/workspace/FileTreePanel.tsx`:

```tsx
import { useEffect, useState } from "react"
import { File, Folder } from "lucide-react"
import { scanWorkspace, type FileTreeEntry } from "@/features/workspace/workspace-api"
import { useWorkspaceStore } from "@/app/workspace-store"

export function FileTreePanel() {
  const registry = useWorkspaceStore((state) => state.registry)
  const active = registry.workspaces.find(
    (workspace) => workspace.id === registry.active_workspace_id,
  )
  const [entries, setEntries] = useState<FileTreeEntry[]>([])

  useEffect(() => {
    if (!active) {
      setEntries([])
      return
    }

    void scanWorkspace(active.path)
      .then(setEntries)
      .catch((error) => {
        console.error("failed to scan workspace", error)
        setEntries([])
      })
  }, [active?.path])

  return (
    <aside className="border-r bg-muted/20 p-3">
      <div className="text-sm font-medium">Explorer</div>
      <div className="mt-3 space-y-1">
        {entries.map((entry) => (
          <div key={entry.path} className="flex items-center gap-2 rounded px-2 py-1 text-sm">
            {entry.is_dir ? <Folder className="size-4" /> : <File className="size-4" />}
            <span className="truncate">{entry.name}</span>
          </div>
        ))}
        {entries.length === 0 ? (
          <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
            No files found for this workspace path.
          </div>
        ) : null}
      </div>
    </aside>
  )
}
```

- [ ] **Step 8: Use file tree panel in app shell**

Replace the `<aside>` block in `src/app/AppShell.tsx` with:

```tsx
<FileTreePanel />
```

Add this import:

```tsx
import { FileTreePanel } from "@/features/workspace/FileTreePanel"
```

- [ ] **Step 9: Build scan integration**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
bun run build
```

Expected: tests and frontend build pass.

- [ ] **Step 10: Commit file scan**

Run:

```bash
git add src-tauri src/features src/app
git commit -m "feat: add workspace file scan"
```

Expected: commit succeeds.

## Task 7: Add Lazy Monaco Editor Surface

**Files:**
- Create: `src/features/editor/load-monaco.ts`
- Create: `src/features/editor/EditorTab.tsx`
- Modify: `src/app/AppShell.tsx`
- Test: `bun run build`

- [ ] **Step 1: Install Monaco**

Run:

```bash
bun add monaco-editor
```

Expected: `monaco-editor` appears in `package.json`.

- [ ] **Step 2: Add lazy Monaco loader**

Create `src/features/editor/load-monaco.ts`:

```ts
export async function loadMonaco() {
  return import("monaco-editor")
}
```

- [ ] **Step 3: Add editor tab component**

Create `src/features/editor/EditorTab.tsx`:

```tsx
import { useEffect, useRef } from "react"
import type * as Monaco from "monaco-editor"
import { loadMonaco } from "@/features/editor/load-monaco"

export function EditorTab() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    let disposed = false

    void loadMonaco().then((monaco) => {
      if (disposed || !hostRef.current || editorRef.current) {
        return
      }

      editorRef.current = monaco.editor.create(hostRef.current, {
        value: [
          "export function hello() {",
          "  return 'Yuuzu-IDE Node 0'",
          "}",
        ].join("\n"),
        language: "typescript",
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
      })
    })

    return () => {
      disposed = true
      editorRef.current?.dispose()
      editorRef.current = null
    }
  }, [])

  return <div ref={hostRef} className="h-full w-full" />
}
```

- [ ] **Step 4: Add editor tab toggle to shell**

Modify `src/app/AppShell.tsx` so it includes:

```tsx
import { useState } from "react"
import { EditorTab } from "@/features/editor/EditorTab"
```

Inside `AppShell`, add:

```tsx
const [surface, setSurface] = useState<"empty" | "editor">("empty")
```

Change the Open editor button to:

```tsx
<Button size="sm" variant="secondary" onClick={() => setSurface("editor")}>
  Open editor
</Button>
```

Change the main content body to:

```tsx
<div className="min-h-0 flex-1">
  {surface === "editor" ? (
    <EditorTab />
  ) : (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Node 0 workbench shell
    </div>
  )}
</div>
```

- [ ] **Step 5: Build editor surface**

Run:

```bash
bun run build
```

Expected: build passes. Monaco appears in a lazy-loaded chunk rather than the initial application source chunk.

- [ ] **Step 6: Commit Monaco surface**

Run:

```bash
git add package.json bun.lock src/features/editor src/app/AppShell.tsx
git commit -m "feat: add lazy monaco editor surface"
```

Expected: commit succeeds.

## Task 8: Add Lazy xterm Terminal Surface With Rust PTY Skeleton

**Files:**
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Create: `src/features/terminal/load-xterm.ts`
- Create: `src/features/terminal/TerminalTab.tsx`
- Modify: `src/app/AppShell.tsx`
- Test: `cargo test --manifest-path src-tauri/Cargo.toml pty`, `bun run build`

- [ ] **Step 1: Add portable-pty dependency**

Run:

```bash
cd src-tauri
cargo add portable-pty
cd ..
```

Expected: `portable-pty` is added to `src-tauri/Cargo.toml`.

- [ ] **Step 2: Add PTY module**

Create `src-tauri/src/pty.rs`:

```rust
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};

pub fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    }
}

pub fn spawn_shell_probe() -> Result<String, String> {
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| err.to_string())?;

    let shell = default_shell();
    let command = CommandBuilder::new(&shell);
    let mut child = pair.slave.spawn_command(command).map_err(|err| err.to_string())?;
    child.kill().map_err(|err| err.to_string())?;

    Ok(shell)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shell_is_not_empty() {
        assert!(!default_shell().is_empty());
    }
}
```

- [ ] **Step 3: Add PTY command**

Append to `src-tauri/src/commands.rs`:

```rust
use crate::pty::spawn_shell_probe;

#[tauri::command]
pub fn terminal_probe() -> Result<String, String> {
    spawn_shell_probe()
}
```

- [ ] **Step 4: Wire PTY module**

Update `src-tauri/src/lib.rs` imports and handler:

```rust
mod commands;
mod pty;
mod workspace;
mod workspace_scan;

use commands::{
    add_workspace, list_workspaces, scan_workspace, switch_workspace, terminal_probe, AppState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_workspaces,
            add_workspace,
            switch_workspace,
            scan_workspace,
            terminal_probe
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Run PTY test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml pty
```

Expected: PTY module tests pass.

- [ ] **Step 6: Install xterm**

Run:

```bash
bun add @xterm/xterm @xterm/addon-fit
```

Expected: packages are added to `package.json`.

- [ ] **Step 7: Add xterm loader**

Create `src/features/terminal/load-xterm.ts`:

```ts
export async function loadXterm() {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/xterm/css/xterm.css"),
  ])

  return { Terminal, FitAddon }
}
```

- [ ] **Step 8: Add terminal tab**

Create `src/features/terminal/TerminalTab.tsx`:

```tsx
import { useEffect, useRef } from "react"
import { call } from "@/lib/tauri"
import { loadXterm } from "@/features/terminal/load-xterm"

export function TerminalTab() {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined

    void loadXterm().then(async ({ Terminal, FitAddon }) => {
      if (disposed || !hostRef.current) {
        return
      }

      const fitAddon = new FitAddon()
      const terminal = new Terminal({
        convertEol: true,
        fontSize: 13,
        cursorBlink: true,
      })

      terminal.loadAddon(fitAddon)
      terminal.open(hostRef.current)
      fitAddon.fit()

      const shell = await call<string>("terminal_probe")
      terminal.writeln(`Yuuzu-IDE PTY probe: ${shell}`)
      terminal.writeln("Full terminal streaming is implemented after Node 0.")

      cleanup = () => terminal.dispose()
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  return <div ref={hostRef} className="h-full w-full bg-black p-2" />
}
```

- [ ] **Step 9: Add terminal tab toggle to shell**

Modify `src/app/AppShell.tsx` so the surface union is:

```tsx
const [surface, setSurface] = useState<"empty" | "editor" | "terminal">("empty")
```

Import terminal:

```tsx
import { TerminalTab } from "@/features/terminal/TerminalTab"
```

Change the terminal button:

```tsx
<Button size="sm" variant="secondary" onClick={() => setSurface("terminal")}>
  Open terminal
</Button>
```

Render terminal:

```tsx
{surface === "editor" ? (
  <EditorTab />
) : surface === "terminal" ? (
  <TerminalTab />
) : (
  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
    Node 0 workbench shell
  </div>
)}
```

- [ ] **Step 10: Build terminal surface**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
bun run build
bun run tauri build --debug
```

Expected: tests and builds pass.

- [ ] **Step 11: Commit terminal surface**

Run:

```bash
git add package.json bun.lock src src-tauri
git commit -m "feat: add lazy xterm terminal probe"
```

Expected: commit succeeds.

## Task 9: Add Node 0 Measurement Script

**Files:**
- Create: `src-tauri/src/metrics.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Create: `scripts/measure-node0.sh`
- Test: `bash scripts/measure-node0.sh --help`

- [ ] **Step 1: Add metrics model**

Create `src-tauri/src/metrics.rs`:

```rust
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
pub struct AppMetricSnapshot {
    pub timestamp_ms: u128,
    pub process_id: u32,
}

pub fn snapshot() -> AppMetricSnapshot {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before unix epoch")
        .as_millis();

    AppMetricSnapshot {
        timestamp_ms,
        process_id: std::process::id(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_includes_process_id() {
        let value = snapshot();
        assert!(value.process_id > 0);
    }
}
```

- [ ] **Step 2: Add metrics command**

Append to `src-tauri/src/commands.rs`:

```rust
use crate::metrics::{snapshot, AppMetricSnapshot};

#[tauri::command]
pub fn metric_snapshot() -> Result<AppMetricSnapshot, String> {
    Ok(snapshot())
}
```

- [ ] **Step 3: Wire metrics command**

Update `src-tauri/src/lib.rs` to include:

```rust
mod metrics;
```

Add `metric_snapshot` to the `use commands::{ ... }` list and to `tauri::generate_handler![ ... ]`.

- [ ] **Step 4: Add measurement script**

Create `scripts/measure-node0.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: scripts/measure-node0.sh

Builds the Node 0 debug app and prints process guidance for manual memory checks.
EOF
  exit 0
fi

bun run build
bun run tauri build --debug

cat <<'EOF'
Manual measurement checklist:
1. Launch the debug app from src-tauri/target/debug/.
2. Record cold launch time to visible shell.
3. Record idle memory after shell load.
4. Open the editor tab and record Monaco memory delta.
5. Open the terminal tab and record xterm/PTX memory delta.
6. Confirm workspace switching does not create one WebView per workspace.

macOS process commands:
  ps -axo pid,ppid,rss,comm | rg 'yuuzu|WebView|Yuuzu'

Windows process commands:
  Get-Process | Where-Object { $_.ProcessName -match 'yuuzu|msedgewebview2' } |
    Select-Object ProcessName,Id,WorkingSet64
EOF
```

- [ ] **Step 5: Make script executable**

Run:

```bash
chmod +x scripts/measure-node0.sh
```

Expected: script is executable.

- [ ] **Step 6: Verify metrics script help**

Run:

```bash
bash scripts/measure-node0.sh --help
```

Expected: usage text prints.

- [ ] **Step 7: Run test/build**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml metrics
bun run build
```

Expected: metrics test and frontend build pass.

- [ ] **Step 8: Commit measurement support**

Run:

```bash
git add src-tauri/src/metrics.rs src-tauri/src/commands.rs src-tauri/src/lib.rs scripts/measure-node0.sh
git commit -m "feat: add node 0 measurement support"
```

Expected: commit succeeds.

## Task 10: Record Spike Results And Next Decision

**Files:**
- Create: `docs/architecture/node-0-spike-results.md`
- Modify: `roadmap.md`
- Test: documentation review commands

- [ ] **Step 1: Collect measurement values**

Run the built app and record these values in your scratch notes before creating
the results document:

```txt
cold_launch_to_visible_shell_ms
idle_memory_after_shell_load_mb
monaco_loaded_memory_delta_mb
xterm_loaded_memory_delta_mb
one_workspace_memory_mb
three_workspace_memory_mb
terminal_startup_latency_ms
file_tree_scan_latency_ms
main_webview_count_while_switching
```

- [ ] **Step 2: Create results document with measured values**

Create `docs/architecture/node-0-spike-results.md` using the measured values.
For example, if the measurements are `1480`, `142`, `38`, `24`, `148`, `211`,
`180`, `36`, and `1`, write this exact file:

```markdown
# Node 0 Spike Results

## Stack

- Desktop shell: Tauri 2
- Frontend: Vite + React + TypeScript
- UI: shadcn/ui + Tailwind CSS
- Editor spike: Monaco Editor, lazy-loaded
- Terminal spike: xterm.js, lazy-loaded
- Core: Rust commands through Tauri IPC

## Measurements

| Measurement | Result | Pass Target |
| --- | ---: | ---: |
| Cold launch to visible shell | 1480 ms | under 2000 ms |
| Idle memory after shell load | 142 MB | under 180 MB |
| Memory delta after Monaco load | 38 MB | measured and acceptable |
| Memory delta after xterm.js load | 24 MB | measured and acceptable |
| Memory with one workspace registered | 148 MB | under 180 MB |
| Memory with three workspaces registered | 211 MB | under 300 MB |
| Terminal startup latency | 180 ms | under 300 ms |
| File tree scan latency | 36 ms | under 100 ms for small project |
| Main WebView count while switching workspaces | 1 | exactly 1 |

## Result

The Tauri 2 + React route remains the primary implementation path if measured
results stay within the pass targets above.

## Follow-Up Decisions

- Keep browser preview outside the app until Node 8.
- Keep Monaco and xterm lazy-loaded.
- Keep Rust as owner of workspace state, PTY, search, git, and LSP lifecycle.
```

- [ ] **Step 3: Update roadmap with measurement result**

If the stack passes, add this bullet under `## Current Priority` in `roadmap.md`:

```markdown
- Node 0 measurements keep Tauri 2 as the main route; Rust-native fallback
  research remains deferred.
```

If the stack fails, add this bullet instead:

```markdown
- Node 0 measurements require a fallback UI spike before Node 1 continues.
```

- [ ] **Step 4: Review docs for unresolved markers**

Run:

```bash
rg -n "T[B]D|T[O]DO|F[I]XME|place[ ]holder|\\| 0 (ms|MB) \\|" docs/architecture/node-0-spike-results.md roadmap.md
```

Expected: no matches in `docs/architecture/node-0-spike-results.md`.

- [ ] **Step 5: Commit spike results**

Run:

```bash
git add docs/architecture/node-0-spike-results.md roadmap.md
git commit -m "docs: record node 0 spike results"
```

Expected: commit succeeds.

## Self-Review

### Spec Coverage

- Tauri 2 + Vite + React + shadcn stack: Task 2 and Task 3.
- One main WebView for workbench: Task 5 shell design and Task 9 process-count measurement.
- Rust-owned workspace state: Task 4.
- Rust-owned file scan: Task 6.
- Lazy Monaco: Task 7.
- Lazy xterm and Rust PTY ownership: Task 8.
- Performance measurement: Task 9 and Task 10.
- Windows WebView2 policy: covered in `docs/architecture/tech-stack.md`; Task 10 records whether Node 0 passes and keeps Windows validation explicit.

### Completeness Scan

Task 10 requires measured values before creating the final results document. The
example values in the plan demonstrate the file shape and must be replaced by
the executor's actual measurements during implementation.

### Type Consistency

- Rust `WorkspaceRegistry.active_workspace_id` serializes to TypeScript `active_workspace_id`.
- Rust `FileTreeEntry.is_dir` serializes to TypeScript `is_dir`.
- Tauri command names match frontend calls: `list_workspaces`, `add_workspace`, `switch_workspace`, `scan_workspace`, `terminal_probe`, `metric_snapshot`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-08-node-0-architecture-spike.md`. Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Choose the execution approach before starting Task 1.
