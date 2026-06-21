# AgentZone Auto Grid Resizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change AgentZone Auto mode into a session-aware automatic grid and add a sidebar-like draggable divider for resizing the left and right AgentZone columns when the resolved layout has two columns.

**Architecture:** Keep AgentZone layout decisions deterministic in `src/v2/v2-model.ts`, keep persisted UI sizing state in `src/v2/v2-store.ts`, and keep pointer/keyboard interaction local to `src/v2/AgentZone.tsx`. The user-facing app must not expose test-only controls for session count or canvas width; the only new user control is the draggable two-column divider, plus keyboard access on that divider.

**Tech Stack:** Tauri 2 + Vite + React + TypeScript, Bun test runner with Happy DOM, existing `useV2Store` Zustand-style store, existing `src/v2/yuzu.css` visual system.

---

## Scope Lock

Task class: `ui-runtime`.

In scope:
- `src/v2/v2-model.ts`: session-aware AgentZone auto-column resolver and split-position helpers.
- `src/v2/v2-model.test.ts`: focused tests for the resolver and split helper.
- `src/v2/v2-store.ts`: persisted AgentZone split ratio state and clamp helper.
- `src/v2/v2-store.test.ts`: focused tests for split ratio clamp and persistence.
- `src/v2/AgentZone.tsx`: draggable and keyboard-accessible two-column divider.
- `src/v2/AgentZone.test.tsx`: component tests for divider visibility, drag resize, and keyboard resize.
- `src/v2/yuzu.css`: divider styling aligned with `.yz2-side-resizer`.
- `docs/html/agentzone-auto-grid-exploration-2026-06-21.html`: remove the mock-only Sessions and Canvas width controls so the artifact matches the agreed design.

Out of scope:
- Rust/Tauri backend changes.
- Terminal PTY lifecycle changes.
- New per-session drag/drop positioning or masonry layout.
- New visible controls for session count or canvas width.
- Staging, committing, or pushing without explicit user approval.

Dirty worktree note:
- The repository currently has unrelated uncommitted changes in multiple source files. Execution must read current file contents before each edit and preserve unrelated changes.

## File Structure

- `src/v2/v2-model.ts`
  - Owns pure AgentZone layout math: width cap, session-aware auto columns, resolved columns, split handle position.
- `src/v2/v2-store.ts`
  - Owns AgentZone split ratio state, clamping, and persistence through the existing settings mechanism.
- `src/v2/AgentZone.tsx`
  - Owns DOM measurement, pointer capture, keyboard events, and rendering of the divider only when the resolved layout has two columns.
- `src/v2/yuzu.css`
  - Owns visual styling for `.yz2-az-col-resizer`, matching the sidebar resizer interaction.
- `src/v2/v2-model.test.ts`, `src/v2/v2-store.test.ts`, `src/v2/AgentZone.test.tsx`
  - Cover pure behavior, state behavior, and rendered interaction behavior separately.
- `docs/html/agentzone-auto-grid-exploration-2026-06-21.html`
  - Remains an exploratory artifact only; it should no longer display Sessions or Canvas width controls.

---

### Task 1: Add Pure AgentZone Layout Rules

**Files:**
- Modify: `src/v2/v2-model.ts`
- Test: `src/v2/v2-model.test.ts`

- [ ] **Step 1: Update the v2-model imports in the test**

In `src/v2/v2-model.test.ts`, add the new pure helpers to the existing import list:

```ts
import {
    agentZoneSplitHandleLeft,
    azAutoCols,
    azColsForWidth,
    blameLineMap,
    buildSelect,
    chipFor,
    commitFiles,
    ctxPct,
    diagBadge,
    diagLineSeverity,
    diagLevelStyle,
    estTokens,
    execOut,
    filterPaletteCommands,
    filterPaletteFiles,
    flattenTree,
    fmtBackupSize,
    fmtBytes,
    fmtK,
    fmtUptime,
    gitFor,
    hlLine,
    langLabel,
    normSeverity,
    refChipStyle,
    resolveAzCols,
    SETTINGS_CONFIG,
    sizeLabel,
    tsLabel,
    termSegs,
    treeFor,
} from "./v2-model"
```

- [ ] **Step 2: Write failing resolver tests**

Add these tests immediately after the existing `describe("azColsForWidth", ...)` block:

```ts
describe("azAutoCols", () => {
    test("uses session count but stays capped by canvas width", () => {
        expect(azAutoCols(0, 0)).toBe(1)
        expect(azAutoCols(1, 3200)).toBe(1)
        expect(azAutoCols(2, 3200)).toBe(2)
        expect(azAutoCols(4, 3200)).toBe(2)
        expect(azAutoCols(5, 3200)).toBe(3)
        expect(azAutoCols(6, 3200)).toBe(3)
        expect(azAutoCols(7, 3200)).toBe(4)
        expect(azAutoCols(8, 3200)).toBe(4)
    })

    test("does not over-split narrow AgentZone canvases", () => {
        expect(azAutoCols(4, 500)).toBe(1)
        expect(azAutoCols(8, 900)).toBe(2)
        expect(azAutoCols(8, 2400)).toBe(3)
    })
})
```

- [ ] **Step 3: Update existing `resolveAzCols` tests to the new signature**

Replace the existing `describe("resolveAzCols", ...)` block with:

```ts
describe("resolveAzCols", () => {
    test("null override falls back to session-aware auto columns", () => {
        expect(resolveAzCols(null, 0, 0)).toBe(1)
        expect(resolveAzCols(null, 500, 4)).toBe(1)
        expect(resolveAzCols(null, 2000, 4)).toBe(2)
        expect(resolveAzCols(null, 2000, 6)).toBe(3)
        expect(resolveAzCols(null, 3200, 8)).toBe(4)
    })

    test("a manual override wins over the auto calculation", () => {
        expect(resolveAzCols(2, 3200, 8)).toBe(2)
        expect(resolveAzCols(3, 500, 1)).toBe(3)
        expect(resolveAzCols(4, 0, 0)).toBe(4)
    })
})
```

- [ ] **Step 4: Add split handle helper tests**

Add this block after `describe("resolveAzCols", ...)`:

```ts
describe("agentZoneSplitHandleLeft", () => {
    test("returns the horizontal handle position inside the AgentZone canvas", () => {
        expect(agentZoneSplitHandleLeft(1000, 50)).toBe(500)
        expect(agentZoneSplitHandleLeft(1000, 30)).toBe(314)
        expect(agentZoneSplitHandleLeft(1000, 70)).toBe(686)
    })

    test("falls back to the center when width is unavailable", () => {
        expect(agentZoneSplitHandleLeft(0, 70)).toBe(0)
    })
})
```

- [ ] **Step 5: Run the focused model tests and verify failure**

Run:

```bash
bun test src/v2/v2-model.test.ts
```

Expected: FAIL because `azAutoCols` and `agentZoneSplitHandleLeft` are not exported, and `resolveAzCols` still accepts two arguments.

- [ ] **Step 6: Implement pure layout helpers**

In `src/v2/v2-model.ts`, replace the comment and `resolveAzCols` function near `azColsForWidth` with:

```ts
export function azAutoCols(sessionCount: number, width: number): number {
    const count = Number.isFinite(sessionCount) ? Math.max(0, Math.floor(sessionCount)) : 0
    const cap = azColsForWidth(width)
    let wanted = 1
    if (count >= 7) wanted = 4
    else if (count >= 5) wanted = 3
    else if (count >= 2) wanted = 2
    return Math.max(1, Math.min(cap, wanted))
}

// Resolve the AgentZone column count: a manual override (2 / 3 / 4) wins,
// otherwise Auto chooses a session-aware grid capped by the canvas width.
export function resolveAzCols(override: number | null, width: number, sessionCount: number): number {
    return override ?? azAutoCols(sessionCount, width)
}

export function agentZoneSplitHandleLeft(width: number, ratio: number): number {
    if (!width) return 0
    const padding = 16 * 2
    const gap = 14
    const usable = Math.max(1, width - padding - gap)
    return Math.round(16 + usable * (ratio / 100) + gap / 2)
}
```

- [ ] **Step 7: Run the focused model tests and verify pass**

Run:

```bash
bun test src/v2/v2-model.test.ts
```

Expected: PASS.

---

### Task 2: Add Persisted AgentZone Split Ratio State

**Files:**
- Modify: `src/v2/v2-store.ts`
- Test: `src/v2/v2-store.test.ts`

- [ ] **Step 1: Write failing store tests**

In `src/v2/v2-store.test.ts`, add `AZ_SPLIT_MAX_RATIO`, `AZ_SPLIT_MIN_RATIO`, and `clampAzSplitRatio` to the import from `./v2-store`:

```ts
import {
    AZ_SPLIT_MAX_RATIO,
    AZ_SPLIT_MIN_RATIO,
    SIDE_PANEL_MAX_WIDTH,
    SIDE_PANEL_MIN_WIDTH,
    clampAzSplitRatio,
    clampSidePanelWidth,
    createV2Store,
    emptyUI,
    sanitizeTerminalTitle,
    registerRealDelegate,
    settingLimit,
} from "./v2-store"
```

Then add these tests immediately after the existing `"column override locks the count and Auto (null) clears it"` test:

```ts
    test("AgentZone split ratio clamps to the supported two-column range", () => {
        expect(clampAzSplitRatio(10)).toBe(AZ_SPLIT_MIN_RATIO)
        expect(clampAzSplitRatio(30)).toBe(30)
        expect(clampAzSplitRatio(56.4)).toBe(56)
        expect(clampAzSplitRatio(70)).toBe(70)
        expect(clampAzSplitRatio(95)).toBe(AZ_SPLIT_MAX_RATIO)
        expect(clampAzSplitRatio(Number.NaN)).toBe(50)
    })

    test("AgentZone split ratio is stored and persisted like the side panel width", () => {
        const store = freshStore()
        expect(store.getState().azSplitRatio).toBe(50)

        store.getState().setAzSplitRatio(62)
        expect(store.getState().azSplitRatio).toBe(62)

        store.getState().persistAzSplitRatio()
        expect(freshStore().getState().azSplitRatio).toBe(62)
    })
```

- [ ] **Step 2: Run the focused store tests and verify failure**

Run:

```bash
bun test src/v2/v2-store.test.ts
```

Expected: FAIL because the AgentZone split ratio exports and store methods do not exist.

- [ ] **Step 3: Add constants and clamp helper**

In `src/v2/v2-store.ts`, add these exports immediately after the side panel constants:

```ts
export const AZ_SPLIT_MIN_RATIO = 30
export const AZ_SPLIT_DEFAULT_RATIO = 50
export const AZ_SPLIT_MAX_RATIO = 70

export function clampAzSplitRatio(ratio: number): number {
    if (!Number.isFinite(ratio)) return AZ_SPLIT_DEFAULT_RATIO
    return Math.max(AZ_SPLIT_MIN_RATIO, Math.min(AZ_SPLIT_MAX_RATIO, Math.round(ratio)))
}
```

- [ ] **Step 4: Add settings loader helper**

Add this helper immediately after `sidePanelWidthFromSettings`:

```ts
function azSplitRatioFromSettings(vals: Record<string, string | boolean>): number {
    const raw = vals.azSplitRatio
    if (typeof raw !== "string") return AZ_SPLIT_DEFAULT_RATIO
    return clampAzSplitRatio(Number(raw))
}
```

- [ ] **Step 5: Extend `V2State`**

In the `V2State` type, add `azSplitRatio` next to the existing AgentZone state and add the two actions next to `setAzColsOverride`:

```ts
    azWidth: number
    azColsOverride: number | null
    azSplitRatio: number
```

```ts
    setAzWidth: (width: number) => void
    setAzColsOverride: (cols: number | null) => void
    setAzSplitRatio: (ratio: number) => void
    persistAzSplitRatio: () => void
```

- [ ] **Step 6: Initialize and implement store actions**

In the `createV2Store` state initializer, add:

```ts
            azWidth: 0,
            azColsOverride: null,
            azSplitRatio: azSplitRatioFromSettings(initialSettings),
```

Then add these actions immediately after `setAzColsOverride`:

```ts
            setAzSplitRatio: (ratio) => set({ azSplitRatio: clampAzSplitRatio(ratio) }),
            persistAzSplitRatio: () => {
                const ratio = String(get().azSplitRatio)
                set((s) => ({ stVals: { ...s.stVals, azSplitRatio: ratio } }))
                persistSettings(get().stVals)
            },
```

- [ ] **Step 7: Run the focused store tests and verify pass**

Run:

```bash
bun test src/v2/v2-store.test.ts
```

Expected: PASS.

---

### Task 3: Render the AgentZone Draggable Divider

**Files:**
- Modify: `src/v2/AgentZone.tsx`
- Modify: `src/v2/yuzu.css`
- Test: `src/v2/AgentZone.test.tsx`

- [ ] **Step 1: Write failing AgentZone interaction tests**

In `src/v2/AgentZone.test.tsx`, update `initialState` so test reset includes AgentZone layout state:

```ts
const initialState = {
    mode: v2Store.getState().mode,
    active: v2Store.getState().active,
    order: [...v2Store.getState().order],
    meta: structuredClone(v2Store.getState().meta),
    ui: structuredClone(v2Store.getState().ui),
    azWidth: v2Store.getState().azWidth,
    azColsOverride: v2Store.getState().azColsOverride,
    azSplitRatio: v2Store.getState().azSplitRatio,
}
```

Update both `beforeEach` and `afterEach` resets to include:

```ts
        azWidth: initialState.azWidth,
        azColsOverride: initialState.azColsOverride,
        azSplitRatio: initialState.azSplitRatio,
```

Then add this helper inside `describe("AgentZone", ...)`, below `setSession`:

```ts
    function setSessions(count: number) {
        const wins = Array.from({ length: count }, (_, idx) => ({
            id: 9200 + idx,
            title: "agent session " + (idx + 1),
            status: "running",
            lines: [],
            buf: "",
            min: false,
            max: false,
        }))

        act(() => {
            v2Store.setState((s) => ({
                azWidth: 1000,
                azColsOverride: null,
                azSplitRatio: 50,
                ui: {
                    ...s.ui,
                    api: {
                        ...s.ui.api,
                        wins,
                        azActive: wins[0]?.id ?? null,
                    },
                },
            }))
        })

        return wins
    }
```

Add these tests after the existing rename tests:

```ts
    test("shows the AgentZone resize separator only for resolved two-column layouts", () => {
        setSessions(4)
        const view = render(<AgentZone />)
        expect(view.getByRole("separator", { name: "Resize AgentZone columns" })).toBeTruthy()

        act(() => v2Store.getState().setAzColsOverride(3))
        expect(view.queryByRole("separator", { name: "Resize AgentZone columns" })).toBeNull()
    })

    test("resizes AgentZone two-column layout by dragging the divider", () => {
        setSessions(4)
        const view = render(<AgentZone />)
        const canvas = view.container.querySelector(".yz2-az-canvas") as HTMLElement
        const handle = view.getByRole("separator", { name: "Resize AgentZone columns" }) as HTMLElement

        canvas.getBoundingClientRect = () => ({
            x: 100,
            y: 0,
            left: 100,
            top: 0,
            right: 1100,
            bottom: 600,
            width: 1000,
            height: 600,
            toJSON: () => ({}),
        })
        handle.setPointerCapture = () => undefined
        handle.releasePointerCapture = () => undefined

        fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600 })
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 786 })
        expect(v2Store.getState().azSplitRatio).toBe(70)
        expect(handle.classList.contains("is-dragging")).toBe(true)

        fireEvent.pointerUp(handle, { pointerId: 1, clientX: 786 })
        expect(handle.classList.contains("is-dragging")).toBe(false)
    })

    test("resizes AgentZone two-column layout from the keyboard separator", () => {
        setSessions(4)
        const view = render(<AgentZone />)
        const handle = view.getByRole("separator", { name: "Resize AgentZone columns" })

        expect(handle.getAttribute("aria-valuemin")).toBe("30")
        expect(handle.getAttribute("aria-valuemax")).toBe("70")
        expect(handle.getAttribute("aria-valuenow")).toBe("50")

        fireEvent.keyDown(handle, { key: "ArrowRight" })
        expect(v2Store.getState().azSplitRatio).toBe(52)
        expect(handle.getAttribute("aria-valuenow")).toBe("52")

        fireEvent.keyDown(handle, { key: "Home" })
        expect(v2Store.getState().azSplitRatio).toBe(30)

        fireEvent.keyDown(handle, { key: "End" })
        expect(v2Store.getState().azSplitRatio).toBe(70)
    })
```

- [ ] **Step 2: Run the focused AgentZone tests and verify failure**

Run:

```bash
bun test src/v2/AgentZone.test.tsx
```

Expected: FAIL because `azSplitRatio` state and the AgentZone separator are not rendered yet.

- [ ] **Step 3: Update AgentZone imports and selectors**

In `src/v2/AgentZone.tsx`, replace the React import with:

```ts
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react"
```

Replace the model import with:

```ts
import { agentZoneSplitHandleLeft, resolveAzCols, termSegs } from "./v2-model"
```

Replace the store import with:

```ts
import { AZ_SPLIT_MAX_RATIO, AZ_SPLIT_MIN_RATIO, useV2Store } from "./v2-store"
```

Add these store selectors after `setAzColsOverride`:

```ts
    const azSplitRatio = useV2Store((s) => s.azSplitRatio)
    const setAzSplitRatio = useV2Store((s) => s.setAzSplitRatio)
    const persistAzSplitRatio = useV2Store((s) => s.persistAzSplitRatio)
```

- [ ] **Step 4: Add divider interaction state and handlers**

In `AgentZone`, add this state after `renameInputRef`:

```ts
    const [resizingCols, setResizingCols] = useState(false)
```

Replace the existing `cols` line with:

```ts
    const cols = resolveAzCols(azColsOverride, azWidth, wins.length)
```

Add these constants and handlers after `activeId`:

```ts
    const showColResizer = cols === 2 && wins.length > 1 && !anyMax
    const gridTemplateColumns =
        cols === 2
            ? `minmax(220px, ${azSplitRatio}fr) minmax(220px, ${100 - azSplitRatio}fr)`
            : `repeat(${cols}, minmax(0, 1fr))`
    const resizerLeft = agentZoneSplitHandleLeft(azWidth, azSplitRatio)

    const startColResize = (e: PointerEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        setResizingCols(true)
        e.currentTarget.classList.add("is-dragging")
        e.currentTarget.setPointerCapture?.(e.pointerId)
    }

    const moveColResize = (e: PointerEvent<HTMLDivElement>) => {
        if (!resizingCols || !canvasRef.current) return
        const rect = canvasRef.current.getBoundingClientRect()
        const padding = 16
        const gap = 14
        const usable = Math.max(1, rect.width - padding * 2 - gap)
        const x = e.clientX - rect.left - padding - gap / 2
        setAzSplitRatio((x / usable) * 100)
    }

    const stopColResize = (e: PointerEvent<HTMLDivElement>) => {
        if (!resizingCols) return
        setResizingCols(false)
        e.currentTarget.classList.remove("is-dragging")
        e.currentTarget.releasePointerCapture?.(e.pointerId)
        persistAzSplitRatio()
    }

    const keyColResize = (e: KeyboardEvent<HTMLDivElement>) => {
        let next: number | null = null
        if (e.key === "ArrowLeft") next = azSplitRatio - 2
        if (e.key === "ArrowRight") next = azSplitRatio + 2
        if (e.key === "Home") next = AZ_SPLIT_MIN_RATIO
        if (e.key === "End") next = AZ_SPLIT_MAX_RATIO
        if (next == null) return
        e.preventDefault()
        setAzSplitRatio(next)
        persistAzSplitRatio()
    }
```

- [ ] **Step 5: Render the divider and grid template**

Replace:

```tsx
                <div className="yz2-az-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
```

with:

```tsx
                <div className="yz2-az-grid" style={{ gridTemplateColumns }}>
```

Immediately after the closing `</div>` for `.yz2-az-grid`, before the closing `</div>` for `.yz2-az-canvas`, add:

```tsx
                {showColResizer ? (
                    <div
                        className="yz2-az-col-resizer"
                        role="separator"
                        aria-label="Resize AgentZone columns"
                        aria-orientation="vertical"
                        aria-valuemin={AZ_SPLIT_MIN_RATIO}
                        aria-valuemax={AZ_SPLIT_MAX_RATIO}
                        aria-valuenow={azSplitRatio}
                        tabIndex={0}
                        style={{ "--yz2-az-resizer-left": resizerLeft + "px" } as CSSProperties}
                        onKeyDown={keyColResize}
                        onPointerDown={startColResize}
                        onPointerMove={moveColResize}
                        onPointerUp={stopColResize}
                        onPointerCancel={stopColResize}
                    />
                ) : null}
```

- [ ] **Step 6: Add divider CSS**

In `src/v2/yuzu.css`, add this block after `.yz2-az-grid`:

```css
.yz2-az-col-resizer {
    position: absolute;
    top: 16px;
    bottom: 16px;
    left: var(--yz2-az-resizer-left);
    width: 8px;
    transform: translateX(-4px);
    cursor: col-resize;
    z-index: 80;
}
.yz2-az-col-resizer::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
    background: transparent;
}
.yz2-az-col-resizer:hover::after,
.yz2-az-col-resizer.is-dragging::after,
.yz2-az-col-resizer:focus-visible::after {
    background: var(--yz-a8e23f);
}
.yz2-az-col-resizer:focus-visible {
    outline: none;
}
```

- [ ] **Step 7: Run the focused AgentZone tests and verify pass**

Run:

```bash
bun test src/v2/AgentZone.test.tsx
```

Expected: PASS.

---

### Task 4: Remove Mock-Only Sessions and Canvas Width Controls From the HTML Artifact

**Files:**
- Modify: `docs/html/agentzone-auto-grid-exploration-2026-06-21.html`

- [ ] **Step 1: Remove the Sessions and Canvas width control blocks**

In `docs/html/agentzone-auto-grid-exploration-2026-06-21.html`, remove these two control blocks from `.control-grid`:

```html
                <div class="control">
                    <label for="sessions">Sessions <span class="value" id="sessionsValue">4</span></label>
                    <input id="sessions" type="range" min="1" max="8" step="1" value="4" oninput="updateFromControls()">
                </div>
                <div class="control">
                    <label for="canvasWidth">Canvas width <span class="value" id="canvasWidthValue">1280px</span></label>
                    <input id="canvasWidth" type="range" min="560" max="2200" step="20" value="1280" oninput="updateFromControls()">
                </div>
```

- [ ] **Step 2: Hard-code the mock preview inputs**

In the same HTML file, keep the internal preview defaults but do not expose them as controls:

```js
const defaults = {
    mode: "auto",
    sessions: 4,
    width: 1280,
    ratio: 50
};
```

Replace `updateFromControls` with:

```js
function updateFromControls() {
    render();
}
```

Replace `resetControls` with:

```js
function resetControls() {
    state = { ...defaults };
    setMode(state.mode);
}
```

- [ ] **Step 3: Remove stale readout writes**

In `renderReadout`, remove these lines:

```js
    document.getElementById("sessionsValue").textContent = state.sessions;
    document.getElementById("canvasWidthValue").textContent = state.width + "px";
```

- [ ] **Step 4: Verify the artifact no longer exposes those controls**

Run:

```bash
rg -n "Sessions|Canvas width|sessionsValue|canvasWidthValue|id=\"sessions\"|id=\"canvasWidth\"" docs/html/agentzone-auto-grid-exploration-2026-06-21.html
```

Expected: no output.

---

### Task 5: Run Focused and Broader Verification

**Files:**
- Verify only; no planned source edits.

- [ ] **Step 1: Run the focused TypeScript tests**

Run:

```bash
bun test src/v2/v2-model.test.ts src/v2/v2-store.test.ts src/v2/AgentZone.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the broader frontend test suite**

Run:

```bash
bun test
```

Expected: PASS. If unrelated dirty-worktree changes fail unrelated tests, capture the failing test names and inspect whether any failure mentions AgentZone, `resolveAzCols`, `azSplitRatio`, or side panel resizing.

- [ ] **Step 3: Run the frontend build**

Run:

```bash
bun run build
```

Expected: PASS.

- [ ] **Step 4: Manual UI smoke check**

Run:

```bash
bun run dev
```

Open the local Vite URL, switch to AgentZone, create or use multiple sessions, and verify:
- Auto mode uses one column for a single session.
- Auto mode uses two columns for two to four sessions when the canvas is wide enough.
- Auto mode does not show Sessions or Canvas width controls.
- The divider appears only in a two-column AgentZone layout.
- Dragging the divider changes left/right widths like the sidebar resizer.
- `Home`, `End`, `ArrowLeft`, and `ArrowRight` work when the divider has keyboard focus.
- Focus mode (`⤢`) hides the divider while one AgentZone window is maximized.

- [ ] **Step 5: Integration checkpoint**

Do not stage or commit unless the user explicitly authorizes git operations. If commits are authorized, use this scoped commit:

```bash
git add src/v2/v2-model.ts src/v2/v2-model.test.ts src/v2/v2-store.ts src/v2/v2-store.test.ts src/v2/AgentZone.tsx src/v2/AgentZone.test.tsx src/v2/yuzu.css docs/html/agentzone-auto-grid-exploration-2026-06-21.html
git commit -m "feat: add agentzone auto grid resizer"
```

---

## Self-Review

Spec coverage:
- Auto mode becomes session-aware through `azAutoCols` and `resolveAzCols(null, width, wins.length)`.
- User-controlled left/right sizing is implemented through a draggable and keyboard-accessible divider, matching the sidebar resizer interaction.
- Sessions and Canvas width controls are explicitly excluded from the app and removed from the HTML artifact.
- Manual 2/3/4 column locks remain intact.
- Resizer state is clamped, persisted, and tested.

Placeholder scan:
- The plan contains no placeholder sections, no incomplete task descriptions, and no missing command expectations.

Type consistency:
- New store state is consistently named `azSplitRatio`.
- New store methods are consistently named `setAzSplitRatio` and `persistAzSplitRatio`.
- New model helpers are consistently named `azAutoCols` and `agentZoneSplitHandleLeft`.
