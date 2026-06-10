# Yuuzu-IDE Progress

## 2026-06-09

### Node 0: Product And Architecture Foundation

Status: completed and passed.

Node 0 finished Tasks 1-10 and records the final spike measurements in
`docs/architecture/node-0-spike-results.md`. The measured Tauri 2 + React route
stays inside the launch, memory, PTY, scan, and single-main-WebView targets, so
Rust-native fallback research remains deferred.

Completed progress:

- Tasks 1-3 established the repository baseline, Tauri 2 + Vite + React +
  TypeScript scaffold, and shadcn/ui + Tailwind CSS foundation.
- Task 4 resumed after the Rust/Cargo toolchain gap was cleared and added
  Rust-owned workspace registry commands through Tauri IPC.
- Tasks 5-8 added the React workspace shell, Rust file tree scan command, lazy
  Monaco editor surface, and lazy xterm terminal surface with Rust PTY
  ownership.
- Task 9 added Node 0 measurement support and manual process guidance.
- Task 10 recorded the final measurements and next stack decision.

High-level commit milestones:

- `ff6e189` verified the initial Node 0 scaffold milestone.
- `6796e79` updated toolchains and scaffold assets after Rust/Cargo became
  available.
- `d1c6018` through `b726778` added workspace registry, workspace shell, file
  scan, lazy editor, lazy terminal, and measurement support.

Final verification evidence:

- Tauri debug launch measurement: visible shell in 391 ms, passing the under
  2000 ms target.
- Stabilized Tauri debug RSS: 125 MB for shell, one workspace, and three seeded
  portable workspaces, passing the under 180 MB and under 300 MB targets.
- Tauri WebContent process count while switching workspaces: 1, passing the
  exactly-one-main-WebView target.
- Playwright Chromium production preview RSS deltas: lazy Monaco added 57 MB;
  lazy xterm.js added 20 MB. Both heavy surfaces stay outside initial shell
  startup.
- Temporary Rust probes: `portable-pty 0.9.0` terminal startup median was 61 ms,
  passing the under 300 ms target; top-level file tree scan rounded to 1 ms,
  passing the under 100 ms small-project target.
- Documentation verification for Task 10:
  `rg -n "T[B]D|T[O]DO|F[I]XME|place[ ]holder|\| 0 (ms|MB) \|" docs/architecture/node-0-spike-results.md roadmap.md`
  has no matches, `test -f docs/architecture/node-0-spike-results.md` passes,
  and `git diff --check` passes.

Next decision:

- Continue from Node 1 using Tauri 2 + Vite + React + TypeScript as the primary
  app route, with Monaco and xterm remaining lazy-loaded and Rust owning
  workspace state, PTY, search, git, and LSP lifecycle.

### Node 1: Native App Shell And Multi-Workspace Core

Status: completed and passed.

Node 1 finished Tasks 1-7 and records the final app-shell measurements in
`docs/architecture/node-1-core-results.md`. The measured debug app stays inside
the cold-launch, physical-footprint memory, and single-main-WebContent targets.

Completed progress:

- Task 1 added Rust workspace domain methods, stable path-derived workspace
  IDs, registry sorting, and JSON persistence.
- Task 2 wired Tauri workspace commands for loading, opening, switching,
  pinning, removing, and missing-path checks.
- Task 3 added basic settings storage and persisted settings commands.
- Task 4 added typed frontend workspace IPC wrappers and registry loading
  without production fake workspace seeding.
- Task 5 added per-workspace shell view state restoration.
- Task 6 added workspace action controls, command palette shell, and
  missing-path empty/error states.
- Task 7 verified the full node, measured the debug app, and recorded the
  results.

Important files and commit milestones:

- `src-tauri/src/workspace.rs`, `src-tauri/src/workspace_store.rs`,
  `src-tauri/src/settings.rs`, `src-tauri/src/commands.rs`, and
  `src-tauri/src/lib.rs` own persisted registry/settings state and Tauri
  commands.
- `src/features/workspace/workspace-api.ts`,
  `src/app/workspace-store.ts`, `src/app/workspace-view-state.ts`,
  `src/app/workspace-switcher.tsx`, `src/app/CommandPalette.tsx`,
  `src/app/command-palette-model.ts`, `src/features/workspace/FileTreePanel.tsx`,
  `src/app/AppShell.tsx`, and `src/index.css` own the frontend workspace shell,
  command palette, and per-workspace restored view state.
- `7cbed76`, `3d0a05a`, `300153c`, `8b29acf`, `41a703e`, and `8eff2fe`
  are the implementation commit milestones leading into this documentation
  record.

Verification evidence:

- `bun test`: 19 tests passed, 0 failed, 29 expect calls across 7 files.
- `bun run build`: passed with `tsc && vite build`; Vite large chunk warnings
  only.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml`:
  passed with 25 Rust tests plus 0 main/doc tests.
- `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`:
  passed.
- `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`:
  passed.
- `. "$HOME/.cargo/env" && bun run tauri build --debug`: passed and built the
  debug app plus macOS debug app/dmg bundles.

Final measurement evidence:

- Measurement app: `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app`.
- Registry path pre-seeded for measurement:
  `~/Library/Application Support/app.yuuzu.ide/workspace-registry.json`, then
  restored or removed afterward.
- Workspace paths measured: `/Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide`,
  `/Users/yuuzu/HanaokaYuuzu/Ai`, and `/Users/yuuzu/HanaokaYuuzu`.
- Cold launch to visible shell/process-ready: 295 ms, passing the under
  2000 ms target. This uses process/WebContent readiness because direct WebView
  automation was unavailable.
- One workspace, 8s settled: 74 MB physical footprint, 206 MB process-tree RSS
  diagnostic, 1 WebContent process.
- Three workspaces, 8s settled: 74 MB physical footprint, 206 MB process-tree
  RSS diagnostic, 1 WebContent process.
- The physical footprint passes the under 180 MB one-workspace target and the
  under 300 MB three-workspace target.

Residual risks:

- Desktop automation could not directly interact with the WebView: AppleScript
  and System Events hung, and Computer Use returned `cgWindowNotFound`.
  Switching/state evidence therefore uses the lower-confidence approved path of
  pre-seeded registry contents, process measurements, and passing Rust/React
  tests.
- Process-tree RSS reports 206 MB for one workspace, above the 180 MB
  one-workspace memory target. Node 1 treats macOS physical footprint as the
  primary metric because RSS double-counts shared clean WebKit/Tauri mappings,
  but RSS should continue to be tracked as a diagnostic caveat.

### Node 2: Explorer, Files, Search, And Basic Editor

Status: completed and passed.

Node 2 finished Tasks 1-9 and records the final editor/search measurements in
`docs/architecture/node-2-editor-results.md`. The command-level probe keeps
file tree scan, small-file read/save, filename search, full-text search, and
temp-workspace file operations responsive, while the large-file guard keeps
large content out of editable buffers.

Completed progress:

- Task 1 added bounded Rust file-system commands for read, write, create,
  rename, delete, metadata/version checks, path containment, and large-file
  handling.
- Task 2 added bounded Rust workspace search for filename and full-text hits
  while respecting ignore traversal and per-file read limits.
- Task 3 added typed frontend file APIs and pure editor tab/draft state.
- Task 4 added the interactive explorer tree, nested directory scans, reveal,
  and guarded create/rename/delete flows.
- Task 5 added Monaco-backed file tabs, dirty state, draft storage, and save.
- Task 6 added find-in-file behavior and command-palette file/search commands.
- Task 7 added the search panel UI and stale-result guards.
- Task 8 added file watcher commands, external-change detection, watcher
  ownership claims, and unguessable watcher tokens.
- Task 9 recorded verification, measurements, documentation, generated Tauri
  schemas from the debug build, and the lint-only `content.len()` cleanup in
  `src-tauri/src/file_system.rs`.

Important files and commit milestones:

- `src-tauri/src/file_system.rs`, `src-tauri/src/search.rs`,
  `src-tauri/src/file_watcher.rs`, `src-tauri/src/workspace_scan.rs`,
  `src-tauri/src/commands.rs`, and `src-tauri/src/lib.rs` own the Rust
  filesystem, search, watcher, scan, and IPC surfaces.
- `src/features/files/file-api.ts`, `src/features/files/file-model.ts`,
  `src/features/files/draft-store.ts`, `src/features/files/find-model.ts`,
  `src/features/files/search-model.ts`, `src/features/editor/EditorTab.tsx`,
  `src/features/workspace/FileTreePanel.tsx`,
  `src/features/workspace/SearchPanel.tsx`, `src/app/AppShell.tsx`,
  `src/app/editor-buffer-state.ts`, `src/app/command-palette-model.ts`, and
  `src/index.css` own the frontend explorer, search, editor, tabs, drafts,
  dirty/external-change state, and command wiring.
- `4b51076` through `b273784` added and hardened bounded file-system commands.
- `e827d8f` through `ae4a6ab` added and hardened bounded workspace search.
- `74557d9` and `05ce0cb` added and hardened frontend editor file state.
- `39d6ac8`, `716b05a`, and `acfea6e` added and hardened the explorer tree and
  file operation UI state.
- `ad6f95b` and `6826936` added Monaco file editing, drafts, saves, and scoped
  editor buffer identity.
- `755984a` and `68b9051` added and stabilized find-in-file commands.
- `3fabba4` and `279773b` added and guarded the workspace search panel.
- `9a1997b`, `8e1a3d1`, `2b2e3d1`, and `2f666e6` added and hardened watcher
  external-change detection, ownership claims, and token safety.

Verification evidence:

- `bun test`: passed with 46 tests, 0 failed, and 77 expect calls across
  14 files.
- `bun run build`: passed; Vite emitted a chunk-size warning only.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml`:
  passed with 66 Rust lib tests plus 0 main/doc tests.
- `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`:
  passed.
- `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`:
  passed after the lint-only `content.as_bytes().len()` to `content.len()`
  cleanup.
- `. "$HOME/.cargo/env" && bun run tauri build --debug`: passed and built the
  debug app plus macOS debug app/dmg bundles under `src-tauri/target/debug/bundle`;
  the build regenerated `src-tauri/gen/schemas/*.json`.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml file_system`:
  passed with 15 focused file-system tests.
- `bunx playwright test node2-smoke.spec.ts --reporter=line` from
  `/tmp/yuuzu-node2-playwright`: passed with 1 mocked-preview smoke test in
  1.5s. The temporary spec injected Tauri IPC mocks and changed no repository
  files.

TDD red/green/refactor evidence summary:

- Rust file-system behavior was introduced under focused
  `cargo test --manifest-path src-tauri/Cargo.toml file_system` coverage,
  then hardened through follow-up tests for command boundaries, normalized
  containment, lexical mutation/read constraints, bounded reads, save metadata,
  and symlink-safe operations.
- Rust search behavior was introduced under focused
  `cargo test --manifest-path src-tauri/Cargo.toml search` coverage, then
  hardened through tests for bounded work, unreadable files, failed entries,
  metadata failures, skipped large files, and deterministic ordering.
- Frontend editor/file model behavior was introduced under focused Bun tests
  for `src/features/files/file-model.test.ts` and
  `src/app/workspace-view-state.test.ts`, then hardened with
  `src/features/files/draft-store.test.ts`,
  `src/app/editor-buffer-state.test.ts`, and
  `src/features/editor/EditorTab.test.ts`.
- Explorer behavior was covered by
  `bun test src/features/workspace/file-tree-model.test.ts`, including reveal
  state, stale directory results, editor cleanup after removed paths, and unsafe
  rename states.
- Find and search panel behavior were covered by
  `bun test src/features/files/find-model.test.ts`,
  `bun test src/app/command-palette-model.test.ts`, and
  `bun test src/features/files/search-model.test.ts`.
- Watcher behavior was introduced under focused
  `cargo test --manifest-path src-tauri/Cargo.toml file_watcher` coverage and
  frontend `bun test src/features/files/file-model.test.ts` coverage, then
  hardened for canonical event matching, missing versions, ownership claims,
  release behavior, and unguessable watch IDs.
- Task 9 itself is documentation and verification only, so it records the
  behavior-task evidence rather than adding a new behavior RED/GREEN cycle.

Final measurement evidence:

- Measurement probe path: `/tmp/yuuzu-node2-measure`, outside the repository.
- Probe dependency note: it directly included the repository Rust modules and
  used `ignore` 0.4.26.
- Nested file tree scan: 1 ms for 2 entries.
- Small file read: 1 ms for 49 bytes.
- Small file save: 11 ms.
- Filename search over the medium workspace: 16 ms with 1 match.
- Full-text search over the medium workspace: 12 ms with 1 match.
- Large-file open guard: `too_large=true` and `content_loaded=false`, keeping
  content out of editable Monaco buffers.
- Temp-workspace destructive file operation smoke: passed.
- Create, rename, and delete timings in the temp workspace: 1 ms each.
- Temporary preview server:
  `bun run preview -- --host 127.0.0.1 --port 4173`.
- Temporary mocked Playwright spec:
  `/tmp/yuuzu-node2-playwright/node2-smoke.spec.ts`.
- Mocked preview smoke covered app shell loading a mocked workspace, explorer
  expansion for `src`, opening `main.ts`, Monaco editor visibility, lazy editor
  chunk loading, and JS heap after file open.
- Initial editor chunk requests: 0.
- Editor chunk requests after opening the file: 4.
- Used JS heap after file open: 18 MB.
- Chromium was installed into the user Playwright cache for the temporary
  runner; repository dependencies were not modified.

Residual risks:

- Normal browser preview cannot exercise real Tauri filesystem IPC, so the
  Playwright smoke used injected mocks for UI coverage. The debug app build
  passed, and command-level tests/probes covered real file workflows.
- The 18 MB memory value is a mocked Chromium preview JS heap measurement, not
  a settled desktop Tauri app footprint value.
- Vite chunk-size warning remains during `bun run build`; it is accepted for
  Node 2 because the build exits successfully and Monaco remains lazy-loaded.

### Node 3: Integrated Terminal And Task Runner

Status: completed and passed.

Node 3 finished Tasks 1-6 and records the final terminal/task measurements in
`docs/architecture/node-3-terminal-results.md`. The node adds Rust-owned PTY and
task process lifecycles, per-workspace frontend terminal/task state, live xterm
rendering, task detection, task run/stop/rerun controls, and basic problem
matching.

Completed progress:

- Task 1 added the Rust terminal session manager, PTY process tracking, session
  metadata, command signatures, output/exit events, and cleanup tests.
- Task 2 added typed terminal frontend APIs and per-workspace terminal state.
- Task 3 added the live terminal UI, xterm lifecycle cleanup, terminal panel,
  output/exit event handling, close/restart flows, and pending event handling.
- Task 4 added Rust task detection, task run registry, process execution,
  output/finished events, stop behavior, process group termination, and
  lifecycle race hardening.
- Task 5 added typed task frontend APIs, task state, problem matcher, task
  activity rail/panel, command palette task commands, workspace-scoped task
  errors, and restored-history ordering.
- Task 6 verified the full node, recorded browser smoke, command-level runtime
  measurements, and documentation updates.

Important files and commit milestones:

- `src-tauri/src/terminal.rs`, `src-tauri/src/tasks.rs`,
  `src-tauri/src/commands.rs`, and `src-tauri/src/lib.rs` own terminal/task
  Rust lifecycle and Tauri command/event surfaces.
- `src/features/terminal/terminal-api.ts`,
  `src/features/terminal/terminal-model.ts`,
  `src/features/terminal/TerminalPanel.tsx`,
  `src/features/terminal/TerminalTab.tsx`, and
  `src/features/terminal/terminal-lifecycle.ts` own frontend terminal state,
  panels, and xterm lifecycle.
- `src/features/tasks/task-api.ts`, `src/features/tasks/task-model.ts`,
  `src/features/tasks/problem-matcher.ts`, `src/features/tasks/TaskPanel.tsx`,
  `src/app/AppShell.tsx`, `src/app/activity-rail.tsx`,
  `src/app/command-palette-model.ts`, `src/app/workspace-view-state.ts`, and
  `src/index.css` own frontend task state, task UI, command routing, and
  workspace restoration.
- `ddfeb0c`, `0a05f01`, and `0f7f168` added and hardened the terminal session
  manager.
- `5b1eba0` added terminal view state.
- `84c0fa1`, `164ad7b`, `c2ae692`, and `68e6c6c` added and hardened live
  terminal UI and event buffering.
- `93113c7`, `f2d21e4`, `78c002c`, and `34f9819` added and hardened the task
  runner process lifecycle.
- `679cc90` and `28f51eb` added the frontend task panel and hardened restored
  task history plus workspace-scoped task errors.

Verification evidence:

- `bun test`: passed with 71 tests, 0 failed, and 134 expect calls across
  17 files.
- `bun run build`: passed; Vite emitted a chunk-size warning only.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml`:
  passed with 88 Rust lib tests plus 0 main/doc tests.
- `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`:
  passed.
- `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`:
  passed.
- `. "$HOME/.cargo/env" && bun run tauri build --debug`: passed and built the
  debug app plus macOS debug app/dmg bundles under
  `src-tauri/target/debug/bundle`.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml terminal`:
  passed with 8 focused terminal tests.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml tasks`:
  passed with 11 focused task tests.
- `bun test src/features/terminal/terminal-model.test.ts src/features/terminal/terminal-lifecycle.test.ts src/features/tasks/problem-matcher.test.ts src/features/tasks/task-model.test.ts`:
  passed with 23 focused frontend terminal/task tests.
- Playwright CLI browser smoke against `http://127.0.0.1:1420/` rendered the
  shell, Tasks panel, Terminal panel, and found no undersized visible controls
  among 22 buttons, inputs, badges, and rows.

TDD red/green/refactor evidence summary:

- Terminal Rust behavior was introduced under focused
  `cargo test --manifest-path src-tauri/Cargo.toml terminal` coverage, then
  hardened for close/list semantics, PTY sizing, process cleanup, rollback, and
  command signatures.
- Terminal frontend behavior was introduced under Bun terminal model and
  lifecycle tests, then hardened for pending output/exit buffering, close
  behavior, input cleanup, and ignored events after local close.
- Task Rust behavior was introduced under focused
  `cargo test --manifest-path src-tauri/Cargo.toml tasks` coverage, then
  hardened for process group termination, stopped-run event suppression,
  fast-exit stop handling, stop/finish race handling, and failed-stop rollback.
- Task frontend behavior was introduced under Bun problem matcher, task model,
  workspace view, and command palette tests, then hardened for restored history
  ordering, numeric task suffixes, running-first history restore, and
  workspace-scoped task errors.
- Task 6 itself is documentation and verification only, so it records the
  behavior-task evidence rather than adding a new behavior RED/GREEN cycle.

Final measurement evidence:

- Debug app path:
  `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app`.
- Debug DMG path:
  `src-tauri/target/debug/bundle/dmg/Yuuzu-IDE_0.1.0_aarch64.dmg`.
- Browser smoke target: `http://127.0.0.1:1420/`.
- Terminal spawn proxy via PTY command: 3 ms.
- Terminal first output proxy via shell command: 7 ms.
- Two terminal-like shell RSS proxy: 2.3 MB.
- Task detection focused Rust test: 233 ms.
- Short task run proxy, `printf task-ok`: 7 ms.
- Task stop proxy, `sleep 30` process group: under 1 ms.
- xterm lazy-loading evidence: browser resource eval loaded terminal
  model/API/panel modules but no `TerminalTab`, `load-xterm`, or xterm runtime
  before a real terminal session existed.
- Terminal process cleanup: passed, with no orphan `sleep 30` process after the
  stop proxy.

Residual risks:

- Normal browser preview cannot exercise real Tauri terminal/task IPC outside
  the desktop WebView. Runtime confidence comes from Rust command tests,
  frontend state tests, debug app build, and command-level process proxies.
- Vite chunk-size warning remains during `bun run build`; it is accepted for
  Node 3 because the build exits successfully and Monaco/xterm remain
  lazy-loaded.
- Task problem matching reparses bounded output on append. The code-quality
  reviewer accepted this as non-blocking because task output is capped at
  120,000 characters and problem results are capped at 100.

### Node 4: Git Workflows

Status: completed and passed.

Node 4 finished Tasks 1-7 and records the final Git workflow evidence in
`docs/architecture/node-4-git-results.md`. The node adds Rust-owned Git CLI
commands, frontend Source Control state, diff and graph workbench surfaces,
Git decorations, destructive-operation confirmations, and watcher/task refresh
safeguards for the daily edit-test-commit-push loop.

Completed progress:

- Task 1 added Rust Git status and diff domain code, command wrappers, literal
  pathspec handling, deterministic rename parsing, path containment, and diff
  payload caps.
- Task 2 added stage, unstage, discard, commit, amend, stash, branch,
  fetch-pull-push, graph, reset hard, and rebase commands with exact typed
  confirmations for destructive actions.
- Task 3 added typed frontend Git APIs and pure Git view state for grouping,
  branch labels, diff cache, branch controls, graph bounds, refresh decisions,
  and decoration maps.
- Task 4 added the Source Control panel, action-state gating, commit message
  controls, branch and remote actions, staged and unstaged lists, conflict
  gating, and sidebar scrolling.
- Task 5 added Git diff and commit graph surfaces, bounded workbench containers,
  graph loading, and repository-action gating.
- Task 6 added explorer and tab Git decorations, confirmation dialog wiring,
  file watcher refresh suppression for `.git` internals, and task-finished Git
  refresh.
- Task 7 verified the full node, ran browser smoke with Tauri IPC mocks, fixed
  the narrow-screen Git surface overflow found during smoke, and recorded the
  results.

Important files and commit milestones:

- `src-tauri/src/git.rs`, `src-tauri/src/commands.rs`, and
  `src-tauri/src/lib.rs` own the Rust Git CLI domain and Tauri command surface.
- `src/features/git/git-api.ts`, `src/features/git/git-model.ts`,
  `src/features/git/GitPanel.tsx`, `src/features/git/GitDiffView.tsx`,
  `src/features/git/GitGraphView.tsx`,
  `src/features/git/git-model.test.ts`, and
  `src/features/git/git-responsive-css.test.ts` own frontend Git APIs, pure
  state, UI panels, surfaces, and responsive CSS contracts.
- `src/app/AppShell.tsx`, `src/app/activity-rail.tsx`,
  `src/app/workspace-view-state.ts`, `src/features/workspace/FileTreePanel.tsx`,
  `src/features/workspace/file-tree-model.ts`, and `src/index.css` own
  workbench wiring, badges, decorations, confirmations, layout, and refresh
  hooks.
- `b349eb7` and `4310a43` added and hardened Git status and diff core.
- `33ebf11` added Git workflow commands.
- `8efbd9f` and `0e103cc` added and aligned frontend Git state.
- `7067fd6` and `785c5c4` added and hardened the Source Control panel.
- `c91f272` and `a66353d` added and bounded Git diff and graph surfaces.
- `bedb1c9` and `328a0c1` added Git decorations and refresh safeguards.
- `a6ae8c2` fixed narrow-screen Git surface bounds found during final smoke.

Verification evidence:

- `bun test`: passed with 97 tests, 0 failed, and 183 expect calls across
  19 files.
- `bun run build`: passed; Vite emitted a chunk-size warning only.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml`:
  passed with 97 Rust lib tests plus 0 main/doc tests.
- `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`:
  passed.
- `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`:
  passed.
- `. "$HOME/.cargo/env" && bun run tauri build --debug`: passed and built the
  debug app plus macOS debug app/dmg bundles under
  `src-tauri/target/debug/bundle`.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git::tests -- --nocapture`:
  passed with 9 focused Git tests.
- `bun test src/features/git/git-responsive-css.test.ts`: passed with 1
  focused responsive CSS contract test.
- Playwright CLI browser smoke against `http://127.0.0.1:1420/` covered the
  no-repository Source Control state, mocked repository status, diff surface,
  commit graph surface, desktop layout sanity, and 390 by 844 mobile graph
  layout sanity.

TDD red/green/refactor evidence summary:

- Rust Git status and diff behavior was introduced under focused
  `cargo test --manifest-path src-tauri/Cargo.toml git::tests` coverage, then
  hardened for literal wildcard pathspec handling and deterministic
  rename/copy parsing.
- Rust Git mutation behavior was introduced under focused Git tests for stage,
  unstage, discard, commit, amend, stash, branch, fetch, pull, push, graph,
  reset hard, rebase, blank input guards, literal pathspecs, and exact
  confirmations.
- Frontend Git model behavior was introduced under Bun Git model tests for
  grouping, badge counts, branch labels, confirmation strings, diff cache,
  branch ordering, bounded graph rows, refresh decisions, and decorations.
- Source Control, diff, graph, decoration, and confirmation UI behavior was
  introduced and hardened under Bun tests plus browser smoke with Tauri IPC
  mocks.
- Final responsive behavior was introduced under
  `bun test src/features/git/git-responsive-css.test.ts`; the refined RED failed
  until the mobile toolbar rule explicitly overrode the base fixed flex basis,
  then GREEN passed after the CSS fix.

Final measurement evidence:

- Debug app path:
  `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app`.
- Debug DMG path:
  `src-tauri/target/debug/bundle/dmg/Yuuzu-IDE_0.1.0_aarch64.dmg`.
- Browser smoke target: `http://127.0.0.1:1420/`.
- Focused Rust Git tests hot shell time: 0.75 s.
- Focused Rust Git test binary runtime: 0.35 s.
- Diff payload cap: 240 KiB plus truncation marker.
- Commit graph cap: 120 commits.
- Mobile graph toolbar overflow: 0 offscreen toolbar controls after fix.
- Mobile graph table wrapper: 120 px visible width with 439 px internal scroll
  width.

Residual risks:

- Normal browser preview cannot exercise real Tauri Git IPC. Runtime confidence
  comes from Rust Git command tests, Tauri debug build, frontend state tests,
  and mocked browser UI smoke.
- Desktop WebView automation for real Git UI interaction remains unavailable in
  this environment, so the full edit-test-commit-push cycle is covered by
  command-level tests and mocked UI state rather than an end-to-end desktop
  click path.
- Vite chunk-size warning remains during `bun run build`; it is accepted for
  Node 4 because the build exits successfully and Monaco/xterm remain
  lazy-loaded.

### Node 5: Docs Context And Markdown Workflows

Status: completed and passed.

Node 5 finished Tasks 1-7 and records the final docs workflow evidence in
`docs/architecture/node-5-docs-results.md`. The node adds Rust-owned docs
indexing, docs-only search, markdown preview payloads, stale reference hints,
persisted context packs, and frontend Docs and Markdown Preview workflows for
reusing documentation as development context.

Completed progress:

- Task 1 added Rust docs index, preview, stale reference extraction, docs-only
  search, trusted path handling, symlink escape guards, and scan/read budgets.
- Task 2 added persisted context packs with workspace scoping, task run links,
  agent session links, duplicate prevention, inactive-workspace guards, and
  context pack command wrappers.
- Task 3 added typed frontend docs APIs, pure docs state, stale async-result
  guards, selected source state, context pack summaries, and per-workspace docs
  restoration.
- Task 4 added the Docs activity panel with docs index rows, stale badges,
  search results, context source controls, context pack creation, and pack
  actions.
- Task 5 added the Markdown Preview surface with rendered markdown, reference
  hints, stale reference badges, refresh behavior, and responsive reference
  badge handling.
- Task 6 linked context packs to active task runs and agent sessions, hydrated
  task context metadata from persisted context packs, scoped docs load request
  freshness by workspace, and cleared stale task badges after context pack
  deletion.
- Task 7 verified the full node, ran browser smoke with Tauri IPC mocks, fixed
  the mobile Markdown Preview toolbar overflow and a Rust clippy warning found
  during verification, and recorded the results.

Important files and commit milestones:

- `src-tauri/src/docs.rs`, `src-tauri/src/commands.rs`, and
  `src-tauri/src/lib.rs` own the Rust docs domain, context pack persistence,
  and Tauri command surface.
- `src/features/docs/docs-api.ts`, `src/features/docs/docs-model.ts`,
  `src/features/docs/DocsPanel.tsx`,
  `src/features/docs/MarkdownPreview.tsx`,
  `src/features/docs/docs-model.test.ts`, and
  `src/features/docs/docs-responsive-css.test.ts` own frontend docs APIs,
  state, UI panels, preview surface, and responsive CSS contracts.
- `src/features/tasks/task-model.ts`, `src/features/tasks/TaskPanel.tsx`,
  `src/app/workspace-view-state.ts`, `src/app/command-palette-model.ts`,
  `src/app/AppShell.tsx`, `src/app/activity-rail.tsx`, and `src/index.css`
  own task context metadata, workbench wiring, command palette docs commands,
  activity rail integration, and layout.
- `982a836` and `d0dd5cf` added and hardened docs index, preview, docs-only
  search, stale hints, and bounds.
- `9b4adf6` and `d5ae8a1` added and scoped context pack persistence and
  mutations.
- `368ea34` and `f2543c9` added and hardened frontend docs state.
- `0b58b8` and `4845f76` added and hardened the Docs panel.
- `bcb58ab`, `c43f114`, `a4f667d`, and `f3490a3` added and hardened Markdown
  Preview and responsive docs CSS.
- `4ab817e`, `335f86c`, `7139169`, and `ea20a04` added and hardened context
  pack links to task runs and agent sessions.
- `60111ca` fixed the mobile Markdown Preview toolbar overflow and Rust
  command-signature clippy warning found during final verification.

Verification evidence:

- `bun test`: passed with 124 tests, 0 failed, and 234 expect calls across
  22 files.
- `bun run build`: passed; Vite emitted a chunk-size warning only.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml`:
  passed with 111 Rust lib tests plus 0 main/doc tests.
- `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`:
  passed.
- `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`:
  passed after the lint-only command-signature type alias cleanup.
- `. "$HOME/.cargo/env" && bun run tauri build --debug`: passed and built the
  debug app plus macOS debug app/dmg bundles under
  `src-tauri/target/debug/bundle`.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml docs::tests -- --nocapture`:
  passed with 12 focused docs tests.
- `bun test src/features/docs/docs-model.test.ts src/features/tasks/task-model.test.ts`:
  passed with 29 focused docs/task metadata tests.
- `bun test src/features/docs/docs-responsive-css.test.ts`: passed with 3
  focused responsive CSS tests.
- Browser smoke against `http://127.0.0.1:1420/` covered docs index, stale
  badges, docs search, Markdown Preview, context source selection, context pack
  creation, task run metadata links, agent session metadata links, and 390 by
  844 mobile Docs and Markdown Preview containment.

TDD red/green/refactor evidence summary:

- Rust docs indexing, preview, search, stale hint, symlink guard, context pack
  persistence, and context pack link behavior were introduced and hardened under
  focused Rust tests.
- Frontend docs state, Docs panel, Markdown Preview, task context metadata, and
  command palette behavior were introduced and hardened under Bun tests and
  mocked browser UI smoke.
- Task 6 follow-up tests reproduced and fixed workspace-scoped docs load request
  races and stale task context badges after deleted packs.
- Final verification reproduced and fixed the `clippy::type_complexity` warning
  in the Rust command-signature test and the mobile Markdown Preview toolbar
  overflow found by browser smoke.

Final measurement evidence:

- Debug app path:
  `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app`.
- Debug DMG path:
  `src-tauri/target/debug/bundle/dmg/Yuuzu-IDE_0.1.0_aarch64.dmg`.
- Browser smoke target: `http://127.0.0.1:1420/`.
- Full Bun test runtime: 336 ms.
- Focused docs/task Bun runtime: 96 ms.
- Focused docs Rust test binary runtime: 0.27 s.
- Docs search smoke result: 2 matches in 2 docs.
- Context pack smoke selection: 1 selected doc path captured in
  `create_context_pack`.
- Browser smoke viewports: 1280 by 800 and 390 by 844.
- Mobile Docs panel and Markdown Preview containment: no horizontal overflow in
  their own containers after the toolbar-title fix.

Residual risks:

- Normal browser preview cannot execute real Tauri docs IPC. Runtime confidence
  comes from Rust docs command tests, Tauri debug build, frontend state tests,
  and mocked browser UI smoke.
- Desktop WebView automation for real docs UI interaction remains unavailable
  in this environment, so full native click-through confidence is covered by
  command-level tests and browser mocks rather than a real desktop WebView run.
- Vite chunk-size warning remains during `bun run build`; it is accepted for
  Node 5 because the build exits successfully and Monaco/xterm remain
  lazy-loaded.

### Node 6: Language Intelligence

Status: completed and passed.

Node 6 finished Tasks 1-7 and records the final language results in
`docs/architecture/node-6-language-results.md`. The node adds Rust-owned LSP
stdio transport, lazy lifecycle, status/log/memory/runtime surfaces, and
frontend Monaco wiring for diagnostics and provider actions.

Completed progress:

- Task 1 added LSP protocol profiles, language detection, JSON-RPC helpers,
  stdio transport, server-request handling, and language server process
  management.
- Task 2 added validated workspace-root command plumbing for document open/close,
  diagnostics, provider request, symbol, rename, restart, and log entry points.
- Task 3 added frontend language state, language API wrappers, per-workspace
  language view state, normalized document support checks, and stale async result
  guards.
- Task 4 added diagnostics panel, statusbar/rail integration, language controls,
  command-palette entries, and responsive language rows.
- Task 5 added Monaco provider hooks for hover/definition/references/completion/
  code actions/rename, relative-path document lifecycle handling, and refresh
  guards for inactive or unsupported documents.
- Task 6 added server logs, restart controls, memory reporting, browser smoke,
  root-scoped runtime state, stale-memory suppression, and corrective real LSP
  lifecycle coverage.
- Task 7 recorded verification, real language-server smoke, measurements,
  review evidence, progress, and roadmap status.

Important files and commit milestones:

- `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/lsp.rs`,
  `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, and `src-tauri/src/metrics.rs`
  own LSP process state, commands, JSON-RPC helpers, root scoping, and memory
  sampling.
- `src/features/language/language-api.ts`, `src/features/language/language-model.ts`,
  `src/features/language/language-model.test.ts`, `src/features/language/LanguagePanel.tsx`,
  `src/features/language/LanguagePanel.test.tsx`, `src/features/editor/EditorTab.tsx`,
  `src/app/workspace-view-state.ts`, `src/app/workspace-view-state.test.ts`,
  `src/app/AppShell.tsx`, `src/app/activity-rail.tsx`, `src/app/command-palette-model.ts`,
  and `src/index.css` own front-end language state, panel/workbench integration, and
  Monaco wiring.
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

Verification evidence:

- `bun test`: passed with 145 tests, 0 failed, 293 expect calls across 24 files.
- `bun run build`: passed with `tsc && vite build`; Vite chunk-size warning only.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml`:
  passed with 153 Rust tests, 0 failed, 1 ignored; 0 doc tests.
- `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`:
  passed.
- `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`:
  passed.
- `. "$HOME/.cargo/env" && bun run tauri build --debug`: passed and built macOS app and
  DMG debug artifacts.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml lsp::tests -- --nocapture`:
  passed with 36 LSP tests, 0 failed, 1 ignored.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml lsp::tests::real_language_servers_open_baseline_documents -- --ignored --exact --nocapture`:
  passed with real Rust, TypeScript, JavaScript, and Python stdio language
  servers; external pylsp/rust-analyzer warnings only.
- `git diff --check`: passed.

Smoke evidence:

- Real LSP smoke created a temporary workspace and opened Rust
  (`src/main.rs`), TypeScript (`src/app.ts`), JavaScript (`src/app.js`), and
  Python (`app.py`) documents through actual stdio language-server processes.
- The real smoke confirmed each language reached `Running`, exposed a PID, and
  closed cleanly.
- Browser smoke with Tauri IPC mocks still verifies the Language panel,
  diagnostics count, restart action, logs, and responsive row/log containment,
  but is treated as UI evidence only.

Residual risks:

- The real language-server smoke is ignored by the default Rust suite because it
  requires `rust-analyzer`, `typescript-language-server`, and `pylsp` on `PATH`.
- LSP requests are synchronous while the manager lock is held, so a slow server
  can serialize other LSP operations until the 10 second request timeout.
- Browser smoke cannot run real Tauri IPC or native LSP process interactions.
- Vite chunk-size warning is still expected in this node due lazy Monaco and
  xterm assets; Node 6 accepts it because build exits successfully.

Next decision:

- Move from language verification to Node 7 agent-workbench delivery, using the
  now-complete language telemetry, restart controls, and diagnostics surfaces for
  richer agent context.

### Node 7: Agent Workbench

Status: completed and passed.

Node 7 finished Tasks 1-7 and records the final agent-workbench results in
`docs/architecture/node-7-agent-results.md`. The node adds Rust-owned agent
session persistence, bounded context snapshots, transcript evidence, approval
state, prompt export, and a React Agent panel integrated into the existing
workbench shell.

Completed progress:

- Task 1 added Rust agent session storage, context manifests, transcript
  entries, approval state, prompt export, and flat Tauri commands.
- Task 2 added frontend agent state, session selection, prompt draft
  preservation, selected context IDs, pending approval badges, and per-workspace
  view state.
- Task 3 added bounded agent context helpers for files, docs, diffs,
  diagnostics, and terminal output, including deterministic compact IDs.
- Task 4 added the Agent panel prompt composer, mode controls, context
  selection rows, session list, transcript rendering, approval buttons, export
  action, and compact responsive styling.
- Task 5 wired Agents into the activity rail, command palette, AppShell panel
  routing, app-state context assembly, session loading, context-pack links,
  approval updates, and prompt export.
- Task 6 added verification evidence summaries in the model and Agent panel
  toolbar.
- Task 7 ran full verification, stabilized full Bun test isolation, and recorded
  Node 7 results.

Important files and commit milestones:

- `src-tauri/src/agent.rs`, `src-tauri/src/commands.rs`, and
  `src-tauri/src/lib.rs` own persisted sessions, command validation,
  transcript entries, approval updates, context bounds, and prompt export.
- `src/features/agents/agent-api.ts`, `src/features/agents/agent-model.ts`,
  `src/features/agents/AgentPanel.tsx`, and related tests own frontend API
  wrappers, state transitions, context selection, evidence summaries, and UI.
- `src/app/AppShell.tsx`, `src/app/activity-rail.tsx`,
  `src/app/command-palette-model.ts`, and `src/app/test-dom.ts` own app shell
  integration, command routing, rail badges, shared test DOM setup, and
  workbench context assembly.
- `8f653e8` docs: add node 7 agent workbench plan
- `4cd9439` feat: persist agent sessions
- `cddfbc8` feat: add agent workbench state
- `3308537` feat: assemble agent context items
- `03e6268` feat: add agent workbench panel
- `b212663` feat: wire agent workbench
- `81e9bfe` feat: show agent transcript evidence
- `eb9d4b6` fix: stabilize full test isolation

Verification evidence:

- `bun test`: passed with 178 tests, no failures, 446 expect calls across 28
  files.
- `bun run build`: passed with `tsc && vite build`; Vite chunk-size warning
  only.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml`:
  passed with 166 Rust tests, 1 ignored.
- `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`:
  passed.
- `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`:
  passed.
- `. "$HOME/.cargo/env" && bun run tauri build --debug`: passed and built
  macOS app and DMG debug artifacts.
- `git diff --check`: passed.

Residual risks:

- Node 7 records structured sessions and gates approvals; it does not execute
  fully autonomous edits.
- Export uses local browser download behavior; native save dialog integration
  remains a later enhancement.
- Full native desktop click-through automation remains outside the current
  verification loop, so confidence comes from Rust command tests, frontend
  component/state tests, and Tauri debug bundling.
- Vite chunk-size warning remains expected because Monaco, xterm, and language
  workers are large assets; Node 7 accepts it because build exits successfully.

### Node 8: Browser Preview And Local Dev Loop

Status: completed and passed.

Node 8 finished Tasks 1-5 and records final results in
`docs/architecture/node-8-browser-results.md`.

Final verification outcomes:

- `bun test`: PASS with 235 passed, 0 failed, 627 expect calls across 31 files.
- `bun run build`: PASS with `tsc && vite build`; Vite chunk-size warnings only.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml`:
  PASS with 176 Rust tests passed, 0 failed, 1 ignored, plus 0 main/doc tests.
- `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`:
  PASS.
- `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`:
  PASS.
- `. "$HOME/.cargo/env" && bun run tauri build --debug`: PASS with
  `src-tauri/target/debug/yuuzu-ide`,
  `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app`, and
  `src-tauri/target/debug/bundle/dmg/Yuuzu-IDE_0.1.0_aarch64.dmg`.
- `git diff --check`: PASS.
- `bun test src/features/browser/browser-model.test.ts src/features/browser/BrowserPanel.test.tsx src/features/browser/BrowserPreviewSurface.test.tsx src/app/AppShell.contract.test.tsx`:
  PASS with 54 passed, 0 failed, 178 expect() calls.
- Verification remediation `b382df1` fixed a full-suite test-DOM isolation issue
  in `src/features/docs/DocsPanel.test.tsx`. The reproducer command
  `bun test src/app/activity-rail.test.tsx src/features/docs/DocsPanel.test.tsx src/features/browser/BrowserPanel.test.tsx src/features/browser/BrowserPreviewSurface.test.tsx`
  passed afterward with 24 passed, 0 failed, 70 expect calls.

### Node 9: Database Tools

Status: completed and passed.

Node 9 finished Tasks 1-6 and records the final results in
`docs/architecture/node-9-database-tools-results.md`.

Key deliverables:

- Rust-owned database domain, schema inspection, query execution, bounded history,
  and CSV export through keyring-backed secrets.
- Database frontend model, commands, panel, virtualized result view, and confirmation
  workflow.
- Workspace-scoped database state in AppShell and view store.

Important files:

- `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
  `src-tauri/src/database.rs`, `src-tauri/src/commands.rs`,
  `src-tauri/src/lib.rs`, `src/features/database/database-model.ts`,
  `src/features/database/database-api.ts`,
  `src/features/database/DatabasePanel.tsx`,
  `src/features/database/DatabaseResultView.tsx`,
  `src/app/AppShell.tsx`, `src/app/workspace-view-state.ts`,
  `src/app/AppShell.contract.test.tsx`,
  `src/app/workspace-view-state.test.ts`.

Key commit milestones:

- `05a1559`, `260c91d`, `313f996`, `2258c2f`, `6237d69`, `922b467`,
  `5338010`, `9c41620`, `70f836c`, `d3aa5b8`, `bc9762a`,
  `daa54bb`, `577f745`, `f822554`, `70df3f6`, `5057986`, `7437a03`,
  `c16563d`, `13d320c`, `6042dca`, `bdf09ca`, `7ebcf58`.

Verification outcomes:

- `bun test`: PASS with 269 passed, 0 failed, 758 expect calls across 34 files.
- `bun run build`: PASS with `tsc && vite build`; Vite chunk-size warnings only.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml`:
  PASS with 227 passed, 0 failed, 1 ignored.
- `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`:
  PASS.
- `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`:
  PASS.
- `. "$HOME/.cargo/env" && bun run tauri build --debug`: PASS with
  `src-tauri/target/debug/yuuzu-ide`,
  `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app`, and
  `src-tauri/target/debug/bundle/dmg/Yuuzu-IDE_0.1.0_aarch64.dmg`.
- `bun test src/features/browser/browser-model.test.ts src/features/browser/BrowserPanel.test.tsx src/features/browser/BrowserPreviewSurface.test.tsx src/app/AppShell.contract.test.tsx`:
  PASS with 63 passed, 0 failed, 227 expect() calls.
- `bun test src/features/database/database-model.test.ts src/features/database/DatabasePanel.test.tsx src/features/database/DatabaseResultView.test.tsx src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx`:
  PASS with 66 passed, 0 failed, 245 expect() calls.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml database::tests`:
  PASS with 36 passed, 0 failed, 0 ignored.

Residual risks:

- Live PostgreSQL/MS SQL verification depends on user-provided servers and
  credentials.
- OS keyring availability can vary across platforms; secret metadata stays on disk
  only via opaque IDs.
- SQL query classification is kept conservative and is covered by Rust/frontend unit
  tests.

Next decision:

- Move from database tools to Node 10 Remote SSH And SFTP, using database, browser,
  agent, and docs context now available in the workbench.
