# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Identity

Yuuzu-IDE is a personal native IDE for multi-project daily development. The app
is Rust-first: filesystem access, workspace state, search, git, terminal
processes, LSP lifecycle, database access, remote access, diagnostics, recovery,
and security-sensitive behavior should live in the Tauri/Rust core when
practical.

The stack is Tauri 2 + Vite + React + TypeScript + Rust, with Bun as the
JavaScript toolchain.

## Communication Defaults

- Match the user's language.
- If the user writes in Traditional Chinese, respond in Traditional Chinese.
- For implementation updates, code review summaries, and close-out reports,
  default to Traditional Chinese unless the task or artifact clearly requires
  English.
- State assumptions before changing behavior when scope is ambiguous.
- Prefer a short plan for multi-step work, with concrete verification for each
  step.

## Repository Safety

- Treat this file as repo-scoped. Do not change files outside this repository
  unless the user explicitly asks for machine-level or cross-repo work.
- Check `git status --short` before editing. This repository often has
  user-owned uncommitted work.
- Never revert, overwrite, or "clean up" changes you did not make unless the
  user explicitly requests that exact operation.
- Do not run destructive git commands such as `git reset --hard`,
  `git checkout -- <path>`, or branch deletion without explicit approval.
- Do not stage, commit, or push unless the user explicitly asks. If commits are
  requested for roadmap work, keep them repo-local and scoped to verified
  milestones.
- Make surgical changes. Every changed line should trace directly to the user's
  request.

## Toolchain

Prefer:

```bash
bun install
bun test
bun run build
bun run dev
bun run tauri ...
bunx <tool>
uv run python ...
```

Use Cargo through the Tauri manifest:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

The full local verification gate before replacing a local app bundle is:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
bun run tauri build --debug
```

For narrow changes, run the smallest focused test first, then broaden based on
risk.

## Live Architecture

- `src/main.tsx` mounts React.
- `src/App.tsx` renders `WorkbenchV2` only.
- `src/v2/` is the shipping frontend shell.
- `src/v2/Workbench.tsx` owns the visible v2 layout.
- `src/v2/v2-store.ts` owns synchronous UI state and delegates real async work.
- `src/v2/controller.ts` registers the real backend delegate and orchestrates
  Tauri calls.
- `src/v2/bridge.ts` contains pure mapping helpers between feature API payloads
  and v2 model objects.
- `src/v2/yuzu.css` owns the active v2 visual system and theme variables.
- `src/features/*` primarily contains models, API wrappers, tests, and reused
  support components. Do not assume old feature UI components are live unless
  `src/v2/` imports them.
- `src/features/terminal/TerminalTab.tsx` is reused by the v2 terminal surface.
- `src/lib/tauri.ts` wraps Tauri `invoke`.
- `src-tauri/src/lib.rs` registers app state and Tauri command handlers.
- `src-tauri/src/commands.rs` is the IPC boundary; prefer putting domain logic
  in focused Rust modules under `src-tauri/src/` instead of expanding command
  handlers unnecessarily.

## Frontend Rules

- Use `docs/ui-design/` as the source of truth for v2 UI design when doing
  roadmap or visual work.
- Preserve the v2 shell. Do not reintroduce the removed `src/app/*` shell.
- The v2 editor is a custom textarea plus painted highlight layers, not Monaco.
  Monaco may still exist in retired/support code, but it is not the shipping v2
  editor engine.
- The terminal renderer is xterm.js through the reused `TerminalTab`.
- For terminal title, PTY output, or xterm renderer behavior, verify both the
  mounted `TerminalTab`/xterm path and the backend terminal-output event path;
  inactive tabs and collapsed AgentZone sessions may not have a mounted
  renderer.
- Keep v2 store logic deterministic and testable. Put async orchestration in
  `controller.ts`; put payload mapping in `bridge.ts`.
- For visual/theme changes, edit the actual rendered CSS variables in
  `src/v2/yuzu.css` and verify in a browser or packaged app when visible
  behavior matters.

## Rust/Tauri Rules

- Keep Rust workspace boundary checks strict. Commands that accept
  `workspaceRoot` should validate registered/trusted workspace roots before file,
  git, database, remote, or process operations.
- Run blocking filesystem, git, database, and process work off the UI path using
  the existing async/blocking patterns.
- Keep secrets in the existing keyring-backed stores. Do not persist passwords or
  tokens in frontend state, logs, or plain JSON.
- For database work, preserve read-only and mutating-SQL confirmation semantics.
- For git work, preserve typed confirmations for destructive actions.

## Docs And Roadmap

- Start with `roadmap.md` for product direction and current priorities.
- Use `docs/architecture/*` for completed-node evidence and implementation
  context.
- Use `docs/superpowers/specs/*` and `docs/superpowers/plans/*` for active or
  historical implementation contracts.
- Do not trust unchecked plan checkboxes alone. Cross-check spec headers,
  roadmap status, code symbols, tests, and git history before claiming a feature
  is complete.
- As of this file, Node 14 is the v2 completion bucket: missing v2 Docs, Debug,
  Extension UI, real Language panel wiring, and editor performance closeout.
  Re-check `roadmap.md` before acting on that status.

## Agentic RSI Protocol

All non-trivial development work in this repository should follow the Agentic
Recursive Self-Improvement Loop.

In this project, RSI means a governed engineering feedback loop. It does not
mean model self-training, autonomous self-replication, automatic merge, or
automatic permission expansion.

The default loop is:

```text
Intent
-> Scope Lock
-> Context Pack
-> Spec / Acceptance
-> Plan
-> Implementation
-> Verification
-> Review
-> Integration Decision
-> Lessons
-> Protocol Update Proposal
```

### Required Behavior

- Start by identifying the task class: `tiny`, `bugfix`, `feature`,
  `ui-runtime`, `refactor`, `docs-status`, `review`, `release`, or `protocol`.
- Lock scope before edits: identify likely files, out-of-scope files,
  verification needs, and dirty-worktree overlap.
- Gather a minimal context pack from `AGENTS.md`, `roadmap.md`, relevant specs
  and plans, touched source files, and adjacent tests.
- Define observable acceptance before implementation for non-trivial work.
- Prefer TDD: failing focused test, minimal implementation, passing focused
  test, broader verification as risk requires.
- Run verification that matches the blast radius.
- Use browser or Tauri verification for visible UI/runtime behavior when
  feasible.
- Run a review pass for substantial changes before claiming completion.
- End with lessons: what worked, what failed or nearly failed, which tests
  mattered, and whether future protocol, docs, or test updates are worth
  proposing.

### Human-Controlled Gates

Agents may propose improvements to workflow, tests, specs, plans, or
`AGENTS.md`, but must not apply protocol changes without user approval.

Human approval is required for:

- staging, committing, or pushing
- destructive git operations
- widening filesystem or runtime permissions
- changing secret handling
- weakening safety or verification rules
- marking roadmap work complete
- applying protocol updates
- merging work into the main line

### Lessons Format

For substantial tasks, include this closeout block:

```text
RSI Lessons:
- Task:
- Scope:
- Verification:
- Review result:
- What worked:
- What failed or almost failed:
- Future rule proposal:
- Apply now? no, proposal only unless user approves
```

### Protocol Update Rule

A lesson becomes a protocol update only when it is:

- repeatable across future tasks
- specific enough to be actionable
- useful without depending on hidden context
- not just a workaround for one temporary failure

Protocol update proposals should name the target file, usually one of:

- `AGENTS.md`
- `docs/superpowers/specs/*`
- `docs/superpowers/plans/*`
- `docs/architecture/*`
- focused test helpers

Do not silently convert a one-off lesson into a permanent rule.

## Testing Practice

- Prefer TDD for bug fixes and new behavior: add or identify a failing focused
  test, make it pass, then refactor only if needed.
- Frontend tests use Bun's test runner with Happy DOM preloaded by `bunfig.toml`.
- Rust tests live inline in `src-tauri/src/*.rs` and run through
  `src-tauri/Cargo.toml`.
- Windows path, URI, drive-letter, or `\\?\` verbatim-prefix fixes need focused
  Windows regression coverage when practical. macOS host results are not
  authoritative for those bugs; call out when a Windows runner or Windows
  machine is still required.
- For UI/runtime regressions, static reasoning is not enough when the issue is
  visual or launch-related. Verify with browser preview or the Tauri app when
  feasible.
- Browser changes that add or alter native Tauri Webview surfaces need packaged
  debug app smoke verification, not only unit tests or `bun run build`. Cover
  Webview feature/capability configuration, attach/detach/resize behavior, stale
  child-Webview cleanup after navigation or validation errors, remote HTTPS
  display, remote HTTP rejection, loopback HTTP, and screenshot permission
  behavior when capture is involved.

## Style

- Keep edits small and local.
- Match existing TypeScript/Rust style in the touched files.
- Avoid speculative abstractions and broad refactors.
- Remove only unused code introduced by your own change.
- Prefer `rg` / `rg --files` for search.
- Use `apply_patch` for manual edits.
