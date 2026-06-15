# LSP 互動強化 + Language UI 搬入 Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Git 慣例（覆寫 writing-plans 範例）：** 本專案 CLAUDE.md 優先於 skill 範例。所有 commit 步驟**不執行 `git add`**（staging 由使用者負責），且**僅在使用者要求時**才 commit。每個任務末給出建議 commit 訊息（格式 `<type>(<scope>): <emoji> <desc>`，scope 用 `ui`，結尾 `Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>`，**不**加任何 AI 為 co-author）。執行到 commit 步驟時，提示使用者 stage 後再 commit。

**Goal:** 讓 LSP 與支援的檔案互動——存檔後標示錯誤行、hover 顯示診斷訊息與型別資訊、Ctrl/Cmd+click 跳定義並捲到該行——並將整個 Language 伺服器/診斷/log 面板從 SidePanel 搬入 Settings → Language Servers 分頁。

**Architecture:** v2「Yuzu」shell（`src/v2/`）。後端 LSP（`src-tauri/src/lsp.rs`）與 command wrapper（`src/features/language/language-api.ts`）皆已完成、**零後端改動**。前端走 pull-model：store action 在 `real` 模式 early-return 到 `controller.ts` 的 `realDelegate`，`demo` 模式就地 mutate（非 immer，shallow copy）。本計畫只補三個缺口：(1) 移除打字即時診斷改為存檔才檢查；(2) 新增 `hoverAt` store/controller 串接 + editor hover 卡片；(3) `reveal` 行內定位欄位讓 go-to-definition 與診斷點擊能捲到目標行。

**Tech Stack:** Tauri 2、React、Zustand。DIY 編輯器：透明 `<textarea class="yz2-ed-input">` 疊在逐行 `.yz2-ed-hlline`（JetBrains Mono，**固定 21px 行高**，padding left=0/top=0），scroll 容器是 `.yz2-ed-body`（padding-top 10px）。測試：`bun test`、型別：`bunx tsc --noEmit`。

**已確認的型別（後續任務沿用，勿改名）：**
- `LspRange = { start_line, start_character, end_line, end_character }`（皆 number，snake_case）
- `LspDiagnostic = { path, range: LspRange, severity, message, source: string | null }`
- `LanguageServerStatus = { workspace_id, workspace_root, language, display_name, state, pid, memory_bytes, open_documents, last_error }`
- `LanguageHover = { path, line, character, contents: string }`
- `normSeverity(s) → "error" | "warning" | "info" | "hint"`（注意 `information` 會映成 `info`）
- project state 欄位：`diagnosticsByPath`、`lspServers`、`lspLogs`、`lspLoaded`

**dual-mode 取捨（寫入驗證說明）：** server 文件只在「開檔 + 存檔」同步（Task 1），故 hover / go-to-definition 反映**最後存檔內容**；未存檔編輯的位置可能略偏——與「存檔才檢查」語義一致。詳見 [[v2-dual-mode-state-cleanup]]。

---

## File Structure

| 檔案 | 角色 | 任務 |
| --- | --- | --- |
| `src/v2/v2-store.ts` | dual-mode store：移除打字 lspChange、新增 `hoverAt`/`clearReveal`、`openFile` 帶 reveal | 1,2,3 |
| `src/v2/v2-store.test.ts` | store 單元測試：修既有斷言、補 reveal/hoverAt | 1,2,3 |
| `src/v2/controller.ts` | real delegate：`openFile` 帶 reveal、`gotoDefinition` 定位、新增 `hoverAt` | 2,3 |
| `src/v2/v2-model.ts` | 型別/設定：`Tab.reveal`、`SettingSection.custom` 加 `"language"`、`SETTINGS_CONFIG` 加列 | 2,4 |
| `src/v2/Overlays.tsx` | Settings modal：新增 `LanguageSection` + dispatch + 搬入 `memoryLabel` | 4 |
| `src/v2/Overlays.test.tsx` | Settings 測試：LanguageSection 渲染/互動 | 4 |
| `src/v2/SidePanel.tsx` | 移除 `LanguageBody`、lang 活動列與孤兒 | 5 |
| `src/v2/SidePanel.test.tsx` | 移除三個 language 測試 | 5 |
| `src/v2/ContentViews.tsx` | editor：hover 卡片、Ctrl/Cmd+click、reveal 捲動 | 6 |
| `src/v2/ContentViews.test.tsx` | editor 互動測試（Ctrl/Cmd+click） | 6 |
| `src/v2/yuzu.css` | 新增 `.yz2-ed-hover-*` 卡片樣式 | 6 |

任務依賴：Task 4 需 Task 2 的 `openFile(reveal)`；Task 6 需 Task 2（reveal）+ Task 3（hoverAt）。建議依序 1→2→3→4→5→6。

---

## Task 1: 診斷改為「存檔時才檢查」

移除 `setTabContent` 在每次打字觸發的 `realDelegate?.lspChange(tabId)`（400ms 重新診斷）；保留 `backupTab`。存檔診斷已由 `saveFile`（controller.ts:1038-1040 `openLspDocument` + `scheduleDocDiagPoll`）負責，開檔診斷由 `openFile`（controller.ts:803）負責，皆不動。`lspChange` store action / `scheduleLspChange` 仍是公開 API（測試仍註冊），**不刪**，只是不再自動觸發。

**Files:**
- Modify: `src/v2/v2-store.test.ts`（既有測試斷言，約 118-149）
- Modify: `src/v2/v2-store.ts:1035-1045`（`setTabContent`）

- [ ] **Step 1: 改既有測試使其預期「打字只備份、不診斷」**

`src/v2/v2-store.test.ts` 的 `test("real language actions delegate and editor changes notify LSP")` 在呼叫 `setTabContent` 後斷言 `calls` 同時含 `["backup", tabId, "updated"]` 與 `["change", tabId]`。移除 `["change", tabId]` 這一行（保留 backup）。修改後的斷言區塊：

```ts
        store.getState().setTabContent(tabId, "updated")

        expect(calls).toEqual([
            ["reload"],
            ["restart", "rust-analyzer"],
            ["backup", tabId, "updated"],
        ])
```

> 註：上方 `["reload"]`、`["restart", "rust-analyzer"]` 為該測試前段既有斷言內容；以實際檔案現有陣列為準，**只刪掉 `["change", tabId]` 這一個元素**，其餘原樣保留。

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test src/v2/v2-store.test.ts -t "real language actions delegate"`
Expected: FAIL — 程式仍呼叫 `lspChange`，實際 `calls` 多了 `["change", tabId]`，與新預期不符。

- [ ] **Step 3: 從 `setTabContent` 移除 `lspChange`**

`src/v2/v2-store.ts` 的 `setTabContent`（約 1035-1045）real 分支移除 `lspChange` 那行：

```ts
            setTabContent: (tabId, content) => {
                upd((p) => {
                    p.tabs = p.tabs.map((t) => (t.id === tabId ? { ...t, content } : t))
                })
                if (get().mode === "real") {
                    realDelegate?.backupTab(tabId, content)
                    // 不再每次打字重新診斷；診斷改由 saveFile 在存檔時刷新（見 controller.saveFile）
                }
            },
```

> 以檔案現有 `setTabContent` 實作為準，只刪除 `realDelegate?.lspChange(tabId)` 一行、其餘原樣保留。`upd` 的 tab 更新若與上方略有差異，保留原樣，僅動 real 分支。

- [ ] **Step 4: 跑測試確認通過**

Run: `bun test src/v2/v2-store.test.ts -t "real language actions delegate"`
Expected: PASS。

- [ ] **Step 5: Commit（提示使用者 stage 後）**

建議訊息：
```
refactor(ui): ♻️ 診斷改為存檔時刷新

- 移除 setTabContent 每次打字觸發的 lspChange（即時診斷）
- 保留 backupTab；存檔時由 saveFile 重新診斷
- 同步調整 v2-store.test 斷言（打字只備份不診斷）

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>
```

---

## Task 2: `reveal` 行內定位（model + store + controller）

新增 `Tab.reveal` 欄位，讓 `openFile` 可帶定位資訊；新增 `clearReveal`（UI-only，消費後清除）；`gotoDefinition` 開檔時帶上目標行。這是 Task 4（診斷點擊定位）與 Task 6（editor 捲動）的基礎。

**Files:**
- Modify: `src/v2/v2-model.ts`（`Tab` type）
- Modify: `src/v2/v2-store.ts`（`RealDelegate` 介面、`V2State` 介面、`openFile` impl、新增 `clearReveal`）
- Modify: `src/v2/controller.ts`（`openFile`、`gotoDefinition`）
- Modify: `src/v2/v2-store.test.ts`（新增測試）

- [ ] **Step 1: 寫失敗測試（demo 帶 reveal、real 轉發、clearReveal 清除）**

在 `src/v2/v2-store.test.ts` 末尾（最後一個 `})` 之前，沿用既有 `freshStore()` / `registerRealDelegate(... as any)` 慣例新增：

```ts
test("openFile threads reveal in demo and clearReveal removes it", () => {
    const store = freshStore()
    store.getState().openFile("src/server.ts", { line: 5, col: 3 })
    const opened = store.getState().ui[store.getState().active].tabs.find(
        (t) => t.type === "file" && t.path === "src/server.ts",
    )
    expect(opened?.reveal).toEqual({ line: 5, col: 3 })

    store.getState().clearReveal(opened!.id)
    const cleared = store.getState().ui[store.getState().active].tabs.find((t) => t.id === opened!.id)
    expect(cleared?.reveal).toBeUndefined()
})

test("openFile forwards path and reveal to the real delegate", () => {
    const store = freshStore()
    const calls: unknown[][] = []
    registerRealDelegate({ openFile: (...args: unknown[]) => calls.push(["open", ...args]) } as any)
    store.setState({ mode: "real" })
    store.getState().openFile("src/server.ts", { line: 2, col: 4 })
    expect(calls).toEqual([["open", "src/server.ts", { line: 2, col: 4 }]])
})
```

> `freshStore` / `registerRealDelegate` 已在此測試檔頂部 import（沿用既有 helper）。若 `registerRealDelegate` 在 `afterEach` 已被重設為 `null`，無需額外清理。

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test src/v2/v2-store.test.ts -t "reveal"`
Expected: FAIL — `openFile` 尚不接受第二參數、`clearReveal` 未定義（型別或執行期錯誤）。

- [ ] **Step 3: `Tab` type 新增 `reveal`**

`src/v2/v2-model.ts` 的 `Tab` type（約 57-107 區）加入欄位（放在其他可選欄位旁，例如 `blame?` 附近）：

```ts
    reveal?: { line: number; col: number }
```

- [ ] **Step 4: store 介面與實作**

`src/v2/v2-store.ts`：

(a) `RealDelegate` 介面（約 53-130）將 `openFile` 簽章改為帶 reveal（`clearReveal` 不進 RealDelegate，因屬 UI-only）：

```ts
    openFile: (displayPath: string, reveal?: { line: number; col: number }) => void
```

(b) `V2State` actions 介面（約 302-466，`openFile` 在約 341 行）同步改簽章並在 `setCursor` 附近新增 `clearReveal`：

```ts
    openFile: (path: string, reveal?: { line: number; col: number }) => void
    clearReveal: (tabId: number) => void
```

(c) `openFile` 實作（約 839-848）改為 threading reveal：

```ts
            openFile: (path, reveal) => {
                if (get().mode === "real") {
                    realDelegate?.openFile(path, reveal)
                    return
                }
                const name = path.split("/").pop() ?? path
                upd((p) => {
                    const t = ensureTab(
                        p,
                        (x) => x.type === "file" && x.path === path,
                        () => ({ type: "file", name, path }),
                    )
                    if (reveal) t.reveal = reveal
                })
            },
```

(d) 在 `setCursor`（約 1067-1071）附近新增 `clearReveal`（兩模式共用，純 UI，用 `map` 產生新 ref 觸發 effect 後即早退）：

```ts
            clearReveal: (tabId) => {
                upd((p) => {
                    p.tabs = p.tabs.map((t) => (t.id === tabId && t.reveal ? { ...t, reveal: undefined } : t))
                })
            },
```

> `ensureTab`（v2-store.ts:694）回傳 tab 物件（existing 或新建），故 `t.reveal = reveal` 對兩種情況都成立。

- [ ] **Step 5: controller delegate 帶 reveal**

`src/v2/controller.ts`：

(a) `openFile`（約 765-814）簽章加 `reveal?`，兩個分支都帶上。以現有實作為準，套用下列改動——existing-tab 分支：

```ts
    openFile(displayPath: string, reveal?: { line: number; col: number }) {
        const pid = store().active
        const existing = projectOf(pid).tabs.find((t) => t.type === "file" && t.path === displayPath)
        if (existing) {
            patchProject(pid, (q) => {
                q.activeTab = existing.id
                if (reveal) q.tabs = q.tabs.map((t) => (t.id === existing.id ? { ...t, reveal } : t))
            })
            return
        }
        // ...（現有讀檔 / langForPath / openLspDocument 等邏輯原樣保留）...
```

new-tab 分支建立 tab 時帶上 `reveal`（在現有 `{ id, type: "file", name, path: displayPath, realPath, loading: true, contentLang: langForPath(name) }` 物件尾端加 `, reveal`）：

```ts
        patchProject(pid, (q) => {
            q.tabs = [...q.tabs, { id, type: "file", name, path: displayPath, realPath, loading: true, contentLang: langForPath(name), reveal }]
            q.activeTab = id
        })
```

> 上方第一行的 `existing` / `projectOf` / `patchProject` 取得方式以**檔案現有 `openFile` 實作為準**——只新增 `reveal?` 參數、existing 分支的 `if (reveal) q.tabs = ...map`、new-tab 物件的 `, reveal`，其餘原樣。

(b) `gotoDefinition`（約 2212-2238）把開檔改成帶定位（約 2231 行）：

```ts
        store().openFile(locs[0].path, { line: locs[0].line, col: locs[0].col })
```

- [ ] **Step 6: 跑測試確認通過 + 型別**

Run: `bun test src/v2/v2-store.test.ts -t "reveal"`
Expected: PASS。
Run: `bunx tsc --noEmit`
Expected: exit 0（`openFile` 兩處簽章一致、`Tab.reveal` 已定義）。

- [ ] **Step 7: Commit**

建議訊息：
```
feat(ui): 🚀 openFile 支援 reveal 定位

- Tab 新增 reveal 欄位；openFile 可帶 { line, col }
- 新增 clearReveal（消費後清除，兩模式共用）
- gotoDefinition 開檔時帶上目標行
- controller openFile 兩分支 threading reveal

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>
```

---

## Task 3: `hoverAt` store action + controller delegate

新增 `hoverAt`：`real` 轉發到 controller（呼叫 `requestLanguageHover`，以 `isLspSupportedDocumentPath` 把關），`demo` 回 `null`。供 Task 6 的 editor hover 卡片使用。

**Files:**
- Modify: `src/v2/v2-store.ts`（import、`RealDelegate` 介面、`V2State` 介面、impl）
- Modify: `src/v2/controller.ts`（import、新增 delegate method）
- Modify: `src/v2/v2-store.test.ts`（新增測試）

- [ ] **Step 1: 寫失敗測試（demo 回 null、real 轉發並回傳 hover）**

`src/v2/v2-store.test.ts` 末尾新增：

```ts
test("hoverAt returns null in demo and delegates in real", async () => {
    const store = freshStore()
    expect(await store.getState().hoverAt("src/server.ts", 1, 1)).toBeNull()

    const calls: unknown[][] = []
    registerRealDelegate({
        hoverAt: async (...args: unknown[]) => {
            calls.push(["hover", ...args])
            return { path: "src/server.ts", line: 1, character: 1, contents: "fn foo()" }
        },
    } as any)
    store.setState({ mode: "real" })
    const res = await store.getState().hoverAt("src/server.ts", 2, 3)
    expect(calls).toEqual([["hover", "src/server.ts", 2, 3]])
    expect(res).toEqual({ path: "src/server.ts", line: 1, character: 1, contents: "fn foo()" })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test src/v2/v2-store.test.ts -t "hoverAt"`
Expected: FAIL — `hoverAt` 未定義。

- [ ] **Step 3: store 端 import + 介面 + 實作**

`src/v2/v2-store.ts`：

(a) 頂部 import 補上型別（與其他 `../features/language/language-model` import 同行或新增一行）：

```ts
import type { LanguageHover } from "../features/language/language-model"
```

(b) `RealDelegate` 介面（`gotoDefinition` 附近，約 124 行）新增：

```ts
    hoverAt: (path: string, line: number, col: number) => Promise<LanguageHover | null>
```

(c) `V2State` actions 介面（`gotoDefinition` 附近，約 364 行）新增：

```ts
    hoverAt: (path: string, line: number, col: number) => Promise<LanguageHover | null>
```

(d) 實作（`gotoDefinition` impl 附近，約 1073-1079）：

```ts
            hoverAt: async (path, line, col) => {
                if (get().mode === "real") return (await realDelegate?.hoverAt(path, line, col)) ?? null
                return null
            },
```

- [ ] **Step 4: controller delegate 新增 `hoverAt`**

`src/v2/controller.ts`：

(a) import 區（約 96-98，已 import `requestLanguageDefinition` / `requestLanguageReferences`）補上：

```ts
import { requestLanguageHover } from "../features/language/language-api"
import type { LanguageHover } from "../features/language/language-model"
```

> 若 `requestLanguageHover` 與既有 `requestLanguageDefinition` 同一個 import 陳述式，併入該行即可；`isLspSupportedDocumentPath`、`cursorToLsp`、`lspPath`、`rootOf` 皆已 import/定義（既有 `gotoDefinition` 已用到）。

(b) 在 `gotoDefinition` delegate 之後新增 method（與既有 delegate 同層、同 `realDelegate` 物件內）：

```ts
    async hoverAt(path: string, line: number, col: number): Promise<LanguageHover | null> {
        const pid = store().active
        const root = rootOf(pid)
        if (!root || !isLspSupportedDocumentPath(path)) return null
        try {
            const pos = cursorToLsp({ ln: line, col })
            return await requestLanguageHover({
                workspaceId: pid,
                workspaceRoot: root,
                path: lspPath(root, path),
                line: pos.line,
                character: pos.character,
            })
        } catch {
            return null
        }
    },
```

> `cursorToLsp` / `lspPath` / `rootOf` 的呼叫形式以**既有 `gotoDefinition` delegate 內的用法為準**（同檔已有相同模式，照抄參數順序）。`requestLanguageHover` 的入參形狀比照 `requestLanguageDefinition`（language-api.ts:47-55 已定義並回傳已正規化的 `LanguageHover | null`）。

- [ ] **Step 5: 跑測試確認通過 + 型別**

Run: `bun test src/v2/v2-store.test.ts -t "hoverAt"`
Expected: PASS。
Run: `bunx tsc --noEmit`
Expected: exit 0。

- [ ] **Step 6: Commit**

建議訊息：
```
feat(ui): 🚀 新增 hoverAt 取得 LSP hover

- store hoverAt：real 轉發 controller、demo 回 null
- controller delegate 呼叫 requestLanguageHover，以 isLspSupportedDocumentPath 把關
- 供 editor hover 卡片使用

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>
```

---

## Task 4: Language 面板搬入 Settings → Language Servers

新增 Settings custom section `"language"`，把 SidePanel 的 `LanguageBody`（servers / diagnostics / logs）原樣移成 `LanguageSection`，差異：掛載時若未載入則 `reloadLang`（取代原 `selectFn("lang")→ensureLang` 觸發）、診斷點擊改為「開檔 + 定位 + 關閉設定」。`memoryLabel` helper 從 SidePanel 搬到 Overlays。

**Files:**
- Modify: `src/v2/v2-model.ts`（`SettingSection.custom` union、`SETTINGS_CONFIG`）
- Modify: `src/v2/Overlays.tsx`（import、`memoryLabel`、`LanguageSection`、dispatch）
- Modify: `src/v2/Overlays.test.tsx`（新增測試）

- [ ] **Step 1: 寫失敗測試（透過 SettingsModal 渲染 LanguageSection）**

`src/v2/Overlays.test.tsx`：import 加入 `SettingsModal`（第 7 行併入既有 `./Overlays` import），在檔案末尾新增 describe。沿用既有 `v2Store` singleton + `render`/`fireEvent` 慣例；本 describe 自帶 `afterEach` 還原被覆寫的 action 與設定狀態（檔案層 afterEach 不還原這些）：

```tsx
describe("Settings · Language Servers", () => {
    const orig = {
        reloadLang: v2Store.getState().reloadLang,
        restartLspServer: v2Store.getState().restartLspServer,
        openFile: v2Store.getState().openFile,
    }
    afterEach(() => {
        v2Store.setState({ ...orig, stOpen: false, stSec: "general" })
    })

    function seed(over: Record<string, unknown> = {}) {
        v2Store.setState((s) => ({
            mode: "real",
            active: "api",
            stOpen: true,
            stSec: "language",
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    lspLoaded: true,
                    lspServers: [
                        {
                            workspace_id: "api",
                            workspace_root: "/w",
                            language: "TypeScript",
                            display_name: "typescript-language-server",
                            state: "Running",
                            pid: 42,
                            memory_bytes: 1048576,
                            open_documents: 1,
                            last_error: null,
                        },
                    ],
                    diagnosticsByPath: {
                        "src/server.ts": [
                            {
                                path: "src/server.ts",
                                range: { start_line: 4, start_character: 2, end_line: 4, end_character: 6 },
                                severity: "error",
                                message: "Cannot find name 'foo'.",
                                source: "ts",
                            },
                        ],
                    },
                    lspLogs: ["started typescript-language-server"],
                    ...over,
                },
            },
        }))
    }

    test("renders servers and diagnostics and wires restart", () => {
        const calls: unknown[][] = []
        seed()
        v2Store.setState({ restartLspServer: (lang: string) => calls.push(["restart", lang]) })
        const view = render(<SettingsModal />)
        expect(view.getByText("typescript-language-server")).toBeTruthy()
        expect(view.container.querySelector(".yz2-lang-diag")).toBeTruthy()
        fireEvent.click(view.getByLabelText("Restart typescript-language-server"))
        expect(calls).toContainEqual(["restart", "TypeScript"])
    })

    test("clicking a diagnostic opens the file at the line and closes settings", () => {
        const calls: unknown[][] = []
        seed()
        v2Store.setState({ openFile: (path: string, reveal?: unknown) => calls.push(["open", path, reveal]) })
        const view = render(<SettingsModal />)
        fireEvent.click(view.container.querySelector(".yz2-lang-diag") as HTMLElement)
        expect(calls).toContainEqual(["open", "src/server.ts", { line: 5, col: 3 }])
        expect(v2Store.getState().stOpen).toBe(false)
    })
})
```

> 診斷 `start_line: 4` → 顯示/定位 line 5（+1）；`start_character: 2` → col 3（+1）。`restartLspServer` 收到的是 `server.language`（"TypeScript"）。`closeSettings` 為真實 action（`set({ stOpen: false })`），故 `stOpen` 變 false。

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test src/v2/Overlays.test.tsx -t "Language Servers"`
Expected: FAIL — `"language"` section 不存在，SettingsModal 走 `cur.rows.map` fallback，找不到 `.yz2-lang-diag` / server 文字。

- [ ] **Step 3: v2-model 新增 section 設定**

`src/v2/v2-model.ts`：

(a) `SettingSection.custom` union（約 829）加 `"language"`：

```ts
    custom?: "performance" | "diagnostics" | "recovery" | "language"
```

(b) `SETTINGS_CONFIG`（約 832-876）在 `shortcuts` 之後、`performance` 之前插入（label「Language Servers」以與 general 既有的顯示語言列區隔）：

```ts
    { id: "language", label: "Language Servers", glyph: "◇", desc: "Language servers, diagnostics and logs for the active workspace.", rows: [], custom: "language" },
```

- [ ] **Step 4: Overlays 新增 `memoryLabel` + `LanguageSection` + dispatch**

`src/v2/Overlays.tsx`：

(a) 頂部 import：確保 `useEffect` 由 `react` 匯入；`./v2-model` 的 import 補上 `normSeverity`。

(b) 在檔案上方（其他 helper 旁）新增 `memoryLabel`（從 SidePanel 搬來，原樣）：

```tsx
function memoryLabel(bytes: number | null): string {
    if (bytes == null) return "not running"
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB"
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB"
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB"
    return bytes + " B"
}
```

(c) 新增 `LanguageSection`（沿用原 `LanguageBody` 的 `.yz2-lang-*` JSX，故**不需新 CSS**；外層改用 `yz2-stab` + `yz2-stab-refresh` 比照 `PerformanceSection`；診斷點擊改帶 reveal 並關閉設定）：

```tsx
function LanguageSection() {
    const mode = useV2Store((s) => s.mode)
    const project = useV2Store((s) => s.ui[s.active])
    const reloadLang = useV2Store((s) => s.reloadLang)
    const restartLspServer = useV2Store((s) => s.restartLspServer)
    const openFile = useV2Store((s) => s.openFile)
    const closeSettings = useV2Store((s) => s.closeSettings)
    useEffect(() => {
        if (mode === "real" && !project.lspLoaded) reloadLang()
    }, [mode, project.lspLoaded, reloadLang])
    const diagnostics = Object.entries(project.diagnosticsByPath).flatMap(([path, byPath]) =>
        byPath.map((diagnostic, index) => ({ ...diagnostic, path, index })),
    )
    return (
        <div className="yz2-stab">
            <div className="yz2-stab-refresh">
                <button type="button" className="yz2-lang-iconbtn" aria-label="Refresh language data" onClick={reloadLang}>⟳</button>
            </div>
            {mode === "real" && !project.lspLoaded ? <div className="yz2-panel-note">Loading language servers...</div> : null}
            {mode !== "real" ? <div className="yz2-panel-note">Language services are not connected in demo mode.</div> : null}
            <div className="yz2-lang-section">
                <div className="yz2-lang-section-head">
                    <span>LANGUAGE SERVERS</span>
                    <span>{project.lspServers.length}</span>
                </div>
                {project.lspServers.length ? (
                    project.lspServers.map((server) => (
                        <div className="yz2-lang-server" key={`${server.workspace_id}:${server.workspace_root}:${server.language}`}>
                            <span className="ic">◇</span>
                            <div className="main">
                                <span className="name">{server.display_name}</span>
                                <span className="meta">{server.state} · pid {server.pid ?? "n/a"}</span>
                                <span className="meta">open {server.open_documents} · mem {memoryLabel(server.memory_bytes)}</span>
                            </div>
                            <span className={"yz2-lang-state is-" + String(server.state).toLowerCase()}>{server.state}</span>
                            <button type="button" className="yz2-lang-iconbtn" aria-label={`Restart ${server.display_name}`} onClick={() => restartLspServer(server.language)}>↻</button>
                        </div>
                    ))
                ) : (
                    <div className="yz2-sc-empty">No language servers detected</div>
                )}
            </div>
            <div className="yz2-lang-section">
                <div className="yz2-lang-section-head">
                    <span>DIAGNOSTICS</span>
                    <span>{diagnostics.length}</span>
                </div>
                {diagnostics.length ? (
                    diagnostics.map((diagnostic) => {
                        const sev = normSeverity(diagnostic.severity)
                        const line = diagnostic.range.start_line + 1
                        return (
                            <button
                                type="button"
                                key={`${diagnostic.path}:${line}:${diagnostic.index}`}
                                className="yz2-lang-diag"
                                aria-label={`Open ${diagnostic.path}`}
                                title={`Open ${diagnostic.path}`}
                                onClick={() => {
                                    openFile(diagnostic.path, { line, col: diagnostic.range.start_character + 1 })
                                    closeSettings()
                                }}
                            >
                                <span className={"yz2-lang-sev is-" + sev}>{sev}</span>
                                <span className="main">
                                    <span className="name">{diagnostic.path}:{line}</span>
                                    <span className="meta">{diagnostic.source ?? "unknown"}</span>
                                    <span className="meta">{diagnostic.message}</span>
                                </span>
                            </button>
                        )
                    })
                ) : (
                    <div className="yz2-sc-empty">No diagnostics</div>
                )}
            </div>
            <div className="yz2-lang-section">
                <div className="yz2-lang-section-head">
                    <span>SERVER LOGS</span>
                    <span>{project.lspLogs.length}</span>
                </div>
                <pre className="yz2-lang-log">{project.lspLogs.length ? project.lspLogs.join("\n") : "none"}</pre>
            </div>
        </div>
    )
}
```

(d) 在 `SettingsModal` 的 custom dispatch（約 573-579）加分支：

```tsx
                        {cur.custom === "performance" ? (
                            <PerformanceSection />
                        ) : cur.custom === "diagnostics" ? (
                            <DiagnosticsSection />
                        ) : cur.custom === "recovery" ? (
                            <RecoverySection />
                        ) : cur.custom === "language" ? (
                            <LanguageSection />
                        ) : (
```

> 只新增 `) : cur.custom === "language" ? ( <LanguageSection /> ` 這一段，其餘 dispatch chain 與後續 `cur.rows.map` fallback 原樣保留。

- [ ] **Step 5: 跑測試確認通過 + 型別**

Run: `bun test src/v2/Overlays.test.tsx -t "Language Servers"`
Expected: PASS（兩個測試）。
Run: `bunx tsc --noEmit`
Expected: exit 0。

- [ ] **Step 6: Commit**

建議訊息：
```
feat(ui): 🚀 Language 面板移入 Settings

- 新增 Settings → Language Servers 分頁（custom section）
- LanguageSection 沿用原 LanguageBody，掛載時自動載入
- 診斷點擊改為開檔定位並關閉設定
- memoryLabel helper 從 SidePanel 搬至 Overlays

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>
```

---

## Task 5: 從 SidePanel 移除 Language

刪除 `LanguageBody`、lang 活動列與 body switch case，並清掉因此產生的孤兒（`langBadge`、其 `diagnosticsByPath` selector、`memoryLabel`、未用 import）。保留 `FnMode` 的 `"lang"`（v2-model.ts:10）與 `controller.ts:743` 的 `if (fn === "lang") void ensureLang(pid)`（被測試引用、無害），僅移除 UI 入口。

**Files:**
- Modify: `src/v2/SidePanel.test.tsx`（移除三個 language 測試）
- Modify: `src/v2/SidePanel.tsx`（移除 LanguageBody / 活動列 / switch / 孤兒 / import）

- [ ] **Step 1: 移除三個 language 測試**

`src/v2/SidePanel.test.tsx` 移除位於約 47、56、130 行、render `LanguageBody` 或斷言 Language 面板的三個 `test(...)` 區塊（整個 test 連同其 body 一併刪除）。

> 註：此檔在 full-suite 另有 6 個**既存** `meta.name` 失敗，與本次無關（見 [[v2-sidepanel-test-flaky]]），勿誤判為回歸——以單檔執行的綠燈為準。

- [ ] **Step 2: 跑測試確認（此時應仍可編譯但 LanguageBody 即將消失）**

Run: `bun test src/v2/SidePanel.test.tsx`
Expected: 三個 language 測試已不存在；其餘測試維持原狀（單檔執行下不含那 6 個 full-suite 才出現的 `meta.name` 失敗）。

- [ ] **Step 3: 移除 `LanguageBody` 與 UI 入口**

`src/v2/SidePanel.tsx`：

(a) 刪除整個 `LanguageBody` 函式（約 429-520）。

(b) `FunctionList` 的 `rows` 陣列移除 lang 列（約 40）：

```tsx
        { id: "lang", label: "Language", badge: langBadge ?? undefined, icon: <><path d="M3 3.5h6.5L13 7v5.5H3z" /><path d="M9.5 3.5V7H13 M5 9h6 M5 11h4" /></> },
```

(c) `SidePanel` body switch 移除（約 548）：

```tsx
                {fn === "lang" ? <LanguageBody /> : null}
```

(d) 移除因上述改動而孤立者：
- `FunctionList` 內的 `const langBadge = diagBadge(diagnosticsByPath ?? {})`（約 34）。
- `FunctionList` 內專供 langBadge 的 `const diagnosticsByPath = useV2Store((s) => s.ui[s.active].diagnosticsByPath)`（約 30）。
- `memoryLabel` helper（約 7-13，已搬至 Overlays）。
- 頂部 import（約 3）移除 `diagBadge`、`normSeverity`（移除 LanguageBody 後未使用）：改為
  ```ts
  import { DIR_CHIP, chipFor, LANE_COLORS } from "./v2-model"
  ```
  > 以實際保留用到的符號為準；若 `DIR_CHIP` / `chipFor` / `LANE_COLORS` 其中某個在移除後也變孤兒，一併移除；反之若仍被其他 body 使用則保留。逐一確認後再定。

- [ ] **Step 4: 跑測試 + 型別確認無孤兒/未用**

Run: `bun test src/v2/SidePanel.test.tsx`
Expected: PASS（單檔）。
Run: `bunx tsc --noEmit`
Expected: exit 0（無 unused import / undefined reference）。

- [ ] **Step 5: Commit**

建議訊息：
```
refactor(ui): ♻️ 從 SidePanel 移除 Language 入口

- 刪除 LanguageBody、lang 活動列與 body switch
- 清除孤兒：langBadge、diagnosticsByPath selector、memoryLabel、未用 import
- 保留 FnMode "lang" 與 controller ensureLang（測試引用、無害）

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>
```

---

## Task 6: Editor hover 卡片 + Ctrl/Cmd+click 跳定義 + reveal 捲動

在 `EditableBody`（透明 textarea）補上：滑鼠停留 ~320ms 顯示 hover 卡片（本地診斷訊息即時 + LSP hover 非同步）、Ctrl/Cmd+click 識別字觸發 `gotoDefinition`、`tab.reveal` 載入後捲到目標行。CSS 度量已確認：行高固定 21px、`.yz2-ed-input` padding left=0/top=0、scroll 容器 `.yz2-ed-body`（padding-top 10px）；字寬隨 fontSize 變，用 canvas 量測。

**Files:**
- Modify: `src/v2/ContentViews.tsx`（import、`measureCharWidth`、`EditableBody`）
- Modify: `src/v2/yuzu.css`（`.yz2-ed-hover-*`）
- Modify: `src/v2/ContentViews.test.tsx`（Ctrl/Cmd+click 測試）

- [ ] **Step 1: 寫失敗測試（Ctrl/Cmd+click → gotoDefinition）**

`src/v2/ContentViews.test.tsx`：沿用既有 `EditorView` import、`registerRealDelegate` / `v2Store` 與 `resetBrowser`（mode:"real"）慣例。`EditableBody` 未 export，故 render 已 export 的 `EditorView`，比照既有「context menu captures textarea cursor」測試（設 `selectionStart` 取得點擊位置）。新增：

```tsx
test("ctrl/cmd+click on a supported file triggers gotoDefinition at the caret", () => {
    const calls: unknown[][] = []
    registerRealDelegate({
        openFile: () => {},
        backupTab: () => {},
        gotoDefinition: (...args: unknown[]) => calls.push(["goto", ...args]),
        hoverAt: async () => null,
    } as any)
    const tab = {
        id: 9101,
        type: "file" as const,
        name: "server.ts",
        path: "src/server.ts",
        realPath: "/workspace/src/server.ts",
        content: "alpha\nbeta\n",
        contentLang: "ts",
    }
    v2Store.setState((s) => ({
        mode: "real",
        active: "api",
        ui: { ...s.ui, api: { ...s.ui.api, tabs: [tab as any], activeTab: tab.id } },
    }))
    const view = render(<EditorView tab={tab as any} />)
    const textarea = view.container.querySelector("textarea") as HTMLTextAreaElement
    textarea.selectionStart = 7
    textarea.selectionEnd = 7
    fireEvent.click(textarea, { ctrlKey: true })
    expect(calls).toEqual([["goto", "src/server.ts", 2, 2]])
})
```

> `content = "alpha\nbeta\n"`，caret offset 7 → `cursorFrom` 得 `{ ln: 2, col: 2 }`（"alpha\n"=6 字元，第 7 字元在第 2 行第 2 欄）。`gotoDefinition(path, ln, col)` → `["goto", "src/server.ts", 2, 2]`。`registerRealDelegate` 提供 `hoverAt` 以滿足型別（hover 在此測試不觸發）。tab 物件以 `as any` 套用，避免列出全部可選欄位。

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test src/v2/ContentViews.test.tsx -t "ctrl/cmd+click"`
Expected: FAIL — textarea 尚無 `onClick`，`calls` 為空。

- [ ] **Step 3: import 調整 + 模組層字寬量測**

`src/v2/ContentViews.tsx`：

(a) 第 4 行 `import { useRef } from "react"` 改為：

```ts
import { useEffect, useRef, useState } from "react"
```

(b) 既有 `import type { LspDiagnostic } from "../features/language/language-model"`（第 6 行）下方新增**值** import：

```ts
import { isLspSupportedDocumentPath } from "../features/language/language-model"
```

(c) 第 8 行 `./v2-model` 的 import 補上 `normSeverity`（加入既有 named list）。

(d) 在 `EMPTY_DIAGNOSTICS`（約 29）附近新增模組層字寬量測：

```ts
let cwCache = { key: "", w: 0 }
function measureCharWidth(el: HTMLElement): number {
    const cs = getComputedStyle(el)
    const key = cs.fontSize + "|" + cs.fontFamily
    if (cwCache.key === key && cwCache.w) return cwCache.w
    const ctx = document.createElement("canvas").getContext("2d")
    let w = 7.8
    if (ctx) {
        ctx.font = cs.fontSize + " " + cs.fontFamily
        w = ctx.measureText("M").width || 7.8
    }
    cwCache = { key, w }
    return w
}
```

- [ ] **Step 4: `EditableBody` 加入 ref / state / selector / handlers**

在 `EditableBody`（約 64-73）現有 selector 之後、`return` 之前新增：

```ts
    const gotoDefinition = useV2Store((s) => s.gotoDefinition)
    const hoverAt = useV2Store((s) => s.hoverAt)
    const clearReveal = useV2Store((s) => s.clearReveal)
    const taRef = useRef<HTMLTextAreaElement>(null)
    const [hover, setHover] = useState<{ x: number; y: number; diags: LspDiagnostic[]; doc: string | null } | null>(null)
    const hoverTimer = useRef<ReturnType<typeof setTimeout>>()
    const hoverSeq = useRef(0)
    const supported = isLspSupportedDocumentPath(tab.path ?? "")

    function clearHover() {
        if (hoverTimer.current) clearTimeout(hoverTimer.current)
        hoverSeq.current++
        setHover(null)
    }
    function onAreaMouseMove(e: React.MouseEvent) {
        const el = taRef.current
        if (!el) return
        const cx = e.clientX
        const cy = e.clientY
        if (hoverTimer.current) clearTimeout(hoverTimer.current)
        hoverTimer.current = setTimeout(() => {
            const area = el.closest(".yz2-ed-area")
            if (!area) return
            const r = area.getBoundingClientRect()
            const line = Math.floor((cy - r.top) / 21) + 1
            const col = Math.floor((cx - r.left) / measureCharWidth(el)) + 1
            if (line < 1 || col < 1) {
                setHover(null)
                return
            }
            const diags = diagnostics.filter((d) => line >= d.range.start_line + 1 && line <= d.range.end_line + 1)
            const seq = ++hoverSeq.current
            void Promise.resolve(supported ? hoverAt(tab.path ?? "", line, col) : null).then((h) => {
                if (seq !== hoverSeq.current) return
                const doc = h?.contents?.trim() ? h.contents.trim() : null
                if (!doc && !diags.length) {
                    setHover(null)
                    return
                }
                setHover({ x: cx, y: cy, diags, doc })
            })
        }, 320)
    }

    useEffect(() => {
        const reveal = tab.reveal
        const el = taRef.current
        if (!reveal || !el || typeof tab.content !== "string") return
        const arr = content.split("\n")
        let off = 0
        for (let i = 0; i < reveal.line - 1 && i < arr.length; i++) off += arr[i].length + 1
        off += Math.max(0, reveal.col - 1)
        el.focus({ preventScroll: true })
        el.selectionStart = el.selectionEnd = Math.min(off, content.length)
        const body = el.closest(".yz2-ed-body") as HTMLElement | null
        if (body) body.scrollTop = Math.max(0, 10 + (reveal.line - 1) * 21 - body.clientHeight / 2)
        clearReveal(tab.id)
    }, [tab.reveal, content, clearReveal, tab.id])
```

> `React.MouseEvent` 型別：ContentViews 已是 `.tsx`、JSX 範圍內 `React` 可用；若該檔未 import `React` 命名空間而 tsconfig 非自動注入，將 `React.MouseEvent` 改為從 `react` import `MouseEvent as ReactMouseEvent` 並改用之。先以 `React.MouseEvent` 撰寫，`tsc` 報錯時才調整。

- [ ] **Step 5: 改 textarea（加 ref / onClick / onMouseMove / onMouseLeave、onChange 先關卡片）+ hover 卡片 JSX**

把 `EditableBody` 的 `<textarea>`（約 115-145）替換為（在現有屬性上新增 `ref`、`onClick`、`onMouseMove`、`onMouseLeave`，並於 `onChange` 開頭呼叫 `clearHover()`，其餘 handler 原樣）：

```tsx
                <textarea
                    ref={taRef}
                    className="yz2-ed-input"
                    value={content}
                    spellCheck={false}
                    wrap="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    onMouseMove={onAreaMouseMove}
                    onMouseLeave={clearHover}
                    onClick={(e) => {
                        if ((e.metaKey || e.ctrlKey) && supported) {
                            e.preventDefault()
                            const { ln, col } = cursorFrom(e.currentTarget)
                            gotoDefinition(tab.path ?? "", ln, col)
                        }
                    }}
                    onChange={(e) => {
                        clearHover()
                        setTabContent(tab.id, e.target.value)
                        setCursor(cursorFrom(e.target))
                    }}
                    onSelect={(e) => setCursor(cursorFrom(e.currentTarget))}
                    onBlur={() => setCursor(null)}
                    onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                            e.preventDefault()
                            saveTab(tab.id)
                            return
                        }
                        if (e.key === "Tab") {
                            e.preventDefault()
                            const el = e.currentTarget
                            const start = el.selectionStart
                            const indent = " ".repeat(tabSize)
                            setTabContent(tab.id, el.value.slice(0, start) + indent + el.value.slice(el.selectionEnd))
                            requestAnimationFrame(() => {
                                el.selectionStart = el.selectionEnd = start + indent.length
                            })
                        }
                    }}
                />
```

在 `.yz2-ed-area` 的閉合 `</div>`（約 146）之後、`.yz2-ed-edit` 閉合 `</div>`（約 147）之前，新增 hover 卡片（`position: fixed` 不影響排版）：

```tsx
            {hover ? (
                <div className="yz2-ed-hover" style={{ left: hover.x + 12, top: hover.y + 16 }}>
                    {hover.diags.map((d, i) => (
                        <div key={i} className={"yz2-ed-hover-diag is-" + normSeverity(d.severity)}>
                            <span className="sev">{normSeverity(d.severity)}</span>
                            <span className="msg">{d.message}</span>
                        </div>
                    ))}
                    {hover.doc ? <pre className="yz2-ed-hover-doc">{hover.doc}</pre> : null}
                </div>
            ) : null}
```

- [ ] **Step 6: yuzu.css 新增 hover 卡片樣式**

`src/v2/yuzu.css` 在 `.yz2-ed-input` 區塊附近新增（變數沿用既有 `--yz-*`；風格對齊既有浮層）：

```css
.yz2-ed-hover {
    position: fixed;
    z-index: 430;
    max-width: 460px;
    max-height: 320px;
    overflow: auto;
    background: var(--yz-141a24);
    border: 1px solid var(--yz-2b3547);
    border-radius: 8px;
    padding: 8px 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    font-size: 12px;
    pointer-events: none;
}
.yz2-ed-hover-diag {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin-bottom: 6px;
}
.yz2-ed-hover-diag .sev {
    text-transform: uppercase;
    font-size: 10px;
    font-weight: 700;
}
.yz2-ed-hover-diag.is-error .sev {
    color: var(--yz-f07178);
}
.yz2-ed-hover-diag.is-warning .sev {
    color: var(--yz-ffcb6b);
}
.yz2-ed-hover-diag.is-info .sev,
.yz2-ed-hover-diag.is-hint .sev {
    color: var(--yz-82aaff);
}
.yz2-ed-hover-doc {
    margin: 4px 0 0;
    white-space: pre-wrap;
    color: var(--yz-c7d0db);
    font-family: inherit;
}
```

> 上述 `--yz-141a24` / `--yz-2b3547` / `--yz-f07178` / `--yz-ffcb6b` / `--yz-82aaff` / `--yz-c7d0db` 以 yuzu.css 既有變數為準；若某變數名不存在，改用該檔既有最接近的背景/邊框/紅/黃/藍/前景變數（搜尋既有 `.yz2-refs` 或診斷色彩定義照抄）。

- [ ] **Step 7: 跑測試確認通過 + 型別**

Run: `bun test src/v2/ContentViews.test.tsx -t "ctrl/cmd+click"`
Expected: PASS。
Run: `bunx tsc --noEmit`
Expected: exit 0。

> **手動驗證（jsdom 無真實版面，不寫脆弱單測）：** hover 像素換算（`getBoundingClientRect` / canvas 量測在 jsdom 回 0）與 reveal 捲動需在桌面版實測——見下方 Verification 步驟 4、5。

- [ ] **Step 8: Commit**

建議訊息：
```
feat(ui): 🚀 編輯器 hover 卡片與 Ctrl/Cmd+click 跳定義

- hover 停留 320ms 顯示本地診斷訊息 + LSP hover 型別資訊
- Ctrl/Cmd+click 識別字觸發 gotoDefinition
- tab.reveal 載入後捲到目標行並定位 caret
- 新增 .yz2-ed-hover-* 樣式

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>
```

---

## Verification（端到端）

1. **型別 + 單元測試**
   - `bunx tsc --noEmit` → exit 0
   - `bun test src/v2/` → 本次改動相關綠燈；`SidePanel.test.tsx` 在 full-suite 的 6 個 `meta.name` 失敗為**既存**（[[v2-sidepanel-test-flaky]]），確認與改動前一致、非回歸。
2. **建置桌面版** `bun run tauri build`（或既有 dev 流程），開啟含 `.rs` / `.ts` 的真實 workspace。
3. **診斷（存檔才檢查）** — 在支援檔打字製造錯誤 → **打字當下不應變動**診斷；按 ⌘/Ctrl+S → 該行出現底線 + gutter 診斷點。
4. **hover** — 滑鼠停在錯誤行 ~0.3s → 卡片顯示診斷 severity + message；停在識別字 → 顯示型別 / 文件；移開即消失。
5. **go-to-definition** — Ctrl/Cmd+click 識別字 → 跳到定義（跨檔開新分頁），且**自動捲到該行**並把 caret 放到該位置。
6. **Settings 搬遷** — SidePanel 不再有 Language 圖示；Settings → **Language Servers** 顯示 servers / diagnostics / logs，⟳ Refresh 與 ↻ Restart 正常；點診斷項會關閉設定、開檔並定位到該行。
7. **記憶體（可選）** `scripts/measure-mem.ps1 -AttachPid <pid>` 確認 LSP 行為未顯著增加常駐。

## 風險與備註

- 移除 SidePanel「lang」後，server 啟動完全依賴開檔（`openFile`→`openLspDocument`，已驗證 controller.ts:803）與 Settings 分頁的 `reloadLang`；workspace 整體診斷在進入 Settings → Language Servers 時載入。
- hover / go-to-definition 反映**最後存檔內容**（Task 1 取捨），未存檔編輯位置可能略偏——與「存檔才檢查」一致。
- 移動後的面板沿用既有 `.yz2-lang-*` 樣式，於 modal 內版面若需微調再於 `yuzu.css` 局部處理。
- `bun test` 跨檔共用 module 快取，全套執行時以 delta 斷言判讀；單檔執行較乾淨。
