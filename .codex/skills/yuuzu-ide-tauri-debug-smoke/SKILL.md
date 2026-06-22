---
name: yuuzu-ide-tauri-debug-smoke
description: Run Yuuzu-IDE packaged debug app smoke verification with Tauri build, Computer Use, temporary workspaces, Git Graph stability probes, browser screenshot permission checks, clipboard checks, and process cleanup. Use this whenever the user says tauri-debug-build, asks to reverify a smoke-report finding in the real app, or reports visual/runtime behavior that unit tests cannot prove.
---

# Yuuzu-IDE Tauri Debug Smoke

Use this skill for real runtime verification of Yuuzu-IDE behavior in the packaged debug app.

## Preflight

1. Run `git status --short` and note that the worktree may already contain user-owned changes.
2. Identify the exact behavior being smoked and the minimum test workspace needed.
3. Build the debug app:

```bash
bun run tauri build --debug --bundles app
```

4. Use the app bundle at:

```text
src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app
```

5. For UI operation, use Computer Use when available and keep terminal commands for setup, probes, and cleanup.

## Smoke workflow

Read `references/tauri-debug-smoke.md` for scenario-specific steps. Prefer a temporary workspace unless the user explicitly asks to verify the current repo.

Always capture:

- app path
- workspace path
- exact probes performed
- observed pass/fail evidence
- permission prompts or environmental blockers
- cleanup performed

## Cleanup

After the smoke, stop processes and remove temporary probe files you created. Do not kill unrelated user sessions. If a Yuuzu-IDE process existed before the smoke, say that it was pre-existing instead of claiming you cleaned it up.
