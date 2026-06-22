# Yuuzu-IDE Verification Matrix

Use this matrix to select the smallest credible verification gate.

## Common gates

```bash
bun test <focused-test-files>
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml <focused-filter>
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
bun run verify:editor-large-file
bun run tauri build --debug --bundles app
git diff --check
```

## Task to gate mapping

| Task shape | Start with | Broaden when |
| --- | --- | --- |
| Pure v2 model/store change | `bun test src/v2/<adjacent>.test.ts` | Run `bun test src/v2` or full `bun test` if shared state or controller behavior changed. |
| React v2 rendering change | Adjacent `*.test.tsx` | Run related v2 tests and `bun run build` if props/types changed across files. |
| CodeMirror editor behavior | `src/v2/editor/editor-surface.test.ts`, `src/v2/ContentViews.test.tsx`, `src/v2/v2-model.test.ts` | Run `bun run verify:editor-large-file` and packaged smoke for focus, caret, scroll, or theme visibility. |
| Rust command or IPC change | Focused Cargo test in the touched Rust module | Run Cargo full test/fmt/clippy and debug build if command registration or app state changed. |
| Git status or Git Graph behavior | `src/v2/folder-expand.test.ts`, `src/features/git/git-model.test.ts`, `src/v2/GitGraphView.test.tsx`, `src/v2/bridge.test.ts` | Use packaged app smoke for watcher loops, clipboard, commit detail stability, or destructive-action guards. |
| Browser preview/capture | `src/v2/bridge.test.ts`, `src/v2/ContentViews.test.tsx`, backend capture tests if present | Use packaged app smoke. Screen Recording permission can block final PNG capture on macOS; report this explicitly. |
| Context menus | `src/v2/Overlays.test.tsx` and focused component tests | Temporary component smoke is acceptable if deleted after use and reported clearly. |
| Window lifecycle or app bundle behavior | Debug app build plus real app smoke | Full local gate if replacing an installed app bundle. |
| Docs/report-only change | Link/content validation plus `git diff --check` | Run tests only when the doc claims current test results or executable behavior changed. |

## Recent smoke-report probes

These probes came from the 2026-06-22 smoke report and are useful templates:

- Git Graph flicker: open the packaged debug app, open this repo, select Git Graph, create/remove a `.git/codex-watch-probe.*` file, and verify the commit detail does not reset to `Loading commit detail`.
- Git copy hash: click the hash copy action and verify `pbpaste` equals `git rev-parse HEAD`.
- Dark theme caret: open an editor in dark theme, focus the CodeMirror surface, type or move the caret, and verify the caret remains visible.
- Browser capture: load a loopback page, press capture, and distinguish a real capture failure from the expected macOS Screen Recording permission prompt.
- Window lifecycle: close the macOS window, confirm the process remains alive, then `open -a src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app` and verify the window returns.

## Evidence format

Record exact commands and high-signal output:

```text
Verification:
- bun test src/v2/folder-expand.test.ts: 22 pass, 0 fail
- bun run tauri build --debug --bundles app: built debug macOS app bundle
- Runtime smoke: Git Graph detail stayed on changed files/message after .git watcher probe
```

For skipped gates, say why:

```text
Not run:
- Full Cargo clippy: no Rust files changed.
- Browser PNG capture: macOS Screen Recording permission was not granted in this session.
```
