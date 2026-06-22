---
name: yuuzu-ide-focused-regression-tests
description: Add or update focused Yuuzu-IDE regression tests for v2 React, store/controller/bridge logic, CodeMirror editor behavior, and Rust IPC. Use this whenever a Yuuzu-IDE bugfix or feature needs TDD, a failing test before implementation, adjacent Bun/Cargo coverage, or faster test authoring.
---

# Yuuzu-IDE Focused Regression Tests

Use this skill when the task needs a focused test before or alongside a Yuuzu-IDE fix.

## Workflow

1. Identify the behavior, not just the file. Name the state transition, UI action, IPC command, or rendering contract that failed.
2. Read `references/regression-test-patterns.md` and choose the closest existing test layer.
3. Add the smallest failing test that would have caught the bug.
4. Run only that focused test first and confirm it fails for the right reason when practical.
5. Implement the minimum fix, rerun the focused test, then broaden based on blast radius.
6. Keep temporary smoke tests out of the final tree unless the behavior is worth keeping permanently.

## Test placement rule

- Pure mapping belongs in `src/v2/bridge.test.ts` or model tests.
- Store/controller behavior belongs in `src/v2/v2-store.test.ts`, `src/v2/folder-expand.test.ts`, or another adjacent v2 test.
- Rendered UI actions belong in the nearest `*.test.tsx`.
- CodeMirror extension/theme contracts belong in `src/v2/editor/editor-surface.test.ts` or `src/v2/v2-model.test.ts`.
- Rust workspace, filesystem, Git, database, browser, and clipboard commands should get inline Rust tests in the owning module, not only frontend mocks.

## Closeout

Report the exact failing-to-passing path if you observed it:

```text
Regression test:
- RED: bun test src/v2/folder-expand.test.ts -> expected reload count 0, got 1
- GREEN: bun test src/v2/folder-expand.test.ts -> 22 pass, 0 fail
```

If you could not observe the red state because the fix already existed or the test is for a previously verified bug, say that explicitly.
