# Agentic RSI Loop Design

## Status

Draft.

## Purpose

Yuuzu-IDE will adopt an Agentic Recursive Self-Improvement Loop for future
development tasks.

In this project, RSI does not mean model self-training, autonomous
self-replication, or automatic merging. It means a governed engineering loop
where agents improve the project and the development process by turning each
task's evidence, failures, review findings, and lessons into better future
rules, tests, specs, plans, and verification habits.

The goal is to make Yuuzu-IDE development more complete, mature, and stable over
time.

## Non-Goals

- No automatic merge without user approval.
- No automatic permission expansion.
- No autonomous edits outside this repository.
- No secret handling changes unless explicitly scoped.
- No destructive git operations without explicit approval.
- No model training, model fine-tuning, or successor-model development.
- No replacement of human direction-setting, scope approval, or final
  acceptance.

## Core Principle

Every task should improve both:

1. The product itself.
2. The future ability of agents to work safely and correctly on this project.

This means every task should end with not only code or documentation, but also
verified evidence and a short lesson record.

## Default Loop

All non-trivial tasks should follow this loop:

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

Tiny tasks may use a compact version, but they still need scope, verification,
and a brief lesson.

## Loop Stages

### 1. Intent

Clarify what the user wants and classify the task.

Task classes:

- `tiny`: small text, doc, or config change.
- `bugfix`: broken behavior with an expected existing contract.
- `feature`: new user-facing or developer-facing capability.
- `ui-runtime`: visible UI, browser, or packaged app behavior.
- `refactor`: structural change without intended behavior change.
- `docs-status`: read-only audit of documentation or roadmap truth.
- `review`: read-only code review.
- `release`: build, packaging, or daily-driver verification.
- `protocol`: changes to `AGENTS.md`, specs, plans, or agent workflow.

### 2. Scope Lock

Before changing files, define:

- Files or modules likely in scope.
- Files explicitly out of scope.
- Whether the task is read-only.
- Whether commits are allowed.
- Whether browser or Tauri verification is required.
- Whether existing dirty worktree files overlap the task.

Agents must run `git status --short` before edits and must not overwrite
user-owned changes.

### 3. Context Pack

Gather the smallest useful context:

- `AGENTS.md`
- `roadmap.md`
- relevant `docs/architecture/*`
- relevant `docs/superpowers/specs/*`
- relevant `docs/superpowers/plans/*`
- directly touched source files
- tests adjacent to touched files

Do not trust stale checklist state alone. Cross-check docs against source, tests,
and git evidence when completion status matters.

### 4. Spec / Acceptance

For non-trivial work, define acceptance before implementation.

Acceptance must be observable:

- A user-facing behavior is reachable in v2.
- A backend command returns the expected typed payload.
- A regression test fails before the fix and passes after.
- A visual or runtime issue is verified in browser or Tauri app.
- Documentation status is proven by concrete file or code evidence.

### 5. Plan

Plans must be task-sized and test-driven when practical.

Each implementation plan should specify:

- files to create or modify
- focused tests to add or update
- exact commands to run
- expected failure before implementation
- expected pass after implementation
- commit boundary if commits are authorized

### 6. Implementation

Implementation rules:

- Make the smallest change that satisfies acceptance.
- Follow existing repo architecture.
- Keep v2 async orchestration in `src/v2/controller.ts`.
- Keep pure payload mapping in `src/v2/bridge.ts`.
- Keep synchronous v2 UI state in `src/v2/v2-store.ts`.
- Keep Rust domain logic in focused `src-tauri/src/*.rs` modules when possible.
- Avoid expanding `src-tauri/src/commands.rs` with domain logic unless it is
  truly IPC boundary code.
- Preserve trusted workspace boundary checks.
- Preserve destructive git confirmations.
- Preserve database read-only and mutating-SQL confirmation behavior.
- Preserve secret handling through existing keyring-backed stores.

### 7. Verification

Verification must match risk.

Focused examples:

```bash
bun test <focused-test>
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml <focused-filter>
```

Full gate when appropriate:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
bun run tauri build --debug
```

UI and runtime changes require visible verification when feasible:

- browser preview
- Playwright screenshot
- Tauri dev app
- packaged app launch

### 8. Review

Every substantial change should receive a review pass before final acceptance.

Review must check:

- behavioral bugs
- regression risk
- missing tests
- security or workspace-boundary issues
- stale documentation
- v2 reachability
- architecture drift
- user-owned dirty worktree conflicts

Review output should prioritize findings over summaries.

### 9. Integration Decision

The agent must clearly report one of:

- `ready`: verified and review-clean.
- `ready-with-risk`: verified, but residual risk remains.
- `blocked`: cannot safely proceed without user input or external state.
- `rejected`: implementation failed or should not be merged.
- `docs-only`: no code change was made.

Commits, staging, and push only happen when explicitly authorized.

### 10. Lessons

Each task should produce a short lesson record.

Minimum lesson fields:

```text
Task:
Scope:
What worked:
What failed or almost failed:
Tests that mattered:
Review findings:
Future rule proposal:
Should AGENTS.md/spec/plan change? yes/no
```

Lessons are not automatically applied. They become proposals.

### 11. Protocol Update Proposal

If a task reveals a repeatable pattern, the agent may propose updates to:

- `AGENTS.md`
- a spec template
- a plan template
- a focused test helper
- a reviewer checklist
- a roadmap status note

The proposal must explain:

- what problem it prevents
- where it should be recorded
- why it is general enough to keep
- what risk it introduces

Protocol updates require user approval before file edits.

## Agent Roles

### Human Owner

Owns:

- goal selection
- priority
- scope approval
- merge approval
- rollback decision
- permission expansion
- final acceptance

### Context Agent

Owns:

- reading relevant docs and source
- checking dirty worktree
- identifying the live v2 surface
- identifying stale docs risk

### Planner Agent

Owns:

- acceptance criteria
- implementation plan
- test strategy
- file boundary proposal

### Builder Agent

Owns:

- minimal implementation
- local focused tests
- preserving scope

### Verifier Agent

Owns:

- verification commands
- browser and Tauri checks when needed
- evidence summary

### Reviewer Agent

Owns:

- bug review
- security review
- architecture review
- missing-test review

### Curator Agent

Owns:

- lesson extraction
- protocol update proposals
- documentation consistency proposals

## Metrics

Primary maturity metrics:

- percentage of roadmap acceptance reachable in v2
- number of stale-doc findings per audit
- regression test coverage for fixed bugs
- review findings per task
- repeated bug class count
- failed verification count
- rollback count
- manual intervention count
- unresolved protocol proposals

Avoid using lines of code as a primary productivity metric.

## Safety Rules

Agents must stop and ask before:

- destructive git operations
- deleting user-owned work
- changing secrets or credential handling
- widening filesystem access
- weakening verification gates
- skipping tests for non-trivial code changes
- changing `AGENTS.md` rules
- changing roadmap status from incomplete to complete

## First Adoption Target

Use this protocol first on a Node 14 task, preferably one of:

1. v2 Language panel real LSP state.
2. v2 Docs panel port.
3. v2 Debug panel port.

Reason: Node 14 contains known completion gaps where backend capability exists
but v2 reachability must be proven.
