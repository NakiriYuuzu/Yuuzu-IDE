# Eval Feedback Rubric

Use this rubric when reviewing outputs from Yuuzu-IDE testing skills.

## Coverage

- Does the skill choose a test layer that can actually catch the bug?
- Does it cover both frontend and Rust when behavior crosses IPC?
- Does it require runtime smoke only when unit tests cannot prove the behavior?
- Does it include cleanup for temporary files, app processes, and servers?

## Speed

- Does it start with the focused adjacent test?
- Does it avoid running full gates before the first signal?
- Does it broaden only when the changed behavior crosses a boundary?
- Does it reuse existing test files and helpers?

## Reliability

- Are pass conditions observable and specific?
- Does the eval avoid relying on timing or visual impressions when state assertions are available?
- Does it distinguish permission blockers from product failures?
- Does it avoid destructive actions in dirty worktrees?

## Evidence quality

- Are exact commands reported?
- Are pass/fail counts or concrete UI observations included?
- Are skipped gates named with reasons?
- Are runtime probes specific enough to reproduce?

## Safety

- Does the plan avoid staging, committing, pushing, or destructive Git operations unless asked?
- Does it avoid deleting user data in smoke tests?
- Does it respect pre-existing Yuuzu-IDE processes and dirty worktrees?

## Useful feedback examples

```text
The eval requires full `bun test` before any focused signal. Optimize by starting with `bun test src/v2/folder-expand.test.ts`, then broaden to full `bun test` only after the fix crosses shared v2 state.
```

```text
The smoke says "Git Graph did not flicker" but never probes `.git/*` watcher events. Add a `.git/codex-watch-probe.*` create/remove step and assert the detail panel does not return to loading.
```

```text
The Browser capture case marks permission denial as pass. Change the expected result to PERMISSION/blocked and require a later retest after Screen Recording is granted.
```
