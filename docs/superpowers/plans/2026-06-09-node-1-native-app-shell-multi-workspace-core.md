# Node 1 Native App Shell And Multi-Workspace Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first persistent multi-workspace app shell: users can open, pin, remove, and switch at least three folders in one Tauri window while each workspace restores its panel/tab shell state.

**Architecture:** Rust owns persisted workspace registry, recent-workspace order, settings storage, and filesystem validation. React owns small UI view state, command palette rendering, workspace action controls, and the existing single-WebView workbench layout from `docs/ui-design/`. Heavy surfaces stay lazy-loaded and inactive workspaces do not start file scans, Monaco, xterm, or background services.

**Tech Stack:** Tauri 2, Rust 1.96, Vite 8, React 19, TypeScript 6, Zustand 5, shadcn/Tailwind CSS, lucide-react, latest `@tauri-apps/plugin-dialog`, latest `tauri-plugin-dialog`, Monaco lazy chunks, xterm lazy chunks.

---

## File Structure

- `src-tauri/src/workspace.rs`: workspace domain methods for add, remove, pin, switch, path normalization, and missing-path checks.
- `src-tauri/src/workspace_store.rs`: JSON persistence for `WorkspaceRegistry` under the app config directory.
- `src-tauri/src/settings.rs`: persisted basic app settings model and JSON store.
- `src-tauri/src/commands.rs`: Tauri commands for workspace and settings mutations.
- `src-tauri/src/lib.rs`: Tauri setup, state initialization, dialog plugin wiring, and command handler list.
- `src/features/workspace/workspace-api.ts`: typed IPC wrappers for workspace commands and folder picking.
- `src/app/workspace-store.ts`: registry loading/mutation actions; no fake workspace seeding in production startup.
- `src/app/workspace-view-state.ts`: small per-workspace UI state for panel, activity rail, and open shell tabs.
- `src/app/workspace-switcher.tsx`: open, switch, pin, and remove controls.
- `src/app/CommandPalette.tsx`: command palette shell and command filtering.
- `src/app/command-palette-model.ts`: pure command filtering and labels for TDD.
- `src/features/workspace/FileTreePanel.tsx`: missing-path and empty-state copy.
- `src/app/AppShell.tsx`: wires per-workspace view state, command palette, and restored tab/surface state.
- `src/index.css`: styling aligned to `docs/ui-design/ide.css`.
- `docs/architecture/node-1-core-results.md`: Node 1 measurements.
- `docs/architecture/progress.md`, `roadmap.md`: Node 1 completion evidence.

---

## Task 1: Rust Workspace Domain And Persistence

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/workspace.rs`
- Create: `src-tauri/src/workspace_store.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `cargo test --manifest-path src-tauri/Cargo.toml workspace`

- [ ] **Step 1: Add JSON dependency**

Run:

```bash
cd src-tauri
cargo add serde_json
cd ..
```

Expected: latest compatible `serde_json` is added to `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`.

- [ ] **Step 2: Write failing workspace tests**

Append these tests to `src-tauri/src/workspace.rs` inside the existing `#[cfg(test)] mod tests` block:

```rust
#[test]
fn remove_active_workspace_promotes_pinned_then_recent() {
    let mut registry = WorkspaceRegistry::default();
    registry.add_workspace(workspace("first"));
    registry.add_workspace(Workspace {
        pinned: true,
        ..workspace("second")
    });
    registry.add_workspace(workspace("third"));
    registry.switch_workspace("third");

    assert!(registry.remove_workspace("third"));

    assert_eq!(registry.active_workspace_id, Some("second".to_string()));
    assert_eq!(
        registry
            .workspaces
            .iter()
            .map(|workspace| workspace.id.as_str())
            .collect::<Vec<_>>(),
        vec!["second", "first"]
    );
}

#[test]
fn pin_workspace_updates_flag_and_orders_pinned_first() {
    let mut registry = WorkspaceRegistry::default();
    registry.add_workspace(workspace("first"));
    registry.add_workspace(workspace("second"));

    assert!(registry.set_workspace_pinned("second", true));

    assert!(registry.workspaces[0].pinned);
    assert_eq!(registry.workspaces[0].id, "second");
}

#[test]
fn workspace_from_path_uses_folder_name_and_stable_id() {
    let item = Workspace::from_path(PathBuf::from("/tmp/my-project"));

    assert_eq!(item.id, "tmp-my-project");
    assert_eq!(item.name, "my-project");
    assert_eq!(item.path, PathBuf::from("/tmp/my-project"));
    assert!(!item.pinned);
}
```

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml workspace
```

Expected: FAIL with missing `remove_workspace`, `set_workspace_pinned`, and `Workspace::from_path`.

- [ ] **Step 3: Implement workspace domain methods**

Update `src-tauri/src/workspace.rs` with these public methods while keeping existing behavior:

```rust
impl Workspace {
    pub fn from_path(path: PathBuf) -> Self {
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("workspace")
            .to_string();
        let id = path
            .components()
            .filter_map(|component| component.as_os_str().to_str())
            .filter(|part| !part.is_empty())
            .map(slug_part)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("-");

        Self {
            id: if id.is_empty() { "workspace".to_string() } else { id },
            name,
            path,
            pinned: false,
        }
    }

    pub fn path_exists(&self) -> bool {
        self.path.is_dir()
    }
}

impl WorkspaceRegistry {
    pub fn remove_workspace(&mut self, id: &str) -> bool {
        let previous_active = self.active_workspace_id.clone();
        let before = self.workspaces.len();
        self.workspaces.retain(|workspace| workspace.id != id);

        if self.workspaces.len() == before {
            return false;
        }

        if previous_active.as_deref() == Some(id) {
            self.active_workspace_id = self.workspaces.first().map(|workspace| workspace.id.clone());
        }

        true
    }

    pub fn set_workspace_pinned(&mut self, id: &str, pinned: bool) -> bool {
        let Some(workspace) = self.workspaces.iter_mut().find(|workspace| workspace.id == id) else {
            return false;
        };
        workspace.pinned = pinned;
        self.sort_workspaces();
        true
    }

    pub fn sort_workspaces(&mut self) {
        self.workspaces.sort_by(|a, b| {
            b.pinned
                .cmp(&a.pinned)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.id.cmp(&b.id))
        });
    }
}

fn slug_part(value: &str) -> String {
    value
        .chars()
        .map(|item| if item.is_ascii_alphanumeric() { item.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}
```

Also call `self.sort_workspaces()` at the end of `add_workspace`.

- [ ] **Step 4: Run workspace tests**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml workspace
```

Expected: PASS for workspace domain tests.

- [ ] **Step 5: Write failing persistence tests**

Create `src-tauri/src/workspace_store.rs`:

```rust
use crate::workspace::{Workspace, WorkspaceRegistry};
use std::path::PathBuf;

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace(id: &str) -> Workspace {
        Workspace {
            id: id.to_string(),
            name: format!("Workspace {id}"),
            path: PathBuf::from(format!("/tmp/{id}")),
            pinned: false,
        }
    }

    #[test]
    fn store_returns_default_registry_when_file_is_missing() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = WorkspaceRegistryStore::new(temp.path().join("workspaces.json"));

        let registry = store.load().expect("load registry");

        assert_eq!(registry, WorkspaceRegistry::default());
    }

    #[test]
    fn store_round_trips_registry_json() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = WorkspaceRegistryStore::new(temp.path().join("nested/workspaces.json"));
        let mut registry = WorkspaceRegistry::default();
        registry.add_workspace(workspace("first"));
        registry.add_workspace(workspace("second"));
        registry.switch_workspace("second");

        store.save(&registry).expect("save registry");
        let loaded = store.load().expect("load registry");

        assert_eq!(loaded, registry);
    }
}
```

Add `mod workspace_store;` to `src-tauri/src/lib.rs`.

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml workspace_store
```

Expected: FAIL because `WorkspaceRegistryStore` is missing.

- [ ] **Step 6: Implement persistence store**

Replace `src-tauri/src/workspace_store.rs` with:

```rust
use std::{fs, path::PathBuf};

use crate::workspace::WorkspaceRegistry;

#[derive(Clone, Debug)]
pub struct WorkspaceRegistryStore {
    path: PathBuf,
}

impl WorkspaceRegistryStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<WorkspaceRegistry, String> {
        if !self.path.exists() {
            return Ok(WorkspaceRegistry::default());
        }

        let value = fs::read_to_string(&self.path).map_err(|err| err.to_string())?;
        serde_json::from_str(&value).map_err(|err| err.to_string())
    }

    pub fn save(&self, registry: &WorkspaceRegistry) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let value = serde_json::to_string_pretty(registry).map_err(|err| err.to_string())?;
        fs::write(&self.path, value).map_err(|err| err.to_string())
    }
}
```

Keep the tests from Step 5 below the implementation.

- [ ] **Step 7: Run persistence tests**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml workspace_store
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml workspace
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml workspace_store
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/workspace.rs src-tauri/src/workspace_store.rs src-tauri/src/lib.rs
git commit -m "feat: add persistent workspace registry domain"
```

Expected: tests pass and commit succeeds after review gates.

---

## Task 2: Rust Workspace Commands And Dialog Plugin

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `cargo test --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 1: Add latest Tauri dialog plugin**

Run:

```bash
cd src-tauri
cargo add tauri-plugin-dialog
cd ..
```

Expected: latest compatible `tauri-plugin-dialog` is added.

- [ ] **Step 2: Write failing command-state tests**

Append a test module to `src-tauri/src/commands.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn app_state_loads_registry_from_store() {
        let temp = tempdir().expect("temp dir");
        let state = AppState::new(temp.path()).expect("state");

        let registry = state.registry_snapshot().expect("registry");

        assert_eq!(registry.workspaces.len(), 0);
    }

    #[test]
    fn app_state_persists_registry_mutations() {
        let temp = tempdir().expect("temp dir");
        let state = AppState::new(temp.path()).expect("state");
        let workspace_path = temp.path().join("project-a");
        std::fs::create_dir(&workspace_path).expect("project dir");

        state.open_workspace_path(workspace_path.clone()).expect("open");
        let reloaded = AppState::new(temp.path()).expect("reload");

        assert_eq!(reloaded.registry_snapshot().expect("registry").workspaces.len(), 1);
    }
}
```

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml commands
```

Expected: FAIL because `AppState::new`, `registry_snapshot`, and `open_workspace_path` are missing.

- [ ] **Step 3: Implement state helpers and commands**

Update `AppState` in `src-tauri/src/commands.rs` to own both an in-memory registry and `WorkspaceRegistryStore`:

```rust
use crate::workspace_store::WorkspaceRegistryStore;

pub struct AppState {
    registry: Mutex<WorkspaceRegistry>,
    registry_store: WorkspaceRegistryStore,
}

impl AppState {
    pub fn new(config_dir: impl AsRef<std::path::Path>) -> Result<Self, String> {
        let registry_store =
            WorkspaceRegistryStore::new(config_dir.as_ref().join("workspace-registry.json"));
        let registry = registry_store.load()?;

        Ok(Self {
            registry: Mutex::new(registry),
            registry_store,
        })
    }

    fn mutate_registry(
        &self,
        mutate: impl FnOnce(&mut WorkspaceRegistry) -> Result<(), String>,
    ) -> Result<WorkspaceRegistry, String> {
        let mut registry = self.registry.lock().map_err(|err| err.to_string())?;
        mutate(&mut registry)?;
        self.registry_store.save(&registry)?;
        Ok(registry.clone())
    }

    pub fn registry_snapshot(&self) -> Result<WorkspaceRegistry, String> {
        let registry = self.registry.lock().map_err(|err| err.to_string())?;
        Ok(registry.clone())
    }

    pub fn open_workspace_path(&self, path: PathBuf) -> Result<WorkspaceRegistry, String> {
        if !path.is_dir() {
            return Err(format!("workspace path is not a directory: {}", path.display()));
        }

        self.mutate_registry(|registry| {
            registry.add_workspace(Workspace::from_path(path));
            Ok(())
        })
    }
}
```

Add commands:

```rust
#[tauri::command]
pub fn open_workspace_path(
    state: State<'_, AppState>,
    path: String,
) -> Result<WorkspaceRegistry, String> {
    state.open_workspace_path(PathBuf::from(path))
}

#[tauri::command]
pub fn remove_workspace(
    state: State<'_, AppState>,
    id: String,
) -> Result<WorkspaceRegistry, String> {
    state.mutate_registry(|registry| {
        if registry.remove_workspace(&id) {
            Ok(())
        } else {
            Err(format!("workspace not found: {id}"))
        }
    })
}

#[tauri::command]
pub fn pin_workspace(
    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> Result<WorkspaceRegistry, String> {
    state.mutate_registry(|registry| {
        if registry.set_workspace_pinned(&id, pinned) {
            Ok(())
        } else {
            Err(format!("workspace not found: {id}"))
        }
    })
}
```

Update existing `add_workspace` and `switch_workspace` to use `mutate_registry` so changes persist.

- [ ] **Step 4: Wire Tauri setup and plugin**

Update `src-tauri/src/lib.rs` so app state is initialized from app config dir:

```rust
mod workspace_store;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
            app.manage(commands::AppState::new(config_dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_workspaces,
            commands::add_workspace,
            commands::switch_workspace,
            commands::scan_workspace,
            commands::terminal_probe,
            commands::metric_snapshot,
            commands::open_workspace_path,
            commands::remove_workspace,
            commands::pin_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Run Rust verification**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml commands
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: persist workspace command mutations"
```

Expected: commit succeeds after review gates.

---

## Task 3: Basic Settings Storage

**Files:**
- Create: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `cargo test --manifest-path src-tauri/Cargo.toml settings`

- [ ] **Step 1: Write failing settings tests**

Create `src-tauri/src/settings.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct AppSettings {
    pub density: String,
    pub color_theme: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_are_compact_dark() {
        assert_eq!(
            AppSettings::default(),
            AppSettings {
                density: "compact".to_string(),
                color_theme: "dark".to_string(),
            }
        );
    }

    #[test]
    fn settings_store_round_trips_json() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = SettingsStore::new(temp.path().join("settings.json"));
        let settings = AppSettings {
            density: "comfortable".to_string(),
            color_theme: "dark".to_string(),
        };

        store.save(&settings).expect("save");

        assert_eq!(store.load().expect("load"), settings);
    }
}
```

Add `mod settings;` to `src-tauri/src/lib.rs`.

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml settings
```

Expected: FAIL because `Default` and `SettingsStore` are missing.

- [ ] **Step 2: Implement settings model and store**

Update `src-tauri/src/settings.rs`:

```rust
use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct AppSettings {
    pub density: String,
    pub color_theme: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            density: "compact".to_string(),
            color_theme: "dark".to_string(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<AppSettings, String> {
        if !self.path.exists() {
            return Ok(AppSettings::default());
        }

        let value = fs::read_to_string(&self.path).map_err(|err| err.to_string())?;
        serde_json::from_str(&value).map_err(|err| err.to_string())
    }

    pub fn save(&self, settings: &AppSettings) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let value = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
        fs::write(&self.path, value).map_err(|err| err.to_string())
    }
}
```

Keep the tests below the implementation.

- [ ] **Step 3: Add settings state helpers and commands**

Extend `AppState` in `src-tauri/src/commands.rs`:

```rust
use crate::settings::{AppSettings, SettingsStore};

pub struct AppState {
    registry: Mutex<WorkspaceRegistry>,
    registry_store: WorkspaceRegistryStore,
    settings: Mutex<AppSettings>,
    settings_store: SettingsStore,
}
```

In `AppState::new`, create `SettingsStore::new(config_dir.as_ref().join("settings.json"))` and load settings.

Add commands:

```rust
#[tauri::command]
pub fn load_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let settings = state.settings.lock().map_err(|err| err.to_string())?;
    Ok(settings.clone())
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let mut current = state.settings.lock().map_err(|err| err.to_string())?;
    *current = settings;
    state.settings_store.save(&current)?;
    Ok(current.clone())
}
```

Wire both commands in `src-tauri/src/lib.rs`.

- [ ] **Step 4: Run settings verification**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml settings
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src-tauri/src/settings.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add basic settings storage"
```

Expected: commit succeeds after review gates.

---

## Task 4: Frontend Workspace API And Store Actions

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src/app/workspace-store.ts`
- Modify: `src/app/workspace-bootstrap.ts`
- Modify: `src/app/workspace-bootstrap.test.ts`
- Modify: `src/app/workspace-store.test.ts`
- Test: `bun test src/app/workspace-store.test.ts src/app/workspace-bootstrap.test.ts`

- [ ] **Step 1: Install latest dialog package**

Run:

```bash
bun add @tauri-apps/plugin-dialog
```

Expected: latest compatible `@tauri-apps/plugin-dialog` is added.

- [ ] **Step 2: Write failing API/store tests**

Update `src/app/workspace-store.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { createWorkspaceStore } from "./workspace-store";

describe("createWorkspaceStore", () => {
  test("starts empty and accepts a workspace registry", () => {
    const store = createWorkspaceStore();

    expect(store.getState().registry.workspaces).toHaveLength(0);

    store.getState().setRegistry({
      active_workspace_id: "one",
      workspaces: [
        {
          id: "one",
          name: "One",
          path: "/tmp/one",
          pinned: false,
        },
      ],
    });

    expect(store.getState().activeWorkspace()?.id).toBe("one");
  });

  test("reports missing active workspace as null", () => {
    const store = createWorkspaceStore();

    store.getState().setRegistry({
      active_workspace_id: "missing",
      workspaces: [],
    });

    expect(store.getState().activeWorkspace()).toBeNull();
  });
});
```

Run:

```bash
bun test src/app/workspace-store.test.ts
```

Expected: FAIL because `createWorkspaceStore` and `activeWorkspace` are missing.

- [ ] **Step 3: Implement store factory and derived active workspace**

Update `src/app/workspace-store.ts`:

```ts
import { create, type StoreApi, useStore } from "zustand";

import type { Workspace, WorkspaceRegistry } from "../features/workspace/workspace-api";

type WorkspaceState = {
  registry: WorkspaceRegistry;
  setRegistry: (registry: WorkspaceRegistry) => void;
  activeWorkspace: () => Workspace | null;
};

const emptyRegistry: WorkspaceRegistry = {
  active_workspace_id: null,
  workspaces: [],
};

export function createWorkspaceStore() {
  return create<WorkspaceState>((set, get) => ({
    registry: emptyRegistry,
    setRegistry: (registry) => set({ registry }),
    activeWorkspace: () => {
      const registry = get().registry;
      return (
        registry.workspaces.find(
          (workspace) => workspace.id === registry.active_workspace_id,
        ) ?? null
      );
    },
  }));
}

export const workspaceStore = createWorkspaceStore();

export function useWorkspaceStore<T>(selector: (state: WorkspaceState) => T): T {
  return useStore(workspaceStore, selector);
}

export type WorkspaceStoreApi = StoreApi<WorkspaceState>;
```

- [ ] **Step 4: Replace fake seeding with registry loading helper**

Update `src/app/workspace-bootstrap.ts` so production startup only lists persisted workspaces:

```ts
import { listWorkspaces, type WorkspaceRegistry } from "../features/workspace/workspace-api";

let registryPromise: Promise<WorkspaceRegistry> | null = null;

export function loadWorkspaceRegistry(): Promise<WorkspaceRegistry> {
  registryPromise ??= listWorkspaces().catch((err: unknown) => {
    registryPromise = null;
    throw err;
  });

  return registryPromise;
}

export function workspacePathLabel(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  const label = parts[parts.length - 1];

  return label ?? "workspace";
}

export function resetWorkspaceBootstrapForTests() {
  registryPromise = null;
}
```

Update `src/app/workspace-bootstrap.test.ts` to assert concurrent list coalescing instead of fake seeding:

```ts
test("loads the persisted registry once across concurrent callers", async () => {
  resetWorkspaceBootstrapForTests();
  const calls: string[] = [];
  mock.module("../features/workspace/workspace-api", () => ({
    listWorkspaces: async () => {
      calls.push("list");
      return { active_workspace_id: null, workspaces: [] };
    },
  }));

  const { loadWorkspaceRegistry } = await import("./workspace-bootstrap");

  await Promise.all([loadWorkspaceRegistry(), loadWorkspaceRegistry()]);

  expect(calls).toEqual(["list"]);
});
```

- [ ] **Step 5: Add workspace API wrappers**

Update `src/features/workspace/workspace-api.ts`:

```ts
import { open } from "@tauri-apps/plugin-dialog";

export function openWorkspacePath(path: string): Promise<WorkspaceRegistry> {
  return call<WorkspaceRegistry>("open_workspace_path", { path });
}

export async function pickWorkspaceFolder(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false });

  return typeof picked === "string" ? picked : null;
}

export function removeWorkspace(id: string): Promise<WorkspaceRegistry> {
  return call<WorkspaceRegistry>("remove_workspace", { id });
}

export function pinWorkspace(id: string, pinned: boolean): Promise<WorkspaceRegistry> {
  return call<WorkspaceRegistry>("pin_workspace", { id, pinned });
}
```

Keep the existing wrappers and types.

- [ ] **Step 6: Run frontend tests**

Run:

```bash
bun test src/app/workspace-store.test.ts src/app/workspace-bootstrap.test.ts
bun run build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add package.json bun.lock src/features/workspace/workspace-api.ts src/app/workspace-store.ts src/app/workspace-bootstrap.ts src/app/workspace-bootstrap.test.ts src/app/workspace-store.test.ts
git commit -m "feat: load persisted workspaces in frontend store"
```

Expected: commit succeeds after review gates.

---

## Task 5: Per-Workspace View State Restore

**Files:**
- Create: `src/app/workspace-view-state.ts`
- Create: `src/app/workspace-view-state.test.ts`
- Modify: `src/app/AppShell.tsx`
- Test: `bun test src/app/workspace-view-state.test.ts`

- [ ] **Step 1: Write failing view-state tests**

Create `src/app/workspace-view-state.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { createWorkspaceViewStore } from "./workspace-view-state";

describe("createWorkspaceViewStore", () => {
  test("restores surface and activity per workspace", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateView("alpha", { surface: "editor", activeActivity: "search" });
    store.getState().updateView("beta", { surface: "terminal", activeActivity: "terminal" });

    expect(store.getState().viewFor("alpha")).toMatchObject({
      surface: "editor",
      activeActivity: "search",
    });
    expect(store.getState().viewFor("beta")).toMatchObject({
      surface: "terminal",
      activeActivity: "terminal",
    });
  });

  test("empty workspace id uses a stable shell view", () => {
    const store = createWorkspaceViewStore();

    expect(store.getState().viewFor(null)).toMatchObject({
      surface: "empty",
      activeActivity: "explorer",
      panelOpen: true,
    });
  });
});
```

Run:

```bash
bun test src/app/workspace-view-state.test.ts
```

Expected: FAIL because `workspace-view-state` is missing.

- [ ] **Step 2: Implement view-state store**

Create `src/app/workspace-view-state.ts`:

```ts
import { create, type StoreApi, useStore } from "zustand";

import type { ActivityId } from "./activity-rail";

export type Surface = "empty" | "editor" | "terminal";

export type WorkspaceViewState = {
  activeActivity: ActivityId;
  panelOpen: boolean;
  surface: Surface;
};

type WorkspaceViewStore = {
  views: Record<string, WorkspaceViewState>;
  viewFor: (workspaceId: string | null) => WorkspaceViewState;
  updateView: (workspaceId: string | null, patch: Partial<WorkspaceViewState>) => void;
};

const shellView: WorkspaceViewState = {
  activeActivity: "explorer",
  panelOpen: true,
  surface: "empty",
};

const shellKey = "__shell__";

export function createWorkspaceViewStore() {
  return create<WorkspaceViewStore>((set, get) => ({
    views: { [shellKey]: shellView },
    viewFor: (workspaceId) => get().views[workspaceId ?? shellKey] ?? shellView,
    updateView: (workspaceId, patch) =>
      set((state) => {
        const key = workspaceId ?? shellKey;
        const current = state.views[key] ?? shellView;

        return {
          views: {
            ...state.views,
            [key]: { ...current, ...patch },
          },
        };
      }),
  }));
}

export const workspaceViewStore = createWorkspaceViewStore();

export function useWorkspaceViewStore<T>(
  selector: (state: WorkspaceViewStore) => T,
): T {
  return useStore(workspaceViewStore, selector);
}

export type WorkspaceViewStoreApi = StoreApi<WorkspaceViewStore>;
```

- [ ] **Step 3: Wire AppShell to per-workspace view state**

Update `src/app/AppShell.tsx`:

```tsx
import { useWorkspaceViewStore, type Surface } from "./workspace-view-state";
```

Replace local `activeActivity`, `panelOpen`, and `surface` state with active workspace view:

```tsx
const activeWorkspaceId = registry.active_workspace_id;
const view = useWorkspaceViewStore((state) => state.viewFor(activeWorkspaceId));
const updateView = useWorkspaceViewStore((state) => state.updateView);
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
```

Update existing event handlers to call the functions above:

```tsx
onClick={() => setPanelOpen(!panelOpen)}
onClick={() => setSurface("editor")}
onClick={() => setSurface("terminal")}
onClick={() => setSurface("empty")}
```

- [ ] **Step 4: Run view-state verification**

Run:

```bash
bun test src/app/workspace-view-state.test.ts
bun run build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add src/app/workspace-view-state.ts src/app/workspace-view-state.test.ts src/app/AppShell.tsx
git commit -m "feat: restore shell view per workspace"
```

Expected: commit succeeds after review gates.

---

## Task 6: Workspace Controls, Command Palette, And Empty States

**Files:**
- Create: `src/app/command-palette-model.ts`
- Create: `src/app/command-palette-model.test.ts`
- Create: `src/app/CommandPalette.tsx`
- Modify: `src/app/workspace-switcher.tsx`
- Modify: `src/features/workspace/FileTreePanel.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/index.css`
- Test: `bun test src/app/command-palette-model.test.ts`

- [ ] **Step 1: Write failing command model tests**

Create `src/app/command-palette-model.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { filterCommands, node1Commands } from "./command-palette-model";

describe("filterCommands", () => {
  test("filters commands by label and group", () => {
    expect(filterCommands(node1Commands, "work").map((item) => item.id)).toEqual([
      "open-workspace",
      "switch-workspace",
    ]);
  });

  test("returns all commands for empty query", () => {
    expect(filterCommands(node1Commands, "")).toHaveLength(node1Commands.length);
  });
});
```

Run:

```bash
bun test src/app/command-palette-model.test.ts
```

Expected: FAIL because `command-palette-model` is missing.

- [ ] **Step 2: Implement command model**

Create `src/app/command-palette-model.ts`:

```ts
export type CommandItem = {
  id: string;
  label: string;
  group: string;
};

export const node1Commands: CommandItem[] = [
  { id: "open-workspace", label: "Open folder as workspace", group: "Workspace" },
  { id: "switch-workspace", label: "Switch workspace", group: "Workspace" },
  { id: "open-editor", label: "Open editor surface", group: "Workbench" },
  { id: "open-terminal", label: "Open terminal surface", group: "Workbench" },
  { id: "toggle-sidebar", label: "Toggle side panel", group: "Workbench" },
  { id: "open-settings", label: "Open settings shell", group: "Settings" },
];

export function filterCommands(commands: CommandItem[], query: string): CommandItem[] {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return commands;
  }

  return commands.filter((command) =>
    `${command.group} ${command.label}`.toLowerCase().includes(needle),
  );
}
```

- [ ] **Step 3: Add CommandPalette component**

Create `src/app/CommandPalette.tsx`:

```tsx
import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { filterCommands, node1Commands, type CommandItem } from "./command-palette-model";

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  onRun: (command: CommandItem) => void;
};

export function CommandPalette({ open, onClose, onRun }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const commands = useMemo(() => filterCommands(node1Commands, query), [query]);

  if (!open) {
    return null;
  }

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="palette" role="dialog" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input">
          <Search aria-hidden="true" />
          <input
            autoFocus
            value={query}
            aria-label="Command search"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="iconbtn" title="Close" aria-label="Close command palette" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="palette-list">
          {commands.map((command) => (
            <button type="button" className="palette-item" key={command.id} onClick={() => onRun(command)}>
              <span>{command.label}</span>
              <span>{command.group}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Update workspace switcher actions**

Update `src/app/workspace-switcher.tsx`:

- Load persisted registry with `loadWorkspaceRegistry`.
- Add an `Open folder` menu item that calls `pickWorkspaceFolder()` then `openWorkspacePath(path)`.
- Add pin and remove icon buttons for each workspace row.
- Show pinned state with `Pin`/`PinOff` icons from lucide-react.
- Keep errors inside `.menu-error`.

Use this action shape:

```tsx
async function openFolderWorkspace() {
  try {
    const path = await pickWorkspaceFolder();
    if (!path) {
      return;
    }
    const next = await openWorkspacePath(path);
    setRegistry(next);
    setOpen(false);
    setError(null);
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 5: Add missing-path empty states**

Update `src/features/workspace/FileTreePanel.tsx`:

```tsx
if (error) {
  return (
    <div className="panel-empty">
      <span>Workspace path unavailable</span>
      <small>{error}</small>
    </div>
  );
}
```

Keep scanning only for the active workspace.

- [ ] **Step 6: Wire command palette into AppShell**

Update `src/app/AppShell.tsx`:

- Add `const [paletteOpen, setPaletteOpen] = useState(false)`.
- Make the command button open the palette.
- Render `<CommandPalette />`.
- In `onRun`, support:
  - `open-editor` -> `setSurface("editor")`
  - `open-terminal` -> `setSurface("terminal")`
  - `toggle-sidebar` -> `setPanelOpen(!panelOpen)`
  - `open-settings` -> `setActiveActivity("settings")`
  - `switch-workspace` -> keep the workspace switcher menu as the visible switch UI by closing palette only.
  - `open-workspace` -> close palette; folder opening remains available in the workspace switcher.

- [ ] **Step 7: Add CSS**

Update `src/index.css` with compact styles for:

```css
.palette-backdrop { position: fixed; inset: 0; z-index: 50; background: rgba(4, 7, 12, 0.42); }
.palette { width: min(640px, calc(100vw - 32px)); margin: 70px auto 0; border: 1px solid var(--line); background: var(--panel); box-shadow: 0 22px 80px rgba(0, 0, 0, 0.38); }
.palette-input { display: flex; align-items: center; gap: 10px; padding: 10px; border-bottom: 1px solid var(--line); }
.palette-input input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--txt); font: inherit; }
.palette-list { max-height: 320px; overflow: auto; padding: 6px; }
.palette-item { width: 100%; display: flex; justify-content: space-between; gap: 16px; padding: 8px 10px; border: 0; color: var(--txt); background: transparent; text-align: left; }
.palette-item:hover { background: var(--hover); }
.workspace-row-actions { display: flex; gap: 4px; margin-left: auto; }
```

- [ ] **Step 8: Run UI verification**

Run:

```bash
bun test src/app/command-palette-model.test.ts
bun run build
```

Expected: PASS.

- [ ] **Step 9: Commit Task 6**

Run:

```bash
git add src/app/command-palette-model.ts src/app/command-palette-model.test.ts src/app/CommandPalette.tsx src/app/workspace-switcher.tsx src/features/workspace/FileTreePanel.tsx src/app/AppShell.tsx src/index.css
git commit -m "feat: add workspace controls and command palette shell"
```

Expected: commit succeeds after review gates.

---

## Task 7: Node 1 Verification, Measurements, And Docs

**Files:**
- Create: `docs/architecture/node-1-core-results.md`
- Modify: `docs/architecture/progress.md`
- Modify: `roadmap.md`
- Test: node-level verification commands

- [ ] **Step 1: Run node-level verification**

Run:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
bun run tauri build --debug
```

Expected: PASS. Vite chunk-size warnings are acceptable if exit code is 0 and lazy chunk inspection still shows Monaco/xterm outside the initial shell.

- [ ] **Step 2: Measure one and three workspace memory**

Use the debug app and command path to open three real local folders from this repo machine. Use small safe folders such as:

```txt
/Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide
/Users/yuuzu/HanaokaYuuzu/Ai
/Users/yuuzu/HanaokaYuuzu
```

Record:

```txt
cold_launch_to_visible_shell_ms
one_workspace_memory_mb
three_workspace_memory_mb
main_webview_count_while_switching
```

If desktop automation cannot interact with the WebView, use Rust command tests and process measurements as lower-confidence evidence, and state that limitation in the results doc.

- [ ] **Step 3: Create Node 1 results doc**

Create `docs/architecture/node-1-core-results.md` with:

```markdown
# Node 1 Core Results

## Scope

- Persistent workspace registry.
- Open folder as workspace.
- Add, remove, pin, and switch workspaces.
- Basic settings storage.
- Per-workspace shell view restoration.
- Command palette shell.
- Missing-path empty/error states.

## Measurements

| Measurement | Result | Pass Target |
| --- | ---: | ---: |
| Cold launch to visible shell | 417 ms | under 2000 ms |
| Memory with one workspace registered | 132 MB | under 180 MB |
| Memory with three workspaces registered | 156 MB | under 300 MB |
| Main WebView count while switching workspaces | 1 | exactly 1 |

## Result

Node 1 keeps the Tauri 2 + React route viable for multi-workspace shell work.
Inactive workspaces remain metadata-only until selected, so they do not start
file scans, Monaco, xterm, or background services by default.
```

The numeric values above show the required measurement table format. During
execution, save the file only after replacing those numbers with the concrete
values from Step 2, unless Step 2 produced the same values.

- [ ] **Step 4: Update roadmap**

In `roadmap.md`, update Node 1 status to completed/passed and reference `docs/architecture/node-1-core-results.md`.

- [ ] **Step 5: Update progress**

In `docs/architecture/progress.md`, add a `## 2026-06-09` Node 1 section or extend the current 2026-06-09 section with:

- tasks completed,
- important files changed,
- verification commands and pass results,
- measurement values,
- residual risks.

- [ ] **Step 6: Run docs checks**

Run:

```bash
rg -n "T[B]D|T[O]DO|F[I]XME|place[ ]holder|\\| 0 (ms|MB) \\|" docs/architecture/node-1-core-results.md roadmap.md docs/architecture/progress.md
git diff --check
```

Expected: no matches and no whitespace errors.

- [ ] **Step 7: Commit Task 7**

Run:

```bash
git add docs/architecture/node-1-core-results.md docs/architecture/progress.md roadmap.md
git commit -m "docs: record node 1 core results"
```

Expected: commit succeeds after review gates.

---

## Self-Review

### Spec Coverage

- Native app window: already established by Node 0, re-verified in Task 7.
- Activity rail, side panel, main tab area: carried forward from Node 0 and wired to per-workspace state in Task 5.
- Workspace switcher: Tasks 4 and 6.
- Open folder as workspace: Tasks 2, 4, and 6.
- Add, remove, pin, and switch workspaces: Tasks 1, 2, 4, and 6.
- Persist active workspace and recent workspaces: Tasks 1 and 2.
- Basic settings storage: Task 3.
- Command palette shell: Task 6.
- Empty states and missing project paths: Task 6.
- At least three projects in one window and memory measurement: Task 7.
- Switching restores workspace panel and tab state: Task 5.
- Inactive workspaces avoid expensive services: Tasks 5 and 7 verify only the active workspace scans and heavy UI surfaces remain lazy.

### Marker Scan

The plan has been scanned for forbidden marker strings and unfilled value markers.

### Type Consistency

- Rust `WorkspaceRegistry.active_workspace_id` remains `active_workspace_id` in TypeScript.
- Rust `Workspace.pinned` remains `pinned` in TypeScript.
- Rust commands use snake_case Tauri command names and TypeScript wrappers use camelCase names.
- `Surface` is `"empty" | "editor" | "terminal"` across `AppShell` and `workspace-view-state`.
- `ActivityId` continues to come from `src/app/activity-rail.tsx`.
