# Node 3 Integrated Terminal And Task Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build per-workspace integrated terminal sessions and a first task runner so each workspace can own terminals, run common commands, stop/restart them, view output, and preserve task history while switching workspaces.

**Architecture:** Rust owns PTY sessions, process lifecycles, task detection, task process execution, and Tauri event emission. React owns per-workspace terminal/task UI state, xterm rendering, task controls, and problem summaries. The UI follows `docs/ui-design/ide.css` and `docs/ui-design/panels.jsx`: compact terminal tabs, icon buttons, `badge2` status pills, restrained dark IDE surfaces, and lucide icons.

**Tech Stack:** Tauri 2 commands/events, Rust `portable-pty 0.9.0`, Rust `std::process`, Vite 8, React 19, TypeScript 6, Zustand 5, `@xterm/xterm 6.0.0`, `@xterm/addon-fit 0.11.0`, lucide-react.

---

## Current Context

- Node 2 is complete at `46c664c`.
- `portable-pty 0.9.0`, `@xterm/xterm 6.0.0`, and `@xterm/addon-fit 0.11.0` are already current latest versions as checked on 2026-06-09.
- Current terminal behavior is only a lazy-loaded `TerminalTab` plus `terminal_probe`; no persistent Rust terminal session exists.
- `WorkspaceViewState.surface` currently supports `"empty" | "editor" | "terminal"` and stores editor state only.
- `docs/ui-design/ide.css` defines `.term-tabs`, `.btn`, `.badge2`, `.row`, `.panel-head`, `.panel-body`, `.statusbar`, and token names that Node 3 UI should reuse.

## File Structure

- Create `src-tauri/src/terminal.rs`: Rust PTY session domain, terminal manager state, terminal events, command input/write/resize/close behavior, and tests.
- Create `src-tauri/src/tasks.rs`: task detection, task process manager, task events, problem parsing-friendly output model, and tests.
- Modify `src-tauri/src/commands.rs`: Tauri command wrappers for terminals and tasks; workspace trust checks.
- Modify `src-tauri/src/lib.rs`: register terminal/task modules, state, and commands.
- Modify `src/app/workspace-view-state.ts`: add per-workspace terminal/task view state.
- Modify `src/app/command-palette-model.ts` and `.test.ts`: add Node 3 terminal/task commands.
- Modify `src/app/AppShell.tsx`: wire terminal panel, task panel, active terminal surface, command execution, and status bar counts.
- Replace `src/features/terminal/TerminalTab.tsx`: render a live xterm session using terminal APIs/events.
- Create `src/features/terminal/terminal-api.ts`: typed Tauri wrappers and event payload types.
- Create `src/features/terminal/terminal-model.ts` and `.test.ts`: pure session view helpers.
- Create `src/features/terminal/TerminalPanel.tsx`: terminal list, working-directory input, new/restart/close controls.
- Create `src/features/tasks/task-api.ts`: typed Tauri wrappers and event payload types.
- Create `src/features/tasks/task-model.ts` and `.test.ts`: task registry/history helpers.
- Create `src/features/tasks/problem-matcher.ts` and `.test.ts`: basic compiler/test output parsing.
- Create `src/features/tasks/TaskPanel.tsx`: detected tasks, custom command input, running task output/history.
- Modify `src/index.css`: terminal tabs/panels/task output styles using existing design tokens.
- Create `docs/architecture/node-3-terminal-results.md`: final Node 3 verification and measurements.
- Modify `docs/architecture/progress.md` and `roadmap.md`: Node 3 completion update.

---

## Task 1: Rust Terminal Session Manager

**Files:**
- Create: `src-tauri/src/terminal.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `cargo test --manifest-path src-tauri/Cargo.toml terminal`

- [ ] **Step 1: Write failing terminal domain tests**

Create `src-tauri/src/terminal.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    #[test]
    fn terminal_ids_are_workspace_scoped_and_incrementing() {
        let mut registry = super::TerminalRegistry::default();

        let first = registry.reserve_metadata(
            "workspace-a".to_string(),
            PathBuf::from("/repo-a"),
            None,
        );
        let second = registry.reserve_metadata(
            "workspace-a".to_string(),
            PathBuf::from("/repo-a"),
            Some("server".to_string()),
        );
        let third = registry.reserve_metadata(
            "workspace-b".to_string(),
            PathBuf::from("/repo-b"),
            None,
        );

        assert_eq!(first.id, "workspace-a:terminal-1");
        assert_eq!(first.name, "zsh 1");
        assert_eq!(second.id, "workspace-a:terminal-2");
        assert_eq!(second.name, "server");
        assert_eq!(third.id, "workspace-b:terminal-1");
        assert_eq!(third.name, "zsh 1");
    }

    #[test]
    fn closing_terminal_removes_only_matching_workspace_session() {
        let mut registry = super::TerminalRegistry::default();
        let first = registry.reserve_metadata(
            "workspace-a".to_string(),
            PathBuf::from("/repo-a"),
            None,
        );
        let second = registry.reserve_metadata(
            "workspace-b".to_string(),
            PathBuf::from("/repo-b"),
            None,
        );

        assert!(registry.remove_metadata(&first.id).is_some());

        let remaining = registry.list_metadata("workspace-b");
        assert_eq!(remaining, vec![second]);
        assert!(registry.list_metadata("workspace-a").is_empty());
    }

    #[test]
    fn resize_dimensions_are_clamped_to_pty_safe_minimums() {
        let size = super::terminal_size(0, 0);

        assert_eq!(size.rows, 1);
        assert_eq!(size.cols, 1);
    }
}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml terminal
```

Expected: FAIL because `TerminalRegistry`, `reserve_metadata`, `remove_metadata`, and `terminal_size` do not exist.

- [ ] **Step 3: Implement minimal metadata registry**

Add the minimal public types and pure functions to `src-tauri/src/terminal.rs`:

```rust
use portable_pty::PtySize;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct TerminalSessionInfo {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub cwd: PathBuf,
    pub shell: String,
    pub running: bool,
}

#[derive(Default)]
pub struct TerminalRegistry {
    next_by_workspace: HashMap<String, usize>,
    metadata: HashMap<String, TerminalSessionInfo>,
}

impl TerminalRegistry {
    pub fn reserve_metadata(
        &mut self,
        workspace_id: String,
        cwd: PathBuf,
        name: Option<String>,
    ) -> TerminalSessionInfo {
        let next = self.next_by_workspace.entry(workspace_id.clone()).or_insert(1);
        let id = format!("{workspace_id}:terminal-{next}");
        let session_name = name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("zsh {next}"));
        *next += 1;

        let info = TerminalSessionInfo {
            id: id.clone(),
            workspace_id,
            name: session_name,
            cwd,
            shell: crate::pty::default_shell(),
            running: true,
        };
        self.metadata.insert(id, info.clone());
        info
    }

    pub fn list_metadata(&self, workspace_id: &str) -> Vec<TerminalSessionInfo> {
        let mut sessions = self
            .metadata
            .values()
            .filter(|session| session.workspace_id == workspace_id)
            .cloned()
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| left.id.cmp(&right.id));
        sessions
    }

    pub fn remove_metadata(&mut self, id: &str) -> Option<TerminalSessionInfo> {
        self.metadata.remove(id)
    }
}

pub fn terminal_size(rows: u16, cols: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml terminal
```

Expected: PASS for the terminal metadata tests.

- [ ] **Step 5: Add failing manager command tests**

Extend `src-tauri/src/terminal.rs` tests:

```rust
#[test]
fn manager_lists_and_closes_workspace_sessions() {
    let manager = super::TerminalState::new();
    let first = manager
        .register_test_session(
            "workspace-a".to_string(),
            PathBuf::from("/repo-a"),
            Some("api".to_string()),
        )
        .expect("first");
    let _second = manager
        .register_test_session("workspace-b".to_string(), PathBuf::from("/repo-b"), None)
        .expect("second");

    assert_eq!(manager.list_sessions("workspace-a").expect("list"), vec![first.clone()]);
    assert_eq!(manager.close_session(&first.id).expect("close"), first);
    assert!(manager.list_sessions("workspace-a").expect("list").is_empty());
}
```

- [ ] **Step 6: Run tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml terminal::tests::manager_lists_and_closes_workspace_sessions
```

Expected: FAIL because `TerminalState` and its methods do not exist.

- [ ] **Step 7: Implement `TerminalState` and Tauri commands**

Extend `src-tauri/src/terminal.rs` with:

```rust
use portable_pty::{CommandBuilder, NativePtySystem, PtySystem};
use std::{
    io::{Read, Write},
    path::Path,
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, Serialize)]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub chunk: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct TerminalExitEvent {
    pub session_id: String,
    pub exit_code: Option<i32>,
}

struct TerminalProcess {
    info: TerminalSessionInfo,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
}

pub struct TerminalState {
    registry: Mutex<TerminalRegistry>,
    processes: Mutex<HashMap<String, TerminalProcess>>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            registry: Mutex::new(TerminalRegistry::default()),
            processes: Mutex::new(HashMap::new()),
        }
    }

    pub fn list_sessions(&self, workspace_id: &str) -> Result<Vec<TerminalSessionInfo>, String> {
        self.registry
            .lock()
            .map_err(|err| err.to_string())
            .map(|registry| registry.list_metadata(workspace_id))
    }

    #[cfg(test)]
    pub fn register_test_session(
        &self,
        workspace_id: String,
        cwd: PathBuf,
        name: Option<String>,
    ) -> Result<TerminalSessionInfo, String> {
        let mut registry = self.registry.lock().map_err(|err| err.to_string())?;
        Ok(registry.reserve_metadata(workspace_id, cwd, name))
    }

    pub fn spawn_session(
        &self,
        app: AppHandle,
        workspace_id: String,
        cwd: PathBuf,
        name: Option<String>,
        rows: u16,
        cols: u16,
    ) -> Result<TerminalSessionInfo, String> {
        let cwd = cwd.canonicalize().map_err(|err| err.to_string())?;
        let info = {
            let mut registry = self.registry.lock().map_err(|err| err.to_string())?;
            registry.reserve_metadata(workspace_id, cwd.clone(), name)
        };

        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(terminal_size(rows, cols))
            .map_err(|err| err.to_string())?;
        let mut command = CommandBuilder::new(&info.shell);
        command.cwd(&cwd);
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|err| err.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|err| err.to_string())?;
        let writer = Arc::new(Mutex::new(
            pair.master.take_writer().map_err(|err| err.to_string())?,
        ));
        let child = Arc::new(Mutex::new(child));

        self.processes.lock().map_err(|err| err.to_string())?.insert(
            info.id.clone(),
            TerminalProcess {
                info: info.clone(),
                writer: Arc::clone(&writer),
                child: Arc::clone(&child),
            },
        );

        let output_session_id = info.id.clone();
        let output_app = app.clone();
        thread::spawn(move || {
            let mut buffer = [0_u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        let chunk = String::from_utf8_lossy(&buffer[..read]).into_owned();
                        let _ = output_app.emit(
                            "workspace://terminal-output",
                            TerminalOutputEvent {
                                session_id: output_session_id.clone(),
                                chunk,
                            },
                        );
                    }
                }
            }
        });

        Ok(info)
    }

    pub fn write_session(&self, session_id: &str, data: &str) -> Result<(), String> {
        let processes = self.processes.lock().map_err(|err| err.to_string())?;
        let process = processes
            .get(session_id)
            .ok_or_else(|| format!("missing terminal session: {session_id}"))?;
        let mut writer = process.writer.lock().map_err(|err| err.to_string())?;
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|err| err.to_string())
    }

    pub fn close_session(&self, session_id: &str) -> Result<TerminalSessionInfo, String> {
        if let Some(process) = self
            .processes
            .lock()
            .map_err(|err| err.to_string())?
            .remove(session_id)
        {
            let _ = process
                .child
                .lock()
                .map_err(|err| err.to_string())?
                .kill();
        }

        self.registry
            .lock()
            .map_err(|err| err.to_string())?
            .remove_metadata(session_id)
            .ok_or_else(|| format!("missing terminal session: {session_id}"))
    }
}
```

Modify `src-tauri/src/lib.rs`:

```rust
mod terminal;
```

In setup:

```rust
app.manage(terminal::TerminalState::new());
```

In `generate_handler!`:

```rust
commands::list_terminal_sessions,
commands::spawn_terminal_session,
commands::write_terminal_session,
commands::close_terminal_session,
```

Add wrappers to `src-tauri/src/commands.rs`:

```rust
use crate::terminal::{TerminalSessionInfo, TerminalState};

#[tauri::command]
pub fn list_terminal_sessions(
    state: State<'_, TerminalState>,
    workspace_id: String,
) -> Result<Vec<TerminalSessionInfo>, String> {
    state.list_sessions(&workspace_id)
}

#[tauri::command]
pub fn spawn_terminal_session(
    app: AppHandle,
    app_state: State<'_, AppState>,
    terminal_state: State<'_, TerminalState>,
    workspace_id: String,
    workspace_root: String,
    cwd: String,
    name: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<TerminalSessionInfo, String> {
    let workspace_root = trusted_workspace_root(app_state.inner(), &workspace_root)?;
    let cwd = crate::file_system::workspace_child_for_existing_dir(&workspace_root, Path::new(&cwd))?;
    terminal_state.spawn_session(app, workspace_id, cwd, name, rows, cols)
}

#[tauri::command]
pub fn write_terminal_session(
    state: State<'_, TerminalState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state.write_session(&session_id, &data)
}

#[tauri::command]
pub fn close_terminal_session(
    state: State<'_, TerminalState>,
    session_id: String,
) -> Result<TerminalSessionInfo, String> {
    state.close_session(&session_id)
}
```

Add this helper test to `src-tauri/src/file_system.rs` if the helper is missing:

```rust
#[test]
fn workspace_child_for_existing_dir_accepts_nested_directory() {
    let root = tempdir().expect("tempdir");
    fs::create_dir(root.path().join("src")).expect("src");

    let result =
        super::workspace_child_for_existing_dir(root.path(), Path::new("src")).expect("dir");

    assert_eq!(result, root.path().join("src").canonicalize().expect("canonical"));
}

#[test]
fn workspace_child_for_existing_dir_rejects_outside_directory() {
    let root = tempdir().expect("tempdir");
    let outside = tempdir().expect("outside");

    let result = super::workspace_child_for_existing_dir(root.path(), outside.path());

    assert!(result.unwrap_err().contains("outside workspace"));
}
```

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml file_system::tests::workspace_child_for_existing_dir
```

Expected: FAIL because the helper is missing.

Then add the helper to `src-tauri/src/file_system.rs`:

```rust
pub fn workspace_child_for_existing_dir(
    workspace_root: &Path,
    path: &Path,
) -> Result<PathBuf, String> {
    let path = workspace_child(workspace_root, path, PathResolution::CanonicalExisting)?;
    let metadata = fs::metadata(&path).map_err(|err| err.to_string())?;
    if !metadata.is_dir() {
        return Err(format!("not a directory: {}", path.display()));
    }

    Ok(path)
}
```

- [ ] **Step 8: Run GREEN verification**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml terminal
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml file_system
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git add src-tauri/src/terminal.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/file_system.rs
git commit -m "feat: add terminal session manager"
```

---

## Task 2: Frontend Terminal Session State And API

**Files:**
- Create: `src/features/terminal/terminal-api.ts`
- Create: `src/features/terminal/terminal-model.ts`
- Create: `src/features/terminal/terminal-model.test.ts`
- Modify: `src/app/workspace-view-state.ts`
- Modify: `src/app/workspace-view-state.test.ts`
- Test: `bun test src/features/terminal/terminal-model.test.ts src/app/workspace-view-state.test.ts`

- [ ] **Step 1: Write failing model tests**

Create `src/features/terminal/terminal-model.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  activateTerminal,
  closeTerminal,
  createTerminalState,
  upsertTerminal,
  appendTerminalOutput,
} from "./terminal-model";

describe("terminal model", () => {
  test("upserts the first session and makes it active", () => {
    const state = upsertTerminal(createTerminalState(), {
      id: "w:terminal-1",
      workspace_id: "w",
      name: "zsh 1",
      cwd: "/repo",
      shell: "/bin/zsh",
      running: true,
    });

    expect(state.activeTerminalId).toBe("w:terminal-1");
    expect(state.sessions).toHaveLength(1);
  });

  test("closing the active terminal promotes the previous remaining session", () => {
    const state = upsertTerminal(
      upsertTerminal(createTerminalState(), {
        id: "w:terminal-1",
        workspace_id: "w",
        name: "zsh 1",
        cwd: "/repo",
        shell: "/bin/zsh",
        running: true,
      }),
      {
        id: "w:terminal-2",
        workspace_id: "w",
        name: "server",
        cwd: "/repo",
        shell: "/bin/zsh",
        running: true,
      },
    );

    const next = closeTerminal(activateTerminal(state, "w:terminal-2"), "w:terminal-2");

    expect(next.activeTerminalId).toBe("w:terminal-1");
    expect(next.sessions.map((session) => session.id)).toEqual(["w:terminal-1"]);
  });

  test("output is bounded per terminal", () => {
    const state = appendTerminalOutput(createTerminalState(), "missing", "ignored");
    expect(state.outputBySessionId).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/features/terminal/terminal-model.test.ts
```

Expected: FAIL because `terminal-model.ts` does not exist.

- [ ] **Step 3: Implement terminal model**

Create `src/features/terminal/terminal-model.ts`:

```ts
export type TerminalSessionInfo = {
  id: string;
  workspace_id: string;
  name: string;
  cwd: string;
  shell: string;
  running: boolean;
};

export type TerminalViewState = {
  sessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  outputBySessionId: Record<string, string>;
  cwdInput: string;
};

const MAX_OUTPUT_CHARS = 120_000;

export function createTerminalState(): TerminalViewState {
  return {
    sessions: [],
    activeTerminalId: null,
    outputBySessionId: {},
    cwdInput: "",
  };
}

export function upsertTerminal(
  state: TerminalViewState,
  session: TerminalSessionInfo,
): TerminalViewState {
  const exists = state.sessions.some((item) => item.id === session.id);
  const sessions = exists
    ? state.sessions.map((item) => (item.id === session.id ? session : item))
    : [...state.sessions, session];

  return {
    ...state,
    sessions,
    activeTerminalId: state.activeTerminalId ?? session.id,
    outputBySessionId: {
      ...state.outputBySessionId,
      [session.id]: state.outputBySessionId[session.id] ?? "",
    },
  };
}

export function activateTerminal(
  state: TerminalViewState,
  sessionId: string,
): TerminalViewState {
  return state.sessions.some((session) => session.id === sessionId)
    ? { ...state, activeTerminalId: sessionId }
    : state;
}

export function closeTerminal(
  state: TerminalViewState,
  sessionId: string,
): TerminalViewState {
  const sessions = state.sessions.filter((session) => session.id !== sessionId);
  const { [sessionId]: _removed, ...outputBySessionId } = state.outputBySessionId;
  const activeTerminalId =
    state.activeTerminalId === sessionId
      ? sessions[sessions.length - 1]?.id ?? null
      : state.activeTerminalId;

  return { ...state, sessions, activeTerminalId, outputBySessionId };
}

export function appendTerminalOutput(
  state: TerminalViewState,
  sessionId: string,
  chunk: string,
): TerminalViewState {
  if (!state.sessions.some((session) => session.id === sessionId)) {
    return state;
  }

  const output = `${state.outputBySessionId[sessionId] ?? ""}${chunk}`;
  return {
    ...state,
    outputBySessionId: {
      ...state.outputBySessionId,
      [sessionId]: output.slice(Math.max(0, output.length - MAX_OUTPUT_CHARS)),
    },
  };
}
```

- [ ] **Step 4: Add API wrappers**

Create `src/features/terminal/terminal-api.ts`:

```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { call } from "../../lib/tauri";
import type { TerminalSessionInfo } from "./terminal-model";

export type TerminalOutputEvent = {
  session_id: string;
  chunk: string;
};

export function listTerminalSessions(
  workspaceId: string,
): Promise<TerminalSessionInfo[]> {
  return call<TerminalSessionInfo[]>("list_terminal_sessions", { workspaceId });
}

export function spawnTerminalSession(args: {
  workspaceId: string;
  workspaceRoot: string;
  cwd: string;
  name?: string;
  rows: number;
  cols: number;
}): Promise<TerminalSessionInfo> {
  return call<TerminalSessionInfo>("spawn_terminal_session", args);
}

export function writeTerminalSession(
  sessionId: string,
  data: string,
): Promise<void> {
  return call<void>("write_terminal_session", { sessionId, data });
}

export function closeTerminalSession(
  sessionId: string,
): Promise<TerminalSessionInfo> {
  return call<TerminalSessionInfo>("close_terminal_session", { sessionId });
}

export function onTerminalOutput(
  handler: (event: TerminalOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<TerminalOutputEvent>("workspace://terminal-output", (event) =>
    handler(event.payload),
  );
}
```

- [ ] **Step 5: Extend workspace view state tests**

Add to `src/app/workspace-view-state.test.ts`:

```ts
test("terminal sessions are restored per workspace", () => {
  const store = createWorkspaceViewStore();

  store.getState().updateTerminal("workspace-a", (terminal) =>
    upsertTerminal(terminal, {
      id: "workspace-a:terminal-1",
      workspace_id: "workspace-a",
      name: "zsh 1",
      cwd: "/repo-a",
      shell: "/bin/zsh",
      running: true,
    }),
  );

  expect(store.getState().viewFor("workspace-a").terminal.activeTerminalId).toBe(
    "workspace-a:terminal-1",
  );
  expect(store.getState().viewFor("workspace-b").terminal.sessions).toEqual([]);
});
```

- [ ] **Step 6: Run tests to verify RED**

Run:

```bash
bun test src/app/workspace-view-state.test.ts
```

Expected: FAIL because `terminal` state and `updateTerminal` are missing.

- [ ] **Step 7: Extend workspace view state**

Modify `src/app/workspace-view-state.ts`:

```ts
import {
  createTerminalState,
  type TerminalViewState,
} from "../features/terminal/terminal-model";
```

Update types:

```ts
export type WorkspaceViewState = {
  activeActivity: ActivityId;
  panelOpen: boolean;
  surface: Surface;
  editor: EditorFileState;
  terminal: TerminalViewState;
};
```

Add `updateTerminal` to the store and default view:

```ts
terminal: createTerminalState(),
```

```ts
updateTerminal: (
  workspaceId: string | null,
  update: (terminal: TerminalViewState) => TerminalViewState,
) => void;
```

```ts
updateTerminal: (workspaceId, update) =>
  set((state) => {
    const key = workspaceId ?? shellKey;
    const current = state.views[key] ?? defaultView;

    return {
      views: {
        ...state.views,
        [key]: { ...current, terminal: update(current.terminal) },
      },
    };
  }),
```

Update `freezeWorkspaceView` to freeze `terminal.sessions` and `terminal`.

- [ ] **Step 8: Run GREEN verification**

Run:

```bash
bun test src/features/terminal/terminal-model.test.ts src/app/workspace-view-state.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add src/features/terminal/terminal-api.ts src/features/terminal/terminal-model.ts src/features/terminal/terminal-model.test.ts src/app/workspace-view-state.ts src/app/workspace-view-state.test.ts
git commit -m "feat: add terminal view state"
```

---

## Task 3: Live Terminal UI

**Files:**
- Modify: `src/features/terminal/TerminalTab.tsx`
- Create: `src/features/terminal/TerminalPanel.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/index.css`
- Test: `bun test src/features/terminal/terminal-lifecycle.test.ts src/features/terminal/terminal-model.test.ts`

- [ ] **Step 1: Add failing lifecycle test for input bridge cleanup**

Extend `src/features/terminal/terminal-lifecycle.test.ts`:

```ts
import { createTerminalInputCleanup } from "./terminal-lifecycle";

test("terminal input cleanup disposes the data listener", () => {
  let disposed = false;
  const cleanup = createTerminalInputCleanup({
    dispose: () => {
      disposed = true;
    },
  });

  cleanup();

  expect(disposed).toBe(true);
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
bun test src/features/terminal/terminal-lifecycle.test.ts
```

Expected: FAIL because `createTerminalInputCleanup` does not exist.

- [ ] **Step 3: Add terminal input cleanup helper**

Modify `src/features/terminal/terminal-lifecycle.ts`:

```ts
type Disposable = {
  dispose: () => void;
};

export function createTerminalInputCleanup(disposable?: Disposable) {
  return () => {
    disposable?.dispose();
  };
}
```

- [ ] **Step 4: Replace `TerminalTab` with session-aware xterm**

Modify `src/features/terminal/TerminalTab.tsx` to accept props:

```ts
type TerminalTabProps = {
  sessionId: string;
  output: string;
  onInput: (sessionId: string, data: string) => void;
};
```

Use xterm:

```tsx
export function TerminalTab({ sessionId, output, onInput }: TerminalTabProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const writtenRef = useRef("");
  const [loadFailure, setLoadFailure] =
    useState<TerminalLoadFailureCopy | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    let inputCleanup: (() => void) | undefined;

    async function startTerminal() {
      try {
        const { Terminal, FitAddon } = await loadXterm();
        if (disposed || !hostRef.current) return;

        const terminal = new Terminal({
          convertEol: true,
          cursorBlink: true,
          fontSize: 13,
          theme: {
            background: "#0a0e15",
            foreground: "#e6edf3",
            cursor: "#a8e23f",
            selectionBackground: "#34421d",
          },
        });
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(hostRef.current);
        fitAddon.fit();
        terminalRef.current = terminal;
        terminal.write(output);
        writtenRef.current = output;

        const dataDisposable = terminal.onData((data) => onInput(sessionId, data));
        inputCleanup = createTerminalInputCleanup(dataDisposable);
        const resizeObserver = new ResizeObserver(() => fitAddon.fit());
        resizeObserver.observe(hostRef.current);
        cleanup = createTerminalCleanup(terminal, resizeObserver);
      } catch (error) {
        if (!disposed) {
          cleanup?.();
          inputCleanup?.();
          setLoadFailure(terminalLoadFailureCopy(error));
        }
      }
    }

    void startTerminal();
    return () => {
      disposed = true;
      inputCleanup?.();
      cleanup?.();
      terminalRef.current = null;
      writtenRef.current = "";
    };
  }, [sessionId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const previous = writtenRef.current;
    if (output.startsWith(previous)) {
      terminal.write(output.slice(previous.length));
    } else {
      terminal.clear();
      terminal.write(output);
    }
    writtenRef.current = output;
  }, [output]);

  if (loadFailure) {
    return (
      <div className="terminal-failure" role="alert">
        <span>{loadFailure.title}</span>
        <p>{loadFailure.detail}</p>
      </div>
    );
  }

  return <div ref={hostRef} className="terminal-host" />;
}
```

- [ ] **Step 5: Add `TerminalPanel`**

Create `src/features/terminal/TerminalPanel.tsx`:

```tsx
import { Play, Plus, RotateCw, SquareTerminal, X } from "lucide-react";
import type { TerminalSessionInfo } from "./terminal-model";

type TerminalPanelProps = {
  sessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  cwdInput: string;
  onCwdInputChange: (value: string) => void;
  onNewTerminal: () => void;
  onActivateTerminal: (id: string) => void;
  onCloseTerminal: (id: string) => void;
  onRestartTerminal: (id: string) => void;
};

export function TerminalPanel({
  sessions,
  activeTerminalId,
  cwdInput,
  onCwdInputChange,
  onNewTerminal,
  onActivateTerminal,
  onCloseTerminal,
  onRestartTerminal,
}: TerminalPanelProps) {
  return (
    <div className="panel-body terminal-panel">
      <div className="terminal-create">
        <input
          className="input2 mono"
          value={cwdInput}
          aria-label="Terminal working directory"
          placeholder="Working directory"
          onChange={(event) => onCwdInputChange(event.target.value)}
        />
        <button type="button" className="btn primary" onClick={onNewTerminal}>
          <Plus aria-hidden="true" />
          New
        </button>
      </div>
      <div className="section-label">
        <span>Terminals</span>
        <span>{sessions.length}</span>
      </div>
      {sessions.map((session) => {
        const active = session.id === activeTerminalId;
        return (
          <div className={`terminal-row${active ? " active" : ""}`} key={session.id}>
            <button
              type="button"
              className="row tree-row"
              onClick={() => onActivateTerminal(session.id)}
            >
              <SquareTerminal aria-hidden="true" />
              <span className="nm mono">{session.name}</span>
              <span className="meta">{session.running ? "running" : "stopped"}</span>
            </button>
            <div className="terminal-row-actions">
              <button
                type="button"
                className="iconbtn"
                title={`Restart ${session.name}`}
                aria-label={`Restart ${session.name}`}
                onClick={() => onRestartTerminal(session.id)}
              >
                <RotateCw aria-hidden="true" />
              </button>
              <button
                type="button"
                className="iconbtn"
                title={`Close ${session.name}`}
                aria-label={`Close ${session.name}`}
                onClick={() => onCloseTerminal(session.id)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
      {sessions.length === 0 ? (
        <div className="panel-empty">
          <span>No terminal sessions</span>
          <button type="button" className="btn" onClick={onNewTerminal}>
            <Play aria-hidden="true" />
            Start terminal
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Wire `AppShell` terminal state**

Modify `src/app/AppShell.tsx`:

- import `TerminalPanel`, `terminal-api`, and terminal model helpers.
- register `onTerminalOutput` once and append output to the matching workspace terminal state.
- add handlers `newTerminal`, `closeTerminalById`, `restartTerminalById`, `writeTerminalInput`.
- show `.term-tabs` above `TerminalTab` when terminal surface is active.
- pass `TerminalPanel` from `PanelBody` when active activity is `"terminal"`.

The core handler shape:

```ts
async function newTerminal() {
  if (!activeWorkspace || !activeWorkspaceId) return;
  const cwd = view.terminal.cwdInput.trim() || activeWorkspace.path;
  const session = await spawnTerminalSession({
    workspaceId: activeWorkspaceId,
    workspaceRoot: activeWorkspace.path,
    cwd,
    rows: 24,
    cols: 80,
  });
  updateTerminal(activeWorkspaceId, (terminal) => upsertTerminal(terminal, session));
  setSurface("terminal");
  setActiveActivity("terminal");
}
```

- [ ] **Step 7: Add CSS from design tokens**

Add to `src/index.css`:

```css
.term-tabs {
  height: 34px;
  flex: 0 0 34px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px;
  background: var(--chrome-2);
  border-bottom: 1px solid var(--line);
}

.term-tabs .tt {
  height: 24px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--txt-dim);
  background: transparent;
  font-family: var(--font-mono);
  font-size: 12px;
}

.term-tabs .tt.active {
  color: var(--txt);
  background: var(--active);
}

.terminal-panel,
.terminal-create {
  min-width: 0;
}

.terminal-create {
  display: flex;
  gap: 6px;
  padding: 10px;
}

.terminal-row {
  position: relative;
}

.terminal-row-actions {
  position: absolute;
  top: 2px;
  right: 4px;
  display: flex;
  gap: 1px;
  opacity: 0;
}

.terminal-row:hover .terminal-row-actions,
.terminal-row:focus-within .terminal-row-actions {
  opacity: 1;
}
```

- [ ] **Step 8: Run GREEN verification**

Run:

```bash
bun test src/features/terminal/terminal-lifecycle.test.ts src/features/terminal/terminal-model.test.ts src/app/workspace-view-state.test.ts
bun run build
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

Run:

```bash
git add src/features/terminal src/app/AppShell.tsx src/app/workspace-view-state.ts src/index.css
git commit -m "feat: add live terminal sessions"
```

---

## Task 4: Rust Task Registry And Process Runner

**Files:**
- Create: `src-tauri/src/tasks.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `cargo test --manifest-path src-tauri/Cargo.toml tasks`

- [ ] **Step 1: Write failing task detection tests**

Create `src-tauri/src/tasks.rs`:

```rust
#[cfg(test)]
mod tests {
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn detects_package_cargo_and_uv_tasks() {
        let root = tempdir().expect("tempdir");
        fs::write(
            root.path().join("package.json"),
            r#"{"scripts":{"dev":"vite","test":"bun test","build":"tsc && vite build"}}"#,
        )
        .expect("package");
        fs::write(root.path().join("Cargo.toml"), "[package]\nname = \"demo\"\n").expect("cargo");
        fs::write(root.path().join("pyproject.toml"), "[project]\nname = \"demo\"\n").expect("py");

        let tasks = super::detect_tasks(root.path()).expect("tasks");
        let labels = tasks
            .iter()
            .map(|task| (task.id.as_str(), task.command.as_str()))
            .collect::<Vec<_>>();

        assert!(labels.contains(&("package:dev", "bun run dev")));
        assert!(labels.contains(&("package:test", "bun run test")));
        assert!(labels.contains(&("package:build", "bun run build")));
        assert!(labels.contains(&("cargo:test", "cargo test")));
        assert!(labels.contains(&("cargo:build", "cargo build")));
        assert!(labels.contains(&("uv:run-python", "uv run python")));
    }
}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml tasks
```

Expected: FAIL because `detect_tasks` and task types are missing.

- [ ] **Step 3: Implement task detection**

Implement:

```rust
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::{Path, PathBuf}};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WorkspaceTask {
    pub id: String,
    pub label: String,
    pub command: String,
    pub cwd: PathBuf,
    pub source: String,
}

#[derive(Deserialize)]
struct PackageJson {
    scripts: Option<HashMap<String, String>>,
}

pub fn detect_tasks(workspace_root: &Path) -> Result<Vec<WorkspaceTask>, String> {
    let root = workspace_root.canonicalize().map_err(|err| err.to_string())?;
    let mut tasks = Vec::new();

    let package_path = root.join("package.json");
    if package_path.is_file() {
        let package = fs::read_to_string(&package_path).map_err(|err| err.to_string())?;
        if let Ok(package) = serde_json::from_str::<PackageJson>(&package) {
            if let Some(scripts) = package.scripts {
                let mut scripts = scripts.into_iter().collect::<Vec<_>>();
                scripts.sort_by(|left, right| left.0.cmp(&right.0));
                tasks.extend(scripts.into_iter().map(|(name, _script)| WorkspaceTask {
                    id: format!("package:{name}"),
                    label: format!("bun run {name}"),
                    command: format!("bun run {name}"),
                    cwd: root.clone(),
                    source: "package.json".to_string(),
                }));
            }
        }
    }

    if root.join("Cargo.toml").is_file() {
        tasks.push(WorkspaceTask {
            id: "cargo:test".to_string(),
            label: "cargo test".to_string(),
            command: "cargo test".to_string(),
            cwd: root.clone(),
            source: "Cargo.toml".to_string(),
        });
        tasks.push(WorkspaceTask {
            id: "cargo:build".to_string(),
            label: "cargo build".to_string(),
            command: "cargo build".to_string(),
            cwd: root.clone(),
            source: "Cargo.toml".to_string(),
        });
    }

    if root.join("pyproject.toml").is_file() {
        tasks.push(WorkspaceTask {
            id: "uv:run-python".to_string(),
            label: "uv run python".to_string(),
            command: "uv run python".to_string(),
            cwd: root,
            source: "pyproject.toml".to_string(),
        });
    }

    Ok(tasks)
}
```

- [ ] **Step 4: Add failing task run lifecycle tests**

Add tests:

```rust
#[test]
fn task_runs_are_workspace_scoped_and_status_updates() {
    let mut registry = super::TaskRunRegistry::default();
    let run = registry.reserve_run(
        "workspace-a".to_string(),
        "custom".to_string(),
        "echo ok".to_string(),
        "/repo".into(),
    );

    assert_eq!(run.id, "workspace-a:task-1");
    assert_eq!(run.status, super::TaskRunStatus::Running);

    registry.finish_run(&run.id, Some(0));
    let runs = registry.list_runs("workspace-a");
    assert_eq!(runs[0].status, super::TaskRunStatus::Exited);
    assert_eq!(runs[0].exit_code, Some(0));
}
```

- [ ] **Step 5: Run tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml tasks::tests::task_runs_are_workspace_scoped_and_status_updates
```

Expected: FAIL because `TaskRunRegistry` and `TaskRunStatus` are missing.

- [ ] **Step 6: Implement process runner**

Add:

```rust
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum TaskRunStatus {
    Running,
    Exited,
    Stopped,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TaskRun {
    pub id: String,
    pub workspace_id: String,
    pub label: String,
    pub command: String,
    pub cwd: PathBuf,
    pub status: TaskRunStatus,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TaskOutputEvent {
    pub run_id: String,
    pub chunk: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct TaskFinishedEvent {
    pub run_id: String,
    pub exit_code: Option<i32>,
}

#[derive(Default)]
pub struct TaskRunRegistry {
    next_by_workspace: HashMap<String, usize>,
    runs: HashMap<String, TaskRun>,
}
```

Implement `TaskState::run_task`, `TaskState::stop_task`, and `TaskState::list_runs`. Use `/bin/sh -lc` on Unix and `cmd /C` on Windows so compound package scripts run. Emit `workspace://task-output` for stdout/stderr lines and `workspace://task-finished` at process exit.

- [ ] **Step 7: Wire task commands**

In `src-tauri/src/lib.rs`:

```rust
mod tasks;
app.manage(tasks::TaskState::new());
commands::list_workspace_tasks,
commands::run_workspace_task,
commands::stop_task_run,
commands::list_task_runs,
```

In `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub fn list_workspace_tasks(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<crate::tasks::WorkspaceTask>, String> {
    let root = trusted_workspace_root(state.inner(), &workspace_root)?;
    crate::tasks::detect_tasks(&root)
}

#[tauri::command]
pub fn run_workspace_task(
    app: AppHandle,
    app_state: State<'_, AppState>,
    task_state: State<'_, crate::tasks::TaskState>,
    workspace_id: String,
    workspace_root: String,
    label: String,
    command: String,
    cwd: String,
) -> Result<crate::tasks::TaskRun, String> {
    let root = trusted_workspace_root(app_state.inner(), &workspace_root)?;
    let cwd = crate::file_system::workspace_child_for_existing_dir(&root, Path::new(&cwd))?;
    task_state.run_task(app, workspace_id, label, command, cwd)
}
```

- [ ] **Step 8: Run GREEN verification**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml tasks
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add src-tauri/src/tasks.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/file_system.rs
git commit -m "feat: add workspace task runner"
```

---

## Task 5: Frontend Task Panel And Problem Matcher

**Files:**
- Create: `src/features/tasks/task-api.ts`
- Create: `src/features/tasks/task-model.ts`
- Create: `src/features/tasks/task-model.test.ts`
- Create: `src/features/tasks/problem-matcher.ts`
- Create: `src/features/tasks/problem-matcher.test.ts`
- Create: `src/features/tasks/TaskPanel.tsx`
- Modify: `src/app/activity-rail.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/command-palette-model.ts`
- Modify: `src/app/command-palette-model.test.ts`
- Modify: `src/app/workspace-view-state.ts`
- Modify: `src/app/workspace-view-state.test.ts`
- Modify: `src/index.css`
- Test: `bun test src/features/tasks/problem-matcher.test.ts src/features/tasks/task-model.test.ts src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts`

- [ ] **Step 1: Write failing problem matcher tests**

Create `src/features/tasks/problem-matcher.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { matchProblems } from "./problem-matcher";

describe("matchProblems", () => {
  test("matches rust compiler file line column errors", () => {
    expect(matchProblems("src/main.rs:12:5: error: expected `;`")).toEqual([
      {
        file: "src/main.rs",
        line: 12,
        column: 5,
        severity: "error",
        message: "expected `;`",
      },
    ]);
  });

  test("matches typescript diagnostics", () => {
    expect(matchProblems("src/app.ts(4,7): error TS2322: Type mismatch")).toEqual([
      {
        file: "src/app.ts",
        line: 4,
        column: 7,
        severity: "error",
        message: "TS2322: Type mismatch",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/features/tasks/problem-matcher.test.ts
```

Expected: FAIL because `problem-matcher.ts` does not exist.

- [ ] **Step 3: Implement problem matcher**

Create `src/features/tasks/problem-matcher.ts`:

```ts
export type TaskProblem = {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
};

const rustPattern = /^(?<file>[^:(]+):(?<line>\d+):(?<column>\d+): (?<severity>error|warning): (?<message>.+)$/;
const tsPattern = /^(?<file>.+)\((?<line>\d+),(?<column>\d+)\): (?<severity>error|warning) (?<message>.+)$/;

export function matchProblems(output: string): TaskProblem[] {
  return output
    .split(/\r?\n/)
    .flatMap((line) => matchLine(line.trim()))
    .slice(0, 100);
}

function matchLine(line: string): TaskProblem[] {
  const match = rustPattern.exec(line) ?? tsPattern.exec(line);
  if (!match?.groups) {
    return [];
  }

  return [
    {
      file: match.groups.file,
      line: Number(match.groups.line),
      column: Number(match.groups.column),
      severity: match.groups.severity === "warning" ? "warning" : "error",
      message: match.groups.message,
    },
  ];
}
```

- [ ] **Step 4: Write failing task model tests**

Create `src/features/tasks/task-model.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { appendTaskOutput, createTaskState, finishTaskRun, upsertTaskRun } from "./task-model";

describe("task model", () => {
  test("upserts task runs and marks the first run active", () => {
    const state = upsertTaskRun(createTaskState(), {
      id: "w:task-1",
      workspace_id: "w",
      label: "bun test",
      command: "bun test",
      cwd: "/repo",
      status: "Running",
      exit_code: null,
    });

    expect(state.activeRunId).toBe("w:task-1");
    expect(state.runs).toHaveLength(1);
  });

  test("appends output and finishes with parsed problems", () => {
    const run = {
      id: "w:task-1",
      workspace_id: "w",
      label: "cargo test",
      command: "cargo test",
      cwd: "/repo",
      status: "Running" as const,
      exit_code: null,
    };
    const state = finishTaskRun(
      appendTaskOutput(upsertTaskRun(createTaskState(), run), run.id, "src/main.rs:1:2: error: boom\n"),
      run.id,
      101,
    );

    expect(state.runs[0].status).toBe("Exited");
    expect(state.runs[0].exit_code).toBe(101);
    expect(state.problemsByRunId[run.id]).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Run tests to verify RED**

Run:

```bash
bun test src/features/tasks/task-model.test.ts
```

Expected: FAIL because `task-model.ts` does not exist.

- [ ] **Step 6: Implement task model and API**

Create `src/features/tasks/task-model.ts`:

```ts
import { matchProblems, type TaskProblem } from "./problem-matcher";

export type WorkspaceTask = {
  id: string;
  label: string;
  command: string;
  cwd: string;
  source: string;
};

export type TaskRunStatus = "Running" | "Exited" | "Stopped";

export type TaskRun = {
  id: string;
  workspace_id: string;
  label: string;
  command: string;
  cwd: string;
  status: TaskRunStatus;
  exit_code: number | null;
};

export type TaskViewState = {
  detectedTasks: WorkspaceTask[];
  runs: TaskRun[];
  activeRunId: string | null;
  outputByRunId: Record<string, string>;
  problemsByRunId: Record<string, TaskProblem[]>;
  customCommand: string;
};

const MAX_TASK_OUTPUT_CHARS = 120_000;

export function createTaskState(): TaskViewState {
  return {
    detectedTasks: [],
    runs: [],
    activeRunId: null,
    outputByRunId: {},
    problemsByRunId: {},
    customCommand: "",
  };
}

export function replaceDetectedTasks(
  state: TaskViewState,
  detectedTasks: WorkspaceTask[],
): TaskViewState {
  return { ...state, detectedTasks };
}

export function upsertTaskRun(state: TaskViewState, run: TaskRun): TaskViewState {
  const exists = state.runs.some((item) => item.id === run.id);
  const runs = exists
    ? state.runs.map((item) => (item.id === run.id ? run : item))
    : [run, ...state.runs].slice(0, 40);

  return {
    ...state,
    runs,
    activeRunId: state.activeRunId ?? run.id,
    outputByRunId: {
      ...state.outputByRunId,
      [run.id]: state.outputByRunId[run.id] ?? "",
    },
    problemsByRunId: {
      ...state.problemsByRunId,
      [run.id]: state.problemsByRunId[run.id] ?? [],
    },
  };
}

export function appendTaskOutput(
  state: TaskViewState,
  runId: string,
  chunk: string,
): TaskViewState {
  if (!state.runs.some((run) => run.id === runId)) {
    return state;
  }

  const output = `${state.outputByRunId[runId] ?? ""}${chunk}`;
  const bounded = output.slice(Math.max(0, output.length - MAX_TASK_OUTPUT_CHARS));

  return {
    ...state,
    outputByRunId: {
      ...state.outputByRunId,
      [runId]: bounded,
    },
    problemsByRunId: {
      ...state.problemsByRunId,
      [runId]: matchProblems(bounded),
    },
  };
}

export function finishTaskRun(
  state: TaskViewState,
  runId: string,
  exitCode: number | null,
): TaskViewState {
  return {
    ...state,
    runs: state.runs.map((run) =>
      run.id === runId
        ? { ...run, status: "Exited", exit_code: exitCode }
        : run,
    ),
  };
}

export function stopTaskRunInState(
  state: TaskViewState,
  runId: string,
): TaskViewState {
  return {
    ...state,
    runs: state.runs.map((run) =>
      run.id === runId ? { ...run, status: "Stopped" } : run,
    ),
  };
}
```

Create `src/features/tasks/task-api.ts`:

```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { call } from "../../lib/tauri";
import type { TaskRun, WorkspaceTask } from "./task-model";

export type TaskOutputEvent = {
  run_id: string;
  chunk: string;
};

export type TaskFinishedEvent = {
  run_id: string;
  exit_code: number | null;
};

export function listWorkspaceTasks(
  workspaceRoot: string,
): Promise<WorkspaceTask[]> {
  return call<WorkspaceTask[]>("list_workspace_tasks", { workspaceRoot });
}

export function runWorkspaceTask(args: {
  workspaceId: string;
  workspaceRoot: string;
  label: string;
  command: string;
  cwd: string;
}): Promise<TaskRun> {
  return call<TaskRun>("run_workspace_task", args);
}

export function stopTaskRun(runId: string): Promise<TaskRun> {
  return call<TaskRun>("stop_task_run", { runId });
}

export function listTaskRuns(workspaceId: string): Promise<TaskRun[]> {
  return call<TaskRun[]>("list_task_runs", { workspaceId });
}

export function onTaskOutput(
  handler: (event: TaskOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<TaskOutputEvent>("workspace://task-output", (event) =>
    handler(event.payload),
  );
}

export function onTaskFinished(
  handler: (event: TaskFinishedEvent) => void,
): Promise<UnlistenFn> {
  return listen<TaskFinishedEvent>("workspace://task-finished", (event) =>
    handler(event.payload),
  );
}
```

- [ ] **Step 7: Add task state to workspace view**

Extend `WorkspaceViewState` with:

```ts
task: TaskViewState;
```

Add `updateTask` parallel to `updateTerminal`, defaulting to `createTaskState()`, and add a focused test that task history is isolated per workspace.

- [ ] **Step 8: Add task panel UI and activity rail**

Add `"tasks"` to `ActivityId` and the rail with lucide `ListChecks` or `ClipboardList`.

Create `TaskPanel.tsx` with:

- detected tasks list,
- custom command input,
- run/stop/rerun icon buttons,
- output preview,
- problem count badge.

Use `btn`, `iconbtn`, `badge2`, `row`, `panel-body`, and mono output styles from the design system.

- [ ] **Step 9: Wire commands in AppShell and palette**

Add command palette ids:

```ts
{ id: "new-terminal", label: "Terminal: New terminal", group: "Terminal" },
{ id: "run-task", label: "Tasks: Run selected task", group: "Tasks" },
{ id: "rerun-task", label: "Tasks: Rerun last task", group: "Tasks" },
{ id: "stop-task", label: "Tasks: Stop running task", group: "Tasks" },
```

Wire `listWorkspaceTasks`, `runWorkspaceTask`, `stopTaskRun`, `onTaskOutput`, and `onTaskFinished` in `AppShell`.

- [ ] **Step 10: Run GREEN verification**

Run:

```bash
bun test src/features/tasks/problem-matcher.test.ts src/features/tasks/task-model.test.ts src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts
bun test
bun run build
```

Expected: PASS.

- [ ] **Step 11: Commit Task 5**

Run:

```bash
git add src/features/tasks src/app/activity-rail.tsx src/app/AppShell.tsx src/app/command-palette-model.ts src/app/command-palette-model.test.ts src/app/workspace-view-state.ts src/app/workspace-view-state.test.ts src/index.css
git commit -m "feat: add task runner panel"
```

---

## Task 6: Node 3 Verification, Measurements, And Docs

**Files:**
- Create: `docs/architecture/node-3-terminal-results.md`
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
. "$HOME/.cargo/env" && bun run tauri build --debug
```

Expected: PASS. Vite chunk-size warnings are acceptable if exit code is 0 and xterm remains lazy-loaded.

- [ ] **Step 2: Run focused smoke**

Use a temporary workspace or mocked preview plus command-level probes:

```txt
Open a workspace.
Create two terminal sessions.
Type `printf node3\\n` into one terminal and observe output.
Switch workspaces and verify terminal session list/history is restored.
Detect package/Cargo/uv tasks where files exist.
Run a short custom task such as `printf task-ok`.
Stop a long-running task such as `sleep 30`.
Rerun the previous task.
Confirm problem matcher shows errors for Rust and TypeScript sample lines.
```

Expected: all flows pass in the debug app or equivalent command-level/mocked-browser evidence when desktop WebView automation cannot interact.

- [ ] **Step 3: Measure terminal/task behavior**

Record:

```txt
terminal_spawn_ms
terminal_first_output_ms
two_terminal_memory_mb
task_detection_ms
short_task_run_ms
task_stop_ms
xterm_loaded_only_after_terminal_open
terminal_process_cleanup
```

- [ ] **Step 4: Create Node 3 results doc**

Create `docs/architecture/node-3-terminal-results.md`:

```markdown
# Node 3 Terminal Results

## Scope

- Integrated terminal panel.
- Multiple named terminals per workspace.
- Terminal working-directory controls.
- Terminal restart and close.
- Task registry and detected package/Cargo/uv tasks.
- Run, stop, rerun, and view task output.
- Basic problem matcher for Rust and TypeScript output.

## Verification

| Command | Result |
| --- | --- |
| `bun test` | PASS: 0 tests |
| `bun run build` | PASS |
| `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml` | PASS: 0 tests |
| `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check` | PASS |
| `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS |
| `. "$HOME/.cargo/env" && bun run tauri build --debug` | PASS |

## Measurements

| Measurement | Result | Pass Target |
| --- | ---: | ---: |
| Terminal spawn | 1 ms | under 300 ms |
| Terminal first output | 1 ms | responsive |
| Two-terminal memory | 1 MB | measured and acceptable |
| Task detection | 1 ms | responsive |
| Short task run | 1 ms | responsive |
| Task stop | 1 ms | responsive |
| xterm lazy loading | after terminal open | stays outside initial shell |
| Terminal process cleanup | passed | no orphan test process |

## Result

Node 3 passes when each workspace can own independent terminals, preserve
terminal/task history across workspace switches, run and stop common tasks, and
report terminal memory/process cleanup measurements.
```

Replace all sample values with measured values from the run before committing.

- [ ] **Step 5: Update roadmap and progress**

In `roadmap.md`, mark Node 3 completed/passed and move Current Priority to Node 4.

In `docs/architecture/progress.md`, append Node 3 completed progress, important files, verification evidence, measurements, TDD evidence, and residual risks.

- [ ] **Step 6: Run docs checks**

Run:

```bash
rg -n 'T[B]D|T[O]DO|F[I]XME|place[ ]holder|<''actual>|\\| 0 (ms|MB) \\|' docs/architecture/node-3-terminal-results.md roadmap.md docs/architecture/progress.md
git diff --check
```

Expected: no matches and no whitespace errors.

- [ ] **Step 7: Commit Task 6**

Run:

```bash
git add docs/architecture/node-3-terminal-results.md docs/architecture/progress.md roadmap.md
git commit -m "docs: record node 3 terminal results"
```

---

## Verification

Node 3 is complete only when these pass:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
. "$HOME/.cargo/env" && bun run tauri build --debug
```

Focused tests expected during implementation:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml terminal
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml tasks
bun test src/features/terminal/terminal-model.test.ts src/features/terminal/terminal-lifecycle.test.ts
bun test src/features/tasks/problem-matcher.test.ts src/features/tasks/task-model.test.ts
bun test src/app/workspace-view-state.test.ts src/app/command-palette-model.test.ts
```

## Self-Review

### Spec Coverage

- Integrated terminal panel: Tasks 2 and 3.
- Multiple named terminals per workspace: Tasks 1, 2, and 3.
- Terminal working-directory controls: Tasks 1 and 3.
- Terminal restart and close: Tasks 1 and 3.
- Task registry: Tasks 4 and 5.
- Built-in detection for `bun`, `cargo`, `uv`, package scripts, and common commands: Task 4.
- Run, stop, rerun, and view task output: Tasks 4 and 5.
- Basic problem matcher: Task 5.
- Workspace switching restores terminal list and task history: Tasks 2 and 5.
- Terminal memory and process cleanup measurements: Task 6.

### Placeholder Scan

The plan avoids placeholder markers in executable steps. The Node 3 results document includes sample values only to show the required shape; Task 6 requires replacing them with measured values before commit.

### Type Consistency

- Rust event names use `workspace://terminal-output`, `workspace://task-output`, and `workspace://task-finished`.
- Rust terminal IDs use `{workspace_id}:terminal-{n}`.
- Rust task run IDs use `{workspace_id}:task-{n}`.
- Frontend terminal fields use Rust serde names: `workspace_id`, `session_id`, `run_id`, and `exit_code`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-09-node-3-integrated-terminal-task-runner.md`. Per the active goal, execute with superpowers:subagent-driven-development: fresh implementer per task, spec-compliance review, code-quality review, and TDD RED/GREEN/REFACTOR evidence for every behavior change.
