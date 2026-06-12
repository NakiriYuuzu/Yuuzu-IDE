# Node 12 Extension And Ecosystem Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first controlled extension layer: a shared command registry, workspace-scoped extension enablement, public API draft, theme/keybinding/snippet/hook contribution models, isolation boundaries, and slow-extension visibility.

**Architecture:** Rust owns extension manifests, workspace enablement, trusted workspace validation, contribution records, performance samples, and budget classification. React owns the Extensions rail panel, command palette composition, disable controls, and bounded workspace view state. The implementation follows `docs/ui-design/app.jsx`, `docs/ui-design/panels.jsx`, `docs/ui-design/data.jsx`, `docs/ui-design/ide.css`, and `docs/ui-design/scratchpad.md`: dense rail and panel rows, icon-only toolbar buttons with tooltips, yuzu-green accents, compact sections, no landing-page surface.

**Tech Stack:** Existing Tauri 2, Rust 2021, serde/serde_json, Vite, React 19.2.7, TypeScript 6.0.3, lucide-react 1.17.0, Zustand 5.0.14, Bun test, Cargo test/fmt/clippy. No new npm or Cargo dependency is required.

---

## Source References

- Roadmap Node 12: `roadmap.md` lines 604-629.
- Current priority: `roadmap.md` lines 706-760.
- Architecture boundary: `docs/architecture/tech-stack.md`.
- UI source of truth: `docs/ui-design/app.jsx`, `docs/ui-design/panels.jsx`, `docs/ui-design/data.jsx`, `docs/ui-design/ide.css`, `docs/ui-design/scratchpad.md`.
- Existing command palette model: `src/app/command-palette-model.ts`.
- Existing command palette UI: `src/app/CommandPalette.tsx`.
- Existing rail and panel patterns: `src/app/activity-rail.tsx`, `src/app/AppShell.tsx`, `src/index.css`.
- Existing Tauri command wiring: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`.

## Operating Contract

- All implementation and review subagents must run with `gpt-5.5` and `xhigh`.
- Do not use `gpt-5.4` for any Node 12 agent.
- Every behavior change must report RED, GREEN, and REFACTOR evidence.
- Implement tasks sequentially unless a coordinator proves disjoint file ownership.
- Preserve unrelated dirty-tree changes, including current untracked `docs/html/` and `docs/superpowers/plans/2026-06-11-git-deep-dive.md`.
- Commit after each verified task or coherent milestone inside `/Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide`.
- Node 12 does not introduce a marketplace or arbitrary extension host execution. The isolation model is a manifest/contribution boundary with explicit disabled state and performance budgets.

## File Structure

- Create `src-tauri/src/extensions.rs`: extension manifest types, builtin extension catalog, workspace enablement store, performance sample store, budget classification, and Rust tests.
- Modify `src-tauri/src/commands.rs`: workspace-scoped `extension_*` command wrappers and command tests.
- Modify `src-tauri/src/lib.rs`: expose `extensions` module, manage extension store in `AppState`, register commands.
- Create `src/features/extensions/extension-model.ts`: frontend extension state, reducers, command contribution mapping, slow badge helpers.
- Create `src/features/extensions/extension-model.test.ts`: reducer, disable, command contribution, and slow-budget tests.
- Create `src/features/extensions/extension-api.ts`: Tauri wrappers.
- Create `src/features/extensions/ExtensionPanel.tsx`: dense extension side panel with disable controls and contribution/performance sections.
- Create `src/features/extensions/ExtensionPanel.test.tsx`: panel behavior and accessibility tests.
- Create `src/app/command-registry.ts`: shared command registry for internal core commands and extension command contributions.
- Create `src/app/command-registry.test.ts`: command registry filtering, disabled extension filtering, and core command regression tests.
- Modify `src/app/command-palette-model.ts` and `src/app/command-palette-model.test.ts`: re-export core command arrays through the registry and add Node 12 commands.
- Modify `src/app/CommandPalette.tsx`: accept dynamic commands from AppShell while keeping the default static command list for isolated tests.
- Modify `src/app/activity-rail.tsx` and `src/app/activity-rail.test.tsx`: add Extensions activity with `Puzzle` icon and badge support.
- Modify `src/app/workspace-view-state.ts` and `src/app/workspace-view-state.test.ts`: add `extension` workspace view state and freeze rules.
- Modify `src/app/AppShell.tsx` and `src/app/AppShell.contract.test.tsx`: load extension status per workspace, render Extensions panel, dispatch extension commands, filter palette by disabled extension state, record extension command performance samples.
- Modify `src/index.css`: extension panel styles using existing row, badge, section-label, panel-body, and yuzu token language.
- Create `docs/architecture/extension-api-draft.md`: public extension API draft covering commands, themes, keybindings, snippets, workspace hooks, isolation, and performance budgets.
- Create `docs/architecture/node-12-extension-results.md`: final Node 12 evidence record.
- Modify `docs/architecture/progress.md` and `roadmap.md`: update Node 12 status after final verification.

---

### Task 1: Rust Extension Domain, Store, And Performance Budget

**Files:**
- Create: `src-tauri/src/extensions.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/extensions.rs`
- Test: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write failing Rust domain tests**

Create `src-tauri/src/extensions.rs` with tests first. The tests define the Rust API for the implementation:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_catalog_exposes_command_theme_keybinding_snippet_and_hook_contributions() {
        let catalog = ExtensionCatalog::builtin();
        let core = catalog
            .manifest("yuuzu.core")
            .expect("core extension manifest");
        assert!(core.builtin);
        assert!(core.contributes.commands.iter().any(|command| command.id == "open-editor"));
        assert!(core.contributes.themes.iter().any(|theme| theme.id == "yuuzu-dark"));
        assert!(core.contributes.keybindings.iter().any(|binding| binding.command == "open-command-palette"));
        assert!(core.contributes.snippets.iter().any(|snippet| snippet.prefix == "dbg"));
        assert!(core.contributes.workspace_hooks.iter().any(|hook| hook.event == ExtensionHookEvent::WorkspaceOpened));
    }

    #[test]
    fn workspace_store_disables_extension_without_affecting_other_workspaces() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = ExtensionWorkspaceStore::new(temp.path().join("extensions.json"));

        store
            .set_enabled("/repo-a", "yuuzu.debug-tools", false, || Ok(10))
            .expect("disable");

        assert!(!store
            .is_enabled("/repo-a", "yuuzu.debug-tools")
            .expect("repo-a enabled"));
        assert!(store
            .is_enabled("/repo-b", "yuuzu.debug-tools")
            .expect("repo-b enabled"));
    }

    #[test]
    fn extension_status_marks_disabled_extensions_and_filters_commands() {
        let catalog = ExtensionCatalog::builtin();
        let temp = tempfile::tempdir().expect("tempdir");
        let store = ExtensionWorkspaceStore::new(temp.path().join("extensions.json"));
        store
            .set_enabled("/repo-a", "yuuzu.debug-tools", false, || Ok(10))
            .expect("disable");

        let statuses = extension_statuses(&catalog, &store, "/repo-a").expect("statuses");
        let debug = statuses
            .iter()
            .find(|status| status.manifest.id == "yuuzu.debug-tools")
            .expect("debug tools status");
        assert!(!debug.enabled);

        let commands = enabled_command_contributions(&statuses);
        assert!(!commands.iter().any(|command| command.owner_extension_id == "yuuzu.debug-tools"));
        assert!(commands.iter().any(|command| command.id == "open-editor"));
    }

    #[test]
    fn performance_budget_identifies_slow_extensions() {
        let budget = ExtensionPerformanceBudget::default();
        let sample = ExtensionPerformanceSample {
            extension_id: "yuuzu.debug-tools".to_string(),
            workspace_root: "/repo-a".to_string(),
            operation: "command:debug-start-session".to_string(),
            duration_ms: budget.command_warn_ms + 10,
            budget_ms: budget.command_warn_ms,
            recorded_ms: 20,
        };

        assert!(sample.is_slow());
        assert_eq!(sample.classification(), ExtensionPerformanceClass::Slow);
    }
}
```

- [ ] **Step 2: Run Rust tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml extensions::
```

Expected: FAIL because `extensions` module, `ExtensionCatalog`, `ExtensionWorkspaceStore`, `ExtensionPerformanceSample`, and related types do not exist.

- [ ] **Step 3: Implement Rust extension domain**

Implement `src-tauri/src/extensions.rs` with these exact public types and functions:

```rust
use serde::{Deserialize, Serialize};
use std::{
    ffi::{OsStr, OsString},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ExtensionHookEvent {
    WorkspaceOpened,
    WorkspaceClosed,
    FileSaved,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionCommandContribution {
    pub id: String,
    pub label: String,
    pub group: String,
    pub description: String,
    pub owner_extension_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionThemeContribution {
    pub id: String,
    pub label: String,
    pub mode: String,
    pub accent: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionKeybindingContribution {
    pub command: String,
    pub key: String,
    pub when: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionSnippetContribution {
    pub id: String,
    pub language: String,
    pub prefix: String,
    pub body: Vec<String>,
    pub description: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionWorkspaceHookContribution {
    pub id: String,
    pub event: ExtensionHookEvent,
    pub command: String,
    pub budget_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionContributions {
    pub commands: Vec<ExtensionCommandContribution>,
    pub themes: Vec<ExtensionThemeContribution>,
    pub keybindings: Vec<ExtensionKeybindingContribution>,
    pub snippets: Vec<ExtensionSnippetContribution>,
    pub workspace_hooks: Vec<ExtensionWorkspaceHookContribution>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: String,
    pub description: String,
    pub builtin: bool,
    pub contributes: ExtensionContributions,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionWorkspaceStatus {
    pub manifest: ExtensionManifest,
    pub enabled: bool,
    pub disabled_by_workspace: bool,
    pub performance: ExtensionPerformanceSummary,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionPerformanceBudget {
    pub activation_warn_ms: u64,
    pub command_warn_ms: u64,
    pub hook_warn_ms: u64,
}

impl Default for ExtensionPerformanceBudget {
    fn default() -> Self {
        Self {
            activation_warn_ms: 200,
            command_warn_ms: 50,
            hook_warn_ms: 75,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ExtensionPerformanceClass {
    Ok,
    Slow,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionPerformanceSample {
    pub extension_id: String,
    pub workspace_root: String,
    pub operation: String,
    pub duration_ms: u64,
    pub budget_ms: u64,
    pub recorded_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionPerformanceSummary {
    pub last_duration_ms: Option<u64>,
    pub slow_operation_count: usize,
    pub sample_count: usize,
    pub class: ExtensionPerformanceClass,
}
```

Use an atomic JSON save pattern matching `src-tauri/src/settings.rs`. Define `ExtensionCatalog::builtin()` with three builtin manifests:

- `yuuzu.core`: owns existing internal command registry contributions such as `open-editor`, `open-terminal`, `toggle-sidebar`, `save-file`, `search-workspace`, `open-settings`.
- `yuuzu.debug-tools`: owns debug contributed commands such as `open-debug`, `debug-start-session`, and one `dbg` snippet.
- `yuuzu.theme-yuzu`: owns `yuuzu-dark` and `yuuzu-light` theme contributions plus a keybinding contribution for `open-command-palette`.

Do not execute hooks. Store hook contributions as inert records for the public API draft and panel display.

- [ ] **Step 4: Wire Rust commands and AppState**

Modify `src-tauri/src/commands.rs`:

```rust
use crate::extensions::{
    ExtensionCommandContribution, ExtensionPerformanceSample, ExtensionWorkspaceStatus,
};
```

Add an `extension_store: crate::extensions::ExtensionWorkspaceStore` field to `AppState`, initialized in `AppState::new(config_dir)` at `config_dir/extensions-workspace.json`.

Add methods:

```rust
pub fn extension_statuses(&self, workspace_root: &str) -> Result<Vec<ExtensionWorkspaceStatus>, String> {
    let workspace_root = self.trusted_workspace_root(workspace_root)?;
    crate::extensions::extension_statuses(
        &crate::extensions::ExtensionCatalog::builtin(),
        &self.extension_store,
        &workspace_root.to_string_lossy(),
    )
}

pub fn set_extension_enabled(
    &self,
    workspace_root: &str,
    extension_id: String,
    enabled: bool,
) -> Result<Vec<ExtensionWorkspaceStatus>, String> {
    let workspace_root = self.trusted_workspace_root(workspace_root)?;
    let root = workspace_root.to_string_lossy().to_string();
    self.extension_store
        .set_enabled(&root, &extension_id, enabled, current_time_ms)?;
    self.extension_statuses(&root)
}

pub fn record_extension_performance(
    &self,
    workspace_root: &str,
    sample: ExtensionPerformanceSample,
) -> Result<Vec<ExtensionWorkspaceStatus>, String> {
    let workspace_root = self.trusted_workspace_root(workspace_root)?;
    self.extension_store
        .record_performance(&workspace_root.to_string_lossy(), sample)?;
    self.extension_statuses(&workspace_root.to_string_lossy())
}
```

Add Tauri commands:

```rust
#[tauri::command]
pub fn extension_statuses(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<ExtensionWorkspaceStatus>, String> {
    state.extension_statuses(&workspace_root)
}

#[tauri::command]
pub fn set_extension_enabled(
    state: State<'_, AppState>,
    workspace_root: String,
    extension_id: String,
    enabled: bool,
) -> Result<Vec<ExtensionWorkspaceStatus>, String> {
    state.set_extension_enabled(&workspace_root, extension_id, enabled)
}

#[tauri::command]
pub fn record_extension_performance(
    state: State<'_, AppState>,
    workspace_root: String,
    sample: ExtensionPerformanceSample,
) -> Result<Vec<ExtensionWorkspaceStatus>, String> {
    state.record_extension_performance(&workspace_root, sample)
}
```

Modify `src-tauri/src/lib.rs`:

```rust
pub mod extensions;
```

Register the three commands in `tauri::generate_handler!`.

- [ ] **Step 5: Add command wrapper tests**

Add command tests in `src-tauri/src/commands.rs`:

```rust
#[test]
fn extension_commands_require_registered_workspace() {
    let config = tempfile::tempdir().expect("config");
    let unregistered = tempfile::tempdir().expect("unregistered workspace");
    let state = AppState::new(config.path()).expect("state");

    let error = state
        .extension_statuses(&unregistered.path().to_string_lossy())
        .expect_err("unregistered workspace rejected");

    assert!(error.contains("workspace not registered"));
}

#[test]
fn extension_enablement_is_workspace_scoped_through_app_state() {
    let (_config, state, workspace_a, workspace_b, _workspace_a_id, _workspace_b_id) =
        app_state_with_two_workspaces();

    let disabled = state
        .set_extension_enabled(&workspace_a.to_string_lossy(), "yuuzu.debug-tools".to_string(), false)
        .expect("disable");
    let enabled_elsewhere = state
        .extension_statuses(&workspace_b.to_string_lossy())
        .expect("workspace b statuses");

    assert!(!disabled
        .iter()
        .find(|status| status.manifest.id == "yuuzu.debug-tools")
        .expect("debug tools")
        .enabled);
    assert!(enabled_elsewhere
        .iter()
        .find(|status| status.manifest.id == "yuuzu.debug-tools")
        .expect("debug tools b")
        .enabled);
}
```

- [ ] **Step 6: Run Rust focused tests to verify GREEN**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml extensions::
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml commands::tests::extension_
```

Expected: PASS.

- [ ] **Step 7: Refactor and verify**

Run:

```bash
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml extensions:: commands::tests::extension_
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/extensions.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add extension registry domain"
```

---

### Task 2: Frontend Extension Model, API, And Panel

**Files:**
- Create: `src/features/extensions/extension-model.ts`
- Create: `src/features/extensions/extension-model.test.ts`
- Create: `src/features/extensions/extension-api.ts`
- Create: `src/features/extensions/ExtensionPanel.tsx`
- Create: `src/features/extensions/ExtensionPanel.test.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing frontend model tests**

Create `src/features/extensions/extension-model.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  createExtensionState,
  extensionBadgeCount,
  extensionCommands,
  replaceExtensionStatuses,
  setExtensionLoading,
  slowExtensionStatuses,
  toggleExtensionStatus,
  type ExtensionWorkspaceStatus,
} from "./extension-model";

function status(
  id: string,
  enabled: boolean,
  slowOperationCount = 0,
): ExtensionWorkspaceStatus {
  return {
    manifest: {
      id,
      name: id === "yuuzu.core" ? "Yuuzu Core" : "Debug Tools",
      version: "0.1.0",
      api_version: "0.1",
      description: "test extension",
      builtin: true,
      contributes: {
        commands: [{
          id: `${id}.command`,
          label: `${id} command`,
          group: "Extensions",
          description: "test command",
          owner_extension_id: id,
        }],
        themes: [],
        keybindings: [],
        snippets: [],
        workspace_hooks: [],
      },
    },
    enabled,
    disabled_by_workspace: !enabled,
    performance: {
      last_duration_ms: slowOperationCount > 0 ? 90 : 10,
      slow_operation_count: slowOperationCount,
      sample_count: slowOperationCount > 0 ? 3 : 1,
      class: slowOperationCount > 0 ? "Slow" : "Ok",
    },
  };
}

describe("extension model", () => {
  test("stores statuses and active extension without mutating caller data", () => {
    const statuses = [status("yuuzu.core", true), status("yuuzu.debug-tools", false)];
    const state = replaceExtensionStatuses(createExtensionState(), statuses);
    statuses[0].manifest.name = "mutated";

    expect(state.statuses[0].manifest.name).toBe("Yuuzu Core");
    expect(state.activeExtensionId).toBe("yuuzu.core");
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  test("filters command contributions for enabled extensions only", () => {
    const state = replaceExtensionStatuses(createExtensionState(), [
      status("yuuzu.core", true),
      status("yuuzu.debug-tools", false),
    ]);

    expect(extensionCommands(state).map((command) => command.id)).toEqual([
      "yuuzu.core.command",
    ]);
  });

  test("reports slow extension badge count", () => {
    const state = replaceExtensionStatuses(createExtensionState(), [
      status("yuuzu.core", true),
      status("yuuzu.debug-tools", true, 2),
    ]);

    expect(slowExtensionStatuses(state).map((item) => item.manifest.id)).toEqual([
      "yuuzu.debug-tools",
    ]);
    expect(extensionBadgeCount(state)).toBe("1");
  });

  test("toggle status updates only the matching extension", () => {
    const state = replaceExtensionStatuses(createExtensionState(), [
      status("yuuzu.core", true),
      status("yuuzu.debug-tools", true),
    ]);

    const next = toggleExtensionStatus(state, "yuuzu.debug-tools", false);

    expect(next.statuses.find((item) => item.manifest.id === "yuuzu.core")?.enabled).toBe(true);
    expect(next.statuses.find((item) => item.manifest.id === "yuuzu.debug-tools")?.enabled).toBe(false);
  });

  test("loading state clears previous errors", () => {
    const errored = { ...createExtensionState(), error: "failed" };

    expect(setExtensionLoading(errored)).toMatchObject({
      loading: true,
      error: null,
    });
  });
});
```

- [ ] **Step 2: Run model tests to verify RED**

Run:

```bash
bun test src/features/extensions/extension-model.test.ts
```

Expected: FAIL because `extension-model.ts` does not exist.

- [ ] **Step 3: Implement frontend model and API**

Create `src/features/extensions/extension-model.ts` with matching TypeScript types for Rust serde output:

```ts
export type ExtensionPerformanceClass = "Ok" | "Slow";
export type ExtensionHookEvent = "WorkspaceOpened" | "WorkspaceClosed" | "FileSaved";

export type ExtensionCommandContribution = {
  id: string;
  label: string;
  group: string;
  description: string;
  owner_extension_id: string;
};

export type ExtensionThemeContribution = {
  id: string;
  label: string;
  mode: string;
  accent: string;
};

export type ExtensionKeybindingContribution = {
  command: string;
  key: string;
  when: string;
};

export type ExtensionSnippetContribution = {
  id: string;
  language: string;
  prefix: string;
  body: string[];
  description: string;
};

export type ExtensionWorkspaceHookContribution = {
  id: string;
  event: ExtensionHookEvent;
  command: string;
  budget_ms: number;
};

export type ExtensionContributions = {
  commands: ExtensionCommandContribution[];
  themes: ExtensionThemeContribution[];
  keybindings: ExtensionKeybindingContribution[];
  snippets: ExtensionSnippetContribution[];
  workspace_hooks: ExtensionWorkspaceHookContribution[];
};

export type ExtensionManifest = {
  id: string;
  name: string;
  version: string;
  api_version: string;
  description: string;
  builtin: boolean;
  contributes: ExtensionContributions;
};

export type ExtensionPerformanceSummary = {
  last_duration_ms: number | null;
  slow_operation_count: number;
  sample_count: number;
  class: ExtensionPerformanceClass;
};

export type ExtensionPerformanceSample = {
  extension_id: string;
  workspace_root: string;
  operation: string;
  duration_ms: number;
  budget_ms: number;
  recorded_ms: number;
};

export type ExtensionWorkspaceStatus = {
  manifest: ExtensionManifest;
  enabled: boolean;
  disabled_by_workspace: boolean;
  performance: ExtensionPerformanceSummary;
};

export type ExtensionViewState = {
  statuses: ExtensionWorkspaceStatus[];
  activeExtensionId: string | null;
  loading: boolean;
  error: string | null;
};
```

Implement `createExtensionState`, `replaceExtensionStatuses`, `toggleExtensionStatus`, `setExtensionLoading`, `setExtensionError`, `activeExtensionStatus`, `extensionCommands`, `slowExtensionStatuses`, and `extensionBadgeCount`. Clone nested arrays and objects before storing.

Create `src/features/extensions/extension-api.ts`:

```ts
import { call } from "../../lib/tauri";
import type {
  ExtensionPerformanceSample,
  ExtensionWorkspaceStatus,
} from "./extension-model";

export function listExtensionStatuses(
  workspaceRoot: string,
): Promise<ExtensionWorkspaceStatus[]> {
  return call("extension_statuses", { workspaceRoot });
}

export function setExtensionEnabled(args: {
  workspaceRoot: string;
  extensionId: string;
  enabled: boolean;
}): Promise<ExtensionWorkspaceStatus[]> {
  return call("set_extension_enabled", {
    workspaceRoot: args.workspaceRoot,
    extensionId: args.extensionId,
    enabled: args.enabled,
  });
}

export function recordExtensionPerformance(args: {
  workspaceRoot: string;
  sample: ExtensionPerformanceSample;
}): Promise<ExtensionWorkspaceStatus[]> {
  return call("record_extension_performance", {
    workspaceRoot: args.workspaceRoot,
    sample: args.sample,
  });
}
```

- [ ] **Step 4: Write failing panel tests**

Create `src/features/extensions/ExtensionPanel.test.tsx`:

```tsx
/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { ensureTestDom } from "../../app/test-dom";
import {
  createExtensionState,
  replaceExtensionStatuses,
  type ExtensionWorkspaceStatus,
} from "./extension-model";
import { ExtensionPanel } from "./ExtensionPanel";

ensureTestDom();

const { cleanup, fireEvent, render } = await import("@testing-library/react");

afterEach(() => cleanup());

function status(
  id: string,
  enabled: boolean,
  slow = false,
): ExtensionWorkspaceStatus {
  return {
    manifest: {
      id,
      name: id === "yuuzu.core" ? "Yuuzu Core" : "Debug Tools",
      version: "0.1.0",
      api_version: "0.1",
      description: "test extension",
      builtin: true,
      contributes: {
        commands: [{
          id: `${id}.command`,
          label: `${id} command`,
          group: "Extensions",
          description: "test command",
          owner_extension_id: id,
        }],
        themes: [{ id: "yuuzu-dark", label: "Yuzu Dark", mode: "dark", accent: "#a8e23f" }],
        keybindings: [{ command: `${id}.command`, key: "cmd+shift+x", when: "workspace" }],
        snippets: [{ id: "snippet", language: "typescript", prefix: "dbg", body: ["console.log($1);"], description: "Debug log" }],
        workspace_hooks: [{ id: "hook", event: "WorkspaceOpened", command: `${id}.command`, budget_ms: 75 }],
      },
    },
    enabled,
    disabled_by_workspace: !enabled,
    performance: {
      last_duration_ms: slow ? 92 : 12,
      slow_operation_count: slow ? 2 : 0,
      sample_count: slow ? 4 : 1,
      class: slow ? "Slow" : "Ok",
    },
  };
}

describe("ExtensionPanel", () => {
  test("renders extension status, contributions, and slow budget", () => {
    const state = replaceExtensionStatuses(createExtensionState(), [
      status("yuuzu.core", true),
      status("yuuzu.debug-tools", true, true),
    ]);

    const result = render(
      <ExtensionPanel
        state={state}
        onRefresh={() => {}}
        onSelectExtension={() => {}}
        onToggleExtension={() => {}}
      />,
    );

    expect(result.getByText("Yuuzu Core")).toBeTruthy();
    expect(result.getByText("Debug Tools")).toBeTruthy();
    expect(result.getByText("Slow")).toBeTruthy();
    expect(result.getByText("Commands")).toBeTruthy();
    expect(result.getByText("Snippets")).toBeTruthy();
    expect(result.getByText("Workspace hooks")).toBeTruthy();
  });

  test("toggles extension enablement", () => {
    const onToggleExtension = mock(() => {});
    const state = replaceExtensionStatuses(createExtensionState(), [
      status("yuuzu.debug-tools", true),
    ]);

    const result = render(
      <ExtensionPanel
        state={state}
        onRefresh={() => {}}
        onSelectExtension={() => {}}
        onToggleExtension={onToggleExtension}
      />,
    );

    fireEvent.click(result.getByLabelText("Disable Debug Tools"));

    expect(onToggleExtension).toHaveBeenCalledWith("yuuzu.debug-tools", false);
  });

  test("shows disabled workspace state", () => {
    const state = replaceExtensionStatuses(createExtensionState(), [
      status("yuuzu.debug-tools", false),
    ]);

    const result = render(
      <ExtensionPanel
        state={state}
        onRefresh={() => {}}
        onSelectExtension={() => {}}
        onToggleExtension={() => {}}
      />,
    );

    expect(result.getByText("Disabled")).toBeTruthy();
    expect(result.getByLabelText("Enable Debug Tools")).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run panel tests to verify RED**

Run:

```bash
bun test src/features/extensions/ExtensionPanel.test.tsx
```

Expected: FAIL because `ExtensionPanel.tsx` does not exist.

- [ ] **Step 6: Implement ExtensionPanel and styles**

Create `src/features/extensions/ExtensionPanel.tsx` using lucide icons `Puzzle`, `Power`, `RefreshCw`, `Zap`, `Gauge`, `Keyboard`, `Palette`, `FileCode2`, `Workflow`.

Panel structure:

- Top `panel-head` title `Extensions` with refresh icon button.
- `panel-body extension-panel`.
- `section-label` `Installed` and count.
- Rows with extension name, id/version, enabled/disabled badge, slow/ok badge, and icon-only enable/disable button.
- Details for the active extension: commands, themes, keybindings, snippets, workspace hooks.

Append CSS to `src/index.css`:

```css
.extension-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.extension-row,
.extension-contribution-row {
  align-items: center;
  min-height: 34px;
}

.extension-row-main,
.extension-contribution-main {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.extension-row-title,
.extension-contribution-title {
  color: var(--txt);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extension-row-sub,
.extension-contribution-sub {
  color: var(--txt-faint);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extension-detail {
  border-top: 1px solid var(--line);
  padding-top: 6px;
}

.extension-slow {
  color: var(--yuzu);
}
```

- [ ] **Step 7: Run frontend focused tests to verify GREEN**

Run:

```bash
bun test src/features/extensions/extension-model.test.ts src/features/extensions/ExtensionPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Refactor and verify**

Run:

```bash
bunx tsc --noEmit
bun test src/features/extensions/extension-model.test.ts src/features/extensions/ExtensionPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/extensions/extension-model.ts src/features/extensions/extension-model.test.ts src/features/extensions/extension-api.ts src/features/extensions/ExtensionPanel.tsx src/features/extensions/ExtensionPanel.test.tsx src/index.css
git commit -m "feat: add extension frontend model"
```

---

### Task 3: Shared Command Registry And Dynamic Palette

**Files:**
- Create: `src/app/command-registry.ts`
- Create: `src/app/command-registry.test.ts`
- Modify: `src/app/command-palette-model.ts`
- Modify: `src/app/command-palette-model.test.ts`
- Modify: `src/app/CommandPalette.tsx`

- [ ] **Step 1: Write failing command registry tests**

Create `src/app/command-registry.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  commandItemsForPalette,
  coreCommandContributions,
  extensionContributionsForPalette,
  registeredCoreCommandIds,
} from "./command-registry";
import type { ExtensionCommandContribution } from "../features/extensions/extension-model";

describe("command registry", () => {
  test("registers existing internal commands as core contributions", () => {
    expect(registeredCoreCommandIds()).toEqual(
      expect.arrayContaining([
        "open-editor",
        "open-terminal",
        "open-debug",
        "open-database",
        "open-remote",
        "open-extensions",
      ]),
    );
    expect(coreCommandContributions.every((command) => command.owner_extension_id === "yuuzu.core")).toBe(true);
  });

  test("maps enabled extension command contributions into palette items", () => {
    const extensionCommand: ExtensionCommandContribution = {
      id: "yuuzu.debug-tools.inspect-session",
      label: "Debug Tools: Inspect session",
      group: "Extensions",
      description: "Inspect the active debug session",
      owner_extension_id: "yuuzu.debug-tools",
    };

    expect(extensionContributionsForPalette([extensionCommand], new Set()).map((item) => item.id)).toEqual([
      "yuuzu.debug-tools.inspect-session",
    ]);
    expect(extensionContributionsForPalette([extensionCommand], new Set(["yuuzu.debug-tools"]))).toEqual([]);
  });

  test("builds palette command list from core and extension contributions", () => {
    const extensionCommand: ExtensionCommandContribution = {
      id: "yuuzu.theme-yuzu.apply-dark",
      label: "Theme: Apply Yuzu Dark",
      group: "Theme",
      description: "Apply Yuzu Dark",
      owner_extension_id: "yuuzu.theme-yuzu",
    };

    const commands = commandItemsForPalette([extensionCommand], new Set());

    expect(commands.map((command) => command.id)).toContain("open-editor");
    expect(commands.map((command) => command.id)).toContain("yuuzu.theme-yuzu.apply-dark");
  });
});
```

- [ ] **Step 2: Run registry tests to verify RED**

Run:

```bash
bun test src/app/command-registry.test.ts
```

Expected: FAIL because `command-registry.ts` does not exist.

- [ ] **Step 3: Implement command registry**

Create `src/app/command-registry.ts`:

```ts
import type { ExtensionCommandContribution } from "../features/extensions/extension-model";
import type { CommandItem } from "./command-palette-model";

export type CommandContribution = ExtensionCommandContribution;

export const coreCommandContributions: CommandContribution[] = [
  { id: "open-workspace", label: "Open folder as workspace", group: "Workspace", description: "Open a folder as a workspace", owner_extension_id: "yuuzu.core" },
  { id: "switch-workspace", label: "Switch workspace", group: "Workspace", description: "Switch active workspace", owner_extension_id: "yuuzu.core" },
  { id: "open-editor", label: "Open editor surface", group: "Workbench", description: "Focus the editor surface", owner_extension_id: "yuuzu.core" },
  { id: "open-terminal", label: "Open terminal surface", group: "Workbench", description: "Open the terminal surface", owner_extension_id: "yuuzu.core" },
  { id: "toggle-sidebar", label: "Toggle side panel", group: "Workbench", description: "Show or hide the side panel", owner_extension_id: "yuuzu.core" },
  { id: "open-settings", label: "Open settings shell", group: "Settings", description: "Open settings", owner_extension_id: "yuuzu.core" },
  { id: "new-terminal", label: "Terminal: New terminal", group: "Terminal", description: "Start a terminal", owner_extension_id: "yuuzu.core" },
  { id: "run-task", label: "Tasks: Run selected task", group: "Tasks", description: "Run selected task", owner_extension_id: "yuuzu.core" },
  { id: "rerun-task", label: "Tasks: Rerun last task", group: "Tasks", description: "Rerun last task", owner_extension_id: "yuuzu.core" },
  { id: "stop-task", label: "Tasks: Stop running task", group: "Tasks", description: "Stop active task", owner_extension_id: "yuuzu.core" },
  { id: "save-file", label: "Save active file", group: "File", description: "Save active file", owner_extension_id: "yuuzu.core" },
  { id: "find-in-file", label: "Find in file", group: "File", description: "Find in the active editor", owner_extension_id: "yuuzu.core" },
  { id: "search-workspace", label: "Search workspace", group: "Search", description: "Search current workspace", owner_extension_id: "yuuzu.core" },
  { id: "open-docs", label: "Docs: Open docs panel", group: "Docs", description: "Open docs panel", owner_extension_id: "yuuzu.core" },
  { id: "refresh-docs-index", label: "Docs: Refresh index", group: "Docs", description: "Refresh docs index", owner_extension_id: "yuuzu.core" },
  { id: "create-context-pack", label: "Docs: Create context pack", group: "Docs", description: "Create context pack", owner_extension_id: "yuuzu.core" },
  { id: "open-language", label: "Language: Open diagnostics", group: "Language", description: "Open language diagnostics", owner_extension_id: "yuuzu.core" },
  { id: "language-refresh", label: "Language: Refresh diagnostics", group: "Language", description: "Refresh language diagnostics", owner_extension_id: "yuuzu.core" },
  { id: "language-restart", label: "Language: Restart active server", group: "Language", description: "Restart active language server", owner_extension_id: "yuuzu.core" },
  { id: "open-agents", label: "Agents: Open workbench", group: "Agents", description: "Open agent workbench", owner_extension_id: "yuuzu.core" },
  { id: "agent-start-session", label: "Agents: Start session", group: "Agents", description: "Start agent session", owner_extension_id: "yuuzu.core" },
  { id: "agent-export-prompt", label: "Agents: Export prompt", group: "Agents", description: "Export agent prompt", owner_extension_id: "yuuzu.core" },
  { id: "open-browser-preview", label: "Browser: Open preview", group: "Browser", description: "Open browser preview", owner_extension_id: "yuuzu.core" },
  { id: "browser-reload", label: "Browser: Reload preview", group: "Browser", description: "Reload browser preview", owner_extension_id: "yuuzu.core" },
  { id: "browser-hard-reload", label: "Browser: Hard reload preview", group: "Browser", description: "Hard reload browser preview", owner_extension_id: "yuuzu.core" },
  { id: "browser-capture-screenshot", label: "Browser: Capture screenshot", group: "Browser", description: "Capture browser screenshot", owner_extension_id: "yuuzu.core" },
  { id: "open-database", label: "Database: Open panel", group: "Database", description: "Open database panel", owner_extension_id: "yuuzu.core" },
  { id: "database-refresh", label: "Database: Refresh profiles", group: "Database", description: "Refresh database profiles", owner_extension_id: "yuuzu.core" },
  { id: "open-remote", label: "Remote: Open panel", group: "Remote", description: "Open remote panel", owner_extension_id: "yuuzu.core" },
  { id: "remote-connect", label: "Remote: Connect active host", group: "Remote", description: "Connect active remote host", owner_extension_id: "yuuzu.core" },
  { id: "remote-open-ssh", label: "Remote: Open SSH terminal", group: "Remote", description: "Open SSH terminal", owner_extension_id: "yuuzu.core" },
  { id: "remote-open-sftp", label: "Remote: Open SFTP browser", group: "Remote", description: "Open SFTP browser", owner_extension_id: "yuuzu.core" },
  { id: "open-debug", label: "Debug: Open panel", group: "Debug", description: "Open debug workbench", owner_extension_id: "yuuzu.core" },
  { id: "debug-start-session", label: "Debug: Start session", group: "Debug", description: "Start selected debug configuration", owner_extension_id: "yuuzu.core" },
  { id: "debug-continue", label: "Debug: Continue", group: "Debug", description: "Continue active debug session", owner_extension_id: "yuuzu.core" },
  { id: "debug-step-over", label: "Debug: Step over", group: "Debug", description: "Step over active debug session", owner_extension_id: "yuuzu.core" },
  { id: "debug-pause", label: "Debug: Pause", group: "Debug", description: "Pause active debug session", owner_extension_id: "yuuzu.core" },
  { id: "debug-disconnect", label: "Debug: Disconnect", group: "Debug", description: "Disconnect active debug session", owner_extension_id: "yuuzu.core" },
  { id: "debug-toggle-breakpoint", label: "Debug: Toggle breakpoint", group: "Debug", description: "Toggle breakpoint in active editor", owner_extension_id: "yuuzu.core" },
  { id: "open-extensions", label: "Extensions: Open panel", group: "Extensions", description: "Open extensions panel", owner_extension_id: "yuuzu.core" },
  { id: "extension-refresh", label: "Extensions: Refresh", group: "Extensions", description: "Refresh extension status", owner_extension_id: "yuuzu.core" },
];

export function registeredCoreCommandIds(): string[] {
  return coreCommandContributions.map((command) => command.id);
}

export function toCommandItem(command: CommandContribution): CommandItem {
  return {
    id: command.id,
    label: command.label,
    group: command.group,
    description: command.description,
  };
}

export function extensionContributionsForPalette(
  commands: ExtensionCommandContribution[],
  disabledExtensionIds: Set<string>,
): CommandItem[] {
  return commands
    .filter((command) => !disabledExtensionIds.has(command.owner_extension_id))
    .map(toCommandItem);
}

export function commandItemsForPalette(
  extensionCommands: ExtensionCommandContribution[],
  disabledExtensionIds: Set<string>,
): CommandItem[] {
  return [
    ...coreCommandContributions.map(toCommandItem),
    ...extensionContributionsForPalette(extensionCommands, disabledExtensionIds),
  ];
}
```

- [ ] **Step 4: Refactor command-palette-model through registry**

Modify `src/app/command-palette-model.ts` to keep existing exports while deriving command arrays from `coreCommandContributions`. Keep existing tests green by preserving labels/groups for Node 1-11 commands.

Add Node 12 commands:

```ts
export const node12Commands: CommandItem[] = [
  {
    id: "open-extensions",
    label: "Extensions: Open panel",
    group: "Extensions",
    description: "Open the extension registry panel",
  },
  {
    id: "extension-refresh",
    label: "Extensions: Refresh",
    group: "Extensions",
    description: "Refresh workspace extension status",
  },
];
```

Update `allCommands` to include `node12Commands`.

Modify `src/app/CommandPalette.tsx` so it accepts optional dynamic commands:

```tsx
type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  onRun: (id: string) => void;
  commands?: CommandItem[];
};

export function CommandPalette({
  open,
  onClose,
  onRun,
  commands: commandItems = allCommands,
}: CommandPaletteProps) {
  const commands = useMemo(
    () => filterCommands(commandItems, query),
    [commandItems, query],
  );
  // existing rendering stays unchanged
}
```

- [ ] **Step 5: Update command palette tests**

Add tests in `src/app/command-palette-model.test.ts`:

```ts
test("includes node 12 extension commands in palette", () => {
  expect(node12Commands).toEqual([
    {
      id: "open-extensions",
      label: "Extensions: Open panel",
      group: "Extensions",
      description: "Open the extension registry panel",
    },
    {
      id: "extension-refresh",
      label: "Extensions: Refresh",
      group: "Extensions",
      description: "Refresh workspace extension status",
    },
  ]);
  expect(allCommands.map((command) => command.id)).toEqual(
    expect.arrayContaining(["open-extensions", "extension-refresh"]),
  );
});

test("searches extension commands", () => {
  const filtered = filterCommands(allCommands, "extensions");
  const ids = filtered.map((command) => command.id);

  expect(ids).toContain("open-extensions");
  expect(ids).toContain("extension-refresh");
});
```

- [ ] **Step 6: Run command tests to verify GREEN**

Run:

```bash
bun test src/app/command-registry.test.ts src/app/command-palette-model.test.ts
```

Expected: PASS.

- [ ] **Step 7: Refactor and verify**

Run:

```bash
bunx tsc --noEmit
bun test src/app/command-registry.test.ts src/app/command-palette-model.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/command-registry.ts src/app/command-registry.test.ts src/app/command-palette-model.ts src/app/command-palette-model.test.ts src/app/CommandPalette.tsx
git commit -m "feat: route palette through extension command registry"
```

---

### Task 4: AppShell Extensions Integration

**Files:**
- Modify: `src/app/activity-rail.tsx`
- Modify: `src/app/activity-rail.test.tsx`
- Modify: `src/app/workspace-view-state.ts`
- Modify: `src/app/workspace-view-state.test.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.contract.test.tsx`

- [ ] **Step 1: Write failing activity and workspace tests**

Update `src/app/activity-rail.test.tsx`:

```tsx
test("renders extensions activity and notifies callback", () => {
  const onSelect = mock(() => {});
  const result = render(
    <ActivityRail
      active="explorer"
      badges={{ extensions: "1" }}
      onSelect={onSelect}
    />,
  );

  expect(result.getByLabelText("Extensions")).toBeTruthy();
  expect(result.getByText("1")).toBeTruthy();

  fireEvent.click(result.getByLabelText("Extensions"));

  expect(onSelect).toHaveBeenCalledWith("extensions");
});
```

Update `src/app/workspace-view-state.test.ts`:

```ts
import { replaceExtensionStatuses } from "../features/extensions/extension-model";

test("extension state is restored per workspace", () => {
  const store = createWorkspaceViewStore();

  store.getState().updateExtension("workspace-a", (extension) =>
    replaceExtensionStatuses(extension, [{
      manifest: {
        id: "yuuzu.core",
        name: "Yuuzu Core",
        version: "0.1.0",
        api_version: "0.1",
        description: "Core commands",
        builtin: true,
        contributes: {
          commands: [],
          themes: [],
          keybindings: [],
          snippets: [],
          workspace_hooks: [],
        },
      },
      enabled: true,
      disabled_by_workspace: false,
      performance: {
        last_duration_ms: null,
        slow_operation_count: 0,
        sample_count: 0,
        class: "Ok",
      },
    }]),
  );

  expect(store.getState().viewFor("workspace-a").extension.statuses).toHaveLength(1);
  expect(store.getState().viewFor("workspace-b").extension.statuses).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/app/activity-rail.test.tsx src/app/workspace-view-state.test.ts
```

Expected: FAIL because `extensions` activity and `updateExtension` state do not exist.

- [ ] **Step 3: Implement activity and workspace state**

Modify `src/app/activity-rail.tsx`:

```tsx
import { Puzzle } from "lucide-react";
// ...
export type KnownActivityId =
  | "explorer"
  | "search"
  | "git"
  | "debug"
  | "terminal"
  | "tasks"
  | "docs"
  | "language"
  | "agents"
  | "extensions"
  | "remote"
  | "database"
  | "settings"
  | "browser";

const activities: ActivityItem[] = [
  // existing entries
  { id: "extensions", label: "Extensions", icon: Puzzle },
  // existing entries
];
```

Modify `src/app/workspace-view-state.ts`:

- Import `createExtensionState` and `type ExtensionViewState`.
- Add `extension: ExtensionViewState` to `WorkspaceViewState`.
- Add `updateExtension` to `WorkspaceViewStore`.
- Initialize `extension: createExtensionState()` in `defaultWorkspaceView()`.
- Freeze nested extension status/contribution arrays in `freezeWorkspaceView`.
- Add `updateExtension` implementation mirroring `updateDebug`.

- [ ] **Step 4: Write failing AppShell contract tests**

Add tests to `src/app/AppShell.contract.test.tsx`:

```tsx
test("AppShell opens Extensions rail and loads workspace extension statuses", async () => {
  const { renderResult, invokeCalls } = renderAppShellWithWorkspace({
    extensionStatuses: [extensionStatus({ id: "yuuzu.core", name: "Yuuzu Core" })],
  });

  fireEvent.click(renderResult.getByLabelText("Extensions"));

  expect(await renderResult.findByText("Yuuzu Core")).toBeTruthy();
  expect(invokeCalls.some((call) => call.command === "extension_statuses")).toBe(true);
});

test("AppShell toggles extension enabled state for active workspace", async () => {
  const { renderResult, invokeCalls } = renderAppShellWithWorkspace({
    extensionStatuses: [extensionStatus({ id: "yuuzu.debug-tools", name: "Debug Tools" })],
  });

  fireEvent.click(renderResult.getByLabelText("Extensions"));
  fireEvent.click(await renderResult.findByLabelText("Disable Debug Tools"));

  const toggleCall = invokeCalls.find((call) => call.command === "set_extension_enabled");
  expect(toggleCall?.args).toMatchObject({
    extensionId: "yuuzu.debug-tools",
    enabled: false,
  });
});

test("AppShell command palette hides disabled extension commands", async () => {
  const { renderResult } = renderAppShellWithWorkspace({
    extensionStatuses: [
      extensionStatus({
        id: "yuuzu.debug-tools",
        name: "Debug Tools",
        enabled: false,
        commandId: "yuuzu.debug-tools.inspect-session",
      }),
    ],
  });

  fireEvent.keyDown(window, { key: "k", metaKey: true });

  expect(renderResult.queryByText("Debug Tools: Inspect session")).toBeNull();
});

test("AppShell records slow extension command performance", async () => {
  const { renderResult, invokeCalls } = renderAppShellWithWorkspace({
    extensionStatuses: [
      extensionStatus({
        id: "yuuzu.debug-tools",
        name: "Debug Tools",
        commandId: "yuuzu.debug-tools.inspect-session",
      }),
    ],
  });

  fireEvent.keyDown(window, { key: "k", metaKey: true });
  fireEvent.click(await renderResult.findByText("Debug Tools: Inspect session"));

  expect(invokeCalls.some((call) => call.command === "record_extension_performance")).toBe(true);
});
```

Use existing AppShell contract helper patterns and add an `extensionStatus` fixture near other test fixtures.

- [ ] **Step 5: Run AppShell tests to verify RED**

Run:

```bash
bun test src/app/AppShell.contract.test.tsx
```

Expected: FAIL because AppShell does not render Extensions panel, call extension APIs, or build dynamic palette commands.

- [ ] **Step 6: Implement AppShell integration**

Modify `src/app/AppShell.tsx`:

- Import `ExtensionPanel`, extension API wrappers, extension model helpers, and `commandItemsForPalette`.
- Add `extensions: "Extensions"` to `panelTitles`.
- Load statuses when an active workspace is registered and the Extensions panel opens; use request IDs/root guards matching database/debug patterns.
- Render `ExtensionPanel` in `PanelBody` for `active === "extensions"`.
- Add callbacks: `openExtensionsPanel`, `refreshExtensions`, `toggleExtensionEnabled`, `recordExtensionCommandPerformance`.
- Pass `commands={commandItemsForPalette(extensionCommands(view.extension), disabledExtensionIds)}` to `CommandPalette`.
- In `runCommand`, handle:
  - `open-extensions`: open panel.
  - `extension-refresh`: refresh statuses.
  - extension command IDs: do not execute arbitrary host code; record a performance sample with operation `command:<id>`, close palette, keep command visible as a registered contribution.

- [ ] **Step 7: Run focused frontend tests to verify GREEN**

Run:

```bash
bun test src/app/activity-rail.test.tsx src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Refactor and verify**

Run:

```bash
bun test src/features/extensions/extension-model.test.ts src/features/extensions/ExtensionPanel.test.tsx src/app/command-registry.test.ts src/app/command-palette-model.test.ts src/app/activity-rail.test.tsx src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx
bun run build
```

Expected: PASS with only existing Vite chunk-size warnings.

- [ ] **Step 9: Commit**

```bash
git add src/app/activity-rail.tsx src/app/activity-rail.test.tsx src/app/workspace-view-state.ts src/app/workspace-view-state.test.ts src/app/AppShell.tsx src/app/AppShell.contract.test.tsx
git commit -m "feat: integrate extensions workbench"
```

---

### Task 5: Public Extension API Draft And Isolation Contract

**Files:**
- Create: `docs/architecture/extension-api-draft.md`
- Test: `docs/architecture/extension-api-draft.md`

- [ ] **Step 1: Write API draft**

Create `docs/architecture/extension-api-draft.md`:

```markdown
# Extension API Draft

Status: Node 12 draft, manifest-only execution boundary.

## Goals

- Let internal Yuuzu-IDE features and future external extensions describe commands through the same registry shape.
- Allow extensions to be disabled per workspace.
- Make slow extensions visible before a full extension host exists.

## Non-Goals

- Marketplace.
- Arbitrary code execution.
- Network-capable extension host.
- Unbounded filesystem or process access.

## Manifest

```json
{
  "id": "yuuzu.debug-tools",
  "name": "Debug Tools",
  "version": "0.1.0",
  "api_version": "0.1",
  "description": "Debug commands and snippets",
  "builtin": true,
  "contributes": {
    "commands": [
      {
        "id": "yuuzu.debug-tools.inspect-session",
        "label": "Debug Tools: Inspect session",
        "group": "Extensions",
        "description": "Inspect the active debug session",
        "owner_extension_id": "yuuzu.debug-tools"
      }
    ],
    "themes": [
      {
        "id": "yuuzu-dark",
        "label": "Yuzu Dark",
        "mode": "dark",
        "accent": "#a8e23f"
      }
    ],
    "keybindings": [
      {
        "command": "open-command-palette",
        "key": "cmd+k",
        "when": "workspace"
      }
    ],
    "snippets": [
      {
        "id": "debug-log",
        "language": "typescript",
        "prefix": "dbg",
        "body": ["console.log($1);"],
        "description": "Debug log"
      }
    ],
    "workspace_hooks": [
      {
        "id": "debug-workspace-opened",
        "event": "WorkspaceOpened",
        "command": "yuuzu.debug-tools.inspect-session",
        "budget_ms": 75
      }
    ]
  }
}
```

## Command Registry

Core commands and extension commands both use:

```ts
type ExtensionCommandContribution = {
  id: string;
  label: string;
  group: string;
  description: string;
  owner_extension_id: string;
};
```

Disabled workspace extensions are filtered before the command palette renders. Extension commands do not run arbitrary extension host code in Node 12; selecting one records a bounded performance sample.

## Workspace Disablement

Disablement is scoped by canonical workspace root and extension id:

```json
{
  "workspace_root": "/repo-a",
  "extension_id": "yuuzu.debug-tools",
  "enabled": false
}
```

## Isolation Model

- Node 12 accepts manifest contributions only.
- Extension commands are inert contribution records unless implemented by trusted core code.
- Workspace hooks are inert contribution records in Node 12.
- No extension may access filesystem, process, terminal, network, secrets, or database APIs directly.
- Future host work must pass capabilities explicitly and record performance samples.

## Performance Budget

Default warning budgets:

- activation: 200 ms
- command: 50 ms
- workspace hook: 75 ms

Samples use:

```ts
type ExtensionPerformanceSample = {
  extension_id: string;
  workspace_root: string;
  operation: string;
  duration_ms: number;
  budget_ms: number;
  recorded_ms: number;
};
```

The Extensions panel marks an extension as Slow when it has at least one slow operation in the current workspace.
```

- [ ] **Step 2: Run docs marker scan**

Run:

```bash
rg -n "T(BD)|TO(DO)|place(holder)|zero tests|zero pass|skip[ -]verification" docs/architecture/extension-api-draft.md
```

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/extension-api-draft.md
git commit -m "docs: draft extension api"
```

---

### Task 6: Node 12 Final Verification And Results

**Files:**
- Create: `docs/architecture/node-12-extension-results.md`
- Modify: `docs/architecture/progress.md`
- Modify: `roadmap.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
bun run tauri build --debug
```

Expected: PASS. Record exact pass counts and artifact paths.

- [ ] **Step 2: Create Node 12 result record**

Create `docs/architecture/node-12-extension-results.md` with this structure:

```markdown
# Node 12 Extension And Ecosystem Layer Results

## Status

Completed and passed.

## Scope Delivered

- Internal command registry shared by core and extension command contributions.
- Workspace-scoped extension status and disablement.
- Public extension API draft for commands, themes, keybindings, snippets, workspace hooks, isolation, and performance budgets.
- Extensions panel following the dense workbench design language.
- Slow-extension performance sample visibility.

## TDD Evidence

Record RED/GREEN/REFACTOR evidence for Tasks 1-5.

## Agent Review Evidence

Record implementer, spec-compliance reviewer, and code-quality reviewer outcomes for each task.

## Full Verification Evidence

Record exact command outputs and pass counts for Bun, build, Cargo, fmt, clippy, and Tauri debug build.

## Acceptance Results

- Internal features use the same command registry extension authors will use: PASS.
- Extensions can be disabled per workspace: PASS.
- Slow extensions can be identified: PASS.

## Residual Risks

- Node 12 does not include a marketplace.
- Node 12 does not execute arbitrary third-party extension host code.
- Workspace hooks are manifest records only until a future host capability model is implemented.
```

Replace the instruction sentences with concrete evidence before committing. Do not leave generic instruction text.

- [ ] **Step 3: Update progress and roadmap**

Update `docs/architecture/progress.md` with a `### Node 12: Extension And Ecosystem Layer` section:

```markdown
### Node 12: Extension And Ecosystem Layer

Status: completed and passed.

Node 12 records final evidence in `docs/architecture/node-12-extension-results.md`.
```

Update `roadmap.md`:

- Node 12 status line points to `docs/architecture/node-12-extension-results.md`.
- Current Priority says Node 0 through Node 12 are complete and Node 13 is next.
- Add a Node 12 verification bullet covering command registry, workspace disablement, performance visibility, API draft, Bun/Cargo tests, Tauri debug build, and reviews.

- [ ] **Step 4: Run docs and diff checks**

Run:

```bash
rg -n "T(BD)|TO(DO)|place(holder)|zero tests|zero pass|skip[ -]verification" docs/architecture/node-12-extension-results.md docs/architecture/progress.md roadmap.md docs/architecture/extension-api-draft.md
git diff --check
git status --short
```

Expected: marker scan returns no matches, diff check passes, and only intended Node 12 files are modified plus existing unrelated untracked paths.

- [ ] **Step 5: Commit docs**

```bash
git add docs/architecture/node-12-extension-results.md docs/architecture/progress.md roadmap.md
git commit -m "docs: record node 12 extension results"
```

---

## Plan Self-Review

- Spec coverage: command registry, public API draft, theme API, keybinding API, snippets, workspace hooks, isolation model, performance budget, per-workspace disable controls, and slow extension identification each map to a task.
- Non-goals: marketplace and arbitrary extension host execution are explicitly excluded from implementation and documented as residual risks.
- UI coverage: Extensions is a rail tool with dense side-panel rows, badges, icon actions, and section labels matching `docs/ui-design/`.
- Type consistency: Rust and TypeScript both use `ExtensionManifest`, `ExtensionContributions`, `ExtensionWorkspaceStatus`, `ExtensionCommandContribution`, `ExtensionPerformanceSample`, and `ExtensionPerformanceSummary`.
- Verification coverage: focused Rust tests, focused frontend tests, AppShell contract tests, full Bun/Cargo suites, fmt, clippy, Tauri debug build, docs marker scans, and spec/code-quality reviews are required before Node 12 is marked complete.
