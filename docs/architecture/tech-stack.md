# Yuuzu-IDE Tech Stack

## Decision

Yuuzu-IDE will use **Tauri 2 + Vite + React + TypeScript** as the main desktop
application stack.

The app remains Rust-first: Tauri's Rust core owns filesystem access, workspace
state, process management, search, git orchestration, terminal processes,
language server lifecycle, database access, and security-sensitive behavior.
React renders the workbench UI and subscribes to core state.

## Why This Stack

The project needs Windows support, a polished workbench UI, fast iteration, and
access to mature IDE-grade components. A no-WebView Rust-native UI route would
reduce runtime layers, but it would make the editor, terminal renderer, layout
system, tables, accessibility, IME behavior, and component system long-term
research problems.

Tauri 2 keeps the application as a native desktop app while allowing the UI to
use mature web tooling. It uses OS WebView runtimes instead of bundling a full
browser, while the heavy development logic stays in Rust.

## Stack

### Desktop Shell

- **Tauri 2** for the desktop shell, Windows packaging, application lifecycle,
  IPC, windows, menus, and OS integration.
- Use one primary WebView for the main workbench.
- Do not create one WebView per workspace.
- Browser preview, if embedded later, should use a separate WebView from the main
  workbench.

### Frontend

- **Vite** for frontend build and development server.
- **React latest stable** with TypeScript.
- **shadcn/ui** for reusable UI components.
- **Tailwind CSS** for styling.
- **Radix primitives** through shadcn for accessible base interactions.
- **lucide-react** for icons.

### IDE Surface Components

- **Monaco Editor** for code editing, loaded only when an editor tab is opened.
- **xterm.js** for terminal rendering, loaded only when a terminal is opened.
- **TanStack Virtual** for large file lists, search results, git changes, logs,
  diagnostics, tables, and any high-row-count surface.
- **TanStack Query** or a small equivalent boundary for async command state when
  Rust calls need caching, cancellation, or refresh semantics.
- **Zustand** or a small local store for transient UI state only.

### Rust Core

- **Tokio** for async runtime and task orchestration.
- **serde** for structured data.
- **toml/json** for config and persisted workspace metadata.
- **anyhow / thiserror** for error handling.
- **tracing** for structured logs.
- **notify** for filesystem watching.
- **ignore** and ripgrep-style search crates for file traversal and search.
- **tree-sitter** for syntax-aware indexing and future semantic tools.
- **portable-pty** for terminal processes.
- **git CLI first** for source-control correctness; evaluate `git2` or `gix`
  later for selected read-heavy operations.
- **rusqlite** or **redb** for local state, depending on the final persistence
  model.
- **lsp-types** for protocol types and a custom IDE-side LSP client transport.

## Ownership Boundaries

### Rust Owns

- Workspace registry.
- Workspace layout persistence.
- File scanning and file watching.
- File reads and writes.
- Full-text search.
- Git process orchestration.
- Terminal process lifecycle.
- Task runner lifecycle.
- LSP process lifecycle and diagnostics cache.
- Database connections and query execution.
- Secrets and credentials.
- Agent session persistence and context assembly.
- Performance metrics.

### React Owns

- Visible workbench layout.
- Activity rail and panels.
- Tab strip and split-view arrangement.
- Command palette presentation.
- shadcn dialogs, menus, inputs, and forms.
- User interaction state that does not need durable persistence.
- Rendering streamed state from Rust into virtualized UI surfaces.

### React Must Not Own

- Complete file contents as global state.
- Terminal output stream.
- Large git diffs.
- Large search results.
- LSP diagnostics cache.
- Database result sets beyond the currently rendered window.
- Secrets or credentials.

## WebView Cost Controls

- Load the shell first; lazy-load Monaco, xterm.js, markdown preview, database
  tables, and browser preview.
- Keep workspace switching as state switching inside one WebView.
- Use virtualization for every unbounded list.
- Stream terminal bytes directly into xterm.js instead of routing every chunk
  through React state.
- Keep file buffers in Monaco/editor models and Rust-managed state, not global
  React stores.
- Keep search and git result payloads paged or windowed.
- Prefer Rust-side filtering and sorting for large data.
- Measure memory before and after each heavy surface is loaded.

## Windows WebView2 Policy

Use the Evergreen WebView2 Runtime for Windows distribution. Windows 11 normally
has WebView2 available, and Tauri installers can handle older Windows targets
that need runtime installation.

The app should include a Node 0 compatibility check for:

- Windows 11 with current Evergreen WebView2.
- Windows 10 with WebView2 already installed.
- Windows 10 path where the installer must ensure WebView2 availability.

## Node 0 Spike Plan

Node 0 should validate this stack before deeper implementation.

### Prototype Scope

- Tauri 2 app shell.
- Vite + React + TypeScript.
- shadcn/ui installation.
- Activity rail mock.
- Workspace switcher mock with three workspace states.
- Lazy-loaded Monaco tab.
- Lazy-loaded xterm.js terminal tab connected to a Rust PTY.
- Rust command for file tree scan.
- Rust command for persisted workspace registry.

### Measurements

- Cold launch to visible shell.
- Idle memory after shell load.
- Memory delta after Monaco load.
- Memory delta after xterm.js load.
- Memory with one workspace registered.
- Memory with three workspaces registered.
- Terminal startup latency.
- File tree scan latency for a real project.
- WebView process count.

### Pass Criteria

- The app launches to a usable shell within the roadmap target.
- Registering multiple workspaces does not create additional WebViews.
- Monaco and xterm.js are not loaded during initial shell startup.
- Rust owns file scanning and PTY lifecycle.
- React receives only bounded, renderable payloads.

## Fallback Criteria

The WebView route should be reconsidered only if Node 0 measurements show that
the WebView baseline makes the product unable to meet its memory goals.

Fallback research options:

- Floem for a Rust-native IDE route.
- iced as a conservative Rust-native GUI fallback.
- Slint for a lighter app shell if the product scope becomes less editor-heavy.

GPUI is not a primary fallback while Windows support remains a hard requirement.

## Current Recommendation

Proceed with **Tauri 2 + Vite + React + shadcn/ui** as the main implementation
route. Treat WebView as the UI renderer, not the application core.
