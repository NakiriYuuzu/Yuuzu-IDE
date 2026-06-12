# Node 13 Hardening, Packaging, And Daily Driver Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Yuuzu-IDE safe enough for daily personal work by adding native unsaved-edit recovery, visible diagnostics and performance metrics, settings migration plus keybinding import, and packaging/setup documentation backed by verification evidence.

**Architecture:** Rust owns durable recovery files, diagnostics logs, migrated settings, and app metrics. React renders bounded Settings/Diagnostics state using the existing `docs/ui-design/` shell language: compact Settings categories, yuzu-green status indicators, rows, badges, and the status bar. Packaging readiness is recorded with reproducible local commands and honest OS limits.

**Tech Stack:** Tauri 2, Rust, serde JSON stores, Vite, React 19, TypeScript, lucide-react, Bun tests, Cargo tests, and `bun run tauri build --debug`.

---

## Controller Rules For This Node

- Spawn every implementer, spec-compliance reviewer, and code-quality reviewer with `model: gpt-5.5` and `reasoning_effort: xhigh`.
- Do not use `gpt-5.4` for any Node 13 subagent.
- Execute tasks in order unless a reviewer requires a same-task fix.
- Require RED/GREEN/REFACTOR evidence for every behavior change.
- Commit after each task once both review gates pass, or after a tightly related fix requested by review.
- Preserve unrelated untracked files: `docs/html/` and `docs/superpowers/plans/2026-06-11-git-deep-dive.md`.

## Source-Of-Truth Context

- Roadmap Node 13 requires crash recovery, unsaved file backup, update strategy, app packaging, logs and diagnostics, performance dashboard, settings migration, keybinding/habit import where practical, and personal setup docs.
- `docs/architecture/tech-stack.md` says Rust owns persistence, process metrics, filesystem, diagnostics, and security-sensitive behavior; React owns rendering only.
- `docs/ui-design/app.jsx` and `docs/ui-design/panels.jsx` show Settings as a compact left-panel category list.
- `docs/ui-design/ide.css` shows the status bar pattern: 24px height, compact mono labels, yuzu accent, and small live indicators.
- Existing code already has:
  - `src-tauri/src/metrics.rs`: process id and RSS helper.
  - `src-tauri/src/settings.rs`: atomic JSON save for compact/dark settings.
  - `src/features/files/draft-store.ts`: browser storage draft helper.
  - `src/app/AppShell.tsx`: dirty-file draft calls, status bar, Settings activity, command palette.

## File Structure

### Rust

- Create `src-tauri/src/recovery.rs`: native unsaved-backup records, workspace-scoped store, atomic JSON writes, list/delete helpers, and unit tests.
- Create `src-tauri/src/diagnostics.rs`: append-only diagnostics log store plus bounded readback and unit tests.
- Modify `src-tauri/src/metrics.rs`: include memory bytes, uptime, workspace count, active workspace id, and indexing counters supplied by the caller.
- Modify `src-tauri/src/settings.rs`: add schema migration, update policy fields, and VS Code keybinding import.
- Modify `src-tauri/src/commands.rs`: own `RecoveryStore`, `DiagnosticsStore`, started timestamp, and new Tauri commands.
- Modify `src-tauri/src/lib.rs`: register new modules and commands.

### Frontend

- Create `src/features/recovery/recovery-api.ts`: Tauri calls for save/list/discard backups.
- Create `src/features/recovery/recovery-model.ts`: backup selection, dirty backup metadata, restore/discard reducers.
- Create `src/features/recovery/RecoveryPanel.tsx`: compact recovery rows for Settings.
- Create `src/features/diagnostics/diagnostics-api.ts`: Tauri calls for metrics and diagnostics.
- Create `src/features/diagnostics/diagnostics-model.ts`: bounded metric/log state and formatting helpers.
- Create `src/features/diagnostics/DiagnosticsPanel.tsx`: performance/log rows for Settings.
- Create `src/features/settings/settings-api.ts`: load/save/import settings calls.
- Create `src/features/settings/settings-model.ts`: migrated settings shape and keybinding import view state.
- Create `src/features/settings/SettingsPanel.tsx`: Settings categories for Recovery, Performance, Diagnostics, Keybindings, Updates, and Personal Setup.
- Modify `src/app/workspace-view-state.ts`: add bounded recovery/diagnostics/settings view state.
- Modify `src/app/activity-rail.tsx`: keep existing Settings activity; no new rail icon is needed.
- Modify `src/app/command-registry.ts`, `src/app/command-palette-model.ts`, and tests: add Node 13 commands.
- Modify `src/app/AppShell.tsx`: native backup calls during dirty edits, recovery restore/discard handlers, diagnostics refresh, status bar metrics, and Settings panel wiring.
- Modify `src/index.css`: compact Settings/Diagnostics/Recovery styles matching the design source.

### Docs

- Create `docs/setup/personal-setup.md`: daily driver setup for local projects.
- Create `docs/release/update-strategy.md`: personal update policy and verification cadence.
- Create `docs/architecture/node-13-hardening-results.md`: final evidence, measurements, residual risks.
- Modify `docs/architecture/progress.md`: add Node 13 completion entry after verification.
- Modify `roadmap.md`: mark Node 13 complete with evidence.

---

## Task 1: Rust Native Unsaved-Backup Store

**Files:**
- Create: `src-tauri/src/recovery.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/recovery.rs`
- Test: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write failing recovery-store tests**

Add tests to the new `src-tauri/src/recovery.rs` before implementation:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_system::FileVersion;

    fn backup(path: &str, content: &str) -> UnsavedBackup {
        UnsavedBackup {
            id: String::new(),
            workspace_id: "workspace-a".to_string(),
            workspace_root: "/repo-a".to_string(),
            path: path.to_string(),
            content: content.to_string(),
            version: Some(FileVersion {
                modified_ms: 7,
                len: 11,
            }),
            updated_ms: 10,
        }
    }

    #[test]
    fn backup_store_round_trips_unsaved_edits_by_workspace_and_path() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = RecoveryStore::new(temp.path().join("recovery"));

        let saved = store.save_backup(backup("src/main.ts", "dirty text")).expect("save");
        let listed = store
            .list_backups("workspace-a", "/repo-a")
            .expect("list backups");

        assert_eq!(listed, vec![saved]);
        assert_eq!(listed[0].id, backup_id("workspace-a", "src/main.ts"));
        assert_eq!(listed[0].content, "dirty text");
    }

    #[test]
    fn backup_store_replaces_existing_path_without_duplicates() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = RecoveryStore::new(temp.path().join("recovery"));

        store.save_backup(backup("src/main.ts", "first")).expect("first");
        store.save_backup(backup("src/main.ts", "second")).expect("second");

        let listed = store
            .list_backups("workspace-a", "/repo-a")
            .expect("list backups");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].content, "second");
    }

    #[test]
    fn backup_store_discards_only_matching_workspace_backup() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = RecoveryStore::new(temp.path().join("recovery"));
        let saved = store.save_backup(backup("src/main.ts", "dirty")).expect("save");

        assert!(store
            .discard_backup("workspace-b", "/repo-b", &saved.id)
            .is_err());
        assert_eq!(
            store
                .list_backups("workspace-a", "/repo-a")
                .expect("list backups")
                .len(),
            1
        );

        store
            .discard_backup("workspace-a", "/repo-a", &saved.id)
            .expect("discard");
        assert!(store
            .list_backups("workspace-a", "/repo-a")
            .expect("list backups")
            .is_empty());
    }
}
```

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml recovery::tests
```

Expected RED: compile fails because `RecoveryStore`, `UnsavedBackup`, and `backup_id` do not exist.

- [ ] **Step 2: Implement minimal recovery store**

Implement:

```rust
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct UnsavedBackup {
    pub id: String,
    pub workspace_id: String,
    pub workspace_root: String,
    pub path: String,
    pub content: String,
    pub version: Option<FileVersion>,
    pub updated_ms: u64,
}

#[derive(Clone, Debug)]
pub struct RecoveryStore {
    root: PathBuf,
}

pub fn backup_id(workspace_id: &str, path: &str) -> String {
    let mut id = String::from("b");
    for byte in format!("{workspace_id}\n{path}").bytes() {
        id.push_str(&format!("{byte:02x}"));
    }
    id
}
```

Use `backup_id` before saving so a workspace/path pair has one durable backup. Save each backup as `<id>.json` under the configured recovery directory with the same temp-file then rename pattern used by `SettingsStore`.

- [ ] **Step 3: Verify recovery store is green**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml recovery::tests
```

Expected GREEN: all recovery tests pass.

- [ ] **Step 4: Add AppState command tests for workspace scoping**

Add tests in `src-tauri/src/commands.rs`:

```rust
#[test]
fn app_state_saves_and_lists_unsaved_backups_for_registered_workspace() {
    let (_config, state, workspace_a, _workspace_b, workspace_a_id, _workspace_b_id) =
        app_state_with_two_workspaces();

    let saved = state
        .save_unsaved_backup(
            &workspace_a.to_string_lossy(),
            &workspace_a_id,
            "src/main.ts".to_string(),
            "dirty text".to_string(),
            None,
        )
        .expect("save backup");

    let listed = state
        .list_unsaved_backups(&workspace_a.to_string_lossy(), &workspace_a_id)
        .expect("list backups");
    assert_eq!(listed, vec![saved]);
}

#[test]
fn app_state_rejects_unsaved_backup_when_workspace_id_does_not_match_root() {
    let (_config, state, workspace_a, _workspace_b, _workspace_a_id, workspace_b_id) =
        app_state_with_two_workspaces();

    let result = state.save_unsaved_backup(
        &workspace_a.to_string_lossy(),
        &workspace_b_id,
        "src/main.ts".to_string(),
        "dirty text".to_string(),
        None,
    );

    assert_eq!(
        result.expect_err("workspace mismatch"),
        "workspace id does not match workspace root"
    );
}
```

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml commands::tests::app_state_saves_and_lists_unsaved_backups_for_registered_workspace commands::tests::app_state_rejects_unsaved_backup_when_workspace_id_does_not_match_root
```

Expected RED: methods do not exist on `AppState`.

- [ ] **Step 5: Wire recovery into AppState and Tauri commands**

Add `recovery_store: crate::recovery::RecoveryStore` to `AppState`, initialize it with `config_dir.join("unsaved-backups")`, and add:

```rust
pub fn save_unsaved_backup(
    &self,
    workspace_root: &str,
    workspace_id: &str,
    path: String,
    content: String,
    version: Option<FileVersion>,
) -> Result<crate::recovery::UnsavedBackup, String>;

pub fn list_unsaved_backups(
    &self,
    workspace_root: &str,
    workspace_id: &str,
) -> Result<Vec<crate::recovery::UnsavedBackup>, String>;

pub fn discard_unsaved_backup(
    &self,
    workspace_root: &str,
    workspace_id: &str,
    backup_id: String,
) -> Result<(), String>;
```

Each method must call `trusted_workspace_root` and `ensure_workspace_id_matches_root_path` before touching recovery files. Add Tauri commands with camelCase TypeScript argument names matching the existing command style:

```rust
#[tauri::command]
pub fn save_unsaved_backup(
    state: State<'_, AppState>,
    workspace_root: String,
    workspace_id: String,
    path: String,
    content: String,
    version: Option<FileVersion>,
) -> Result<crate::recovery::UnsavedBackup, String>;
```

Register commands in `src-tauri/src/lib.rs`.

- [ ] **Step 6: Verify and refactor**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml recovery::tests commands::tests::app_state_saves_and_lists_unsaved_backups_for_registered_workspace commands::tests::app_state_rejects_unsaved_backup_when_workspace_id_does_not_match_root
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected GREEN: focused tests and formatting pass. Refactor only duplicated atomic-write helpers if the duplication is within the new recovery file.

- [ ] **Step 7: Commit Task 1**

```bash
git add src-tauri/src/recovery.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add node 13 recovery store"
```

---

## Task 2: Frontend Recovery Integration

**Files:**
- Create: `src/features/recovery/recovery-api.ts`
- Create: `src/features/recovery/recovery-model.ts`
- Create: `src/features/recovery/recovery-model.test.ts`
- Create: `src/features/recovery/RecoveryPanel.tsx`
- Create: `src/features/recovery/RecoveryPanel.test.tsx`
- Modify: `src/app/workspace-view-state.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.contract.test.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing recovery model tests**

Create `src/features/recovery/recovery-model.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  createRecoveryState,
  discardRecoveryBackup,
  restoreRecoveryBackup,
  storeRecoveryBackups,
  type UnsavedBackup,
} from "./recovery-model";

function backup(overrides: Partial<UnsavedBackup> = {}): UnsavedBackup {
  return {
    id: overrides.id ?? "b1",
    workspace_id: overrides.workspace_id ?? "workspace-a",
    workspace_root: overrides.workspace_root ?? "/repo-a",
    path: overrides.path ?? "src/main.ts",
    content: overrides.content ?? "dirty text",
    version: overrides.version ?? null,
    updated_ms: overrides.updated_ms ?? 10,
  };
}

describe("recovery model", () => {
  test("stores backups newest first and selects the first backup", () => {
    const state = storeRecoveryBackups(createRecoveryState(), [
      backup({ id: "old", updated_ms: 1 }),
      backup({ id: "new", updated_ms: 2 }),
    ]);

    expect(state.backups.map((item) => item.id)).toEqual(["new", "old"]);
    expect(state.selectedBackupId).toBe("new");
  });

  test("restoreRecoveryBackup marks the restored backup for opening", () => {
    const state = restoreRecoveryBackup(
      storeRecoveryBackups(createRecoveryState(), [backup({ id: "b1" })]),
      "b1",
    );

    expect(state.restoringBackupId).toBe("b1");
  });

  test("discardRecoveryBackup removes selection and stale restore marker", () => {
    const state = discardRecoveryBackup(
      { ...storeRecoveryBackups(createRecoveryState(), [backup({ id: "b1" })]), restoringBackupId: "b1" },
      "b1",
    );

    expect(state.backups).toEqual([]);
    expect(state.selectedBackupId).toBeNull();
    expect(state.restoringBackupId).toBeNull();
  });
});
```

Run:

```bash
bun test src/features/recovery/recovery-model.test.ts
```

Expected RED: module does not exist.

- [ ] **Step 2: Implement recovery model and API**

Create `recovery-model.ts` with `UnsavedBackup`, `RecoveryViewState`, and reducers tested above. Create `recovery-api.ts`:

```ts
import { call } from "../../lib/tauri";
import type { FileVersion } from "../files/file-model";
import type { UnsavedBackup } from "./recovery-model";

export function saveUnsavedBackup(args: {
  workspaceRoot: string;
  workspaceId: string;
  path: string;
  content: string;
  version: FileVersion | null;
}): Promise<UnsavedBackup> {
  return call<UnsavedBackup>("save_unsaved_backup", args);
}
```

Also add `listUnsavedBackups` and `discardUnsavedBackup`.

- [ ] **Step 3: Verify model/API green**

Run:

```bash
bun test src/features/recovery/recovery-model.test.ts
```

Expected GREEN: all recovery model tests pass.

- [ ] **Step 4: Write failing RecoveryPanel tests**

Create `src/features/recovery/RecoveryPanel.test.tsx`:

```tsx
/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { ensureTestDom } from "../../app/test-dom";
import { RecoveryPanel } from "./RecoveryPanel";
import { createRecoveryState } from "./recovery-model";

ensureTestDom();

describe("RecoveryPanel", () => {
  test("renders backup rows and restore/discard actions", () => {
    const onRestore = mock<(id: string) => void>(() => {});
    const onDiscard = mock<(id: string) => void>(() => {});
    const result = render(
      <RecoveryPanel
        state={{
          ...createRecoveryState(),
          backups: [
            {
              id: "b1",
              workspace_id: "workspace-a",
              workspace_root: "/repo-a",
              path: "src/main.ts",
              content: "dirty text",
              version: null,
              updated_ms: 10,
            },
          ],
          selectedBackupId: "b1",
        }}
        onRefresh={() => {}}
        onRestore={onRestore}
        onDiscard={onDiscard}
      />,
    );

    expect(result.getByText("src/main.ts")).toBeTruthy();
    fireEvent.click(result.getByRole("button", { name: "Restore src/main.ts" }));
    expect(onRestore).toHaveBeenCalledWith("b1");
    fireEvent.click(result.getByRole("button", { name: "Discard src/main.ts backup" }));
    expect(onDiscard).toHaveBeenCalledWith("b1");
  });
});
```

Run:

```bash
bun test src/features/recovery/RecoveryPanel.test.tsx
```

Expected RED: component does not exist.

- [ ] **Step 5: Implement RecoveryPanel using the design source**

Use compact `.row`, `.section-label`, `.btn`, and `.mono` patterns already used in panels. Use lucide icons (`RefreshCw`, `RotateCcw`, `Trash2`) rather than text-only controls. Keep content previews bounded to one line.

- [ ] **Step 6: Wire state and native backup calls into AppShell**

Add `recovery: createRecoveryState()` and `updateRecovery` to `workspace-view-state.ts`. In `AppShell.tsx`:

- On dirty editor content, keep existing local draft behavior and call `saveUnsavedBackup` with active workspace id/root, path, content, and active tab version.
- When content matches saved disk content, call `discardUnsavedBackup` for that path's backup id after `tryClearDraft`.
- On active workspace change, call `listUnsavedBackups` and store results.
- In Settings activity, render the new settings panel with Recovery section.
- Restore action opens the file path and replaces editor content with backup content.
- Discard action deletes native backup and removes it from state.

Add an AppShell contract test that edits a loaded file and proves `save_unsaved_backup` is invoked with `workspaceRoot`, `workspaceId`, `path`, `content`, and `version`.

- [ ] **Step 7: Verify frontend recovery integration**

Run:

```bash
bun test src/features/recovery/recovery-model.test.ts src/features/recovery/RecoveryPanel.test.tsx src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx
bun run build
```

Expected GREEN: recovery tests, AppShell contract tests, and build pass.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/features/recovery src/app/workspace-view-state.ts src/app/AppShell.tsx src/app/AppShell.contract.test.tsx src/index.css
git commit -m "feat: wire node 13 edit recovery"
```

---

## Task 3: Rust Metrics And Diagnostics

**Files:**
- Create: `src-tauri/src/diagnostics.rs`
- Modify: `src-tauri/src/metrics.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/diagnostics.rs`
- Test: `src-tauri/src/metrics.rs`
- Test: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write failing diagnostics and metrics tests**

Add tests:

```rust
#[test]
fn diagnostics_store_appends_and_reads_newest_events_first() {
    let temp = tempfile::tempdir().expect("temp dir");
    let store = DiagnosticsStore::new(temp.path().join("diagnostics.jsonl"));

    store
        .append(DiagnosticEventInput {
            level: "info".to_string(),
            source: "startup".to_string(),
            message: "visible shell".to_string(),
        })
        .expect("append");
    store
        .append(DiagnosticEventInput {
            level: "warn".to_string(),
            source: "indexing".to_string(),
            message: "large workspace".to_string(),
        })
        .expect("append");

    let events = store.list(10).expect("list");
    assert_eq!(events[0].source, "indexing");
    assert_eq!(events[1].source, "startup");
}
```

In `metrics.rs`, add:

```rust
#[test]
fn snapshot_includes_uptime_memory_and_index_counts() {
    let started_ms = current_time_ms().saturating_sub(50);
    let snapshot = snapshot(AppMetricInput {
        started_ms,
        workspace_count: 2,
        active_workspace_id: Some("workspace-a".to_string()),
        docs_index_entries: 3,
        file_tree_entries: 4,
    });

    assert!(snapshot.uptime_ms >= 50);
    assert_eq!(snapshot.workspace_count, 2);
    assert_eq!(snapshot.active_workspace_id.as_deref(), Some("workspace-a"));
    assert_eq!(snapshot.docs_index_entries, 3);
    assert_eq!(snapshot.file_tree_entries, 4);
}
```

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml diagnostics::tests metrics::tests
```

Expected RED: diagnostics module and metric input fields do not exist.

- [ ] **Step 2: Implement diagnostics store and richer metrics**

Implement bounded JSONL diagnostics with `DiagnosticEvent { id, timestamp_ms, level, source, message }`. Generate ids as `d<timestamp_ms>-<sequence>` inside the store. Add `AppMetricInput` and extend `AppMetricSnapshot`:

```rust
pub struct AppMetricSnapshot {
    pub timestamp_ms: u128,
    pub process_id: u32,
    pub memory_bytes: Option<u64>,
    pub uptime_ms: u128,
    pub workspace_count: usize,
    pub active_workspace_id: Option<String>,
    pub docs_index_entries: usize,
    pub file_tree_entries: usize,
}
```

Use `process_memory_bytes(std::process::id())` for memory on macOS/Linux and `None` where unavailable.

- [ ] **Step 3: Wire commands**

Add `diagnostics_store` and `started_ms` to `AppState`. Add commands:

```rust
pub fn append_diagnostic_event(
    state: State<'_, AppState>,
    event: crate::diagnostics::DiagnosticEventInput,
) -> Result<crate::diagnostics::DiagnosticEvent, String>;

pub fn list_diagnostic_events(
    state: State<'_, AppState>,
    limit: usize,
) -> Result<Vec<crate::diagnostics::DiagnosticEvent>, String>;

pub fn metric_snapshot(
    state: State<'_, AppState>,
    docs_index_entries: usize,
    file_tree_entries: usize,
) -> Result<AppMetricSnapshot, String>;
```

Keep frontend-supplied index counters numeric and bounded: clamp each counter to `1_000_000` before building `AppMetricInput`.

- [ ] **Step 4: Verify metrics and diagnostics**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml diagnostics::tests metrics::tests commands::tests
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected GREEN: diagnostics, metrics, and command tests pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add src-tauri/src/diagnostics.rs src-tauri/src/metrics.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add node 13 diagnostics metrics"
```

---

## Task 4: Frontend Settings, Diagnostics, And Performance Dashboard

**Files:**
- Create: `src/features/diagnostics/diagnostics-api.ts`
- Create: `src/features/diagnostics/diagnostics-model.ts`
- Create: `src/features/diagnostics/diagnostics-model.test.ts`
- Create: `src/features/diagnostics/DiagnosticsPanel.tsx`
- Create: `src/features/diagnostics/DiagnosticsPanel.test.tsx`
- Create: `src/features/settings/settings-api.ts`
- Create: `src/features/settings/settings-model.ts`
- Create: `src/features/settings/settings-model.test.ts`
- Create: `src/features/settings/SettingsPanel.tsx`
- Create: `src/features/settings/SettingsPanel.test.tsx`
- Modify: `src/app/workspace-view-state.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/command-registry.ts`
- Modify: `src/app/command-palette-model.ts`
- Modify: `src/app/command-palette-model.test.ts`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing diagnostics model tests**

Create `diagnostics-model.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  createDiagnosticsState,
  formatBytes,
  storeDiagnosticEvents,
  storeMetricSnapshot,
} from "./diagnostics-model";

describe("diagnostics model", () => {
  test("stores metric snapshots and formats memory", () => {
    const state = storeMetricSnapshot(createDiagnosticsState(), {
      timestamp_ms: 100,
      process_id: 42,
      memory_bytes: 104857600,
      uptime_ms: 1500,
      workspace_count: 2,
      active_workspace_id: "workspace-a",
      docs_index_entries: 12,
      file_tree_entries: 34,
    });

    expect(state.metric?.workspace_count).toBe(2);
    expect(formatBytes(state.metric?.memory_bytes ?? null)).toBe("100.0 MB");
  });

  test("stores newest diagnostic events first and limits rows", () => {
    const events = Array.from({ length: 55 }, (_, index) => ({
      id: `d${index}`,
      timestamp_ms: index,
      level: "info",
      source: "test",
      message: `event ${index}`,
    }));

    const state = storeDiagnosticEvents(createDiagnosticsState(), events);

    expect(state.events).toHaveLength(50);
    expect(state.events[0].id).toBe("d54");
  });
});
```

Run:

```bash
bun test src/features/diagnostics/diagnostics-model.test.ts
```

Expected RED: module does not exist.

- [ ] **Step 2: Implement diagnostics model/API and panel**

Create `diagnostics-api.ts` calls:

```ts
export function metricSnapshot(args: {
  docsIndexEntries: number;
  fileTreeEntries: number;
}): Promise<AppMetricSnapshot>;

export function listDiagnosticEvents(limit: number): Promise<DiagnosticEvent[]>;

export function appendDiagnosticEvent(event: DiagnosticEventInput): Promise<DiagnosticEvent>;
```

Create `DiagnosticsPanel.tsx` with two sections:

- Performance: startup uptime, memory, process id, workspace count, docs index entries, file tree entries.
- Logs: newest 50 diagnostic events with level/source/message.

Use compact rows and yuzu accent badges from `docs/ui-design/ide.css`.

- [ ] **Step 3: Write failing settings panel and command tests**

Create `settings-model.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  createSettingsState,
  selectSettingsCategory,
  storeSettings,
} from "./settings-model";

describe("settings model", () => {
  test("stores settings and selects diagnostics category", () => {
    const state = selectSettingsCategory(
      storeSettings(createSettingsState(), {
        schema_version: 2,
        density: "compact",
        color_theme: "dark",
        accent_color: "yuzu",
        update_channel: "manual",
        keybindings: [],
      }),
      "diagnostics",
    );

    expect(state.activeCategory).toBe("diagnostics");
    expect(state.settings?.update_channel).toBe("manual");
  });
});
```

Update `command-palette-model.test.ts` to expect these Node 13 commands in order after Node 12:

```ts
expect(allCommands.map((command) => command.id)).toContain("open-diagnostics");
expect(allCommands.map((command) => command.id)).toContain("refresh-diagnostics");
expect(allCommands.map((command) => command.id)).toContain("open-recovery");
```

Run:

```bash
bun test src/features/settings/settings-model.test.ts src/app/command-palette-model.test.ts
```

Expected RED: settings module and Node 13 commands do not exist.

- [ ] **Step 4: Implement SettingsPanel and command wiring**

Add Node 13 core commands:

- `open-diagnostics`
- `refresh-diagnostics`
- `open-recovery`
- `import-keybindings`

Create `SettingsPanel.tsx` with categories:

- Recovery
- Performance
- Diagnostics
- Keybindings
- Updates
- Personal Setup

The panel should render `RecoveryPanel` for Recovery, `DiagnosticsPanel` for Performance/Diagnostics, keybinding import controls for Keybindings, update policy text for Updates, and a short path list for Personal Setup. Use buttons with lucide icons, not rounded text-only controls where an icon exists.

- [ ] **Step 5: Wire AppShell**

In `workspace-view-state.ts`, add `diagnostics` and `settings` view slices. In `AppShell.tsx`:

- Fetch settings once after bootstrap with `loadSettings`.
- Refresh metrics when Settings opens and every time `refresh-diagnostics` runs.
- Pass `docsState.index.length` and current file-tree entry count to `metricSnapshot`.
- Add status bar cells for memory and indexed docs when a metric exists.
- Open Settings with the requested category for `open-diagnostics` and `open-recovery`.
- Append a startup diagnostic event after the first registry load succeeds.

- [ ] **Step 6: Verify frontend diagnostics/settings**

Run:

```bash
bun test src/features/diagnostics/diagnostics-model.test.ts src/features/diagnostics/DiagnosticsPanel.test.tsx src/features/settings/settings-model.test.ts src/features/settings/SettingsPanel.test.tsx src/app/workspace-view-state.test.ts src/app/command-palette-model.test.ts src/app/AppShell.contract.test.tsx
bun run build
```

Expected GREEN: focused tests and build pass.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/features/diagnostics src/features/settings src/app/workspace-view-state.ts src/app/AppShell.tsx src/app/command-registry.ts src/app/command-palette-model.ts src/app/command-palette-model.test.ts src/index.css
git commit -m "feat: add node 13 diagnostics dashboard"
```

---

## Task 5: Settings Migration, Update Policy, And Keybinding Import

**Files:**
- Modify: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/features/settings/settings-api.ts`
- Modify: `src/features/settings/settings-model.ts`
- Modify: `src/features/settings/SettingsPanel.tsx`
- Test: `src-tauri/src/settings.rs`
- Test: `src-tauri/src/commands.rs`
- Test: `src/features/settings/settings-model.test.ts`
- Test: `src/features/settings/SettingsPanel.test.tsx`

- [ ] **Step 1: Write failing Rust migration/import tests**

Add settings tests:

```rust
#[test]
fn settings_store_migrates_v1_compact_dark_settings_to_schema_v2() {
    let temp = tempfile::tempdir().expect("temp dir");
    let path = temp.path().join("settings.json");
    std::fs::write(
        &path,
        r#"{"density":"compact","color_theme":"dark"}"#,
    )
    .expect("write old settings");

    let loaded = SettingsStore::new(path).load().expect("load settings");

    assert_eq!(loaded.schema_version, 2);
    assert_eq!(loaded.density, "compact");
    assert_eq!(loaded.color_theme, "dark");
    assert_eq!(loaded.update_channel, "manual");
}

#[test]
fn settings_imports_vscode_keybindings_for_known_commands() {
    let settings = AppSettings::default();
    let imported = import_vscode_keybindings(
        settings,
        r#"[{"key":"cmd+k","command":"workbench.action.showCommands"},{"key":"cmd+s","command":"workbench.action.files.save"}]"#,
    )
    .expect("import");

    assert_eq!(
        imported.keybindings,
        vec![
            KeybindingSetting {
                command_id: "open-command-palette".to_string(),
                key: "cmd+k".to_string(),
                source: "vscode".to_string(),
            },
            KeybindingSetting {
                command_id: "save-file".to_string(),
                key: "cmd+s".to_string(),
                source: "vscode".to_string(),
            },
        ]
    );
}
```

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml settings::tests::settings_store_migrates_v1_compact_dark_settings_to_schema_v2 settings::tests::settings_imports_vscode_keybindings_for_known_commands
```

Expected RED: schema fields and import function do not exist.

- [ ] **Step 2: Implement settings schema v2**

Extend `AppSettings`:

```rust
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct AppSettings {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_density")]
    pub density: String,
    #[serde(default = "default_color_theme")]
    pub color_theme: String,
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    #[serde(default = "default_update_channel")]
    pub update_channel: String,
    #[serde(default)]
    pub keybindings: Vec<KeybindingSetting>,
}
```

Normalize loaded settings to `schema_version = 2`, `accent_color = "yuzu"`, `update_channel = "manual"`, and an empty keybinding list when absent. Add `import_vscode_keybindings` with exact mappings:

- `workbench.action.showCommands` -> `open-command-palette`
- `workbench.action.files.save` -> `save-file`
- `workbench.action.terminal.new` -> `new-terminal`
- `workbench.action.quickOpen` -> `open-workspace`

- [ ] **Step 3: Wire import command and frontend API**

Add command:

```rust
#[tauri::command]
pub fn import_keybindings(
    state: State<'_, AppState>,
    source: String,
    content: String,
) -> Result<AppSettings, String>;
```

Accept only `source == "vscode"` for Node 13. Save imported settings atomically through `SettingsStore`.

Update frontend API and SettingsPanel so the Keybindings category can paste VS Code JSON and import it. Surface errors in the panel.

- [ ] **Step 4: Verify settings migration/import**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml settings::tests commands::tests::app_state_loads_settings_from_store commands::tests::app_state_persists_settings_changes
bun test src/features/settings/settings-model.test.ts src/features/settings/SettingsPanel.test.tsx
bun run build
```

Expected GREEN: migration/import tests and frontend settings tests pass.

- [ ] **Step 5: Commit Task 5**

```bash
git add src-tauri/src/settings.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/features/settings
git commit -m "feat: migrate settings and import keybindings"
```

---

## Task 6: Packaging, Setup Docs, And Node Completion Evidence

**Files:**
- Create: `docs/setup/personal-setup.md`
- Create: `docs/release/update-strategy.md`
- Create: `docs/architecture/node-13-hardening-results.md`
- Modify: `docs/architecture/progress.md`
- Modify: `roadmap.md`

- [ ] **Step 1: Write docs with exact local setup and update policy**

Create `docs/setup/personal-setup.md` with:

- Required local commands: `bun install`, `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml`, `bun test`, `bun run build`, `bun run tauri build --debug`.
- Daily-driver checklist: register primary workspaces, verify recovery list is empty before starting, keep diagnostics visible in Settings, run debug package build after dependency updates.
- Recovery procedure: Settings -> Recovery -> Restore, then Save.
- Diagnostics procedure: Settings -> Performance/Diagnostics -> Refresh.
- Keybinding import procedure: Settings -> Keybindings -> paste VS Code JSON -> Import.

Create `docs/release/update-strategy.md` with:

- Manual update channel for personal use.
- Build verification before replacing local app bundle.
- Rollback path: keep previous debug app bundle or DMG until one day of work has passed without recovery or startup regressions.
- Windows packaging note: run the same Node 13 verification on Windows before calling the Windows installer daily-driver ready.

- [ ] **Step 2: Run node-level verification**

Run:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
bun run tauri build --debug
```

Expected GREEN:

- Bun tests pass.
- Frontend build passes with only existing Vite chunk-size warnings.
- Cargo tests pass.
- Rust formatting passes.
- Clippy passes with `-D warnings`.
- Tauri debug package is produced for the current host under `src-tauri/target/debug/bundle/`.

- [ ] **Step 3: Write Node 13 results**

Create `docs/architecture/node-13-hardening-results.md` with:

- Completed scope.
- Task commits.
- RED/GREEN/REFACTOR evidence per task.
- Packaging artifacts produced by the debug build.
- Performance measurements visible in Settings: process id, memory, uptime, workspace count, docs index entries, file tree entries.
- Residual risks: Windows installer verification requires a Windows host; public release polish remains outside Node 13.

- [ ] **Step 4: Update progress and roadmap**

Append Node 13 to `docs/architecture/progress.md` and update `roadmap.md`:

- Node 13 completed/passed.
- Reference `docs/architecture/node-13-hardening-results.md`.
- Current Priority says Nodes 0-13 are complete.
- Remaining non-goals stay non-goals: public release polish and team collaboration.

- [ ] **Step 5: Verify docs are clean**

Run:

```bash
rg -n "T""BD|TO""DO|place""holder|zero"" tests|zero"" pass|skip[ -]verification" docs/setup/personal-setup.md docs/release/update-strategy.md docs/architecture/node-13-hardening-results.md docs/architecture/progress.md roadmap.md
git diff --check
```

Expected: `rg` returns no matches and `git diff --check` exits zero.

- [ ] **Step 6: Commit Task 6**

```bash
git add docs/setup/personal-setup.md docs/release/update-strategy.md docs/architecture/node-13-hardening-results.md docs/architecture/progress.md roadmap.md
git commit -m "docs: record node 13 hardening readiness"
```

---

## Final Node 13 Gate

- [ ] **Step 1: Run full verification again from a clean command state**

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
bun run tauri build --debug
```

- [ ] **Step 2: Dispatch final spec-compliance reviewer**

Use `gpt-5.5` with `xhigh`. Ask for a read-only verdict on Node 13 acceptance:

- Daily work readiness.
- Unsaved edits survive app crash via native backups.
- Startup, memory, and indexing metrics are visible.
- Packaging works on the current target host.
- Update strategy, diagnostics, settings migration, keybinding import, and personal setup docs exist.
- `docs/ui-design/` visual language is respected.

- [ ] **Step 3: Dispatch final code-quality reviewer**

Use `gpt-5.5` with `xhigh`. Ask for a read-only verdict on:

- Workspace scoping.
- Atomic persistence.
- Bounded React state.
- No secrets or large file contents in global state.
- AppShell integration races.
- Test evidence.

- [ ] **Step 4: Final commit if reviewer fixes were required**

If reviews require fixes, apply them with TDD evidence, rerun relevant verification, update Node 13 results, and commit the fix with a message naming the reviewer finding.

---

## Plan Self-Review

- Spec coverage: crash recovery and unsaved backup are covered by Tasks 1-2; logs, diagnostics, startup/memory/indexing metrics are covered by Tasks 3-4; settings migration and keybinding import are covered by Task 5; update strategy, packaging, and personal setup docs are covered by Task 6.
- Type consistency: `UnsavedBackup`, `AppMetricSnapshot`, `DiagnosticEvent`, and `AppSettings` names are used consistently across Rust and TypeScript.
- UI consistency: Settings remains the main Node 13 surface, matching `docs/ui-design/panels.jsx`; status bar metrics follow `docs/ui-design/ide.css`.
- Command consistency: every shell command uses Bun for frontend work and Cargo through `$HOME/.cargo/env` for Rust work.
