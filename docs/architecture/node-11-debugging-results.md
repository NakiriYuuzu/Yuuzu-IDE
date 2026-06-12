# Node 11 Debugging Results

## Status

Completed and passed.

Node 11 implementation Tasks 1-7 are delivered. Fresh verification on
2026-06-12 confirms both real adapter smoke tests pass: Python through
`debugpy` and compiled C through Xcode's `lldb-dap`.

The final regression fixes are `f9aa1af`, `353d965`, and `2533c67`.
`f9aa1af` preserves variables from real DAP captures when adapters reuse raw
`variablesReference` handles across stack frames, which was observed with
`lldb-dap` frame 524288 `main` and frame 524289 `start` both exposing Locals as
raw reference `1`. `353d965` then fixed the AppShell stopped-event path so real
stopped sessions load stack frames, scopes, and variables into DebugPanel state
instead of depending on test pre-seeded variables. `2533c67` replaced
session-scoped stack/scope/variable snapshots on stopped refreshes so failed or
missing variable loads cannot leave older locals visible as live data.

## Scope Delivered

- Rust debug domain with launch configuration storage, DAP framing, source path
  normalization, workspace-scoped breakpoints, and session state.
- Rust DAP runtime and Tauri commands for launch configs, session lifecycle,
  breakpoint synchronization, stack frames, variables, watches, evaluation, and
  bounded debug logs.
- Frontend debug model, API wrappers, session event handling, launch config
  selection, breakpoints, stack/variable/watch state, and bounded console state.
- Debug panel, debug console surface, editor breakpoint gutter affordances, and
  active debug line decoration.
- AppShell integration through the activity rail, command palette, workspace
  view state, editor surface, debug console surface, backend listener wiring,
  live stopped-event stack/scope/variable hydration, and session snapshot
  replacement for refreshed debug variables.
- Real adapter smoke fixtures for compiled C through `lldb-dap` and Python
  through `debugpy`.

## TDD Evidence

### Task 1: Rust debug domain, DAP framing, and launch config store

- RED command: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml debug::tests`.
- RED result: failed before the debug module and public debug types existed.
- GREEN command: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml debug::tests`.
- GREEN result: passed after debug config storage, DAP framing, source path
  normalization, and workspace-scoped breakpoints were implemented.
- REFACTOR command: `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`.
- Commit evidence: `e06668a`, with post-review hardening in `b9fb230` and
  `d5da874`.

### Task 2: Rust DAP runtime and Tauri commands

- RED command: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml debug::runtime_tests`.
- RED result: failed before debug runtime session behavior and command wiring
  existed.
- GREEN command: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml debug::runtime_tests commands::tests::debug`.
- GREEN result: passed after runtime events, launch/start/continue/step/pause/
  disconnect commands, stack/variable/watch commands, and event sinks were added.
- REFACTOR command: `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`.
- Commit evidence: `086eece`, with post-review hardening in `fad25b7` and
  `55273a7`.

### Task 3: Frontend debug model and API

- RED command: `bun test src/features/debug/debug-model.test.ts`.
- RED result: failed before the debug frontend model existed.
- GREEN command: `bun test src/features/debug/debug-model.test.ts`.
- GREEN result: passed after launch config, session, breakpoint, stack,
  variable, watch, console, and stale-event reducers were implemented.
- REFACTOR command: `bun run build`.
- Commit evidence: `3d45103`, with ignored-session and state hardening in
  `cb2e327` and `efa33a0`.

### Task 4: Debug panel, console surface, and editor breakpoints

- RED command: `bun test src/features/debug/DebugPanel.test.tsx src/features/debug/debug-model.test.ts src/features/editor/EditorTab.test.ts`.
- RED result: failed before the Debug panel, console surface, and editor
  breakpoint helpers existed.
- GREEN command: `bun test src/features/debug/DebugPanel.test.tsx src/features/debug/debug-model.test.ts src/features/editor/EditorTab.test.ts`.
- GREEN result: passed after panel controls, console rendering, breakpoint
  toggles, and Monaco decorations were implemented.
- REFACTOR command: `bun run build`.
- Commit evidence: `a00617e`, with panel action hardening in `ef2287c`.

### Task 5: AppShell debug integration

- RED command: `bun test src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx`.
- RED result: failed before the debug rail entry, command palette actions,
  workspace debug state, AppShell routing, and backend listeners were wired.
- GREEN command: `bun test src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx`.
- GREEN result: passed after workspace-scoped debug panel routing, command
  dispatch, listener handling, active-session preservation, and debug console
  surface integration were implemented.
- REFACTOR command: `bun run build`.
- Commit evidence: `9661369`, with shell integration hardening in `2500b61`
  and `268f742`.

### Task 6: Real adapter smoke and hardening

- RED command: `. "$HOME/.cargo/env" && YUZZU_DEBUG_SMOKE=1 cargo test --manifest-path src-tauri/Cargo.toml debug::adapter_smoke_tests -- --ignored --test-threads=1`.
- RED result: failed before the real adapter smoke fixtures and client were
  added.
- GREEN command: same command.
- GREEN result for Task 6 implementation: passed in task-level evidence before
  final verification hardening continued.
- Final Task 7 follow-up result: the same command now passes both `debugpy` and
  `lldb-dap` after the duplicate raw `variablesReference` regression fix.
- REFACTOR command: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml debug::real_adapter::tests debug::adapter_smoke_tests -- --ignored --test-threads=1`.
- Commit evidence: `1af3aa9`, with real adapter client and launch hardening in
  `d46b6f3` and `f6f8599`.

### Task 7: Final verification, smoke regression, and documentation

- RED command: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml debug::real_adapter::tests::real_dap_launch_keeps_duplicate_scope_references_per_frame -- --exact --nocapture`.
- RED result: failed with `main frame Locals should keep counter even when a
  later frame reuses raw variablesReference`, proving later frame variables
  overwrote the main frame Locals capture.
- GREEN command: same focused cargo test command.
- GREEN result: passed with 1 test after real DAP scope variables were
  materialized with session-unique synthetic references per frame scope.
- Smoke command: `. "$HOME/.cargo/env" && YUZZU_DEBUG_SMOKE=1 cargo test --manifest-path src-tauri/Cargo.toml debug::adapter_smoke_tests -- --ignored --test-threads=1`.
- Smoke result: passed with 2 tests; both `debugpy` and `lldb-dap` reached their
  fixture breakpoints and returned `counter = 3`.
- Commit evidence: `f9aa1af`.

### Completion follow-up: AppShell live variables on stopped events

- RED command: `bun test src/app/AppShell.contract.test.tsx`.
- RED result: failed with two failing AppShell checks because the stopped
  listener loaded stack frames but never called `debug_scopes` or
  `debug_variables`.
- GREEN command: `bun test src/app/AppShell.contract.test.tsx`.
- GREEN result: passed with 52 tests after AppShell loaded scopes and nonzero
  variable references for stopped stack frames, and ignored stale variable loads
  after newer session sequences.
- Focused regression command: `bun test src/features/debug/debug-model.test.ts src/features/debug/DebugPanel.test.tsx src/features/editor/EditorTab.test.ts src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx`.
- Focused regression result: passed with 126 tests and 399 expect calls.
- Commit evidence: `353d965`.

### Completion follow-up: replace AppShell variable snapshots

- RED command: `bun test src/app/AppShell.contract.test.tsx`.
- RED result: failed because a newer stopped refresh with a failed variable
  request left the older `staleCounter` scope and variables in the session
  state.
- GREEN command: `bun test src/app/AppShell.contract.test.tsx`.
- GREEN result: passed with 53 tests and 208 expect calls after AppShell
  replaced the session stack/scope/variable snapshot for stopped refreshes.
- Focused regression command: `bun test src/features/debug/debug-model.test.ts src/features/debug/DebugPanel.test.tsx src/features/editor/EditorTab.test.ts src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx`.
- Focused regression result: passed with 127 tests and 405 expect calls.
- Build command: `bun run build`.
- Build result: passed with Vite chunk-size warnings only.
- Smoke command: `. "$HOME/.cargo/env" && YUZZU_DEBUG_SMOKE=1 cargo test --manifest-path src-tauri/Cargo.toml debug::adapter_smoke_tests -- --ignored --test-threads=1`.
- Smoke result: passed with 2 tests and 0 failed.
- Commit evidence: `2533c67`.

## Agent Review Evidence

- Task 1 review remediation is represented by `b9fb230` and `d5da874`.
- Task 2 review remediation is represented by `fad25b7` and `55273a7`.
- Task 3 review remediation is represented by `cb2e327` and `efa33a0`.
- Task 4 review remediation is represented by `ef2287c`.
- Task 5 review remediation is represented by `2500b61` and `268f742`.
- Task 6 review remediation is represented by `d46b6f3` and `f6f8599`.
- Task 7 duplicate-reference smoke regression remediation is represented by
  `f9aa1af`.
- Completion follow-up for the AppShell stopped-event live variables path is
  represented by `353d965`.
- Completion follow-up for replacing stale session variable snapshots is
  represented by `2533c67`.
- Task dispatch required `gpt-5.5` with `xhigh` reasoning and prohibited
  `gpt-5.4`; no repository evidence records a `gpt-5.4` Node 11 agent.

## Full Verification Evidence

- `bun test` -> PASS: 338 passed, 0 failed, 964 expect calls across 38 files.
- `bun run build` -> PASS: `tsc && vite build`, 3277 modules transformed,
  built successfully; Vite chunk-size warnings only.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml`
  -> PASS: lib target 285 passed, 0 failed, 3 ignored, plus main and doc-test
  targets with no runnable tests.
- `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  -> PASS.
- `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  -> PASS: finished `dev` profile with no warnings.
- `bun run tauri build --debug` -> PASS: frontend before-build completed with
  Vite chunk-size warnings only, Rust `dev` profile finished, and
  debug artifacts were produced:
  - `src-tauri/target/debug/yuuzu-ide`
  - `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app`
  - `src-tauri/target/debug/bundle/dmg/Yuuzu-IDE_0.1.0_aarch64.dmg`
- `. "$HOME/.cargo/env" && YUZZU_DEBUG_SMOKE=1 cargo test --manifest-path src-tauri/Cargo.toml debug::adapter_smoke_tests -- --ignored --test-threads=1`
  -> PASS: `debugpy_debugs_python_fixture_to_breakpoint` and
  `lldb_dap_debugs_compiled_c_fixture_to_breakpoint` both passed; 2 passed, 0
  failed.

## Real Adapter Smoke Evidence

- `debugpy`: PASS. The ignored smoke test
  `debug::adapter_smoke_tests::debugpy_debugs_python_fixture_to_breakpoint`
  launched the Python fixture through `uv run --with debugpy python -m
  debugpy.adapter` and reached the breakpoint.
- `lldb-dap`: PASS. The ignored smoke test
  `debug::adapter_smoke_tests::lldb_dap_debugs_compiled_c_fixture_to_breakpoint`
  found Xcode's `lldb-dap`, compiled the C fixture, reached the breakpoint at
  `fixtures/debug/compiled-main.c` line 6, and returned `counter = 3` from the
  main frame Locals scope.

## Acceptance Results

- At least one scripting language can be debugged: PASS through the real
  `debugpy` smoke.
- At least one compiled language can be debugged: PASS through the real
  `lldb-dap` smoke.
- Breakpoints work in the editor: PASS through frontend breakpoint tests,
  AppShell command routing tests, Rust breakpoint storage tests, and the
  real adapter smoke tests reaching fixture breakpoints.
- Variables work in the editor: PASS through Rust scripted-adapter runtime
  tests, frontend debug model tests, Debug panel rendering tests, AppShell
  stopped-event live variable contract tests, AppShell stale-snapshot
  replacement tests, and the real `lldb-dap` smoke returning `counter = 3`.
- Debug sessions are scoped to workspaces: PASS through Rust command/workspace
  guard tests, frontend workspace view state tests, and AppShell event routing
  tests.

Overall acceptance is complete.

## Residual Risks

- The real adapter smoke covers C through `lldb-dap` and Python through
  `debugpy`; other adapters remain future compatibility work.
- Debug adapter lifecycle tests use bounded scripted adapters for most command
  and event behavior, so real-adapter protocol variance may still require
  adapter-specific handling in later nodes. The duplicate raw
  `variablesReference` case now has fast regression coverage plus real
  `lldb-dap` smoke coverage.
- Vite chunk-size warnings remain expected because Monaco, language workers, and
  terminal assets are large; the build exits successfully.
