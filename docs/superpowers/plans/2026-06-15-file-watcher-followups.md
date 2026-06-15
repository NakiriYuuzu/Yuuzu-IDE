# File Watcher v2 後續三項 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已上線的 file watcher「偵測+標記」基線上,補上自動重載乾淨分頁、檔案樹同步增刪、衝突分頁處置 UI。

**Architecture:** 純路徑/樹運算抽成 `file-watch.ts` 可測試函式;async 檔案 I/O 與協調集中在 `controller.ts` delegate(沿用 `openFile`/`refreshDir` 慣例);store action 保持同步、real mode 委派。受控 `<textarea>` 與檔案樹隨 store 變更自動重渲染。

**Tech Stack:** Tauri(Rust)+ React/TypeScript + Zustand;`bun test`(bun:test)、`bunx tsc --noEmit`。

**對應 spec:** `docs/superpowers/specs/2026-06-15-file-watcher-followups-design.md`

**前置注意:**
- 程式碼風格:`src/v2/*` 為 **4 空格、無分號、無 trailing comma**(`file-api.ts`/`file-model.ts` 例外為**有分號**)。
- 分支:基線 file-watcher 變更目前在 `perf/editor-cache-content-visibility`(未 commit)。執行前由使用者決定分支策略;本 plan 不含分支操作。
- commit:每個 task 末尾的 commit 步驟採使用者慣例(footer `Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>`,**不**加 AI co-author);**不執行 `git add -A`**,只 stage 該 task 觸及的檔案。執行 commit 需使用者授權。
- 純函式測試已有檔案 `src/v2/file-watch.test.ts`(bun:test,helper `fileTab`/`v`);新增測試延用其風格。

---

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `src/v2/file-watch.ts` | Modify | 新增 `isTempWritePath` / `findByReal` / `treeRefreshTarget` / `mergeTreeChildren` 純函式 |
| `src/v2/file-watch.test.ts` | Modify | 上述四函式的單元測試 |
| `src/v2/v2-store.ts` | Modify | `RealDelegate` 型別、`V2State` 宣告、`markExternalFileChange` 4-arg 委派、`reloadTab`/`overwriteTab` |
| `src/v2/controller.ts` | Modify | `readAndApply`、`syncTreeDir`、`scheduleTreeSync`、`onExternalFileChange`、`saveFile(force)`、`reloadFile`、import 與 delegate 註冊 |
| `src/v2/Workbench.tsx` | Modify | watcher hook 傳入 `ev.workspace_root` |
| `src/v2/ContentViews.tsx` | Modify | 衝突 chip 加 Reload/Overwrite 按鈕 + selector |
| `src/v2/yuzu.css` | Modify | `.yz2-ext-btn` 樣式 |

---

## Task 1: 純函式 `isTempWritePath` + `findByReal`

**Files:**
- Modify: `src/v2/file-watch.ts`
- Test: `src/v2/file-watch.test.ts`

- [ ] **Step 1: 在 `file-watch.test.ts` 末尾新增 describe(失敗測試)**

在檔案最後(第 67 行 `})` 之後)加入:

```ts
import type { TreeNode } from "./v2-model"
import { findByReal, isTempWritePath, treeRefreshTarget, mergeTreeChildren } from "./file-watch"

const fdir = (n: string, p: string, d: TreeNode[] = [], loaded = true): TreeNode => ({ n, p, d, loaded })
const ffile = (n: string, p: string): TreeNode => ({ n, p })

describe("isTempWritePath", () => {
    test("matches the atomic-write temp pattern .<name>.<pid>.<counter>.tmp", () => {
        expect(isTempWritePath("/r/src/.main.ts.12345.0.tmp")).toBe(true)
    })
    test("does not match ordinary files or dotfiles", () => {
        expect(isTempWritePath("/r/src/main.ts")).toBe(false)
        expect(isTempWritePath("/r/.env")).toBe(false)
        expect(isTempWritePath("/r/.foo.tmp")).toBe(false)
    })
})

describe("findByReal", () => {
    const tree = [fdir("src", "/r/src", [ffile("a.ts", "/r/src/a.ts")]), ffile("top.ts", "/r/top.ts")]
    test("returns the display path for a nested real path", () => {
        expect(findByReal(tree, "/r/src/a.ts")?.displayPath).toBe("src/a.ts")
    })
    test("returns the dir node itself", () => {
        expect(findByReal(tree, "/r/src")?.displayPath).toBe("src")
    })
    test("returns null for an unknown path", () => {
        expect(findByReal(tree, "/r/src/missing.ts")).toBeNull()
    })
})
```

(注意:把 `import type { Tab }` 旁邊一併補上新 import;若 import 已存在則只加缺的具名項。)

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test src/v2/file-watch.test.ts`
Expected: FAIL（`findByReal`/`isTempWritePath` is not exported / not a function）

- [ ] **Step 3: 在 `file-watch.ts` 實作(加在檔案末尾,延用 4 空格無分號風格)**

先把頂部 import 補上 `TreeNode`:

```ts
import { shouldMarkExternalChange, type FileVersion } from "../features/files/file-model"
import type { Tab, TreeNode } from "./v2-model"
```

再於檔案末尾新增:

```ts
// True when path is one of write_text_file's atomic-write temp siblings
// (.<filename>.<pid>.<counter>.tmp). The tree must ignore these to avoid flicker.
export function isTempWritePath(pathNorm: string): boolean {
    const base = pathNorm.split("/").pop() ?? ""
    return /^\..+\.\d+\.\d+\.tmp$/.test(base)
}

// Find the tree node whose real path matches `norm` (normalized), returning the
// node and its display path (names joined). Descends only into matching ancestors.
export function findByReal(tree: TreeNode[], norm: string): { node: TreeNode; displayPath: string } | null {
    const walk = (nodes: TreeNode[], prefix: string): { node: TreeNode; displayPath: string } | null => {
        for (const node of nodes) {
            if (node.p == null) continue
            const np = normalizeFsPath(node.p)
            const display = prefix ? prefix + "/" + node.n : node.n
            if (np === norm) return { node, displayPath: display }
            if (node.d && node.d.length > 0 && norm.startsWith(np + "/")) {
                const found = walk(node.d, display)
                if (found) return found
            }
        }
        return null
    }
    return walk(tree, "")
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `bun test src/v2/file-watch.test.ts`
Expected: PASS（含原有 14 + 新增 5）

- [ ] **Step 5: Commit**

```bash
git add src/v2/file-watch.ts src/v2/file-watch.test.ts
git commit -m "feat(ui): 🚀 add isTempWritePath and findByReal watcher helpers

- isTempWritePath filters atomic-write temp siblings
- findByReal maps a canonical path to a tree display path

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 2: 純函式 `treeRefreshTarget`

**Files:**
- Modify: `src/v2/file-watch.ts`
- Test: `src/v2/file-watch.test.ts`

- [ ] **Step 1: 新增失敗測試(接在 Task 1 的 describe 之後)**

```ts
describe("treeRefreshTarget", () => {
    const tree = [
        fdir("src", "/r/src", [ffile("a.ts", "/r/src/a.ts")]),
        fdir("node_modules", "/r/node_modules", [], false), // unloaded
        ffile("top.ts", "/r/top.ts"),
    ]
    const ROOT = "/r"
    test("create in a loaded dir → refresh that dir", () => {
        expect(treeRefreshTarget(tree, ROOT, "/r/src/new.ts", true)).toBe("src")
    })
    test("delete a known file → refresh its parent dir", () => {
        expect(treeRefreshTarget(tree, ROOT, "/r/src/a.ts", false)).toBe("src")
    })
    test("modify an existing file → no structural refresh", () => {
        expect(treeRefreshTarget(tree, ROOT, "/r/src/a.ts", true)).toBeNull()
    })
    test("root-level change → refresh root (empty string)", () => {
        expect(treeRefreshTarget(tree, ROOT, "/r/added.ts", true)).toBe("")
    })
    test("create inside an unloaded dir → skip", () => {
        expect(treeRefreshTarget(tree, ROOT, "/r/node_modules/x/y.js", true)).toBeNull()
    })
    test("temp write file → skip", () => {
        expect(treeRefreshTarget(tree, ROOT, "/r/src/.a.ts.999.0.tmp", true)).toBeNull()
    })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test src/v2/file-watch.test.ts`
Expected: FAIL（`treeRefreshTarget` is not a function）

- [ ] **Step 3: 在 `file-watch.ts` 末尾實作**

```ts
// The display dir to re-scan for a watcher event, or null when no structural
// refresh is needed. rootNorm/eventPathNorm must already be normalizeFsPath'd.
export function treeRefreshTarget(
    tree: TreeNode[],
    rootNorm: string,
    eventPathNorm: string,
    eventExists: boolean
): string | null {
    if (isTempWritePath(eventPathNorm)) return null
    const self = findByReal(tree, eventPathNorm)
    if (eventExists && self) return null // modify: no structural change
    const at = eventPathNorm.lastIndexOf("/")
    const parentNorm = at <= 0 ? "" : eventPathNorm.slice(0, at)
    if (parentNorm === rootNorm || parentNorm === "") return ""
    const parent = findByReal(tree, parentNorm)
    if (parent && parent.node.d && parent.node.loaded) return parent.displayPath
    return null
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `bun test src/v2/file-watch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/v2/file-watch.ts src/v2/file-watch.test.ts
git commit -m "feat(ui): 🚀 add treeRefreshTarget for watcher tree sync

- decides which loaded dir to re-scan on external add/delete
- skips modifies, temp files, and unloaded dirs

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 3: 純函式 `mergeTreeChildren`

**Files:**
- Modify: `src/v2/file-watch.ts`
- Test: `src/v2/file-watch.test.ts`

- [ ] **Step 1: 新增失敗測試**

```ts
describe("mergeTreeChildren", () => {
    test("preserves a surviving dir's loaded subtree and drops removed nodes", () => {
        const old = [fdir("src", "/r/src", [ffile("a.ts", "/r/src/a.ts")]), ffile("old.ts", "/r/old.ts")]
        const fresh = [fdir("src", "/r/src", [], false), ffile("new.ts", "/r/new.ts")]
        const merged = mergeTreeChildren(old, fresh)
        const src = merged.find((n) => n.n === "src")
        expect(src?.d).toHaveLength(1) // preserved a.ts, not reset to []
        expect(src?.loaded).toBe(true)
        expect(merged.map((n) => n.n)).toEqual(["src", "new.ts"]) // old.ts dropped
    })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test src/v2/file-watch.test.ts`
Expected: FAIL（`mergeTreeChildren` is not a function）

- [ ] **Step 3: 在 `file-watch.ts` 末尾實作**

```ts
// Merge freshly-scanned children into existing ones, preserving the loaded
// subtree (.d/.loaded) of directories that still exist (matched by name).
export function mergeTreeChildren(oldChildren: TreeNode[], freshNodes: TreeNode[]): TreeNode[] {
    const byName = new Map(oldChildren.map((n) => [n.n, n]))
    return freshNodes.map((fresh) => {
        const prev = byName.get(fresh.n)
        if (prev && prev.d && fresh.d) return { ...fresh, d: prev.d, loaded: prev.loaded }
        return fresh
    })
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `bun test src/v2/file-watch.test.ts`
Expected: PASS（原 14 + Task1~3 共 12 新增 = 26）

- [ ] **Step 5: Commit**

```bash
git add src/v2/file-watch.ts src/v2/file-watch.test.ts
git commit -m "feat(ui): 🚀 add mergeTreeChildren to preserve tree expansion

- keeps loaded subtrees of surviving dirs on re-scan
- avoids collapsing the explorer on external add/delete

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 4: Store 接線(型別 + 委派 + 新 action)

**Files:**
- Modify: `src/v2/v2-store.ts:53-130`（RealDelegate）、`:361-362`（V2State 宣告）、`:1047-1065`（impl）

- [ ] **Step 1: 更新 `RealDelegate` 型別**

把 `src/v2/v2-store.ts:70` 的 `saveFile: (tabId: number) => void` 改為:

```ts
    saveFile: (tabId: number, force?: boolean) => void
    reloadFile: (tabId: number) => void
    onExternalFileChange: (
        workspaceId: string,
        eventWorkspaceRoot: string,
        eventPath: string,
        eventVersion: FileVersion | null,
    ) => void
```

- [ ] **Step 2: 更新 `V2State` 宣告**

把 `src/v2/v2-store.ts:361` 改為(加 `eventWorkspaceRoot`),並在 `:362` `saveTab` 旁新增兩個 action 宣告:

```ts
    markExternalFileChange: (workspaceId: string, eventWorkspaceRoot: string, eventPath: string, eventVersion: FileVersion | null) => void
    saveTab: (tabId: number) => void
    reloadTab: (tabId: number) => void
    overwriteTab: (tabId: number) => void
```

- [ ] **Step 3: 更新 `markExternalFileChange` impl 並新增兩個 action**

把 `src/v2/v2-store.ts:1047-1057` 整段替換為:

```ts
            markExternalFileChange: (workspaceId, eventWorkspaceRoot, eventPath, eventVersion) => {
                if (get().mode === "real") {
                    realDelegate?.onExternalFileChange(workspaceId, eventWorkspaceRoot, eventPath, eventVersion)
                    return
                }
                set((s) => {
                    const ui = s.ui[workspaceId]
                    if (!ui) return {}
                    const ids = externallyChangedTabIds(ui.tabs, eventPath, eventVersion)
                    if (ids.length === 0) return {}
                    const flagged = new Set(ids)
                    const tabs = ui.tabs.map((t) => (flagged.has(t.id) ? { ...t, externalChange: true } : t))
                    return { ui: { ...s.ui, [workspaceId]: { ...ui, tabs } } }
                })
            },
```

並在 `saveTab`(`:1059-1065`)之後新增:

```ts
            reloadTab: (tabId) => {
                if (get().mode === "real") {
                    realDelegate?.reloadFile(tabId)
                    return
                }
                get().showToast("Demo mode — no disk to reload from")
            },

            overwriteTab: (tabId) => {
                if (get().mode === "real") {
                    realDelegate?.saveFile(tabId, true)
                    return
                }
                get().showToast("Demo mode — edits are not written to disk")
            },
```

- [ ] **Step 4: typecheck(此時 controller 尚未提供新 delegate 方法,預期 tsc 報缺)**

Run: `bunx tsc --noEmit`
Expected: 報 `controller.ts` 的 delegate 物件缺 `reloadFile`/`onExternalFileChange`、`saveFile` 簽名不符（Task 5-7 補齊後消失）。**這是預期的中間態,先不 commit,接續 Task 5。**

---

## Task 5: Controller — `readAndApply` + `saveFile(force)` + `reloadFile`

**Files:**
- Modify: `src/v2/controller.ts`（import、helper、delegate 方法）

- [ ] **Step 1: 補 import**

把 `src/v2/controller.ts:16` 那行 `import { evictHlCache } from "./hl-cache"` 之後(或合適位置)新增:

```ts
import { externallyChangedTabIds, normalizeFsPath, treeRefreshTarget, mergeTreeChildren } from "./file-watch"
import type { FileVersion } from "../features/files/file-model"
```

- [ ] **Step 2: 新增 `readAndApply` helper**

在 `tabIn`(`controller.ts:179-181`)之後新增:

```ts
// Re-read a file tab from disk and apply it. force=true (manual Reload) discards
// local edits; force=false (auto-reload) bails if the tab is no longer clean or
// its version drifted since the read started (the user typed meanwhile).
async function readAndApply(pid: string, tabId: number, force: boolean): Promise<void> {
    const root = rootOf(pid)
    const tab = tabIn(pid, tabId)
    if (!root || !tab || tab.type !== "file" || !tab.realPath) return
    const before = tab.version
    try {
        const read = await readTextFile(root, tab.realPath)
        const cur = tabIn(pid, tabId)
        if (!cur || cur.type !== "file" || cur.realPath !== tab.realPath) return
        if (!force) {
            if (cur.dirty || cur.saving) return
            const bv = before
            const cv = cur.version
            if (!bv || !cv || bv.modified_ms !== cv.modified_ms || bv.len !== cv.len) return
        }
        evictHlCache(tabId)
        patchTab(pid, tabId, (t) => ({
            ...t,
            loading: false,
            content: read.content,
            tooLarge: read.too_large,
            version: read.version,
            savedContent: read.content ?? t.savedContent,
            dirty: false,
            saving: false,
            externalChange: false,
        }))
        if (typeof read.content === "string" && cur.path && isLspSupportedDocumentPath(cur.path)) {
            void openLspDocument(pid, cur.path, read.content).catch(() => {})
        }
    } catch (error) {
        if (force) store().showToast("Reload: " + errMsg(error))
    }
}
```

- [ ] **Step 3: 讓 `saveFile` 支援 force**

把 `src/v2/controller.ts:1004` 的 `saveFile(tabId: number) {` 改為 `saveFile(tabId: number, force = false) {`,並把 `:1014` 的 writeTextFile 呼叫:

```ts
                const result = await writeTextFile(root, tab.realPath as string, content, tab.version ?? null)
```

改為:

```ts
                const result = await writeTextFile(root, tab.realPath as string, content, force ? null : (tab.version ?? null))
```

- [ ] **Step 4: 新增 `reloadFile` delegate 方法**

在 `saveFile` 方法(`controller.ts:1004-1051`)之後新增:

```ts
    reloadFile(tabId: number) {
        void readAndApply(store().active, tabId, true)
    },
```

- [ ] **Step 5: typecheck(仍缺 `onExternalFileChange`)**

Run: `bunx tsc --noEmit`
Expected: 僅剩 `onExternalFileChange` 缺漏錯誤(Task 7 補)。中間態,先不 commit。

---

## Task 6: Controller — `syncTreeDir` + `scheduleTreeSync`

**Files:**
- Modify: `src/v2/controller.ts`

- [ ] **Step 1: 新增模組級 coalescer 狀態與兩個函式**

在 `backupTimers`(`controller.ts:185`)之後新增:

```ts
// Coalesced tree refreshes, keyed per project. Absorbs multi-event saves and
// bulk git operations so the explorer re-scans each affected dir at most once.
const treeSyncPending = new Map<string, Set<string>>()
const treeSyncTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function syncTreeDir(pid: string, displayDir: string): Promise<void> {
    const root = rootOf(pid)
    if (!root) return
    try {
        if (!displayDir) {
            const entries = await scanWorkspace(root)
            const fresh = mapEntriesToNodes(entries)
            patchProject(pid, (p) => {
                p.treeData = mergeTreeChildren(p.treeData, fresh)
                p.treeLoaded = true
            })
            return
        }
        const node = findNode(store().ui[pid]?.treeData ?? [], displayDir)
        if (!node?.p) return
        const entries = await scanDirectory(root, node.p)
        const fresh = mapEntriesToNodes(entries)
        patchProject(pid, (p) => {
            const target = findNode(p.treeData, displayDir)
            const merged = mergeTreeChildren(target?.d ?? [], fresh)
            p.treeData = setNodeChildren(p.treeData, displayDir, merged)
        })
    } catch {
        // best-effort: a transient scan failure just leaves the tree as-is
    }
}

function scheduleTreeSync(pid: string, displayDir: string): void {
    let pending = treeSyncPending.get(pid)
    if (!pending) {
        pending = new Set()
        treeSyncPending.set(pid, pending)
    }
    pending.add(displayDir)
    if (treeSyncTimers.has(pid)) return
    const timer = setTimeout(() => {
        treeSyncTimers.delete(pid)
        const dirs = treeSyncPending.get(pid)
        treeSyncPending.delete(pid)
        if (!dirs) return
        for (const dir of dirs) void syncTreeDir(pid, dir)
    }, 120)
    treeSyncTimers.set(pid, timer)
}
```

- [ ] **Step 2: typecheck(`mergeTreeChildren` 等 import 已於 Task 5 補;此時應只剩 `onExternalFileChange` 缺漏)**

Run: `bunx tsc --noEmit`
Expected: 僅剩 delegate 缺 `onExternalFileChange`。中間態,先不 commit。

---

## Task 7: Controller — `onExternalFileChange` + delegate 註冊

**Files:**
- Modify: `src/v2/controller.ts`（delegate 物件,`saveFile`/`reloadFile` 附近)

- [ ] **Step 1: 新增 `onExternalFileChange` delegate 方法**

在 Task 5 新增的 `reloadFile` 方法之後新增:

```ts
    onExternalFileChange(workspaceId: string, eventWorkspaceRoot: string, eventPath: string, eventVersion: FileVersion | null) {
        const p = store().ui[workspaceId]
        if (!p) return
        const ids = externallyChangedTabIds(p.tabs, eventPath, eventVersion)
        for (const id of ids) {
            const tab = p.tabs.find((t) => t.id === id)
            if (!tab) continue
            if (eventVersion != null && !tab.dirty && !tab.saving) {
                void readAndApply(workspaceId, id, false)
            } else {
                patchTab(workspaceId, id, (t) => ({ ...t, externalChange: true }))
            }
        }
        const target = treeRefreshTarget(
            p.treeData,
            normalizeFsPath(eventWorkspaceRoot),
            normalizeFsPath(eventPath),
            eventVersion != null,
        )
        if (target !== null) scheduleTreeSync(workspaceId, target)
    },
```

- [ ] **Step 2: typecheck 全綠**

Run: `bunx tsc --noEmit`
Expected: EXIT 0（delegate 已滿足 `RealDelegate`,Task 4-7 接線完整）

- [ ] **Step 3: 跑既有觸及測試確認不回歸**

Run: `bun test src/v2/file-watch.test.ts src/v2/v2-store.test.ts`
Expected: PASS

- [ ] **Step 4: Commit(Task 4-7 一起)**

```bash
git add src/v2/v2-store.ts src/v2/controller.ts
git commit -m "feat(ui): 🚀 wire external file change reload and tree sync

- onExternalFileChange auto-reloads clean tabs, flags conflicts
- syncTreeDir + coalescer refresh the tree, preserving expansion
- saveFile(force) + reloadFile back the conflict actions

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 8: Workbench hook 傳入 canonical root

**Files:**
- Modify: `src/v2/Workbench.tsx:250`

- [ ] **Step 1: 改 markExternalFileChange 呼叫**

把 `src/v2/Workbench.tsx:250`:

```ts
                    useV2Store.getState().markExternalFileChange(activeId, ev.path, ev.version)
```

改為:

```ts
                    useV2Store.getState().markExternalFileChange(activeId, ev.workspace_root, ev.path, ev.version)
```

- [ ] **Step 2: typecheck**

Run: `bunx tsc --noEmit`
Expected: EXIT 0

- [ ] **Step 3: Commit**

```bash
git add src/v2/Workbench.tsx
git commit -m "feat(ui): 🚀 pass canonical workspace root to watcher handler

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 9: ContentViews 衝突按鈕

**Files:**
- Modify: `src/v2/ContentViews.tsx:152-155`（selector）、`:199-205`（chip）

- [ ] **Step 1: 在 `EditorView` 加 selector**

在 `src/v2/ContentViews.tsx:155` `const toggleBlame = useV2Store((s) => s.toggleBlame)` 之後新增:

```ts
    const reloadTab = useV2Store((s) => s.reloadTab)
    const overwriteTab = useV2Store((s) => s.overwriteTab)
```

- [ ] **Step 2: 改寫 chip 的 dirty+externalChange 分支**

把 `src/v2/ContentViews.tsx:199-205` 整段替換為:

```tsx
                {editable && tab.externalChange && (tab.dirty || tab.saving) ? (
                    <span className="yz2-ext-chip" title="Unsaved local edits and this file changed on disk">
                        ⚠ changed on disk
                        <button
                            type="button"
                            className="yz2-ext-btn"
                            title="Discard local edits and load the disk version"
                            onClick={() => reloadTab(tab.id)}
                        >
                            Reload
                        </button>
                        <button
                            type="button"
                            className="yz2-ext-btn"
                            title="Overwrite the disk version with your local edits"
                            onClick={() => overwriteTab(tab.id)}
                        >
                            Overwrite
                        </button>
                    </span>
                ) : editable && tab.externalChange ? (
                    <span className="yz2-ext-chip" title="This file changed on disk">⟳ changed on disk</span>
                ) : editable && (tab.dirty || tab.saving) ? (
                    <span className="yz2-dirty-chip">{tab.saving ? "saving…" : "● unsaved · ⌘S"}</span>
                ) : null}
```

- [ ] **Step 3: typecheck + 既有 ContentViews 測試**

Run: `bunx tsc --noEmit && bun test src/v2/ContentViews.test.tsx`
Expected: EXIT 0 + PASS

- [ ] **Step 4: Commit**

```bash
git add src/v2/ContentViews.tsx
git commit -m "feat(ui): 🚀 add Reload/Overwrite actions to conflict chip

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 10: CSS — `.yz2-ext-btn`

**Files:**
- Modify: `src/v2/yuzu.css`（緊接 `.yz2-ext-chip` 規則之後,約第 1145 行附近)

- [ ] **Step 1: 新增按鈕樣式**

在 `.yz2-ext-chip { ... }` 規則之後新增:

```css
.yz2-ext-btn {
    margin-left: 6px;
    padding: 0 6px;
    font-size: 11px;
    line-height: 16px;
    border-radius: 4px;
    border: 1px solid rgba(224, 169, 63, 0.55);
    background: rgba(224, 169, 63, 0.12);
    color: #e0a93f;
    cursor: pointer;
}
.yz2-ext-btn:hover {
    background: rgba(224, 169, 63, 0.28);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/v2/yuzu.css
git commit -m "style(ui): 💄 style conflict chip action buttons

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 11: 全面驗證

- [ ] **Step 1: 純函式 + store 測試全綠**

Run: `bun test src/v2/file-watch.test.ts src/v2/v2-store.test.ts src/v2/ContentViews.test.tsx src/v2/folder-expand.test.ts`
Expected: PASS（0 fail）

- [ ] **Step 2: 全專案 typecheck**

Run: `bunx tsc --noEmit`
Expected: EXIT 0

- [ ] **Step 3: 對抗式 review(read-only sonnet agent)**

派一個 read-only sonnet agent,檢查:
- auto-reload 競態重檢是否真能擋住「讀取期間打字」;
- `syncTreeDir` 是否真的不動 `p.open`、`mergeTreeChildren` 是否保留展開;
- self-save echo(version 比對 + temp 過濾)是否確實不誤觸;
- `onExternalFileChange` 用 `workspaceId`(非 `store().active`)是否一致;
- stale-write:Overwrite(`force=true`→`expectedVersion=null`)是否確實繞過。

- [ ] **Step 4: 手動 E2E(Tauri runtime,`bun run tauri dev`)**

- 外部編輯器改一個開著的乾淨檔 → 編輯器內容自動更新。
- 改一個有未存編輯的檔 → 出現 ⚠ changed on disk + Reload/Overwrite;Reload 取磁碟版、Overwrite 寫回本地版。
- 外部新增/刪除檔(root 與展開子 dir)→ 樹更新且**其他展開 dir 不摺疊**。
- IDE 內 ⌘S 存檔 → 不誤觸重載、無 temp 檔閃爍、樹不亂跳。
- `git checkout`/`pull` 批次 → 樹平順刷新、不卡頓。
- 外部刪除一個乾淨檔 → 分頁**保留** + 標記、**不**自動關閉。

---

## Self-Review(plan 對照 spec)

- **Spec §4 四純函式** → Task 1-3 全覆蓋(`isTempWritePath`/`findByReal`/`treeRefreshTarget`/`mergeTreeChildren`)。✓
- **Spec §5 Controller**(`readAndApply`/`syncTreeDir`/`scheduleTreeSync`/`onExternalFileChange`/`saveFile(force)`/`reloadFile`)→ Task 5-7 全覆蓋。✓
- **Spec §6 Store/接線** → Task 4(型別+委派+action)+ Task 8(Workbench)。✓
- **Spec §7 UI+CSS** → Task 9 + Task 10。✓
- **Spec §8 八項硬化決策**:不重用 refreshDir(Task 6 syncTreeDir 不動 open)、thread workspaceId(Task 4/7)、loaded dir 主動刷新(Task 6)、patch 時重檢(Task 5 readAndApply)、temp 過濾+coalesce(Task 1/6)、evictHlCache(Task 5)、僅兩按鈕(Task 9)、刪除分頁不關閉(Task 7 else 分支只標記)。✓
- **型別一致性**:`readAndApply(pid, tabId, force)`、`saveFile(tabId, force?)`、`reloadFile(tabId)`、`onExternalFileChange(workspaceId, eventWorkspaceRoot, eventPath, eventVersion)`、`treeRefreshTarget(tree, rootNorm, eventPathNorm, eventExists)`、`mergeTreeChildren(old, fresh)`、`findByReal(tree, norm)→{node,displayPath}` 跨 task 一致。✓
- **Placeholder 掃描**:無 TBD/TODO;每個 code 步驟均含完整程式碼。✓
- **註記**:Task 4-6 中段 tsc 非綠屬預期(接線跨檔),已標明「中間態不 commit」,Task 7 Step 4 合併 commit。

---

## Execution Handoff

兩種執行方式:
1. **Subagent-Driven(建議)** — 每個 task 派新 sonnet subagent,task 間 review,快速迭代(符合 ultracode + sonnet-only)。
2. **Inline Execution** — 本 session 內以 executing-plans 批次執行,設檢查點。
