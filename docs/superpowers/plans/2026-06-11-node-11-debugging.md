# Node 11 Debugging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Node 11 so a workspace can run and attach debug sessions through a Debug Adapter Protocol client, manage launch configurations and breakpoints, inspect stack frames, variables, watches, and console output, and keep sessions scoped to their owning workspace.

**Architecture:** Rust owns debug adapter processes, DAP framing, request/response matching, workspace path validation, launch configuration persistence, session lifecycle, and bounded protocol logs. React owns the Debug rail tool, side panel, editor breakpoint affordances, command invocation, and bounded view state only. The frontend follows `docs/ui-design/app.jsx`, `docs/ui-design/panels.jsx`, `docs/ui-design/data.jsx`, and `docs/ui-design/ide.css`: dense rail/panel rows, icon controls, segmented modes, dark/yuzu-green tokens, and no explanatory landing surface.

**Tech Stack:** Existing Tauri 2, Rust 2021, serde/serde_json, std process/thread I/O, Vite, React 19.2.7, TypeScript 6.0.3, lucide-react 1.17.0, Monaco Editor 0.55.1, Bun test, Cargo test/fmt/clippy. No new npm or Cargo dependency is required for Tasks 1-5. Real adapter smoke uses existing Xcode `lldb-dap` and ephemeral latest `debugpy` via `uv run --with debugpy`.

---

## Source References

- Roadmap Node 11: `roadmap.md` lines 574-594.
- Stack boundary: `docs/architecture/tech-stack.md`.
- UI source of truth: `docs/ui-design/app.jsx`, `docs/ui-design/panels.jsx`, `docs/ui-design/data.jsx`, `docs/ui-design/ide.css`, `docs/ui-design/scratchpad.md`.
- DAP protocol reference: https://microsoft.github.io/debug-adapter-protocol/specification.html
- DAP overview: https://github.com/microsoft/debug-adapter-protocol/blob/main/overview.md
- LLVM `lldb-dap` reference: https://lldb.llvm.org/use/lldbdap.html

## Operating Contract

- All implementation and review subagents must run with `gpt-5.5` and `xhigh`.
- Do not use `gpt-5.4` for any Node 11 agent.
- Every behavior change must report RED, GREEN, and REFACTOR evidence.
- Implement tasks sequentially unless a later coordinator explicitly proves disjoint file ownership.
- Preserve unrelated dirty-tree changes, including current untracked `docs/html/` and `docs/superpowers/plans/2026-06-11-git-deep-dive.md`.
- Commit after each verified task or coherent milestone inside `/Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide`.

## File Structure

- Create `src-tauri/src/debug.rs`: launch config store, DAP framing, adapter profiles, session state, runtime seam, real-adapter smoke tests.
- Modify `src-tauri/src/lib.rs`: expose `debug` module during Task 1, then manage `debug::DebugState` and register commands during Task 2.
- Modify `src-tauri/src/commands.rs`: workspace-scoped `debug_*` command wrappers and command tests.
- Create `src/features/debug/debug-model.ts`: frontend debug state, reducers, bounded console/log behavior.
- Create `src/features/debug/debug-model.test.ts`: reducer and guard tests.
- Create `src/features/debug/debug-api.ts`: Tauri command wrappers and event listeners.
- Create `src/features/debug/DebugPanel.tsx`: Debug side panel.
- Create `src/features/debug/DebugPanel.test.tsx`: Debug panel behavior tests.
- Create `src/features/debug/DebugConsoleSurface.tsx`: bounded console surface for the editor region.
- Modify `src/features/editor/EditorTab.tsx`: breakpoint gutter props, decorations, and click handling.
- Modify `src/features/editor/EditorTab.test.ts`: breakpoint helper and Monaco option tests.
- Modify `src/app/activity-rail.tsx` and `src/app/activity-rail.test.tsx`: Debug rail entry.
- Modify `src/app/command-palette-model.ts` and `src/app/command-palette-model.test.ts`: Node 11 debug commands.
- Modify `src/app/workspace-view-state.ts` and `src/app/workspace-view-state.test.ts`: debug state and debug console surface.
- Modify `src/app/AppShell.tsx` and `src/app/AppShell.contract.test.tsx`: Debug panel, command dispatch, DAP event wiring, workspace scoping.
- Modify `src/index.css`: Debug panel, breakpoint gutter, stack, variable, watch, and console styles using existing tokens.
- Create `fixtures/debug/compiled-main.c` and `fixtures/debug/script-main.py`: real adapter smoke fixtures.
- Create `docs/architecture/node-11-debugging-results.md`: final evidence record.
- Modify `docs/architecture/progress.md` and `roadmap.md`: mark Node 11 complete after verification passes.

---

### Task 1: Rust Debug Domain, DAP Framing, And Launch Config Store

**Files:**
- Create: `src-tauri/src/debug.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/debug.rs`

- [ ] **Step 1: Write failing Rust tests**

Add `src-tauri/src/debug.rs` with tests first. The tests must reference the public API intended for the implementation:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dap_framing_decodes_split_messages_and_rejects_missing_length() {
        let value = serde_json::json!({
            "seq": 1,
            "type": "request",
            "command": "initialize",
            "arguments": { "clientID": "yuuzu-ide" }
        });
        let encoded = encode_dap_message(&value).expect("encode");
        assert!(std::str::from_utf8(&encoded).expect("utf8").starts_with("Content-Length: "));

        let split_at = encoded.len() - 3;
        let mut buffer = encoded[..split_at].to_vec();
        assert_eq!(decode_dap_message(&mut buffer).expect("partial"), None);
        buffer.extend_from_slice(&encoded[split_at..]);
        assert_eq!(decode_dap_message(&mut buffer).expect("complete"), Some(value));

        let mut bad = b"Content-Type: application/json\r\n\r\n{}".to_vec();
        assert!(decode_dap_message(&mut bad).expect_err("missing length").contains("Content-Length"));
    }

    #[test]
    fn save_launch_config_is_workspace_scoped_and_sorted() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = DebugLaunchConfigStore::new(temp.path().join("debug-launch.json"));
        let first = debug_config_input("/repo-a", "script", DebugAdapterKind::Python);
        let mut second = debug_config_input("/repo-a", "compiled", DebugAdapterKind::Lldb);
        second.id = Some("cfg-compiled".to_string());
        let other = debug_config_input("/repo-b", "other", DebugAdapterKind::Python);

        store.save_config(first, || Ok(10), || "cfg-script".to_string()).expect("script");
        store.save_config(other, || Ok(11), || "cfg-other".to_string()).expect("other");
        store.save_config(second, || Ok(12), || "cfg-fallback".to_string()).expect("compiled");

        let configs = store.list_configs("/repo-a").expect("list");
        assert_eq!(
            configs.iter().map(|config| config.name.as_str()).collect::<Vec<_>>(),
            vec!["compiled", "script"],
        );
    }

    #[test]
    fn normalize_debug_source_path_rejects_paths_outside_workspace() {
        let temp = tempfile::tempdir().expect("tempdir");
        let workspace = temp.path();
        std::fs::create_dir_all(workspace.join("src")).expect("src dir");
        std::fs::write(workspace.join("src/main.rs"), "fn main() {}\n").expect("source");
        let outside = tempfile::NamedTempFile::new().expect("outside");

        let inside = normalize_debug_source_path(workspace, "src/main.rs").expect("inside");
        assert_eq!(inside, "src/main.rs");

        assert!(normalize_debug_source_path(workspace, "../main.rs").expect_err("escape").contains("outside workspace"));
        assert!(normalize_debug_source_path(workspace, outside.path().to_string_lossy().as_ref()).expect_err("outside").contains("outside workspace"));
    }

    #[test]
    fn breakpoints_replace_per_source_without_cross_workspace_leakage() {
        let state = DebugState::new_for_tests();
        let workspace_a = "/repo-a";
        let workspace_b = "/repo-b";

        let a = state
            .set_breakpoints(
                "workspace-a".to_string(),
                workspace_a.to_string(),
                "src/main.rs".to_string(),
                vec![DebugSourceBreakpointInput { line: 12, condition: None, log_message: None }],
            )
            .expect("set a");
        let b = state
            .set_breakpoints(
                "workspace-b".to_string(),
                workspace_b.to_string(),
                "src/main.rs".to_string(),
                vec![DebugSourceBreakpointInput { line: 3, condition: Some("x > 1".to_string()), log_message: None }],
            )
            .expect("set b");

        assert_eq!(a[0].line, 12);
        assert_eq!(b[0].line, 3);
        assert_eq!(state.breakpoints_for("workspace-a", workspace_a, "src/main.rs").len(), 1);
        assert_eq!(state.breakpoints_for("workspace-b", workspace_b, "src/main.rs").len(), 1);
    }

    fn debug_config_input(
        workspace_root: &str,
        name: &str,
        adapter: DebugAdapterKind,
    ) -> DebugLaunchConfigInput {
        DebugLaunchConfigInput {
            id: None,
            workspace_root: workspace_root.to_string(),
            name: name.to_string(),
            adapter,
            request: DebugRequestKind::Launch,
            program: "src/main.py".to_string(),
            cwd: ".".to_string(),
            args: vec!["--port".to_string(), "3000".to_string()],
            env: vec![DebugEnvVar { key: "RUST_LOG".to_string(), value: "debug".to_string() }],
            stop_on_entry: true,
            attach: None,
        }
    }
}
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml debug::tests
```

Expected: FAIL because `debug` module and debug types/functions are not defined.

- [ ] **Step 3: Implement the debug domain**

Implement in `src-tauri/src/debug.rs`:

```rust
pub const DEBUG_LOG_LIMIT: usize = 120_000;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum DebugAdapterKind {
    Lldb,
    Python,
    Custom,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum DebugRequestKind {
    Launch,
    Attach,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DebugLaunchConfigInput {
    pub id: Option<String>,
    pub workspace_root: String,
    pub name: String,
    pub adapter: DebugAdapterKind,
    pub request: DebugRequestKind,
    pub program: String,
    pub cwd: String,
    pub args: Vec<String>,
    pub env: Vec<DebugEnvVar>,
    pub stop_on_entry: bool,
    pub attach: Option<DebugAttachConfig>,
}
```

Also implement `DebugLaunchConfig`, `DebugEnvVar`, `DebugAttachConfig`, `DebugLaunchConfigStore`, `DebugState`, `DebugSourceBreakpointInput`, `DebugSourceBreakpoint`, `encode_dap_message`, `decode_dap_message`, `normalize_debug_source_path`, `debug_now_ms`, and `new_debug_config_id`. Store JSON on disk like the database and remote stores, sort configs by name, and keep breakpoints in memory by `(workspace_id, workspace_root, source_path)`.

Add this module declaration to `src-tauri/src/lib.rs` so `cargo test debug::tests` compiles the new module:

```rust
pub mod debug;
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml debug::tests
```

Expected: PASS for the new domain tests.

- [ ] **Step 5: Refactor and verify formatting**

Run:

```bash
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/debug.rs src-tauri/src/lib.rs
git commit -m "feat: add debug launch config domain"
```

---

### Task 2: Rust DAP Runtime And Tauri Commands

**Files:**
- Modify: `src-tauri/src/debug.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/debug.rs`
- Test: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write failing runtime and command tests**

Add runtime tests in `src-tauri/src/debug.rs`:

```rust
#[cfg(test)]
mod runtime_tests {
    use super::*;

    #[test]
    fn scripted_adapter_launch_sets_breakpoints_and_records_stopped_stack_variables() {
        let state = DebugState::new_for_tests();
        state.install_test_adapter(DebugAdapterKind::Python, ScriptedDebugAdapter::python_stopped_at_line(8));

        let session = state
            .start_session(DebugStartSessionRequest {
                workspace_id: "workspace-a".to_string(),
                workspace_root: "/repo".to_string(),
                config: DebugLaunchConfig {
                    id: "cfg-script".to_string(),
                    workspace_root: "/repo".to_string(),
                    name: "Python file".to_string(),
                    adapter: DebugAdapterKind::Python,
                    request: DebugRequestKind::Launch,
                    program: "app.py".to_string(),
                    cwd: ".".to_string(),
                    args: Vec::new(),
                    env: Vec::new(),
                    stop_on_entry: true,
                    attach: None,
                    created_ms: 1,
                    updated_ms: 1,
                },
            })
            .expect("start");

        assert_eq!(session.workspace_id, "workspace-a");
        assert_eq!(session.status, DebugSessionStatus::Stopped);

        let breakpoints = state
            .set_session_breakpoints(&session.id, "app.py".to_string(), vec![DebugSourceBreakpointInput {
                line: 8,
                condition: None,
                log_message: None,
            }])
            .expect("breakpoints");
        assert_eq!(breakpoints[0].verified, true);

        let stack = state.stack_trace(&session.id, 1).expect("stack");
        assert_eq!(stack[0].name, "main");
        let scopes = state.scopes(&session.id, stack[0].id).expect("scopes");
        let variables = state.variables(&session.id, scopes[0].variables_reference).expect("variables");
        assert_eq!(variables[0].name, "counter");
        assert_eq!(variables[0].value, "8");
    }

    #[test]
    fn late_events_for_disconnected_session_are_logged_but_do_not_reactivate_session() {
        let state = DebugState::new_for_tests();
        state.install_test_adapter(DebugAdapterKind::Python, ScriptedDebugAdapter::python_stopped_at_line(8));
        let session = state.start_test_python_session("workspace-a", "/repo").expect("start");

        state.disconnect_session(&session.id).expect("disconnect");
        state.handle_debug_event(DebugAdapterEvent {
            session_id: session.id.clone(),
            event: "stopped".to_string(),
            body: serde_json::json!({ "reason": "breakpoint", "threadId": 1 }),
        }).expect("late event");

        let sessions = state.list_sessions("workspace-a");
        assert_eq!(sessions[0].status, DebugSessionStatus::Disconnected);
        assert!(state.session_logs("workspace-a").join("\n").contains("ignored late event"));
    }
}
```

Add command tests in `src-tauri/src/commands.rs`:

```rust
#[test]
fn debug_start_session_rejects_mismatched_workspace_identity() {
    let (state, workspace_a, workspace_b) = app_state_with_two_workspaces();
    let debug_state = crate::debug::DebugState::new_for_tests();
    let config = crate::debug::DebugLaunchConfigInput {
        id: Some("cfg".to_string()),
        workspace_root: workspace_a.path().to_string_lossy().to_string(),
        name: "Python".to_string(),
        adapter: crate::debug::DebugAdapterKind::Python,
        request: crate::debug::DebugRequestKind::Launch,
        program: "app.py".to_string(),
        cwd: ".".to_string(),
        args: Vec::new(),
        env: Vec::new(),
        stop_on_entry: true,
        attach: None,
    };
    state.save_debug_launch_config(config).expect("save config");

    let result = state.debug_start_session(
        &debug_state,
        workspace_b.path().to_string_lossy().as_ref(),
        "workspace-a",
        "cfg",
    );

    assert!(result.expect_err("mismatch").contains("workspace id does not match workspace root"));
}
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml debug::runtime_tests
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml commands::tests::debug_start_session_rejects_mismatched_workspace_identity
```

Expected: FAIL because runtime and commands are not implemented.

- [ ] **Step 3: Implement runtime and commands**

Implement these Rust command-facing APIs:

```rust
pub struct DebugStartSessionRequest {
    pub workspace_id: String,
    pub workspace_root: String,
    pub config: DebugLaunchConfig,
}

pub enum DebugSessionStatus {
    Starting,
    Running,
    Stopped,
    Exited,
    Disconnected,
    Failed,
}

pub struct DebugSessionInfo {
    pub id: String,
    pub workspace_id: String,
    pub workspace_root: String,
    pub config_id: String,
    pub name: String,
    pub adapter: DebugAdapterKind,
    pub status: DebugSessionStatus,
    pub active_thread_id: Option<i64>,
    pub stopped_reason: Option<String>,
    pub last_error: Option<String>,
}
```

Register commands:

- `debug_list_launch_configs`
- `debug_save_launch_config`
- `debug_delete_launch_config`
- `debug_list_sessions`
- `debug_start_session`
- `debug_set_breakpoints`
- `debug_set_session_breakpoints`
- `debug_continue`
- `debug_step_over`
- `debug_pause`
- `debug_disconnect`
- `debug_stack_trace`
- `debug_scopes`
- `debug_variables`
- `debug_evaluate`
- `debug_session_logs`

Use `AppState::trusted_workspace_root`, `workspace_identity`, and `ensure_workspace_id_matches_root_path` for every command that receives `workspace_root` and `workspace_id`. Do not trust a frontend-provided `workspace_id` without matching it to the registered canonical root.

Emit frontend events through a testable sink:

- `workspace://debug-session`
- `workspace://debug-console`
- `workspace://debug-stopped`
- `workspace://debug-exited`

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml debug::runtime_tests
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml commands::tests::debug_
```

Expected: PASS for debug runtime tests and debug command tests.

- [ ] **Step 5: Refactor and verify lint**

Run:

```bash
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/debug.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add debug adapter runtime"
```

---

### Task 3: Frontend Debug Model And API

**Files:**
- Create: `src/features/debug/debug-model.ts`
- Create: `src/features/debug/debug-model.test.ts`
- Create: `src/features/debug/debug-api.ts`

- [ ] **Step 1: Write failing model tests**

Create `src/features/debug/debug-model.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  appendDebugConsole,
  createDebugState,
  markDebugSessionEvent,
  replaceDebugLaunchConfigs,
  setDebugBreakpoints,
  setDebugStack,
  storeDebugVariables,
  toggleDebugBreakpoint,
} from "./debug-model";

describe("debug model", () => {
  test("stores launch configs and selects the first config", () => {
    const state = replaceDebugLaunchConfigs(createDebugState(), [
      { id: "cfg-python", workspace_root: "/repo", name: "Python", adapter: "Python", request: "Launch", program: "app.py", cwd: ".", args: [], env: [], stop_on_entry: true, attach: null, created_ms: 1, updated_ms: 1 },
    ]);

    expect(state.activeConfigId).toBe("cfg-python");
  });

  test("toggles breakpoints per source path", () => {
    const withFirst = toggleDebugBreakpoint(createDebugState(), "src/main.rs", 7);
    const withSecond = toggleDebugBreakpoint(withFirst, "src/main.rs", 11);
    const removedFirst = toggleDebugBreakpoint(withSecond, "src/main.rs", 7);

    expect(removedFirst.breakpointsByPath["src/main.rs"].map((bp) => bp.line)).toEqual([11]);
  });

  test("buffers console output and keeps it bounded", () => {
    const large = "x".repeat(130_000);
    const state = appendDebugConsole(createDebugState(), "session-1", large);

    expect(state.consoleBySessionId["session-1"].length).toBe(120_000);
  });

  test("late events for ignored sessions do not reactivate the session", () => {
    const state = markDebugSessionEvent(
      {
        ...createDebugState(),
        ignoredSessionIds: { "session-1": true },
      },
      { session_id: "session-1", status: "Stopped", reason: "breakpoint" },
    );

    expect(state.sessions).toEqual([]);
  });

  test("stores stack frames and variables by active session", () => {
    const state = storeDebugVariables(
      setDebugStack(createDebugState(), "session-1", [
        { id: 1, name: "main", source_path: "src/main.rs", line: 8, column: 1 },
      ]),
      "session-1",
      100,
      [{ name: "counter", value: "8", type: "i32", variables_reference: 0 }],
    );

    expect(state.stackBySessionId["session-1"][0].name).toBe("main");
    expect(state.variablesByReference["session-1:100"][0].value).toBe("8");
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
bun test src/features/debug/debug-model.test.ts
```

Expected: FAIL because debug model files do not exist.

- [ ] **Step 3: Implement model and API**

Implement `src/features/debug/debug-model.ts` with these exported items:

```ts
export const MAX_DEBUG_CONSOLE = 120_000;

export type DebugAdapterKind = "Lldb" | "Python" | "Custom" | string;
export type DebugRequestKind = "Launch" | "Attach" | string;
export type DebugSessionStatus = "Starting" | "Running" | "Stopped" | "Exited" | "Disconnected" | "Failed" | string;

export type DebugViewState = {
  launchConfigs: DebugLaunchConfig[];
  activeConfigId: string | null;
  sessions: DebugSessionInfo[];
  activeSessionId: string | null;
  mode: "sessions" | "breakpoints" | "variables" | "console";
  breakpointsByPath: Record<string, DebugSourceBreakpoint[]>;
  stackBySessionId: Record<string, DebugStackFrame[]>;
  variablesByReference: Record<string, DebugVariable[]>;
  watches: DebugWatchExpression[];
  consoleBySessionId: Record<string, string>;
  ignoredSessionIds: Record<string, true>;
  loading: boolean;
  error: string | null;
};
```

Implement `src/features/debug/debug-api.ts` with Tauri wrappers for every `debug_*` command and listeners for the four `workspace://debug-*` events.

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
bun test src/features/debug/debug-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Refactor and verify build**

Run:

```bash
bun run build
```

Expected: PASS with only existing Vite chunk-size warnings.

- [ ] **Step 6: Commit**

```bash
git add src/features/debug/debug-model.ts src/features/debug/debug-model.test.ts src/features/debug/debug-api.ts
git commit -m "feat: add debug frontend model"
```

---

### Task 4: Debug Panel, Console Surface, And Editor Breakpoints

**Files:**
- Create: `src/features/debug/DebugPanel.tsx`
- Create: `src/features/debug/DebugPanel.test.tsx`
- Create: `src/features/debug/DebugConsoleSurface.tsx`
- Modify: `src/features/editor/EditorTab.tsx`
- Modify: `src/features/editor/EditorTab.test.ts`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing UI and editor tests**

Create `src/features/debug/DebugPanel.test.tsx`:

```tsx
/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { ensureTestDom } from "../../app/test-dom";
import { createDebugState, replaceDebugLaunchConfigs } from "./debug-model";

ensureTestDom();
const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { DebugPanel } = await import("./DebugPanel");

afterEach(() => cleanup());

describe("DebugPanel", () => {
  test("renders launch configs, run controls, stack, variables, watches, and console", () => {
    const onStartSession = mock(() => {});
    const state = {
      ...replaceDebugLaunchConfigs(createDebugState(), [
        { id: "cfg-python", workspace_root: "/repo", name: "Python file", adapter: "Python", request: "Launch", program: "app.py", cwd: ".", args: [], env: [], stop_on_entry: true, attach: null, created_ms: 1, updated_ms: 1 },
      ]),
      sessions: [{ id: "session-1", workspace_id: "workspace", workspace_root: "/repo", config_id: "cfg-python", name: "Python file", adapter: "Python", status: "Stopped", active_thread_id: 1, stopped_reason: "breakpoint", last_error: null }],
      activeSessionId: "session-1",
      stackBySessionId: { "session-1": [{ id: 1, name: "main", source_path: "app.py", line: 8, column: 1 }] },
      variablesByReference: { "session-1:100": [{ name: "counter", value: "8", type: "int", variables_reference: 0 }] },
      watches: [{ id: "watch-1", expression: "counter", value: "8", error: null }],
      consoleBySessionId: { "session-1": "stopped at breakpoint" },
    };

    const result = render(
      <DebugPanel
        state={state}
        onModeChange={() => {}}
        onSelectConfig={() => {}}
        onStartSession={onStartSession}
        onContinue={() => {}}
        onStepOver={() => {}}
        onPause={() => {}}
        onDisconnect={() => {}}
        onOpenFrame={() => {}}
        onAddWatch={() => {}}
        onRemoveWatch={() => {}}
        onEvaluate={() => {}}
      />,
    );

    expect(result.getByText("Python file")).toBeTruthy();
    expect(result.getByText("main")).toBeTruthy();
    expect(result.getByText("counter")).toBeTruthy();
    expect(result.getByText("stopped at breakpoint")).toBeTruthy();
    fireEvent.click(result.getByLabelText("Start debug session"));
    expect(onStartSession).toHaveBeenCalled();
  });
});
```

Add editor breakpoint tests to `src/features/editor/EditorTab.test.ts`:

```ts
describe("debug breakpoint helpers", () => {
  test("maps breakpoint lines to Monaco glyph decorations", () => {
    const decorations = debugBreakpointDecorations([
      { line: 7, verified: true },
      { line: 12, verified: false },
    ]);

    expect(decorations.map((item) => item.options.glyphMarginClassName)).toEqual([
      "debug-breakpoint verified",
      "debug-breakpoint pending",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/features/debug/DebugPanel.test.tsx src/features/editor/EditorTab.test.ts
```

Expected: FAIL because Debug UI and editor breakpoint helpers are not implemented.

- [ ] **Step 3: Implement UI and editor breakpoint affordances**

Implement `DebugPanel` as a compact tool panel with:

- panel head title `Debug`
- icon buttons for start, continue, step over, pause, disconnect
- segmented modes: Sessions, Breakpoints, Variables, Console
- launch config rows
- session rows with status badges
- call stack rows
- variables and watch rows
- console preview with bounded text

Implement `DebugConsoleSurface` as a main workbench surface using the existing `term-tabs` and `terminal-shell` visual language.

Update `EditorTab.tsx`:

- Add props `debugBreakpoints`, `activeDebugLine`, `onToggleBreakpoint`.
- Enable Monaco `glyphMargin: true`.
- Export `debugBreakpointDecorations`.
- Add gutter click handler that calls `onToggleBreakpoint(lineNumber)` only when Monaco reports a glyph margin target.

Add CSS to `src/index.css` using existing tokens:

```css
.debug-breakpoint {
  width: 10px;
  height: 10px;
  margin-left: 4px;
  border-radius: 50%;
  background: var(--yuzu);
}

.debug-breakpoint.pending {
  background: transparent;
  border: 1px solid var(--yuzu);
}

.debug-active-line {
  background: color-mix(in srgb, var(--yuzu) 9%, transparent);
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
bun test src/features/debug/DebugPanel.test.tsx src/features/editor/EditorTab.test.ts
```

Expected: PASS.

- [ ] **Step 5: Refactor and verify build**

Run:

```bash
bun run build
```

Expected: PASS with only existing Vite chunk-size warnings.

- [ ] **Step 6: Commit**

```bash
git add src/features/debug/DebugPanel.tsx src/features/debug/DebugPanel.test.tsx src/features/debug/DebugConsoleSurface.tsx src/features/editor/EditorTab.tsx src/features/editor/EditorTab.test.ts src/index.css
git commit -m "feat: add debug panel and breakpoints"
```

---

### Task 5: AppShell Debug Integration

**Files:**
- Modify: `src/app/activity-rail.tsx`
- Modify: `src/app/activity-rail.test.tsx`
- Modify: `src/app/command-palette-model.ts`
- Modify: `src/app/command-palette-model.test.ts`
- Modify: `src/app/workspace-view-state.ts`
- Modify: `src/app/workspace-view-state.test.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.contract.test.tsx`

- [ ] **Step 1: Write failing AppShell integration tests**

Add tests covering:

```ts
test("renders debug activity and command palette commands", () => {
  expect(allCommands.some((command) => command.id === "open-debug")).toBe(true);
  expect(filterCommands(allCommands, "debug").map((command) => command.id)).toContain("debug-start-session");
});

test("workspace view stores debug state independently", () => {
  const store = createWorkspaceViewStore();
  store.getState().updateDebug("workspace-a", (debug) => ({
    ...debug,
    activeSessionId: "session-a",
  }));

  expect(store.getState().viewFor("workspace-a").debug.activeSessionId).toBe("session-a");
  expect(store.getState().viewFor("workspace-b").debug.activeSessionId).toBeNull();
});
```

Add AppShell contract expectations for:

- selecting Debug opens the Debug panel
- command palette `open-debug` switches the active activity to Debug
- `debug-start-session` invokes `debug_start_session` with active workspace root and id
- `workspace://debug-console` event appends console output only to the matching active session
- debug console surface appears when a debug session is active

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx
```

Expected: FAIL because Debug is not wired into AppShell.

- [ ] **Step 3: Implement integration**

Make these concrete changes:

- Add `debug` to `KnownActivityId` and `activities` using lucide `BugPlay` or `Bug`.
- Add `node11Commands` with:
  - `open-debug`
  - `debug-start-session`
  - `debug-continue`
  - `debug-step-over`
  - `debug-pause`
  - `debug-disconnect`
  - `debug-toggle-breakpoint`
- Add `debug-console` to `Surface`.
- Add `debug: DebugViewState` and `updateDebug` to `WorkspaceViewState`.
- Freeze debug arrays/maps in `freezeWorkspaceView`.
- Import and render `DebugPanel` and `DebugConsoleSurface` in `AppShell`.
- Subscribe to `listenDebugSession`, `listenDebugConsole`, `listenDebugStopped`, and `listenDebugExited`.
- Thread `debugBreakpoints`, `activeDebugLine`, and `onToggleBreakpoint` into `EditorTab`.
- Keep console output bounded and do not store complete adapter logs in global React state.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
bun test src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Refactor and verify focused frontend**

Run:

```bash
bun test src/features/debug/debug-model.test.ts src/features/debug/DebugPanel.test.tsx src/features/editor/EditorTab.test.ts src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx
bun run build
```

Expected: PASS with only existing Vite chunk-size warnings.

- [ ] **Step 6: Commit**

```bash
git add src/app/activity-rail.tsx src/app/activity-rail.test.tsx src/app/command-palette-model.ts src/app/command-palette-model.test.ts src/app/workspace-view-state.ts src/app/workspace-view-state.test.ts src/app/AppShell.tsx src/app/AppShell.contract.test.tsx
git commit -m "feat: integrate debug workbench"
```

---

### Task 6: Real Adapter Smoke And Hardening

**Files:**
- Modify: `src-tauri/src/debug.rs`
- Create: `fixtures/debug/compiled-main.c`
- Create: `fixtures/debug/script-main.py`
- Test: `src-tauri/src/debug.rs`

- [ ] **Step 1: Write ignored real-adapter smoke tests**

Add ignored tests to `src-tauri/src/debug.rs` that are gated by `YUZZU_DEBUG_SMOKE=1` and run only when explicitly requested:

```rust
#[cfg(test)]
mod adapter_smoke_tests {
    use super::*;

    #[test]
    #[ignore]
    fn lldb_dap_debugs_compiled_c_fixture_to_breakpoint() {
        require_debug_smoke();
        let lldb_dap = find_lldb_dap().expect("lldb-dap");
        let binary = compile_c_fixture("fixtures/debug/compiled-main.c").expect("compile fixture");
        let result = run_real_dap_smoke(
            DebugAdapterKind::Lldb,
            lldb_dap,
            RealDapSmokeProgram {
                program: binary,
                source_path: "fixtures/debug/compiled-main.c".to_string(),
                breakpoint_line: 6,
                expected_variable: ("counter".to_string(), "3".to_string()),
            },
        ).expect("lldb smoke");

        assert_eq!(result.stopped_reason.as_deref(), Some("breakpoint"));
        assert!(result.stack.iter().any(|frame| frame.name.contains("main")));
    }

    #[test]
    #[ignore]
    fn debugpy_debugs_python_fixture_to_breakpoint() {
        require_debug_smoke();
        let result = run_real_dap_smoke(
            DebugAdapterKind::Python,
            "uv".to_string(),
            RealDapSmokeProgram {
                program: "fixtures/debug/script-main.py".to_string(),
                source_path: "fixtures/debug/script-main.py".to_string(),
                breakpoint_line: 5,
                expected_variable: ("counter".to_string(), "3".to_string()),
            },
        ).expect("debugpy smoke");

        assert_eq!(result.stopped_reason.as_deref(), Some("breakpoint"));
        assert!(result.stack.iter().any(|frame| frame.name.contains("main")));
    }
}
```

Create fixtures:

```c
// fixtures/debug/compiled-main.c
#include <stdio.h>

int main(void) {
  int counter = 1;
  counter += 2;
  printf("%d\n", counter);
  return counter == 3 ? 0 : 1;
}
```

```python
# fixtures/debug/script-main.py
def main():
    counter = 1
    counter += 2
    print(counter)

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && YUZZU_DEBUG_SMOKE=1 cargo test --manifest-path src-tauri/Cargo.toml debug::adapter_smoke_tests -- --ignored --test-threads=1
```

Expected: FAIL because real adapter helpers are not implemented.

- [ ] **Step 3: Implement real adapter smoke helpers**

Implement:

- `find_lldb_dap()` using `xcrun --find lldb-dap`, with an error that names the missing tool.
- `compile_c_fixture()` using `xcrun clang -g -O0`.
- `run_real_dap_smoke()` through the same DAP client used by app sessions.
- Python adapter command as `uv run --with debugpy python -m debugpy.adapter`, so the scripting smoke uses latest `debugpy` without adding project dependencies.
- Adapter-specific launch arguments:
  - LLDB: `program`, `cwd`, `stopOnEntry`, `args`.
  - debugpy: `program`, `cwd`, `stopOnEntry`, `console`.

- [ ] **Step 4: Run smoke to verify GREEN**

Run:

```bash
. "$HOME/.cargo/env" && YUZZU_DEBUG_SMOKE=1 cargo test --manifest-path src-tauri/Cargo.toml debug::adapter_smoke_tests -- --ignored --test-threads=1
```

Expected: PASS for both compiled and scripting fixtures.

- [ ] **Step 5: Refactor and run focused Node 11 verification**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml debug::
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml commands::tests::debug_
bun test src/features/debug/debug-model.test.ts src/features/debug/DebugPanel.test.tsx src/features/editor/EditorTab.test.ts src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx
bun run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/debug.rs fixtures/debug/compiled-main.c fixtures/debug/script-main.py
git commit -m "test: verify real debug adapters"
```

---

### Task 7: Final Verification, Results, Progress, And Roadmap

**Files:**
- Create: `docs/architecture/node-11-debugging-results.md`
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
. "$HOME/.cargo/env" && YUZZU_DEBUG_SMOKE=1 cargo test --manifest-path src-tauri/Cargo.toml debug::adapter_smoke_tests -- --ignored --test-threads=1
```

Expected: all commands PASS. Record exact pass counts and artifact paths.

- [ ] **Step 2: Create Node 11 result record**

Create `docs/architecture/node-11-debugging-results.md` with:

- status
- scope delivered
- TDD evidence by task
- agent review evidence
- full verification evidence
- real adapter smoke evidence for `lldb-dap` and `debugpy`
- acceptance results
- residual risks

- [ ] **Step 3: Update progress and roadmap**

Update `docs/architecture/progress.md` with a `### Node 11: Debugging` section and update `roadmap.md`:

- Add Node 11 status line pointing to `docs/architecture/node-11-debugging-results.md`.
- Change Current Priority so Node 0 through Node 11 are complete and Node 12 is next.
- Add a Node 11 verification bullet.

- [ ] **Step 4: Run docs and diff checks**

Run:

```bash
rg -n "T(BD)|TO(DO)|place(holder)|0 tests|0 pass|skip[ -]verification" docs/architecture/node-11-debugging-results.md docs/architecture/progress.md roadmap.md
git diff --check
git status --short
```

Expected: marker scan returns no matches, diff check passes, and only intended Node 11 files are modified.

- [ ] **Step 5: Commit docs**

```bash
git add docs/architecture/node-11-debugging-results.md docs/architecture/progress.md roadmap.md
git commit -m "docs: record node 11 debugging results"
```

---

## Plan Self-Review

- Spec coverage: DAP client, launch configs, breakpoints, call stack, variables, watches, debug console, attach-capable config shape, compiled-language smoke, scripting-language smoke, and workspace-scoped sessions are each mapped to a task.
- UI coverage: Debug is a rail tool with dense side-panel rows and a console workbench surface, matching the source UI design.
- Type consistency: Rust and TypeScript both use `DebugLaunchConfig`, `DebugSessionInfo`, `DebugSourceBreakpoint`, `DebugStackFrame`, `DebugScope`, `DebugVariable`, and `DebugSessionStatus` names.
- Verification coverage: focused Rust, focused frontend, full suite, Tauri debug build, and real adapter smoke are all required before Node 11 is marked complete.
