# Tauri Debug Smoke Reference

## Build and launch

```bash
bun run tauri build --debug --bundles app
open src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app
```

If the build reaches bundle creation but exits on updater artifact signing
because `TAURI_SIGNING_PRIVATE_KEY` is unset, report that blocker and rerun only
the local runtime smoke build with updater artifacts disabled:

```bash
bun run tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
open src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app
```

Use a temporary workspace for destructive or synthetic tests:

```bash
mktemp -d /tmp/yuuzu-ide-smoke.XXXXXX
git -C <workspace> init
```

## Git Graph stability

1. Open the workspace in Yuuzu-IDE.
2. Open Git Graph.
3. Select a commit and wait for changed files/message to appear.
4. Create and remove a `.git/codex-watch-probe.*` file from the terminal.
5. Pass condition: commit detail remains on changed files/message and does not repeatedly reset to `Loading commit detail`.
6. If the workspace is dirty, avoid destructive Git actions unless the user explicitly asked for them.

Useful probe:

```bash
probe=".git/codex-watch-probe.$(date +%s)"
touch "<workspace>/$probe"
rm -f "<workspace>/$probe"
```

## Git copy hash

1. Click the copy hash action in Git Graph.
2. Compare clipboard with Git:

```bash
pbpaste
git -C <workspace> rev-parse HEAD
```

Pass condition: values match exactly.

## Dark theme editor caret

1. Switch to or confirm dark theme.
2. Open a text/code file in the editor.
3. Focus the CodeMirror editor, type, move left/right, and click different positions.
4. Pass condition: the caret remains visible against the dark background and content updates do not recreate/drop the focused editor instance.

## LSP editor action readiness

Use this when validating LSP lazy-start, document readiness, completion,
definition, references, rename, or code actions in the packaged app.

1. Open Language Settings before opening or using an LSP-backed file when
   possible.
2. Pass condition before first use: detected languages show `Idle · starts on
   first use`, not `Stopped`.
3. Open a supported source file such as `.ts`, `.rs`, or `.py`.
4. Prefer keyboard-triggered editor actions for Computer Use stability. Focus
   the CodeMirror editor and press `Ctrl-Space` to trigger completion; this
   exercises the same document ensure path without relying on context-menu
   cursor capture.
5. If the task specifically requires context-menu actions, first click inside
   the editor text, then right-click the same line. If Go to Definition, Find
   References, Rename Symbol, and Code Actions remain disabled because
   Computer Use did not set the editor cursor, record that as a UI automation
   limitation and pair the smoke with focused controller tests that prove
   ensure-before-request ordering.
6. Pass condition after first use: the relevant server transitions to
   `Running`, or the UI shows an actionable `Missing command: <command>` plus
   install hint.
7. Useful terminal evidence after first use:

```bash
pgrep -fl "typescript-language-server|rust-analyzer|pylsp|csharp-ls|kotlin-language-server" || true
```

## Browser capture

1. Start a loopback HTTP server or use a safe local page.
2. Open Browser preview and load the page.
3. Press capture.
4. Pass condition with permission: PNG is captured.
5. Acceptable blocked condition without permission: macOS shows or implies Screen Recording permission is required. Report the region and permission message if available.

## Window lifecycle

1. Close the main macOS window.
2. Confirm the process remains alive if close-to-hide is expected.
3. Reopen with:

```bash
open -a "$(pwd)/src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app"
```

4. Pass condition: the main window returns for the same app bundle.

## Cleanup checklist

- Remove `.git/codex-watch-probe.*` files.
- Stop temporary HTTP servers.
- Quit the debug app instance started for this smoke.
- Delete temporary workspaces only when they were created solely for this smoke.
