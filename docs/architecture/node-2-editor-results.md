# Node 2 Editor Results

## Scope

- Interactive file explorer.
- File open, edit, save, dirty state, and draft survival.
- Find in file.
- Filename and full-text project search.
- File create, rename, delete, and reveal.
- File watcher and external-change detection.
- Large-file handling.

## Verification

| Command | Result |
| --- | --- |
| `bun test` | PASS: 46 tests passed, 0 failed, 77 expect calls across 14 files |
| `bun run build` | PASS: Vite emitted chunk-size warning only |
| `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml` | PASS: 66 Rust lib tests passed, plus 0 main/doc tests |
| `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check` | PASS |
| `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS after lint-only `content.len()` cleanup in `src-tauri/src/file_system.rs` |
| `. "$HOME/.cargo/env" && bun run tauri build --debug` | PASS: built debug app and macOS debug app/dmg bundles; regenerated Tauri schemas |
| `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml file_system` | PASS: 15 focused file-system tests |
| `bunx playwright test node2-smoke.spec.ts --reporter=line` | PASS: 1 mocked-preview smoke test in 1.5s |

## Measurements

| Measurement | Result | Pass Target |
| --- | ---: | ---: |
| Nested file tree scan | 1 ms | responsive for medium workspace |
| Nested file tree entries | 2 entries | measured probe output |
| Small file read | 1 ms, 49 bytes | responsive |
| Small file save | 11 ms | responsive |
| Filename search | 16 ms, 1 match | responsive for medium workspace |
| Full-text search | 12 ms, 1 match | responsive for medium workspace |
| Large file open behavior | `too_large=true`, `content_loaded=false` | large files stay read-only and out of editable buffers |
| File operation smoke | passed; create 1 ms, rename 1 ms, delete 1 ms | destructive operations only in temp workspace |
| Initial editor chunk requests | 0 requests | Monaco/editor code stays lazy before file open |
| Editor chunk requests after opening file | 4 requests | Monaco/editor code loads after file open |
| Memory after first file open | 18 MB JS heap | measured in mocked Chromium preview |

## Result

Node 2 passes when the user can browse, open, edit, save, and search files, with
external changes detected and large files kept out of editable Monaco buffers.
The destructive create, rename, and delete flow passed through a temp-workspace
command-level smoke probe. The large-file guard opened the file as too large
without loading content, so the editor path remains read-only for that case.

## Measurement Notes

The command-level measurement probe ran outside the repository at
`/tmp/yuuzu-node2-measure`. It directly included the repository Rust modules and
used `ignore` 0.4.26 for traversal behavior. The probe covered nested explorer
scan, small-file read/save, filename search, full-text search, large-file guard,
and temp-workspace create/rename/delete operations.

Normal browser preview cannot exercise real Tauri filesystem IPC. The debug app
build passed, and command-level tests plus probes covered the real file
workflows. A separate mocked-preview smoke used `bun run preview -- --host
127.0.0.1 --port 4173` and the temporary Playwright spec
`/tmp/yuuzu-node2-playwright/node2-smoke.spec.ts` with injected Tauri IPC mocks;
it changed no repository files. That smoke covered app shell loading a mocked
workspace, explorer expansion for `src`, opening `main.ts`, Monaco visibility,
lazy editor chunk loading, and JS heap after file open. Chromium was installed
into the user Playwright cache for the temporary runner; repository dependencies
were not modified.

## TDD Evidence Summary

Task 9 itself records verification and documentation only; it did not introduce
new behavior and therefore has no separate RED/GREEN cycle.

Node 2 behavior changes used test-first evidence across the implementation
tasks:

- File system commands: focused `cargo test --manifest-path src-tauri/Cargo.toml file_system`
  covered bounded reads, writes, create, rename, delete, stale-version
  protection, lexical containment, symlink cases, and large-file handling before
  the final focused pass of 15 tests.
- Workspace search: focused `cargo test --manifest-path src-tauri/Cargo.toml search`
  covered filename hits, full-text line hits, result limits, large/unreadable
  file skips, entry errors, and deterministic sorting before the full Rust
  suite passed.
- File model, drafts, editor buffer scoping, find, search panel, and command
  palette behavior were covered by focused Bun tests including
  `bun test src/features/files/file-model.test.ts`,
  `bun test src/features/files/draft-store.test.ts`,
  `bun test src/app/editor-buffer-state.test.ts`,
  `bun test src/features/files/find-model.test.ts`,
  `bun test src/features/files/search-model.test.ts`, and
  `bun test src/app/command-palette-model.test.ts`.
- Explorer reveal/removal and unsafe rename states were covered by
  `bun test src/features/workspace/file-tree-model.test.ts`.
- File watcher behavior used focused
  `cargo test --manifest-path src-tauri/Cargo.toml file_watcher` plus
  `bun test src/features/files/file-model.test.ts` for external-change marking,
  canonical event matching, ownership claims, and unguessable watcher tokens.

## Residual Risks

- Browser preview cannot drive the real Tauri filesystem IPC surface, so manual
  workflow confidence comes from the debug app build plus command-level
  filesystem/search/watcher tests and probes. The Playwright preview smoke used
  injected Tauri IPC mocks for UI and lazy-loading coverage.
- Memory after first file open is a mocked Chromium preview JS heap value, not a
  settled desktop Tauri app footprint value.
- Vite still reports a chunk-size warning during `bun run build`; this remains
  acceptable for Node 2 because Monaco is lazy-loaded and the build exits
  successfully.
