# SP1 Observability & Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ide-logger、metric snapshot、recovery backups 三個後端已就緒的穩定性能力接進 v2 Settings。

**Architecture:** SettingsModal 新增 custom section render 出口，store 只透過 RealDelegate 呼叫 controller，controller 負責 real Tauri glue、debounce 與 fire-and-forget diagnostic logging。所有格式化與 payload mapping 下沉到 `v2-model.ts` / `bridge.ts` 純函式，以 Bun tests 先守住。

**Tech Stack:** React TSX、Bun test、Tauri invoke wrappers、`src/v2/Overlays.tsx`、`src/v2/v2-store.ts`、`src/v2/controller.ts`、`src/features/diagnostics`、`src/features/recovery`。

---

> 子計劃 · 2026-06-13 · 規模:7 tasks，相對工作量 M（後端零改、三塊 api 已就緒；重點在 controller delegate glue + autosave debounce + SettingsModal 自訂 render 出口 + 一批 CSS）。最重且風險最高的是 T4：controller 整合測試零先例（import-time Tauri 模組 mock 連鎖）+ recovery autosave debounce + metric/append native 手動驗證；其餘多為移植 v1 panel 邏輯改 yz2 命名 + 純函式測試。較草案省工：countTreeEntries 改複用既有 flattenTree、memory_bytes 不動 v1 model（本地型別解）。

**摘要:** 在 v2 SettingsModal 內開一個依 section.id 的「自訂 React render 出口」，並接上三塊後端已 100% ready 但前端完全 orphan 的穩定性能力：ide-logger（append/list_diagnostic_events：關鍵 action fire-and-forget 埋點 + 事件清單）、效能監控（metric_snapshot：記憶體/uptime/index/workspace 數字卡 + 手動 Refresh）、recovery（save/list/discard_unsaved_backup：autosave debounce 備份 + 還原把 content 灌回 tab + 丟棄走 ConfirmModal）。嚴格照 store→RealDelegate→controller delegate→features/*-api 分層，store 絕不 import controller，瀏覽器 demo fallback 假快照。產出：v2-model.ts 三型別 + 五純函式 + 三個 custom SettingSection；bridge.ts 三 mapper（mapMetric/mapDiagnosticEvents/mapBackups，countTreeEntries 直接複用既有 flattenTree 不重造）；v2-store.ts RealDelegate 加 5 method（含 backupTab）+ 頂層 stab state + actions；controller.ts delegate 實作 + autosave debounce + logDiag helper + restore realPath 反解 fallback；Overlays.tsx 自訂 render 分支 + 三子元件；yuzu.css 一批 yz2-stab-* 樣式。Task 0 先修 diagnostics-api append 未包 {event} 的 latent bug。針對審查：統一 RealDelegate 為 5 method、T4 controller 整合測試降為 smoke（真正 gate 落 native 手動驗證，符合 MEMORY 陷阱）、countTreeEntries 改複用 flattenTree、restore realPath fallback 對齊既有 openFile 的 node?.p ?? path 慣例、memory_bytes 型別矛盾用 bridge 本地 input 型別 + as never fixture 解（不動 v1 feature model 避免 DiagnosticsPanel 破 tsc）。

---

## 目標

把後端已 100% ready 但前端完全 orphan 的三塊穩定性能力接進 v2 Yuzu shell，統一收納在 Settings modal 的三個新頁籤：

1. **ide-logger（Diagnostics 事件）** — `append_diagnostic_event` 在關鍵 action 埋點（fire-and-forget），`list_diagnostic_events` 在頁籤顯示最新事件清單（level 色票 + source + 時間）。
2. **效能監控（Performance）** — `metric_snapshot` 取記憶體（後端 `process_memory_bytes`，`Option<u64>`）/uptime/workspace 數/file-tree 數/docs-index 數，以數字卡呈現，帶手動 Refresh。
3. **recovery（未存檔備份）** — `save_unsaved_backup` 在編輯流程 debounce autosave + 關 dirty file tab 時留備份；`list_unsaved_backups` 在頁籤列出；`discard_unsaved_backup`（destructive→ConfirmModal）+ 還原（把 backup.content 灌回 tab）。

同時設計一個**可共用的 Settings 多頁籤「自訂 section render」架構**：現行 `SettingsModal`（Overlays.tsx）只會 map `cur.rows` 畫 toggle/choice/info，需開一個依 `section.custom` 的自訂 React 出口，讓未來其他非表單頁籤（如 LSP problems）也能複用。

## File Structure

- Modify: `src/features/diagnostics/diagnostics-api.ts` — wrap `append_diagnostic_event` arguments as `{ event: args }`.
- Modify: `src/v2/v2-model.ts` — add stability domain types, formatter helpers, and custom Settings section metadata.
- Modify: `src/v2/bridge.ts` — add `mapMetric`, `mapDiagnosticEvents`, and `mapBackups`.
- Modify: `src/v2/v2-store.ts` — add `stab` state, RealDelegate stability methods, and demo-safe actions.
- Modify: `src/v2/controller.ts` — implement real delegate, autosave debounce, `logDiag`, and restore flow.
- Modify: `src/v2/Overlays.tsx` — add custom Settings render branch plus Performance/Diagnostics/Recovery sections.
- Modify: `src/v2/yuzu.css` — add `yz2-stab-*` styles.
- Test: `src/v2/v2-model.test.ts`, `src/v2/bridge.test.ts`, `src/v2/v2-store.test.ts`.

## 已驗證的後端事實（接線基準，皆已 grep 確認）

- `metric_snapshot`（commands.rs:242 / 2287）只收 `docs_index_entries` + `file_tree_entries` 兩個前端參數；`workspace_count`/`active_workspace_id` 由 AppState 從 `registry.lock()` 自動填。**全 codebase 無 `#[serde(deny_unknown_fields)]`**，serde 預設忽略多餘欄位 → 現行 `metricSnapshot` 多送 `workspaceCount`/`activeWorkspaceId` 無害，**不需動 api**。風險僅在「此 command 從未被任何前端實跑過」（命令本身未驗證），而非「camelCase→snake_case 轉換機制可能壞」（該機制是 Tauri 標準，controller 既有 `readTextFile`/`save_unsaved_backup` 全靠它且已實機過）。
- `append_diagnostic_event`（commands.rs:230,1053）簽名是 `event: crate::diagnostics::DiagnosticEventInput`，`DiagnosticEventInput { level, source, message }` 三者皆 `String` 且**無 `rename_all`**（diagnostics.rs:13-16）→ Tauri 期待 `{ event: { level, source, message } }`。後端測試 commands.rs:2900 已示範此形狀。**Task 0 修法成立。**
- recovery 三 command 參數（commands.rs:1020/1032/1041）：`save_unsaved_backup(workspaceRoot/workspaceId/path/content/version)`、`list_unsaved_backups(workspaceRoot/workspaceId)`、`discard_unsaved_backup(workspaceRoot/workspaceId/backupId)`，與 `recovery-api.ts` 既有 wrapper 完全一致，**不需動 api**。
- `list_unsaved_backups` 回傳含 `content` 的完整 `UnsavedBackup[]`（recovery-model.ts:3-11）→ restore「重抓 list 找 id 取 content」設計成立。
- **型別矛盾（已確認）**：後端 metrics.rs:20 `memory_bytes: Option<u64>`（macOS/Linux `ps` 可能失敗回 null），但前端 `features/diagnostics/diagnostics-model.ts:4` 誤標為 `memory_bytes: number`。**且 DiagnosticsPanel.tsx:72 直接 `formatBytes(metric.memory_bytes)`，`formatBytes(bytes: number)`** → 若改 feature model 為 `number | null` 會讓 v1 panel 破 tsc。處理見 T2。

## 架構與接線點（具體）

### 0. 先修 latent bug：diagnostics-api append 參數形狀

`src/features/diagnostics/diagnostics-api.ts:19-24` 的 `appendDiagnosticEvent` 送 flat `{level, source, message}`，後端期待 `{event: {...}}`。直接呼叫會 deserialize 失敗（這條從未被任何人跑過，屬 orphan，且 controller 的埋點會被 `.catch(()=>{})` 吞掉 → silently 失敗，難察覺）。
- **修法**：`return call("append_diagnostic_event", { event: args })`（包一層 `event`）。`metricSnapshot`/`listDiagnosticEvents` 形狀正確不動。

### 1. v2-model.ts（型別 + 純函式 + custom SettingSection）

- **新增型別**（v2 本地最小集合，避免把 features model 的錯誤型別 cross-import 進 v2 核心）：
  - `MetricSnapshot = { memoryBytes: number | null; uptimeMs: number; workspaceCount: number; docsIndexEntries: number; fileTreeEntries: number; processId: number }`
  - `DiagEvent = { id: string; level: "debug"|"info"|"warn"|"error"; source: string; message: string; ts: number }`
  - `BackupSummary = { id: string; path: string; updatedMs: number; contentLength: number }`
- **新增純函式**（可單元測試，放 v2-model；注意與 features 的 `formatBytes`/`formatUptime` 是**移植非 import**，因 v2 不依賴 features model）：
  - `fmtBytes(n: number | null): string` — `null`→`"—"`；`0`→`"0 B"`；否則 KB/MB/GB 1 位小數（移植 diagnostics-model.formatBytes 邏輯，但 0/null 分流：null→"—"、0→"0 B"）
  - `fmtUptime(ms: number): string` — h m / m s / s（移植 formatUptime；`<=0`→`"0s"`）
  - `diagLevelStyle(level): { color: string; bg: string }` — 映射 `--yz-*`（debug→`var(--yz-5a6675)`/灰、info→`var(--yz-82aaff)`/藍底、warn→`var(--yz-ffcb6b)`/黃底、error→`var(--yz-f07178)`/紅底；**不可 hardcode hex**，回傳 `var(--yz-*)` 字串）
  - `tsLabel(ms: number): string` — `ms<=0`→`"pending"`，否則 `new Date(ms).toLocaleTimeString()`
  - `fmtBackupSize(len: number): string` — `len.toLocaleString() + " bytes"`
- **`SettingSection` type（行 617-623）加 optional 欄位**：`custom?: "performance" | "diagnostics" | "recovery"`（現有 6 個 section 不帶此欄位，零行為變更）。
- **`SETTINGS_CONFIG`（行 625-666）在 shortcuts 之後 push 三個 section**（`rows: []` + `custom`）：
  - `{ id: "performance", label: "Performance", glyph: "◷", desc: "Live process metrics — memory, uptime and index sizes.", rows: [], custom: "performance" }`
  - `{ id: "diagnostics", label: "Diagnostics", glyph: "◉", desc: "Recent IDE action log written by the backend.", rows: [], custom: "diagnostics" }`
  - `{ id: "recovery", label: "Recovery", glyph: "↺", desc: "Unsaved edits backed up automatically.", rows: [], custom: "recovery" }`
- **`settingDefault`（行 668）不受影響**（三個 custom section 的 `rows: []`，迴圈自然略過）。

### 2. bridge.ts（三個 mapper + 複用 flattenTree，純函式 + 測試）

後端 payload（snake_case）→ v2 model（camelCase），照既有 `mapGitLog`/`mapDbProfiles`/`findNode`（bridge.ts:76）風格：

- **`mapMetric`**：**不 import 後端那個型別錯的 `AppMetricSnapshot`**（它把 `memory_bytes` 標成 `number`）。在 bridge 內宣告本地 input 型別 `type MetricSnapshotIn = { memory_bytes: number | null; uptime_ms: number; workspace_count: number; docs_index_entries: number; file_tree_entries: number; process_id: number }`，`mapMetric(snap: MetricSnapshotIn): MetricSnapshot` 做 `memoryBytes: snap.memory_bytes ?? null` 等對應。controller 呼叫端把 `metricSnapshot()` 回的物件 `as never` 餵進 `mapMetric`（繞開 features 型別與本地 input 型別的差異，零 runtime 影響）。**理由**：不動 `features/diagnostics/diagnostics-model.ts`，避免 DiagnosticsPanel.tsx:72 `formatBytes(metric.memory_bytes)` 破 tsc（已確認該 v1 call site 對 `number` 的依賴）。
- **`mapDiagnosticEvents(rows): DiagEvent[]`** — `timestamp_ms`→`ts`，依 ts desc 排序，`slice(0, 50)`（移植 `storeDiagnosticEvents` 的排序+截斷）。input 型別可 import `type DiagnosticEvent`（此型別正確，無 null 問題）或用本地 `{ id; timestamp_ms; level; source; message }`，二擇一即可。
- **`mapBackups(rows): BackupSummary[]`** — `updated_ms`→`updatedMs`、`content.length`→`contentLength`、依 `updatedMs` desc 排序（同 `storeRecoveryBackups`，tie-break `path.localeCompare`）。input 用本地 `{ id; path; content: string; updated_ms }`（只取需要的欄位）。
- **file-tree 計數：複用既有 `flattenTree`，不另立 `countTreeEntries`**。v2-model.ts:681 的 `flattenTree(nodes)` 已遞迴展平且**只收 leaf（file）節點**（行 685-686：有 `node.d` 就遞迴，否則 push file）→ `flattenTree(nodes).length` 即「檔案數（files-only）」。**語意明示**：送給後端 `file_tree_entries` 的就是「該 project treeData 中 leaf 檔案數」；後端只存這個數字不重新定義（metrics.rs:47 直接 `input.file_tree_entries`），故前端送多少顯示多少，語意一致。controller 的 `loadStability` 直接用 `flattenTree(store().ui[pid]?.treeData ?? []).length`。**bridge 不新增計數函式。**

### 3. v2-store.ts（RealDelegate 5 method + 頂層 stab state + actions）

- **RealDelegate type（行 39-71）加 5 個新 method**（統一為 5，含 `backupTab`；草案 summary 誤寫「4 method」已修正）：
  ```
  loadStability: () => void                            // 進 custom Settings 頁時一次載入 metric+events+backups
  refreshMetric: () => void                            // Performance 頁 Refresh 鈕
  restoreBackup: (id: string) => void
  discardBackup: (id: string) => void
  backupTab: (tabId: number, content: string) => void  // setTabContent real 分支呼叫，做 autosave debounce
  ```
- **V2State 頂層加全域欄位**（穩定性是 app 級資料：metric 的 workspace_count 由後端 registry 填、events 是全域 log；放頂層而非 per-project `ProjectUI`，避開 demo/real 雙模式對稱陷阱，**不需動 defUI()/emptyUI()**）：
  ```
  stab: { metric: MetricSnapshot | null; events: DiagEvent[]; backups: BackupSummary[]; loading: boolean }
  ```
  在 `createV2Store()` 回傳物件加初始 `stab: { metric: null, events: [], backups: [], loading: false }`（與 `confirm: null`（行 439）、`stSec: "general"`（行 434）同層）。
- **新增 actions**（demo/real 分支標準型，參考既有 `saveTab` 行 726-732、`gitCheckout` 行 826）：
  - `loadStability()`：`if (get().mode === "real") { realDelegate?.loadStability(); return }`；demo 填假快照讓瀏覽器 Settings 不空白：`set({ stab: { metric: { memoryBytes: 184*1024*1024, uptimeMs: 3_600_000, workspaceCount: 3, docsIndexEntries: 0, fileTreeEntries: 42, processId: 0 }, events: [3 筆假 info/warn（含 ts: Date.now()-… 與 source/message）], backups: [], loading: false } })`。
  - `refreshMetric()`：real → `realDelegate?.refreshMetric()`；demo 重設假 metric（memory 帶 `Math.round(Math.random()*…)` 讓「Refresh 有反應」可斷言變化或非 null）。
  - `restoreBackup(id)`：real → `realDelegate?.restoreBackup(id)`；demo → `get().showToast("Demo mode — no backups to restore")`。
  - `discardBackup(id)`：**走 ConfirmModal**——`get().openConfirm({ title: "Discard backup", body: "This backup will be permanently deleted.", label: "Discard", danger: true, action: () => { if (get().mode === "real") realDelegate?.discardBackup(id); else set((s) => ({ stab: { ...s.stab, backups: s.stab.backups.filter((b) => b.id !== id) } })) } })`（`ConfirmState` 型別見行 213-217，有 `danger?`）。
  - `setSettingsSection(id)`（行 1246）**擴充**：`set({ stSec: id }); if (id === "performance" || id === "diagnostics" || id === "recovery") get().loadStability()`。**選 `setSettingsSection` 觸發而非 `openSettings`**，避免每次開 Settings 都打三個 API（只在切到 custom 頁才載）。
  - `setTabContent`（行 718-724）**擴充**：保留現有樂觀 `upd(...)`，其後加 `if (get().mode === "real") realDelegate?.backupTab(tabId, content)`（store 不 import controller，僅透過 realDelegate；demo 不呼，零行為變更）。debounce 在 controller `backupTab` 內做，store 端不 debounce。
- **logger 埋點全在 controller 層**（store 不碰後端），`setSetting` 等 store action **不動**。

### 4. controller.ts（delegate 實作 + autosave debounce + logDiag + restore realPath fallback）

- **import 區塊（行 6-68）加**：
  ```
  import { appendDiagnosticEvent, listDiagnosticEvents, metricSnapshot } from "../features/diagnostics/diagnostics-api"
  import { saveUnsavedBackup, listUnsavedBackups, discardUnsavedBackup } from "../features/recovery/recovery-api"
  import { mapMetric, mapDiagnosticEvents, mapBackups } from "./bridge"   // flattenTree 從 v2-model import（已用其它 v2-model 匯入）
  ```
- **`logDiag` helper（模組級，fire-and-forget + isTauri 守衛，`isTauri` 來自 bridge.ts:16）**：
  ```
  function logDiag(level: "info"|"warn"|"error", source: string, message: string): void {
      if (!isTauri()) return
      void appendDiagnosticEvent({ level, source, message }).catch(() => {})
  }
  ```
  依賴第 0 步修好的 api 形狀。
- **埋點清單**（在現有 delegate method 內插一行 fire-and-forget，不改既有邏輯）：
  - `selectProject(pid)` → `logDiag("info","workspace","selected "+pid)`
  - `openFile`（行 357）讀檔成功（行 380 patch 後）→ `logDiag("info","editor","opened "+displayPath)`；catch（行 394）→ `logDiag("error","editor","open failed "+errMsg(error))`
  - `saveFile`（行 588）成功（行 599 patch 後）→ `logDiag("info","editor","saved "+(tab.path ?? tab.realPath))`；catch（行 607）→ `logDiag("error","editor","save failed "+errMsg(error))`
  - `doCommit` 成功 → `logDiag("info","git","commit "+message)`
  - `gitSync(op)` 成功 → `logDiag("info","git",op+" ok")`
  - `closeProject(pid)` → `logDiag("info","workspace","closed "+pid)`
  - `termKill`/`azClose` → `logDiag("info","terminal","killed session")`
- **delegate（行 295 起的物件）加 5 method**：
  - `loadStability()`：`void (async () => { try { const pid = store().active; const root = rootOf(pid); v2Store.setState((s) => ({ stab: { ...s.stab, loading: true } })); const fileTreeEntries = flattenTree(store().ui[pid]?.treeData ?? []).length; const [snap, events] = await Promise.all([ metricSnapshot({ workspaceCount: Object.keys(store().ui).length, activeWorkspaceId: pid, docsIndexEntries: 0, fileTreeEntries }), listDiagnosticEvents({ limit: 50 }) ]); let backups = [] as Awaited<ReturnType<typeof listUnsavedBackups>>; if (root) backups = await listUnsavedBackups({ workspaceRoot: root, workspaceId: pid }).catch(() => []); v2Store.setState({ stab: { metric: mapMetric(snap as never), events: mapDiagnosticEvents(events), backups: mapBackups(backups), loading: false } }) } catch (e) { v2Store.setState((s) => ({ stab: { ...s.stab, loading: false } })); store().showToast("Diagnostics: "+errMsg(e)) } })()`。`docsIndexEntries` 暫傳 0（docs.rs 未接，基線明示為非目標）。
  - `refreshMetric()`：只重抓 `metric_snapshot`（同上 fileTreeEntries 算法），`v2Store.setState((s) => ({ stab: { ...s.stab, metric: mapMetric(snap as never) } }))`。
  - `restoreBackup(id)`：`void (async () => { const pid = store().active; const root = rootOf(pid); if (!root) return; const list = await listUnsavedBackups({ workspaceRoot: root, workspaceId: pid }).catch(() => []); const bk = list.find((b) => b.id === id); if (!bk) { store().showToast("Backup not found"); return }; const displayPath = bk.path; const node = findNode(store().ui[pid]?.treeData ?? [], displayPath); const realPath = node?.p ?? displayPath; /* ←【審查 gap 修正】沿用 openFile 行 370 的 fallback 慣例：node 因 lazy-load 未載入回 null 時，realPath fallback 成相對 path；readTextFile/writeTextFile 以 workspaceRoot 為基準仍可運作；務必把 realPath 設進 tab，否則 saveFile 行 592 的 !tab.realPath 守衛會讓後續存檔 silently no-op */ const name = displayPath.split("/").pop() ?? displayPath; const existing = store().ui[pid]?.tabs.find((t) => t.type === "file" && t.path === displayPath); patchProject(pid, (q) => { if (existing) { q.tabs = q.tabs.map((t) => t.id === existing.id ? { ...t, content: bk.content, realPath: t.realPath ?? realPath, version: bk.version ?? t.version ?? null, dirty: true, loading: false } : t); q.activeTab = existing.id } else { const newId = tabId(); q.tabs = [...q.tabs, { id: newId, type: "file", name, path: displayPath, realPath, content: bk.content, version: bk.version ?? null, dirty: true, contentLang: langForPath(name) }]; q.activeTab = newId } }); store().showToast("Restored "+displayPath); logDiag("info","recovery","restored "+displayPath) })()`。
  - `discardBackup(id)`：`void (async () => { const pid = store().active; const root = rootOf(pid); if (!root) return; await discardUnsavedBackup({ workspaceRoot: root, workspaceId: pid, backupId: id }).catch((e) => store().showToast("Discard: "+errMsg(e))); const list = await listUnsavedBackups({ workspaceRoot: root, workspaceId: pid }).catch(() => []); v2Store.setState((s) => ({ stab: { ...s.stab, backups: mapBackups(list) } })); store().showToast("Discarded backup"); logDiag("info","recovery","discarded "+id) })()`。
  - `backupTab(tabId, content)`：模組級 `const backupTimers = new Map<number, ReturnType<typeof setTimeout>>()`。實作：`const pid = store().active; const root = rootOf(pid); if (!root) return; const prev = backupTimers.get(tabId); if (prev) clearTimeout(prev); const timer = setTimeout(() => { backupTimers.delete(tabId); const tab = tabIn(pid, tabId); if (!tab || tab.type !== "file" || !tab.path) return; void saveUnsavedBackup({ workspaceRoot: root, workspaceId: pid, path: tab.path, content, version: tab.version ?? null }).catch(() => {}) }, 600); backupTimers.set(tabId, timer)`。
- **`closeTab`（delegate 行 418）擴充**：在現有 cmd/db 清理前，加 dirty file 同步寫一次備份（不 debounce）：`if (tab.type === "file" && tab.dirty && typeof tab.content === "string" && tab.path) { const pid = store().active; const root = rootOf(pid); if (root) void saveUnsavedBackup({ workspaceRoot: root, workspaceId: pid, path: tab.path, content: tab.content, version: tab.version ?? null }).catch(() => {}) }`。並清除該 tab 的 debounce timer：`const t = backupTimers.get(tab.id); if (t) { clearTimeout(t); backupTimers.delete(tab.id) }`。
- **`bootstrapV2`（registerRealDelegate 在行 1001）**：末尾可選加 `logDiag("info","app","workspace bootstrap complete")`（不必要也無害）。**不在 bootstrap 自動 loadStability**（進 Settings custom 頁才載）。

### 5. Overlays.tsx（SettingsModal 自訂 render 出口 + 三子元件）

- **SettingsModal（約行 356-435，`.yz2-settings-sec` 內）改動**：在 `sec-title`/`sec-desc` 之後、`cur.rows.map(...)` 之前，先判斷 `cur.custom`：
  ```
  {cur.custom === "performance" ? <PerformanceSection /> :
   cur.custom === "diagnostics" ? <DiagnosticsSection /> :
   cur.custom === "recovery" ? <RecoverySection /> :
   cur.rows.map(...現有表單渲染...)}
  ```
  現有 6 個 section（無 `custom`）走 else 分支，零行為變更。
- **三個子元件**（同檔 Overlays.tsx，`useV2Store` 取 `s.stab` + actions）：
  - `PerformanceSection`：頂部 Refresh 鈕（`yz2-btn-ghost`，`onClick={() => useV2Store.getState().refreshMetric()}`），下方 5 張 metric 卡（Memory `fmtBytes(stab.metric.memoryBytes)`、Uptime `fmtUptime`、File tree、Docs index、Workspaces）。`stab.metric === null` → `yz2-stab-empty`「No snapshot」。class `yz2-stab-metrics` grid + `yz2-stab-card`。
  - `DiagnosticsSection`：log 列，每列 level badge（`diagLevelStyle(ev.level)` 套 inline `style`）+ message + source + `tsLabel(ev.ts)`。空清單 `yz2-stab-empty`「No diagnostic events」。class `yz2-stab-log-row` / `yz2-stab-badge`。
  - `RecoverySection`：backup 列，每列 path（mono）+ `fmtBackupSize` + `tsLabel(updatedMs)` + 右側兩 ghost 鈕（↺ Restore→`restoreBackup(id)`、× Discard→`discardBackup(id)`）。空清單「No unsaved backups」。class `yz2-stab-backup-row` / `yz2-stab-backup-acts`。
- **不引入 lucide-react**：v2 全程純文字 glyph（對齊既有 ContextMenu 的 ⟳/×/↺），零新依賴。

### 6. yuzu.css（yz2-stab-* 樣式）

`.yz2-settings-sec` 已有 `overflow-y: auto`，長清單自動可捲，**不需額外 max-height**。新增：
- `.yz2-stab-refresh`：section 頂部 action 列，`display:flex; justify-content:flex-end; margin-bottom:12px`
- `.yz2-stab-metrics`：`display:grid; grid-template-columns:repeat(auto-fill, minmax(140px,1fr)); gap:8px`
- `.yz2-stab-card`：`background:var(--yz-090c12); border:1px solid var(--yz-1c2433); border-radius:7px; padding:10px 12px`；內含 `.lbl`（11px、`var(--yz-5a6675)`）+ `.val`（13px mono、`var(--yz-e6edf3)`）
- `.yz2-stab-log-row` / `.yz2-stab-backup-row`：`display:flex; align-items:center; gap:9px; min-height:30px; border-bottom:1px solid var(--yz-11161f); padding:6px 0; font-size:12px`
- `.yz2-stab-badge`：`font-size:10px; padding:1px 6px; border-radius:3px`（color/bg 由 inline `diagLevelStyle` 套）
- `.yz2-stab-backup-acts`：`flex:0 0 auto; display:flex; gap:6px`（沿用 `.yz2-btn-ghost` 或新 `.yz2-stab-iconbtn` 24x24）
- `.yz2-stab-empty`：`font-size:12px; color:var(--yz-5a6675); padding:12px 0`
- log `.msg { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }`、`.meta { font-size:11px; color:var(--yz-5a6675); font-family:'JetBrains Mono' }`

## Implementation Task Checklist

### Task SP1-0: Fix diagnostic append payload

**Files:**
- Modify: `src/features/diagnostics/diagnostics-api.ts`
- Test: add focused assertions in `src/v2/bridge.test.ts` only if a `lib/tauri` mock is already introduced; otherwise verify through native/manual SP1 gate.

- [ ] **Step 1: Write the expected call shape**

Expected wrapper implementation:

```ts
export function appendDiagnosticEvent(args: {
  level: DiagnosticEvent["level"];
  source: string;
  message: string;
}): Promise<DiagnosticEvent> {
  return call("append_diagnostic_event", { event: args });
}
```

- [ ] **Step 2: Run TypeScript**

Run:

```bash
bunx tsc --noEmit
```

Expected: PASS. No v1 diagnostics model type change is allowed in this task.

- [ ] **Step 3: Commit**

```bash
git add src/features/diagnostics/diagnostics-api.ts
git commit -m "fix(diagnostics): wrap append event payload"
```

### Task SP1-1: Add stability model helpers and Settings metadata

**Files:**
- Modify: `src/v2/v2-model.ts`
- Test: `src/v2/v2-model.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for:

```ts
expect(fmtBytes(null)).toBe("—")
expect(fmtBytes(0)).toBe("0 B")
expect(fmtBytes(1536)).toBe("1.5 KB")
expect(fmtUptime(5000)).toBe("5s")
expect(diagLevelStyle("error").color).toBe("var(--yz-f07178)")
expect(tsLabel(0)).toBe("pending")
expect(fmtBackupSize(1234)).toContain("1,234")
expect(SETTINGS_CONFIG.some((section) => section.custom === "performance")).toBe(true)
expect(SETTINGS_CONFIG.some((section) => section.custom === "diagnostics")).toBe(true)
expect(SETTINGS_CONFIG.some((section) => section.custom === "recovery")).toBe(true)
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
bun test src/v2/v2-model.test.ts
```

Expected: FAIL with missing helper/custom property errors.

- [ ] **Step 3: Implement minimal model helpers**

Add only the types and helpers listed in the architecture section. Extend `SettingSection` with:

```ts
custom?: "performance" | "diagnostics" | "recovery"
```

- [ ] **Step 4: Run focused test**

```bash
bun test src/v2/v2-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/v2/v2-model.ts src/v2/v2-model.test.ts
git commit -m "feat(v2): add stability settings model"
```

### Task SP1-2: Add bridge mappers

**Files:**
- Modify: `src/v2/bridge.ts`
- Test: `src/v2/bridge.test.ts`

- [ ] **Step 1: Write failing mapper tests**

Assert:

```ts
expect(mapMetric({ memory_bytes: null, uptime_ms: 1000, workspace_count: 2, docs_index_entries: 0, file_tree_entries: 9, process_id: 42 } as never).memoryBytes).toBeNull()
expect(mapDiagnosticEvents(rows)[0].ts).toBeGreaterThan(mapDiagnosticEvents(rows)[1].ts)
expect(mapBackups([{ id: "b1", path: "a.ts", content: "abc", updated_ms: 2 }])[0].contentLength).toBe(3)
```

- [ ] **Step 2: Run focused test and confirm RED**

```bash
bun test src/v2/bridge.test.ts
```

- [ ] **Step 3: Implement `mapMetric`, `mapDiagnosticEvents`, `mapBackups`**

Use a local input type for metric payload so `features/diagnostics/diagnostics-model.ts` remains unchanged.

- [ ] **Step 4: Run focused test**

```bash
bun test src/v2/bridge.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/v2/bridge.ts src/v2/bridge.test.ts
git commit -m "feat(v2): map stability backend payloads"
```

### Task SP1-3: Add store state and demo actions

**Files:**
- Modify: `src/v2/v2-store.ts`
- Test: `src/v2/v2-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Assert demo behavior:

```ts
const store = createV2Store()
store.getState().loadStability()
expect(store.getState().stab.metric).not.toBeNull()
expect(store.getState().stab.events.length).toBeGreaterThan(0)
store.getState().setSettingsSection("performance")
expect(store.getState().stab.metric).not.toBeNull()
store.getState().discardBackup("b1")
expect(store.getState().confirm?.label).toBe("Discard")
expect(store.getState().confirm?.danger).toBe(true)
```

- [ ] **Step 2: Run focused test and confirm RED**

```bash
bun test src/v2/v2-store.test.ts
```

- [ ] **Step 3: Implement `stab`, RealDelegate methods, and demo fallbacks**

Use the 5 method names from the architecture section: `loadStability`, `refreshMetric`, `restoreBackup`, `discardBackup`, `backupTab`.

- [ ] **Step 4: Run focused test**

```bash
bun test src/v2/v2-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/v2/v2-store.ts src/v2/v2-store.test.ts
git commit -m "feat(v2): add stability store actions"
```

### Task SP1-4: Wire real controller delegate

**Files:**
- Modify: `src/v2/controller.ts`

- [ ] **Step 1: Implement real delegate methods**

Add imports for diagnostics/recovery APIs and bridge mappers. Add module-level `backupTimers` and `logDiag`. Implement the 5 RealDelegate methods exactly named in `v2-store.ts`.

- [ ] **Step 2: Run TypeScript**

```bash
bunx tsc --noEmit
```

Expected: PASS. A missing delegate method or mismatched signature should fail this gate.

- [ ] **Step 3: Run v2 tests**

```bash
bun test src/v2/
```

Expected: PASS; existing v2 tests do not regress.

- [ ] **Step 4: Commit**

```bash
git add src/v2/controller.ts
git commit -m "feat(v2): wire stability controller delegate"
```

### Task SP1-5: Render Settings custom sections

**Files:**
- Modify: `src/v2/Overlays.tsx`
- Modify: `src/v2/yuzu.css`

- [ ] **Step 1: Add custom render switch**

Render `PerformanceSection`, `DiagnosticsSection`, or `RecoverySection` when `cur.custom` is set. Leave existing `cur.rows.map(...)` unchanged for non-custom sections.

- [ ] **Step 2: Add `yz2-stab-*` CSS**

Use only existing `--yz-*` colors. Avoid new dependencies and avoid changing existing settings rows.

- [ ] **Step 3: Run full verification**

```bash
bun test src/v2/
bunx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/v2/Overlays.tsx src/v2/yuzu.css
git commit -m "feat(v2): render stability settings sections"
```

### Task SP1-6: Native stability smoke

**Files:**
- No code edits unless native smoke exposes a mismatch.

- [ ] **Step 1: Run desktop shell manually**

Open Settings -> Performance, Diagnostics, Recovery in real Tauri mode.

- [ ] **Step 2: Verify native behaviors**

Expected:

```text
metric_snapshot returns a process id, uptime, memory or null-safe memory display.
append_diagnostic_event writes an event and list_diagnostic_events shows it.
Editing a dirty file creates a backup after debounce.
Restore opens or updates a file tab with realPath set so saveFile does not no-op.
Discard backup opens ConfirmModal and removes the backup after confirmation.
```

- [ ] **Step 3: Commit native mismatch fixes only if needed**

```bash
git add src/v2 src/features/diagnostics src/features/recovery
git commit -m "fix(v2): harden stability native wiring"
```

## UI 考量

- 三頁籤 nav glyph（◷◉↺）與既有 6 個（⚙⌸❯✦⇅⌘）視覺一致，單色。
- metric 卡 grid auto-fill，窄 modal 自動換行；13px 主值 / 11px label，對齊 settings section 節奏。
- log/backup 列高 30px（刻意 compact，清單型 UI），但用同樣 `border-bottom: var(--yz-11161f)` 分隔線維持視覺血緣。
- destructive discard 走全域 ConfirmModal（`danger:true` 紅鈕、`label:"Discard"`），與專案鐵則一致；restore 不需 confirm（非破壞，只開 tab 灌內容讓使用者自行存檔）。
- demo 模式必須有假資料（假 metric + 3 筆假 log + 空 backups），避免 Settings 在純前端空白或炸開。

## 驗證 gate

- **`bun test src/v2/`**（維持綠 + 新增測試通過；baseline 71 pass，分布 bridge/v2-model/v2-store）
  - **bridge.test.ts**：`mapMetric`（`memory_bytes:null`→`memoryBytes===null`、`file_tree_entries:9`→`fileTreeEntries===9`，fixture 用 `as never` 餵 null）、`mapDiagnosticEvents`（ts desc + 超過 50 筆被 slice）、`mapBackups`（updatedMs desc + `contentLength===content.length`）。**不測 countTreeEntries**（已改複用 `flattenTree`，其行為由既有測試覆蓋；可選加一句「flattenTree leaf-only length」斷言固定語意）。
  - **v2-model.test.ts**：`fmtBytes(null)`→`"—"`、`fmtBytes(0)`→`"0 B"`、`fmtBytes(1536)`→`"1.5 KB"`、`fmtBytes(184*1024*1024)` 含 `"MB"`；`fmtUptime(3600000)` 含 `"h"`、`fmtUptime(65000)` 含 `"m"`、`fmtUptime(5000)`→`"5s"`；`diagLevelStyle("error").color === "var(--yz-f07178)"`（info/warn/debug 各色票字串）；`tsLabel(0)`→`"pending"`；`fmtBackupSize(1234)` 含 `"1,234"`。
  - **v2-store.test.ts**（用 `createV2Store()` 新實例）：demo `loadStability()` 後 `stab.metric` 非 null 且 `stab.events.length>0`；`discardBackup("x")` 後 `store.getState().confirm?.label==="Discard"` 且 `confirm?.danger===true`；`setSettingsSection("performance")` 觸發 loadStability（demo 下斷言 `stab.metric` 非 null）；`refreshMetric()` demo 有反應（metric 非 null）；`setTabContent` demo 不呼 delegate（不報錯即可，因 demo 無 realDelegate）。
- **`bunx tsc --noEmit`**：確認 RealDelegate 5 新 method 簽名、`stab` 欄位、bridge mapper 本地 input 型別、`as never` 餵入點型別對齊。**特別確認未動 `features/diagnostics/diagnostics-model.ts` → v1 DiagnosticsPanel.tsx:72 不破。**
- **native 驗證（mock-IPC 先行，依 MEMORY 陷阱）**：
  - **T4 controller 測試重新定位為「窄 smoke + 可注入純邏輯」**（審查 gap：controller 一被 import 即透過 `terminal-api`（line 1 `import { listen } from "@tauri-apps/api/event"`）與 `lib/tauri`（`import { invoke } from "@tauri-apps/api/core"`）拉入 Tauri 模組；`mock.module("@tauri-apps/api/event")` + `mock.module("@tauri-apps/api/core")` 必須在 import controller **之前**生效，且 `listen` 須回 `Promise<() => void>`、`invoke` 須回可控 Promise，否則 import 階段 throw）。**參考 `src/features/terminal/TerminalTab.test.ts` / `src/features/editor/EditorTab.test.ts` 既有的 `mock.module` 模式**。但 `onTerminalOutput`/`onTerminalExit` 是「被呼叫才註冊 listener」（terminal-api.ts:54-65 是 function，非 import-time 副作用），故 import controller 不會立刻註冊 listener，連鎖比草案估計輕——真正 import-time 需要的只是 `@tauri-apps/api/event` 與 `@tauri-apps/api/core` 兩個模組 export 存在且被 mock。
  - **降低 mock-IPC 期望**：T4 只做 smoke（mock invoke 攔截，斷言 `loadStability` 觸發 `metric_snapshot`/`list_diagnostic_events`/`list_unsaved_backups` 三呼叫、`backupTab` 過 600ms debounce 後觸發 `save_unsaved_backup`）。**真正 gate 落在 native 手動驗證**（符合 MEMORY 記錄的「mock-IPC 過不代表 native 過」陷阱）。可選的更穩做法：把 `loadStability` 的「組裝 + Promise.all + map」與 debounce 抽成接受注入 api 的純函式單測，避免整個 controller import 的 mock 連鎖。
  - **桌面殼三項實機確認**：(1) `metric_snapshot` 真的回得了數字（基線標記為「此 command 從未被任何前端實跑」的唯一未驗證點）；(2) `append_diagnostic_event` 修好 `{event:{...}}` 後真的寫得進去且 `list_diagnostic_events` 撈得回來；(3) autosave debounce 真的寫檔 + 重啟後 `list_unsaved_backups` 撈得到 + restore 把 content 灌回 tab 後能正常 saveFile（驗 realPath fallback 不破存檔）。

## 風險

- **append_diagnostic_event 參數形狀 bug（高）**：orphan api 送 flat 而非 `{event}`，不修則所有 logger 埋點 silently 失敗（被 `.catch(()=>{})` 吞掉）。Task 0 先修 + RED 測試（`mock.module("../../lib/tauri")` 攔 `call`，斷言第二參數為 `{event:{level,source,message}}`）。
- **metric_snapshot 命令未驗證（中）**：基線「v1 從未實跑此 command」。**轉換機制本身可靠**（Tauri 標準，controller 既有大量同機制呼叫已實機過），真正未驗證的是「此特定 command 從未被觸發」。mock-IPC 過不代表 native 過，需實機確認回得了數字。最壞情況微調 api wrapper 參數名。
- **T4 controller 整合測試零先例（中）**：v2 目前無任何 controller test，且 controller import 即拉 Tauri 模組（`@tauri-apps/api/event` + `core`），mock 不完整會在 import 當下 throw。緩解：mock 須在 import controller 前生效 + 完整 export（參考 TerminalTab/EditorTab.test），或抽純邏輯單測，並明確接受 T4 僅 smoke、native 為真 gate。
- **autosave 牽動編輯流程（中）**：`setTabContent` 高頻 onChange，必須 debounce（600ms）且切 project/關 tab 時清模組級 `Map` timer，否則寫到舊 tab 或洗版後端。store 不可 import controller，故靠 `realDelegate?.backupTab`。
- **restore realPath 反解（中→已解）**：findNode 因 lazy-load 未載入該路徑回 null 時，**沿用 openFile（controller.ts:370）的 `node?.p ?? displayPath` fallback**——realPath fallback 成相對 path，readTextFile/writeTextFile 以 workspaceRoot 為基準仍可運作；**務必把 realPath 設進 restore 開的 tab**，否則 saveFile（行 592）的 `!tab.realPath` 守衛會讓後續存檔 silently no-op。
- **memory_bytes 型別矛盾（低→已解）**：後端 `Option<u64>` vs 前端 features model `number`，且 DiagnosticsPanel.tsx:72 依賴 `number`。**解法：不動 v1 feature model**，bridge `mapMetric` 用本地 input 型別 `memory_bytes: number | null`，controller 呼叫端 `as never` 餵入。零跨 feature 改動，零 v1 破壞。
- **stab 放頂層全域 vs per-project backups（低）**：metric/events 是 app 級（放頂層正確）；backups 其實 per-workspace，本計劃簡化為「顯示 active project 的 backups」，切 project 不自動刷新（初版進 Settings custom 頁才載；per-project 刷新列 follow-up，可在 `selectProject` 補 `loadStability`）。

## 非目標

- 不接 `load_settings`/`save_settings`/`import_keybindings`（後端設定持久化）——v2 設定仍走 localStorage，獨立議題（基線標記「相關但非三件套本身」）。
- 不接 docs.rs（`docsIndexEntries` 暫傳 0）。
- 不做 saveFile 成功後自動 discard 對應 backup（follow-up）。
- 不做 backup diff 預覽/衝突合併（只還原 content 進 tab，使用者自行存檔）。
- 不引入 lucide-react 或任何新前端依賴。
- 不改後端 Rust（三塊 command 全就緒）。
- **不改 `features/diagnostics/diagnostics-model.ts` 的 `memory_bytes` 型別**（避免 v1 DiagnosticsPanel 破 tsc；v2 用本地 input 型別處理 null）。
- 不另立 `countTreeEntries`（複用既有 `flattenTree`）。
