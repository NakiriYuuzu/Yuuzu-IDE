---
name: yuuzu-ide-skill-eval-feedback
description: Evaluate and improve repo-local Yuuzu-IDE testing skills. Use this when creating or updating skills under .codex/skills/, adding evals/evals.json, comparing with-skill and baseline outputs, or collecting feedback on which Yuuzu-IDE test methods are slow, flaky, redundant, unsafe, or missing runtime coverage.
---

# Yuuzu-IDE Skill Eval Feedback

Use this skill to keep the project testing skills useful instead of letting them become static documentation.

## Workflow

1. Identify the skill under review and read its `SKILL.md`.
2. Read that skill's `evals/evals.json`.
3. Read `references/eval-feedback-rubric.md`.
4. Validate the evals statically before launching any run:
   - JSON parses.
   - `skill_name` matches frontmatter.
   - prompts are realistic Yuuzu-IDE tasks.
   - expected outputs are checkable.
   - expectations can reveal bad testing advice, not just keyword presence.
5. Only run with-skill/baseline eval agents when the user explicitly asks for eval execution or delegated skill benchmarking.
6. When eval outputs exist, grade them against expectations and add feedback about the testing method itself: speed, reliability, safety, evidence quality, and missing coverage.

## Feedback output

Use this shape:

```text
Skill:
Eval coverage:
Pass/fail signals:
Test-method issues:
Optimization proposals:
Run next:
```

Optimization proposals should be actionable, for example:

- Replace broad `bun test` first steps with a focused adjacent test.
- Add a runtime smoke only for visual/packaged-app behavior.
- Split a flaky UI smoke into one deterministic component test plus one smaller real-app probe.
- Add a Rust workspace-boundary test when a frontend test only mocks IPC.
