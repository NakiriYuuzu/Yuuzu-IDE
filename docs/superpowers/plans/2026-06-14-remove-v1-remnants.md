# Remove v1 Remnants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all remaining v1 runtime and active-test remnants so Yuuzu IDE has one frontend shell, v2, with no active `src/app/` tree.

**Architecture:** Keep v2 runtime unchanged: `src/App.tsx` renders `WorkbenchV2`, and `src/v2/*` remains the only shell. The reusable non-v1 support modules that were stranded under `src/app/` are moved into feature-owned locations, imports are updated, and the `src/app/` directory plus stale v1 comments are removed. Historical architecture/report docs may keep old v1 references unless they claim current runtime behavior.

**Tech Stack:** React 19, TypeScript 6, Bun test/preload, Vite 8, Zustand, existing `src/v2` and `src/features/*` modules.

---

## Scope And Control Rules

**In scope**

- Remove or relocate all active files under `src/app/`.
- Keep deleted v1 shell files deleted: `AppShell.tsx`, `CommandPalette.tsx`, `activity-rail.tsx`, `command-registry.ts`, `editor-buffer-state.ts`, `workspace-bootstrap.ts`, `workspace-switcher.tsx`, and their tests.
- Update active imports so no source or active test imports from `../../app/*`.
- Update test preload path from `src/app/test-dom.preload.ts` to a non-v1 location.
- Update tests that explicitly import `ensureTestDom` from `src/app/test-dom`.
- Update current-status comments/docs that still describe v1 sources as present.
- Verify with focused and full frontend gates.

**Out of scope unless explicitly expanded**

- Do not rewrite historical roadmap, audit, or report documents that mention `AppShell` as past context.
- Do not remove `workspace-view-state` behavior simply because v2 no longer imports it; feature tests still use it to protect shared models.
- Do not touch Rust command behavior.
- Do not redesign v2.

**Strict gates**

- After every move, run the smallest relevant test first.
- No broad deletion until imports are updated and focused tests pass.
- The final active-reference scan must not return active source references to `src/app/`, `AppShell`, `CommandPalette`, `activity-rail`, `command-registry`, `workspace-bootstrap`, `workspace-switcher`, or `editor-buffer-state`, except historical docs and fixture strings explicitly reviewed below.
- Final verification must pass:

```bash
bun test src/features/workspace src/features/tasks/task-model.test.ts src/v2/
bun test
bunx tsc --noEmit
bun run build
```

---

## Pre-Execution State Snapshot

- `src/App.tsx` already renders `WorkbenchV2`.
- v1 shell files are already deleted in the working tree.
- Before this cleanup, active remaining `src/app/` files were:
  - `src/app/test-dom.ts`
  - `src/app/test-dom.preload.ts`
  - `src/app/workspace-store.ts`
  - `src/app/workspace-store.test.ts`
  - `src/app/workspace-view-state.ts`
  - `src/app/workspace-view-state.test.ts`
- Before this cleanup, active imports that still pointed at `src/app/` were:
  - `src/features/workspace/FileTreePanel.tsx`
  - `src/features/workspace/SearchPanel.tsx`
  - `src/features/workspace/file-tree-model.ts`
  - `src/features/tasks/task-model.test.ts`
  - `bunfig.toml`
  - panel/render tests that import `ensureTestDom` from `../app/test-dom` or `../../app/test-dom`

---

## File Structure

**Move**

- Move: `src/app/test-dom.ts` -> `src/test/test-dom.ts`
- Move: `src/app/test-dom.preload.ts` -> `src/test/test-dom.preload.ts`
- Move: `src/app/workspace-store.ts` -> `src/features/workspace/workspace-store.ts`
- Move: `src/app/workspace-store.test.ts` -> `src/features/workspace/workspace-store.test.ts`
- Move: `src/app/workspace-view-state.ts` -> `src/features/workspace/workspace-view-state.ts`
- Move: `src/app/workspace-view-state.test.ts` -> `src/features/workspace/workspace-view-state.test.ts`

**Modify**

- Modify: `bunfig.toml`
- Modify: `src/App.tsx`
- Modify: `src/features/workspace/FileTreePanel.tsx`
- Modify: `src/features/workspace/SearchPanel.tsx`
- Modify: `src/features/workspace/file-tree-model.ts`
- Modify: `src/features/tasks/task-model.test.ts`
- Modify: `src/features/agents/AgentPanel.test.tsx`
- Modify: `src/features/agents/agent-model.test.ts`
- Modify: `src/features/docs/DocsPanel.tsx`
- Modify: `src/index.css`
- Modify: `docs/code-review/change-report-ide-v2-real-wiring-2026-06-13.html`
- Modify: `docs/superpowers/plans/2026-06-13-v2-wiring-master-plan.md`

**Delete**

- Delete the now-empty `src/app/` directory after moves.

---

## Task 1: Move Test DOM Preload Out Of `src/app`

**Files:**

- Move: `src/app/test-dom.ts` -> `src/test/test-dom.ts`
- Move: `src/app/test-dom.preload.ts` -> `src/test/test-dom.preload.ts`
- Modify: `bunfig.toml`
- Modify: tests importing `ensureTestDom` from `src/app/test-dom`

- [x] **Step 1: Create the new test support directory**

Run:

```bash
mkdir -p src/test
```

Expected: command exits 0.

- [x] **Step 2: Move the DOM setup files**

Run:

```bash
mv src/app/test-dom.ts src/test/test-dom.ts
mv src/app/test-dom.preload.ts src/test/test-dom.preload.ts
```

Expected: both files move; `src/app/test-dom*.ts` no longer exists.

- [x] **Step 3: Update the preload import**

Change `src/test/test-dom.preload.ts` to keep the local import:

```ts
// bun test preload (see bunfig.toml): make the DOM available before any test
// file evaluates so @testing-library/dom binds `screen` to a real document.
import { ensureTestDom } from "./test-dom";

ensureTestDom();
```

Expected: no path change is needed inside the moved preload because both files moved together.

- [x] **Step 4: Update `bunfig.toml`**

Replace the current preload block with:

```toml
# Bun test runner config.
# Register the happy-dom globals BEFORE any test file loads. @testing-library/dom
# binds `screen` to `document` at module-evaluation time, so the DOM must exist
# before the first test file imports testing-library.
[test]
preload = ["./src/test/test-dom.preload.ts"]
```

Expected: no mention of deleted v1 `AppShell` remains in `bunfig.toml`.

- [x] **Step 5: Verify DOM preload still works**

Update explicit test DOM imports:

```bash
perl -pi -e 's#\.\./app/test-dom#../test/test-dom#g; s#\.\./\.\./app/test-dom#../../test/test-dom#g' $(rg -l "\.\./app/test-dom|\.\./\.\./app/test-dom" src)
```

Expected: panel/render tests now import from `src/test/test-dom`.

- [x] **Step 6: Verify DOM preload still works**

Run:

```bash
bun test src/v2/SidePanel.test.tsx src/features/browser/BrowserPanel.test.tsx
```

Expected: PASS, proving Testing Library still sees a DOM before test evaluation.

---

## Task 2: Move Workspace Registry Store Into Workspace Feature

**Files:**

- Move: `src/app/workspace-store.ts` -> `src/features/workspace/workspace-store.ts`
- Move: `src/app/workspace-store.test.ts` -> `src/features/workspace/workspace-store.test.ts`
- Modify: `src/features/workspace/FileTreePanel.tsx`
- Modify: `src/features/workspace/SearchPanel.tsx`

- [x] **Step 1: Move store and test files**

Run:

```bash
mv src/app/workspace-store.ts src/features/workspace/workspace-store.ts
mv src/app/workspace-store.test.ts src/features/workspace/workspace-store.test.ts
```

Expected: files exist under `src/features/workspace/`; old paths do not exist.

- [x] **Step 2: Fix imports inside `workspace-store.ts`**

Change the workspace API import to:

```ts
import type {
  Workspace,
  WorkspaceRegistry,
} from "./workspace-api";
```

Expected: the moved file no longer imports through `../features/...`.

- [x] **Step 3: Fix feature component imports**

In `src/features/workspace/FileTreePanel.tsx`, replace:

```ts
import { useWorkspaceStore } from "../../app/workspace-store";
```

with:

```ts
import { useWorkspaceStore } from "./workspace-store";
```

In `src/features/workspace/SearchPanel.tsx`, replace:

```ts
import { useWorkspaceStore } from "../../app/workspace-store";
```

with:

```ts
import { useWorkspaceStore } from "./workspace-store";
```

Expected: workspace feature components import the store from their own feature folder.

- [x] **Step 4: Verify workspace store tests**

Run:

```bash
bun test src/features/workspace/workspace-store.test.ts
```

Expected: PASS.

---

## Task 3: Move Workspace View State Into Workspace Feature

**Files:**

- Move: `src/app/workspace-view-state.ts` -> `src/features/workspace/workspace-view-state.ts`
- Move: `src/app/workspace-view-state.test.ts` -> `src/features/workspace/workspace-view-state.test.ts`
- Modify: `src/features/workspace/file-tree-model.ts`
- Modify: `src/features/tasks/task-model.test.ts`

- [x] **Step 1: Move view-state files**

Run:

```bash
mv src/app/workspace-view-state.ts src/features/workspace/workspace-view-state.ts
mv src/app/workspace-view-state.test.ts src/features/workspace/workspace-view-state.test.ts
```

Expected: files exist under `src/features/workspace/`; old paths do not exist.

- [x] **Step 2: Fix imports inside `workspace-view-state.ts`**

Because the file moved from `src/app` to `src/features/workspace`, replace every `../features/<name>/...` import with `../<name>/...`.

Example before:

```ts
import {
  createAgentState,
  type AgentViewState,
} from "../features/agents/agent-model";
```

Example after:

```ts
import {
  createAgentState,
  type AgentViewState,
} from "../agents/agent-model";
```

Apply the same pattern for:

```ts
../docs/docs-model
../files/file-model
../language/language-model
../browser/browser-model
../database/database-model
../debug/debug-model
../diagnostics/diagnostics-model
../extensions/extension-model
../remote/remote-model
../recovery/recovery-model
../settings/settings-model
../git/git-model
../tasks/task-model
../terminal/terminal-model
../git/git-log-model
```

Expected: `src/features/workspace/workspace-view-state.ts` has no `../features/` import.

Apply the same replacement in `src/features/workspace/workspace-view-state.test.ts` after moving it.

- [x] **Step 3: Remove v1 wording from the `ActivityId` comment**

Replace this comment:

```ts
// Inlined from the removed v1 activity rail; the view-state store still keys
// per-workspace panel selection by this id.
```

with:

```ts
// Workspace-scoped panel selection ids kept for feature model tests and
// persisted view-state compatibility.
```

Expected: the type remains unchanged; the comment no longer frames this as v1 residue.

- [x] **Step 4: Fix imports from moved view state**

In `src/features/workspace/file-tree-model.ts`, replace:

```ts
import type { Surface } from "../../app/workspace-view-state";
```

with:

```ts
import type { Surface } from "./workspace-view-state";
```

In `src/features/tasks/task-model.test.ts`, replace:

```ts
import { createWorkspaceViewStore } from "../../app/workspace-view-state";
```

with:

```ts
import { createWorkspaceViewStore } from "../workspace/workspace-view-state";
```

Expected: no active source imports `workspace-view-state` from `src/app`.

- [x] **Step 5: Verify moved view-state tests**

Run:

```bash
bun test src/features/workspace/workspace-view-state.test.ts src/features/tasks/task-model.test.ts
```

Expected: PASS.

---

## Task 4: Remove Stale v1 Shell Messaging From Active App And Current Reports

**Files:**

- Modify: `src/App.tsx`
- Modify: `docs/code-review/change-report-ide-v2-real-wiring-2026-06-13.html`
- Modify: `docs/superpowers/plans/2026-06-13-v2-wiring-master-plan.md`

- [x] **Step 1: Update `src/App.tsx`**

Replace the stale comment that said v1 sources remained under `src/app/` with:

```ts
// v2 (Yuzu redesign) is the only frontend shell.
```

Expected: `src/App.tsx` no longer says v1 sources remain.

- [x] **Step 2: Update the current v2 real-wiring report**

In `docs/code-review/change-report-ide-v2-real-wiring-2026-06-13.html`, replace the current-status sentence that says `src/app/` still contains feature-layer dependencies with wording that matches the post-cleanup state:

```html
<p>依指示「直接替代 v1，開始執行」：<strong>v2 成為唯一 shell</strong>（App.tsx 不再載入 v1；v1 shell 原始碼已自 repo 移除（14 檔，含 9.9k 行 AppShell 與其測試）；原先暫留在 <code>src/app/</code> 的共用測試與 workspace state 支援已移入非 v1 路徑），並把 v2 接上<strong>真實 Tauri 後端</strong> — 完全重用已驗證的 feature api 層，零後端改動。最後依追加需求把 <strong>macOS 原生紅綠燈直接內建到 v2 title bar</strong>（titleBarStyle: Overlay），消除雙層紅綠燈。</p>
```

Expected: this current report no longer describes active `src/app/` remnants as present.

- [x] **Step 3: Update the v2 wiring master plan status**

In `docs/superpowers/plans/2026-06-13-v2-wiring-master-plan.md`, add one status sentence after the SP4 actual result:

```markdown
Post-cleanup target: v1 shell and the transitional `src/app/` support location are removed from active source; reusable workspace/test support lives under feature or test-owned paths.
```

Expected: the current v2 plan records the cleanup goal without rewriting old historical node plans.

- [x] **Step 4: Verify current app import**

Run:

```bash
bunx tsc --noEmit
```

Expected: PASS.

---

## Task 5: Delete The Empty `src/app` Directory And Confirm v1 Is Not Active

**Files:**

- Delete: `src/app/` directory if empty

- [x] **Step 1: Confirm no files remain under `src/app`**

Run:

```bash
find src/app -maxdepth 2 -type f -print
```

Expected: no output. If files remain, stop and classify them before deleting.

- [x] **Step 2: Remove the empty directory**

Run:

```bash
rmdir src/app
```

Expected: command exits 0. If it fails because the directory is not empty, stop and inspect.

- [x] **Step 3: Scan active source for `src/app` imports**

Run:

```bash
rg -n "src/app/|\\.\\./\\.\\./app/|\\.\\./app/" src bunfig.toml package.json tsconfig.json vite.config.ts
```

Expected: no active import/config matches. If this finds test fixture strings such as `src/app/AppShell.tsx`, replace them with a v2 fixture path like `src/v2/Workbench.tsx`.

- [x] **Step 4: Scan active source for deleted v1 shell symbols**

Run:

```bash
rg -n "AppShell|activity-rail|command-registry|workspace-bootstrap|workspace-switcher|editor-buffer-state" src bunfig.toml package.json tsconfig.json vite.config.ts
```

Expected: no matches except intentional historical docs outside this active-source scan. `CommandPalette` is not part of this scan because v2 owns a current `CommandPalette` component in `src/v2/Overlays.tsx`.

---

## Task 6: Full Verification And Report

**Files:**

- No code files unless a verification failure requires a fix.

- [x] **Step 1: Run focused workspace/v2 gate**

Run:

```bash
bun test src/features/workspace src/features/tasks/task-model.test.ts src/v2/
```

Expected: PASS.

- [x] **Step 2: Run full frontend tests**

Run:

```bash
bun test
```

Expected: PASS, currently expected baseline is 530 tests or the new equivalent count after file moves.

- [x] **Step 3: Run TypeScript gate**

Run:

```bash
bunx tsc --noEmit
```

Expected: PASS.

- [x] **Step 4: Run production build**

Run:

```bash
bun run build
```

Expected: PASS.

- [x] **Step 5: Final git status audit**

Run:

```bash
git status --short
git diff --name-status -- src/App.tsx src/app src/test src/features/workspace src/features/tasks/task-model.test.ts bunfig.toml docs/code-review/change-report-ide-v2-real-wiring-2026-06-13.html docs/superpowers/plans/2026-06-13-v2-wiring-master-plan.md
```

Expected:

- `src/app/*` moved/deleted.
- `src/test/*` added.
- workspace store/view-state files moved to `src/features/workspace/`.
- no unexpected unrelated file edits introduced by this cleanup.

- [x] **Step 6: Closeout report**

Report in Traditional Chinese:

- What was moved.
- What was deleted.
- Which active scans prove v1 is inactive.
- Verification commands and outcomes.
- Any residual historical docs that still mention v1/AppShell and why they were left untouched.

---

## Self-Review

**Spec coverage**

- Requirement: remove v1 parts completely from active system.
  - Covered by Tasks 1-5: move non-v1 support out of `src/app`, delete `src/app`, scan active imports and shell symbols.
- Requirement: detailed plan first.
  - Covered by this document.
- Requirement: strict control.
  - Covered by strict gates, focused tests after each move, final scans, full tests, typecheck, and build.

**Placeholder scan**

- No unresolved placeholder markers.
- No vague deferred-work markers.
- No unbounded edge-case instruction.
- Every code-changing step includes exact paths and exact replacement text or command.

**Type consistency**

- `workspace-store.ts` moves into `src/features/workspace/` and imports `./workspace-api`.
- `workspace-view-state.ts` moves into `src/features/workspace/` and imports sibling feature modules through `../<feature>/...`.
- `file-tree-model.ts` imports `Surface` from `./workspace-view-state`.
- `task-model.test.ts` imports `createWorkspaceViewStore` from `../workspace/workspace-view-state`.

---

## Execution Choice

Recommended execution mode: inline execution in this session with checkpoint after each task, because the cleanup is narrow but touches import paths and test config.

Alternative: subagent-driven execution with one worker for Tasks 1-3 and a separate reviewer for Tasks 4-6, if independent review is preferred before final deletion.
