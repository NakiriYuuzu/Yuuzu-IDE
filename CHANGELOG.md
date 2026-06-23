# Changelog

## [Unreleased]

- No unreleased changes.

## [0.1.0] - 2026-06-23

### Added

- Rust-first Tauri 2 desktop workbench with the v2 Yuzu shell, project rail,
  command search, status bar, persisted workspace registry, and dark/light
  themes.
- Multi-workspace file explorer with Rust-owned scanning, file
  create/rename/delete, path containment, file watcher events, large-file
  guardrails, filename search, and full-text search.
- CodeMirror 6 editor surface with dirty-state tracking, save/reload flows,
  external-change awareness, unsaved backup recovery, syntax support for common
  project formats, and a first-party C# Lezer syntax package.
- Integrated terminal tabs rendered with xterm.js and backed by Rust PTY
  sessions, including terminal lifecycle handling, output replay, named
  terminals, and OSC title support.
- Git workbench with source-control groups, structured diffs, hunk and line
  staging, commits, branch controls, stash flows, conflict resolution, commit
  graph, file history, blame, export, and typed confirmations for destructive
  operations.
- AgentZone for workspace-scoped local agent sessions, multiple agent windows,
  session status, terminal-backed output, and workflow-oriented context surfaces.
- Browser preview for local development URLs with reload flows, URL validation,
  screenshot capture paths, and regression coverage for native WebView behavior.
- Database tools for SQLite, PostgreSQL, and Microsoft SQL Server, including
  schema browsing, table data, SQL query history, CSV export, keyring-backed
  secrets, read-only defaults, and mutating-SQL confirmations.
- SSH/SFTP remote tools with host profiles, local/remote panes, directory
  listing, upload/download, remote command execution, connection health, and
  disconnect paths.
- Recovery, diagnostics, settings, and update surfaces, including unsaved-edit
  backups, diagnostic event storage, process metrics, VS Code keybinding import,
  Settings > Updates, and in-app updater checks.
- CI workflow for pull requests and pushes to `main`.
- Draft release workflow for macOS Apple Silicon (`darwin-aarch64`) and Windows
  x64 (`windows-x86_64`), including signed updater artifacts, `latest.json`, and
  a separate Windows portable `.zip` release asset.

### Known limitations

- This first release is a personal alpha. macOS artifacts are not notarized, and
  Windows artifacts are not Authenticode signed, so first launch may require
  Gatekeeper or SmartScreen confirmation.
- Language intelligence is partially wired in v2: editor diagnostics are
  available, while the full LSP control/log panel remains active follow-up work.
- Docs, Debug, and Extension UI have backend or earlier-shell implementation
  evidence but are not yet fully ported into the shipping v2 shell.
