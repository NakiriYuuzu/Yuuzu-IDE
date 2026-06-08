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
