# Node 3 Terminal Results

## Scope

- Integrated terminal panel.
- Multiple terminal sessions per workspace.
- Terminal working-directory controls.
- Terminal restart and close controls.
- Task registry and task run history.
- Detection for package scripts, Cargo tasks, and uv Python entrypoint.
- Run, stop, rerun, and output viewing for workspace tasks.
- Basic problem matcher for Rust and TypeScript diagnostic lines.

## Verification

| Command | Result |
| --- | --- |
| `bun test` | PASS: 71 tests, 0 failed |
| `bun run build` | PASS: exit 0; Vite chunk-size warning only |
| `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml` | PASS: 88 Rust lib tests, 0 failed |
| `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check` | PASS |
| `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | PASS |
| `. "$HOME/.cargo/env" && bun run tauri build --debug` | PASS: built debug app and debug DMG |
| `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml terminal` | PASS: 8 focused tests, 0 failed |
| `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml tasks` | PASS: 11 focused tests, 0 failed |
| `bun test src/features/terminal/terminal-model.test.ts src/features/terminal/terminal-lifecycle.test.ts src/features/tasks/problem-matcher.test.ts src/features/tasks/task-model.test.ts` | PASS: 23 focused frontend tests, 0 failed |

Build artifacts:

- Debug app:
  `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app`
- Debug DMG:
  `src-tauri/target/debug/bundle/dmg/Yuuzu-IDE_0.1.0_aarch64.dmg`

## Smoke Evidence

Browser smoke used `http://127.0.0.1:1420/` with Playwright CLI against the
Vite dev server. Normal browser execution does not provide Tauri IPC, so the
browser smoke verifies web shell and panel rendering only. Rust tests and
command-level process probes provide the terminal/task runtime evidence.

| Flow | Evidence |
| --- | --- |
| Shell renders | Playwright snapshot found titlebar, activity rail, Explorer panel, status bar task/problem counters, and main workspace shell. |
| Tasks panel renders | Playwright snapshot found custom command input, Run button, Detected, History, Output, and problem count. |
| Terminal panel renders | Playwright snapshot found working-directory input, New button, Terminals count, and Start terminal button. |
| Layout sanity | Browser eval checked 22 visible buttons, inputs, badges, and rows; no visible control was under 8 px in either dimension. |
| xterm lazy loading | Browser resource eval loaded terminal model/API/panel modules but no `TerminalTab`, `load-xterm`, or `xterm` runtime before a real terminal session existed. |
| Runtime lifecycle | Focused Rust tests covered terminal IDs, close/list behavior, PTY size clamps, exited-session cleanup, write-lock release, rollback cleanup, task detection, task stop, process group targeting, stop/finish race handling, and failed-stop rollback. |

Playwright artifacts were written under `.playwright-cli/` during the smoke run.

## Measurements

Desktop WebView automation was unavailable for direct Tauri IPC interaction, so
the runtime measurements below are command-level proxies paired with focused
Rust tests for the actual terminal and task state machines.

| Measurement | Result | Pass Target |
| --- | ---: | ---: |
| Terminal spawn proxy via PTY command | 3 ms | under 300 ms |
| Terminal first output proxy via shell command | 7 ms | responsive |
| Two terminal-like shell RSS proxy | 2.3 MB | measured and acceptable |
| Task detection focused Rust test | 233 ms | responsive |
| Short task run proxy (`printf task-ok`) | 7 ms | responsive |
| Task stop proxy (`sleep 30` process group) | under 1 ms | responsive |
| xterm lazy loading | no `TerminalTab`/xterm before a session exists | stays outside initial shell |
| Terminal process cleanup | passed | no orphan `sleep 30` process |

## TDD And Review Evidence

- Task 1 used focused Rust RED/GREEN cycles for terminal metadata, session
  listing/close, PTY size clamps, process cleanup, and command signatures.
- Task 2 used Bun RED/GREEN cycles for terminal frontend API and per-workspace
  terminal view state.
- Task 3 used Bun RED/GREEN cycles for live xterm lifecycle cleanup, terminal
  session output, close/restart behavior, pending output/exit buffering, and
  ignored events after local close.
- Task 4 used Rust RED/GREEN cycles for task detection, run registry, shell
  command execution, process group stop behavior, stopped-run event suppression,
  fast-exit handling, stop/finish race handling, and failed-stop rollback.
- Task 5 used Bun RED/GREEN cycles for problem matching, task state, command
  palette commands, workspace task state, restored task history ordering, and
  per-workspace task errors.
- Each implementation slice received subagent implementer, spec-compliance
  reviewer, and code-quality reviewer coverage. Follow-up fixes were committed
  for terminal lifecycle hardening, task stop lifecycle races, task history
  ordering, and workspace-scoped task errors.

## Residual Risks

- Browser smoke cannot exercise real Tauri terminal/task IPC outside the desktop
  WebView. Runtime confidence comes from Rust command tests, frontend state
  tests, debug app build, and command-level process proxies.
- Vite still emits chunk-size warnings because Monaco workers remain large.
  Node 3 accepts this because builds exit 0 and terminal/editor heavy surfaces
  remain lazy-loaded.
- Task problem matching reparses bounded output on each append. The reviewer
  accepted this as non-blocking because output is capped at 120,000 characters
  and problem results are capped at 100.

## Result

Node 3 passes with integrated terminal and task-runner foundations in place:
workspaces have independent terminal/task state, terminal and task lifecycle
logic is covered by Rust tests, task history is restored newest/running-first,
task errors are scoped by workspace, and measured process cleanup has no
leftover long-running task process.
