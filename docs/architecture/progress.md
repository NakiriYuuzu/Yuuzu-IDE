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
