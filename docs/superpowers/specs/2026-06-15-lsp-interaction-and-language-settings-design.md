# LSP 文件互動強化 + Language UI 搬入 Settings — 設計文件

> 🟡 **實作狀態:部分實作**(2026-06-15 核對)— 基礎 LSP(open/diagnostics/hover/definition API、gutter 診斷)已有;**缺**編輯器 hover 卡片、Ctrl/Cmd+click 跳定義與 reveal、Language UI 搬進 Settings、save-only diagnostics。對應 plan:`docs/superpowers/plans/2026-06-15-lsp-interaction-and-language-settings.md`

- 日期:2026-06-15
- 範圍:讓 LSP 與支援的文件互動以警示錯誤、並把 Language 管理 UI 從 SidePanel 搬進 Settings。對應 roadmap Node 6 / Node 14(Language Intelligence 在 v2 shell 的收尾)。
- 對應 plan:`/home/yuuzu/.claude/plans/zazzy-launching-lantern.md`(逐步執行版)。

---

## 1. 背景與現況

**關鍵發現:LSP 管線多數已接好,roadmap 描述已過時。** 本次的真正缺口比想像中小,且大半是前端 wiring,後端零改動。

既有(可重用):

- **Backend LSP 完整**(`src-tauri/src/lsp.rs` + commands):didOpen/didChange、pull-model diagnostics、hover、definition、references、rename 全數實作並註冊。`lsp_open_document` 重複呼叫會自動改送 `didChange`(後端測試 `duplicate_open_sends_did_change_instead_of_second_did_open`)。
- **前端 command wrapper 全備**(`src/features/language/language-api.ts`):`requestLanguageHover` / `requestLanguageDefinition` / `requestLanguageReferences` / `getDocumentDiagnostics` / `getLanguageServerStatus` 等皆已封裝。`requestLanguageHover` 已回傳正規化的 `LanguageHover | null`。
- **診斷管線已接三條**(`src/v2/controller.ts`):
  - 開檔:`openFile`(`controller.ts:802-804`)→ `openLspDocument` → 後端 lazy-start server + `pollDocDiag`。
  - 存檔:`saveFile`(`controller.ts:1029-1041`)→ 寫檔後 `openLspDocument` + `scheduleDocDiagPoll(200ms)`。
  - 打字:`setTabContent`(`v2-store.ts:1043`)real 分支 → `lspChange` → `scheduleLspChange`(400ms debounce)→ 重新診斷。
- **診斷已可視化於編輯器**:`EditableBody`(`ContentViews.tsx:73-113`)用 `diagLineSeverity` 在 gutter 畫診斷點、在 `.yz2-ed-hlline` 加 `has-error/has-warning`(`yuzu.css:1047-1050`,2px box-shadow 底線)。
- **go-to-definition 已存在**:`gotoDefinition`(`controller.ts:2212`)走 `requestLanguageDefinition` + `mapLspLocations`,目前由右鍵 context menu 觸發(`Overlays.tsx:124`)。
- **Language 面板**:`SidePanel.tsx` 的 `LanguageBody`(`429-520`)渲染 servers / diagnostics / logs,由活動列 `id:"lang"`(`SidePanel.tsx:40`)+ `selectFn("lang")→ensureLang`(`controller.ts:743`)驅動。

缺口(本次要補):

1. **診斷時機與「存檔才檢查」不符**:目前打字即時(400ms)就重新診斷;使用者要的是**只在存檔時**。
2. **錯誤訊息看不到**:編輯器只有 2px 底線,要看訊息得開 Language 面板。使用者要「警示哪些內容有誤」→ 需要 **hover 顯示診斷訊息**。
3. **go-to-definition 不捲到目標行**:`openFile` 無行內定位能力,跳轉後停在檔頭。
4. **hover 完全沒有 editor consumer**:型別/文件提示無從觸發。
5. **Language UI 位置**:使用者要整段搬進 Settings、SidePanel 移除。

---

## 2. 目標與範圍

### In scope（使用者三項決定）

1. **診斷只在存檔時刷新**(「存檔時才檢查」)— 移除打字即時診斷,保留開檔 + 存檔診斷。
2. **整個 Language 面板搬進 Settings**,SidePanel 移除 Language 活動。
3. **editor hover**(診斷訊息 + LSP 型別資訊)與 **Ctrl/Cmd+click go-to-definition + 行內定位**。

### Out of scope（YAGNI）

- 打字即時(on-type)診斷 — 明確移除,與決定 1 相反。
- 細粒度 inline squiggle(逐 token 波浪底線);沿用現有整行 box-shadow。
- hover 卡片的 Markdown 渲染 — 純文字 `<pre>` 呈現即可(LSP hover contents 多為型別簽名)。
- references / rename 的 UI 改動 — 維持現狀(references 已有 `ReferencesOverlay`,rename 已有 confirm 流程)。
- FnMode `"lang"` 的型別移除 — 保留(被既有測試引用,移除徒增破壞面)。
- 未存檔內容的即時 LSP 同步 — 見 §8 取捨(hover/definition 反映最後存檔內容)。

---

## 3. 架構總覽

沿用既有 v2 dual-mode 分層,不引入新模式:

```
React (ContentViews EditableBody / Overlays LanguageSection)
      │  呼叫 store action
      ▼
v2-store.ts (V2State actions + RealDelegate interface)
      │  real → 轉派 realDelegate;demo → 就地處理 / 回 null
      ▼
controller.ts (RealDelegate 實作:openFile/saveFile/gotoDefinition/hoverAt…)
      │  呼叫 feature api
      ▼
features/language/language-api.ts (call 封裝) → Tauri lsp_* command
```

- **新資料流(hover)**:editor mousemove → `hoverAt(path,line,col)`(回傳 Promise)→ real delegate `requestLanguageHover` → 卡片本地 state。
- **新資料流(reveal)**:`gotoDefinition` → `openFile(path, {line,col})` → tab 帶 `reveal` 欄位 → `EditableBody` effect 在內容載入後捲動定位 → `clearReveal`。
- demo mode:hover 回 `null`、gotoDefinition 顯示 toast,維持「not connected」語義。

---

## 4. 後端改動

**零。** 所有 `lsp_*` command(hover / definition / diagnostics / server status / restart)皆已實作並註冊。本次純前端 wiring。

---

## 5. 設計決策（核心）

### D1. 「存檔才檢查」= 移除打字即時診斷的單一觸發點

- `setTabContent` real 分支(`v2-store.ts:1041-1044`)移除 `realDelegate?.lspChange(tabId)` 一行,保留 `backupTab`(未存檔備份不受影響)。
- 開檔診斷(`openFile`)與存檔診斷(`saveFile`)**已存在,不動**。
- **保留** `lspChange` store action / `scheduleLspChange` / `lspChangeTimers` —— 仍是公開 API 且被 `v2-store.test.ts:127` 引用,屬「非孤兒」,僅不再自動觸發。最小破壞面。
- 替代方案(否決):拆 `openLspDocument` 成「sync-only」與「poll-only」以保打字即時同步但只在存檔顯示診斷 → 增複雜度且違背決定 1,YAGNI。

### D2. hover 卡片 = 本地診斷訊息 + LSP hover,二者並陳

- 「警示哪些內容有誤」的真正痛點是**看不到訊息**,而非沒有診斷。卡片上半段直接從已在 state 的 `diagnostics`(該行 range 命中者)取訊息,**不需 LSP round-trip、即時顯示**;下半段補 `requestLanguageHover` 的型別/文件(非同步)。
- hover state 放 `EditableBody` **本地 `useState`**(短暫 UI,綁定編輯器),不污染 store;LSP 查詢經新增的 `hoverAt` store action 取得結果回填。
- 觸發:滑鼠停留 ~320ms(debounce)+ `hoverSeq` 防過期結果;`onMouseLeave` / 打字即關閉。
- 替代方案(否決):store 級 hover state + Overlays 浮層 → 過度集中化,徒增 store 表面積。

### D3. reveal 機制 = tab 欄位 + 內容載入後 effect 定位

- `gotoDefinition` 開檔是非同步(讀檔→設 content),imperative 捲動會早於內容掛載。故用 **tab 上的 `reveal?:{line,col}` 欄位**:`openFile` 設定 → `EditableBody` effect 待 `content` 就緒後設 caret + 捲動 → `clearReveal` 清除(避免重觸發)。
- 同檔(定義在當前檔)與跨檔(開新分頁)都由同一 effect 覆蓋(deps 含 `content` + `tab.reveal`)。
- `clearReveal` 為**純 UI mutation**(兩模式共用,不進 RealDelegate),比照 `markExternalFileChange` 直接改 tab。
- **座標換算依據(已驗證 CSS)**:`.yz2-ed-input` padding `left=0/top=0`(`yuzu.css:1057`);行高**固定 21px**、不隨 fontSize 變(`yuzu.css:1067` 硬寫);scroll 容器為 `.yz2-ed-body`、padding-top 10px(`yuzu.css:989`)。
  - line = `floor((clientY − areaRect.top) / 21) + 1`
  - col = `floor((clientX − areaRect.left) / charWidth) + 1`,`charWidth` 用 canvas `measureText("M")` 量測(隨 fontSize 變,故讀 computed font;line-height 固定不需量)。
  - 捲動置中:`body.scrollTop = max(0, 10 + (line−1)*21 − body.clientHeight/2)`。

### D4. Ctrl/Cmd+click 觸發 go-to-definition

- 瀏覽器(Chromium/WebView2)在 `click` 前已由 `mousedown` 把 caret 移到點擊處,故 `onClick` 內 `cursorFrom(textarea)`(`ContentViews.tsx:16-20`,讀 `selectionStart`)即得點擊 (line,col),無需自行像素換算。
- 只在 `isLspSupportedDocumentPath` 為真時觸發,避免 .md/.txt 出現「No definition found」toast。
- 右鍵 context menu 的 go-to-definition(`Overlays.tsx:124`)維持不動 → 兩入口並存。

### D5. 面板搬遷 = Settings custom section,沿用既有 class

- Settings 已是資料驅動 + `custom` renderer dispatch(`Overlays.tsx:573-579`,現有 performance/diagnostics/recovery)。新增 `custom:"language"` 與 `LanguageSection`,**直接沿用 `LanguageBody` 的 JSX 與 `.yz2-lang-*` 樣式** → 零新樣式、零後端、零 store 結構變動。
- **server 啟動不受影響**:已驗證 server 在開檔時即由 `openFile→openLspDocument` lazy-start(`controller.ts:802`),不依賴 Language 面板。原 `selectFn("lang")→ensureLang` 僅負責「載入 server 清單 / logs / workspace 診斷」,改由 `LanguageSection` 掛載時 `if(!lspLoaded) reloadLang()` 接手。
- 診斷項點擊由「只開檔」升級為「開檔 + 定位該行 + 關閉 Settings」(複用 D3 的 reveal)。

---

## 6. 前端改動細節

### (a) `src/v2/v2-model.ts`
- `Tab` type 加 `reveal?: { line: number; col: number }`。
- `SettingSection.custom` union 加 `"language"`;`SETTINGS_CONFIG` 插入 `{ id:"language", label:"Language Servers", glyph:"◇", desc:"…", rows:[], custom:"language" }`(label 用「Language Servers」以區隔 general 既有的顯示語言列)。

### (b) `src/v2/v2-store.ts`
- **兩個介面都要改(位置不同,勿混淆)**:`RealDelegate`(`v2-store.ts:53-130`,`openFile`@59、`lspChange`@129)與 `V2State` actions 介面(`~302-466`,`openFile`@341)。
  - `openFile` 簽章**兩處**都加可選 `reveal?:{line,col}`。
  - `hoverAt(path,line,col):Promise<LanguageHover|null>` **兩處**都新增(放 `gotoDefinition` 旁)。
  - `clearReveal(tabId)` **只加 V2State actions 介面**(UI-only,不進 `RealDelegate`)。
- impl:`openFile` threading reveal;`hoverAt` real 轉派、demo 回 `null`;`clearReveal` 純 mutation(`p.tabs.map` 產生新 reference);`setTabContent` 移除 `lspChange`(D1)。
- import `LanguageHover` 型別。

### (c) `src/v2/controller.ts`
- `openFile(displayPath, reveal?)`:existing 與 new 兩分支都把 `reveal` 寫到對應 tab。
- 新增 `hoverAt` delegate:`cursorToLsp` + `requestLanguageHover`(支援檔才查,否則回 null)。
- `gotoDefinition`:`store().openFile(locs[0].path, { line:locs[0].line, col:locs[0].col })`。
- import `requestLanguageHover` + `LanguageHover`。

### (d) `src/v2/ContentViews.tsx`(`EditableBody`)
- import 調整:`useEffect/useRef/useState`、`normSeverity`、`isLspSupportedDocumentPath`。
- 模組層 `measureCharWidth(el)`(canvas 量測 + 快取)。
- textarea 加 `ref`、`onMouseMove`(hover debounce)、`onMouseLeave`(關卡片)、`onClick`(Ctrl/Cmd→`gotoDefinition`);`onChange` 開頭關卡片。
- reveal `useEffect`(待 content 就緒 → 設 caret + 捲動 → `clearReveal`)。
- hover 卡片 JSX(診斷列 + `<pre>` hover doc)。

### (e) `src/v2/Overlays.tsx`
- 新增 `LanguageSection`(沿用 `LanguageBody` JSX;掛載 `if(!lspLoaded) reloadLang()`;診斷點擊 `openFile(path,{line,col})` + `closeSettings`)。
- custom dispatch 加 `cur.custom==="language"` 分支。
- 從 `SidePanel.tsx` 移入 `memoryLabel` helper;import 補 `normSeverity` / `useEffect`。

### (f) `src/v2/SidePanel.tsx`
- 刪 `LanguageBody`、活動列 `id:"lang"`、body switch 的 lang 分支、孤立的 `langBadge` / `diagnosticsByPath` selector / `memoryLabel`;import 移除 `diagBadge` / `normSeverity`。
- 保留 `FnMode "lang"` 與 `controller.ts:743`(被測試引用,無害)。

### (g) `src/v2/yuzu.css`
- 新增 `.yz2-ed-hover` / `.yz2-ed-hover-diag` / `.yz2-ed-hover-doc`(風格對齊既有 `.yz2-refs` 浮層)。
- Language section 沿用既有 `.yz2-lang-*`,**無新樣式**(modal 內若需微調再局部處理)。

---

## 7. 資料流

- **存檔診斷**:打字(僅更新內容 + 備份,不診斷)→ ⌘/Ctrl+S → `saveFile` 寫檔 → `openLspDocument` + `pollDocDiag` → `diagnosticsByPath` 更新 → 錯誤行底線 + gutter 點。
- **hover**:停留 320ms → 取該行診斷(本地即時)+ `hoverAt`(LSP 非同步)→ 卡片並陳。
- **go-to-definition**:Ctrl/Cmd+click → caret 取 (line,col) → `gotoDefinition` → `requestLanguageDefinition` → `openFile(path,{line,col})` → reveal effect 捲動定位。
- **面板**:Settings → Language Servers 分頁掛載 → `reloadLang` 載入 servers/logs/workspace 診斷;⟳ Refresh / ↻ Restart 同舊;診斷點擊 → 開檔定位 + 關 Settings。

---

## 8. 取捨與風險

- **(阻斷,須同步)既有測試斷言**:移除 `setTabContent` 的 `lspChange` 後,`v2-store.test.ts:147` 的 `["change", tabId]` 斷言必失敗 → `bun test` 紅燈。必須在同一變更刪除該斷言(見 §9)。
- **hover/go-to-definition 反映「最後存檔內容」**(D1 的直接後果):server 文件只在開檔 + 存檔同步,未存檔編輯的位置可能略偏。與「存檔才檢查」語義一致;使用者存檔即一致。可接受,列入驗證說明。
- **移除 SidePanel「lang」後的 server 啟動**:已驗證開檔即 lazy-start(`controller.ts:802`),不依賴面板;workspace 整體診斷改於進入 Settings→Language Servers 時載入。風險低。
- **hover 像素換算**:依賴 `getBoundingClientRect` + canvas 量測,jsdom/happy-dom 測試環境回 0 → 不寫脆弱單測,改列手動驗證。
- **測試遷移**:`SidePanel.test.tsx` 有**三個** language 測試(`:47、56、130`)render `LanguageBody`,須全部移除,等量覆蓋移到 `Overlays.test.tsx`。註:該檔 full-suite 另有 6 個既存 `meta.name` 失敗,與本次無關。
- **charWidth 隨 fontSize 變**:讀 computed font 量測並以 `fontSize|fontFamily` 為快取 key;line-height 固定 21px 不需量。

---

## 9. 測試策略

沿用既有風格(前端 happy-dom + `@testing-library/react`)。

- `v2-store.test.ts`:**必修既有測試** —— `test("real language actions delegate and editor changes notify LSP")`(118-149)的 `expect(calls).toEqual([...])` 含 `["change", tabId]`(**line 147**);移除 `setTabContent` 的 `lspChange` 後此斷言必失敗,須**刪該行**(保留 `["backup", …]`,反映「打字只備份不診斷」)。另補 `hoverAt`/`clearReveal` 的 demo 行為與 delegate 轉派、`openFile` 帶 reveal 仍轉派。
- `Overlays.test.tsx`:`LanguageSection` 渲染 servers/diagnostics、`reloadLang`/`restartLspServer` 有接、診斷點擊 → `openFile(path,{line,col})` + `closeSettings`。
- `SidePanel.test.tsx`:移除**三個** language 測試(`:47、56、130`,皆 render `LanguageBody`)。
- `ContentViews.test.tsx`:Ctrl/Cmd+click → `gotoDefinition` —— `EditableBody` 未 export,須 render `EditorView` + 設 `textarea.selectionStart` + `fireEvent.click(…,{ctrlKey:true})`(比照 `ContentViews.test.tsx:114-118`);hover/reveal 像素行為列手動驗證。
- 型別:`bunx tsc --noEmit` 綠燈。

驗收標準:real mode 開啟含 `.rs`/`.ts` 的 workspace → 打字不診斷、存檔後錯誤行底線 + gutter 點;hover 錯誤行見訊息、hover 識別字見型別;Ctrl/Cmd+click 跳定義並捲到該行;SidePanel 無 Language 圖示,Settings→Language Servers 可管理且診斷點擊能開檔定位。

---

## 10. 變更檔案清單（預估）

修改:

- `src/v2/v2-model.ts`（`Tab.reveal`、`SettingSection.custom`、`SETTINGS_CONFIG`）
- `src/v2/v2-store.ts`（`openFile` reveal、`hoverAt`、`clearReveal`、移除 `lspChange` 觸發）
- `src/v2/controller.ts`（`openFile` reveal、`hoverAt` delegate、`gotoDefinition` 定位、import hover）
- `src/v2/ContentViews.tsx`（hover 卡片、Ctrl/Cmd+click、reveal effect、charWidth）
- `src/v2/Overlays.tsx`（`LanguageSection` + dispatch + `memoryLabel`）
- `src/v2/SidePanel.tsx`（移除 `LanguageBody` 與相關孤兒）
- `src/v2/yuzu.css`（`.yz2-ed-hover-*`）
- 測試:`v2-store.test.ts` / `Overlays.test.tsx` / `SidePanel.test.tsx`（/ 視情況 `ContentViews.test.tsx`）

新增:無新原始檔(全為既有檔案內的增修)。

後端:零改動。
