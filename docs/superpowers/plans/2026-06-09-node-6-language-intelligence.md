# Node 6 Language Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add baseline LSP-backed language intelligence for Rust, TypeScript,
JavaScript, and Python while keeping language servers lazy and visible in the
workbench.

**Architecture:** Rust owns language server profiles, process lifecycle,
JSON-RPC transport, diagnostics cache, server logs, restart behavior, and memory
measurements. React owns the Language activity panel, status bar summaries,
Monaco marker/provider wiring, and compact UI state. LSP servers are started
only when an active or recently active workspace opens a supported file.

**Tech Stack:** Tauri 2, Rust 2021, `lsp-types` 0.97.0, `serde_json`, React 19,
Monaco, Bun tests, Cargo tests, lucide-react icons, and `docs/ui-design/`
workbench panel patterns.

**Subagent contract:** Development subagents must use `gpt-5.3-codex-spark`
with `xhigh` reasoning. Spec-compliance and code-quality review subagents must
use `gpt-5.5` with `xhigh` reasoning. Do not use `gpt-5.4`.

---

## Source Context

- `roadmap.md` Node 6: LSP client, lazy startup, diagnostics, hover, go to
  definition, references, rename, completion, code actions, symbols, logs, and
  restart.
- `docs/architecture/tech-stack.md`: Rust owns LSP process lifecycle and
  diagnostics cache; React must not own the full diagnostics cache.
- `docs/ui-design/app.jsx`: left rail and compact workbench shell patterns.
- `docs/ui-design/panels.jsx`: panel header, panel body, compact rows, action
  icons, and dense operational layout.
- `docs/ui-design/scenes.jsx`: `dbgrid` table pattern for dense lists.
- `docs/ui-design/ide.css`: `.panel`, `.panel-head`, `.panel-body`, `.row`,
  `.badge2`, `.dbgrid`, `.statusbar`, `.btn`, and `.input2` tokens.

## File Structure

- Create `src-tauri/src/lsp.rs`: LSP language profiles, JSON-RPC codec, process
  manager, diagnostics cache, request helpers, server status, logs, restart, and
  Rust tests.
- Modify `src-tauri/Cargo.toml`: add `lsp-types = "0.97.0"`.
- Modify `src-tauri/src/commands.rs`: app state field for LSP state plus Tauri
  command wrappers.
- Modify `src-tauri/src/lib.rs`: register `lsp` module, manage LSP state, and
  register LSP commands.
- Create `src/features/language/language-api.ts`: typed frontend wrappers for
  LSP commands.
- Create `src/features/language/language-model.ts`: pure frontend state for
  diagnostics, server status, hover, symbols, completions, code actions, logs,
  and memory summaries.
- Create `src/features/language/language-model.test.ts`: Bun tests for pure
  language state.
- Create `src/features/language/LanguagePanel.tsx`: Diagnostics and language
  server panel.
- Create `src/features/language/LanguagePanel.test.tsx`: focused UI tests for
  restart and diagnostic row rendering.
- Modify `src/app/activity-rail.tsx`: add Language activity item.
- Modify `src/app/workspace-view-state.ts`: add per-workspace language view
  state and freeze defaults.
- Modify `src/app/AppShell.tsx`: wire LSP command calls, active file open/save
  notifications, diagnostics panel, Monaco provider callbacks, and status bar
  counts.
- Modify `src/features/editor/EditorTab.tsx`: set Monaco markers and register
  hover, definition, references, completion, code action, and rename hooks.
- Modify `src/app/command-palette-model.ts`: add language commands.
- Modify `src/index.css`: add compact Language panel, diagnostics table, server
  status rows, logs, hover popover, and responsive rules.
- Create `docs/architecture/node-6-language-results.md`: verification,
  measurements, TDD/review evidence, and residual risks.
- Modify `docs/architecture/progress.md`: append Node 6 status.
- Modify `roadmap.md`: mark Node 6 complete and move current priority to Node 7.

## Command Contract

The Rust command surface for Node 6 is:

```text
lsp_server_status
lsp_open_document
lsp_close_document
lsp_document_diagnostics
lsp_workspace_diagnostics
lsp_hover
lsp_definition
lsp_references
lsp_completion
lsp_code_actions
lsp_symbols
lsp_rename
lsp_restart_server
lsp_server_logs
```

All commands accept trusted workspace roots or workspace IDs already registered
in the app state. File paths are workspace-relative strings.

## Task 1: Rust LSP Profiles And JSON-RPC Codec

**Files:**
- Create: `src-tauri/src/lsp.rs`
- Modify: `src-tauri/Cargo.toml`
- Test: `src-tauri/src/lsp.rs`

- [ ] **Step 1: Add latest LSP protocol dependency**

Run:

```bash
. "$HOME/.cargo/env" && cargo add lsp-types@0.97.0 --manifest-path src-tauri/Cargo.toml
```

Expected: `src-tauri/Cargo.toml` contains `lsp-types = "0.97.0"` and
`Cargo.lock` updates cleanly.

- [ ] **Step 2: Write failing tests for language profiles**

Create `src-tauri/src/lsp.rs` with these tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_supported_languages_from_workspace_paths() {
        assert_eq!(detect_language("src/main.rs"), Some(LanguageId::Rust));
        assert_eq!(detect_language("src/app.ts"), Some(LanguageId::TypeScript));
        assert_eq!(detect_language("src/app.tsx"), Some(LanguageId::TypeScript));
        assert_eq!(detect_language("src/app.js"), Some(LanguageId::JavaScript));
        assert_eq!(detect_language("scripts/build.py"), Some(LanguageId::Python));
        assert_eq!(detect_language("README.md"), None);
    }

    #[test]
    fn profiles_use_expected_language_server_commands() {
        assert_eq!(server_profile(LanguageId::Rust).command, "rust-analyzer");
        assert_eq!(
            server_profile(LanguageId::TypeScript).command,
            "typescript-language-server"
        );
        assert_eq!(
            server_profile(LanguageId::JavaScript).command,
            "typescript-language-server"
        );
        assert_eq!(server_profile(LanguageId::Python).command, "pylsp");
        assert_eq!(
            server_profile(LanguageId::TypeScript).args,
            vec!["--stdio".to_string()]
        );
    }
}
```

- [ ] **Step 3: Run profile tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml lsp::tests::detects_supported_languages_from_workspace_paths -- --exact
```

Expected: FAIL because `src-tauri/src/lsp.rs`, `LanguageId`,
`detect_language`, and `server_profile` are not implemented yet.

- [ ] **Step 4: Implement language profiles**

Add these definitions to `src-tauri/src/lsp.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub enum LanguageId {
    Rust,
    TypeScript,
    JavaScript,
    Python,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LanguageServerProfile {
    pub language: LanguageId,
    pub display_name: String,
    pub command: String,
    pub args: Vec<String>,
}

pub fn detect_language(path: &str) -> Option<LanguageId> {
    let extension = path.rsplit('.').next()?;
    match extension {
        "rs" => Some(LanguageId::Rust),
        "ts" | "tsx" => Some(LanguageId::TypeScript),
        "js" | "jsx" | "mjs" | "cjs" => Some(LanguageId::JavaScript),
        "py" | "pyw" => Some(LanguageId::Python),
        _ => None,
    }
}

pub fn server_profile(language: LanguageId) -> LanguageServerProfile {
    match language {
        LanguageId::Rust => LanguageServerProfile {
            language,
            display_name: "Rust Analyzer".to_string(),
            command: "rust-analyzer".to_string(),
            args: Vec::new(),
        },
        LanguageId::TypeScript => LanguageServerProfile {
            language,
            display_name: "TypeScript Language Server".to_string(),
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
        },
        LanguageId::JavaScript => LanguageServerProfile {
            language,
            display_name: "JavaScript Language Server".to_string(),
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
        },
        LanguageId::Python => LanguageServerProfile {
            language,
            display_name: "Python LSP Server".to_string(),
            command: "pylsp".to_string(),
            args: Vec::new(),
        },
    }
}
```

- [ ] **Step 5: Write failing tests for JSON-RPC framing**

Add tests to `src-tauri/src/lsp.rs`:

```rust
#[test]
fn encodes_and_decodes_lsp_content_length_frames() {
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize"
    });
    let frame = encode_lsp_message(&payload).expect("encode");
    let mut buffer = frame.clone();

    let decoded = decode_lsp_message(&mut buffer)
        .expect("decode")
        .expect("message");

    assert_eq!(decoded, payload);
    assert!(buffer.is_empty());
}

#[test]
fn waits_for_complete_lsp_frame_body() {
    let mut buffer = b"Content-Length: 12\r\n\r\n{\"jsonrpc\"".to_vec();
    assert!(decode_lsp_message(&mut buffer).expect("decode").is_none());
    assert_eq!(buffer.len(), 34);
}
```

- [ ] **Step 6: Run codec tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml lsp::tests::encodes_and_decodes_lsp_content_length_frames -- --exact
```

Expected: FAIL because `encode_lsp_message` and `decode_lsp_message` are not
implemented yet.

- [ ] **Step 7: Implement JSON-RPC framing**

Add to `src-tauri/src/lsp.rs`:

```rust
pub fn encode_lsp_message(value: &serde_json::Value) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(value).map_err(|err| err.to_string())?;
    let mut frame = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    frame.extend(body);
    Ok(frame)
}

pub fn decode_lsp_message(buffer: &mut Vec<u8>) -> Result<Option<serde_json::Value>, String> {
    let Some(header_end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") else {
        return Ok(None);
    };
    let header = std::str::from_utf8(&buffer[..header_end]).map_err(|err| err.to_string())?;
    let content_length = header
        .lines()
        .find_map(|line| line.strip_prefix("Content-Length: "))
        .ok_or_else(|| "missing LSP Content-Length header".to_string())?
        .parse::<usize>()
        .map_err(|err| format!("invalid LSP Content-Length: {err}"))?;
    let body_start = header_end + 4;
    let body_end = body_start + content_length;
    if buffer.len() < body_end {
        return Ok(None);
    }
    let body = buffer[body_start..body_end].to_vec();
    buffer.drain(..body_end);
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|err| err.to_string())
}
```

- [ ] **Step 8: Register the Rust module and verify GREEN**

Modify `src-tauri/src/lib.rs`:

```rust
pub mod lsp;
```

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml lsp::tests -- --nocapture
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected: PASS for LSP profile and codec tests, and formatting passes.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git add src-tauri/Cargo.toml Cargo.lock src-tauri/src/lsp.rs src-tauri/src/lib.rs
git commit -m "feat: add lsp protocol profiles"
```

## Task 2: Rust LSP Lifecycle, Diagnostics Cache, And Commands

**Files:**
- Modify: `src-tauri/src/lsp.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lsp.rs`
- Test: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write failing Rust tests for lazy server lifecycle**

Add tests to `src-tauri/src/lsp.rs`:

```rust
#[test]
fn opening_supported_document_starts_only_that_language_server() {
    let manager = LanguageServerManager::for_tests(vec![
        TestServerProfile::available(LanguageId::Rust),
        TestServerProfile::available(LanguageId::TypeScript),
    ]);

    let status = manager
        .open_document("workspace", "/workspace", "src/main.rs", "fn main() {}")
        .expect("open document");

    assert_eq!(status.language, LanguageId::Rust);
    assert_eq!(status.state, ServerState::Running);
    assert_eq!(manager.statuses().len(), 1);
}

#[test]
fn unsupported_documents_do_not_start_language_servers() {
    let manager = LanguageServerManager::for_tests(vec![TestServerProfile::available(
        LanguageId::Rust,
    )]);

    let status = manager
        .open_document("workspace", "/workspace", "README.md", "# Docs")
        .expect("open document");

    assert_eq!(status.state, ServerState::Unsupported);
    assert!(manager.statuses().is_empty());
}
```

- [ ] **Step 2: Run lifecycle test to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml lsp::tests::opening_supported_document_starts_only_that_language_server -- --exact
```

Expected: FAIL because `LanguageServerManager`, `ServerState`, and
`TestServerProfile` are not implemented yet.

- [ ] **Step 3: Implement in-memory lifecycle and status state**

Add minimal lifecycle types to `src-tauri/src/lsp.rs`:

```rust
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ServerState {
    Unsupported,
    MissingCommand,
    Running,
    Stopped,
    Error,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LanguageServerStatus {
    pub workspace_id: String,
    pub workspace_root: String,
    pub language: LanguageId,
    pub display_name: String,
    pub state: ServerState,
    pub pid: Option<u32>,
    pub memory_bytes: Option<u64>,
    pub open_documents: usize,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TestServerProfile {
    pub language: LanguageId,
    pub available: bool,
}

impl TestServerProfile {
    pub fn available(language: LanguageId) -> Self {
        Self { language, available: true }
    }
}
```

Implement `LanguageServerManager::for_tests`, `open_document`, and `statuses`
with in-memory state only. Production process spawn is added in Step 6.

- [ ] **Step 4: Write failing tests for diagnostics cache and active workspace sweep**

Add tests:

```rust
#[test]
fn diagnostics_cache_is_workspace_and_file_scoped() {
    let manager = LanguageServerManager::default_for_tests();
    manager.store_diagnostics(
        "workspace-a",
        "src/main.rs",
        vec![sample_diagnostic("unused variable")],
    );
    manager.store_diagnostics(
        "workspace-b",
        "src/main.rs",
        vec![sample_diagnostic("syntax error")],
    );

    assert_eq!(
        manager.document_diagnostics("workspace-a", "src/main.rs")[0].message,
        "unused variable"
    );
    assert_eq!(manager.workspace_diagnostics("workspace-b").len(), 1);
}

#[test]
fn idle_sweep_keeps_recent_servers_and_stops_old_servers() {
    let manager = LanguageServerManager::default_for_tests();
    manager
        .open_document_at("workspace-a", "/a", "src/main.rs", "fn main() {}", 1000)
        .expect("open");
    manager.sweep_idle_servers(1300, 500);
    assert_eq!(manager.statuses()[0].state, ServerState::Running);

    manager.sweep_idle_servers(1701, 500);
    assert_eq!(manager.statuses()[0].state, ServerState::Stopped);
}
```

- [ ] **Step 5: Implement diagnostics cache and idle sweep**

Add `LspDiagnostic`, `LspRange`, and cache helpers using `lsp_types::Diagnostic`
conversion:

```rust
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LspRange {
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LspDiagnostic {
    pub path: String,
    pub range: LspRange,
    pub severity: String,
    pub message: String,
    pub source: Option<String>,
}
```

Implement `store_diagnostics`, `document_diagnostics`, `workspace_diagnostics`,
`open_document_at`, and `sweep_idle_servers` so tests pass.

- [ ] **Step 6: Write failing command signature tests**

Add command tests in `src-tauri/src/commands.rs`:

```rust
#[test]
fn lsp_open_document_preserves_flat_command_signature() {
    type FlatOpenDocumentCommand = for<'app_state, 'lsp_state> fn(
        State<'app_state, AppState>,
        State<'lsp_state, crate::lsp::LspState>,
        String,
        String,
        String,
        String,
    ) -> Result<crate::lsp::LanguageServerStatus, String>;

    fn assert_flat_signature(_command: FlatOpenDocumentCommand) {}

    assert_flat_signature(super::lsp_open_document);
}

#[test]
fn lsp_status_rejects_unregistered_workspace() {
    let config = tempdir().expect("config dir");
    let state = AppState::new(config.path()).expect("state");
    let lsp_state = crate::lsp::LspState::new_for_tests();

    let result = state.lsp_server_status(&lsp_state, "/missing");

    assert!(result.unwrap_err().contains("workspace not registered"));
}
```

- [ ] **Step 7: Implement Tauri LSP state and commands**

Modify `src-tauri/src/lsp.rs`:

```rust
pub struct LspState {
    manager: std::sync::Mutex<LanguageServerManager>,
}

impl LspState {
    pub fn new() -> Self {
        Self { manager: std::sync::Mutex::new(LanguageServerManager::new()) }
    }

    #[cfg(test)]
    pub fn new_for_tests() -> Self {
        Self { manager: std::sync::Mutex::new(LanguageServerManager::default_for_tests()) }
    }
}
```

Modify `src-tauri/src/lib.rs` setup:

```rust
app.manage(lsp::LspState::new());
```

Register command wrappers:

```rust
commands::lsp_server_status,
commands::lsp_open_document,
commands::lsp_close_document,
commands::lsp_document_diagnostics,
commands::lsp_workspace_diagnostics,
commands::lsp_hover,
commands::lsp_definition,
commands::lsp_references,
commands::lsp_completion,
commands::lsp_code_actions,
commands::lsp_symbols,
commands::lsp_rename,
commands::lsp_restart_server,
commands::lsp_server_logs,
```

Commands that require full server request transport may return empty response
objects when no server is running, but they must not start unsupported servers.

- [ ] **Step 8: Verify GREEN**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml lsp::tests -- --nocapture
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml commands::tests::lsp_open_document_preserves_flat_command_signature -- --exact
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

Expected: all commands PASS.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add src-tauri/src/lsp.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add lsp lifecycle commands"
```

## Task 3: Frontend Language API And State

**Files:**
- Create: `src/features/language/language-api.ts`
- Create: `src/features/language/language-model.ts`
- Create: `src/features/language/language-model.test.ts`
- Modify: `src/app/workspace-view-state.ts`
- Test: `src/features/language/language-model.test.ts`
- Test: `src/app/workspace-view-state.test.ts`

- [ ] **Step 1: Write failing Bun tests for language state**

Create `src/features/language/language-model.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  createLanguageState,
  replaceDiagnostics,
  replaceServerStatuses,
  selectDiagnosticBadge,
  storeHover,
  storeServerLogs,
} from "./language-model";

describe("language model", () => {
  test("stores diagnostics per workspace path and counts errors", () => {
    const state = replaceDiagnostics(createLanguageState(), [
      {
        path: "src/main.rs",
        range: { start_line: 1, start_character: 0, end_line: 1, end_character: 4 },
        severity: "error",
        message: "expected item",
        source: "rust-analyzer",
      },
      {
        path: "src/app.ts",
        range: { start_line: 2, start_character: 1, end_line: 2, end_character: 5 },
        severity: "warning",
        message: "unused",
        source: "typescript-language-server",
      },
    ]);

    expect(selectDiagnosticBadge(state)).toBe("2");
    expect(state.diagnosticsByPath["src/main.rs"][0].message).toBe("expected item");
  });

  test("stores server status, hover, and logs without mutating defaults", () => {
    const state = storeServerLogs(
      storeHover(
        replaceServerStatuses(createLanguageState(), [
          {
            workspace_id: "workspace",
            workspace_root: "/workspace",
            language: "Rust",
            display_name: "Rust Analyzer",
            state: "Running",
            pid: 10,
            memory_bytes: 1024,
            open_documents: 1,
            last_error: null,
          },
        ]),
        { path: "src/main.rs", line: 1, character: 1, contents: "fn main" },
      ),
      ["initialized", "diagnostics updated"],
    );

    expect(state.serverStatuses[0].display_name).toBe("Rust Analyzer");
    expect(state.activeHover?.contents).toBe("fn main");
    expect(state.serverLogs).toEqual(["initialized", "diagnostics updated"]);
  });
});
```

- [ ] **Step 2: Run state tests to verify RED**

Run:

```bash
bun test src/features/language/language-model.test.ts
```

Expected: FAIL because `language-model.ts` does not exist.

- [ ] **Step 3: Implement language model**

Create `src/features/language/language-model.ts`:

```ts
export type LspRange = {
  start_line: number;
  start_character: number;
  end_line: number;
  end_character: number;
};

export type LspDiagnostic = {
  path: string;
  range: LspRange;
  severity: "error" | "warning" | "information" | "hint" | string;
  message: string;
  source: string | null;
};

export type LanguageServerStatus = {
  workspace_id: string;
  workspace_root: string;
  language: "Rust" | "TypeScript" | "JavaScript" | "Python" | string;
  display_name: string;
  state: "Unsupported" | "MissingCommand" | "Running" | "Stopped" | "Error" | string;
  pid: number | null;
  memory_bytes: number | null;
  open_documents: number;
  last_error: string | null;
};

export type LanguageHover = {
  path: string;
  line: number;
  character: number;
  contents: string;
};

export type LanguageViewState = {
  diagnosticsByPath: Record<string, LspDiagnostic[]>;
  serverStatuses: LanguageServerStatus[];
  activeHover: LanguageHover | null;
  serverLogs: string[];
  loading: boolean;
  error: string | null;
};

export function createLanguageState(): LanguageViewState {
  return {
    diagnosticsByPath: {},
    serverStatuses: [],
    activeHover: null,
    serverLogs: [],
    loading: false,
    error: null,
  };
}

export function replaceDiagnostics(
  state: LanguageViewState,
  diagnostics: LspDiagnostic[],
): LanguageViewState {
  const diagnosticsByPath: Record<string, LspDiagnostic[]> = {};
  for (const diagnostic of diagnostics) {
    diagnosticsByPath[diagnostic.path] = [
      ...(diagnosticsByPath[diagnostic.path] ?? []),
      diagnostic,
    ];
  }
  return { ...state, diagnosticsByPath, loading: false, error: null };
}

export function replaceServerStatuses(
  state: LanguageViewState,
  serverStatuses: LanguageServerStatus[],
): LanguageViewState {
  return { ...state, serverStatuses, loading: false, error: null };
}

export function storeHover(
  state: LanguageViewState,
  activeHover: LanguageHover | null,
): LanguageViewState {
  return { ...state, activeHover };
}

export function storeServerLogs(
  state: LanguageViewState,
  serverLogs: string[],
): LanguageViewState {
  return { ...state, serverLogs: serverLogs.slice(-80) };
}

export function selectDiagnosticBadge(state: LanguageViewState): string | null {
  const count = Object.values(state.diagnosticsByPath).reduce(
    (sum, diagnostics) => sum + diagnostics.length,
    0,
  );
  return count > 0 ? String(count) : null;
}
```

- [ ] **Step 4: Create typed frontend API wrappers**

Create `src/features/language/language-api.ts`:

```ts
import { call } from "../../lib/tauri";
import type {
  LanguageHover,
  LanguageServerStatus,
  LspDiagnostic,
} from "./language-model";

export function getLanguageServerStatus(
  workspaceRoot: string,
): Promise<LanguageServerStatus[]> {
  return call("lsp_server_status", { workspaceRoot });
}

export function openLanguageDocument(args: {
  workspaceId: string;
  workspaceRoot: string;
  path: string;
  content: string;
}): Promise<LanguageServerStatus> {
  return call("lsp_open_document", args);
}

export function closeLanguageDocument(args: {
  workspaceId: string;
  workspaceRoot: string;
  path: string;
}): Promise<void> {
  return call("lsp_close_document", args);
}

export function getWorkspaceDiagnostics(
  workspaceId: string,
): Promise<LspDiagnostic[]> {
  return call("lsp_workspace_diagnostics", { workspaceId });
}

export function requestLanguageHover(args: {
  workspaceId: string;
  workspaceRoot: string;
  path: string;
  line: number;
  character: number;
}): Promise<LanguageHover | null> {
  return call("lsp_hover", args);
}
```

- [ ] **Step 5: Add language state to workspace view store**

Modify `src/app/workspace-view-state.ts`:

```ts
import { createLanguageState, type LanguageViewState } from "../features/language/language-model";
```

Add `language: LanguageViewState` to `WorkspaceView`. Add
`language: createLanguageState()` in defaults. Freeze language defaults the same
way existing docs/task defaults are frozen.

- [ ] **Step 6: Add workspace store tests**

Add to `src/app/workspace-view-state.test.ts`:

```ts
test("language state is restored per workspace", () => {
  const store = createWorkspaceViewStore();

  store.getState().updateView("workspace-a", {
    language: replaceDiagnostics(createLanguageState(), [
      {
        path: "src/main.rs",
        range: { start_line: 1, start_character: 0, end_line: 1, end_character: 4 },
        severity: "error",
        message: "expected item",
        source: "rust-analyzer",
      },
    ]),
  });

  expect(store.getState().viewFor("workspace-a").language.diagnosticsByPath["src/main.rs"]).toHaveLength(1);
  expect(store.getState().viewFor("workspace-b").language.diagnosticsByPath).toEqual({});
});
```

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
bun test src/features/language/language-model.test.ts src/app/workspace-view-state.test.ts
git add src/features/language/language-api.ts src/features/language/language-model.ts src/features/language/language-model.test.ts src/app/workspace-view-state.ts src/app/workspace-view-state.test.ts
git commit -m "feat: add language frontend state"
```

Expected: focused Bun tests PASS and commit succeeds.

## Task 4: Diagnostics Panel, Activity Rail, And Status Bar

**Files:**
- Create: `src/features/language/LanguagePanel.tsx`
- Create: `src/features/language/LanguagePanel.test.tsx`
- Modify: `src/app/activity-rail.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/command-palette-model.ts`
- Modify: `src/app/command-palette-model.test.ts`
- Modify: `src/index.css`
- Test: `src/features/language/LanguagePanel.test.tsx`
- Test: `src/app/command-palette-model.test.ts`

- [ ] **Step 1: Write failing LanguagePanel UI tests**

Create `src/features/language/LanguagePanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "bun:test";

import { createLanguageState, replaceDiagnostics, replaceServerStatuses } from "./language-model";
import { LanguagePanel } from "./LanguagePanel";

describe("LanguagePanel", () => {
  test("renders diagnostics and restarts a server", () => {
    const onRestart = () => {
      calls.push("restart");
    };
    const calls: string[] = [];
    const state = replaceServerStatuses(
      replaceDiagnostics(createLanguageState(), [
        {
          path: "src/main.rs",
          range: { start_line: 1, start_character: 0, end_line: 1, end_character: 4 },
          severity: "error",
          message: "expected item",
          source: "rust-analyzer",
        },
      ]),
      [
        {
          workspace_id: "workspace",
          workspace_root: "/workspace",
          language: "Rust",
          display_name: "Rust Analyzer",
          state: "Running",
          pid: 10,
          memory_bytes: 2048,
          open_documents: 1,
          last_error: null,
        },
      ],
    );

    render(
      <LanguagePanel
        state={state}
        onOpenDiagnostic={() => calls.push("open")}
        onRefresh={() => calls.push("refresh")}
        onRestartServer={onRestart}
      />,
    );

    expect(screen.getByText("expected item")).toBeTruthy();
    expect(screen.getByText("Rust Analyzer")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Restart Rust Analyzer"));
    expect(calls).toEqual(["restart"]);
  });
});
```

- [ ] **Step 2: Run UI test to verify RED**

Run:

```bash
bun test src/features/language/LanguagePanel.test.tsx
```

Expected: FAIL because `LanguagePanel.tsx` does not exist.

- [ ] **Step 3: Implement compact LanguagePanel**

Create `src/features/language/LanguagePanel.tsx` using lucide icons
`RefreshCw`, `RotateCw`, `AlertTriangle`, and `Languages`. The panel must:

- Use `panel-body language-panel`.
- Render server rows with display name, state badge, memory, open docs, and
  restart icon button.
- Render diagnostics rows with severity badge, path, line number, source, and
  message.
- Render logs in a compact mono block.
- Use callbacks passed from `AppShell`.

- [ ] **Step 4: Add Language rail item and command palette entries**

Modify `src/app/activity-rail.tsx`:

```ts
import { Languages } from "lucide-react";
```

Add activity ID `"language"` and item:

```ts
{ id: "language", label: "Language", icon: Languages },
```

Modify `src/app/command-palette-model.ts`:

```ts
{ id: "open-language", label: "Language: Open diagnostics", group: "Language" },
{ id: "language-refresh", label: "Language: Refresh diagnostics", group: "Language" },
{ id: "language-restart", label: "Language: Restart active server", group: "Language" },
```

Add a command palette test asserting these labels exist.

- [ ] **Step 5: Wire panel and status bar in AppShell**

In `src/app/AppShell.tsx`, add:

- `panelTitles.language = "Language"`.
- `selectDiagnosticBadge(view.language)` in rail badges.
- `LanguagePanel` rendering in `PanelContent`.
- Status bar item `diagnostics {count}` using language diagnostics count while
  keeping the existing task problems item.
- Command palette handlers for open, refresh, and restart.

- [ ] **Step 6: Add CSS aligned to docs/ui-design**

Add to `src/index.css`:

```css
.language-panel { display: flex; flex-direction: column; gap: 10px; padding: 10px; }
.language-server-row,
.language-diagnostic-row { min-width: 0; align-items: flex-start; gap: 8px; }
.language-row-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.language-row-title { color: var(--txt); font-size: 12px; font-weight: 650; }
.language-row-sub,
.language-log { color: var(--txt-faint); font-size: 10.5px; }
.language-log { max-height: 160px; overflow: auto; white-space: pre-wrap; }
.language-memory { flex: 0 0 auto; }
```

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
bun test src/features/language/LanguagePanel.test.tsx src/app/command-palette-model.test.ts
bun run build
git add src/features/language/LanguagePanel.tsx src/features/language/LanguagePanel.test.tsx src/app/activity-rail.tsx src/app/AppShell.tsx src/app/command-palette-model.ts src/app/command-palette-model.test.ts src/index.css
git commit -m "feat: add language diagnostics panel"
```

Expected: focused UI tests PASS and build exits 0.

## Task 5: Editor LSP Integration And Monaco Providers

**Files:**
- Modify: `src/features/editor/EditorTab.tsx`
- Modify: `src/features/editor/EditorTab.test.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/features/language/language-model.ts`
- Modify: `src/features/language/language-model.test.ts`
- Test: `src/features/editor/EditorTab.test.ts`
- Test: `src/features/language/language-model.test.ts`

- [ ] **Step 1: Write failing tests for marker conversion**

Add to `src/features/language/language-model.test.ts`:

```ts
import { diagnosticsForPath, severityToMonacoMarker } from "./language-model";

test("selects diagnostics for a path and maps marker severity", () => {
  const state = replaceDiagnostics(createLanguageState(), [
    {
      path: "src/main.rs",
      range: { start_line: 0, start_character: 1, end_line: 0, end_character: 4 },
      severity: "error",
      message: "expected item",
      source: "rust-analyzer",
    },
  ]);

  expect(diagnosticsForPath(state, "src/main.rs")).toHaveLength(1);
  expect(diagnosticsForPath(state, "src/lib.rs")).toEqual([]);
  expect(severityToMonacoMarker("error")).toBe(8);
  expect(severityToMonacoMarker("warning")).toBe(4);
});
```

- [ ] **Step 2: Run marker tests to verify RED**

Run:

```bash
bun test src/features/language/language-model.test.ts
```

Expected: FAIL because marker helpers are not implemented.

- [ ] **Step 3: Implement marker helpers**

Add to `src/features/language/language-model.ts`:

```ts
export function diagnosticsForPath(
  state: LanguageViewState,
  path: string,
): LspDiagnostic[] {
  return state.diagnosticsByPath[path] ?? [];
}

export function severityToMonacoMarker(severity: string): number {
  if (severity === "error") return 8;
  if (severity === "warning") return 4;
  if (severity === "information") return 2;
  return 1;
}
```

- [ ] **Step 4: Write failing EditorTab identity test for diagnostics**

Add to `src/features/editor/EditorTab.test.ts`:

```ts
test("createEditorIdentity ignores diagnostics so Monaco is not recreated", () => {
  const first = createEditorIdentity({
    workspaceId: "workspace",
    filePath: "src/main.rs",
    language: "rust",
    readOnly: false,
    content: "fn main() {}",
  });
  const second = createEditorIdentity({
    workspaceId: "workspace",
    filePath: "src/main.rs",
    language: "rust",
    readOnly: false,
    content: "fn main() {}",
  });

  expect(first).toBe(second);
});
```

Expected: PASS today; it protects against adding diagnostics to editor identity.

- [ ] **Step 5: Add EditorTab props and Monaco marker/provider hooks**

Modify `src/features/editor/EditorTab.tsx` to accept:

```ts
import type { LspDiagnostic } from "../language/language-model";

type EditorTabProps = {
  diagnostics: LspDiagnostic[];
  onHover: (line: number, character: number) => Promise<string | null>;
  onGoToDefinition: (line: number, character: number) => Promise<void>;
  onReferences: (line: number, character: number) => Promise<void>;
  onCompletion: (line: number, character: number) => Promise<unknown[]>;
  onCodeActions: (line: number, character: number) => Promise<unknown[]>;
  onRename: (line: number, character: number, newName: string) => Promise<void>;
};
```

In the Monaco creation effect:

- Set markers with `monaco.editor.setModelMarkers(model, "yuuzu-lsp", markers)`.
- Register hover, definition, references, completion, code action, and rename
  providers for the current language.
- Dispose providers when the tab unmounts or language changes.
- Keep diagnostics out of `createEditorIdentity`.

- [ ] **Step 6: Wire AppShell active document open and provider callbacks**

In `src/app/AppShell.tsx`:

- After `readTextFile` succeeds and `loadedFile` is set, call
  `openLanguageDocument` for supported files with current content.
- After successful save, call `openLanguageDocument` with saved content.
- Pass active file diagnostics to `EditorTab`.
- Implement hover, definition, references, completion, code action, and rename
  callbacks by calling the typed language API wrappers.
- On close tab, call `closeLanguageDocument` for that workspace/path.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
bun test src/features/language/language-model.test.ts src/features/editor/EditorTab.test.ts
bun run build
git add src/features/editor/EditorTab.tsx src/features/editor/EditorTab.test.ts src/app/AppShell.tsx src/features/language/language-model.ts src/features/language/language-model.test.ts
git commit -m "feat: wire editor language providers"
```

Expected: focused tests PASS and build exits 0.

## Task 6: Server Logs, Restart, Memory, And Browser Smoke

**Files:**
- Modify: `src-tauri/src/lsp.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/features/language/language-api.ts`
- Modify: `src/features/language/language-model.ts`
- Modify: `src/features/language/LanguagePanel.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/index.css`
- Test: `src-tauri/src/lsp.rs`
- Test: `src/features/language/language-model.test.ts`

- [ ] **Step 1: Write failing Rust tests for logs, restart, and memory summary**

Add to `src-tauri/src/lsp.rs`:

```rust
#[test]
fn restart_replaces_status_and_records_log_line() {
    let manager = LanguageServerManager::default_for_tests();
    manager
        .open_document("workspace", "/workspace", "src/main.rs", "fn main() {}")
        .expect("open");

    let restarted = manager.restart_server("workspace", LanguageId::Rust).expect("restart");

    assert_eq!(restarted.state, ServerState::Running);
    assert!(manager.server_logs("workspace").iter().any(|line| line.contains("restarted Rust Analyzer")));
}

#[test]
fn status_exposes_memory_bytes_for_running_servers() {
    let manager = LanguageServerManager::default_for_tests();
    manager
        .open_document("workspace", "/workspace", "src/main.rs", "fn main() {}")
        .expect("open");
    manager.set_memory_for_tests("workspace", LanguageId::Rust, 4096);

    let status = manager.statuses();

    assert_eq!(status[0].memory_bytes, Some(4096));
}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml lsp::tests::restart_replaces_status_and_records_log_line -- --exact
```

Expected: FAIL because restart/log/memory helpers are not implemented.

- [ ] **Step 3: Implement restart, logs, and memory**

Implement:

- `restart_server(workspace_id, language)`.
- `server_logs(workspace_id)`.
- `set_memory_for_tests(workspace_id, language, bytes)`.
- production memory sampling with the existing `metrics` module process snapshot
  where the server PID is available.

Keep logs bounded to 120 lines per workspace.

- [ ] **Step 4: Add frontend log and memory state helpers**

Add Bun test:

```ts
test("formats server memory labels", () => {
  expect(serverMemoryLabel({ memory_bytes: 1048576 } as any)).toBe("1.0 MB");
  expect(serverMemoryLabel({ memory_bytes: null } as any)).toBe("not running");
});
```

Implement `serverMemoryLabel` in `language-model.ts`.

- [ ] **Step 5: Wire restart and logs through AppShell**

In `AppShell.tsx`:

- `refreshLanguageStatus()` calls `getLanguageServerStatus` and
  `getWorkspaceDiagnostics`.
- `restartActiveLanguageServer()` calls `lsp_restart_server` for the active
  file language.
- `refreshLanguageLogs()` calls `lsp_server_logs`.
- Language panel refresh button calls both status and diagnostics refresh.

- [ ] **Step 6: Run browser smoke with Tauri IPC mocks**

Use the existing dev server at `http://127.0.0.1:1420/` or start it:

```bash
bun run dev --host 127.0.0.1 --port 1420
```

Run a Playwright smoke that injects mocks for:

- `lsp_server_status`: one Rust server running with `memory_bytes: 1048576`.
- `lsp_workspace_diagnostics`: one Rust error diagnostic.
- `lsp_open_document`: returns running Rust Analyzer status.
- `lsp_hover`: returns `fn main()`.
- `lsp_restart_server`: returns running Rust Analyzer status and adds a log.
- `lsp_server_logs`: returns `["initialized", "restarted Rust Analyzer"]`.

Smoke checkpoints:

- Language rail badge shows `1`.
- Language panel shows Rust Analyzer, `1.0 MB`, and the diagnostic row.
- Status bar shows diagnostics count.
- Restart button calls `lsp_restart_server`.
- Logs block shows the restart log.
- At 390 by 844, Language panel rows stay within their container.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml lsp::tests -- --nocapture
bun test src/features/language/language-model.test.ts src/features/language/LanguagePanel.test.tsx
bun run build
git add src-tauri/src/lsp.rs src-tauri/src/commands.rs src/features/language/language-api.ts src/features/language/language-model.ts src/features/language/language-model.test.ts src/features/language/LanguagePanel.tsx src/app/AppShell.tsx src/index.css
git commit -m "feat: add language server controls"
```

Expected: focused Rust and Bun tests PASS, browser smoke PASS, and build exits 0.

## Task 7: Node 6 Verification, Measurements, And Documentation

**Files:**
- Create: `docs/architecture/node-6-language-results.md`
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
. "$HOME/.cargo/env" && bun run tauri build --debug
```

Expected: all commands PASS. Vite chunk warnings remain acceptable when exit
code is 0.

- [ ] **Step 2: Run focused language verification**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml lsp::tests -- --nocapture
bun test src/features/language/language-model.test.ts src/features/language/LanguagePanel.test.tsx src/features/editor/EditorTab.test.ts
```

Expected: all focused LSP and language UI tests PASS.

- [ ] **Step 3: Run browser UI smoke with Tauri IPC mocks**

Smoke the Language panel, status bar diagnostics, editor marker path, restart
control, server logs, memory label, and 390 by 844 mobile containment. Record
the command output and the mocked calls observed.

- [ ] **Step 4: Write results document**

Create `docs/architecture/node-6-language-results.md` with sections:

```markdown
# Node 6 Language Results

## Scope

## Verification

## Smoke Evidence

## Measurements

## TDD And Review Evidence

## Commit Milestones

## Residual Risks

## Result
```

Include command outputs, test counts, debug app paths, browser smoke evidence,
language server memory evidence, lazy startup evidence, and WebView automation
caveats.

- [ ] **Step 5: Update progress and roadmap**

Append Node 6 to `docs/architecture/progress.md`.

Update `roadmap.md` Current Priority:

```markdown
Node 0, Node 1, Node 2, Node 3, Node 4, Node 5, and Node 6 are complete. The
next active priority is Node 7: integrate agent-assisted development as a
structured IDE workflow.
```

Add a Node 6 verification bullet under Current Priority.

- [ ] **Step 6: Run documentation checks**

Run:

```bash
rg -n 'T[B]D|T[O]DO|F[I]XME|place[ ]holder|<[^>]+>' docs/architecture/node-6-language-results.md docs/architecture/progress.md roadmap.md
git diff --check
```

Expected: `rg` finds no matches and `git diff --check` passes.

- [ ] **Step 7: Commit**

Run:

```bash
git add docs/architecture/node-6-language-results.md docs/architecture/progress.md roadmap.md
git commit -m "docs: record node 6 language results"
```

## Self-Review

Spec coverage:

- LSP client: Tasks 1, 2, 5, and 6.
- Lazy language server startup: Task 2 and Task 5.
- Diagnostics: Tasks 2, 3, 4, 5, and 6.
- Hover: Task 5.
- Go to definition: Task 5.
- References: Task 5.
- Rename: Task 5.
- Completion: Task 5.
- Code actions: Task 5.
- Symbols and outline: Task 2 and Task 6.
- Language server logs and restart: Task 6.
- Rust, TypeScript/JavaScript, and Python baseline support: Tasks 1 and 2.
- Diagnostics in editor, panel, and status bar: Tasks 4 and 5.
- Language server memory cost visible to the user: Task 6.

Placeholder scan:

- The plan uses exact files, commands, and expected outcomes.
- No deferred implementation wording is intentionally present.

Plan complete and saved to
`docs/superpowers/plans/2026-06-09-node-6-language-intelligence.md`. Per the
active goal, execute with superpowers:subagent-driven-development: fresh
implementer per task, spec-compliance review, code-quality review, and TDD
RED/GREEN/REFACTOR evidence for every behavior change.
