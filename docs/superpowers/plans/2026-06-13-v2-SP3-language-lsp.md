# SP3 Language LSP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把後端既有 LSP 能力接進 v2 editor 與 Language 面板，先交付 diagnostics、definition、references、rename 與文件生命週期。

**Architecture:** LSP pure transforms live in `bridge.ts` and `v2-model.ts`; store actions stay demo-safe and delegate real work through RealDelegate; controller owns Tauri language-api calls, debounce timers, diagnostics refresh, and rename file writes. Hover/completion remain an explicit owner gate because textarea pixel-to-character anchoring is a separate editor decision.

**Tech Stack:** React TSX、Bun test、Tauri language wrappers、`src/features/language/*`、`src/v2/ContentViews.tsx`、`src/v2/SidePanel.tsx`、`src/v2/Overlays.tsx`。

---

> 子計劃 · 2026-06-13 · 規模:11 tasks(階段1必做 T1-T10 共 10 個 + 階段2待 owner 拍板 T11),相對工作量 L。純函式/型別 T1-T6 為 S-M(高度可測、低風險、可獨立綠,含 mustFix-1 大小寫正規化測試);controller 接線 T7 為 M(無單測,靠 tsc 硬 gate + mock-IPC key 對齊斷言 + native;含單檔 wrapper 新增、debounce timer Map、rename 落盤);UI T8-T10 為 M(移植 v1 LanguagePanel + diagnostics overlay + references 浮層 + cursor 擷取修正);T11 為 M-L(字元級定位風險高,owner 拍板前不計入主交付)。後端零改動(14 指令全 ready),前端語言層唯一新增是 language-api 一個 thin wrapper getDocumentDiagnostics。

**相依:**

- SP1:ide-logger(軟相依,非阻塞):LSP 事件(gotoDefinition/findReferences/renameSymbol/openFile 觸發的 fire-and-forget 動作)可掛 SP1 的 logDiag helper 埋點;SP1 未完成時 LSP 接線仍可獨立交付,只是少了 diagnostic event 埋點

**摘要:** 把後端 14 個 lsp_* 指令(全部 completed)接進 v2 Yuzu shell。核心工程決策:v2 編輯器維持「textarea 疊高亮層」不升級 Monaco,分階段路線——階段 1(本子計劃主體,必做)接「只需行級定位 + 面板/浮層」的高 CP 值能力:LSP 文件生命週期(didOpen/didChange/didClose)、diagnostics(行級底線 + gutter 圓點 + Language 面板)、go-to-definition、find references、rename;階段 2 是 hover/completion——這兩項後端與 language-api wrapper 全 ready,且明列在使用者焦點內,但在 textarea 上需「字元級像素定位」(mousemove 像素→{line,character} 估算),tab/全形字座標脆弱,故獨立成 T11 並【明確標記為與焦點的偏差,待 owner 拍板】是否現在做、用 textarea 自製浮層或接回 Monaco EditorTab。產出:新 FnMode 'lang' + LanguagePanelV2、diagnostics gutter 圓點 + 行底波浪 overlay、references 浮層、rename 流程(WorkspaceEdit 攤平 + applyTextEdits 純函式套用器 + ConfirmModal 受影響檔數確認)、controller LSP delegate(事件驅動 diagnostics:優先用單檔 lsp_document_diagnostics)、bridge 的 LSP 純函式映射層。嚴格照 store action(mode==="real" 時 realDelegate?.xxx())→ RealDelegate 型別 → controller.ts delegate 物件(registerRealDelegate 注入)→ features/language/language-api 既有 14 wrapper(免改)分層,store 絕不 import controller,demo 模式全 fallback 空資料/toast,瀏覽器不呼叫。三項硬修正已驗證納入:(1) severity 後端是大寫 'Error'/'Warning'/'Information'/'Hint'(lsp.rs:371-378 已驗,v1 比小寫是既有 bug),純函式內先正規化大小寫;(2) 右鍵時 textarea onBlur 已把 cursor 設 null(ContentViews.tsx:104),須在 onContextMenu 當下擷取 selectionStart 帶進 ctx,不可依賴 store.cursor;(3) diagnostics 入站 key(後端 relative_path)須與 v2 tab.path(displayPath)同源,加 mock-IPC 對齊斷言,否則行底線/gutter 永遠空。

---

## 目標

把後端已 100% ready 的 LSP 能力接進 v2 編輯器與側欄,讓使用者在 real 模式編輯支援語言檔(.ts/.tsx/.js/.jsx/.mjs/.cjs/.rs/.py/.pyi 等,白名單見 `isLspSupportedDocumentPath`)時能看到 diagnostics、跳轉定義、找引用、重新命名;並提供 Language servers 面板(server 狀態 + 診斷清單 + logs + restart)。維持 v2「textarea 疊高亮」輕量架構,不引入 Monaco。

### 範圍邊界與【與使用者焦點的偏差,待 owner 拍板】

使用者焦點明列六項要「接進 v2 編輯器」:diagnostics / hover / completion / definition / references / rename。本計劃分階段:

- **階段 1(本子計劃主體,T1–T10,必做)**:diagnostics、definition、references、rename + LSP 文件生命週期。全程只需「行級定位」與「面板/浮層」,不需編輯器內字元級像素定位。
- **階段 2(T11,hover + completion)**:後端 `lsp_hover`(commands.rs:2466)、`lsp_completion`(commands.rs:2519)與 `requestLanguageHover`/`requestLanguageCompletion`(language-api.ts:39,69)**全部 ready**,且 hover/completion 明列在使用者焦點內。但在 textarea 上實作需「mousemove 像素座標 → {line,character} 估算」與「游標處錨定浮層」,等寬字 + tab + 全形字會讓像素→字元估算偏移。**這是對焦點的縮減(等同砍掉 1/3),屬工程取捨而非完整覆蓋,須由 owner 拍板**三選一:(a) 現在用 textarea 自製浮層做(接受 tab/全形字 known limitation);(b) 延後;(c) 為 hover/completion 接回 v1 Monaco `EditorTab.tsx`(LSP 接線完整但體積大、與 v2 輕量定位相衝)。T11 在 owner 決定前**不開工**,計劃其餘部分可獨立交付。

**不接(明示非目標,可接受)**:code_actions / workspace symbols 的 UI 觸發點。但 rename 會建好通用 `flattenWorkspaceEdit` + `applyTextEdits`,未來接 code_actions 只差觸發點(此說法經驗證正確:`normalizeLspCodeActionList` 內部就是呼叫 `normalizeLspWorkspaceEdit`)。

## File Structure

- Modify: `src/features/language/language-api.ts` — add one thin wrapper for `lsp_document_diagnostics`.
- Modify: `src/v2/v2-model.ts` — add `lang` FnMode, LSP state fields, severity helpers, and diagnostic line helper.
- Modify: `src/v2/bridge.ts` — add cursor/URI/location/diagnostics/workspace-edit/text-edit pure helpers.
- Modify: `src/v2/v2-store.ts` — add LSP RealDelegate methods and demo-safe store actions.
- Modify: `src/v2/controller.ts` — implement LSP real delegate, didOpen/didChange/didClose, diagnostics refresh, references, definition, rename, and language reload.
- Modify: `src/v2/SidePanel.tsx` — add `lang` fn row and Language panel body.
- Modify: `src/v2/ContentViews.tsx` — add diagnostics gutter/underline and editor context cursor capture.
- Modify: `src/v2/Overlays.tsx` — add editor context actions and References overlay.
- Modify: `src/v2/yuzu.css` — add `yz2-lang-*`, diagnostics, and references overlay styles.
- Test: `src/v2/bridge.test.ts`, `src/v2/v2-model.test.ts`, `src/v2/v2-store.test.ts`.

## 既有資產盤點(已逐一驗證,避免重造/錯引)

- `src/features/language/language-api.ts`:14 個 wrapper 全在,**含** `requestLanguageHover/requestLanguageCompletion/requestLanguageCodeActions`。簽名皆 `{ workspaceId, workspaceRoot, path, line, character, ... }`,`call()` 自動轉 camelCase invoke。免改。
- `src/features/language/language-model.ts`:`lspDocumentPathForWorkspace(root, path)`(剝 root 前綴 + 反斜線正規化,line 77)、`isLspSupportedDocumentPath(path)`(白名單副檔名,line 124)、型別 `LspRange`/`LspDiagnostic`/`LanguageServerStatus`/`LanguageHover`。**注意**:`LspDiagnostic.severity` 型別標 `"error"|"warning"|...`(小寫)但與後端實際大寫值不符(見 mustFix-1);`severityToMonacoMarker`/`selectDiagnosticBadge` 比小寫,對真實後端輸出是 dead/buggy,**不可直接複用其大小寫假設**。
- `src/features/language/LanguagePanel.tsx`(v1,still exists):三段式(servers / diagnostics / logs)可作 LanguageBodyV2 移植範本;但用 lucide-react 圖示 + `badge2`/`row` class + `severityBadgeClass` 比小寫——移植時全改 yz2-* + 字元圖示 + 大小寫正規化。
- `src/features/editor/EditorTab.tsx:323` `normalizeLspWorkspaceEdit<TUri>(value, uriFactory)`(**still exists,未刪**):處理 `changes` 物件形 + `documentChanges` 陣列形的標準演算法,作為 `flattenWorkspaceEdit` 的移植範本(去 Monaco UriFactory、改吐中性結構)。
- 後端 `relative_path_from_uri`(lsp.rs:328):`strip_prefix("file://")` → percent-decode → `strip_prefix(workspace_root)`。對 `file:///root/src/a.ts` 剝 `file://` 得 `/root/src/a.ts`,decode,剝 root `/root` → `src/a.ts`;root 外回 None。bridge 的 `relativePathFromUri` 須位元對齊此行為(含 `%20`→空格、triple-slash 的首 `/` 是絕對路徑根、root 外回 null,均有 lsp.rs:3465-3481 測試為證)。
- 後端 `parse_diagnostic_severity`(lsp.rs:371-378):序列化大寫字串 `"Error"/"Warning"/"Information"/"Hint"/"Unknown"`(lsp.rs:2448 測試 fixture `severity: "Error"` 為證)。
- 後端**有單檔診斷指令** `lsp_document_diagnostics`(commands.rs:2438)與全工作區 `lsp_workspace_diagnostics`(commands.rs:2453)。**本計劃改採事件驅動優先用單檔版**(見 C 段),只在 ensureLang 進面板時用全工作區版補全清單。

## 架構與接線點(具體到層)

照專案鐵則三層:**store action(mode==="real" 時 `realDelegate?.xxx()`,demo fallback)→ controller.ts 的 `delegate` 物件實作 async 接線(僅 Tauri)→ 呼叫 language-api 既有 wrapper(免改)**。store 絕不 import controller(會循環)。無 I/O 的轉換邏輯一律下沉 bridge.ts / v2-model.ts(可測)。

### A. v2-model.ts(型別 + FnMode + 可測純函式)
- `FnMode`(line 5):`"files" | "git" | "db" | "ssh" | "agent" | "lang"`。
- `ProjectUI`(line 161)新增 LSP 欄位:
  - `diagnosticsByPath: Record<string, LspDiagnostic[]>`(key = displayPath,須與 tab.path 同源)
  - `lspServers: LanguageServerStatus[]`
  - `lspLogs: string[]`
  - `lspRefs: { path: string; line: number; col: number; preview: string }[] | null`(references 浮層,null=未開)
  - `lspLoaded: boolean`(對齊 treeLoaded/gitLoaded 慣例)
- 型別來源:`import type { LspDiagnostic, LspRange, LanguageServerStatus } from "../features/language/language-model"`(v2-model 現未 import features,新增 `import type` 不引入執行期相依,安全)。
- 純函式(severity 一律先正規化大小寫):
  - `normSeverity(s: string): "error" | "warning" | "info" | "hint"`:`toLowerCase()` 後 map(`"error"→error`、`"warning"→warning`、`"information"/"info"→info`、其餘含 `"hint"`/未知 →hint)。**集中處理 mustFix-1**,所有 severity 比對都過這函式。
  - `diagBadge(map: Record<string, LspDiagnostic[]>): string | null`:攤平計數,>0 回字串否則 null(給 fn rail badge)。
  - `diagLineSeverity(diags: LspDiagnostic[]): Map<number, "error" | "warning" | "info" | "hint">`:每行(`range.start_line + 1`,0-based→1-based)取最嚴重(error>warning>info>hint),severity 經 `normSeverity`。給 EditableBody gutter/底線。

### B. bridge.ts(純函式映射層,全部可測;對齊既有 mapXxx 命名/測試風格)
- `cursorToLsp(cur: { ln: number; col: number }): { line: number; character: number }` → `{ line: cur.ln - 1, character: Math.max(0, cur.col - 1) }`(1-based→0-based)。**註**:`cursorFrom`(ContentViews.tsx:12-15)的 `col = upTo.length - lastBreak`,其中 `upTo.length` 本就是 JS 字串 UTF-16 code unit 計數,與 LSP `character`(同為 UTF-16 code unit)語意一致——故 definition/references 的 column 對含 CJK 的檔**是正確的**(修正 gaps-4 的錯誤框定:UTF-16 偏移只在 T11 hover 的「像素→字元估算」才發生,definition/references 不受影響)。**可測**。
- `lspRangeToCursor(r: LspRange): { ln: number; col: number }` → `{ ln: r.start_line + 1, col: r.start_character + 1 }`(0-based→1-based)。**可測**。
- `relativePathFromUri(root: string, uri: string): string | null`:剝 `file://`(2 斜線)→ percent-decode(至少 `%20`→空格,用 `decodeURIComponent` 並 try/catch)→ root 尾斜線正規化後剝 `root + "/"` 前綴 → 回相對路徑(`/` 分隔);root 外回 null。**位元對齊後端 `relative_path_from_uri`**。**可測**(fixture:`("/root","file:///root/src/a.ts")→"src/a.ts"`、含 `%20`、root 外 null、`file:///root`(等於 root,後端回 None)→ null)。
- `mapLspLocations(value: unknown, root: string): { path: string; line: number; col: number }[]`:把 `lsp_definition`/`lsp_references` 回傳攤平。支援:陣列、單物件、Location(`uri`+`range`)、LocationLink(`targetUri`+`targetSelectionRange`,後備 `targetRange`);`uri`→`relativePathFromUri`,null 則跳過;range 經 `lspRangeToCursor`。**可測**。
- `mapLspDiagnostics(diags: LspDiagnostic[]): Record<string, LspDiagnostic[]>`:依 `diagnostic.path` 分組(後端 path 已是相對 root,即 displayPath 同源)。對齊 language-model `replaceDiagnostics` 分組但回 map。**可測**。
- `flattenWorkspaceEdit(value: unknown, root: string): { path: string; edits: { range: LspRange; newText: string }[] }[]`:攤平 WorkspaceEdit 的 `changes`(物件:uri→TextEdit[])與 `documentChanges`(陣列:`{textDocument:{uri}, edits:[...]}`),uri→`relativePathFromUri` 反解,同 path 合併。移植 `EditorTab.normalizeLspWorkspaceEdit` 演算法去 Monaco 化、range 保留 LSP 0-based 結構(給 applyTextEdits 用)。**可測**(物件形 + 陣列形 + 壞 uri 跳過)。
- `applyTextEdits(content: string, edits: { range: LspRange; newText: string }[]): string`:把一組 LSP TextEdit 套到純字串。演算法:先把每個 range 的 `{line,character}` 換成字串 offset(用換行切分定位),依**起始 offset 由大到小排序後逐一 splice**(由後往前避免位移)。**rename 落盤核心,必須可單測**。**可測**(`("foo bar foo", [第1個foo→"X", 第2個foo→"Y"])→"X bar Y"`;多行 range→offset 換算一筆;range 重疊不在測試範圍——LSP 保證同檔 edits 不重疊)。

### C. controller.ts(real async 接線)
- **import**:`from "../features/language/language-api"` 取 `getLanguageServerStatus, openLanguageDocument, closeLanguageDocument, getDocumentDiagnostics(若 api 未匯出單檔版則用 call 直呼 "lsp_document_diagnostics"——見下), getWorkspaceDiagnostics, requestLanguageDefinition, requestLanguageReferences, requestLanguageRename, restartLanguageServer, getLanguageServerLogs`;`from "../features/language/language-model"` 取 `lspDocumentPathForWorkspace, isLspSupportedDocumentPath`;新 bridge 純函式。
  - **單檔診斷 wrapper**:language-api.ts 目前**只匯出 workspace 版**(`getWorkspaceDiagnostics`),沒有單檔版 wrapper。**處理 missedBackend-1**:在 language-api.ts 新增一個 thin wrapper `getDocumentDiagnostics(args: { workspaceId; workspaceRoot; path }): Promise<LspDiagnostic[]> { return call("lsp_document_diagnostics", args) }`(這是對 features 的最小新增,非改既有;與其他 wrapper 同風格),controller 用它做事件驅動單檔撈。
- **diagnostics 撈取策略(事件驅動,單檔優先)**:
  - `async function pollDocDiag(pid: string, displayPath: string)`:`const root = rootOf(pid); if (!root) return; try { const diags = await getDocumentDiagnostics({ workspaceId: pid, workspaceRoot: root, path: lspDocumentPathForWorkspace(root, displayPath) }); patchProject(pid, p => { p.diagnosticsByPath = { ...p.diagnosticsByPath, [displayPath]: mapLspDiagnostics(diags)[lspDocumentPathForWorkspace(root, displayPath)] ?? diags } }) } catch {}`。**關鍵對齊(mustFix-4 / gaps-3)**:寫入 key 用 `displayPath`(= v2 tab.path),不用後端反解的 path,確保 EditableBody 用 `diagnosticsByPath[tab.path]` 必能命中;同時 `mapLspDiagnostics` 內 `diagnostic.path` 應等於 `lspDocumentPathForWorkspace(root, displayPath)`,mock-IPC 須斷言此相等。
  - `async function pollWorkspaceDiag(pid: string)`:進 'lang' 面板時用,`getWorkspaceDiagnostics` → `patchProject(p => p.diagnosticsByPath = mapLspDiagnostics(diags))`(整批替換,供 Language 面板清單)。
  - **不開常駐 interval**(避免 StrictMode 雙呼 + CPU);後端 request-driven,publishDiagnostics 每次 request 被 drain,故每次 didOpen/didChange/存檔後撈一次即可。可選:存檔後 `setTimeout(() => pollDocDiag(pid, path), 200)` 補刀緩解 server 處理延遲(風險 3)。
- **文件生命週期(內聯既有方法)**:
  - `delegate.openFile`(controller.ts:357)讀檔成功的 then 內(line 380 patchProject 後):若 `isLspSupportedDocumentPath(displayPath)`,fire-and-forget `openLanguageDocument({ workspaceId: pid, workspaceRoot: root, path: lspDocumentPathForWorkspace(root, displayPath), content: read.content }).then(() => pollDocDiag(pid, displayPath)).catch(() => {})`。
  - `delegate.lspChange(tabId)`(新):由 store `setTabContent` 末尾在 real 模式呼叫。controller 內對該 tab 的 displayPath + 最新 content 做 **debounce(~400ms)**:debounce timer 存模組級 `const lspChangeTimers = new Map<number, ReturnType<typeof setTimeout>>()`;到期後 `openLanguageDocument({...content})`(後端同檔重開自動轉 didChange)→ `pollDocDiag(pid, displayPath)`。
  - `delegate.closeTab`(controller.ts:418)既有清理後追加:若 `tab.type === "file"` 且 `isLspSupportedDocumentPath(tab.path)`,fire-and-forget `closeLanguageDocument({...})`;清該 path 的 diagnostics(`patchProject(p => { const m = { ...p.diagnosticsByPath }; delete m[tab.path]; p.diagnosticsByPath = m })`);清 `lspChangeTimers.get(tab.id)`(`clearTimeout` + delete)。**race 防護(風險 4)**:所有 patchProject 帶明確 pid(非依賴當下 active),debounce 到期前先確認 tab 仍存在。
  - `delegate.saveFile`(controller.ts:588)寫檔成功後追加:若支援語言,`openLanguageDocument({...savedContent})`(同步最新內容當 didChange)→ `pollDocDiag` + 200ms 補撈。
- **`ensureLang(pid)`**(對齊 ensureTree/ensureGit):`const root = rootOf(pid); if (!root || store().ui[pid]?.lspLoaded) return; try { const [servers, logs] = await Promise.all([getLanguageServerStatus(root), getLanguageServerLogs({ workspaceId: pid, workspaceRoot: root })]); patchProject(pid, p => { p.lspServers = servers; p.lspLogs = logs; p.lspLoaded = true }); void pollWorkspaceDiag(pid) } catch (e) { store().showToast("Language: " + errMsg(e)) }`。`delegate.selectFn`(controller.ts:332)加 `if (fn === "lang") void ensureLang(pid)`。
- **`delegate.gotoDefinition(path, ln, col)`**:`const root = rootOf(pid); if (!root) return; const { line, character } = cursorToLsp({ ln, col }); try { const res = await requestLanguageDefinition({ workspaceId: pid, workspaceRoot: root, path: lspDocumentPathForWorkspace(root, path), line, character }); const locs = mapLspLocations(res, root); if (!locs.length) { store().showToast("No definition found"); return } store().openFile(locs[0].path) /* 複用既有開檔流程 */; store().showToast("→ " + locs[0].path + ":" + locs[0].line) } catch (e) { store().showToast("Definition: " + errMsg(e)) }`。**MVP 簡化**:跳到精確 line/col 的 textarea reveal 列為 refinement(需算 line offset + scrollIntoView),先開檔 + toast 行號。
- **`delegate.findReferences(path, ln, col)`**:同上呼叫 `requestLanguageReferences` → `mapLspLocations`;`if (!locs.length) { showToast("No references found"); return } patchProject(pid, p => { p.lspRefs = locs.map(l => ({ ...l, preview: l.path + ":" + l.line })) })`(preview 先用 path:line;讀該行內容當 preview 列 refinement)。
- **`delegate.renameSymbol(path, ln, col, newName)`**:`const root = rootOf(pid); const { line, character } = cursorToLsp({ ln, col }); try { const res = await requestLanguageRename({ workspaceId: pid, workspaceRoot: root, path: lspDocumentPathForWorkspace(root, path), line, character, newName }); const groups = flattenWorkspaceEdit(res, root); if (!groups.length) { showToast("Rename produced no changes"); return } const failed: string[] = []; for (const g of groups) { try { const openTab = store().ui[pid].tabs.find(t => t.type === "file" && t.path === g.path); const node = findNode(store().ui[pid].treeData, g.path); const realPath = node?.p ?? g.path; const cur = typeof openTab?.content === "string" ? openTab.content : (await readTextFile(root, realPath)).content ?? ""; const next = applyTextEdits(cur, g.edits); const result = await writeTextFile(root, realPath, next, openTab?.version ?? null); if (openTab) patchTab(pid, openTab.id, t => ({ ...t, content: next, savedContent: next, version: result.version, dirty: false })) /* mustFix-6: savedContent 也更新成 next,否則 tab 立即顯 dirty */ } catch { failed.push(g.path) } } void pollWorkspaceDiag(pid); if (failed.length) showToast("Rename: failed " + failed.join(", ")); else showToast("✓ renamed in " + groups.length + " file(s)") } catch (e) { showToast("Rename: " + errMsg(e)) }`。**version 衝突(mustFix-6 / 風險 5)**:沿用既有 `writeTextFile(..., expectedVersion)` 檢查,衝突檔落入 `failed` best-effort + toast。**註**:store 端 renameSymbol 已先過 ConfirmModal(見 D 段),controller 這層只負責落盤。
- **`delegate.restartLspServer(path)`**:`restartLanguageServer({ workspaceId: pid, workspaceRoot: root, path: lspDocumentPathForWorkspace(root, path) })` → patchProject 更新該 server,再 `patchProject(p => p.lspLoaded = false)` + `void ensureLang(pid)` reload。
- **`delegate.reloadLang()`**:`patchProject(store().active, p => p.lspLoaded = false)` → `void ensureLang(store().active)`。
- **registerRealDelegate**(controller.ts:1001):delegate 物件逐一加上 `lspChange, gotoDefinition, findReferences, renameSymbol, restartLspServer, reloadLang`,**型別須與 RealDelegate 完全吻合**(mustFix-3 硬 gate)。
- **bootstrap**:不動 `bootstrapV2`/`ensureActiveProjectData`(LSP lazy,進 'lang' 面板或開檔才啟,維持 lazy)。

### D. v2-store.ts(RealDelegate + actions)
- `RealDelegate` 型別(line 39-71)加:`lspChange: (tabId: number) => void`、`gotoDefinition: (path: string, ln: number, col: number) => void`、`findReferences: (path: string, ln: number, col: number) => void`、`renameSymbol: (path: string, ln: number, col: number, newName: string) => void`、`restartLspServer: (path: string) => void`、`reloadLang: () => void`。**全為必填(非 optional)**,以讓 controller delegate 物件漏實作時 `tsc` 立即爆(mustFix-3)。
- `V2State`(action 簽名)+ create 實作,demo/real 分支標準型:
  - `gotoDefinition(path, ln, col)`:`if (get().mode === "real") { realDelegate?.gotoDefinition(path, ln, col); return } get().showToast("Go to definition needs a real workspace")`。
  - `findReferences(path, ln, col)`:同型;demo showToast。
  - `closeRefs()`:`upd(p => { p.lspRefs = null })`(純 UI,兩模式共用)。
  - `renameSymbol(path, ln, col, newName)`:`if (get().mode === "real") { get().openConfirm({ title: "Rename to " + newName, body: "This will modify symbol references across the workspace.", danger: true, confirmLabel: "Rename", onConfirm: () => realDelegate?.renameSymbol(path, ln, col, newName) }); return } get().showToast("Rename needs a real workspace")`。(ConfirmState 形以既有 `openConfirm` 簽名為準,line 1255;受影響檔數在 controller 拿到 WorkspaceEdit 後才知,body 先用通用語句,落盤結果用 toast 回報。)
  - `restartLspServer(path)`:real 委派;demo showToast。
  - `reloadLang()`:real 委派 `realDelegate?.reloadLang()`;demo 空(或 showToast)。
  - `setTabContent`(line 718)末尾追加:`if (get().mode === "real") realDelegate?.lspChange(tabId)`(樂觀 UI 已先跑 upd,再通知 controller didChange)。
- `emptyUI()`(v2-store.ts:187)**與** `defUI(pid)`(v2-store.ts:162,demo data builder——**修正草案誤植**:草案稱 defUI 在 v2-model.ts:162,實際在 v2-store.ts:162)**兩處都補預設**:`diagnosticsByPath: {}`、`lspServers: []`、`lspLogs: []`、`lspRefs: null`、`lspLoaded: false`。demo 模式 LSP 狀態維持空,所有 LSP action 在 demo 只 showToast,不炸開。

### E. UI 元件
- **SidePanel.tsx**:
  - `FunctionList` rows 陣列(line 25)id union 加 `"lang"`;新增列 `{ id: "lang", label: "Language", badge: diagBadge(diagnosticsByPath) ?? undefined, icon: <LSP inline SVG> }`(沿用 `yz2-fnrow`/`yz2-fnbadge`;badge >0 才顯示,對齊 git badge 行為,可加 `is-error` 紅色語意)。
  - body 切換(line 336-340)加 `{fn === "lang" ? <LanguageBody /> : null}`。
  - 新 `LanguageBody()`(本檔或拆 `LanguagePanelV2.tsx`):移植 v1 三段(Language servers / Diagnostics / Server logs `<pre>`),但:(a) class 全改 `yz2-*`(`yz2-lang-sec`/`yz2-lang-row`/`yz2-lang-badge`/`yz2-lang-log`);(b) 圖示用字元/inline SVG(不用 lucide);(c) 資料來源 `useV2Store(s => s.ui[s.active].lspServers / diagnosticsByPath / lspLogs / lspLoaded)`;(d) server badge / diagnostic badge 顏色經 `normSeverity`(mustFix-1);(e) refresh 鈕接 `reloadLang`,restart 鈕接 `restartLspServer(server 代表 path——用該 server 任一 open document 或 workspace_root 對應的代表檔,若無則傳 root 相對的 "." 由後端按 workspace 推定)`,診斷列 onClick→`openFile(path)`;(f) real 模式 `!lspLoaded` 顯示 "Loading language servers…"(對齊 ExplorerBody loading note),demo 顯示空態。
- **ContentViews.tsx EditableBody**(line 69):
  - 行級 diagnostics:取 `const diags = useV2Store(s => s.ui[s.active].diagnosticsByPath[tab.path ?? ""])`;`const sevByLine = diagLineSeverity(diags ?? [])`。gutter `.yz2-ed-ln`(line 81)旁加小圓點 span `<span className={"yz2-ed-diagdot is-" + sev} />`(sev∈error/warning/info/hint);hlline(line 87)外層加 class `"yz2-ed-hlline" + (sevByLine.has(ln.n) ? " has-" + sevByLine.get(ln.n) : "")` 讓有診斷的行底加波浪底線。
  - **編輯器右鍵 cursor 擷取(mustFix-2 / gaps-2)**:既有 `EditorView` 的 `.yz2-ed-body` onContextMenu(line 187)掛在外層 div、且 textarea onBlur(line 104)會 `setCursor(null)`——右鍵時 cursor 已被清空。**修法**:在 `onContextMenu` 內,從事件目標找 textarea(`(e.target as HTMLElement).closest(".yz2-ed-area")?.querySelector("textarea")`)或用 ref,若存在則用 `cursorFrom(textarea)` 即時算出 cursor 並隨 ctx 傳入(擴 CtxTarget editor 變體加 optional `cursor: { ln; col } | null`);無 textarea/無 selection 則 cursor=null。**不依賴 store.cursor**。
- **Overlays.tsx**:
  - `buildCtxItems` editor 分支(line 93)追加三項,各自用 `ctx.cursor`(右鍵當下擷取的,非 store.cursor):
    - `{ glyph: "⇲", label: "Go to Definition", disabled: !ctx.cursor, run: () => ctx.cursor && store.gotoDefinition(ctx.path ?? "", ctx.cursor.ln, ctx.cursor.col) }`
    - `{ glyph: "⌕", label: "Find References", disabled: !ctx.cursor, run: () => ctx.cursor && store.findReferences(...) }`
    - `{ glyph: "✎", label: "Rename Symbol", disabled: !ctx.cursor, run: () => { if (!ctx.cursor) return; const n = prompt("Rename symbol to:"); if (n && n.trim()) store.renameSymbol(ctx.path ?? "", ctx.cursor.ln, ctx.cursor.col, n.trim()) } }`。
    - **cursor null 行為(mustFix-2)**:`disabled: !ctx.cursor` 讓三項在無 cursor 時 disable(MenuEntry 若無 disabled 欄位則改為 run 內 `if (!ctx.cursor) { toast("Place cursor on a symbol first"); return }`)。
  - 新 `ReferencesOverlay()`(掛 Overlays 渲染樹,類似 ConfirmModal):訂閱 `s.ui[s.active].lspRefs`,非 null 渲染浮層列表(`yz2-refs` card,每列 `path:line` + preview,onClick→`store.openFile(path)` + `store.closeRefs()`),esc/點背景關閉。沿用 `yz2-pal` backdrop + list 視覺。
  - **鍵盤觸發(可選 refinement)**:textarea onKeyDown(ContentViews.tsx:105)加 F12→gotoDefinition、⇧F12→findReferences、F2→rename(用 `cursorFrom(e.currentTarget)`,此時 textarea 已 focus,cursor 必有值)。MVP 先靠右鍵選單,鍵盤列為加分。
- **(階段 2 / T11,owner 拍板後)Hover/Completion**:在 `.yz2-ed-area`(已 `position:relative`,yuzu.css:777)加 absolute 錨層;hover 監聽 textarea mousemove→`ch` 寬 + lineHeight 估算 {line,character}→`requestLanguageHover`→浮層;completion 監聽 ⌃Space→`requestLanguageCompletion`→游標處下拉。tab/全形字座標偏移為 known limitation。

### F. yuzu.css(新樣式,用 --yz-* 色票)
- Language 面板:`.yz2-lang-sec`(對齊 `.yz2-sec-label` 間距)、`.yz2-lang-row`(列高 ~30px 對齊 fn-row)、`.yz2-lang-badge`(state chip,沿用 `.yz2-token-chip` 骨架)、`.yz2-lang-log`(`<pre>` mono 11px,`max-height` + `overflow:auto` 防爆)。
- 診斷色(對齊既有語法/狀態色,不硬編 hex):error→`var(--yz-f07178)`、warning→`var(--yz-ffcb6b)`、info→`var(--yz-82aaff)`、hint→`var(--yz-82aaff)` 或既有灰。**class 用正規化後的 `is-error`/`is-warning`/`is-info`/`is-hint`**(對齊 normSeverity 輸出)。
- gutter 圓點:`.yz2-ed-diagdot`(6px 圓,absolute 貼行號左側不佔位,`.yz2-ed-ln` 已 52px)。
- 行底線:`.yz2-ed-hlline.has-error`/`.has-warning`/`.has-info` → `background-image` 波浪(SVG data-uri,顏色用對應變數)貼行底 2px;或 `box-shadow: inset 0 -2px` 點線後備。
- References 浮層:`.yz2-refs`(card,圓角 9px,陰影 `0 14px 36px rgba(0,0,0,0.5)`,`yzIn` 進場)、`.yz2-refs-row`(列高 25px,hover `var(--yz-141a26)`,ellipsis 防長路徑撐爆)。
- 對齊既有間距慣例(字級 13/11/10、border `1px solid var(--yz-1c2433)`)。

## TDD Task 分解

> 每 task RED→GREEN→verify。純函式(bridge/v2-model)用 bun:test 直接斷言 I/O;store action 用 store 新實例斷言 demo 分支樂觀 UI(real 分支依賴 Tauri,靠 mock-IPC 手動驗證,見 MEMORY ide-v2-shell-migration)。controller 不寫單元測試,邏輯盡量下沉 bridge/model。檔頭一律 `/// <reference types="bun-types" />` + `import { describe, expect, test } from "bun:test"`,4 spaces、no semicolons、no trailing commas。

**T1 — 座標與 URI 純函式(bridge)**
- [x] Write the failing `cursorToLsp`, `lspRangeToCursor`, and `relativePathFromUri` tests in `src/v2/bridge.test.ts`.
- [x] Run `bun test src/v2/bridge.test.ts` and confirm RED.
- [x] Implement the four bridge helpers without importing React or Tauri modules.
- [x] Run `bun test src/v2/bridge.test.ts` and confirm PASS.
- Commit deferred in this run because the workspace already contains broad dirty/untracked v2 state; do not treat as a remaining implementation task.
- RED:`bridge.test.ts` 加 `cursorToLsp({ ln: 1, col: 1 })→{ line: 0, character: 0 }`、`cursorToLsp({ ln: 5, col: 3 })→{ line: 4, character: 2 }`、`lspRangeToCursor({ start_line: 3, start_character: 2, end_line: 3, end_character: 8 })→{ ln: 4, col: 3 }`、`relativePathFromUri("/root", "file:///root/src/a.ts")→"src/a.ts"`、含 `%20`(`"file:///root/a%20b.ts"→"a b.ts"`)、root 外回 null、`file:///root`(等於 root)→null。
- GREEN:bridge.ts 實作四純函式(`relativePathFromUri` 位元對齊後端 lsp.rs:328)。
- verify:`bun test src/v2/bridge.test.ts`。

**T2 — mapLspLocations / mapLspDiagnostics(bridge)**
- [x] Write failing tests for Location, LocationLink, single object, array, and root-outside skip cases.
- [x] Run `bun test src/v2/bridge.test.ts` and confirm RED.
- [x] Implement `mapLspLocations` and `mapLspDiagnostics`.
- [x] Run `bun test src/v2/bridge.test.ts` and confirm PASS.
- Commit deferred in this run because the workspace already contains broad dirty/untracked v2 state; do not treat as a remaining implementation task.
- RED:`mapLspLocations([{ uri: "file:///root/src/a.ts", range: { start: { line: 3, character: 2 }, end: {...} } }], "/root")→[{ path: "src/a.ts", line: 4, col: 3 }]`;LocationLink 形(`targetUri` + `targetSelectionRange`)覆蓋;單物件(非陣列)覆蓋;壞 uri(root 外)跳過。`mapLspDiagnostics([{ path: "src/a.ts", ... }, { path: "src/a.ts", ... }, { path: "src/b.ts", ... }])→{ "src/a.ts": [2 筆], "src/b.ts": [1 筆] }`。
- GREEN:bridge.ts 實作。
- verify:`bun test src/v2/bridge.test.ts`。

**T3 — flattenWorkspaceEdit / applyTextEdits(rename 核心,bridge)**
- [x] Write failing tests for `changes`, `documentChanges`, bad URI skip, reverse-order edit application, and one multiline range.
- [x] Run `bun test src/v2/bridge.test.ts` and confirm RED.
- [x] Implement `flattenWorkspaceEdit` and `applyTextEdits`.
- [x] Run `bun test src/v2/bridge.test.ts` and confirm PASS.
- Commit deferred in this run because the workspace already contains broad dirty/untracked v2 state; do not treat as a remaining implementation task.
- RED:`flattenWorkspaceEdit({ changes: { "file:///root/src/a.ts": [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: "Bar" }] } }, "/root")→[{ path: "src/a.ts", edits: [{ ..., newText: "Bar" }] }]`;`documentChanges` 陣列形覆蓋;壞 uri 跳過。`applyTextEdits("foo bar foo", [{ 第1個foo→range 0..3, newText: "X" }, { 第2個foo→range 8..11, newText: "Y" }])→"X bar Y"`(由後往前套不位移);多行 content 的 range(line/character)→offset 換算一筆(如 `"a\nbcd\ne"` 的 `{start:{line:1,character:1},end:{line:1,character:3}}` 對應 "cd")。
- GREEN:bridge.ts 實作(移植 EditorTab.normalizeLspWorkspaceEdit 去 Monaco 化 + 寫 offset 套用器)。
- verify:`bun test src/v2/bridge.test.ts`。

**T4 — normSeverity / diagBadge / diagLineSeverity(v2-model,含大小寫正規化 mustFix-1)**
- [x] Write failing tests for native uppercase and existing lowercase severity inputs.
- [x] Run `bun test src/v2/v2-model.test.ts` and confirm RED.
- [x] Implement `normSeverity`, `diagBadge`, and `diagLineSeverity`.
- [x] Run `bun test src/v2/v2-model.test.ts` and confirm PASS.
- Commit deferred in this run because the workspace already contains broad dirty/untracked v2 state; do not treat as a remaining implementation task.
- RED:`v2-model.test.ts` 加 `normSeverity("Error")→"error"`、`normSeverity("warning")→"warning"`、`normSeverity("Information")→"info"`、`normSeverity("Hint")→"hint"`、`normSeverity("Unknown")→"hint"`(**同時覆蓋大小寫兩種輸入**,證明 native 大寫值不落 default);`diagBadge({})→null`、`diagBadge({ "a.ts": [errDiag, warnDiag] })→"2"`;`diagLineSeverity([{ range: { start_line: 2, ... }, severity: "Warning" }, { range: { start_line: 2, ... }, severity: "Error" }])→Map{ 3 => "error" }`(同行取最嚴重,0-based→1-based,**fixture 用後端真實大寫值 "Error"/"Warning"**)。
- GREEN:v2-model.ts 實作三純函式(severity 全過 normSeverity)。
- verify:`bun test src/v2/v2-model.test.ts`。

**T5 — ProjectUI LSP 欄位 + FnMode 'lang' 對稱(model + store)**
- [x] Write failing store tests for `defUI`, `emptyUI`, and `selectFn("lang")`.
- [x] Run `bun test src/v2/v2-store.test.ts` and confirm RED.
- [x] Add `lang` to `FnMode`, LSP fields to `ProjectUI`, and matching defaults in `defUI` / `emptyUI`.
- [x] Run `bun test src/v2/ && bunx tsc --noEmit`.
- Commit deferred in this run because the workspace already contains broad dirty/untracked v2 state; do not treat as a remaining implementation task.
- RED:`v2-store.test.ts` 斷言 `freshStore().getState().ui.api` 含 `diagnosticsByPath`(={})、`lspServers`(=[])、`lspLogs`(=[])、`lspRefs`(=null)、`lspLoaded`(=false);`import { emptyUI } from "./v2-store"` 斷言 `emptyUI()` 同樣有這些欄位(**defUI 與 emptyUI 兩處對稱**);`selectFn("lang")` 後 `ui.api.fn === "lang"`。
- GREEN:v2-model.ts FnMode 加 'lang' + ProjectUI 加欄位 + `import type` 引 language-model 型別;v2-store.ts `defUI()`(line 162)與 `emptyUI()`(line 187)兩處補預設;SidePanel rows id union 加 'lang'(讓 tsc 過)。
- verify:`bun test src/v2/`(維持現有全綠 + 對稱性守住)。

**T6 — LSP store actions demo 分支(store)**
- [x] Write failing tests for demo `gotoDefinition`, `findReferences`, `renameSymbol`, `closeRefs`, `reloadLang`, and `setTabContent`.
- [x] Run `bun test src/v2/v2-store.test.ts` and confirm RED.
- [x] Add RealDelegate methods and demo-safe actions without importing controller.
- [x] Run `bun test src/v2/v2-store.test.ts && bunx tsc --noEmit`.
- Commit deferred in this run because the workspace already contains broad dirty/untracked v2 state; do not treat as a remaining implementation task.
- RED:`gotoDefinition("a.ts", 1, 1)`(demo)→`getState().toast` 含 "needs a real workspace";`findReferences(...)`(demo)→toast;`renameSymbol(...)`(demo)→toast(demo 不開 confirm);`closeRefs()` 後 `ui.api.lspRefs === null`;`reloadLang()`(demo)不炸;`setTabContent(tabId, "x")`(demo)後對應 tab.content === "x" 且**無 toast**(demo 不通知 lspChange)。
- GREEN:v2-store.ts 加 actions(demo/real 分支標準型)+ RealDelegate 型別加 6 方法 + setTabContent real 分支。
- verify:`bun test src/v2/v2-store.test.ts`。

**T7 — controller LSP delegate 接線(無單測,mock-IPC + native 手動驗證)**
- [x] Add `getDocumentDiagnostics` to `src/features/language/language-api.ts`.
- [x] Implement controller imports, `ensureLang`, `pollDocDiag`, `pollWorkspaceDiag`, document lifecycle hooks, definition/references/rename/restart/reload delegates, and register all methods.
- [x] Run `bunx tsc --noEmit` and confirm delegate signatures match `RealDelegate`.
- [x] Run `bun test src/v2/` and confirm no regression.
- [x] Run mock-IPC/native smoke described below.
- Commit deferred in this run because the workspace already contains broad dirty/untracked v2 state; do not treat as a remaining implementation task.
- 實作 controller.ts:import language-api(+ 新增單檔 wrapper `getDocumentDiagnostics`)/language-model + bridge 新函式;`ensureLang`、`pollDocDiag`(單檔)、`pollWorkspaceDiag`(進面板)、`lspOpen` 內聯 openFile、`lspChange`(debounce ~400ms,模組級 timer Map)接 setTabContent 通知、`lspClose` 內聯 closeTab(清 diagnostics key + 清 timer)、saveFile 後補撈;`gotoDefinition/findReferences/renameSymbol(讀 content→applyTextEdits→writeTextFile 落盤 + patchTab 同步 content/savedContent/version/dirty=false)/restartLspServer/reloadLang`;selectFn 加 'lang'→ensureLang;registerRealDelegate 注入全部新方法。
- verify:(a) `bun test src/v2/` 仍綠;(b) **`bunx tsc --noEmit` 為硬 gate(mustFix-3)**:RealDelegate 介面與 controller delegate 物件逐方法對齊,任何漏實作的方法讓 registerRealDelegate 型別爆掉;(c) **mock-IPC(依 MEMORY 法)**:mock `@tauri-apps/api/core` 的 invoke 對 `lsp_open_document/lsp_document_diagnostics/lsp_workspace_diagnostics/lsp_definition/lsp_references/lsp_rename/lsp_server_status/lsp_server_logs` 回 fixture(core mock 須額外 export `transformCallback` 與 `Channel`,否則 plugin-dialog 連帶 import 報錯,見 folder-expand-bug wiringNotes),bootstrapV2 後開一支 .ts 檔→**斷言 `ui[pid].diagnosticsByPath` 的 key 嚴格等於該 tab 的 `tab.path`(displayPath)**(mustFix-4 / gaps-3:證明後端 relative_path 反解與 v2 顯示路徑同源,否則 T9 行底線/gutter 永遠空)、gotoDefinition 觸發 openFile、renameSymbol 套 applyTextEdits 後 writeTextFile 被呼叫且 patchTab 後 tab.dirty===false;(d) **native 桌面殼**實測一支 .ts 檔(controller 僅 Tauri 內跑)。

**T8 — Language 面板 UI(SidePanel + CSS)**
- [x] Implement Language panel body using store state and `normSeverity`.
- [x] Add `lang` function rail row and diagnostic badge.
- [x] Add `yz2-lang-*` CSS.
- [x] Run `bun test src/v2/ && bunx tsc --noEmit`.
- Commit deferred in this run because the workspace already contains broad dirty/untracked v2 state; do not treat as a remaining implementation task.
- 實作 `LanguageBody`/`LanguagePanelV2`(移植 v1 三段,改 yz2-* + store selector + 字元圖示 + server/diagnostic badge 過 normSeverity);SidePanel rows 加 'lang' 列 + `diagBadge`;body 切換加分支;real `!lspLoaded` 顯示 Loading;yuzu.css 加 `yz2-lang-*`(用 --yz-* 色,logs max-height + overflow)。
- verify:(a) `bun test src/v2/`(v1 LanguagePanel 既有測試不受影響;若新增 v2 元件渲染測試用 testing-library,檔頭照 `test-dom.preload.ts` 慣例);(b) native 看面板 server 列/診斷列/logs/restart 鈕,**確認 native 大寫 severity 下 badge 顏色正確**(mustFix-1 驗收點);(c) 視覺對齊檢查(間距/字級與其他 section 一致)。

**T9 — diagnostics gutter 圓點 + 行底線(ContentViews + CSS)**
- [x] Render diagnostics from `diagnosticsByPath[tab.path]`.
- [x] Add gutter dots and line underline classes from `diagLineSeverity`.
- [x] Add CSS for severity classes.
- [x] Run `bun test src/v2/ && bunx tsc --noEmit`.
- Commit deferred in this run because the workspace already contains broad dirty/untracked v2 state; do not treat as a remaining implementation task.
- 實作 EditableBody 取 `diagnosticsByPath[tab.path]` + `diagLineSeverity` → gutter 圓點 span(`yz2-ed-diagdot is-*`) + hlline `has-*` class;yuzu.css 加 `.yz2-ed-diagdot` + 波浪底線(SVG data-uri,severity 對應 --yz-f07178/ffcb6b/82aaff)。
- verify:(a) native 開有錯誤的 .ts 檔看到行底波浪 + gutter 圓點(**且診斷 key 命中——靠 T7 mock-IPC 對齊斷言保證**);(b) `bun test src/v2/`(diagLineSeverity 已 T4 測)。
- 實際結果(2026-06-13):已新增 `ContentViews.test.tsx` 覆蓋 gutter dot 與 `has-*` line class,並修正 `EMPTY_DIAGNOSTICS` 穩定 selector 避免 React snapshot loop。驗證:`bun test src/v2/ContentViews.test.tsx`、`bun test src/v2/SidePanel.test.tsx`、`bun test src/v2/folder-expand.test.ts src/v2/v2-store.test.ts`、`bun test src/v2/`、`bunx tsc --noEmit` 均通過。subagent review:Bacon 初審要求補完整 store test isolation;Turing re-review APPROVED;Galileo risk review APPROVED。

**T10 — definition / references / rename 觸發 + References 浮層(Overlays + ContentViews)**
- [x] Capture textarea cursor during `onContextMenu`; do not rely on store cursor after blur.
- [x] Add editor context actions for Go to Definition, Find References, and Rename Symbol.
- [x] Add References overlay.
- [x] Run `bun test src/v2/ && bunx tsc --noEmit`.
- Commit deferred in this run because the workspace already contains broad dirty/untracked v2 state; do not treat as a remaining implementation task.
- 實作:ContentViews `onContextMenu` 擷取 textarea cursor 帶進 ctx(mustFix-2);CtxTarget editor 變體加 `cursor`;Overlays `buildCtxItems` editor 分支加 Go to Definition / Find References / Rename Symbol(cursor null 時 disable 或 toast 提示);`ReferencesOverlay` 元件 + 掛載(訂閱 lspRefs,onClick→openFile + closeRefs);rename 走 `openConfirm`(danger);yuzu.css 加 `yz2-refs`/`yz2-refs-row`。
- verify:(a) `bun test src/v2/`(套用邏輯已 T2/T3 測);(b) native:游標停在 symbol→右鍵 Go to Definition 跳檔;Find References 開浮層點列跳轉;Rename 改名落盤多檔 + 確認框 + reload diagnostics;**右鍵點 editor 空白處(無 selection)→三項 disable/提示**(mustFix-2 驗收);**rename 多檔中途某檔 version 衝突→best-effort + toast 報失敗檔**(mustFix-6 / 風險 5 實測一次);(c) rename 後 `pollWorkspaceDiag` 刷新診斷。
- 實際結果(2026-06-13):已新增 `CtxTarget.cursor`、editor onContextMenu 即時 cursor 擷取、Go to Definition / Find References / Rename Symbol menu actions、disabled/null-cursor guard、`ReferencesOverlay` 與 Workbench 掛載。另修正 bootstrap 過渡狀態 `active="" / ui={}` 時 references selector 不崩潰。驗證:`bun test src/v2/ContentViews.test.tsx src/v2/Overlays.test.tsx`、`bun test src/v2/`(158 pass)、`bunx tsc --noEmit` 均通過。subagent review:Kant 初審要求補 null-cursor 測試,Leibniz re-review APPROVED;Pasteur 初審要求修 bootstrap selector,Epicurus re-review APPROVED。

**T11(階段 2,owner 拍板後才開工)— hover / completion 字元級浮層**
- [x] Stop before this task unless owner has chosen textarea self-built, deferred, or Monaco path.
- [ ] If owner chooses textarea path, add hover/completion state, RealDelegate methods, controller calls, and anchored UI.
- [ ] Run `bun test src/v2/ && bunx tsc --noEmit`.
- [ ] Run native ASCII + tab/fullwidth limitation smoke.
- [ ] Commit only after owner decision with `git commit -m "feat(v2): add lsp hover and completion"`.
- **前置**:owner 須先決定 (a) textarea 自製 / (b) 延後 / (c) 接回 Monaco EditorTab(見「範圍邊界」)。決 (a) 才執行本 task。
- **決策(2026-06-13)**:owner 選項 `2` = 延後。T11 不納入本階段實作;保留作為後續 owner gate。
- 實作:`.yz2-ed-area` 加 absolute 錨層;textarea mousemove→`ch` 寬 + lineHeight(~21px)估算 {line,character}→`requestLanguageHover`→浮層;⌃Space→`requestLanguageCompletion`→游標處下拉(↑↓/Enter 插入)。store 加 hover/completion 暫態 + RealDelegate 方法 + controller 接線。
- verify:native 等寬純 ASCII 下 hover/completion 座標正確;tab/全形字場景座標偏移列 known limitation。

## UI 考量

- **fn rail 一致性**:'lang' 列 icon 與既有 5 個維持 `yz2-fnrow` inline SVG stroke 風格;badge 用診斷數(diagBadge),>0 顯示可加 `is-error` 紅,0 不顯示(對齊 git badge)。
- **Language 面板對齊**:列高、字級 13/mono meta 11、`yz2-sec-label` 間距比照 ExplorerBody/GitBody;logs `<pre>` 須 `max-height + overflow:auto`。
- **diagnostics 視覺**:gutter 圓點 absolute 貼行號左不擠掉行號(`.yz2-ed-ln` 已 52px);行底波浪 error 紅 > warning 黃 > info/hint 藍;severity class 用 normSeverity 輸出(`is-error`/`is-warning`/`is-info`/`is-hint`)避免大小寫 miss。
- **References 浮層**:沿用 palette backdrop + list 語言,esc/點背景關;每列 `path:line` + preview,ellipsis 防長路徑撐爆。
- **rename 破壞性提示**:ConfirmModal danger 紅鈕;受影響檔數在落盤後 toast 回報(rename 前拿不到精確檔數,body 用通用語句)。
- **cursor 取得(mustFix-2)**:右鍵時 textarea 已 blur→store.cursor 為 null,故在 onContextMenu 當下從 textarea 即時 `cursorFrom()` 擷取帶進 ctx;鍵盤 F12/F2 觸發時 textarea 仍 focus,可直接用 `cursorFrom(currentTarget)`。
- **textarea 定位限制**:diagnostics/references/definition/rename 全走「行級 + 字串 offset」定位,不需字元像素;**definition/references 的 column 對含 CJK 的檔正確**(cursorFrom 的 col 與 LSP character 同為 UTF-16 code unit);只有 T11 hover 的「像素→字元估算」才有 tab/全形字偏移。

## 驗證 gate

- 純函式/store:`bun test src/v2/`(維持現有 71 全綠 + 新增 T1–T6 綠);個別 `bun test src/v2/bridge.test.ts`、`bun test src/v2/v2-model.test.ts`、`bun test src/v2/v2-store.test.ts`。
- 型別(**硬 gate**):`bunx tsc --noEmit`——RealDelegate 介面 vs controller delegate 物件逐方法對齊(mustFix-3,漏實作即爆)、ProjectUI 欄位、FnMode union、CtxTarget editor cursor 欄位、UI selector、無循環 import(store 不 import controller)。
- demo/real 對稱:`defUI()`(v2-store.ts:162)與 `emptyUI()`(v2-store.ts:187)LSP 欄位齊全(T5 守住),瀏覽器 fallback 不炸。
- **severity 大小寫(mustFix-1)**:T4 純函式測試覆蓋大寫('Error')與小寫('warning')兩種輸入皆正規化;native 驗收 badge/底線色正確。
- **diagnostics key 對齊(mustFix-4 / gaps-3)**:T7 mock-IPC 斷言開檔後 `diagnosticsByPath` 的 key === tab.path(displayPath)。
- **cursor null(mustFix-2)**:T10 native 驗右鍵空白處三項 disable/提示。
- **rename version 衝突 + savedContent 同步(mustFix-6)**:T10 native 驗多檔落盤 + 中途失敗 best-effort + toast;落盤後 tab.dirty===false(savedContent 已更新)。
- 手動 mock-IPC:core mock 須額外 export `transformCallback` 與 `Channel`(否則 plugin-dialog 連帶 import 報錯)。
- native(桌面殼,真正 Tauri):開支援語言檔看 diagnostics 行底線 + gutter 圓點;Language 面板 server/診斷/logs/restart;右鍵 Go to Definition/Find References/Rename 全鏈;確認 didOpen/didChange(編輯後診斷更新)/didClose(關 tab 清診斷)。
- (可選)Playwright:demo 模式驗 'lang' 面板可開、不炸(LSP 資料空、actions 只 toast);native LSP 行為 Playwright 測不到(controller 僅 Tauri 內)。

## 風險

1. **編輯器架構抉擇 + hover/completion 對焦點的偏差(最大決策點,須 owner 拍板)**:本計劃不升級 Monaco,階段 1 全程行級定位交付 diagnostics/definition/references/rename;但 hover+completion 明列在使用者焦點內、後端與 wrapper 全 ready,卻因 textarea 字元級像素定位脆弱被隔離成 T11——**這是對焦點的縮減,不應視為既定事實,T11 在 owner 三選一(textarea 自製 / 延後 / 接回 Monaco)拍板前不開工**。
2. **座標 off-by-one(UTF-16 框定已修正)**:cursor 1-based↔LSP 0-based 用純函式隔離可測(T1)。**修正 gaps-4 的錯誤**:`cursorFrom` 的 col = `upTo.length`(JS UTF-16 code unit)與 LSP character(同 UTF-16)語意一致,故 definition/references 的 column 對含 CJK 的檔**是正確的**,不列 limitation;UTF-16/像素偏移只發生在 T11 hover 的「像素→字元估算」。
3. **diagnostics pull-not-push**:後端不 emit,改**事件驅動 + 單檔指令優先**(`lsp_document_diagnostics`,missedBackend-1)——didOpen/didChange/存檔後撈當前檔、進面板用 workspace 版補清單,不開常駐 interval(避 StrictMode 雙呼 + CPU);server 慢時存檔後 setTimeout 200ms 補撈。
4. **debounce didChange 與切檔/關檔 race**:timer 存 controller 模組級 Map<tabId, timer>,closeTab 清對應 timer,debounce 到期前確認 tab 仍存在;patchProject 帶明確 pid(非 active)防 async 完成時 active 已切走。
5. **rename 跨檔落盤一致性**:applyTextEdits 純函式可測(T3);多檔寫入中途失敗→best-effort,失敗檔入 failed + toast 報出;沿用 writeTextFile 的 expectedVersion 衝突檢查;落盤成功的 tab 同步更新 content + **savedContent**(否則立即顯 dirty,mustFix-6)。
6. **path 規範化(出站 + 入站雙向)**:出站用 `lspDocumentPathForWorkspace` 剝 root 前綴;入站 definition/references 回 `file://` 絕對 URI 用 `relativePathFromUri`(位元對齊後端 `relative_path_from_uri`:strip file:// + percent-decode + strip root);**diagnostics 入站 key 直接用 displayPath 寫入**(controller pollDocDiag 用傳入的 displayPath 當 key,不用後端反解 path),mock-IPC 斷言 key === tab.path(mustFix-4)。
7. **workspaceId 後端忽略**:後端用 `lsp_workspace_identity(workspace_root)` 自推,前端傳的 workspaceId 帶 pid 即可,只要 workspace_root=rootOf(pid) 正確(language-api 簽名仍要求 workspaceId)。
8. **未驗證接線**:v2 從未跑過任何 lsp_*(language-api/model 是 orphan)→ 先 mock-IPC 再 native,逐指令確認 invoke camelCase 參數轉換({workspaceId, workspaceRoot, path, line, character})。

## 非目標

- 不升級 Monaco(維持 textarea 疊高亮;hover/completion 為 owner 待拍板的 T11)。
- 不接 code_actions 的 UI 觸發點(`flattenWorkspaceEdit` + `applyTextEdits` 會建好,留接口——`normalizeLspCodeActionList` 內部即呼叫 normalizeLspWorkspaceEdit,故未來只差觸發點,經驗證正確);不接 workspace symbols(⌘T)導覽 UI。
- 不開 diagnostics 常駐輪詢 interval(事件驅動 + 單檔指令)。
- 不改後端 lsp.rs / commands.rs(14 指令全 ready,免動 Rust)。語言層唯一前端新增是 language-api.ts 一個 thin wrapper `getDocumentDiagnostics`(對應已存在的 `lsp_document_diagnostics`),非改既有。
- 不改既有 git/db/ssh/browser 接線;rename 用前端 ConfirmModal 二次確認,不要求後端 confirmation 字串(lsp_rename 不需 typed token)。
- 不處理 .ipynb / 非文字檔的 LSP(僅 isLspSupportedDocumentPath 白名單副檔名)。
