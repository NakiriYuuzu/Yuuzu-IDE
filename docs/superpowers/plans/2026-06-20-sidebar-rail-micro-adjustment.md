# Sidebar Rail Micro Adjustment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved sidebar mockup to the live v2 shell: move the side-panel toggle before the Yuuzu-IDE brand, make the side panel resizable, and convert the main SidePanel modes into a compact icon row.

**Architecture:** Keep this entirely in the v2 React shell. `v2-store.ts` owns the resizable side-panel width and persistence, `Workbench.tsx` owns the titlebar toggle placement, `SidePanel.tsx` owns the activity icon row and resize pointer handling, and `yuzu.css` owns the visual treatment. No Rust, Tauri command, backend, or old `src/app/*` shell changes are needed.

**Tech Stack:** React 19, TypeScript, Zustand, Bun test with Happy DOM, Vite build, existing v2 CSS variables in `src/v2/yuzu.css`.

---

## Scope Lock

**Task class:** `ui-runtime`

**Accepted visual source:** `docs/html/sidebar-rail-micro-adjustment-mockup-2026-06-20.html`

**Modify only:**
- `src/v2/v2-store.ts`
- `src/v2/v2-store.test.ts`
- `src/v2/Workbench.tsx`
- `src/v2/Workbench.test.tsx`
- `src/v2/SidePanel.tsx`
- `src/v2/SidePanel.test.tsx`
- `src/v2/yuzu.css`

**Do not modify:**
- `src/app/*`
- `src-tauri/*`
- database/git/ssh/backend APIs
- command palette behavior
- the mockup HTML except for follow-up visual drafts explicitly requested by the user

**Assumptions:**
- The top icon row contains the requested primary modes: Files, Git, Database, SSH-SFTP, and AgentZone.
- The existing `lang` mode and `LanguageBody` stay in code for current tests and direct state-driven rendering, but this plan does not add a visible Language icon because it was not part of the approved mockup.
- Side-panel width should persist across app reloads. Width is clamped to `220px..420px`.
- On macOS/Tauri, native traffic lights still reserve their existing space; the toggle moves before the brand, not over the OS window controls.

**Acceptance:**
- The side-panel toggle is visually before `Yuuzu-IDE` / `yuuzu/ide` in the titlebar and still toggles the SidePanel.
- The old vertical text function list is replaced by an icon-only row at the top of the SidePanel.
- Files, Git, Database, SSH-SFTP, and AgentZone buttons are accessible by name and preserve existing `selectFn` behavior.
- The side panel can be resized by dragging its right edge, clamps to `220px..420px`, and persists after store recreation.
- Existing Language, database, and workbench overlay tests remain green.
- Browser preview shows the same layout direction as the approved mockup.

## File Structure

- `src/v2/v2-store.ts`
  - Add `sidePanelWidth`, `setSidePanelWidth`, `persistSidePanelWidth`, and width clamp helpers.
  - Persist width in existing `yuuzu-ide-v2-settings` storage as string key `sidePanelWidth`.

- `src/v2/v2-store.test.ts`
  - Add focused tests for clamp behavior and persistence across store instances.

- `src/v2/Workbench.tsx`
  - Move the existing `Toggle side panel` button before the brand block.
  - Add an explicit `aria-label` so tests and assistive tech can find it.

- `src/v2/Workbench.test.tsx`
  - Add a test proving the toggle is before the brand and still hides/shows the SidePanel.

- `src/v2/SidePanel.tsx`
  - Rename `FunctionList` to `ActivityTabs`.
  - Render icon-only buttons for Files, Git, Database, SSH-SFTP, and AgentZone.
  - Add the resize handle and pointer capture logic.

- `src/v2/SidePanel.test.tsx`
  - Add tests for icon-row rendering, mode selection, and resize pointer behavior.

- `src/v2/yuzu.css`
  - Replace fixed `260px` SidePanel width with `--yz2-side-width`.
  - Replace old `.yz2-fnlist/.yz2-fnrow` styling with compact activity-tab styles.
  - Add resize-handle hover/drag styling.

---

### Task 1: Store Resizable Side-Panel Width

**Files:**
- Modify: `src/v2/v2-store.ts`
- Modify: `src/v2/v2-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Add these imports in `src/v2/v2-store.test.ts`:

```typescript
import {
    SIDE_PANEL_MAX_WIDTH,
    SIDE_PANEL_MIN_WIDTH,
    clampSidePanelWidth,
    createV2Store,
    emptyUI,
    registerRealDelegate,
    settingLimit,
} from "./v2-store"
```

In the existing `describe("settings", () => { ... })` block, add:

```typescript
test("clamps side panel width to the supported visual range", () => {
    expect(clampSidePanelWidth(100)).toBe(SIDE_PANEL_MIN_WIDTH)
    expect(clampSidePanelWidth(284)).toBe(284)
    expect(clampSidePanelWidth(999)).toBe(SIDE_PANEL_MAX_WIDTH)
    expect(clampSidePanelWidth(Number.NaN)).toBe(284)
})

test("persists side panel width across store instances", () => {
    const g = globalThis as { localStorage?: Storage }
    if (!g.localStorage) g.localStorage = window.localStorage
    g.localStorage.removeItem("yuuzu-ide-v2-settings")

    const store = freshStore()
    store.getState().setSidePanelWidth(360)
    expect(store.getState().sidePanelWidth).toBe(360)

    store.getState().persistSidePanelWidth()
    expect(freshStore().getState().sidePanelWidth).toBe(360)

    g.localStorage.removeItem("yuuzu-ide-v2-settings")
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/v2/v2-store.test.ts
```

Expected: FAIL because `SIDE_PANEL_MIN_WIDTH`, `SIDE_PANEL_MAX_WIDTH`, `clampSidePanelWidth`, `sidePanelWidth`, `setSidePanelWidth`, and `persistSidePanelWidth` do not exist yet.

- [ ] **Step 3: Add width constants and helpers**

In `src/v2/v2-store.ts`, place these near `THEME_KEY` / `SETTINGS_KEY`:

```typescript
export const SIDE_PANEL_MIN_WIDTH = 220
export const SIDE_PANEL_DEFAULT_WIDTH = 284
export const SIDE_PANEL_MAX_WIDTH = 420

export function clampSidePanelWidth(width: number): number {
    if (!Number.isFinite(width)) return SIDE_PANEL_DEFAULT_WIDTH
    return Math.max(SIDE_PANEL_MIN_WIDTH, Math.min(SIDE_PANEL_MAX_WIDTH, Math.round(width)))
}

function sidePanelWidthFromSettings(vals: Record<string, string | boolean>): number {
    const raw = vals.sidePanelWidth
    if (typeof raw !== "string") return SIDE_PANEL_DEFAULT_WIDTH
    return clampSidePanelWidth(Number(raw))
}
```

- [ ] **Step 4: Add width state and actions**

In the `V2State` type, add these under `panelOpen` and the chrome actions:

```typescript
sidePanelWidth: number
```

```typescript
setSidePanelWidth: (width: number) => void
persistSidePanelWidth: () => void
```

In `createV2Store()`, replace the current initial settings setup:

```typescript
const initialTheme = loadTheme()
applyThemeAttr(initialTheme)
```

with:

```typescript
const initialTheme = loadTheme()
const initialSettings = loadStoredSettings()
applyThemeAttr(initialTheme)
```

Then replace:

```typescript
stVals: loadStoredSettings(),
```

with:

```typescript
stVals: initialSettings,
```

Add the width state next to `panelOpen`:

```typescript
panelOpen: true,
sidePanelWidth: sidePanelWidthFromSettings(initialSettings),
```

Replace the current `setPanelOpen` line with this block:

```typescript
setPanelOpen: (open) => set({ panelOpen: open }),
setSidePanelWidth: (width) => set({ sidePanelWidth: clampSidePanelWidth(width) }),
persistSidePanelWidth: () => {
    const width = String(get().sidePanelWidth)
    set((s) => ({ stVals: { ...s.stVals, sidePanelWidth: width } }))
    persistSettings(get().stVals)
},
```

- [ ] **Step 5: Run focused tests to verify GREEN**

Run:

```bash
bun test src/v2/v2-store.test.ts
```

Expected: PASS. The new clamp and persistence tests pass, and existing settings tests still pass.

- [ ] **Step 6: Review checkpoint**

Do not commit unless the user has explicitly authorized commits. If commits are authorized, use:

```bash
git add src/v2/v2-store.ts src/v2/v2-store.test.ts
git commit -m "feat: persist resizable side panel width"
```

---

### Task 2: Move Titlebar Side-Panel Toggle Before Brand

**Files:**
- Modify: `src/v2/Workbench.tsx`
- Modify: `src/v2/Workbench.test.tsx`

- [ ] **Step 1: Write failing workbench test**

Add `fireEvent` to the test import in `src/v2/Workbench.test.tsx`:

```typescript
import { cleanup, fireEvent, render } from "@testing-library/react"
```

In `beforeEach` and `afterEach`, include `panelOpen: true` so each test starts from the same chrome state:

```typescript
v2Store.setState({
    mode: "demo",
    active: "api",
    panelOpen: true,
    meta: structuredClone(initialWorkbenchState.meta),
    ui: structuredClone(initialWorkbenchState.ui),
})
```

Add this test inside `describe("WorkbenchV2", () => { ... })`:

```typescript
test("renders side panel toggle before the brand and keeps toggling the panel", () => {
    const view = render(<WorkbenchV2 />)

    const titlebar = view.container.querySelector(".yz2-titlebar")
    const toggle = view.getByRole("button", { name: "Toggle side panel" })
    const brand = view.container.querySelector(".yz2-brand")

    expect(titlebar).toBeTruthy()
    expect(brand).toBeTruthy()
    expect(Array.from(titlebar!.children).indexOf(toggle)).toBeLessThan(
        Array.from(titlebar!.children).indexOf(brand!),
    )
    expect(view.getByText("EXPLORER")).toBeTruthy()

    fireEvent.click(toggle)
    expect(v2Store.getState().panelOpen).toBe(false)
    expect(view.queryByText("EXPLORER")).toBeNull()

    fireEvent.click(toggle)
    expect(v2Store.getState().panelOpen).toBe(true)
    expect(view.getByText("EXPLORER")).toBeTruthy()
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/v2/Workbench.test.tsx
```

Expected: FAIL because the current toggle button is after the search/theme area, not before `.yz2-brand`, and it has no explicit accessible name.

- [ ] **Step 3: Move the toggle in `TitleBar`**

In `src/v2/Workbench.tsx`, keep these selectors:

```typescript
const panelOpen = useV2Store((s) => s.panelOpen)
const setPanelOpen = useV2Store((s) => s.setPanelOpen)
```

Move the toggle button so it appears immediately after the traffic-light block and before `.yz2-brand`:

```tsx
<button
    type="button"
    className={"yz2-iconbtn yz2-panel-toggle" + (panelOpen ? "" : " is-on")}
    title="Toggle side panel"
    aria-label="Toggle side panel"
    onClick={() => setPanelOpen(!panelOpen)}
>
    ▦
</button>
<div className="yz2-brand">
```

Remove the old duplicate toggle button currently rendered near the theme button at the right side of the titlebar.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```bash
bun test src/v2/Workbench.test.tsx
```

Expected: PASS. The toggle precedes the brand and still hides/shows the SidePanel.

- [ ] **Step 5: Review checkpoint**

Do not commit unless the user has explicitly authorized commits. If commits are authorized, use:

```bash
git add src/v2/Workbench.tsx src/v2/Workbench.test.tsx
git commit -m "feat: move side panel toggle before brand"
```

---

### Task 3: Replace SidePanel Text Function List With Icon Activity Tabs

**Files:**
- Modify: `src/v2/SidePanel.tsx`
- Modify: `src/v2/SidePanel.test.tsx`
- Modify: `src/v2/yuzu.css`

- [ ] **Step 1: Write failing SidePanel activity tests**

Add this test inside `describe("SidePanel", () => { ... })`:

```typescript
test("renders primary modes as icon-only activity tabs", () => {
    const view = render(<SidePanel />)

    const tabs = view.container.querySelector(".yz2-activity-tabs")
    expect(tabs).toBeTruthy()
    expect(tabs!.querySelectorAll(".yz2-activity-tab")).toHaveLength(5)

    expect(view.getByRole("button", { name: "Files" })).toBeTruthy()
    expect(view.getByRole("button", { name: "Git" })).toBeTruthy()
    expect(view.getByRole("button", { name: "Database" })).toBeTruthy()
    expect(view.getByRole("button", { name: "SSH-SFTP" })).toBeTruthy()
    expect(view.getByRole("button", { name: "AgentZone" })).toBeTruthy()

    expect(view.queryByText("Files")).toBeNull()
    expect(view.queryByText("Git")).toBeNull()
    expect(view.queryByText("Database")).toBeNull()
    expect(view.queryByText("SSH · SFTP")).toBeNull()
    expect(view.queryByText("AgentZone")).toBeNull()
})

test("activity tabs select the matching SidePanel mode", () => {
    const view = render(<SidePanel />)

    fireEvent.click(view.getByRole("button", { name: "Git" }))
    expect(v2Store.getState().ui.api.fn).toBe("git")
    expect(view.getByText("SOURCE CONTROL")).toBeTruthy()

    fireEvent.click(view.getByRole("button", { name: "Database" }))
    expect(v2Store.getState().ui.api.fn).toBe("db")
    expect(view.getByText("DATABASES")).toBeTruthy()

    fireEvent.click(view.getByRole("button", { name: "SSH-SFTP" }))
    expect(v2Store.getState().ui.api.fn).toBe("ssh")
    expect(view.getByText("SSH · SFTP")).toBeTruthy()

    fireEvent.click(view.getByRole("button", { name: "AgentZone" }))
    expect(v2Store.getState().ui.api.fn).toBe("agent")
    expect(view.getByText("AGENT ZONE")).toBeTruthy()
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/v2/SidePanel.test.tsx
```

Expected: FAIL because the current component renders `.yz2-fnlist` text rows instead of `.yz2-activity-tabs` icon buttons.

- [ ] **Step 3: Rename `FunctionList` to `ActivityTabs` and limit visible rows**

In `src/v2/SidePanel.tsx`, rename:

```typescript
function FunctionList() {
```

to:

```typescript
function ActivityTabs() {
```

Use this row shape inside the component:

```typescript
const rows: { id: FnMode; label: string; icon: ReactNode; badge?: string }[] = [
    { id: "files", label: "Files", icon: <path d="M2 4.5C2 3.7 2.7 3 3.5 3h2.8l1.8 2h4.4c.8 0 1.5.7 1.5 1.5v5c0 .8-.7 1.5-1.5 1.5h-9C2.7 13 2 12.3 2 11.5V4.5z" /> },
    { id: "git", label: "Git", badge: gitBadge > 0 ? String(gitBadge) : undefined, icon: <><circle cx="4.5" cy="4.2" r="1.7" /><circle cx="4.5" cy="11.8" r="1.7" /><circle cx="11.5" cy="5.8" r="1.7" /><path d="M4.5 5.9v4.2 M11.5 7.5c0 2.6-3.2 2-7 3.2" /></> },
    { id: "db", label: "Database", badge: String(dbs.length), icon: <><ellipse cx="8" cy="3.8" rx="5" ry="1.9" /><path d="M3 3.8v8.4c0 1 2.2 1.9 5 1.9s5-.9 5-1.9V3.8 M3 8c0 1 2.2 1.9 5 1.9S13 9 13 8" /></> },
    { id: "ssh", label: "SSH-SFTP", badge: String(hosts.length), icon: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M4.5 6.2l2 1.8-2 1.8 M8.5 10h3" /></> },
    { id: "agent", label: "AgentZone", icon: <path d="M8 1.8l1.3 4 4 1.3-4 1.3-1.3 4-1.3-4-4-1.3 4-1.3z" /> },
]
```

Remove the unused `langBadge` local from this component after removing the visible `lang` row.

- [ ] **Step 4: Render icon-only buttons**

Replace the returned `.yz2-fnlist` block with:

```tsx
return (
    <div className="yz2-activity-tabs" aria-label="Side panel modes">
        {rows.map((row) => (
            <button
                type="button"
                key={row.id}
                className={"yz2-activity-tab" + (fn === row.id ? " is-active" : "")}
                aria-label={row.label}
                title={row.label}
                onClick={() => selectFn(row.id)}
            >
                <FnIcon>{row.icon}</FnIcon>
                {row.id === "agent" ? (
                    wins.length > 0 ? (
                        <span className="yz2-activity-badge is-live">
                            <span className="d" />
                            <span>{wins.length}</span>
                        </span>
                    ) : null
                ) : row.badge ? (
                    <span className="yz2-activity-badge">{row.badge}</span>
                ) : null}
            </button>
        ))}
    </div>
)
```

Update the SidePanel render:

```tsx
<ActivityTabs />
```

- [ ] **Step 5: Replace activity-list CSS**

In `src/v2/yuzu.css`, replace the `.yz2-fnlist`, `.yz2-fnrow`, `.yz2-fnbadge`, and `.yz2-fnbadge-live` block with:

```css
.yz2-activity-tabs {
    height: 44px;
    flex: 0 0 44px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 8px;
    background: var(--yz-090c12);
    border-bottom: 1px solid var(--yz-1c2433);
}
.yz2-activity-tab {
    position: relative;
    width: 34px;
    height: 34px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    color: var(--yz-8b97a7);
    cursor: pointer;
    border: 1px solid transparent;
}
.yz2-activity-tab:hover {
    background: var(--yz-141a26);
    color: var(--yz-e6edf3);
}
.yz2-activity-tab.is-active {
    background: var(--yz-15240b);
    border-color: var(--yz-34421d);
    color: var(--yz-a8e23f);
}
.yz2-activity-tab svg {
    width: 17px;
    height: 17px;
}
.yz2-activity-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 14px;
    height: 14px;
    border-radius: 7px;
    background: var(--yz-1a2230);
    color: var(--yz-8b97a7);
    font-size: 9px;
    display: grid;
    place-items: center;
    padding: 0 4px;
    border: 1px solid var(--yz-090c12);
}
.yz2-activity-badge.is-live {
    display: flex;
    align-items: center;
    gap: 3px;
    background: var(--yz-1b2410);
    border-color: var(--yz-45611a);
    color: var(--yz-a8e23f);
}
.yz2-activity-badge.is-live .d {
    width: 4px;
    height: 4px;
    border-radius: 2px;
    background: var(--yz-a8e23f);
}
```

- [ ] **Step 6: Run focused tests to verify GREEN**

Run:

```bash
bun test src/v2/SidePanel.test.tsx
```

Expected: PASS. Existing Language tests still pass because `LanguageBody` rendering remains available when state is set to `fn: "lang"`.

- [ ] **Step 7: Review checkpoint**

Do not commit unless the user has explicitly authorized commits. If commits are authorized, use:

```bash
git add src/v2/SidePanel.tsx src/v2/SidePanel.test.tsx src/v2/yuzu.css
git commit -m "feat: convert side panel modes to icon tabs"
```

---

### Task 4: Add SidePanel Resize Handle

**Files:**
- Modify: `src/v2/SidePanel.tsx`
- Modify: `src/v2/SidePanel.test.tsx`
- Modify: `src/v2/yuzu.css`

- [ ] **Step 1: Write failing resize test**

Add this test inside `describe("SidePanel", () => { ... })`:

```typescript
test("resizes the side panel by dragging the right edge", () => {
    const view = render(<SidePanel />)

    const side = view.container.querySelector(".yz2-side") as HTMLElement
    const handle = view.getByRole("separator", { name: "Resize side panel" }) as HTMLElement

    side.getBoundingClientRect = () => ({
        x: 100,
        y: 0,
        left: 100,
        top: 0,
        right: 384,
        bottom: 600,
        width: 284,
        height: 600,
        toJSON: () => ({}),
    })
    handle.setPointerCapture = () => undefined
    handle.releasePointerCapture = () => undefined

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 384 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 460 })
    expect(v2Store.getState().sidePanelWidth).toBe(360)
    expect(handle.classList.contains("is-dragging")).toBe(true)

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 460 })
    expect(handle.classList.contains("is-dragging")).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/v2/SidePanel.test.tsx
```

Expected: FAIL because the resize separator and pointer handlers do not exist yet.

- [ ] **Step 3: Add React state and store selectors**

Update the import at the top of `src/v2/SidePanel.tsx`:

```typescript
import { useRef, useState, type ReactNode } from "react"
```

Inside `SidePanel()`, add:

```typescript
const sidePanelWidth = useV2Store((s) => s.sidePanelWidth)
const setSidePanelWidth = useV2Store((s) => s.setSidePanelWidth)
const persistSidePanelWidth = useV2Store((s) => s.persistSidePanelWidth)
const sideRef = useRef<HTMLDivElement | null>(null)
const [resizing, setResizing] = useState(false)
```

- [ ] **Step 4: Add pointer handlers**

Still inside `SidePanel()`, add:

```typescript
const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    setResizing(true)
    e.currentTarget.classList.add("is-dragging")
    e.currentTarget.setPointerCapture?.(e.pointerId)
}

const moveResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing || !sideRef.current) return
    const left = sideRef.current.getBoundingClientRect().left
    setSidePanelWidth(e.clientX - left)
}

const stopResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing) return
    setResizing(false)
    e.currentTarget.classList.remove("is-dragging")
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    persistSidePanelWidth()
}
```

- [ ] **Step 5: Render the width and resize handle**

Change the side root from:

```tsx
<div className="yz2-side">
```

to:

```tsx
<div
    ref={sideRef}
    className="yz2-side"
    style={{ "--yz2-side-width": sidePanelWidth + "px" } as React.CSSProperties}
>
```

Before the closing `</div>` of `.yz2-side`, add:

```tsx
<div
    className="yz2-side-resizer"
    role="separator"
    aria-label="Resize side panel"
    aria-orientation="vertical"
    tabIndex={0}
    onPointerDown={startResize}
    onPointerMove={moveResize}
    onPointerUp={stopResize}
    onPointerCancel={stopResize}
/>
```

- [ ] **Step 6: Add resize CSS**

In `src/v2/yuzu.css`, replace the fixed SidePanel width:

```css
.yz2-side {
    width: 260px;
    flex: 0 0 260px;
```

with:

```css
.yz2-side {
    width: var(--yz2-side-width, 284px);
    flex: 0 0 var(--yz2-side-width, 284px);
    min-width: 220px;
    max-width: 420px;
```

Keep the existing background, border, display, and min-height declarations. Add this near `.yz2-side`:

```css
.yz2-side-resizer {
    position: absolute;
    top: 0;
    right: -4px;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    z-index: 6;
}
.yz2-side-resizer::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
    background: transparent;
}
.yz2-side-resizer:hover::after,
.yz2-side-resizer.is-dragging::after {
    background: var(--yz-a8e23f);
}
```

Ensure `.yz2-side` has `position: relative;` so the resize handle anchors to the panel edge.

- [ ] **Step 7: Run focused tests to verify GREEN**

Run:

```bash
bun test src/v2/SidePanel.test.tsx src/v2/v2-store.test.ts
```

Expected: PASS. Resize updates the store width, removes the dragging class on pointer up, and width persistence tests remain green.

- [ ] **Step 8: Review checkpoint**

Do not commit unless the user has explicitly authorized commits. If commits are authorized, use:

```bash
git add src/v2/SidePanel.tsx src/v2/SidePanel.test.tsx src/v2/yuzu.css src/v2/v2-store.ts src/v2/v2-store.test.ts
git commit -m "feat: make side panel resizable"
```

---

### Task 5: Final Verification And Visual Check

**Files:**
- Verify: `src/v2/v2-store.test.ts`
- Verify: `src/v2/Workbench.test.tsx`
- Verify: `src/v2/SidePanel.test.tsx`
- Verify: `src/v2/yuzu.css`
- Verify: `docs/html/sidebar-rail-micro-adjustment-mockup-2026-06-20.html`

- [ ] **Step 1: Run focused UI tests**

Run:

```bash
bun test src/v2/v2-store.test.ts src/v2/Workbench.test.tsx src/v2/SidePanel.test.tsx
```

Expected: PASS. The new sidebar tests and existing Language/database/workbench tests are green.

- [ ] **Step 2: Run build**

Run:

```bash
bun run build
```

Expected: PASS with no TypeScript or Vite errors.

- [ ] **Step 3: Start browser preview**

Run:

```bash
bun run dev --host 127.0.0.1
```

Expected: Vite starts and prints a local URL, usually `http://127.0.0.1:5173/`.

- [ ] **Step 4: Browser visual smoke**

Open the Vite URL in a browser and verify:

```text
1. The side-panel toggle is immediately before the Yuuzu-IDE brand.
2. Clicking the toggle hides and restores the SidePanel.
3. The SidePanel top row shows icon-only buttons for Files, Git, Database, SSH-SFTP, and AgentZone.
4. Clicking each icon changes the panel body to the expected mode.
5. Dragging the SidePanel right edge resizes the panel without shifting the project rail.
6. Refreshing the page keeps the last persisted side-panel width.
```

Expected: All six checks match the approved HTML mockup direction.

- [ ] **Step 5: Stop dev server**

Stop the Vite process with `Ctrl+C`.

Expected: No long-running dev server remains unless the user asks to keep it open.

- [ ] **Step 6: Review current diff**

Run:

```bash
git diff -- src/v2/v2-store.ts src/v2/v2-store.test.ts src/v2/Workbench.tsx src/v2/Workbench.test.tsx src/v2/SidePanel.tsx src/v2/SidePanel.test.tsx src/v2/yuzu.css
```

Expected:
- No changes outside the scoped files.
- No old `FunctionList` reference remains.
- No duplicate titlebar side-panel toggle remains.
- No `src/app/*` or `src-tauri/*` diff.

- [ ] **Step 7: Request review after implementation**

After implementation and verification, ask reviewers to check:

```text
Review the sidebar rail micro-adjustment diff. Focus on:
1. Whether the SidePanel toggle moved before the brand without breaking panelOpen.
2. Whether sidePanelWidth is clamped and persisted without excessive scope.
3. Whether icon-only activity tabs preserve Files/Git/Database/SSH-SFTP/AgentZone behavior and accessible names.
4. Whether Language rendering tests still pass and no old src/app shell was touched.
5. Whether the visual result matches docs/html/sidebar-rail-micro-adjustment-mockup-2026-06-20.html.
```

Expected: No Critical or Important findings before closeout.

---

## Self-Review

**Spec coverage:**
- Toggle-before-brand is covered by Task 2.
- Resizable, persisted SidePanel width is covered by Tasks 1 and 4.
- Icon row for Files/Git/Database/SSH-SFTP/AgentZone is covered by Task 3.
- Browser-visible confirmation is covered by Task 5.
- Scope excludes old shell and backend changes.

**Placeholder scan:** No placeholder steps are left. Every code-edit step names exact files and concrete snippets.

**Type consistency:**
- Store state uses `sidePanelWidth`, `setSidePanelWidth`, and `persistSidePanelWidth` consistently.
- CSS custom property is `--yz2-side-width` in both `SidePanel.tsx` and `yuzu.css`.
- Activity CSS uses `.yz2-activity-tabs`, `.yz2-activity-tab`, and `.yz2-activity-badge`.

**Commit policy:** Commit commands are included only as optional checkpoints and must not be run unless the user explicitly authorizes commits.
