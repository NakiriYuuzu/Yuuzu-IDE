# Terminal 命名功能 — 設計

- **日期**:2026-06-16
- **狀態**:設計核可,待寫實作計畫
- **範圍**:`src/v2/`(前端,純 UI)、`src/features/terminal/TerminalTab.tsx`
- **不涉及**:Rust 後端(`src-tauri/`)

## 背景與問題

使用者要的是「類似原生終端機」的標題行為,具體兩個能力:

1. **claude-code / shell 能改名** — 程式透過 OSC escape sequence(`ESC]0;標題BEL` / `ESC]2;…`)主動設定終端標題,原生終端機會自動反映。
2. **使用者能自訂名稱** — 手動命名 terminal。

目前都做不到,根因:

- **後端其實支援 `name`**:`reserve_metadata`(`terminal.rs:79`)在傳入非空 name 時採用,否則 fallback `"zsh {next}"`;API `spawnTerminalSession` 也有 `name?` 參數(`terminal-api.ts:26`)。
- **但 v2 前端三個建立入口把名稱寫死**,且**無任何輸入/rename 入口**:
  - `newTerm()` → `"zsh · " + n`(`controller.ts:925`)
  - `azNew()` → `"agent session " + n`(`controller.ts:967`)
  - `openShell(host)` → `host.label`(`controller.ts:1015`)
- **顯示走的是另一條軌道**:v2 顯示 cmd 分頁用 `Tab.title`(`TabStrip.tsx:53`)、agent session 用 `AzWindow.title`(`AgentZone.tsx:117`),**不讀後端 `name`**。唯一讀後端 `name` 的 `TerminalPanel.tsx` 是 v1 死碼,未被任何處渲染。
- **OSC 標題未接線**:`TerminalTab.tsx` 建立 xterm 時只接 `onData`/`onResize`,沒接 `onTitleChange`,程式送來的標題全被丟棄。

## 目標

- claude-code/shell 的 OSC 標題能自動更新到對應 terminal 的顯示名稱。
- 使用者能手動命名 cmd 終端分頁與 agent session,且手動命名後**鎖定**,不被 OSC 覆蓋。

## 非目標(本次不做)

- 後端 `TerminalSessionInfo.name` 同步。
- session rehydrate / 持久化恢復。詳見「範圍外」。

## 設計決策(已與使用者確認)

| # | 決策 | 選擇 | 理由 |
|---|------|------|------|
| 1 | OSC 自動標題 vs 手動命名衝突 | **手動命名後鎖定(sticky)** | VS Code / iTerm 預設行為,最符合「自訂」期待 |
| 2 | 鎖定狀態如何存 | **方案 A:`title` + `titleLocked` flag** | 顯示邏輯零改動,一個 boolean 精準表達 sticky |
| 3 | rename 觸發方式 | **inline 雙擊 + 右鍵選單兩者都做** | 涵蓋習慣;沿用既有 context menu 與 `prompt()` 模式 |
| 4 | 範圍 | **cmd 分頁 + agent session 都做** | claude-code 常在 agent session |
| 5 | 後端同步 | **本次不做** | 目前 reload 不 rehydrate,後端 `name` 無讀者;留待恢復功能一起設計 |

## 詳細設計

### A. 資料模型(`v2-model.ts`)

`Tab`(現 `:57`)與 `AzWindow`(現 `:111`)各新增一欄:

```ts
titleLocked?: boolean   // true = 使用者手動命名,OSC 自動標題不得覆蓋
```

語意:`undefined`/`false` = 跟隨 OSC 自動標題;`true` = 已被使用者鎖定。

### B. OSC 自動標題 data flow

1. `TerminalTab.tsx` 新增 prop `onTitleChange?: (sessionId: string, title: string) => void`,以既有的 `onInputRef`/`onResizeRef` 同款 ref 模式,接 `terminal.onTitleChange(t => onTitleChangeRef.current?.(sessionId, t))`。
2. 渲染處傳入 controller 的 `applyOscTitle`:
   - `ContentViews.tsx:263`(cmd tab)
   - `AgentZone.tsx:158`(agent session)
3. controller 新增 `applyOscTitle(sessionId, rawTitle)`:
   - 先 `sanitizeTitle(rawTitle)`(見 D)。
   - 沿用 `markSessionExited`(`:670`)的 by-sessionId 遍歷,找到對應 tab/win。
   - **僅當 `!titleLocked` 且 sanitized title 非空**時,更新該 tab/win 的 `title`。

### C. 手動 rename data flow

兩個 controller action(透過 `patchProject` 改 state):

- `renameTerminalTab(tabId, nextTitle)`
- `renameAgentSession(winId, nextTitle)`

共同邏輯:
- `trimmed = nextTitle.trim()`
- **非空** → 設 `title = trimmed`、`titleLocked = true`
- **空字串** → 設 `titleLocked = false`(解鎖,還給 OSC 自動接管;`title` 維持當前值直到下一次 OSC 更新)

觸發點:

1. **右鍵選單**(`Overlays.tsx` `buildCtxItems`):
   - `case "tab"`(`:77`)加一項 `{ glyph: "✎", label: "Rename…", run: () => { const v = prompt("Rename terminal:", currentTitle); if (v != null) store.renameTerminalTab(id, v) } }`
   - `case "session"`(`:251`)同理呼叫 `renameAgentSession(winId, …)`
   - 註:`prompt` 回傳 `null`(取消)時不動作;回傳 `""`(清空)時走解鎖分支。
2. **inline 雙擊**:
   - `TabStrip.tsx`:`.title` span(`:53`)加 `onDoubleClick`,以 local `editingId` state 切換成 `<input>`;Enter/blur 提交、Esc 取消;`stopPropagation` 避免觸發 tab 的 `onClick`(activateTab)。
   - `AgentZone.tsx`:標題文字 `.tt`(`:117`)加 `onDoubleClick` 進 inline 編輯;`stopPropagation` 避免觸發 win-head 既有的 `onDoubleClick`(`:110`,azMax 最大化)。

### D. 邊界與錯誤處理

- `sanitizeTitle(raw)`:移除控制字元與換行(`\x00-\x1F`、`\x7F`),`trim`,長度上限 **120** 字元(超過截斷)。
- 空白 OSC title → 忽略,不更新。
- 已 `exited` 的 session 仍可 rename(純 UI 標籤,不碰 process)。
- 建立入口維持現有自動命名,`titleLocked` 預設不設(跟隨 OSC)。

## 受影響檔案

| 檔案 | 改動 |
|------|------|
| `src/v2/v2-model.ts` | `Tab`、`AzWindow` 各加 `titleLocked?: boolean` |
| `src/features/terminal/TerminalTab.tsx` | 加 `onTitleChange` prop + 接 xterm `onTitleChange` |
| `src/v2/controller.ts` | 新增 `applyOscTitle`、`renameTerminalTab`、`renameAgentSession`;`sanitizeTitle` helper |
| `src/v2/ContentViews.tsx` | `<TerminalTab>` 傳入 `onTitleChange` |
| `src/v2/AgentZone.tsx` | `<TerminalTab>` 傳入 `onTitleChange`;`.tt` 加雙擊 inline 編輯 |
| `src/v2/TabStrip.tsx` | `.title` 加雙擊 inline 編輯 |
| `src/v2/Overlays.tsx` | `case "tab"`、`case "session"` 各加「Rename…」 |
| `src/v2/v2-store.ts` | 暴露新 action(沿用既有整合方式) |

## 測試策略

- `v2-store.test.ts` / `v2-model.test.ts`:
  - `applyOscTitle`:`titleLocked` 為 true 時 title 不變;false/undefined 時更新。
  - `renameTerminalTab` / `renameAgentSession`:非空設 title+locked;空字串解鎖。
  - `sanitizeTitle`:去控制字元、截斷 120、空白忽略。
- `TerminalTab.test.ts`(已存在):驗證 `onTitleChange` 接線、`sessionId` 正確帶出。

## 範圍外 / 已知問題

- **後端 `name` 同步 + session rehydrate**:目前 `listTerminalSessions` 無前端呼叫端、v2 store 僅持久化 theme/settings(`v2-store.ts:491/500`)、後端 registry 純 in-memory。要支援恢復需另做 rehydrate 流程,屆時再決定名稱(含 `titleLocked`)如何存回後端。本設計的 `titleLocked` 模型可平滑延伸。
- **既有不一致(不在本次修)**:`azNew()` 傳後端的 `name`(`"agent session "+n`,`controller.ts:967`)與前端 `win.title`(`"zsh · session "+n`,`:972`)文案不一致。因後端 name 不參與顯示,不影響功能,僅記錄。
