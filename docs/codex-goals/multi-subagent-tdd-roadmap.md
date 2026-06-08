# Yuuzu-IDE Multi-Subagent TDD Roadmap Goal Prompt

Paste the prompt below into Codex Goal mode when you want Codex to execute the
Yuuzu-IDE roadmap with a repeated cycle:

1. Plan the next roadmap node with `superpowers:writing-plans`.
2. Execute the plan using Multi-Subagent-Driven Development.
3. Enforce TDD for implementation work.
4. Verify, document progress, then return to planning for the next node.

## Paste-Ready Command

Use [start-multi-subagent-tdd-goal.md](./start-multi-subagent-tdd-goal.md) for
the actual one-line `/goal <objective>` command. The contract below is the file
that command tells Codex to read and follow.

## Operating Contract

```text
Goal:
Implement Yuuzu-IDE roadmap nodes sequentially using a repeated
Writing-Plans then Multi-Subagent-Driven Development then TDD then Verification loop
until every node in `roadmap.md` is complete, verified, and documented.

Context:
- Repo: /Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide
- Read first:
  - roadmap.md
  - docs/architecture/tech-stack.md
  - docs/superpowers/plans/2026-06-08-node-0-architecture-spike.md
  - docs/codex-goals/complete-roadmap.md
  - docs/ui-design/scratchpad.md
  - docs/ui-design/app.jsx
  - docs/ui-design/panels.jsx
  - docs/ui-design/data.jsx
  - docs/ui-design/ide.css
- Required process skills:
  - Use `superpowers:writing-plans` before starting each new roadmap node.
  - Use `superpowers:subagent-driven-development` to execute each completed
    implementation plan.
  - Use `superpowers:test-driven-development` for all feature, bugfix,
    refactor, and behavior-change implementation work.
- Existing conventions: follow AGENTS.md and local project docs.
- Product direction: Yuuzu-IDE is a Windows-capable, Rust-first Tauri 2 desktop
  IDE using Vite, React, TypeScript, shadcn/ui, Monaco Editor, xterm.js, and Rust
  core services.
- UI source of truth: frontend implementation must use `docs/ui-design/`,
  especially `app.jsx`, `panels.jsx`, `data.jsx`, `ide.css`, and
  `scratchpad.md`, as the required product/workbench design reference.
- Current behavior: the repo contains roadmap, architecture docs, UI design
  references, and a detailed Node 0 plan; app scaffolding may not exist yet.
- Expected behavior: each roadmap node is implemented through a documented,
  test-first, reviewed subagent workflow with measurable evidence.

Constraints:
- Work strictly in roadmap order unless a later item is required to satisfy the
  current node's acceptance criteria.
- Before implementing a roadmap node, create or update a concrete implementation
  plan under `docs/superpowers/plans/`.
- Do not implement a node from memory or informal notes if no current plan exists
  for that node.
- Execute each plan task with a fresh implementer subagent and then run two
  review passes: spec-compliance reviewer first, code-quality reviewer second.
- Do not dispatch multiple implementation subagents in parallel when they may
  edit overlapping files or shared state.
- Use parallel subagents only when the plan proves the tasks are independent,
  have explicit non-overlapping file boundaries, and can be reviewed/merged at a
  checkpoint before any dependent task starts.
- Enforce TDD: production behavior changes require a failing test first, the
  failure must be observed for the expected reason, then minimal implementation,
  then passing tests.
- If implementation code is written before the failing test, delete that
  implementation and restart the task with TDD.
- Preserve existing `docs/ui-design/**` artifacts unless a change is required to
  wire the design into the app or keep docs accurate. Do not replace the design
  direction with a generic IDE layout.
- Preserve unrelated dirty-tree changes.
- Prefer Bun for JavaScript/TypeScript workflows: `bun install`, `bun run ...`,
  and `bunx ...`.
- Keep heavyweight workspace, filesystem, terminal, git, search, LSP, database,
  secret handling, and persistence logic in Rust.
- React owns UI rendering only. Do not put full file contents, terminal streams,
  large diffs, large search results, LSP caches, database result sets, or secrets
  in global React state.
- Keep one primary WebView for the main workbench. Do not create one WebView per
  workspace.
- Lazy-load heavy UI surfaces: Monaco, xterm.js, markdown preview, database
  tables, and browser preview.
- During this Goal run, git staging and commit operations are explicitly
  authorized inside `/Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide` only. Commit after
  each verified roadmap node or coherent milestone with a message that names the
  node/milestone and verification performed.
- Do not commit changes outside this repo, ignored artifacts, secrets,
  credentials, private logs, or unrelated dirty-tree changes.
- Do not run destructive git commands such as reset, checkout, clean, rebase, or
  history rewrite unless the user explicitly authorizes that exact operation.
- Do not transmit project files, secrets, credentials, database contents, or
  private logs to external services unless the user explicitly approves the
  exact data and destination.
- If blocked by credentials, missing OS-level dependencies, WebView2/runtime
  limitations, unavailable Windows verification, missing services, or environment
  limits, stop and report the exact blocker, affected node, and next user
  decision needed.

Execution:
- Start by inspecting the current repo state and identifying the first incomplete
  roadmap node.
- If Node 0 is incomplete, execute
  `docs/superpowers/plans/2026-06-08-node-0-architecture-spike.md` first.
- For every later node:
  - Invoke `superpowers:writing-plans`.
  - Write a concrete node plan in `docs/superpowers/plans/`.
  - Self-review the plan for coverage, no unresolved markers, and type/command
    consistency.
  - Include how that node maps to `docs/ui-design/` when it affects frontend UI.
  - Execute the plan with `superpowers:subagent-driven-development`.
- During subagent-driven execution:
  - Extract the current task text and provide it directly to the implementer
    subagent.
  - Require the implementer to follow TDD and report red/green/refactor evidence.
  - If the implementer reports `NEEDS_CONTEXT`, provide context and re-dispatch.
  - If the implementer reports `BLOCKED`, change strategy once: provide missing
    context, split the task, or use a more capable reviewer; if still blocked,
    stop and report.
  - After implementation, dispatch a spec-compliance reviewer.
  - Only after spec compliance passes, dispatch a code-quality reviewer.
  - If either reviewer finds issues, have the implementer fix them and repeat
    the same review gate.
  - Mark the task complete only after both review gates pass.
- Use parallelism for independent research, context gathering, and non-overlap
  implementation batches only when the current plan states the exact file
  boundaries for each batch. After any parallel batch, run a coordinator review
  before continuing.
- After all tasks in a node pass:
  - Run node-level verification.
  - Update `docs/architecture/progress.md`.
  - Update `roadmap.md` with completion evidence for that node.
  - Record measured performance data when relevant.
  - Commit the node or milestone changes from this repo only, unless the node
    produced no file changes.
  - Then return to `superpowers:writing-plans` for the next incomplete roadmap
    node.
- Continue this loop without asking whether to continue unless the node is
  complete, a real blocker occurs, or a user approval gate is reached.

Verification:
- For JavaScript/TypeScript changes, run the most relevant available commands:
  - `bun run build`
  - `bun run typecheck` if present
  - `bun run lint` if present
  - targeted tests if present
- For Rust/Tauri changes, run:
  - `cargo test --manifest-path src-tauri/Cargo.toml` when `src-tauri/Cargo.toml`
    exists
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check` when applicable
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
    when dependencies and platform allow it
- For desktop integration, run:
  - `bun run tauri build --debug` when the Tauri project exists and the local
    environment supports it
- For UI/runtime behavior, perform real smoke checks when feasible:
  - launch the app
  - verify the workbench renders
  - verify workspace switching
  - verify no additional main WebView is created per workspace
  - verify Monaco and xterm load only when opened
- For performance-sensitive nodes, record startup, memory, latency, and
  process-count measurements in architecture docs.
- If a verification command cannot run, report the exact command, the exact
  reason, and the best lower-confidence check performed instead.

Done when:
- Every roadmap node from Node 0 through Node 13 is implemented, reviewed,
  verified, and documented.
- Every completed node has a plan under `docs/superpowers/plans/` unless it is
  Node 0 using the existing plan.
- Every implementation task either followed TDD with observed red/green evidence
  or documents why TDD was not feasible and what user-approved exception applied.
- Every implementation task passed implementer self-review, spec-compliance
  review, and code-quality review.
- `docs/architecture/progress.md` records node completion, major file changes,
  verification results, blockers, decisions, and residual risk.
- `roadmap.md` reflects completed nodes and remaining blockers accurately.
- Relevant tests, builds, smoke checks, and performance checks pass, or failures
  are documented with exact reproduction and next steps.
- No unrelated files are changed.
- Final report includes completed nodes, changed files grouped by subsystem,
  verification evidence, performance measurements, skipped commit steps,
  blockers, residual risks, and recommended next decisions.
```

## Operational Notes

- This goal intentionally uses a strict loop: plan one node, execute with
  subagents and TDD, verify, document, then plan the next node.
- Multi-Subagent-Driven here means role-separated subagents per task:
  implementer, spec-compliance reviewer, and code-quality reviewer. It does not
  mean unsafe parallel edits to overlapping files.
- Commit permission is not assumed. Add an explicit instruction in the Goal run
  if autonomous commits are allowed.
