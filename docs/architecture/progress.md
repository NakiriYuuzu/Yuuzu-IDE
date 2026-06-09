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
