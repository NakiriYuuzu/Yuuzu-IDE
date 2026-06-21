# Terminal Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add native-terminal-like naming for v2 terminal tabs and AgentZone sessions: OSC titles update unlocked terminals, and manual rename locks the displayed title until explicitly unlocked.

**Architecture:** Keep the feature frontend-only. Store-level actions own title state and locking; `TerminalTab` only bridges raw xterm title events upward; UI surfaces call the store actions. No Rust backend/session rehydrate changes are in scope.

**Tech Stack:** Tauri 2 frontend, React, Zustand, xterm.js, Bun test runner.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/v2/v2-model.ts` | Add `titleLocked?: boolean` to `Tab` and `AzWindow`. |
| `src/v2/v2-store.ts` | Add `sanitizeTerminalTitle`, `applyOscTitle`, `renameTerminalTab`, and `renameAgentSession`. |
| `src/v2/v2-store.test.ts` | Focused store tests for sanitizing, OSC updates, locking, rename, and unlock. |
| `src/features/terminal/TerminalTab.tsx` | Add `onTitleChange` prop and xterm `onTitleChange` bridge. |
| `src/features/terminal/TerminalTab.test.ts` | Test raw title callback with session id. |
| `src/v2/controller.ts` | Export `applyOscTitle` callback wrapper for rendered terminal components. |
| `src/v2/ContentViews.tsx` | Pass `applyOscTitle` to cmd terminal tabs. |
| `src/v2/AgentZone.tsx` | Pass `applyOscTitle`; add inline rename for agent session titles. |
| `src/v2/TabStrip.tsx` | Add inline rename for cmd tabs. |
| `src/v2/Overlays.tsx` | Add Rename items for tab and session context menus. |
| `src/v2/Overlays.test.tsx` | Test context menu rename prompt wiring. |

## Task 1: Core State Contract

**Files:**
- Modify: `src/v2/v2-model.ts`
- Modify: `src/v2/v2-store.ts`
- Modify: `src/v2/v2-store.test.ts`

- [x] **Step 1: Write failing store tests**

Add focused tests near the existing terminal and AgentZone store tests:

```ts
test("applyOscTitle updates only unlocked terminal surfaces", () => {
    const store = freshStore()
    store.setState((s) => {
        const p = s.ui.api
        return {
            ui: {
                ...s.ui,
                api: {
                    ...p,
                    tabs: [
                        ...p.tabs,
                        { id: 9001, type: "cmd", title: "zsh", sessionId: "term-a" },
                        { id: 9002, type: "cmd", title: "manual", titleLocked: true, sessionId: "term-b" },
                    ],
                    wins: [
                        ...p.wins,
                        { id: 9101, title: "agent", status: "shell", lines: [], buf: "", min: false, max: false, sessionId: "agent-a" },
                        { id: 9102, title: "locked agent", titleLocked: true, status: "shell", lines: [], buf: "", min: false, max: false, sessionId: "agent-b" },
                    ],
                },
            },
        }
    })

    store.getState().applyOscTitle("term-a", "  vim src/App.tsx  ")
    store.getState().applyOscTitle("term-b", "should not apply")
    store.getState().applyOscTitle("agent-a", "claude")
    store.getState().applyOscTitle("agent-b", "should not apply")
    store.getState().applyOscTitle("agent-a", "   ")

    const state = store.getState().ui.api
    expect(state.tabs.find((t) => t.id === 9001)?.title).toBe("vim src/App.tsx")
    expect(state.tabs.find((t) => t.id === 9002)?.title).toBe("manual")
    expect(state.wins.find((w) => w.id === 9101)?.title).toBe("claude")
    expect(state.wins.find((w) => w.id === 9102)?.title).toBe("locked agent")
})

test("manual terminal rename locks and empty rename unlocks", () => {
    const store = freshStore()
    store.setState((s) => ({
        ui: {
            ...s.ui,
            api: {
                ...s.ui.api,
                tabs: [...s.ui.api.tabs, { id: 9001, type: "cmd", title: "zsh", sessionId: "term-a" }],
            },
        },
    }))

    store.getState().renameTerminalTab(9001, "  build logs  ")
    expect(store.getState().ui.api.tabs.find((t) => t.id === 9001)).toMatchObject({
        title: "build logs",
        titleLocked: true,
    })

    store.getState().applyOscTitle("term-a", "ignored")
    expect(store.getState().ui.api.tabs.find((t) => t.id === 9001)?.title).toBe("build logs")

    store.getState().renameTerminalTab(9001, "")
    expect(store.getState().ui.api.tabs.find((t) => t.id === 9001)?.titleLocked).toBe(false)

    store.getState().applyOscTitle("term-a", "next osc")
    expect(store.getState().ui.api.tabs.find((t) => t.id === 9001)?.title).toBe("next osc")
})

test("manual agent rename locks and empty rename unlocks", () => {
    const store = freshStore()
    store.setState((s) => ({
        ui: {
            ...s.ui,
            api: {
                ...s.ui.api,
                wins: [...s.ui.api.wins, { id: 9101, title: "agent", status: "shell", lines: [], buf: "", min: false, max: false, sessionId: "agent-a" }],
            },
        },
    }))

    store.getState().renameAgentSession(9101, "  claude router  ")
    expect(store.getState().ui.api.wins.find((w) => w.id === 9101)).toMatchObject({
        title: "claude router",
        titleLocked: true,
    })

    store.getState().renameAgentSession(9101, "")
    expect(store.getState().ui.api.wins.find((w) => w.id === 9101)?.titleLocked).toBe(false)
})

test("sanitizeTerminalTitle removes controls and limits long titles", () => {
    expect(sanitizeTerminalTitle(" \\u0000foo\\nbar\\u007f ")).toBe("foobar")
    expect(sanitizeTerminalTitle("x".repeat(130))).toHaveLength(120)
    expect(sanitizeTerminalTitle(" \\n\\t ")).toBe("")
})
```

- [x] **Step 2: Run focused tests and confirm RED**

Run: `bun test src/v2/v2-store.test.ts -t "terminal rename|applyOscTitle|sanitizeTerminalTitle|agent rename"`

Expected: FAIL because the actions/helper/types do not exist.

- [x] **Step 3: Implement minimal model/store behavior**

Add `titleLocked?: boolean` to `Tab` and `AzWindow`. Export:

```ts
export function sanitizeTerminalTitle(rawTitle: string): string {
    return rawTitle.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, 120)
}
```

Add store actions:

```ts
applyOscTitle: (sessionId, rawTitle) => {
    const title = sanitizeTerminalTitle(rawTitle)
    if (!title) return
    set((s) => {
        let changed = false
        const ui = Object.fromEntries(Object.entries(s.ui).map(([pid, p]) => {
            const tabs = p.tabs.map((t) => {
                if (t.sessionId !== sessionId || t.titleLocked) return t
                changed = true
                return { ...t, title }
            })
            const wins = p.wins.map((w) => {
                if (w.sessionId !== sessionId || w.titleLocked) return w
                changed = true
                return { ...w, title }
            })
            return [pid, changed ? { ...p, tabs, wins } : p]
        }))
        return changed ? { ui } : {}
    })
}
```

`renameTerminalTab` and `renameAgentSession` trim input; non-empty sets `title` and `titleLocked: true`; empty sets `titleLocked: false` and preserves title.

- [x] **Step 4: Run focused tests and confirm GREEN**

Run: `bun test src/v2/v2-store.test.ts -t "terminal rename|applyOscTitle|sanitizeTerminalTitle|agent rename"`

Expected: PASS.

## Task 2: TerminalTab OSC Bridge

**Files:**
- Modify: `src/features/terminal/TerminalTab.tsx`
- Modify: `src/features/terminal/TerminalTab.test.ts`

- [x] **Step 1: Write failing TerminalTab test**

Extend the existing fake terminal with `onTitleChange`, emit a title from the fake, and assert the callback receives `[sessionId, title]`.

- [x] **Step 2: Run focused test and confirm RED**

Run: `bun test src/features/terminal/TerminalTab.test.ts -t "title"`

Expected: FAIL because `TerminalTab` does not expose/wire `onTitleChange`.

- [x] **Step 3: Implement bridge**

Add `onTitleChange?: (sessionId: string, title: string) => void`, keep it in a ref, register `terminal.onTitleChange`, and dispose the returned disposable on cleanup.

- [x] **Step 4: Run focused test and confirm GREEN**

Run: `bun test src/features/terminal/TerminalTab.test.ts -t "title"`

Expected: PASS.

## Task 3: Wire OSC Callback Into v2 Surfaces

**Files:**
- Modify: `src/v2/controller.ts`
- Modify: `src/v2/ContentViews.tsx`
- Modify: `src/v2/AgentZone.tsx`

- [x] **Step 1: Add thin controller wrapper**

Export:

```ts
export function applyOscTitle(sessionId: string, title: string): void {
    store().applyOscTitle(sessionId, title)
}
```

- [x] **Step 2: Pass callback to rendered terminals**

In `ContentViews.tsx` cmd tabs and `AgentZone.tsx` sessions, pass `onTitleChange={applyOscTitle}`.

- [x] **Step 3: Run TypeScript check**

Run: `bunx tsc --noEmit`

Expected: PASS.

## Task 4: Manual Rename UI

**Files:**
- Modify: `src/v2/TabStrip.tsx`
- Modify: `src/v2/AgentZone.tsx`
- Modify: `src/v2/Overlays.tsx`
- Modify: `src/v2/Overlays.test.tsx`
- Modify: `src/v2/yuzu.css` only if input styling cannot reuse existing classes.

- [x] **Step 1: Add context menu tests**

Add tests that set a cmd tab/session in state, open the matching context menu, mock `prompt`, click Rename, and assert `renameTerminalTab` / `renameAgentSession` is called with the current title as prompt default and the typed value.

- [x] **Step 2: Confirm context tests RED**

Run: `bun test src/v2/Overlays.test.tsx -t "Rename terminal|Rename session"`

Expected: FAIL because menu items do not exist.

- [x] **Step 3: Implement context menu items**

Add `Rename...` for `case "tab"` only when the target tab is `cmd`; add `Rename...` for `case "session"` when the window exists. If `prompt` returns `null`, do nothing.

- [x] **Step 4: Add inline rename**

For cmd tabs, double-click the title span to show a compact input. Enter/blur submit; Escape cancels; stop propagation so tab activation is not triggered by the rename control.

For agent sessions, double-click `.tt` to show a compact input. Stop propagation so the parent header double-click does not maximize.

- [x] **Step 5: Run focused UI tests**

Run:

```bash
bun test src/v2/Overlays.test.tsx -t "Rename terminal|Rename session"
bun test src/v2/ContentViews.test.tsx src/v2/Overlays.test.tsx
```

Expected: PASS.

## Task 5: Review And Verification

**Files:**
- All touched files.

- [x] **Step 1: Focused verification**

Run:

```bash
bun test src/v2/v2-store.test.ts src/features/terminal/TerminalTab.test.ts src/v2/Overlays.test.tsx
```

Expected: PASS.

- [x] **Step 2: Broader frontend verification**

Run:

```bash
bun test
bunx tsc --noEmit
```

Expected: PASS.

- [x] **Step 3: Review**

Run one spec-compliance review and one code-quality review before closeout. Review must check the feature against `docs/superpowers/specs/2026-06-16-terminal-naming-design.md` and ensure unrelated sidebar rail changes were not reverted or bundled into claims.

## Post-Review Fixes

- [x] Prevent cmd tab inline double-click rename from activating an inactive tab first while preserving single-click title activation.
- [x] Parse OSC 0/2 titles from backend terminal output events so inactive cmd tabs and collapsed AgentZone sessions update even without mounted xterm instances.
