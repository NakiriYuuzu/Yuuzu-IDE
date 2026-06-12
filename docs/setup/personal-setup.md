# Personal Setup

Yuuzu-IDE is currently a manual local build for personal daily-driver use.
Run the setup and verification commands from the repository root before using a
new local app bundle for real work.

## Required Local Commands

Run these commands after cloning, after dependency changes, and before replacing
the local app bundle:

```bash
bun install
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
bun test
bun run build
bun run tauri build --debug
```

The `cargo test` command should use the `src-tauri/Cargo.toml` manifest so the
Rust command, persistence, diagnostics, settings, and recovery tests run against
the Tauri app crate.

## Daily-Driver Checklist

- Register primary workspaces before starting daily work.
- Verify the Recovery list is empty before starting work in a workspace.
- Keep Settings diagnostics visible when checking startup, memory, or indexing
  behavior.
- Run `bun run tauri build --debug` after dependency updates before replacing
  the local app bundle.

## Recovery Procedure

Use Settings -> Recovery -> Restore, then Save.

The restore action brings the selected unsaved backup back into the editor. Save
the restored file once you confirm the content belongs in the workspace.

## Diagnostics Procedure

Use Settings -> Performance/Diagnostics -> Refresh.

The refreshed view should show the process id, memory, uptime, workspace count,
docs index entries, file tree entries, and recent diagnostics events for the
current app session.

## Keybinding Import Procedure

Use Settings -> Keybindings -> paste VS Code JSON -> Import.

Only VS Code JSON keybinding input is accepted for the Node 13 importer. After
importing, review the accepted command mappings in Settings before relying on
them during daily work.
