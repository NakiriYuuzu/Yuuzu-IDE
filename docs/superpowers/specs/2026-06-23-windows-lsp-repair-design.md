# Windows LSP Repair — 設計規格

> 🟡 **實作狀態:Draft / 待 review** — 本文件只定義 issue #11 的修復規格,尚未修改產品程式碼。

- 日期:2026-06-23
- GitHub issue:[#11 Windows LSP 在 Windows 完全不可用](https://github.com/NakiriYuuzu/Yuuzu-IDE/issues/11)
- 任務類型:`bugfix` + `ui-runtime`
- 範圍:修正 Windows packaged app 中 LSP 無法啟動或無法完成 document sync / diagnostics 的平台問題。
- 主要原則:先讓失敗原因可觀測,再修正 Windows URI 與 command resolution;不把這次工作擴大成新的 LSP feature 或自動安裝器。

---

## 1. 問題背景

Issue #11 指向 Windows packaged app 中 LSP 完全不可用。根據目前 `main` 的實作狀態,前端 readiness 與 Settings 顯示已有部分基礎:

- `lsp_ensure_document` 已存在並已註冊。
- `ServerState::Idle` / `MissingCommand` / `Error` 已進入模型。
- Language Settings 已顯示 server command、狀態、install hint、diagnostics 與 server logs。
- 前端 `relativePathFromUri(...)` 已能處理 `file:///C:/...` 形式。

剩餘風險集中在 Rust/Tauri LSP runtime 的 Windows-only 行為:

1. `as_file_uri(...)` 目前用 `file://{encoded_path}` 組 URI,Windows drive path 可能被輸出成 `file://C%3A/...`,而不是 LSP 常見的 `file:///C:/...`。
2. `relative_path_from_uri(...)` 後端 decoder 未處理 Windows drive URI 正規化與大小寫比較。
3. `lsp_child_path_env(...)` 只補 macOS/Unix 常見 user bin,Windows GUI launch 可能缺少 npm、Bun、Cargo、Python Scripts 等位置。
4. `resolve_lsp_command_path_with_path(...)` 只找 exact filename,未依 Windows `PATHEXT` 嘗試 `.exe` / `.cmd` / `.bat`。
5. `StdioTransport` 未 capture stderr,Settings logs 無法呈現 language server 啟動後立即失敗的 stderr。

---

## 2. Goals

- Windows drive path 產生合法 file URI:`file:///C:/workspace/app/src/main.ts`。
- 後端可把 Windows file URI 安全轉回 workspace-relative path,且拒絕 sibling root / `..` escape。
- Windows packaged app 能找到常見 language server wrapper:
  - `typescript-language-server.cmd`
  - `rust-analyzer.exe`
  - `pylsp.exe` 或 Python Scripts 中的 wrapper
  - `uv.exe` for uv-backed Python workspace
- Language Settings / logs 能顯示:
  - configured command
  - resolved executable path 或 unresolved command
  - spawn error
  - last stderr/log excerpt
- Windows 上至少一個 `.ts` 或 `.rs` workspace 可 open document 並取得 diagnostics。

## 3. Non-goals

- 不自動安裝 language servers。
- 不改變現有 lazy-start / document readiness contract。
- 不重寫 LSP protocol transport。
- 不把所有 detected languages 在 workspace open 時預先啟動。
- 不把 Windows smoke 結果當成 macOS/Linux 通過的替代品。

---

## 4. Proposed Changes

### 4.1 Windows file URI helper

新增或重寫 `src-tauri/src/lsp.rs` 內的 URI helper,讓它明確區分 Unix absolute path 與 Windows drive path。

Target behavior:

| Input | Output |
| --- | --- |
| root `/workspace root`, path `src/main file.rs` | `file:///workspace%20root/src/main%20file.rs` |
| root `C:\workspace\app`, path `src\main.ts` | `file:///C:/workspace/app/src/main.ts` |
| root `c:\workspace\app`, path `src/a b.ts` | `file:///c:/workspace/app/src/a%20b.ts` |

Encoding rule:

- path separators normalize to `/` before encoding。
- Drive colon after the first drive letter must remain literal in the URI path (`C:`), not `%3A`。
- Other reserved characters still use percent encoding。
- UNC path support can be conservative: either support `file://server/share/...` with tests, or explicitly reject/leave out of scope for this bugfix. The implementation must document whichever choice is made.

### 4.2 Backend URI decoder

`relative_path_from_uri(workspace_root, uri)` should match frontend behavior:

- accept `file:///C:/workspace/app/src/a.ts` for root `C:\workspace\app`;
- compare drive-letter roots case-insensitively;
- strip the leading slash before `C:` only for Windows drive URI forms;
- reject invalid percent encoding;
- reject sibling roots such as `file:///C:/workspace/app2/src/a.ts`;
- reject traversal after decoding, including `%2e%2e` segments.

This decoder is required because diagnostics can arrive from server-published URIs, not only from frontend-originated paths.

### 4.3 Windows PATH augmentation

Extend `lsp_child_path_env(...)` so Windows GUI launch receives expected user tool directories without mutating global environment.

Candidate directories:

| Source | Directories |
| --- | --- |
| `USERPROFILE` | `.cargo\bin`, `.bun\bin`, `.local\bin` |
| `APPDATA` | `npm`, `Python\Scripts` if present |
| `LOCALAPPDATA` | `Programs\Python\Python*\Scripts`, `Microsoft\WinGet\Packages` only if already present |
| existing `PATH` | preserve all existing entries first |

Keep this helper deterministic and testable by adding an injected-env helper for tests, rather than reading process env directly inside every branch.

### 4.4 Windows command resolution

Update `resolve_lsp_command_path_with_path(...)` to resolve wrapper extensions on Windows:

1. If the command contains a path separator, return it as explicit input.
2. If the command already has an extension, search exact name.
3. On Windows, read `PATHEXT` or default to `.COM;.EXE;.BAT;.CMD`.
4. Search each directory for exact name plus extensions in `PATHEXT` order.
5. Return resolved path for logs/status; if unresolved, keep the original command so `Command::new(...)` reports a real spawn error.

Expected examples:

- `typescript-language-server` resolves to `typescript-language-server.cmd` in npm global bin.
- `rust-analyzer` resolves to `rust-analyzer.exe` in Cargo bin.
- `uv` resolves to `uv.exe` when Python profile uses uv.

### 4.5 Transport diagnostics and logs

Extend `LanguageServerStatus` or server logs with runtime diagnostic fields without breaking existing frontend callers:

- `resolved_command_path: Option<String>`
- `last_spawn_error: Option<String>` or reuse `last_error` with a more precise message
- `last_stderr: Option<String>` or append stderr excerpts to `server_logs`

Implementation constraints:

- Capture stderr with a bounded reader thread; keep only the last N KB or last N lines.
- Do not log document content, secrets, environment variable values, or full PATH.
- Include command and resolved executable path, but redact arguments only if they could contain user content. Current LSP args are safe enough to show command names and subcommands.
- Keep log retention bounded like existing workspace logs.

Language Settings can keep the existing layout, but must surface the new details where users can see them. A minimal acceptable UI is adding meta rows under each server plus preserving `SERVER LOGS`.

---

## 5. Testing Strategy

### Rust focused tests

Add focused tests in `src-tauri/src/lsp.rs`:

- `file_uri_helpers_support_windows_drive_paths`
- `relative_path_from_uri_supports_windows_drive_paths`
- `relative_path_from_uri_rejects_windows_sibling_and_traversal`
- `lsp_command_path_env_adds_windows_user_tool_dirs`
- `resolve_lsp_command_path_uses_windows_pathext`
- `transport_records_spawn_error_and_resolved_path`

Windows-only behaviors can be tested with pure string/path helpers on macOS where possible. Any behavior that depends on `std::env::split_paths` Windows semantics or `Command::new` wrapper behavior still needs Windows runner coverage.

### Frontend focused tests

Only add frontend tests if the UI model changes:

- `src/v2/Overlays.test.tsx`: Language Settings renders resolved path and stderr/log excerpt.
- `src/features/language/language-api.test.ts`: new optional fields are tolerated.

Do not duplicate already-covered frontend `relativePathFromUri(...)` tests unless the wire contract changes.

### Windows smoke

Required before closing issue #11:

1. Build or run packaged Windows app.
2. Open a workspace containing either:
   - TypeScript file with `typescript-language-server` installed, or
   - Rust file with `rust-analyzer` installed.
3. Open supported file.
4. Confirm Language Settings shows `Running` or actionable `MissingCommand`.
5. Confirm diagnostics arrive for at least one `.ts` or `.rs` file.
6. Confirm failure case shows command, resolved path or unresolved command, spawn error, and last stderr/log.

If a Windows runner is unavailable, the implementation may merge only after marking the issue with explicit "Windows manual verification pending" evidence and keeping acceptance unchecked.

---

## 6. Acceptance Criteria

- [ ] Rust helper generates `file:///C:/...` for Windows drive paths and preserves existing Unix behavior.
- [ ] Backend URI decoder maps Windows file URIs back to workspace-relative paths and rejects escape/sibling cases.
- [ ] Windows PATH augmentation covers npm/Bun/Cargo/Python Scripts user install locations without replacing existing PATH.
- [ ] Windows command resolution supports `.exe` / `.cmd` / `.bat` via `PATHEXT`.
- [ ] Language Settings/logs show command, resolved path or unresolved command, spawn error, and last stderr/log excerpt.
- [ ] Focused Rust tests cover URI, PATH, command resolution, and diagnostics logging behavior.
- [ ] Frontend tests cover any new visible fields if the UI changes.
- [ ] Windows smoke demonstrates diagnostics for at least one `.ts` or `.rs` workspace.

---

## 7. Suggested Implementation Order

1. Add failing Rust helper tests for Windows URI encode/decode.
2. Implement URI encode/decode helpers.
3. Add failing Rust tests for Windows PATH and `PATHEXT` command resolution.
4. Implement Windows PATH augmentation and command resolution.
5. Add transport diagnostic fields/log capture tests.
6. Implement bounded stderr capture and status/log propagation.
7. Add minimal UI rendering for new diagnostics only if the existing Language Settings does not expose them clearly.
8. Run focused tests, then broader Rust/frontend gates based on touched files.
9. Run Windows packaged-app smoke and record evidence.

---

## 8. Verification Gate

Minimum local gate for implementation PR:

```bash
bun test src/v2/Overlays.test.tsx src/features/language/language-api.test.ts
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml lsp
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

Because the bug is Windows packaged-app behavior, final closure also needs Windows evidence:

```text
Windows packaged app smoke:
- app launches
- opens workspace
- opens supported `.ts` or `.rs`
- server state becomes Running or actionable MissingCommand
- diagnostics render or failure logs include command/resolved path/spawn error/stderr
```
