# SP4 Connected Domains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 補完 v2 database、remote/SFTP、browser 三個已部分接線域中後端 ready 但 UI 尚未接入或資料被丟棄的子集。

**Architecture:** 先以 bridge/model/store tests 補資料形狀與 demo fallback，再用 controller delegate 接上現有 database/remote/browser API，最後補 UI。明確不做後端缺口項目：SFTP remote delete/rename/mkdir、browser console/network、DB 主動攔截流程重寫。

**Tech Stack:** React TSX、Bun test、Tauri database/remote/browser wrappers、`src/v2/DbTableView.tsx`、`src/v2/SftpView.tsx`、`src/v2/ContentViews.tsx`。

---

> 子計劃 · 2026-06-13 · 規模:12 tasks(T12 run_remote_command 已於 follow-up 接受額外 UI surface 後實作)· 相對工作量 M。純前端接線為主,零後端改動。最重的是 browser bounds 換算+縮圖顯示、sftpReconnect 抽 connectAndList helper、mutation chip re-run 防閃(627 補 kind),其餘多為 store/delegate/UI 三層樣板補齊。比草案略增(screenshot 從 toast 升級為縮圖、627 grid 修正),但移除過度設計的 dbTotalLabel 純函式(footer fallback 改為 1 行)抵銷。

**相依:**

- SP1 logger/共用基礎(若存在);本子計劃自身 T1-T6 純函式/store 為 T7 controller、T8-T10 UI 的前置,但無跨子專案硬依賴

**摘要:** 補完三個「已部分接線」功能域裡後端 100% ready、v2 卻沒接或接了丟資料的子集。明確只覆蓋 orchestrator 焦點的「後端可達」部分:DB query history(list_database_query_history)+ mutation 被動分類 chip(execute 回傳 classification.kind,目前被丟棄)+ data footer total 在 count 為 undefined 時 fallback 成本次列數;remote 顯式 disconnect(disconnect_remote_host)/ reconnect(connect_remote_host 復用)+ 一次性 run_remote_command(額外 UI surface 已接受後實作);browser 區域截圖(browser_capture_preview,macOS-only)且升級為「縮圖顯示」而非 toast-only(後端回的 BrowserScreenshot.data_url 可直接 <img src>)。焦點的另一半因後端能力缺口排除:DB mutation「主動」攔截(維持既有後端 reject→confirmationFromError 流程,本子計劃不改 confirm 機制)、SFTP remote delete/rename/mkdir(RemoteBackend trait 無此方法)、browser console/network(後端與 api 皆無)——這三項屬後端缺口,需先動 Rust,不在本子專案。每條照 store→RealDelegate→controller delegate→features/*-api 鐵則新增,配 bridge 純函式 mapper(先 RED)、--yz-* CSS。修正草案兩個事實錯誤:footer 並非「永遠 —」(real 路徑已顯示 'N shown · {count|—} total',SQLite 的 count 已是真值),且 mutation chip 在 re-run 時會閃失(controller.ts:627 樂觀 running grid 未保留 kind,須補帶)。

---

## 目標

把三個已部分接線域裡「後端 100% ready 但 v2 零接線 / 接了卻丟資料」的**後端可達子集**補滿,全部照 v2 鐵則(store 不 import controller、demo/real 雙模式對稱、RealDelegate 注入、ConfirmModal、--yz-* 色票、bun:test 先 RED)。

只接基線已列且**已在後端原始碼 + features/*-api wrapper + model type 三處核實存在**的指令:
- DB:`list_database_query_history(profileId)`(database-api.ts:41 `listDatabaseQueryHistory` 已有,回 `DatabaseQueryHistoryEntry[]` = `{sql,kind,executed_ms,affected_rows,row_count}`,database-model.ts:107)、`execute_database_query` 回傳的 `classification.kind`(database-model.ts:91-100 的 `DatabaseQueryResult.classification:QueryClassification`,目前 `mapQueryResult` 完全丟棄)、`inspect_database_schema` 的 `table.row_count`(SQLite 真值,PG/MSSQL 為 None — 已是現況,不補後端)。
- remote:`disconnect_remote_host(profileId)`(remote-api.ts:49 `disconnectRemoteHost`,回 `RemoteConnectionSnapshot`,remote-model.ts:56)、`connect_remote_host(profileId)` 復用作 reconnect(remote-api.ts:43 `connectRemoteHost`)、`run_remote_command(profileId,command)`(remote-api.ts:86 `runRemoteCommand`,回 `RemoteCommandResult`)。
- browser:`browser_capture_preview(workspaceRoot, request{url,title,bounds})`(browser-api.ts:18 `captureBrowserPreview`,回 `BrowserScreenshot`{data_url,width,height,...};macOS-only,非 mac 回 Err)。`BrowserPreviewBounds`/`BrowserScreenshot` 皆在 browser-model.ts:12,30。

## File Structure

- Modify: `src/v2/v2-model.ts` — add `DbGrid.kind`, DB history tab fields, browser screenshot field, and expanded DB view union.
- Modify: `src/v2/bridge.ts` — add `mapDbHistory` and `screenBoundsFromRect`; preserve existing `mapQueryResult` behavior plus kind.
- Modify: `src/v2/v2-store.ts` — add `loadDbHistory`, `sftpDisconnect`, `sftpReconnect`, `browserCapture`, and matching RealDelegate methods.
- Modify: `src/v2/controller.ts` — implement DB history, SFTP disconnect/reconnect, browser capture, and keep `grid.kind` during running state.
- Modify: `src/v2/DbTableView.tsx` — add History segment, mutation kind chip, and total fallback.
- Modify: `src/v2/SftpView.tsx` — add Disconnect/Reconnect buttons with `hostId` guard.
- Modify: `src/v2/ContentViews.tsx` — add browser screenshot button, iframe ref, screen bounds calculation, and thumbnail.
- Modify: `src/v2/yuzu.css` — add DB history, SFTP button, and browser screenshot thumbnail styles.
- Test: `src/v2/bridge.test.ts`, `src/v2/v2-store.test.ts`.

## 非目標(焦點的另一半 — 後端能力缺口,明確排除)

orchestrator 焦點為「DB mutation 確認/history、remote 刪除改名/reconnect、browser screenshot/console」。本子計劃**刻意只覆蓋後端可達的一半**,以下三項排除(已 grep 核實後端確實無能力):

- **DB mutation「主動」攔截確認**:不在本子計劃改 confirm 機制。現況是 `runDbQuery` real 走 controller.ts:620 `dbRun` → 後端對 mutation/destructive **reject** 並回「requires confirmation text: …」→ `confirmationFromError`(bridge.ts:166)解析 → `openConfirm` typed flow(controller.ts:642-653)。這套**已經是完整可用的主動確認**,本子計劃只**被動顯示上一次結果的分類 chip**(資料源是 `classification.kind`),**不可誤改成前端攔截 Run**。
- **SFTP remote delete / rename / mkdir**:remote.rs 的 `RemoteBackend` trait 無這些方法(只有 connect/disconnect/spawn/write/close/run_command/list_sftp_directory/download/upload)。controller.ts:853 的「Remote delete is not supported yet」、v2-store.ts:1139 ConfirmModal body「Remote delete is not supported yet」、Overlays 的「Rename… pending backend」**全部維持原狀**。要做需先動 Rust,屬另一子專案。
- **browser console / network surface**:後端 browser_preview.rs 與 browser-api.ts 皆無此能力(browser-model.ts 雖有 `consoleErrors`/`BrowserConsoleError` 型別,但無任何後端 command 餵資料),且受 Tauri webview 跨 frame 限制。BrowserView 的 ‹ › 上一頁/下一頁(ContentViews.tsx:303-304 死按鈕)亦不處理(無歷史堆疊後端)。

DB **PG/MSSQL row_count 補算**、**column default 欄位**(DatabaseColumn 無 default 欄,database-model.ts:48)同屬後端缺口,不改。

---

## 架構與接線點(逐缺口具體到方法/class)

### A. DB query history + mutation 被動分類 chip(最低成本,純前端接線)

**bridge.ts mapQueryResult 改(資料源)**:目前(bridge.ts:154-162)完全丟棄 `result.classification`。改為回傳多帶 `kind: result.classification.kind`。這是 mutation chip 唯一資料源。

**bridge.ts 新增純函式 `mapDbHistory(entries: DatabaseQueryHistoryEntry[]): DbHistoryRow[]`**:把 `{sql,kind,executed_ms,affected_rows,row_count}` 映射成 v2 顯示列。`when` 用 `executed_ms`(epoch ms)轉相對時間字串(可重用 git-log-model 的 `formatWhen(unix, now)`,注意 executed_ms 是毫秒需 `/1000`;或先保留 raw 不格式化以避免依賴 — 建議 MVP 直接顯示 `affected_rows ?? row_count ?? 0` 與 kind,when 用 `new Date(ms).toLocaleTimeString()` 之類純函式輸出,測試只斷言欄位非空與 kind 正規化)。

**v2-model.ts**:
- `DbGrid` 加 `kind?: "Read" | "Mutation" | "Destructive"`(v2-model.ts:10-18,mapQueryResult 帶出)。
- 新 type `export type DbHistoryRow = { sql: string; kind: string; when: string; rows: string }`。
- `Tab` 加 `history?: DbHistoryRow[]`、`historyLoading?: boolean`(v2-model.ts:48-55 real database 區塊)。
- `Tab.view` union 從 `"data" | "structure" | "sql"`(v2-model.ts:35)擴成 `"data" | "structure" | "sql" | "history"`。**注意 v2-store.ts:264-265 `openDbTable`/`setDbView` 簽名與 DbTableView.tsx:127 seg 陣列要同步擴 union**。

**v2-store.ts**:
- `RealDelegate`(v2-store.ts:39-71)加 `dbHistory: (tabId: number) => void`。
- `setDbView` 簽名(line 265)與 action(line 680)的 view 型別擴 `| "history"`。
- 新 action `loadDbHistory: (tabId: number) => void`:`mode==="real"` → `realDelegate?.dbHistory(tabId)`;demo → 給假 history 列(沿用 DbTableView 假資料風格,例如 2-3 列 Read/Mutation 混合)。State type 與 action 兩處都要加。
- DbTableView 切到 `"history"` 時觸發 `loadDbHistory`(在 seg onClick real 分支順手呼,或 view==="history" useEffect)。

**controller.ts**:
- import 區 database-api(controller.ts:36-41)加 `listDatabaseQueryHistory`。
- delegate(物件,賦值給 `delegate` 並 `registerRealDelegate(delegate)` at line 1001)加 `dbHistory(tabId)`:取 `tabIn(pid,tabId)`,`if(!tab?.profileId)return`,先 `patchTab(pid,tabId,t=>({...t,historyLoading:true}))`,`void(async()=>{ try{ const h=await listDatabaseQueryHistory(tab.profileId as string); patchTab(pid,tabId,t=>({...t,history:mapDbHistory(h),historyLoading:false})) }catch(e){ patchTab(...,historyLoading:false); store().showToast("History: "+errMsg(e)) } })()`。

**mutation chip re-run 不閃失(must-fix)**:controller.ts:627 樂觀 running grid 目前是 `{cols: t.grid?.cols ?? [], rows: t.grid?.rows ?? [], ms:0, truncated:false, affected:null, running:true}` — **未保留 kind**,故按 Run 後上一次 kind 從 grid 物件消失,chip 在 running 期間閃掉。修法:該物件加 `kind: t.grid?.kind`。其餘 3 個 grid 建構點:638(mapQueryResult,帶新 kind ✓)、643(`{...t.grid, running:false}` — spread 已保留 kind ✓)、657(error grid,無 kind,chip 渲染端須當 optional 處理 ✓)。

**DbTableView.tsx**(UI):
- seg-group(line 127 陣列)加第四顆 `["history","History"]`。
- 新 `view === "history"` 區塊:real 渲染 `tab.history` 列表(每列 SQL ellipsis + kind chip + when + rows),用既有 `.yz2-grid-head`/`.yz2-grid-row` 或新 `.yz2-db-hist-row`,`historyLoading` 時顯示 loading;demo 給假列。
- mutation chip:Run 按鈕(line 139 `.yz2-run-btn`)左側,當 `tab.grid?.kind && tab.grid.kind !== "Read"` 顯示小 chip(Mutation 黃 / Destructive 紅),**純被動顯示上次結果分類,不改 confirm 流程**。`tab.grid?.kind` 必須當 optional(657 error grid、627 首次無 kind)。

**DB data footer total fallback(修正草案事實錯誤,1 行 UI 改)**:草案聲稱「DbTableView.tsx:227/265 real 路徑 `tab.count ?? "—"` 永遠 \"—\"、硬掛 \"—\"」**是錯的**。實讀 line 227 real 路徑已是 `tab.grid.rows.length + " shown · " + (tab.count ?? "—") + " total"`——既已顯示「N shown」,且 `count` 在 real 模式**會被填**:`openDbTable`(v2-store.ts:664)`count: table.c`,`table.c` 來自 `mapDbTables`(bridge.ts:144,SQLite 為 row_count 真值字串、PG/MSSQL 為 "—")。真正缺口僅是:`tab.count` 為 `undefined`(schema 尚未 inspect 就開 tab)時,line 227 顯示 "undefined total" 風險 / 退化成 "—"。**修法只有一行**:line 227 把 `(tab.count ?? "—")` 改為 `(tab.count ?? (tab.grid?.rows.length + " (shown)"))` 之類,語意誠實標 fallback 為「本次列數」。**不新增 dbTotalLabel 純函式**(草案的 T4 屬過度設計,與 Simplicity First 相違,既有顯示邏輯已足夠,fallback 只是把 `??` 右側從死字串改成 rows.length)。

### B. remote disconnect / reconnect(純未接,後端完備)

**v2-store.ts**:
- `RealDelegate` 加 `sftpDisconnect: () => void`、`sftpReconnect: () => void`。
- 新 action `sftpDisconnect: () => void`:disconnect **不是 destructive**(只釋放 russh session,不丟資料),**不需 typed confirmation**,`mode==="real"` → `realDelegate?.sftpDisconnect()`;demo → toast。
- 新 action `sftpReconnect: () => void`:`mode==="real"` → `realDelegate?.sftpReconnect()`;demo → toast。
- State type 與 action 兩處都加。

**controller.ts**:
- import 區 remote-api(controller.ts:43-49)加 `disconnectRemoteHost`(`connectRemoteHost`/`listSftpDirectory` 已 import)。
- delegate 加 `sftpDisconnect()`:取 `store().ui[pid]?.sftp`,`if(!sf?.hostId)return`,`void(async()=>{ try{ const snap=await disconnectRemoteHost(sf.hostId); patchProject(pid,p=>{ p.sftp={...p.sftp,connected:false}; p.sshHosts=p.sshHosts.map(h=>h.hostId===sf.hostId?{...h,live:false}:h) }); store().showToast("Disconnected "+(sf.host??"")) }catch(e){ store().showToast("Disconnect: "+errMsg(e)) } })()`。(可選:用 `snap.status === "Disconnected"` 確認再 patch,比盲改穩 — review missedBackend 建議。)
- delegate 加 `sftpReconnect()`:從 `store().ui[pid].sftp` 取現有 `hostId`/`remotePath` 重連並重列。**抽共用 helper `connectAndList(pid, hostId, remoteDir)`**:把 `sftpOpen`(controller.ts:709-737 的 connect→check status→patch live→Promise.all(scanWorkspace, listSftpDirectory)→patch local/remote/connected)抽出,讓 `sftpOpen` 與 `sftpReconnect` 都呼叫。**先抽再讓兩者呼叫,跑既有測試守住 sftpOpen 行為不變**(注意 sftpOpen 還做了初始 patch sftp 整塊,helper 只抽 connect+list 部分,localPath/root 由呼叫端帶入)。

**SftpView.tsx**(UI):
- head(SftpView.tsx:118-129,`.yz2-sftp-head`,內有 `.yz2-spacer` at line 127)`.yz2-spacer` 之後、clip-chip 之前補按鈕:
  - real + `sftp.connected` → `Disconnect`(`.yz2-btn-ghost`),掛 `sftpDisconnect`。
  - real + `!connected && !loading && sftp.hostId` → `Reconnect`(`.yz2-btn-accent`),掛 `sftpReconnect`。
  - **守門必含 `sftp.hostId`**(must-fix):`emptyUI().sftp`(v2-store.ts:195)無 hostId(從未開過 host 的 offline 狀態),漏這條會出現點了 no-op 的死鈕(重蹈 ⇱/‹› 覆轍)。
- 從 store 補 `sftpDisconnect`/`sftpReconnect` selector。statusChip(line 108-114)offline 紅字旁即是 Reconnect 鈕。

**run_remote_command 一次性命令**:`runRemoteCommand(profileId,command)` 後端完備,但需 prompt overlay 輸入框 UI(非單純按鈕,工程量被低估)。Follow-up 已接受額外 UI surface: SftpView head 加「Run…」開短輸入列,結果以 toast 報 exit_code + stdout/stderr preview。Native smoke 仍需可用真 SSH profile。

### C. browser screenshot(純前端未接,後端完備,macOS-only)+ 縮圖顯示(從 toast-only 升級)

**browser-api.ts** 已有 `captureBrowserPreview({workspaceRoot, request:{url,title,bounds}})`(line 18)。bounds 是 `{x,y,width,height}` 螢幕座標。

**bridge.ts 新增純函式 `screenBoundsFromRect(rect: {x,y,width,height}, screenX: number, screenY: number): BrowserPreviewBounds`**:`{x: Math.round(rect.x+screenX), y: Math.round(rect.y+screenY), width: Math.round(rect.width), height: Math.round(rect.height)}`。無 I/O,可 RED 測 round + offset。(參數用結構型 `{x,y,width,height}` 而非 DOMRect,方便測試免造 DOMRect。)

**v2-model.ts**:`Tab` 加 `screenshot?: { dataUrl: string; width: number; height: number }`(real browser 區塊,v2-model.ts:52-55 附近)。**升級重點(must-fix)**:browser-model.ts 已有完整 `BrowserScreenshot.data_url`(可直接 `<img src>`)、`storeBrowserScreenshot`、`screenshots[]`、`MAX_SCREENSHOTS=12`,後端回的就是現成可渲染圖像。toast-only(草案 MVP)是「接線但不可用」,違反 co-founder「真實可用產品」鐵則。**最小可用 = 把 data_url 存進 tab 並在 bar 下顯示縮圖**。

**v2-store.ts**:
- `RealDelegate` 加 `browserCapture: (tabId: number, bounds: BrowserPreviewBounds) => void`。
- **import 型別**:store 端 action 簽名需 `BrowserPreviewBounds`,從 `../features/browser/browser-model` import type(store 只能 import features/*-model 的 type,**不可 import controller**)。
- 新 action `browserCapture: (tabId: number, bounds: BrowserPreviewBounds) => void`:`mode==="real"` → 守門「無 url 先提示」(可在 store 端檢 tab.url);否則 `realDelegate?.browserCapture(tabId, bounds)`;demo → toast「Screenshot 需要 real 模式」。
- State type 與 action 兩處都加。

**controller.ts**:
- import 區加 `import { captureBrowserPreview } from "../features/browser/browser-api"`(validateBrowserUrl 已 import at line 50)與 `import type { BrowserPreviewBounds } from "../features/browser/browser-model"`。
- delegate 加 `browserCapture(tabId, bounds)`:取 `tabIn(pid,tabId)` 的 url/title 與 `rootOf(pid)`,`if(!root||!tab?.url)return`,`void(async()=>{ try{ const shot=await captureBrowserPreview({workspaceRoot:root, request:{url:tab.url, title:tab.title??tab.url, bounds}}); patchTab(pid,tabId,t=>({...t,screenshot:{dataUrl:shot.data_url,width:shot.width,height:shot.height}})); store().showToast("✓ screenshot "+shot.width+"×"+shot.height) }catch(e){ store().showToast("Screenshot: "+errMsg(e)) } })()`。macOS-only:非 mac 後端回 Err「browser screenshot capture is currently supported on macOS only」,`errMsg`→toast 兜底,UI 自然 fallback(不前端硬編平台判斷)。

**ContentViews.tsx BrowserView**(UI):
- `⇱` 死按鈕(ContentViews.tsx:333 `<span className="nav" style={{fontSize:12}}>⇱</span>`)改截圖鈕:圖示改 `▣` 或 `⎙`(截圖語意),`hasPage`(line 290 `isRealMode && !!tab.url && tab.mode===undefined`)才可點,否則加 `.off` class。
- iframe(line 337-342)**目前無 ref**,需 `const frameRef = useRef<HTMLIFrameElement>(null)` 並 `ref={frameRef}`。
- onClick:`const el=frameRef.current; if(!el)return; const r=el.getBoundingClientRect(); browserCapture(tab.id, screenBoundsFromRect({x:r.x,y:r.y,width:r.width,height:r.height}, window.screenX, window.screenY))`。
- bar 下顯示縮圖:`tab.screenshot` 存在時在 iframe 區塊上方/下方加 `<img src={tab.screenshot.dataUrl}>` 小縮圖(maxHeight ~120px,點擊可放大為 optional),配尺寸標籤。`browserCapture`/`screenBoundsFromRect` 從 store/bridge import。

## TDD Task 分解

每 task 先 RED(bun test 紅)→ GREEN → verify。bridge/model 純函式走完整單元測試;store demo 分支用 `createV2Store()` 斷言樂觀 UI;controller real 路徑**不寫單元測試**(依賴 Tauri,靠 mock-IPC 手動驗證,見 MEMORY ide-v2-shell-migration)。

1. **bridge.mapQueryResult 帶 classification.kind**
   - [x] RED: `src/v2/bridge.test.ts` 既有 fixture 加 `expect(grid.kind).toBe("Read")`；新增 Mutation fixture 斷言 `grid.kind === "Mutation"`。
   - [x] GREEN: `DbGrid` type 加 `kind?`，`mapQueryResult` 回傳加 `kind: result.classification.kind`。
   - [x] Verify: `bun test src/v2/bridge.test.ts`。
   - Commit: deferred due broad dirty/untracked v2 state; not a remaining implementation task.
2. **bridge.mapDbHistory + DbHistoryRow type**
   - [x] RED: 餵 `[{sql:"DELETE...",kind:"Mutation",executed_ms:1700000000000,affected_rows:3,row_count:null}]`，斷言 `sql`、`kind==="Mutation"`、`rows` affected 優先、`when` 非空。
   - [x] GREEN: 新增 `DbHistoryRow` type 與 `mapDbHistory`。
   - [x] Verify: `bun test src/v2/bridge.test.ts`。
   - Commit: deferred due broad dirty/untracked v2 state; not a remaining implementation task.
3. **bridge.screenBoundsFromRect**
   - [x] RED: 餵 `{x:10.4,y:20.6,width:300,height:200}` + screenX 5 / screenY 7，斷言 `{x:15,y:28,width:300,height:200}`。
   - [x] GREEN: 實作 round + offset，回 `BrowserPreviewBounds`。
   - [x] Verify: `bun test src/v2/bridge.test.ts`。
   - Commit: deferred due broad dirty/untracked v2 state; not a remaining implementation task.
4. **store.loadDbHistory + setDbView 'history'(demo)**
   - [x] RED: `createV2Store()` 開 db tab，呼 `loadDbHistory(tabId)` 後斷言 `tab.history` 非空；`setDbView(tabId,"history")` 後斷言 view。
   - [x] GREEN: 擴 `Tab.view` union、history fields、RealDelegate.dbHistory、loadDbHistory action、setDbView type。
   - [x] Verify: `bun test src/v2/v2-store.test.ts && bunx tsc --noEmit`。
   - Commit: deferred due broad dirty/untracked v2 state; not a remaining implementation task.
5. **store.sftpDisconnect / sftpReconnect(demo)**
   - [x] RED: demo 呼 `sftpDisconnect()` 與 `sftpReconnect()` 斷言 toast 文案。
   - [x] GREEN: RealDelegate 兩方法簽名 + store actions。
   - [x] Verify: `bun test src/v2/v2-store.test.ts`。
   - Commit: deferred due broad dirty/untracked v2 state; not a remaining implementation task.
6. **store.browserCapture(demo + 無 url 守門)**
   - [x] RED: demo `browserCapture(tabId, bounds)` 斷言 demo toast；real mode but tab no url 斷言提示 toast。
   - [x] GREEN: RealDelegate.browserCapture + action + `BrowserPreviewBounds` type import。
   - [x] Verify: `bun test src/v2/v2-store.test.ts && bunx tsc --noEmit`。
   - Commit: deferred due broad dirty/untracked v2 state; not a remaining implementation task.
7. **controller delegate 實作(dbHistory / sftpDisconnect / sftpReconnect / browserCapture)+ 627 grid 補 kind + sftpOpen 抽 connectAndList**
   - [x] Implement controller imports and delegate methods.
   - [x] Add `kind: t.grid?.kind` to optimistic running grid at controller dbRun.
   - [x] Extract `connectAndList` helper and keep `sftpOpen` behavior unchanged.
   - [x] Verify: `bunx tsc --noEmit && bun test src/v2/`。
   - [x] Review: Ramanujan APPROVED; Bernoulli CHANGES_REQUIRED on stale SFTP/browser races, then APPROVED after guard fixes.
   - Commit: deferred due broad dirty/untracked v2 state; not a remaining implementation task.
8. **UI: DbTableView History seg + mutation kind chip + footer fallback**
   - [x] RED: add/extend `src/v2/DbTableView.test.tsx` to cover History segment rendering, history loading/rows, Mutation/Destructive kind chip, and footer fallback when `tab.count` is absent.
   - [x] Add History segment and render `tab.history`/loading state.
   - [x] Render mutation/destructive chip only when `tab.grid?.kind !== "Read"`.
   - [x] Change footer fallback to displayed row count wording.
   - [x] Verify: `bun test src/v2/DbTableView.test.tsx && bunx tsc --noEmit`。
   - Commit: deferred due broad dirty/untracked v2 state; not a remaining implementation task.
9. **UI: SftpView Disconnect/Reconnect 鈕**
   - [x] RED: add/extend `src/v2/SftpView.test.tsx` to cover Disconnect when real+connected, Reconnect when real+offline+hostId, and no Reconnect dead button when `hostId` is absent.
   - [x] Add store selectors for `sftpDisconnect` and `sftpReconnect`.
   - [x] Render Disconnect when real + connected.
   - [x] Render Reconnect only when real + not connected + not loading + `sftp.hostId`.
   - [x] Verify: `bun test src/v2/SftpView.test.tsx && bunx tsc --noEmit`。
   - Commit: deferred due broad dirty/untracked v2 state; not a remaining implementation task.
10. **UI: BrowserView 截圖鈕 + 縮圖**
   - [x] RED: extend `src/v2/ContentViews.test.tsx` to cover screenshot button disabled without a real page, click calls `browserCapture(tabId,bounds)`, and existing `tab.screenshot.dataUrl` renders as a thumbnail with dimensions.
   - [x] Add iframe ref.
   - [x] Replace dead `⇱` action with screenshot button guarded by `hasPage`.
   - [x] Use `screenBoundsFromRect` with `window.screenX` / `window.screenY`.
   - [x] Render `tab.screenshot.dataUrl` thumbnail and dimensions.
   - [x] Verify: `bun test src/v2/ContentViews.test.tsx && bunx tsc --noEmit`。
   - Commit: deferred due broad dirty/untracked v2 state; not a remaining implementation task.
11. **CSS**
   - [x] Add `yz2-db-hist-row`, DB kind chip, SFTP head button, browser nav screenshot, and screenshot thumbnail styles.
   - [x] Verify: `bunx tsc --noEmit`。
   - [x] Review: Socrates APPROVED; Ptolemy APPROVED and re-ran focused UI tests plus `bunx tsc --noEmit`.
   - Commit: deferred due broad dirty/untracked v2 state; not a remaining implementation task.
12. **S: run_remote_command 一次性命令**
   - [x] Add prompt/overlay after product owner accepted the extra UI surface via follow-up `繼續`.
   - [x] Wire `runRemoteCommand(profileId, command)`.
   - [x] Show exit code and stdout/stderr preview.
   - [x] Verify: focused RED/GREEN `bun test src/v2/v2-store.test.ts src/v2/SftpView.test.tsx src/v2/folder-expand.test.ts` and `bunx tsc --noEmit`.
   - [ ] Native command smoke with a saved real SSH host profile.
   - Commit: deferred due broad dirty/untracked v2 state; not a remaining implementation task.

## UI 考量

- **DbTableView History 列**:對齊既有 `.yz2-grid-head`/`.yz2-grid-row` 字級 13、idx 欄 44px;kind chip 用 `.yz2-key-badge` 風格(Mutation 黃 `var(--yz-2a2210)`/`var(--yz-ffcb6b)`、Destructive 紅(複用 `var(--yz-f07178)` 配深紅底)、Read 灰 `var(--yz-1a2230)`/`var(--yz-8b97a7)`)。SQL 欄 ellipsis(`.yz2-ellipsis`)。列表 `flex:1, overflow:auto`。
- **mutation 預警 chip**:Run 鈕(`.yz2-run-btn`)左側,小 chip,僅反映上次 `grid.kind`,不打斷流程。Read 不顯示。
- **SftpView head 按鈕**:Disconnect `.yz2-btn-ghost`、Reconnect `.yz2-btn-accent`(若這兩 class 不存在,新增,對齊 `.yz2-engine-chip` 高度與 padding)。offline 紅字(已有 `var(--yz-f07178)` at SftpView:123)旁放 Reconnect。
- **BrowserView 截圖鈕**:沿用 `.nav` class(14px,hover 變亮),`hasPage` 才可點,否則 `.nav off`(line 304 既有此 class)。圖示 `▣`/`⎙`(避免與 ⟳ 混淆)。macOS 外點了後端回 Err→toast「supported on macOS only」,無需前端平台偵測。縮圖 `<img>` maxHeight ~120px,圓角對齊既有面板。
- 色票一律從既有 ~50 個 --yz-* 挑,不硬編 hex。

## 驗證 gate

- `bun test src/v2/`:新增 bridge/model RED 全綠(T1-T3 純函式 + T4-T6 store demo + T12 store/UI/mock-IPC + SFTP stale-response regression),既有 **71 tests 不退**(實測基線 71 pass / 0 fail / 192 expect)。2026-06-13 follow-up gate:180 pass。
- `bunx tsc --noEmit`(**package.json 無 tsc script,只有 `build:"tsc && vite build"`;依使用者 toolchain 偏好用 bunx**):Tab.view union 擴充、DbGrid.kind、Tab.history/screenshot、RealDelegate 新 5 方法(v2-store.ts type 與 controller.ts delegate 物件兩處同步)、store import BrowserPreviewBounds、controller import 四個 api,全部型別對齊,零 error。
- 手動 mock-IPC 驗證(依 MEMORY ide-v2-shell-migration 法):dbHistory 回假 history、disconnect/reconnect、run_remote_command、browserCapture(mock 回假 BrowserScreenshot)走 controller real 路徑不炸;瀏覽器 fallback demo 正常;mutation chip re-run 不閃失(連按 Run 觀察 chip 持續)。
- native 驗證(Tauri 殼內,macOS):DB history 真查、SFTP disconnect 真釋放 russh session(觀察 connected→false / live→false)、reconnect 真重連重列、browser 截圖真出圖且縮圖顯示;非 mac 確認 toast「supported on macOS only」。`run_remote_command` native smoke 需可用真 SSH profile,仍待執行。

## 風險

- **browser bounds 螢幕座標換算**:iframe 在 Tauri 下是實際 webview,`getBoundingClientRect()` + `window.screenX/screenY` 的 client→screen 偏移在多螢幕 / 高 DPI 可能不準(screencapture -R 用實體像素,getBoundingClientRect 為邏輯像素)。MVP 先單螢幕驗證,DPI 縮放列已知風險(偏移幾 px 可接受)。
- **macOS-only**:browser_capture_preview 非 mac 回 Err,errMsg→toast 兜底,但 UI 鈕在非 mac 仍可見(點了才知不支援);刻意不前端硬編平台判斷。
- **DB count fallback 語意**:real 路徑 `table.c`(row_count)對 PG/MSSQL 恆 "—"(後端 None),fallback 用 `grid.rows.length` 只是「本次顯示列數」非真 total,footer 文案需誠實標「N (shown)」而非偽裝 total。
- **sftpReconnect helper 抽取**:sftpOpen connect+list 邏輯(controller.ts:709-737)較長且含初始 patch,抽 `connectAndList` 時只抽 connect+check status+patch live+Promise.all list 部分,localPath/root 由呼叫端帶。**先抽再讓兩者呼叫,跑既有 sftp store 測試守住行為不變**。
- **mutation chip 是被動顯示**:confirm 流程仍由後端 reject→confirmationFromError 驅動(controller.ts:642 維持現狀),**不可誤改成主動攔截 Run**。chip 渲染端 grid.kind 必須當 optional(627 首次/657 error grid 無 kind)。
- **history_id 仍丟棄**:execute 回傳的 history_id(database-model.ts:100)本子計劃不接(無 re-run-by-id 後端入口),維持丟棄。
- **RealDelegate 雙處同步**:新 4 方法的簽名在 v2-store.ts RealDelegate type 與 controller.ts delegate 物件兩處,漏一個或型別不符 tsc 紅,T7 verify 必跑 bunx tsc。

## 非目標(再次明列,避免範圍蔓延)

- DB mutation 主動攔截確認機制改動(維持後端 reject→confirmationFromError typed flow)。
- SFTP remote delete / rename / mkdir(RemoteBackend trait 無此方法,屬後端缺口)。
- browser console / network surface(後端與 api 皆無餵資料的 command)。
- browser ‹ › 上一頁/下一頁(無歷史堆疊後端)。
- DB PG/MSSQL row_count 補算、column default 欄位。
