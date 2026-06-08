# Yuuzu-IDE Complete Roadmap Goal Prompt

Paste the prompt below into Codex Goal mode when you want a long-running agent
to keep implementing Yuuzu-IDE until the roadmap is complete or a real blocker
requires user input.

For the current paste-ready trigger command, use
[start-multi-subagent-tdd-goal.md](./start-multi-subagent-tdd-goal.md). The
contract below is retained as a readable reference.

```text
Goal:
Implement Yuuzu-IDE through every roadmap node in `roadmap.md`, starting with
Node 0 and continuing sequentially until Node 13 is complete, verified, and
documented.

Context:
- Repo: /Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide
- Read first:
  - roadmap.md
  - docs/architecture/tech-stack.md
  - docs/superpowers/plans/2026-06-08-node-0-architecture-spike.md
  - docs/ui-design/scratchpad.md
  - docs/ui-design/app.jsx
  - docs/ui-design/panels.jsx
  - docs/ui-design/data.jsx
  - docs/ui-design/ide.css
- Existing conventions: follow the active AGENTS.md instructions and local docs.
- Product direction: personal Rust-first native IDE using Tauri 2, Vite, React,
  TypeScript, shadcn/ui, Monaco Editor, xterm.js, and Rust core services.
- UI source of truth: frontend implementation must use `docs/ui-design/` as the
  required product/workbench design reference.
- Current behavior: the repository currently contains roadmap, architecture
  notes, UI design artifacts, and a Node 0 implementation plan; the app itself
  may not be scaffolded yet.
- Expected behavior: Yuuzu-IDE becomes a working desktop app that satisfies each
  roadmap node's scope and acceptance criteria, with verification evidence kept
  current as the implementation progresses.

Constraints:
- Modify only files required to implement the roadmap, architecture docs, tests,
  scripts, and supporting project configuration.
- Preserve existing docs/ui-design artifacts unless a change is explicitly needed
  to wire them into the implementation or keep docs accurate. Do not replace the
  design direction with a generic IDE layout.
- Preserve unrelated dirty-tree changes.
- Prefer Bun for JavaScript/TypeScript workflows: `bun install`, `bun run ...`,
  and `bunx ...`.
- Prefer Rust/Tauri conventions for desktop core code; keep heavy workspace,
  filesystem, terminal, git, search, LSP, database, and secret-handling logic in
  Rust.
- React owns UI rendering only; do not move full file contents, terminal streams,
  large diffs, large search results, LSP caches, database result sets, or secrets
  into global React state.
- Keep one primary WebView for the main workbench. Do not create one WebView per
  workspace.
- Lazy-load heavy UI surfaces: Monaco, xterm.js, markdown preview, database
  tables, and browser preview.
- During this goal run, git staging and commit operations are explicitly
  authorized inside `/Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide` only. Commit after
  each verified roadmap node or coherent milestone with a message that names the
  node/milestone and verification performed.
- Do not commit changes outside this repo, ignored artifacts, secrets,
  credentials, private logs, or unrelated dirty-tree changes.
- Do not run destructive git commands such as reset, checkout, clean, rebase, or
  history rewrite unless the user explicitly authorizes that exact operation.
- Do not transmit project files, secrets, credentials, database contents, or
  private logs to external services unless the user explicitly approves the
  exact destination and data.
- If blocked by credentials, missing OS-level dependencies, WebView2/runtime
  limitations, unavailable Windows verification, missing services, or environment
  limits, stop and report the exact blocker, the node affected, and the next
  user decision needed.

Execution:
- Work node by node in roadmap order. Do not jump ahead unless a later node is
  needed to satisfy an earlier node's acceptance criteria.
- Before editing a node, read its roadmap scope, acceptance criteria, relevant
  docs, and existing code path.
- For Node 0, follow
  `docs/superpowers/plans/2026-06-08-node-0-architecture-spike.md` task by task.
- For each later roadmap node, first create or update a focused implementation
  plan under a concrete path such as
  `docs/superpowers/plans/2026-06-08-node-1-workbench-core.md`.
- Each node plan must define files to create/modify, tests/checks, measurable
  acceptance criteria, rollback-safe boundaries, and how frontend work maps to
  `docs/ui-design/` when UI is affected.
- Add or update focused tests before implementation when feasible.
- Make the smallest coherent change that satisfies the current node.
- Use existing project patterns and helpers before adding new abstractions.
- Keep the roadmap and architecture docs current when decisions change.
- Keep a concise progress record in `docs/architecture/progress.md` with:
  - node started/completed
  - major files changed
  - verification commands and results
  - blockers and decisions
  - residual risks
- After completing a node, update `roadmap.md` with evidence that the node's
  acceptance criteria are satisfied.
- Commit verified node or milestone changes from this repo only, unless the node
  produced no file changes.
- Continue to the next node automatically after a node is verified, unless a
  blocker or user approval gate is reached.

Verification:
- For JavaScript/TypeScript changes, run the most relevant available commands,
  preferring:
  - `bun run build`
  - `bun run typecheck` if present
  - `bun run lint` if present
  - targeted test scripts if present
- For Rust/Tauri changes, run:
  - `cargo test --manifest-path src-tauri/Cargo.toml` when `src-tauri/Cargo.toml`
    exists
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check` when applicable
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
    when dependencies and platform allow it
- For desktop integration, run:
  - `bun run tauri build --debug` when the Tauri project exists and the local
    environment supports it
- For UI behavior, run a real smoke check when feasible:
  - launch the app
  - verify the workbench renders
  - verify workspace switching
  - verify no additional main WebView is created per workspace
  - verify lazy surfaces load only when opened
- For performance-sensitive nodes, record measured startup, memory, latency, and
  process-count evidence in docs.
- If a verification command is unavailable, report the exact command, why it
  could not run, and the best lower-confidence check performed instead.

Done when:
- Every roadmap node from Node 0 through Node 13 has implementation evidence,
  verification results, and updated documentation.
- Yuuzu-IDE launches as a Tauri desktop app on the available development
  platform.
- The app supports multi-workspace workbench behavior, file explorer/search,
  editing, terminal/tasks, git workflows, docs context, language intelligence,
  agent workbench, browser preview or documented deferral, database tools,
  SSH/SFTP, debugging, extension/customization foundations, and hardening items
  at the level described by `roadmap.md`.
- Node acceptance criteria in `roadmap.md` are either satisfied or explicitly
  marked blocked with exact blockers and user decisions needed.
- Relevant tests, builds, and smoke checks pass, or any failures are documented
  with exact reproduction and next steps.
- No unrelated files are changed.
- Final report includes:
  - completed roadmap nodes
  - changed files grouped by subsystem
  - verification commands and results
  - performance measurements
  - skipped commit steps, if commits were not authorized
  - blockers, residual risks, and recommended next decisions.
```

## Notes

- This is intentionally a master goal. If a Goal run becomes too broad for the
  current context budget, the agent should finish the current roadmap node,
  update `docs/architecture/progress.md`, and resume from the next incomplete
  node in a fresh Goal run.
- Commit permission is not assumed. Grant it explicitly in the Goal run if you
  want autonomous commits.
