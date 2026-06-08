# Yuuzu-IDE Roadmap

## Product Direction

Yuuzu-IDE is a personal native IDE for daily development across many projects.
The product exists to replace heavyweight IDE workflows with a smaller,
faster, Rust-based workbench that can keep multiple projects available without
the memory cost of opening several large IDE windows.

The first product shape is a single native desktop app window with multiple
workspaces. Each workspace owns its file tabs, terminals, git state, docs
context, tasks, and session history. Users should be able to switch projects
quickly without rebuilding mental state or paying the full memory cost of a new
IDE process.

## Design Principles

- **Rust-first core:** filesystem, indexing, terminal orchestration, git, search,
  settings, process management, and workspace state should live in Rust where
  practical.
- **Native app, not web-only:** the user-facing product is a desktop app. Web UI
  technology may be used only if it preserves the memory and startup goals.
- **Multi-workspace by default:** one app process should handle multiple active
  projects with predictable resource use.
- **Terminal is a first-class surface:** shell sessions, task output, agent runs,
  and verification loops are part of the main workbench, not an afterthought.
- **Docs are executable context:** project docs, notes, ADRs, READMEs, and
  runbooks should feed search, agent prompts, task plans, and verification.
- **Feature-complete, staged delivery:** major IDE capabilities stay on the
  roadmap; roadmap nodes define sequence, not permanent cuts.
- **Low overhead over feature breadth:** if a feature makes the app feel like
  JetBrains in resource usage, it needs a narrower first implementation or a
  lazy-loading model.

## Initial Performance Targets

These are working targets for architectural decisions. They can be adjusted once
real measurements exist.

- Cold launch to usable shell: under 2 seconds on the primary development
  machine.
- Idle memory with one workspace open: under 180 MB.
- Idle memory with three medium workspaces open: under 300 MB.
- Additional inactive workspace overhead: under 50 MB where possible.
- Opening a small file from an indexed project: under 100 ms after initial scan.
- Terminal startup: under 300 ms after workspace activation.
- Indexing must be cancelable, incremental, and respectful of ignore files.

## Full Capability Map

### Workspace And Project Management

- Open folders as workspaces.
- Keep multiple workspaces inside one app window.
- Persist each workspace layout, tabs, active terminals, git panel state, and
  recent commands.
- Workspace switcher with fuzzy search.
- Project grouping, pinning, favorites, and recent project list.
- Per-workspace settings layered over global settings.
- Safe handling for missing, moved, or offline project paths.

### App Shell And Workbench

- Native desktop shell.
- Left activity rail for Explorer, Search, Git, Docs, Terminal, Agent, Database,
  Remote, Browser, and Settings.
- Resizable side panels.
- Editor groups with split views.
- Command palette.
- Keyboard-first navigation.
- Persistent tabs and layouts.
- Status bar for branch, diagnostics, tasks, terminal state, indexing, and
  active workspace.
- Theme, accent color, density, font size, and keybinding profiles.

### File Explorer And Search

- File tree with git decorations.
- File create, rename, delete, move, duplicate, and reveal.
- File watcher with debounce and conflict handling.
- Respect `.gitignore`, `.ignore`, and workspace-specific exclude patterns.
- Fast filename search.
- Full-text search with regex, case sensitivity, and include/exclude filters.
- Replace in files with preview and confirmation.
- Large file guardrails.

### Editor

- Open, edit, save, save as, revert, and close files.
- Dirty state tracking.
- Tabs, pinned tabs, preview tabs, and split editor groups.
- Syntax highlighting for common languages.
- Bracket matching, line numbers, minimap or outline option, indentation guides.
- Multi-cursor, find in file, replace in file.
- Formatting hooks.
- Auto-save option.
- File encoding and line-ending handling.
- Diff view.
- Merge conflict view.

### Language Intelligence

- LSP client support.
- Diagnostics panel.
- Go to definition, references, hover, rename, symbols, completion, and code
  actions.
- Per-workspace language server lifecycle.
- Lazy start language servers only when needed.
- Language server health and logs.
- Minimal built-in support for Rust, TypeScript/JavaScript, Python, Markdown,
  JSON, YAML, SQL, and shell scripts.

### Terminal And Tasks

- Integrated terminal per workspace.
- Multiple terminals per workspace.
- Named terminals.
- Shell profile selection.
- Terminal persistence and restart.
- Task runner abstraction for `bun`, `cargo`, `uv`, package scripts, Makefile,
  and custom commands.
- Build, test, lint, dev-server, and one-off task panels.
- Output parsing into problems.
- Working-directory controls.
- Environment variable and `.env` handling.

### Git And Version Control

- Source control panel.
- Stage, unstage, discard, restore, commit, amend, stash, branch, checkout,
  fetch, pull, push, and rebase workflows.
- Commit graph.
- Inline diff and side-by-side diff.
- Merge conflict workflow.
- Git blame.
- Worktree awareness.
- Repository status caching per workspace.
- Guardrails for destructive actions.

### Docs Context

- Docs panel that indexes project docs.
- Markdown preview.
- Search docs separately from source files.
- Tag important docs as context sources.
- Context packs for agent sessions.
- Support README, `docs/`, ADRs, runbooks, design docs, and local notes.
- Show which docs were used for a generated plan or prompt.
- Detect stale docs when referenced files changed.

### Agent Workflows

- Agent panel with sessions per workspace.
- Prompt composer with selected files, docs, terminal output, git diff, and
  diagnostics as context.
- Plan, edit, verify, review, and report workflow modes.
- Persist agent transcripts.
- Export prompts and task plans.
- Show tool calls, diffs, commands, and verification results.
- Human approval gates for file edits and destructive commands.
- Support local CLIs first; remote model providers can be added later.

### Browser Preview

- Embedded preview tab for local dev servers.
- Open browser beside code.
- Reload, hard reload, URL bar, back, forward.
- Capture screenshots for verification.
- Console log and network error surface if practical.
- Map detected dev server ports to workspaces.

### Database Tools

- SQLite browser.
- PostgreSQL connection.
- MS SQL Server connection.
- Connection profiles with local secret storage.
- Schema explorer.
- Table data viewer.
- Query editor with history.
- Export query results.
- Read-only mode by default for production connections.
- Clear confirmation for mutating SQL.

### Remote Development

- SSH terminal profiles.
- SFTP file browser.
- Remote file open/download/upload.
- Remote task execution.
- Connection health and reconnect.
- Per-host settings and key management.
- Remote workspace support as a later stage.

### Debugging

- Debug adapter protocol support.
- Launch configurations.
- Breakpoints.
- Call stack, variables, watches, console.
- Attach to processes.
- Debug terminal integration.

### Extensions And Customization

- Settings UI and config files.
- Keybindings.
- User snippets.
- Theme system.
- Command registry.
- Extension API after core workflows stabilize.
- Internal plugin boundaries before public extensions.

### Security And Safety

- Workspace trust model.
- Clear separation between project commands and app commands.
- Secret redaction in agent context.
- Confirmation for destructive git, file, database, and remote operations.
- Local credential storage through OS keychain where possible.
- No silent upload of project files to external services.

### Observability And Maintenance

- Built-in diagnostics page.
- App logs.
- Workspace indexing logs.
- Terminal and process lifecycle logs.
- Performance measurements for startup, memory, indexing, search, and editor
  latency.
- Crash recovery.
- Backup for unsaved files.

## Roadmap Nodes

### Node 0: Product And Architecture Foundation

**Status:** blocked during Task 4 until Rust/Cargo is installed or exposed on
`PATH`; see `docs/architecture/progress.md` for verification evidence.

**Goal:** turn the product direction into buildable technical constraints before
large implementation starts.

**Scope**

- Confirm desktop stack options and pick the first implementation stack.
- Define Rust core boundaries.
- Define UI process, worker process, and workspace state model.
- Define performance measurement approach.
- Define config file locations and workspace metadata format.
- Create project repo structure.
- Create architectural notes for process lifecycle, file watching, terminal
  sessions, and workspace switching.

**Acceptance**

- A documented app architecture exists.
- The chosen UI stack has a measured hello-world baseline for startup and memory.
- The workspace state schema is drafted.
- The first implementation milestone can start without re-litigating the app
  shell shape.

**Non-goals**

- Full editor.
- LSP.
- Agent integration.
- Database and remote features.

### Node 1: Native App Shell And Multi-Workspace Core

**Goal:** create the first usable desktop workbench with multiple projects in one
window.

**Scope**

- Native app window.
- Activity rail.
- Workspace switcher.
- Open folder as workspace.
- Add, remove, pin, and switch workspaces.
- Persist active workspace and recent workspaces.
- Side panel layout.
- Main tab area.
- Command palette shell.
- Basic settings storage.
- Empty states and error states for missing project paths.

**Acceptance**

- User can open at least three projects in one app window.
- Switching workspaces restores that workspace's panel and tab state.
- Inactive workspaces do not start expensive background services by default.
- Memory usage is measured with one and three workspaces open.

**Non-goals**

- Complete editor behavior.
- LSP.
- Agent actions.

### Node 2: Explorer, Files, Search, And Basic Editor

**Goal:** make the workbench useful for reading and editing project files.

**Scope**

- File explorer.
- Open file into tabs.
- Basic text editor.
- Save and dirty state.
- Syntax highlighting for the first language set.
- Find in file.
- Project filename search.
- Full-text search.
- File create, rename, delete, and reveal.
- File watcher and external-change detection.
- Large-file handling.

**Acceptance**

- User can browse, open, edit, and save source files.
- Search can find filenames and text across a medium workspace.
- External file changes are detected without corrupting open buffers.
- Unsaved edits survive accidental tab close or app restart where practical.

**Non-goals**

- Full LSP.
- Debugging.
- Merge conflict editor.

### Node 3: Integrated Terminal And Task Runner

**Goal:** make terminal workflows first-class inside each workspace.

**Scope**

- Integrated terminal panel.
- Multiple named terminals per workspace.
- Terminal working-directory controls.
- Terminal restart and close.
- Task registry.
- Built-in detection for `bun`, `cargo`, `uv`, package scripts, and common test
  commands.
- Run, stop, rerun, and view task output.
- Basic problem matcher for common compiler/test output.

**Acceptance**

- Each workspace can own independent terminals.
- Switching workspaces restores terminal list and task history.
- User can run dev server, tests, build, and custom commands from the workbench.
- Terminal memory and process cleanup are measured.

**Non-goals**

- Full debugger.
- Remote terminal.
- Agent orchestration.

### Node 4: Git Workflows

**Goal:** cover the daily source-control loop without leaving the app.

**Scope**

- Git status panel.
- Stage, unstage, commit, amend, and stash.
- File diff view.
- Branch switch and create branch.
- Fetch, pull, push.
- Commit graph.
- Git decorations in explorer and tabs.
- Guardrails for discard, reset, checkout, and rebase.

**Acceptance**

- User can complete a normal edit-test-commit-push cycle inside the app.
- Diff and source-control state update after file edits and external git
  commands.
- Destructive operations require explicit confirmation.

**Non-goals**

- Complex merge UI.
- Pull request integration.

### Node 5: Docs Context And Markdown Workflows

**Goal:** make project docs visible, searchable, and reusable as development
context.

**Scope**

- Docs panel.
- Markdown preview.
- Docs index.
- Docs-only search.
- Context source selection.
- Context pack creation.
- Link docs context to workspace, task, and agent session metadata.
- Staleness hints when selected docs reference changed files.

**Acceptance**

- User can quickly find and preview docs in a workspace.
- User can select docs as context for a future agent task.
- Context packs are persisted and inspectable.

**Non-goals**

- Automated doc rewriting.
- Full knowledge graph.

### Node 6: Language Intelligence

**Goal:** add modern code intelligence while keeping idle overhead low.

**Scope**

- LSP client.
- Lazy language server startup.
- Diagnostics.
- Hover.
- Go to definition.
- References.
- Rename.
- Completion.
- Code actions.
- Symbols and outline.
- Language server logs and restart.

**Acceptance**

- Rust, TypeScript/JavaScript, and Python have working baseline LSP support.
- Language servers start only for active or recently active workspaces.
- Diagnostics appear in editor, panel, and status bar.
- Language server memory cost is visible to the user.

**Non-goals**

- Custom language servers.
- Heavy semantic indexing beyond LSP.

### Node 7: Agent Workbench

**Goal:** integrate agent-assisted development as a structured IDE workflow.

**Scope**

- Agent session panel.
- Prompt composer.
- Select files, docs, diffs, diagnostics, and terminal output as context.
- Plan, edit, verify, review, and report modes.
- Agent transcript persistence.
- Display tool calls, command output, diffs, and verification status.
- Export prompts and plans.
- Approval gates for edits and destructive commands.

**Acceptance**

- User can start an agent session from a workspace with selected docs and files.
- The app records which context was used.
- The app shows generated diffs and verification commands clearly.
- User can export a reproducible prompt or plan.

**Non-goals**

- Fully autonomous edits without review.
- Cloud sync.

### Node 8: Browser Preview And Local Dev Loop

**Goal:** support frontend and full-stack development loops beside code.

**Scope**

- Embedded browser preview.
- Localhost URL launcher.
- Dev server detection from tasks.
- Reload and hard reload.
- Split editor/browser layout.
- Screenshot capture.
- Console error surface if practical.

**Acceptance**

- User can run a dev server and open it beside the relevant files.
- Browser state belongs to the workspace.
- Screenshots can be attached to verification or agent context.

**Non-goals**

- Full browser automation suite.
- Cross-browser testing.

### Node 9: Database Tools

**Goal:** bring common local and remote database inspection into the workbench.

**Scope**

- SQLite connection.
- PostgreSQL connection.
- MS SQL Server connection.
- Schema explorer.
- Table view.
- Query editor.
- Query history.
- Result export.
- Read-only production profile option.
- Confirmation for mutating SQL.

**Acceptance**

- User can inspect SQLite, PostgreSQL, and MS SQL Server schemas.
- Query results render in a table.
- Mutating operations are visibly differentiated from reads.
- Connection secrets are not stored in plain project files.

**Non-goals**

- Database migration framework.
- Visual query builder.

### Node 10: Remote SSH And SFTP

**Goal:** support operational workflows without turning the IDE into a remote
desktop.

**Scope**

- SSH host profiles.
- SSH terminal.
- SFTP file browser.
- Upload and download.
- Remote command tasks.
- Reconnect and connection health.
- Host-specific settings.

**Acceptance**

- User can open SSH terminals per workspace.
- User can browse and transfer files through SFTP.
- Connection failures are visible and recoverable.

**Non-goals**

- Full remote workspace editing.
- Remote container orchestration.

### Node 11: Debugging

**Goal:** add debugging once editor, terminal, and language intelligence are
stable.

**Scope**

- Debug adapter protocol client.
- Launch configurations.
- Breakpoints.
- Call stack.
- Variables.
- Watches.
- Debug console.
- Attach workflows.

**Acceptance**

- At least one compiled language and one scripting language can be debugged.
- Breakpoints and variables work in the editor.
- Debug sessions are scoped to workspaces.

**Non-goals**

- Time-travel debugging.
- Browser devtools replacement.

### Node 12: Extension And Ecosystem Layer

**Goal:** open customization without destabilizing core performance.

**Scope**

- Internal command registry.
- Public extension API draft.
- Theme API.
- Keybinding API.
- Snippets.
- Workspace hooks.
- Extension isolation model.
- Extension performance budget.

**Acceptance**

- Internal features use the same command registry extension authors will use.
- Extensions can be disabled per workspace.
- Slow extensions can be identified.

**Non-goals**

- Marketplace.
- Unbounded extension host capabilities.

### Node 13: Hardening, Packaging, And Daily Driver Readiness

**Goal:** make Yuuzu-IDE reliable enough for everyday personal use.

**Scope**

- Crash recovery.
- Unsaved file backup.
- Update strategy.
- App packaging.
- Logs and diagnostics.
- Performance dashboard.
- Settings migration.
- Import keybindings or habits from existing tools where practical.
- Documentation for personal setup.

**Acceptance**

- The app can be used for daily work on the user's primary projects.
- Crashes do not lose unsaved edits.
- Startup, memory, and indexing metrics are visible.
- Packaging works on the target operating system.

**Non-goals**

- Public release polish.
- Team collaboration features.

## Suggested First Milestones

### Milestone A: Architecture Spike

- Choose first desktop stack.
- Measure baseline startup and memory.
- Prototype workspace state persistence.
- Prototype a native shell with activity rail and one panel.
- Prototype file tree scan in Rust.

### Milestone B: Workbench Skeleton

- Open multiple workspaces.
- Switch workspaces.
- Persist layout.
- Open files as read-only tabs.
- Show status bar and command palette shell.

### Milestone C: Editing Loop

- Save text files.
- Detect dirty state.
- Add syntax highlighting.
- Add search.
- Add basic terminal.
- Run project tasks.

### Milestone D: Daily Development Loop

- Add git status and diff.
- Add task runner.
- Add docs search and preview.
- Add basic LSP diagnostics.

## Open Decisions

- Desktop stack: Tauri 2 with Vite, React, TypeScript, and shadcn/ui is the
  primary route. Rust-native no-WebView frameworks are fallback research only if
  Node 0 measurements show WebView overhead is unacceptable.
- Editor engine: Monaco Editor is the first route, loaded lazily inside the main
  workbench WebView.
- Terminal engine: xterm.js is the first terminal renderer; Rust owns PTY process
  lifecycle through a PTY abstraction such as `portable-pty`.
- Index storage format.
- Workspace metadata file location.
- Extension host language and sandbox.
- Whether browser preview should be embedded in the first stable app or delayed
  until after agent/docs workflows.

## Current Priority

Start with Node 0 and Node 1. The important early proof is not full IDE breadth;
it is proving that one Tauri/Rust desktop app can keep multiple projects open,
switch them quickly, avoid creating one WebView per workspace, and stay
meaningfully lighter than the JetBrains workflow it is meant to replace.
