---
name: yuuzu-ide-verification-planner
description: Plan and select Yuuzu-IDE verification commands for bugfix, ui-runtime, release, docs-status, smoke-report, and review tasks. Use this whenever a Yuuzu-IDE task mentions verification, testing, tauri-debug-build, smoke reports, Git Graph revalidation, focused or broad gates, or when code changes need an evidence-backed closeout.
---

# Yuuzu-IDE Verification Planner

Use this skill to choose the fastest verification that still proves the changed behavior in Yuuzu-IDE.

## Start here

1. Classify the task using the repo labels from `AGENTS.md`: `tiny`, `bugfix`, `feature`, `ui-runtime`, `refactor`, `docs-status`, `review`, `release`, or `protocol`.
2. Lock the likely files and explicitly name out-of-scope areas.
3. Read `references/verification-matrix.md` and pick the smallest credible gate.
4. Prefer focused tests first. Broaden only when the changed contract crosses module, Rust IPC, build, or runtime boundaries.
5. In the closeout, state which commands were run, what they proved, and which relevant gates were intentionally skipped.

## Verification tiers

- Focused test: one or more adjacent Bun or Cargo tests that directly cover the behavior.
- Broad frontend: `bun test` and `bun run build` when TypeScript, shared state, or rendered UI contracts changed.
- Rust/Tauri: targeted Cargo tests first, then fmt/clippy or debug build when backend IPC or app packaging changed.
- Runtime smoke: packaged debug app plus Computer Use when visual behavior, macOS permissions, clipboard, window lifecycle, terminal, browser, or Git Graph stability cannot be proven by tests alone.
- Release gate: the full local gate from `AGENTS.md` before replacing a local app bundle.

## Output format

When asked for a plan, answer with:

```text
Task class:
Scope:
Focused verification:
Broader verification:
Runtime smoke:
Skipped gates:
Success criteria:
```

When closing out after implementation, answer with only the commands actually run and the observed result. Do not claim an unrun gate passed.
