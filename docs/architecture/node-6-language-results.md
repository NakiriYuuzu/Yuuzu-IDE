# Node 6 Language Results

## Scope

- Rust-owned Language Server Protocol (LSP) baseline for Rust,
  TypeScript, JavaScript, and Python with stdio JSON-RPC transport, server
  profiles, workspace-root scoping, diagnostics cache, server logs, restart
  control, and memory sampling.
- LSP document lifecycle support for `didOpen`, full-document `didChange`,
  `didClose`, idle stop, restart replay, crash recovery, and explicit
  replay-failure error state.
- Provider command surface for hover, definition, references, completion, code
  actions, rename, and workspace symbols, routed through trusted workspace
  commands with lazy recovery for stopped servers.
- Frontend language state model, command wrappers, diagnostics refresh
  lifecycle, language panel, activity-rail/status-bar summaries, and Monaco
  diagnostics/provider wiring.
- Runtime controls and memory reporting so unsupported documents stay off by
  default, supported documents start only the needed server, and stale
  workspace data does not leak across roots.

## Verification

| Command | Result |
| --- | --- |
| `bun test` | PASS: 145 tests, 0 failed, 293 expect calls across 24 files |
| `bun run build` | PASS: `tsc && vite build`; Vite chunk-size warning only |
| `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml` | PASS: 153 Rust tests, 0 failed, 1 ignored; doc tests 0 |
| `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml lsp::tests -- --nocapture` | PASS: 36 LSP tests, 0 failed, 1 ignored |
| `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml lsp::tests::real_language_servers_open_baseline_documents -- --ignored --exact --nocapture` | PASS: real Rust, TypeScript, JavaScript, and Python stdio LSP smoke; external pylsp/rust-analyzer warnings only |
| `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check` | PASS |
| `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | PASS |
| `git diff --check` | PASS |
| `. "$HOME/.cargo/env" && bun run tauri build --debug` | PASS: app and DMG debug bundles produced |

## Smoke Evidence

- The ignored real-language-server smoke creates a temporary workspace and opens
  baseline Rust (`src/main.rs`), TypeScript (`src/app.ts`), JavaScript
  (`src/app.js`), and Python (`app.py`) documents through real stdio language
  server processes.
- The smoke confirms each opened document reports the expected `LanguageId`,
  transitions to `Running`, and exposes a process ID before closing documents
  and stopping servers.
- Installed runtime used by the smoke:
  - `rustc 1.96.0`
  - `rust-analyzer 1.96.0`
  - `typescript-language-server 5.3.0`
  - `typescript 6.0.3`
  - `pylsp 1.14.0`
- External warnings observed during the smoke are environmental, not app
  failures: `pylsp` emits a Python 3.14t `ujson` GIL warning, and
  `rust-analyzer` emits missing user-config notify warnings for
  `~/Library/Application Support/rust-analyzer/rust-analyzer.toml`.
- Earlier Chromium smoke with Tauri IPC mocks verified the Language panel,
  diagnostics row, status count, restart control, logs, and responsive
  containment. This remains useful UI evidence but is not used as native LSP
  process proof.

## Measurements

- Debug app artifact:
  `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app`.
- Debug DMG artifact:
  `src-tauri/target/debug/bundle/dmg/Yuuzu-IDE_0.1.0_aarch64.dmg`.
- `metrics::process_memory_bytes(pid)` is tested against the current process
  and used when a running server exposes a PID.
- Memory visibility is covered by tests showing running servers expose memory
  bytes and stopped or swept servers do not expose stale memory.
- Lazy startup behavior is covered by tests showing unsupported documents do
  not start LSP servers, supported documents start only their language server,
  server statuses are scoped by workspace root, and idle sweeps stop old
  servers.
- Request-loop behavior is covered by tests for LSP frame decoding, unrelated
  events, server-to-client request responses, numeric and string JSON-RPC IDs,
  and response/request ID collision handling.

## TDD And Review Evidence

- TDD RED/GREEN cycles covered language detection and profiles, JSON-RPC
  framing, workspace command validation, diagnostics scoping, frontend language
  state, Language panel rendering, Monaco provider normalization, document
  lifecycle paths, stale async refresh guards, restart/log behavior, runtime
  root scoping, memory sampling, and stale-memory suppression.
- Corrective RED/GREEN evidence after review:
  - TypeScript language ID RED failed with TypeScript opening as
    `javascript`; GREEN maps TypeScript to `typescript` and JavaScript to
    `javascript`.
  - Real LSP smoke RED failed TypeScript startup with request timeout; GREEN
    keeps unrelated events from blocking response matching and passes the real
    Rust/TypeScript/JavaScript/Python smoke.
  - String JSON-RPC server-request RED failed because `server_request_response`
    returned `None` for `"cfg-1"`; GREEN preserves numeric and string request
    IDs in responses.
  - Provider lazy-recovery RED showed stopped servers stayed stopped behind a
    command/status gate; GREEN lets provider commands and symbols recover
    stopped servers through the manager.
- Reviewer cycles:
  - Initial docs review rejected Node 6 overclaiming because the first record
    only proved status/cache/UI scaffolding rather than real LSP behavior.
  - Corrective code reviewers rejected missing async diagnostics drain,
    incomplete `didClose`, restart replay gaps, provider pre-gating,
    CompletionList wrapping, wrong `workspace/symbol` method, URI handling,
    response ID collision, server-request handling, duplicate crash-recovery
    `didOpen`, restart replay failure state, and symbols lazy recovery.
  - Follow-up reviewers approved after fixes for stdio request handling,
    diagnostics draining, document lifecycle, restart/error state, symbols
    recovery, completion shape, URI encoding, and JSON-RPC string ID handling.
  - Final spec reviewer approved after the real smoke also covered JavaScript.

## Commit Milestones

- `fd01a89` docs: add node 6 language plan
- `b2ee5ae` feat: add lsp protocol profiles
- `ff725b8` fix: harden lsp protocol parsing
- `e0fb5a5` feat: add lsp lifecycle commands
- `91a5f11` fix: validate lsp command inputs
- `4997f83` fix: reject lsp parent paths
- `acf34fd` fix: scope lsp status by workspace root
- `85d7f32` fix: scope lsp diagnostics by workspace root
- `0035642` feat: add language frontend state
- `df76c79` fix: harden language frontend state
- `781e736` feat: add language diagnostics panel
- `9bf2d40` fix: align language panel chrome
- `a090678` fix: guard language refresh freshness
- `0a92026` feat: wire editor language providers
- `fc44db3` fix: send relative lsp document paths
- `f9b5de7` fix: harden editor language providers
- `8946590` fix: close inactive lsp documents
- `203794c` fix: align lsp document support checks
- `6634764` feat: add language server controls
- `2c5c990` fix: scope language server runtime state
- `6c603bd` fix: complete lsp transport lifecycle

## Residual Risks

- The real language-server smoke is ignored in the default Rust test suite
  because it depends on `rust-analyzer`, `typescript-language-server`, and
  `pylsp` being installed on `PATH`; it must be run explicitly before claiming
  native LSP process coverage.
- LSP requests are synchronous while the manager lock is held, so a slow
  language server can serialize other LSP operations until the 10 second request
  timeout.
- `poll_events` answers server-to-client requests but does not surface send
  failures from that background path; broken transports still surface through
  request/status operations.
- Browser smoke remains a normal Chromium page with Tauri IPC mocks, so it is
  UI evidence only and not native process proof.
- `bun run build` and Tauri build still emit Vite chunk-size warnings from
  Monaco/xterm assets; the commands exit successfully and the warning remains
  accepted for Node 6.

## Result

Node 6 is complete and passed. The language intelligence layer now has a real
stdio LSP baseline for Rust, TypeScript, JavaScript, and Python, with lazy
server lifecycle, diagnostics, editor providers, restart/log controls, memory
visibility, frontend workbench integration, review approval, and verified debug
bundles.
