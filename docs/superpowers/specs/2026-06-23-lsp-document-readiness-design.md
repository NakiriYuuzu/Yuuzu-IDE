# LSP Document Readiness Lifecycle — 設計規格

> 🟡 **實作狀態:Draft / 待 review** — 本文件只定義可落地方案,尚未修改產品程式碼。對應 HTML review artifact:`docs/html/lsp-document-readiness-spec-2026-06-23.html`

- 日期:2026-06-23
- 任務類型:`feature` + `ui-runtime`
- 範圍:根本解決 Yuuzu-IDE LSP 預設 `Stopped`、editor LSP actions 需手動/隱含前置條件、文件內容同步分散等問題。
- 主要設計原則:保留 lazy-start 的資源優勢,但建立「document-first readiness contract」,讓任何 LSP 行為在執行前都能可靠準備目前文件。

---

## 1. 問題背景

目前 LSP 行為不是單純「預設沒啟動」,而是三個概念混在一起:

1. **server process lifecycle**:server 是 `Stopped` / `Running` / `MissingCommand` / `Error`。
2. **workspace language discovery**:workspace 偵測到 `.ts` / `.rs` 等語言,但不代表 server 已啟動。
3. **document readiness**:某個檔案是否已對 server 完成 `didOpen` / `didChange`,且內容是否為最新。

現有設計的 observable 行為:

- `ensureLang(...)` 只讀 `lsp_server_status`、logs、workspace diagnostics,不啟動 server。
- `status_for_workspace(...)` 對偵測到但未開過文件的語言回 `Stopped`。
- `openFile(...)` 打開支援檔案時會背景呼叫 `openLspDocument(...)`,但 editor actions 沒有統一的 `ensure document ready` 前置入口。
- `Go to Definition` / `Find References` / `Rename Symbol` / `Code Actions` 直接送 request;如果 server record 還不存在,後端可能回 `language server not found...`。
- context menu actions 的 disabled 條件目前主要是 `!cursor`,不是 LSP readiness。

這造成使用者看到「Language Servers 預設都沒啟動」,以及 LSP actions 看起來不可靠。

---

## 2. 根本目標

### Goals

- 建立單一 contract:`ensure LSP document ready before request`。
- 保留 lazy-start:不在 workspace 開啟時預設啟動所有 language servers。
- 讓 editor LSP actions 可自動啟動 server、initialize、同步目前文件,再執行 request。
- 把 `Stopped` 的 UI 語義拆清楚:未使用應顯示 `Idle`,真正停止才是 `Stopped`。
- 缺少 command 時回傳可解釋狀態,例如 `MissingCommand: typescript-language-server`。
- 測試能驗證 Idle -> ensure -> Ready、MissingCommand、unsupported file、stale content didChange。

### Non-goals

- 不自動安裝 `rust-analyzer` / `typescript-language-server` / `pylsp` 等第三方工具。
- 不把所有 detected languages 預設啟動。
- 不替換 CodeMirror/editor engine。
- 不重寫整個 LSP protocol layer。
- 不移除現有 `lsp_open_document`;先以相容方式導入新 command/helper。

---

## 3. Proposed Architecture

核心改動:把「server 是否啟動」與「文件是否 ready」拆成兩層狀態。

### 3.1 Server lifecycle state

```ts
type LanguageServerLifecycleState =
  | "Idle"           // workspace detected language, no process started yet
  | "Starting"       // spawn / initialize in progress
  | "Running"        // process initialized, may or may not have current document
  | "MissingCommand" // command could not be found or is unavailable
  | "Error"          // process/request error
  | "Stopped"        // process was previously running and then stopped
```

現有 `ServerState::Stopped` 不足以表示「尚未啟動」。應新增 `Idle`,並只在曾啟動後被 stop/close/kill 的情境使用 `Stopped`。

### 3.2 Document readiness state

```ts
type LspDocumentReadiness =
  | "Unsupported"    // file extension/language unsupported
  | "Syncing"        // ensure command is starting/syncing
  | "Ready"          // didOpen/didChange has current content/version
  | "Stale"          // known document, content/version not current
  | "MissingCommand" // server command unavailable
  | "Error"
```

LSP actions 應以 document readiness 為主,不是只看 process state。

### 3.3 New backend command

新增 IPC command:

```ts
type LspEnsureDocumentInput = {
  workspaceId: string
  workspaceRoot: string
  path: string
  content: string
  version?: number | null
}

type LspEnsureDocumentResult = {
  workspaceId: string
  workspaceRoot: string
  path: string
  language: string | null
  readiness: LspDocumentReadiness
  server: LanguageServerStatus
  command: string | null
  lastError: string | null
}
```

Rust command name:

```rust
lsp_ensure_document
```

Backend responsibilities:

1. Validate trusted workspace root exactly like existing LSP commands.
2. Detect language from `path`.
3. Return `Unsupported` without spawning for unsupported paths.
4. Resolve server profile and command.
5. Spawn and initialize if server is `Idle` / `Stopped` / recoverable `Error`.
6. Send `didOpen` for first open.
7. Send `didChange` when content/version differs.
8. Update server status and document version.
9. Return document readiness and server status.

`lsp_open_document` can internally call the same manager method, or remain as a thin compatibility wrapper.

### 3.4 Frontend controller helper

新增 controller-level helper:

```ts
async function ensureLspDocumentReady(tabIdOrPath: number | string): Promise<LspEnsureDocumentResult>
```

Responsibilities:

- Resolve active project root.
- Resolve target file tab and current content.
- Reject unsupported/too-large/binary files before IPC when possible.
- Call `ensureLanguageDocument(...)`.
- Patch `lspServers`.
- Patch optional document readiness map.
- Surface actionable toasts only for user-triggered actions.

所有 editor LSP actions 必須先 await this helper:

- `gotoDefinition`
- `findReferences`
- `renameSymbol`
- `codeActionsAt`
- `hoverAt`
- `completeAt`
- diagnostics refresh for active document

---

## 4. Current vs Target Flow

### Current flow

```text
Open workspace
  -> Language Settings reload
  -> status_for_workspace detects languages
  -> inactive detected languages return Stopped

Open file
  -> openLspDocument runs in background

User invokes Go to Definition
  -> requestLanguageDefinition directly
  -> may fail if server record/document is not ready
```

### Target flow

```text
Open workspace
  -> Language Settings reload
  -> detected languages return Idle

Open file
  -> optional background ensure for warm-up

User invokes Go to Definition
  -> ensureLspDocumentReady(current tab)
      -> spawn if Idle
      -> initialize if needed
      -> didOpen/didChange current content
      -> return Ready or actionable failure
  -> requestLanguageDefinition
```

---

## 5. UI / UX Contract

### Language Servers settings

Status labels:

| Backend state | UI label | Meaning |
| --- | --- | --- |
| `Idle` | `Idle · starts on first use` | Language detected, no process yet |
| `Starting` | `Starting...` | Spawn/initialize in progress |
| `Running` | `Running · open N` | Server process alive |
| `MissingCommand` | `Missing command: <command>` | Tool not found |
| `Error` | `Error: <message>` | Server failed |
| `Stopped` | `Stopped` | Was running, then stopped |

Buttons:

- `Idle` -> `Start`
- `Running` -> `Restart`
- `MissingCommand` -> disabled primary action + install hint
- `Error` -> `Retry`
- `Stopped` -> `Start`

### Context menu LSP actions

Actions should be enabled when:

- Cursor exists.
- File path is supported by LSP.
- Tab content is string and not too large.

Actions should not be disabled just because server is `Idle`; the action itself will ensure readiness.

### Toast rules

- Unsupported file: no noisy toast for passive hover; explicit action can show `Language service does not support this file type`.
- Missing command: explicit action shows `Missing language server command: typescript-language-server`.
- Starting: optional status indicator, no blocking modal.
- Timeout/error: show concise action-specific toast, e.g. `Definition: TypeScript Language Server timed out`.

---

## 6. Implementation Plan

### Task 1 — State model split

Files:

- `src-tauri/src/lsp.rs`
- `src/features/language/language-model.ts`
- `src/v2/v2-model.ts`

Work:

- Add `Idle` to Rust `ServerState`.
- Update serialization and TS models.
- Change inactive detected workspace language from `Stopped` to `Idle`.
- Keep existing `Stopped` behavior only for previously running server that was stopped.

Verification:

- Rust unit: detected but unopened language returns `Idle`.
- Existing status tests updated from `Stopped` to `Idle` where correct.

### Task 2 — Backend ensure document command

Files:

- `src-tauri/src/lsp.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/lib.rs`
- `src/features/language/language-api.ts`

Work:

- Add `LspEnsureDocumentResult`.
- Add manager method `ensure_document(...)`.
- Add command `lsp_ensure_document`.
- Expose TS wrapper `ensureLanguageDocument(...)`.
- Preserve `lsp_open_document` as compatibility wrapper.

Verification:

- Rust unit: unsupported file returns `Unsupported` and does not spawn.
- Rust unit: Idle + supported file starts transport and returns `Ready`.
- Rust unit: same content does not send duplicate didChange.
- Rust unit: changed content sends didChange and returns `Ready`.
- Rust unit: missing command returns `MissingCommand` with command name.

### Task 3 — Frontend readiness helper

Files:

- `src/v2/controller.ts`
- `src/v2/v2-store.ts`

Work:

- Add `ensureLspDocumentReady(...)` helper.
- Patch server state from ensure result.
- Add optional `lspDocumentsByPath` state if UI needs per-document readiness.
- Deduplicate concurrent ensures per `pid:path` to avoid double spawn.

Verification:

- Bun test: helper calls API with active tab content.
- Bun test: concurrent action shares one pending ensure.
- Bun test: MissingCommand produces actionable toast for explicit actions.

### Task 4 — Route all editor LSP actions through ensure

Files:

- `src/v2/controller.ts`
- `src/v2/ContentViews.tsx`
- `src/v2/Overlays.tsx`

Work:

- `gotoDefinition`: ensure, then request definition.
- `findReferences`: ensure, then request references.
- `renameSymbol`: ensure, then request rename.
- `codeActionsAt`: ensure, then request code actions.
- `hoverAt`: ensure only after debounce; suppress noisy toast.
- `completeAt`: ensure, then request completion.
- Context menu enabled condition becomes cursor + supported file + usable content.

Verification:

- Bun test: definition action calls ensure before definition request.
- Bun test: references/rename/code actions call ensure first.
- Bun test: unsupported file keeps actions disabled or returns no-op consistently.
- Runtime smoke: first use from fresh app opens `.ts` file and Go to Definition starts TS server.

### Task 5 — Language Settings UI semantics

Files:

- `src/v2/Overlays.tsx`
- `src/v2/yuzu.css`
- Tests under `src/v2/`

Work:

- Show `Idle · starts on first use`.
- Use `Start` / `Restart` / `Retry` labels by state.
- Show command names and install hints for `MissingCommand`.
- Display open document count and readiness where available.

Verification:

- Bun test: Idle state renders Idle label and Start button.
- Bun test: MissingCommand renders command and disabled/retry-safe UI.
- Runtime smoke: Language Settings no longer misleads unopened server as Stopped.

### Task 6 — Packaged runtime smoke

Use repo-local Tauri debug smoke flow.

Verification:

- `bun test src/features/language src/v2`
- `bunx tsc --noEmit`
- `cargo test --manifest-path src-tauri/Cargo.toml lsp`
- `bun run tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'`
- Packaged app smoke:
  - Fresh launch.
  - Open `vite.config.ts`.
  - Language Settings shows TypeScript as `Idle` before first use if no file has started it.
  - Invoke Go to Definition / Code Actions from editor.
  - TypeScript server transitions to `Running` or actionable `MissingCommand`.
  - Missing C# / Kotlin command is reported as `MissingCommand`, not generic stopped/error.

---

## 7. Data Model Detail

### Rust

```rust
pub enum ServerState {
    Unsupported,
    Idle,
    Starting,
    MissingCommand,
    Running,
    Stopped,
    Error,
}

pub enum DocumentReadiness {
    Unsupported,
    Syncing,
    Ready,
    Stale,
    MissingCommand,
    Error,
}

pub struct LspEnsureDocumentResult {
    pub workspace_id: String,
    pub workspace_root: String,
    pub path: String,
    pub language: Option<LanguageId>,
    pub readiness: DocumentReadiness,
    pub server: LanguageServerStatus,
    pub command: Option<String>,
    pub last_error: Option<String>,
}
```

### TypeScript

```ts
export type LspDocumentReadiness =
  | "Unsupported"
  | "Syncing"
  | "Ready"
  | "Stale"
  | "MissingCommand"
  | "Error"

export type LspEnsureDocumentResult = {
  workspace_id: string
  workspace_root: string
  path: string
  language: string | null
  readiness: LspDocumentReadiness
  server: LanguageServerStatus
  command: string | null
  last_error: string | null
}
```

---

## 8. Concurrency and Timeout Rules

- Deduplicate ensure calls per `workspaceId:path`.
- If ensure is already pending, subsequent actions await the same promise.
- `Starting` should be visible in UI if user opens Language Settings during pending startup.
- Interactive actions use existing short LSP request timeout behavior after readiness is established.
- Ensure command should avoid holding the manager lock across long frontend work; Rust transport operations currently happen inside manager methods, so this needs careful review while implementing.
- Hover should use debounce and should not repeatedly start/stop servers.

---

## 9. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| First action is slower because it starts server | Medium | Show `Starting...`; keep server alive while documents remain open |
| Hover starts server unintentionally | Medium | Debounce; no toast; optional future setting if noisy |
| Existing tests expect `Stopped` | Low | Update tests to new `Idle` semantic |
| Missing command detection is only known on spawn | Medium | Return `MissingCommand` from ensure and show command name |
| Duplicate didOpen/didChange | High | Preserve existing version/content comparison tests |
| Race between typing and action | High | Ensure uses current tab content at action time and dedupes per path |

---

## 10. Review Decisions

請 review 這些決策點:

1. 是否同意新增 `Idle` 並保留 `Stopped` 只表示「曾啟動後停止」?
2. 是否同意 `hoverAt` 也走 ensure,也就是第一次 hover 可能啟動 server?
3. 是否要在這輪加入 optional setting `Auto-start detected language servers`?建議不加入。
4. 是否同意 `lsp_open_document` 保留相容 wrapper,新功能走 `lsp_ensure_document`?
5. 是否要顯示 per-document readiness,還是先只在 Language Settings 顯示 server lifecycle?

---

## 11. Acceptance Criteria

- Fresh workspace with TypeScript files shows TypeScript as `Idle`, not misleading `Stopped`.
- First explicit LSP action on `.ts` file starts and syncs TypeScript server before sending request.
- If `typescript-language-server` is missing, user sees `Missing command: typescript-language-server`.
- Unsupported files do not spawn servers and do not produce noisy passive hover errors.
- Live edited content is synchronized through ensure before definition/reference/rename/code actions.
- Tests cover Idle, Ready, MissingCommand, Unsupported, stale-content didChange, and action-before-open.
