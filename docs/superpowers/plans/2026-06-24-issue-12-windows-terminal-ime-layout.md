# Issue 12 Windows Terminal IME Layout Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Windows WebView2 Chinese / Traditional Chinese IME composition from horizontally shifting Yuuzu-IDE terminal panes, AgentZone terminals, or the full workbench.

**Architecture:** Treat the bug as a v2 CSS containment issue first. Add a focused containment regression test that renders the real `TerminalTab` while mocking only its `load-xterm` dependency, then harden `.yz2` terminal and AgentZone flex/grid boundaries in `src/v2/yuzu.css` without changing Rust PTY behavior or xterm.js internals. Keep the existing `TerminalTab` rAF resize coalescing and duplicate-dimension guard unless Windows smoke proves another root cause.

**Tech Stack:** Tauri 2, React 19, TypeScript, Bun test, xterm.js 6, CSS flex/grid containment, Windows WebView2 packaged debug smoke.

---

## Task Class And Scope

Task class: `bugfix` + `ui-runtime`

In scope:

- v2 main terminal containment.
- AgentZone real terminal containment.
- Focused CSS/DOM regression tests.
- Existing terminal resize guard verification.
- Windows packaged debug app IME smoke instructions and evidence note.

Out of scope:

- Terminal Ctrl+C / Ctrl+V behavior; that belongs to issue #15.
- Rust PTY lifecycle or IPC changes.
- Replacing xterm.js.
- Full AgentZone redesign.
- CJK unicode width provider changes unless containment fails in Windows smoke.

Dirty worktree guard:

- Run `git status --short --branch` before implementation.
- Do not stage or commit unless the user explicitly approves the commit gate for this worktree.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/v2/terminal-containment.test.tsx` | New focused test file for terminal/AgentZone DOM containment and required CSS declarations. Renders the real `TerminalTab` and mocks only `load-xterm` so the test does not load xterm or pollute `TerminalTab.test.ts`. |
| `src/v2/yuzu.css` | Only product code change. Adds `min-width: 0`, `overflow: hidden`, `box-sizing`, and xterm max-width guards to terminal and AgentZone containers. |
| `src/features/terminal/TerminalTab.test.ts` | No planned code change. Run existing resize coalescing tests to prove the resize loop guard is already present. |
| `docs/architecture/issue-12-windows-terminal-ime-smoke.md` | Evidence note after runtime smoke. On non-Windows hosts, record that Windows smoke remains required and do not close the issue. |

## Verification Plan

Focused verification:

```bash
bun test src/v2/terminal-containment.test.tsx src/features/terminal/TerminalTab.test.ts
git diff --check
```

Broader verification:

```bash
bun test src/features/terminal src/v2
bun run build
```

Runtime smoke:

```bash
bun run tauri build --debug --bundles app
```

If the debug build creates the app but exits because updater artifacts find a public key without `TAURI_SIGNING_PRIVATE_KEY`, record that failure and rerun the local app bundle build only:

```bash
bun run tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Skipped gates:

- Cargo tests, fmt, and clippy are skipped unless Rust files change.
- Full release gate is skipped unless replacing an installed app bundle.

Success criteria:

- Focused containment test fails before CSS changes and passes after CSS changes.
- Existing terminal resize tests remain green.
- `bun test src/features/terminal src/v2`, `bun run build`, and `git diff --check` pass.
- Windows packaged app smoke confirms normal terminal and AgentZone terminal do not shift horizontally during at least 30 composed Chinese IME characters.

---

### Task 1: Add Failing Terminal Containment Regression

**Files:**
- Create: `src/v2/terminal-containment.test.tsx`

- [ ] **Step 1: Create the focused containment test file**

Create `src/v2/terminal-containment.test.tsx` with this complete content:

```tsx
/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { cleanup, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import type { AzWindow, Tab } from "./v2-model"
import { v2Store } from "./v2-store"

const loadXtermMock = mock(() => new Promise<never>(() => {}))

mock.module("../features/terminal/load-xterm", () => ({
    loadXterm: loadXtermMock,
}))

ensureTestDom()

const { TerminalView } = await import("./ContentViews")
const { AgentZone } = await import("./AgentZone")

const initialState = {
    mode: v2Store.getState().mode,
    active: v2Store.getState().active,
    azWidth: v2Store.getState().azWidth,
    azColsOverride: v2Store.getState().azColsOverride,
    azSplitRatio: v2Store.getState().azSplitRatio,
    order: [...v2Store.getState().order],
    meta: structuredClone(v2Store.getState().meta),
    ui: structuredClone(v2Store.getState().ui),
}

const yuzuCss = readFileSync(new URL("./yuzu.css", import.meta.url), "utf8")
const yuzuCssWithoutComments = yuzuCss.replace(/\/\*[\s\S]*?\*\//g, "")

afterEach(() => {
    cleanup()
    v2Store.setState({
        mode: initialState.mode,
        active: initialState.active,
        azWidth: initialState.azWidth,
        azColsOverride: initialState.azColsOverride,
        azSplitRatio: initialState.azSplitRatio,
        order: [...initialState.order],
        meta: structuredClone(initialState.meta),
        ui: structuredClone(initialState.ui),
    })
})

function cssRuleBodyForSelector(selector: string): string {
    const rules = [...yuzuCssWithoutComments.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    const rule = rules.find((match) =>
        match[1]!.split(",").map((part) => part.trim()).includes(selector),
    )
    expect(rule).toBeTruthy()
    return rule![2]!.replace(/\s+/g, " ").trim()
}

function expectRuleContains(selector: string, declarations: string[]) {
    const body = cssRuleBodyForSelector(selector)
    for (const declaration of declarations) {
        expect(body).toContain(declaration)
    }
}

describe("terminal containment contract", () => {
    test("main terminal renders inside the bounded xterm host chain", () => {
        const tab: Tab = {
            id: 9301,
            type: "cmd",
            title: "zsh",
            sessionId: "workspace:terminal-1",
        }

        const view = render(<TerminalView tab={tab} />)
        const host = view.container.querySelector(
            ".yz2-view .yz2-term .yz2-xterm .terminal-host",
        )

        expect(host).toBeTruthy()
    })

    test("AgentZone real terminals render inside a bounded terminal body", () => {
        const win: AzWindow = {
            id: 9401,
            title: "agent session",
            status: "running",
            lines: [],
            buf: "",
            min: false,
            max: false,
            sessionId: "agent:terminal-1",
        }
        v2Store.setState((s) => ({
            active: "api",
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    wins: [win],
                },
            },
        }))

        const view = render(<AgentZone />)
        const host = view.container.querySelector(
            ".yz2-az-win-body.real .terminal-host",
        )

        expect(host).toBeTruthy()
    })

    test("terminal CSS keeps xterm and IME helper layout inside the workbench", () => {
        expectRuleContains(".yz2-main", [
            "min-width: 0;",
            "overflow: hidden;",
        ])
        expectRuleContains(".yz2-view", [
            "min-width: 0;",
            "overflow: hidden;",
        ])
        expectRuleContains(".yz2-term", [
            "min-width: 0;",
            "overflow: hidden;",
        ])
        expectRuleContains(".yz2-xterm", [
            "min-width: 0;",
            "overflow: hidden;",
            "width: 100%;",
        ])
        expectRuleContains(".yz2 .terminal-host", [
            "box-sizing: border-box;",
            "min-width: 0;",
            "overflow: hidden;",
        ])
        expectRuleContains(".yz2 .terminal-host .xterm", [
            "max-width: 100%;",
        ])
        expectRuleContains(".yz2 .terminal-host .xterm-viewport", [
            "max-width: 100%;",
        ])
        expectRuleContains(".yz2 .terminal-host .xterm-screen", [
            "max-width: 100%;",
        ])
    })

    test("AgentZone CSS prevents terminal windows from forcing horizontal layout", () => {
        expectRuleContains(".yz2-az", [
            "min-width: 0;",
            "overflow: hidden;",
        ])
        expectRuleContains(".yz2-az-head", [
            "min-width: 0;",
        ])
        expectRuleContains(".yz2-az-canvas", [
            "min-width: 0;",
        ])
        expectRuleContains(".yz2-az-grid", [
            "min-width: 0;",
        ])
        expectRuleContains(".yz2-az-win", [
            "min-width: 0;",
            "overflow: hidden;",
        ])
        expectRuleContains(".yz2-az-win-body", [
            "min-width: 0;",
        ])
        expectRuleContains(".yz2-az-win-body.real", [
            "min-width: 0;",
            "overflow: hidden;",
            "display: flex;",
        ])
    })
})
```

- [ ] **Step 2: Run the new focused test and verify it fails**

Run:

```bash
bun test src/v2/terminal-containment.test.tsx
```

Expected: FAIL. The failure should come from missing CSS declarations, for example `.yz2-main` or `.yz2-view` not containing `min-width: 0;` / `overflow: hidden;`.

- [ ] **Step 3: Run the existing terminal resize tests as baseline**

Run:

```bash
bun test src/features/terminal/TerminalTab.test.ts
```

Expected: PASS. This proves the existing rAF resize coalescing and duplicate-dimension guard are already present before CSS work.

---

### Task 2: Add Main Terminal CSS Containment

**Files:**
- Modify: `src/v2/yuzu.css`
- Test: `src/v2/terminal-containment.test.tsx`

- [ ] **Step 1: Update the main workbench flex boundary**

In `src/v2/yuzu.css`, replace the one-line `.yz2-main` rule with:

```css
.yz2-main { flex: 1; display: flex; min-width: 0; min-height: 0; overflow: hidden; }
```

- [ ] **Step 2: Update the generic view boundary**

In `src/v2/yuzu.css`, replace the existing `.yz2-view` block with:

```css
.yz2-view {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: yzIn 0.18s ease;
}
```

- [ ] **Step 3: Update terminal tab containment rules**

In `src/v2/yuzu.css`, replace the existing terminal rules around `.yz2-term`, `.yz2-xterm`, and `.terminal-host` with:

```css
/* terminal */
.yz2-term {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--yz-090c12);
}
.yz2-xterm {
    flex: 1;
    min-width: 0;
    min-height: 0;
    width: 100%;
    display: flex;
    overflow: hidden;
}
.yz2 .terminal-host {
    background: var(--yz-090c12);
    padding: 10px 14px;
    box-sizing: border-box;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
}
.yz2 .terminal-host .xterm,
.yz2 .terminal-host .xterm-viewport,
.yz2 .terminal-host .xterm-screen {
    max-width: 100%;
}
```

Keep the existing `.yz2 .terminal-failure`, `.yz2-ed-loading`, `.yz2-term-scroll`, and `.yz2-term-foot` blocks below this section unchanged.

- [ ] **Step 4: Run focused containment test and inspect the remaining failure**

Run:

```bash
bun test src/v2/terminal-containment.test.tsx
```

Expected: FAIL only on AgentZone CSS containment assertions. The main terminal DOM and CSS assertions should pass.

---

### Task 3: Add AgentZone Terminal CSS Containment

**Files:**
- Modify: `src/v2/yuzu.css`
- Test: `src/v2/terminal-containment.test.tsx`

- [ ] **Step 1: Update the AgentZone root and header rules**

In `src/v2/yuzu.css`, replace `.yz2-az` with:

```css
.yz2-az {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: yzIn 0.18s ease;
}
```

In the existing `.yz2-az-head` block, add `min-width: 0;` so the block becomes:

```css
.yz2-az-head {
    height: 40px;
    flex: 0 0 40px;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 0 14px;
    background: var(--yz-10151f);
    border-bottom: 1px solid var(--yz-1c2433);
}
```

- [ ] **Step 2: Update AgentZone canvas and grid rules**

In `src/v2/yuzu.css`, replace `.yz2-az-canvas` and `.yz2-az-grid` with:

```css
.yz2-az-canvas {
    flex: 1;
    min-width: 0;
    position: relative;
    overflow: auto;
    background-color: var(--yz-090c12);
    background-image: radial-gradient(circle at 1px 1px, var(--yz-141b28) 1px, transparent 0);
    background-size: 22px 22px;
}
.yz2-az-grid {
    display: grid;
    min-width: 0;
    grid-auto-rows: minmax(220px, 1fr);
    gap: 14px;
    padding: 16px;
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
}
```

- [ ] **Step 3: Update AgentZone window and terminal body rules**

In `src/v2/yuzu.css`, add `min-width: 0;` to `.yz2-az-win` and replace the two window body rules with:

```css
.yz2-az-win {
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    background: var(--yz-0c1119);
    box-shadow: 0 14px 38px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    position: relative;
    z-index: 1;
    align-self: stretch;
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--yz-2b3547);
    animation: yzIn 0.22s ease;
}
```

```css
.yz2-az-win-body {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 10px 12px;
}
.yz2-az-win-body.real {
    padding: 0;
    min-width: 0;
    overflow: hidden;
    display: flex;
}
.yz2-az-win-body.real .terminal-host { background: var(--yz-0c1119); padding: 8px 10px; }
```

- [ ] **Step 4: Run focused containment test and verify it passes**

Run:

```bash
bun test src/v2/terminal-containment.test.tsx
```

Expected: PASS.

---

### Task 4: Verify Terminal Resize Guard And Broaden Frontend Gates

**Files:**
- Test: `src/features/terminal/TerminalTab.test.ts`
- Test: `src/v2/terminal-containment.test.tsx`
- Test: `src/v2/*`

- [ ] **Step 1: Run focused terminal and containment tests together**

Run:

```bash
bun test src/v2/terminal-containment.test.tsx src/features/terminal/TerminalTab.test.ts
```

Expected: PASS. This proves containment CSS is present and `TerminalTab` still coalesces resize observer ticks without duplicate PTY resize emits.

- [ ] **Step 2: Run broader related frontend tests**

Run:

```bash
bun test src/features/terminal src/v2
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript/Vite build**

Run:

```bash
bun run build
```

Expected: PASS with Vite build output and no TypeScript errors.

- [ ] **Step 4: Run whitespace diff check**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

---

### Task 5: Build Packaged Debug App And Record IME Smoke Evidence

**Files:**
- Create: `docs/architecture/issue-12-windows-terminal-ime-smoke.md`

- [ ] **Step 1: Build the packaged debug app**

Run:

```bash
bun run tauri build --debug --bundles app
```

Expected on a fully configured host: debug app bundle is produced.

If the command exits because updater artifacts require `TAURI_SIGNING_PRIVATE_KEY`, record the signing-key failure text and rerun:

```bash
bun run tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Expected fallback result: debug app bundle is produced with updater artifacts disabled. Do not use the fallback to validate updater artifacts.

- [ ] **Step 2: Create the smoke evidence note**

Create `docs/architecture/issue-12-windows-terminal-ime-smoke.md` with the section that matches the actual host.

If Windows smoke was run, use this complete structure and replace the values with the observed facts from the smoke run:

```markdown
# Issue 12 Windows Terminal IME Smoke

Date: 2026-06-24
Issue: https://github.com/NakiriYuuzu/Yuuzu-IDE/issues/12
Build: packaged debug app

## Environment

- OS: Windows 11
- WebView2 runtime: observed in Windows runtime
- IME: Microsoft Bopomofo Traditional Chinese
- Workspace: Yuuzu-IDE repository

## Build Evidence

- `bun run tauri build --debug --bundles app`: produced packaged debug app

## Smoke Steps

1. Opened the packaged debug app.
2. Opened a real workspace.
3. Opened a normal terminal tab.
4. Switched to Traditional Chinese IME.
5. Typed at least 30 composed Chinese characters.
6. Opened AgentZone real terminal.
7. Repeated at least 30 composed Chinese characters.

## Result

- Normal terminal tab: no horizontal movement of terminal panel, side panel, status bar, or full workbench.
- AgentZone terminal: no horizontal movement of AgentZone grid, window body, side panel, status bar, or full workbench.
- Candidate/composition UI remained usable.

## Residual Risk

- This smoke covers the observed Windows WebView2 IME layout bug. Additional IME engines may still need manual confirmation if a new report names a different IME.
```

If the current execution host is not Windows, use this complete structure instead:

```markdown
# Issue 12 Windows Terminal IME Smoke

Date: 2026-06-24
Issue: https://github.com/NakiriYuuzu/Yuuzu-IDE/issues/12
Build: packaged debug app

## Environment

- OS: macOS host
- WebView2 runtime: not available on this host
- IME: not run on Windows in this session
- Workspace: Yuuzu-IDE repository

## Build Evidence

- `bun run tauri build --debug --bundles app`: record the observed result from this session before closing the task
- `bun run tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'`: record the observed fallback result when signing blocks updater artifacts

## Smoke Steps

Windows WebView2 IME smoke was not run on this host.

## Result

- Normal terminal tab: not verified on Windows in this session.
- AgentZone terminal: not verified on Windows in this session.
- Candidate/composition UI: not verified on Windows in this session.

## Residual Risk

- Issue #12 must not be closed until a Windows packaged app smoke verifies Chinese or Traditional Chinese IME input in both normal terminal tabs and AgentZone terminals.
```

- [ ] **Step 3: Run docs diff check**

Run:

```bash
git diff --check docs/architecture/issue-12-windows-terminal-ime-smoke.md
```

Expected: no output and exit code 0.

- [ ] **Step 4: Commit if the user approved committing**

Only run this step after explicit user approval for staging and committing in this worktree.

```bash
git status --short
git add src/v2/terminal-containment.test.tsx src/v2/yuzu.css docs/architecture/issue-12-windows-terminal-ime-smoke.md
git diff --cached --check
git commit -m "fix: contain terminal ime layout shifts"
```

Expected: commit succeeds and contains only the issue #12 implementation files.

---

## Self-Review

Spec coverage:

- Main terminal containment: Task 2.
- AgentZone containment: Task 3.
- Existing resize guard verification: Tasks 1 and 4.
- Automated regression coverage: Task 1.
- Focused and broader gates: Task 4.
- Windows packaged app smoke and evidence note: Task 5.
- Out-of-scope Rust/PTY/backend behavior preserved: no Rust files are modified by this plan.

Placeholder scan:

- No banned marker words, broad "handle edge cases" instruction, or missing code blocks remain.
- Windows smoke has two complete evidence-note variants so the executor records a concrete outcome on either Windows or non-Windows hosts.

Type consistency:

- `Tab` and `AzWindow` fields match `src/v2/v2-model.ts`.
- The test renders the real `TerminalTab` and mocks only `load-xterm`, avoiding cross-file module pollution while keeping xterm out of the focused containment test.
- CSS selectors match `src/v2/yuzu.css` and the rendered DOM classes.
