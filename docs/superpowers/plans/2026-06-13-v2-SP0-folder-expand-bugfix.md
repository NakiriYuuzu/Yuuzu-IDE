# SP0 Folder Expand Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修復 real/Tauri 模式下子資料夾 chevron 展開但子節點永遠空白的 bug。

**Architecture:** 這是前端接線修正，不改 Rust、不改 workspace API wrapper。controller 只在 descendant 掃描時改用既有 `scanDirectory(root, path)`，root-level 掃描保留 `scanWorkspace(root)`；測試用 mock Tauri core 精準重現 `scan_workspace` 拒絕子目錄、`scan_directory` 接受 descendant 的差異。

**Tech Stack:** Bun test、Tauri invoke mock、`src/v2/controller.ts`、`src/features/workspace/workspace-api.ts`、`src/v2/bridge.ts`。

---

> 子計劃 · 2026-06-13 · 規模:2 tasks(1 核心 + 1 降級為程式碼審查的可選守護),相對工作量 S。實質改動僅 controller.ts 5 行 scanWorkspace→scanDirectory + 1 行 import + toggleDir 守門加 const root,加一個整合測試檔;後端 Rust 與 features/workspace api 層零改動(scanDirectory wrapper workspace-api.ts:62 與 scan_directory command lib.rs:61 皆已存在)。已逐行核對 commands.rs:1071/1081、workspace_scan.rs:43、controller.ts 全部呼叫點、bridge 純函式、v2-store toggleDir、bunfig 與既有 71 pass 測試基線。

**摘要:** real(Tauri)模式下點開檔案樹**子資料夾**,chevron 翻成 ▾ 但底下永遠空白。根因:controller.toggleDir(controller.ts:347)對子目錄絕對路徑呼叫 scanWorkspace(node.p),而後端 scan_workspace→trusted_workspace_root(commands.rs:1071/126)僅放行「已註冊 root 本身」,子目錄(如 /root/src)canonicalize 後 != 任何 registered root → Err'workspace not registered' → Promise reject → catch 出 toast → setNodeChildren 永不執行 → node.d 永遠 []、loaded 永遠 false。store 端 toggleDir(v2-store.ts:529)已樂觀翻 open[path]=true,故 chevron 展開但無子項。修法:把 controller.ts 內 5 處對「子目錄」誤用 scanWorkspace 的呼叫(347/168/772/829/862)改成既有 scanDirectory(root, path)(後端 scan_directory commands.rs:1075 先驗 workspaceRoot 是註冊 root、再以 path.starts_with(root) 接受 descendant,workspace_scan.rs:43),import 加 scanDirectory,toggleDir 守門加 const root=rootOf(pid) 與 !root。產出:一個 controller 層整合測試(mock @tauri-apps/api/core,忠實還原後端雙重權限差異:scan_workspace 對子目錄路徑必拋、scan_directory 對 startsWith(root) 接受)先 RED 重現,再最小改 5 行+1 import+1 守門轉綠。不動 bridge 純函式、不動 store demo/樂觀 UI、不動後端 Rust、不動 UI/CSS。後端與 features/workspace api 層零改動(scanDirectory wrapper workspace-api.ts:62 與 scan_directory command lib.rs:61 皆已存在)。

---

## 目標

修復「資料夾無法展開」bug:real(Tauri)模式下點開檔案樹的**子資料夾**,chevron 翻成 ▾ 但底下永遠沒有子節點。

最小、優先、surgical。只改 `src/v2/controller.ts` 的 **5 行** `scanWorkspace`→`scanDirectory` + **1 行 import** + **toggleDir 守門加 `const root`**,外加一個守住回歸的整合測試。**不**改 bridge、store demo 分支、後端 Rust、`features/workspace` api 層、UI、CSS。

> 表述校正(吸收審查意見 mustFix #5):子目錄誤用實際是 **5 處呼叫點**(controller.ts 的 347/168/772/829/862),不是「6 個」。原草案把「toggleDir 加 root 取得」算進去湊成 6,易誤導實作者多改或漏改。本計劃統一表述為「**5 行 scanWorkspace→scanDirectory + 1 行 import + toggleDir 守門加 const root**」。

## File Structure

- Create: `src/v2/folder-expand.test.ts` — controller-level regression test with Tauri core mock.
- Modify: `src/v2/controller.ts` — import `scanDirectory`; replace 5 descendant scans; add `root` guard in `toggleDir`.
- Read-only reference: `src/features/workspace/workspace-api.ts` — existing `scanWorkspace` and `scanDirectory` wrappers.
- Read-only reference: `src/v2/bridge.ts` — existing `mapEntriesToNodes`, `findNode`, and `setNodeChildren`.
- Read-only reference: `src/v2/v2-store.ts` — existing optimistic `toggleDir` behavior; do not change it.

## 根因(已逐行核對原始碼證實)

`controller.toggleDir`(controller.ts:339-355)對子目錄呼叫 `scanWorkspace(node.p as string)`(line 347)。後端 `scan_workspace`(commands.rs:1066-1073)只做 `state.trusted_workspace_root(&path)`(line 1071),而 `trusted_workspace_root`(commands.rs:126-142)只在 `canonicalize(supplied)` **等於某已註冊 workspace root** 時放行,**子目錄(如 `/root/src`)canonicalize 後不等於任何 registered root → `Err("workspace not registered: …")`**。Promise reject → controller catch 出 toast(line 352)→ `setNodeChildren` 從未執行 → `node.d` 永遠 `[]`、`loaded` 永遠 `false`。store 端 `toggleDir`(v2-store.ts:529-534)已先 `upd` 樂觀翻 `open[path]=!open[path]` 再委派,故 chevron 顯示 ▾ 但子項空白。

**正解**:子目錄掃描改走後端 `scan_directory`(commands.rs:1075-1083)。它做**雙重驗證**:先 `state.trusted_workspace_root(&workspace_root)`(line 1081,驗第一參數是註冊 root)、再 `workspace_scan::scan_directory(&workspace_root, Path::new(&path))`(line 1082);後者在 `workspace_scan.rs:43-44` 以 `if !path.starts_with(&root) { return Err("path outside workspace: …") }` 驗第二參數,**接受 root 底下任何 descendant**。前端 wrapper `scanDirectory(workspaceRoot, path)` **已存在**於 `src/features/workspace/workspace-api.ts:62-67`(`call("scan_directory", { workspaceRoot, path })`),Tauri command 已註冊於 `lib.rs:61`。所以這是純前端接線錯誤,**後端與 api 層零改動**。

`scan_workspace` 與 `scan_directory` 都回 `FileTreeEntry[]`(同型別,workspace-api.ts:17-21)。bridge 的 `mapEntriesToNodes`(bridge.ts:55-61,寫 `p: e.path`、dir 設 `d:[], loaded:false`)、`setNodeChildren`(bridge.ts:63-74,僅 `node.d` 存在時設 `loaded:true`)、`findNode`(bridge.ts:76-86,以 `node.n` 導航)皆純函式、內部一致、已有測試——換掉資料來源不影響它們。

## 架構與接線點(具體到行)

全部集中在 `src/v2/controller.ts`,共 **5 處 scanWorkspace→scanDirectory** + **1 處 import** + **toggleDir 1 行守門**。

### A. import(controller.ts:6-13)
現況只匯入 `scanWorkspace`。在 `../features/workspace/workspace-api` import 區塊**加入 `scanDirectory`**(保持字母序、no semicolons、4 spaces):
```ts
import {
    listWorkspaces,
    openWorkspacePath,
    pickWorkspaceFolder,
    removeWorkspace,
    scanDirectory,
    scanWorkspace,
    switchWorkspace,
} from "../features/workspace/workspace-api"
```

### B. toggleDir(controller.ts:339-355)— 主目標
`node.p` 是子目錄絕對路徑(由 `mapEntriesToNodes` 寫入 `e.path`,bridge.ts:59),`scan_workspace` 後端必拒。守門加 `root`、line 347 改 `scanDirectory(root, …)`:
```ts
toggleDir(displayPath: string) {
    const pid = store().active
    const root = rootOf(pid)                                      // 新增
    const p = store().ui[pid]
    if (!root || !p?.open[displayPath]) return                    // 守門加 !root
    const node = findNode(p.treeData, displayPath)
    if (!node?.d || node.loaded || !node.p) return
    void (async () => {
        try {
            const entries = await scanDirectory(root, node.p as string)   // scanWorkspace → scanDirectory(root, …)
            patchProject(pid, (q) => {
                q.treeData = setNodeChildren(q.treeData, displayPath, mapEntriesToNodes(entries))
            })
        } catch (error) {
            store().showToast("Explorer: " + errMsg(error))
        }
    })()
}
```

### C. refreshDir 巢狀分支(controller.ts:168)
此函式開頭已有 `const root = rootOf(pid)`(line 155,且 line 156 已 `if (!root) return`)。`displayDir` 非空時走 `findNode` 取子節點(line 166-167),`node.p` 是子目錄絕對路徑。改 line 168:
```ts
const entries = await scanDirectory(root, node.p)   // 原 scanWorkspace(node.p)
```
(**不動** line 158 的 `scanWorkspace(root)` — 那是 root 層、合法。)

### D. sftpEnter 本地 pane 下降(controller.ts:772)
此 delegate 開頭已有 `const root = rootOf(pid)`(line 742,line 744 已 `if (!root || !sf) return`)。`target` 在 `idx>=0` 分支是子目錄絕對路徑(`entry.p`,line 768);`idx<0`(往上)時 `target` 是 `root + "/" + rel` 或 `root`(line 764)。**統一改 `scanDirectory(root, target)`**:`scan_directory` 對 `target===root` 也合法(`root.starts_with(root)` 為真),故往上回到 root 不會壞。改 line 772:
```ts
const entries = await scanDirectory(root, target)   // 原 scanWorkspace(target)
```

### E. sftp 轉檔/刪檔後本地重列(controller.ts:829、862)
`sf.localPath` 在使用者 `sftpEnter('local', …)` 下降後是子目錄。兩處都已有 `root` in scope(sftpTransfer line 784、sftpDelete line 848,皆已 `if (!root …) return`)。改:
```ts
const entries = await scanDirectory(root, sf.localPath)   // 原 scanWorkspace(sf.localPath)
```
(line 829 在 sftpTransfer 的 download 分支;line 862 在 sftpDelete。)

### 不動的點(root 層,合法,絕不可改)
- controller.ts:144(`ensureTree` → `scanWorkspace(root)`)
- controller.ts:158(`refreshDir` 空 displayDir → `scanWorkspace(root)`)
- controller.ts:719(`sftpOpen` 初始 local 列表 → `scanWorkspace(root)`,此處 `root` 必是註冊 root,合法)

> 註(吸收審查 mustFix #5):保留 **144/158/719** 三處 `scanWorkspace(root)` 不動,只改 **347/168/772/829/862** 五個子目錄點。store 端 `toggleDir`(v2-store.ts:529)的樂觀 UI(翻 chevron)**不改**——它正確,問題只在 real 委派後 controller 拿錯後端指令。demo 分支(toggleDir 不分 mode、純 `upd`)也不動。

## TDD Task 分解

### Task SP0-1:整合測試重現「子資料夾無法展開」並最小修復 controller 接線

**測試環境慣例(照本 repo 既有 precedent,逐字落實)**

- [ ] **Step 1: Create the failing controller regression test**

Create `src/v2/folder-expand.test.ts` with the mock shape below. The key requirement is that `scan_workspace` succeeds only for `ROOT`, while `scan_directory` succeeds for descendants under `ROOT`.

```ts
/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import { ensureTestDom } from "../app/test-dom"

ensureTestDom()

const ROOT = "/ws/demo"

mock.module("@tauri-apps/api/core", () => ({
    invoke: async (cmd: string, args: any) => {
        if (cmd === "list_workspaces") {
            return { active_workspace_id: "demo", workspaces: [{ id: "demo", name: "demo", path: ROOT, pinned: false }] }
        }
        if (cmd === "scan_workspace") {
            if (args.path !== ROOT) throw "workspace not registered: " + args.path
            return [{ name: "src", path: ROOT + "/src", is_dir: true }]
        }
        if (cmd === "scan_directory") {
            if (args.workspaceRoot !== ROOT) throw "workspace not registered: " + args.workspaceRoot
            if (!String(args.path).startsWith(ROOT)) throw "path outside workspace: " + args.path
            return [
                { name: "v2", path: ROOT + "/src/v2", is_dir: true },
                { name: "App.tsx", path: ROOT + "/src/App.tsx", is_dir: false },
            ]
        }
        if (cmd === "get_git_status") throw "no git"
        if (cmd === "get_git_log_page") return { rows: [] }
        if (cmd === "list_database_profiles") return []
        if (cmd === "list_remote_hosts") return []
        if (cmd === "switch_workspace") {
            return { active_workspace_id: "demo", workspaces: [{ id: "demo", name: "demo", path: ROOT, pinned: false }] }
        }
        return null
    },
    transformCallback: () => 0,
    Channel: class { onmessage: any = null },
}))

;(window as any).__TAURI_INTERNALS__ = {}

const { bootstrapV2 } = await import("./controller")
const { v2Store } = await import("./v2-store")
const { findNode } = await import("./bridge")

describe("real folder expansion", () => {
    test("loads descendant folders through scan_directory", async () => {
        await bootstrapV2()
        await new Promise((resolve) => setTimeout(resolve, 30))

        const pid = v2Store.getState().active
        expect(v2Store.getState().ui[pid].treeLoaded).toBe(true)
        expect(findNode(v2Store.getState().ui[pid].treeData, "src")?.d).toEqual([])

        v2Store.getState().toggleDir("src")
        await new Promise((resolve) => setTimeout(resolve, 30))

        const ui = v2Store.getState().ui[pid]
        expect(ui.open.src).toBe(true)
        const srcNode = findNode(ui.treeData, "src")
        expect(srcNode?.loaded).toBe(true)
        expect(srcNode?.d?.length).toBeGreaterThan(0)
        expect(srcNode?.d?.some((n) => n.n === "v2")).toBe(true)
    })
})
```

- [ ] **Step 2: Run the test and verify it fails before implementation**

Run:

```bash
bun test src/v2/folder-expand.test.ts
```

Expected before the controller fix: FAIL because `toggleDir("src")` calls `scan_workspace` with `/ws/demo/src`, the mock rejects it, and `srcNode.loaded` remains `false`.

- [ ] **Step 3: Apply the minimal controller implementation**

Modify `src/v2/controller.ts`:

```ts
import {
    listWorkspaces,
    openWorkspacePath,
    pickWorkspaceFolder,
    removeWorkspace,
    scanDirectory,
    scanWorkspace,
    switchWorkspace,
} from "../features/workspace/workspace-api"
```

Then change only these descendant scans:

```ts
const entries = await scanDirectory(root, node.p)
const entries = await scanDirectory(root, node.p as string)
const entries = await scanDirectory(root, target)
const entries = await scanDirectory(root, sf.localPath)
const entries = await scanDirectory(root, sf.localPath)
```

In `toggleDir`, add the root guard:

```ts
toggleDir(displayPath: string) {
    const pid = store().active
    const root = rootOf(pid)
    const p = store().ui[pid]
    if (!root || !p?.open[displayPath]) return
    const node = findNode(p.treeData, displayPath)
    if (!node?.d || node.loaded || !node.p) return
    void (async () => {
        try {
            const entries = await scanDirectory(root, node.p as string)
            patchProject(pid, (q) => {
                q.treeData = setNodeChildren(q.treeData, displayPath, mapEntriesToNodes(entries))
            })
        } catch (error) {
            store().showToast("Explorer: " + errMsg(error))
        }
    })()
}
```

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
bun test src/v2/folder-expand.test.ts
bun test src/v2/
bunx tsc --noEmit
```

Expected after implementation: focused test passes, existing v2 tests remain green, TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/v2/controller.ts src/v2/folder-expand.test.ts
git commit -m "fix(v2): load descendant folders with scan directory"
```

本 repo 既有 Tauri 相關測試(`src/features/terminal/TerminalTab.test.ts`、`src/features/editor/EditorTab.test.ts`)的**實際慣例是 `mock.module(...)` 後接頂層 `await import(...)`**,**非依賴 bun mock 提升**。新測試檔須照此:先 `mock.module`,再 `const { bootstrapV2 } = await import("./controller")` 與 `const { v2Store } = await import("./v2-store")`。理由:`mock.module` 必須在被 mock 的模組「首次被 import」前生效,頂層 `await import` 保證順序明確、不靠提升玄學。

1. 檔頭 `/// <reference types="bun-types" />` + `import { describe, expect, mock, test } from "bun:test"`,4 spaces、no semicolons、no trailing commas。
2. **DOM 就緒**:controller 不直接 import React 元件,但其依賴鏈(terminal-replay-buffer 等)在 module-eval 期可能碰 `document`;且 `bunfig.toml` 已 preload `./src/app/test-dom.preload.ts`。**此鏈不可動**。保險起見可在頂層 `import { ensureTestDom } from "../app/test-dom"` 後呼叫 `ensureTestDom()`(與 TerminalTab.test.ts 同模式)。
3. **設常數**:`const ROOT = "/ws/demo"`(或任意絕對路徑字串;mock 不碰真檔案系統,故 canonicalize 由 mock 短路掉,路徑不需真存在)。
4. **mock `@tauri-apps/api/core`**(忠實還原後端**雙重權限**,吸收 mustFix #1/#2/#3):
   ```ts
   mock.module("@tauri-apps/api/core", () => ({
       invoke: async (cmd: string, args: any) => {
           if (cmd === "list_workspaces") {
               return { active_workspace_id: "demo", workspaces: [{ id: "demo", name: "demo", path: ROOT, pinned: false }] }
           }
           if (cmd === "scan_workspace") {
               // 後端 commands.rs:1071 只驗 args.path === 註冊 root;子目錄必拋
               if (args.path !== ROOT) throw "workspace not registered: " + args.path
               return [{ name: "src", path: ROOT + "/src", is_dir: true }]
           }
           if (cmd === "scan_directory") {
               // 後端 commands.rs:1081 先驗 workspaceRoot 是註冊 root(camelCase!)
               if (args.workspaceRoot !== ROOT) throw "workspace not registered: " + args.workspaceRoot
               // 再 workspace_scan.rs:43 驗 path.starts_with(root)
               if (!String(args.path).startsWith(ROOT)) throw "path outside workspace: " + args.path
               return [{ name: "v2", path: ROOT + "/src/v2", is_dir: true }, { name: "App.tsx", path: ROOT + "/src/App.tsx", is_dir: false }]
           }
           if (cmd === "get_git_status") throw "no git"          // 讓 ensureGit 走 catch、不干擾
           if (cmd === "get_git_log_page") return { rows: [] }
           if (cmd === "list_database_profiles") return []
           if (cmd === "list_remote_hosts") return []
           if (cmd === "switch_workspace") return { active_workspace_id: "demo", workspaces: [{ id: "demo", name: "demo", path: ROOT, pinned: false }] }
           return null
       },
       transformCallback: () => 0,
       Channel: class { onmessage: any = null }
   }))
   ```
   **關鍵(吸收 mustFix #2)**:`scan_directory` 讀 **camelCase** `args.workspaceRoot` 與 `args.path`(因 `lib/tauri.ts` 的 `call()` 把 `{ workspaceRoot, path }` 原樣丟給 `invoke`,verbatim 確認 tauri.ts:5-7);**不可寫 `args.workspace_root`(底線版)**,否則守門靜默失效→假綠。`scan_workspace` 讀 `args.path`(正確)。
   **關鍵(吸收 mustFix #3 + gap #4)**:`scan_workspace` 對 `src` 回的 `FileTreeEntry.path` **必須是絕對路徑 `ROOT + "/src"`** 且 `is_dir:true`;如此未修前 `toggleDir` → `scanWorkspace(node.p='/ws/demo/src')` 才會命中 mock 的 `args.path !== ROOT → throw`,RED 才真重現。
   **關鍵(吸收 mustFix #4)**:`scan_directory` 對 `startsWith(ROOT)` 的子路徑回**至少一個 entry**(上例回 2 個),否則 GREEN 的 `.d.length>0` 斷言假紅。
   **關鍵(吸收 gap #1)**:`scan_directory` handler **同時驗兩段**(`workspaceRoot===ROOT` 且 `path.startsWith(ROOT)`),忠實對映 commands.rs:1081 + workspace_scan.rs:43,不比真後端寬鬆。
   **關鍵(transformCallback/Channel)**:controller 頂層 import `onTerminalOutput`/`onTerminalExit`(terminal-api,line 18-23)與 `@tauri-apps/plugin-dialog`(經 workspace-api.ts:1,plugin-dialog/dist-js/index.js:1 import `invoke`)。plugin-dialog 只需 core 的 `invoke`(已 mock);但 terminal-api 的 event channel 可能在 module-eval 碰 `Channel`/`transformCallback`。**defensively export 這兩個**(`transformCallback: () => 0`、`Channel: class{}`),避免「module load error」而非「test fail」。
5. **dynamic import(在 mock 之後)**:
   ```ts
   ;(window as any).__TAURI_INTERNALS__ = {}              // 讓 isTauri()(bridge.ts:16-18)為真
   const { bootstrapV2 } = await import("./controller")
   const { v2Store } = await import("./v2-store")
   const { findNode } = await import("./bridge")
   ```
6. **bootstrap(整檔只能一次)**:`await bootstrapV2()`(controller.ts:996,有 `if (bootstrapped) return` 一次性守衛)。bootstrap 內 `loadRegistry(true)` → `ensureActiveProjectData(pid)` 觸發 `ensureTree` 以 `scanWorkspace(ROOT)` 載 root tree(應成功、含 `src`)。等微任務沉澱:`await new Promise(r => setTimeout(r, 30))`。
7. **取 pid**:`const pid = v2Store.getState().active`(bootstrap 後 = "demo")。先**前置斷言**(sanity)root tree 已載:`expect(v2Store.getState().ui[pid].treeLoaded).toBe(true)` 且 `findNode(v2Store.getState().ui[pid].treeData, "src")?.d).toEqual([])`(src 是未展開 dir,loaded=false)。

**RED**(先寫,必須紅):
呼叫 `v2Store.getState().toggleDir("src")`,`await new Promise(r => setTimeout(r, 30))` 等 async scan。斷言(吸收 gap #4 的型別保證):
```ts
const ui = v2Store.getState().ui[pid]
expect(ui.open.src).toBe(true)                                    // 樂觀翻成功
const srcNode = findNode(ui.treeData, "src")
expect(srcNode?.loaded).toBe(false)                               // 未修:scan_workspace 子目錄被拒
expect(srcNode?.d).toEqual([])                                    // 子項從未填
```
未修前因 `toggleDir` 對子目錄打 `scanWorkspace("/ws/demo/src")` 被 mock throw → catch → 子項從未填,此斷言為真 = **RED 重現**。

**GREEN**(實作,使測試轉綠):
套用上面「架構與接線點」§A-§E 的改動(import 加 scanDirectory + 5 處 scanWorkspace→scanDirectory + toggleDir 守門加 const root)。改完後**把 RED 斷言反轉**成正向:
```ts
expect(srcNode?.loaded).toBe(true)                               // scan_directory 對 startsWith(root) 回了 descendant
expect(srcNode?.d?.length).toBeGreaterThan(0)                    // 子項(v2、App.tsx)出現
expect(srcNode?.d?.some((n) => n.n === "v2")).toBe(true)
```
即同一測試從「斷言壞」改為「斷言好」,完成 red→green。

> **假綠陷阱(吸收 mustFix #3 + 風險)**:判別事實是「**`scan_workspace` 對 `/ws/demo/src` 必拋,`scan_directory` 對同一條 `/ws/demo/src`(及其下)接受**」。若實作者讓 mock 對任意路徑都回資料,RED 會假綠(green→green 而非 red→green)。緩解已寫死於步驟 4:`scan_workspace` **僅** `args.path===ROOT` 成功、其餘 throw;`scan_directory` 才接 `startsWith(ROOT)`——這正是 commands.rs:1071(只驗 path 是註冊 root)vs commands.rs:1081+workspace_scan.rs:43(驗 root + 接 descendant)的差異。

**verify**:
- `bun test src/v2/folder-expand.test.ts` — 新測綠(red→green:先紅重現、改 5 行+import+守門後綠)。
- `bun test src/v2/` — 全 v2 測試綠,**原 71 pass / 0 fail(3 檔:bridge.test.ts / v2-model.test.ts / v2-store.test.ts)不退步**,加新檔後 4 檔、總 pass +N。
- `bunx tsc --noEmit` 無錯。

### Task SP0-2(可選,低成本守護):SFTP 本地下降不退步

D/E 三處(772/829/862)已被 SP0-1 的接線改動同時涵蓋。SFTP bootstrap 需 host fixture(`connect_remote_host`/`list_sftp_directory` mock),**過重**。故此 task **降級為純程式碼審查**:肉眼確認 controller.ts:772/829/862 三行已改成 `scanDirectory(root, …)`,且 root 在各自 scope 已存在(742/784/848)。bugfix 主價值在 toggleDir(347),SFTP 三處是順帶修正同一誤用,SP0-1 的接線改動已含它們、且 `bunx tsc --noEmit` 會驗型別正確。**不強制寫測**。

**verify**:`grep -n "scanDirectory\|scanWorkspace" src/v2/controller.ts` 人工核對:347/168/772/829/862 用 `scanDirectory(root, …)`;144/158/719 維持 `scanWorkspace(root)`。

## UI 考量

**無 UI/CSS 改動**。已核對 `SidePanel.tsx`:ExplorerBody 的 `isDir = !!node.d`(line 77)、`isOpen = !!open[path]`(line 78)、chevron `isDir ? (isOpen ? "▾" : "▸") : ""`(line 94)、遞迴 `if (isDir && isOpen && node.d) walk(node.d, …)`(line 109)邏輯**正確**;視覺症狀(chevron ▾ 但無子項)是後端 reject 的下游表現(`node.d` 恆 `[]`)。修 controller 接線後,`setNodeChildren` 正常填 `node.d`、`loaded=true`,UI 自動正確顯示子節點。不碰 `--yz-*` 色票、不碰 yz2-* / SidePanel class。

## 驗證 gate

1. `bun test src/v2/folder-expand.test.ts` — 新整合測試綠(red→green 流程:先紅重現、改 5 行+import+守門後綠)。
2. `bun test src/v2/` — 全 v2 測試綠,**原 71 pass / 0 fail(已實測確認:3 檔、192 expect)不退步**(bridge.test.ts / v2-store.test.ts / v2-model.test.ts 不受影響,因未動純函式與 store demo/樂觀 UI)。
3. `bunx tsc --noEmit` — `scanDirectory` 已具型別 `(workspaceRoot: string, path: string) => Promise<FileTreeEntry[]>`(workspace-api.ts:62-67),toggleDir 加 `const root = rootOf(pid)`(型別 `string | null`)後守門 `!root` 收斂為 `string`,傳入合法,無 TS error。
4. native 冒煙(MEMORY 註記的真實驗證,非自動化 gate):在桌面殼開一個 real workspace,展開含子資料夾的目錄(如 `src/` → `src/v2/`),確認子項正常列出、無 'workspace not registered' toast。

## 風險

- **單例 store + 一次性 bootstrap**:controller 綁模組級 `v2Store`(controller.ts:74-76)與 `bootstrapped` 旗標(line 72/997),測試**不能**像 store 單元測試那樣 `createV2Store()` 每次 fresh。緩解:整個測試檔**只 bootstrap 一次**,case 間依序操作、不互相清狀態;pid 從 `v2Store.getState().active` 取。
- **mock 順序**:照本 repo precedent 用 `mock.module(...)` + 頂層 `await import("./controller")`(非依賴提升)。若改用提升寫法,`@tauri-apps/api/core` 必須在 controller 首次被 import 前 mock,否則連到真 core。
- **camelCase 鍵陷阱(mustFix #2)**:`scan_directory` mock 必讀 `args.workspaceRoot`(非 `args.workspace_root`),否則守門靜默失效→假綠。`lib/tauri.ts:5` `invoke<T>(command, args)` verbatim 傳遞已確認。
- **core mock 完整性**:漏 export `transformCallback`/`Channel` → controller 連帶 import(terminal-api event channel / plugin-dialog)可能在 module-eval 期炸(module load error,非 test fail)。緩解:mock factory 明確 export `invoke` + `transformCallback` + `Channel`(已寫入步驟 4)。
- **假綠陷阱(mustFix #3)**:mock 若對任意路徑都回資料會讓 RED 假綠。緩解:`scan_workspace` **僅** `args.path===ROOT` 成功、`scan_directory` 才接 `startsWith(ROOT)`——忠實還原 commands.rs:1071 vs 1081+workspace_scan.rs:43 的權限差異(已逐行核對)。
- **scan_directory 對 root 自身(gap)**:sftpEnter 往上回到 root 時 `scanDirectory(root, root)`,`root.startsWith(root)` 為真故合法,行為與原 `scanWorkspace(root)` 等價;mock 步驟 4 的 `scan_directory` handler 對 `path===ROOT` 也通過(`ROOT.startsWith(ROOT)` 為真),不退步。
- **happy-dom preload 依賴**:`bunfig.toml`(preload `./src/app/test-dom.preload.ts`)→ `test-dom.ts` 是 DOM 就緒保證,**不可刪**。新測試檔依賴它先載入(controller 連帶 import 的鏈可能在 module-eval 碰 document)。本 task 不動這條鏈。

## 非目標

- 不接任何新後端能力(僅切換到**已存在**的 `scan_directory` command lib.rs:61 + wrapper workspace-api.ts:62)。
- 不改後端 Rust(`trusted_workspace_root` / `scan_workspace` / `scan_directory` / `workspace_scan::scan_directory` 維持原樣)。
- 不改 `features/workspace` api 層(`scanWorkspace`/`scanDirectory` wrapper 已正確)。
- 不改 bridge 純函式(`mapEntriesToNodes` / `setNodeChildren` / `findNode`)與其測試。
- 不改 store demo 分支、不改 `toggleDir` 樂觀 UI(v2-store.ts:529)、不改 UI 元件(SidePanel)、不改 CSS。
- 不處理 SFTP 遠端 delete/rename/mkdir(後端能力缺口,屬其他子專案;controller.ts:853 已 toast 'Remote delete is not supported yet')。
- 不為 controller 寫大範圍單元測試,只補一個守住此回歸的整合測試。
