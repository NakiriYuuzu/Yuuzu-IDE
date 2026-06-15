# Yuuzu-IDE 現版優化(Path 2)實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不重寫、不換框架的前提下,降低現版 Tauri build 的真實記憶體與大檔卡頓,並量出 LSP 記憶體桶大小,為未來最大的一塊優化(① LSP 生命週期)定錨。

**Architecture:** 三件事,依「資訊量/風險」排序 —— (1) 量測 LSP 記憶體桶(投資前先確認獎勵);(2) 把編輯器 highlight cache 抽成共用模組並在關 tab 時驅逐(止住整場 session 的緩慢成長);(3) 用 `content-visibility` 讓畫面外的編輯器行不參與 layout/paint(抓住大檔順暢度,零對齊風險)。完整 react-virtual 列為條件式後續,待 Task 1 量測證明 node 數記憶體仍是問題才規劃。

**Tech Stack:** Tauri 2 / React 19 / Zustand / `bun test` + happy-dom / `@tanstack/react-virtual`(已安裝)/ PowerShell 量測腳本。

---

## 專案慣例(覆蓋 skill 預設)

- **絕不執行 `git add`** —— staging 是使用者的責任。下方 commit 步驟假設你已自行 stage。
- 每個 commit 結尾必須有 `Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>`,**絕不**加入任何 AI 為 Co-Author。
- Commit 格式:`<type>(<scope>): <emoji> <desc>`。本計畫用到的 scope:`ui`。
- 測試指令一律 `bun test <path>`(專案用 `bun:test` + happy-dom preload,見 `bunfig.toml`)。

---

## File Structure

| 檔案 | 角色 | 動作 |
|---|---|---|
| `scripts/measure-mem.ps1` | Windows 記憶體探針 | 修改:加 `-AttachPid` 附掛模式(量已開 workspace 的 app) |
| `src/v2/hl-cache.ts` | 編輯器 highlight 快取(共用 leaf module) | 新建:`highlightContent` / `evictHlCache` / `hlCacheSize` |
| `src/v2/hl-cache.test.ts` | hl-cache 單元 + 驅逐 wiring 測試 | 新建 |
| `src/v2/ContentViews.tsx` | 主內容視圖 | 修改:改用 hl-cache;移除本地 cache |
| `src/v2/v2-store.ts` | Zustand store | 修改:closeTab / closeOthers / closeAllTabs / 路徑刪除 呼叫 `evictHlCache` |
| `src/v2/yuzu.css` | v2 樣式 | 修改:編輯器行加 `content-visibility` |

> 抽 leaf module 的理由:`realHlCache` 目前是 `ContentViews.tsx` 私有,store 搆不到;而 `ContentViews` 又 import `v2-store` —— 若讓 store 反向 import 視圖會形成循環。抽成只依賴 `v2-model` 的 leaf `hl-cache.ts`,兩邊都能安全 import,且可單獨單元測試。

---

## Task 1:量① — 量測 LSP 記憶體桶(手動,無 commit)

**性質:** 量測,非自動化。需要人在 GUI 開 workspace(subagent 無法點 GUI)。產出填回本節表格。

**Files:**
- Modify: `scripts/measure-mem.ps1`(加附掛模式)

- [ ] **Step 1:給 `measure-mem.ps1` 加 `-AttachPid` 模式**

在 `param(...)` 區塊加一個參數,並讓有 `AttachPid` 時跳過 launch、直接量該 pid 的 tree。把 `param` 區塊改成:

```powershell
param(
    [string]$Exe = "D:\AI\Yuuzu-IDE\src-tauri\target\release\yuuzu-ide.exe",
    [int]$SettleSeconds = 8,
    [int]$LaunchTimeoutSeconds = 30,
    [int]$AttachPid = 0
)
```

並把「啟動 app」那段(`$sw = ...` 到 `Start-Sleep -Seconds $SettleSeconds`)換成:

```powershell
if ($AttachPid -gt 0) {
    $proc = Get-Process -Id $AttachPid -ErrorAction Stop
    $launchMs = -1   # 附掛模式不量啟動時間
} else {
    if (-not (Test-Path $Exe)) { Write-Error "exe not found: $Exe"; exit 1 }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath $Exe -PassThru
    while (-not $proc.HasExited -and $proc.MainWindowHandle -eq 0 -and $sw.Elapsed.TotalSeconds -lt $LaunchTimeoutSeconds) {
        Start-Sleep -Milliseconds 40
        $proc.Refresh()
    }
    $launchMs = $sw.ElapsedMilliseconds
    if ($proc.HasExited) { Write-Error "app exited right after launch (exit $($proc.ExitCode))"; exit 1 }
    Start-Sleep -Seconds $SettleSeconds
}
```

- [ ] **Step 2:啟動 app 並記下 PID**

Run: `powershell.exe -ExecutionPolicy Bypass -File 'D:\AI\Yuuzu-IDE\scripts\measure-mem.ps1'`
記下輸出最後的 `PID=<n>`。

- [ ] **Step 3:在 GUI 手動開一個真實 Rust+TS workspace**

開 `D:\AI\Yuuzu-IDE` 自己這個 repo(同時含 Rust 與 TS),並**各開一個 `.rs` 檔與一個 `.ts` 檔**,以觸發 `rust-analyzer` 與 `typescript-language-server`。等約 30–60 秒讓 LSP 索引穩定。

- [ ] **Step 4:附掛量測**

Run: `powershell.exe -ExecutionPolicy Bypass -File 'D:\AI\Yuuzu-IDE\scripts\measure-mem.ps1' -AttachPid <PID>`
Expected:`Language-server` 桶出現 `rust-analyzer` 與 `node`/`typescript-language-server`,各數百 MB。

- [ ] **Step 5:(可選)開到三個 workspace 再量一次**,取得「三 workspace」數字。

- [ ] **Step 6:把數字填回此表**

| 情境 | Shell (UI) | Language-server | 其他 | 合計 |
|---|---|---|---|---|
| 空殼(已知) | 415 MB | 0 | 12 MB | 427 MB |
| 一個 Rust+TS workspace | ___ | ___ | ___ | ___ |
| 三個 workspace | ___ | ___ | ___ | ___ |

**決策點:** 若單一 workspace 的 Language-server 桶 ≫ Shell(預期會),則(a)未來 ① LSP lifecycle 是最高優先;(b)Task 4(完整 react-virtual)的 node 數記憶體相對不重要,可緩。

---

## Task 2:③ — 抽出 highlight cache 並在關 tab 驅逐

**Files:**
- Create: `src/v2/hl-cache.ts`
- Create: `src/v2/hl-cache.test.ts`
- Modify: `src/v2/ContentViews.tsx`(移除本地 cache,改 import)
- Modify: `src/v2/v2-store.ts:1889-1925`(三個 close action)與 `:930`(路徑刪除)

- [ ] **Step 1:寫失敗測試 `src/v2/hl-cache.test.ts`**

```ts
/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"

import { evictHlCache, hlCacheSize, highlightContent } from "./hl-cache"

afterEach(() => {
    // 清掉每個測試留下的快取
    evictHlCache(701)
    evictHlCache(702)
})

describe("hl-cache", () => {
    test("highlightContent caches per tab id and returns a stable reference", () => {
        const a = highlightContent(701, "const a = 1\nconst b = 2\n", "ts")
        const b = highlightContent(701, "const a = 1\nconst b = 2\n", "ts")
        expect(b).toBe(a) // 同 key → 同一個 reference(命中快取)
        expect(a.length).toBe(3) // 兩行內容 + 結尾空行
    })

    test("evictHlCache removes the entry", () => {
        highlightContent(701, "x\n", "ts")
        highlightContent(702, "y\n", "ts")
        expect(hlCacheSize()).toBe(2)
        evictHlCache(701)
        expect(hlCacheSize()).toBe(1)
    })
})
```

- [ ] **Step 2:跑測試確認失敗**

Run: `bun test src/v2/hl-cache.test.ts`
Expected: FAIL,`Cannot find module './hl-cache'`。

- [ ] **Step 3:建立 `src/v2/hl-cache.ts`**

把目前 `ContentViews.tsx` 第 28–45 行的快取與 `highlightContent` 原封不動搬過來,加上 `evictHlCache` 與 `hlCacheSize`:

```ts
// 編輯器語法 highlight 的 per-tab 快取。抽成 leaf module,讓 store 在關 tab
// 時能驅逐(ContentViews 與 v2-store 都可安全 import,無循環)。
import { hlLine } from "./v2-model"
import type { Seg } from "./v2-model"

export type HlLines = { n: number; segs: Seg[] }[]

const realHlCache = new Map<number, { key: string; lines: HlLines }>()

export function highlightContent(tabId: number, content: string, lang: string): HlLines {
    const key = lang + ":" + content.length + ":" + content.slice(0, 80)
    const hit = realHlCache.get(tabId)
    if (hit && hit.key === key) return hit.lines
    const rawLines = content.split("\n")
    const plain = rawLines.length > 3000
    const lines = rawLines.map((l, i) => ({
        n: i + 1,
        segs: plain ? [{ c: "var(--yz-dbe4ec)", s: l || " " }] : hlLine(l, lang),
    }))
    realHlCache.set(tabId, { key, lines })
    return lines
}

export function evictHlCache(tabId: number): void {
    realHlCache.delete(tabId)
}

export function hlCacheSize(): number {
    return realHlCache.size
}
```

- [ ] **Step 4:跑測試確認通過**

Run: `bun test src/v2/hl-cache.test.ts`
Expected: PASS（2 tests）。

- [ ] **Step 5:更新 `ContentViews.tsx` 改用 hl-cache**

刪除目前第 28–45 行(`type HlLines` 宣告、`realHlCache`、`highlightContent` 整個函式)。在檔案頂部 import 區(第 8 行附近,`hlLine` 仍要保留供其他用途)加入:

```ts
import { highlightContent, type HlLines } from "./hl-cache"
```

> `EMPTY_DIAGNOSTICS` 與 `cursorFrom` 等其餘程式碼不動。`ContentViews` 內所有 `highlightContent(...)` 呼叫點不變。

- [ ] **Step 6:在 `v2-store.ts` 接上驅逐**

頂部 import 區加入:

```ts
import { evictHlCache } from "./hl-cache"
```

`closeTab`(1889)在 `upd(...)` 之後、函式結尾前加一行:

```ts
evictHlCache(id)
```

`closeOthers`(1903)既有 `removed` 陣列,在函式結尾加:

```ts
for (const t of removed) evictHlCache(t.id)
```

`closeAllTabs`(1915)同樣在結尾加:

```ts
for (const t of removed) evictHlCache(t.id)
```

路徑刪除(約 930 行,`p.tabs = p.tabs.filter(...)` 那段)改成先算出被移除者再驅逐。把該行替換為:

```ts
const goneTabs = p.tabs.filter((t) => t.path && (t.path === path || t.path.startsWith(path + "/")))
p.tabs = p.tabs.filter((t) => !(t.path && (t.path === path || t.path.startsWith(path + "/"))))
for (const t of goneTabs) evictHlCache(t.id)
```

> 注意:`closeOthers`/`closeAllTabs` 的 `evictHlCache` 放在 `upd()` 之外(用已捕捉的 `removed`),避免在 immer producer 內做副作用。`closeTab` 的 `id` 為入參、直接可用。路徑刪除這段位於 producer 內,但 `evictHlCache` 只是動外部 `Map`、不碰 `p`,可接受。

- [ ] **Step 7:寫驅逐 wiring 測試**(加到 `src/v2/hl-cache.test.ts` 末尾)

```ts
import { v2Store } from "./v2-store"

describe("hl-cache eviction wiring", () => {
    test("closeTab evicts the tab's highlight cache", () => {
        const tab = {
            id: 777,
            type: "file" as const,
            name: "x.ts",
            path: "src/x.ts",
            realPath: "/ws/src/x.ts",
            content: "const a = 1\n",
            contentLang: "ts",
        }
        v2Store.setState((s) => ({
            mode: "real",
            active: "api",
            ui: { ...s.ui, api: { ...s.ui.api, tabs: [tab as any], activeTab: 777 } },
        }))
        highlightContent(777, tab.content, "ts")
        expect(hlCacheSize()).toBeGreaterThanOrEqual(1)

        v2Store.getState().closeTab(777)
        expect(hlCacheSize()).toBe(0)
    })
})
```

> `closeTab` 在 `mode: "real"` 時會呼叫 `realDelegate?.closeTab` —— 預設 delegate 為 null,安全。afterEach 已會清快取。

- [ ] **Step 8:跑全部相關測試**

Run: `bun test src/v2/hl-cache.test.ts src/v2/ContentViews.test.tsx`
Expected: PASS（含既有 ContentViews 測試不回歸）。

- [ ] **Step 9:提交(你 stage 後)**

```bash
git commit -m "perf(ui): ⚡ extract editor highlight cache and evict on tab close

- 抽 highlightContent/realHlCache 成共用 leaf module hl-cache.ts
- closeTab/closeOthers/closeAllTabs 與路徑刪除時驅逐快取,止住整場 session 的緩慢成長
- 補 hl-cache 單元測試與 closeTab 驅逐 wiring 測試

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 3:②A — `content-visibility` 讓畫面外的編輯器行不參與 layout/paint

**性質:** 純 CSS,零 DOM 結構變更、零對齊變更(行高統一 21px,intrinsic size 與實際一致 → 不漂移)。既有 `ContentViews.test` 仍會渲染所有行(content-visibility 不移除 DOM 節點),不回歸。

**Files:**
- Modify: `src/v2/yuzu.css`(`.yz2-ed-hlline` / `.yz2-ed-gutter .yz2-ed-ln` / `.yz2-ed-blame-seg`)

- [ ] **Step 1:先跑既有編輯器測試當基準**

Run: `bun test src/v2/ContentViews.test.tsx`
Expected: PASS（之後改完要維持 PASS)。

- [ ] **Step 2:三個行元素加上 content-visibility**

`src/v2/yuzu.css` 第 1041 行 `.yz2-ed-hlline` 改為:

```css
.yz2-ed-hlline { white-space: pre; height: 21px; line-height: 21px; font-size: var(--yz2-ed-fs, 13px); content-visibility: auto; contain-intrinsic-size: auto 21px; }
```

第 1004 行 `.yz2-ed-gutter .yz2-ed-ln` 區塊內加兩行:

```css
.yz2-ed-gutter .yz2-ed-ln {
    position: relative;
    width: 52px;
    height: 21px;
    line-height: 21px;
    content-visibility: auto;
    contain-intrinsic-size: auto 21px;
}
```

第 1029 行 `.yz2-ed-blame-seg` 區塊內加兩行(`content-visibility: auto; contain-intrinsic-size: auto 21px;`)。

> 用 `auto 21px`(含 `auto` 關鍵字)讓瀏覽器記住首次渲染後的實際寬度,降低變寬行(`.yz2-ed-hlline` 受 `.yz2-ed-area { min-width: max-content }` 影響)在捲動時的水平抖動。WebView2(Chromium)與 WKWebView(Safari 18+,2024)皆支援。

- [ ] **Step 3:回歸測試**

Run: `bun test src/v2/ContentViews.test.tsx`
Expected: PASS（行元素仍在 DOM,測試不受影響)。

- [ ] **Step 4:手動效能驗證(大檔)**

開 `src/v2/v2-store.ts`(約 2500 行)或 `src/v2/yuzu.css`(約 2876 行),上下快速捲動,觀察是否明顯比改前順。可用 `measure-mem.ps1 -AttachPid <pid>` 對照改前/改後同一大檔開啟時的記憶體。

- [ ] **Step 5:手動水平捲動驗證(長行) — 風險檢查**

開一個有超長行的檔(例如 `dist/assets/index-*.js` 這種接近 minified 的長行),左右捲動。
- 若水平捲動順、無抖動 → 保留三個選擇器的設定。
- **若 `.yz2-ed-hlline` 造成水平抖動或捲動範圍跳動** → 從 `.yz2-ed-hlline` 移除這兩行(`content-visibility`/`contain-intrinsic-size`),**只保留固定寬度的 gutter 與 blame**(仍拿下 2/3 的節點成本,且絕對安全)。

- [ ] **Step 6:提交(你 stage 後)**

```bash
git commit -m "perf(ui): ⚡ skip offscreen editor lines via content-visibility

- .yz2-ed-hlline / gutter / blame-seg 加 content-visibility:auto
- 大檔捲動不再為畫面外數千行做 layout/paint/style,行高 21px 固定故無對齊漂移
- 長行水平捲動如有抖動則僅保留固定寬度的 gutter/blame(見計畫 Task 3 Step 5)

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Conditional Phase 2(②B):完整 react-virtual —— 量測後再決定,需另開計畫

**先別做。** 只有當 Task 1 量測顯示「大檔的 DOM node 數記憶體」仍是實際問題(在 Task 3 的 content-visibility 之後)才值得。理由:本編輯器是 **單一全高 `<textarea>` 疊在每行的 painted 層**,完整虛擬化要把 gutter/blame/painted 改成絕對定位視窗、並維持 textarea 全高 spacer 與 scrollTop 同步 —— **caret 對齊風險高**,而換到的只是 node 數記憶體(content-visibility 已解掉 layout/paint 成本)。

若要做,屆時新計畫須涵蓋:
- scroll 容器 `.yz2-ed-body` 作 `getScrollElement`,固定 `estimateSize: () => 21`,`overscan` 約 10。
- gutter / blame / painted 三欄各自 `height: totalSize`、可視行 `translateY(item.start)` 絕對定位;`.yz2-ed-area` 維持 `height: totalSize` spacer 讓 `.yz2-ed-input` textarea 仍為全高,caret/selection 不變。
- **必須**比照 `DatabaseResultView.tsx` 的 happy-dom fallback:`virtualItems` 為空時退回渲染全部行,否則 `ContentViews.test.tsx` 在無 layout 的測試環境會失敗。
- 跨檔案大小(短/長/超大)逐一驗 caret 對齊與選取。

---

## Self-Review

- **Spec coverage:** 量①→Task 1;③(抽 cache + 驅逐)→Task 2;②(編輯器虛擬化)→Task 3 拆為安全的 ②A,完整 react-virtual 明確標為條件式 Phase 2。✅
- **Placeholder scan:** 無 TBD/TODO;每個 code step 皆有完整內容;Phase 2 為明確標記的條件式區段(非可執行 checkbox),非佔位。✅
- **Type/name consistency:** `highlightContent` / `evictHlCache` / `hlCacheSize` / `HlLines` 三個 task 間命名一致;`closeTab(id)` 簽章對齊 `v2-store.ts:414`。✅
- **慣例:** commit 無 `git add`、含 `Co-Authored-By: Yuuzu`、無 AI co-author。✅
