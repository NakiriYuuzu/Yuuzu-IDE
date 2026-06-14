# v2 Wiring Master Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 v2 Yuzu shell 的五個子計劃依序交付，讓目前 orphan 或半接線的後端能力進入可用 UI。

**Architecture:** Master plan 只負責切分、相依、gate 與交付順序；實作細節落在 SP0-SP4 各自的 implementation plan。所有子計劃維持 store -> RealDelegate -> controller delegate -> features/*-api 分層，store 不 import controller，demo/real 雙模式都要保留。

**Tech Stack:** React + Zustand-style v2 store、Bun test、Tauri invoke wrappers、TypeScript、existing `src/v2` + `src/features/*` modules。

---

> multi-agent workflow 產出 · 2026-06-13 · 22+ agents · 對抗式審查 · SP0-SP4 implemented through current core scope

## Scope Check

本 master plan 橫跨 5 個獨立子系統，已依 `writing-plans` scope rule 拆成 5 份可獨立交付的子計劃：

- [x] SP0: file tree / SFTP local descendant scanning bugfix。
- [x] SP1: observability + stability Settings custom sections。
- [x] SP2: Git power UI and missing git command wiring。
- [x] SP3: language/LSP wiring into v2 editor(stage 1 T1-T10 completed; T11 deferred by owner option 2)。
- [x] SP4: connected DB / remote / browser ready-backend subset。

## File Structure

- Modify: `docs/superpowers/plans/2026-06-13-v2-SP0-folder-expand-bugfix.md` — folder expand bugfix implementation steps.
- Modify: `docs/superpowers/plans/2026-06-13-v2-SP1-observability-stability.md` — Settings stability surfaces implementation steps.
- Modify: `docs/superpowers/plans/2026-06-13-v2-SP2-git-power-and-ui.md` — Git UI and command wiring implementation steps.
- Modify: `docs/superpowers/plans/2026-06-13-v2-SP3-language-lsp.md` — LSP implementation steps and owner gate for hover/completion.
- Modify: `docs/superpowers/plans/2026-06-13-v2-SP4-connected-domains.md` — DB/remote/browser connected domains implementation steps.
- Generate/Update: `docs/html/v2-wiring-master-plan-overview-2026-06-13.html` — read-only visual overview after Markdown changes.

## Execution Checklist

- [x] **Step 1: Execute SP0 first**

Run the SP0 plan exactly as written. Verify:

```bash
bun test src/v2/folder-expand.test.ts
bun test src/v2/
bunx tsc --noEmit
```

Expected: new folder-expand test passes, existing v2 tests do not regress, TypeScript exits 0.

- [x] **Step 2: Execute SP1 after SP0**

Run the SP1 plan and verify:

```bash
bun test src/v2/
bunx tsc --noEmit
```

Expected: Settings custom sections compile, demo stability data works, native manual gate confirms `metric_snapshot`, diagnostic event append/list, and recovery backup restore.

- [x] **Step 3: Execute SP2 after SP1 or in a separate branch with ConfirmModal coordination**

Run the SP2 plan and verify:

```bash
bun test src/v2/
bunx tsc --noEmit
```

Expected: Git status groups, typed confirmation, diff, branch, stash, reset/rebase, conflict, blame, file history, and export flows compile and pass focused tests.

- [x] **Step 4: Execute SP3 after SP1 or independently without logger integration**

Run the SP3 plan through T10 first. Stop at T11 until owner chooses hover/completion direction. Verify:

```bash
bun test src/v2/
bunx tsc --noEmit
```

Expected: `lang` mode compiles, LSP pure helpers pass, store demo branch is safe, native mock-IPC proves diagnostics keys match `tab.path`.

Actual 2026-06-13: SP3 stage 1 T1-T10 completed and reviewed by subagents; `bun test src/v2/` passes at 158 tests and `bunx tsc --noEmit` exits 0. Owner selected option `2` for T11, so hover/completion remains deferred and out of the current stage.

- [x] **Step 5: Execute SP4 last or independently**

Run the SP4 plan and verify:

```bash
bun test src/v2/
bunx tsc --noEmit
```

Expected: DB history/kind chip, SFTP reconnect/disconnect, and browser screenshot thumbnail compile; native smoke confirms real commands.

Actual 2026-06-13: SP4 T1-T12 automated implementation completed after owner accepted the extra `run_remote_command` UI surface via follow-up `繼續`. `bun test src/v2/` passes at 180 tests and `bunx tsc --noEmit` exits 0. Native one-off command smoke remains pending a saved real SSH host profile.

Post-cleanup target: v1 shell and the transitional `src/app/` support location are removed from active source; reusable workspace/test support lives under feature or test-owned paths.

- [x] **Step 6: Regenerate the HTML overview**

Regenerate `docs/html/v2-wiring-master-plan-overview-2026-06-13.html` from the updated Markdown summary if the project has an existing generator. If no generator exists, update the HTML manually from this master plan and re-open it in the browser.

Expected: overview still reports 5 subplans; SP4 wording says `12 tasks`, with native run command smoke called out separately.

Actual 2026-06-13: no generator was found, so `docs/html/v2-wiring-master-plan-overview-2026-06-13.html` was manually synced to the updated Markdown state: SP4 automated implementation complete, `180 pass`, and native run command smoke pending a real SSH profile.

## 總目標

把 Yuuzu-IDE 前端從「v2 Yuzu shell 只接了 workspace/files/git(部分)/terminal/database/remote-sftp/browser」推進到「7 大使用者需求的核心範圍落地,已延後/optional 項目明確標記」。後端早已齊全(Node 0-13 + Git Deep Dive 全 completed),本批 5 個子計劃幾乎**零 Rust 改動**(唯一例外是 SP1-T0 修 diagnostics-api 一個前端 latent bug),工作量集中在嚴守 store→RealDelegate→controller delegate→features/*-api 分層的接線、bridge 純函式映射、yz2-*/--yz-* UI。鐵則貫穿全部:store 絕不 import controller(避循環)、demo/real 雙模式、瀏覽器自動 fallback、destructive 操作走 ConfirmModal + typed confirmation。實測基線:`bun test src/v2/` = 71 pass / 0 fail(3 檔),`bunx tsc --noEmit` 須維持 EXIT 0;每個子計劃完成後此基線只增不減。

---

## 子計劃索引(逐一摘要)

- **SP0 — folder-expand-bugfix(S,2 tasks)**:real(Tauri)模式下檔案樹**子資料夾**展開後永遠空白。根因已逐行核對:controller 對子目錄絕對路徑誤用 `scanWorkspace(node.p)`,而後端 `scan_workspace→trusted_workspace_root`(commands.rs:1071)只放行「已註冊 root 本身」,子目錄 canonicalize 後 != 任何 root → reject → `setNodeChildren` 永不執行;但 store toggleDir 已樂觀翻 `open[path]=true`,故 chevron 開了卻無子項。修法:把 controller.ts **5 處對子目錄的 scanWorkspace(168/347/772/829/862)改成既有 `scanDirectory(root,path)`**(後端 scan_directory 先驗 root 是註冊 root、再以 `path.starts_with(root)` 接受 descendant)+ 1 行 import + toggleDir 守門加 `const root=rootOf(pid)`。先寫一個 controller 整合測試(mock @tauri-apps/api/core,忠實還原後端雙重權限差異)RED 重現,再最小改轉綠。**已驗證**:144/158/719 三處是合法 root 層呼叫,絕不可動。後端與 features/workspace api 層零改動。

- **SP1 — Observability & Stability 三件套(M,7 tasks)**:在 v2 SettingsModal 內開「依 section.id 的自訂 React render 出口」,接上三塊後端 100% ready 但前端完全 orphan 的穩定性能力:**ide-logger**(append/list_diagnostic_events:關鍵 action fire-and-forget 埋點 + 事件清單)、**效能監控**(metric_snapshot:記憶體/uptime/index/workspace 數字卡 + 手動 Refresh)、**recovery**(save/list/discard_unsaved_backup:autosave debounce 備份 + 還原灌回 tab + 丟棄走 ConfirmModal)。**T0 先修已驗證的 latent bug**:`appendDiagnosticEvent` 送 flat 參數而非 `{event:{...}}`(Rust commands.rs:230 簽名為 `event:DiagnosticEventInput`),不先修則所有 logger 埋點被 `.catch(()=>{})` 靜默吞掉。產出橫跨 v2-model/bridge/store(RealDelegate +5 method)/controller(delegate + autosave debounce + `logDiag` helper)/Overlays/yuzu.css。最高風險 T4(controller 整合測試在 v2 零先例)降為 smoke,真 gate 落 native 手動驗證(metric_snapshot 是 v1 從未實跑的指令)。

- **SP2 — Git Power & UI(L,12 tasks)**:把後端早已齊全的 ~30 個未接 git 指令(41 個 command + git-api wrapper 全齊,**0 後端改動**)接進兩個既有 surface(SidePanel GitBody + GitGraphView):working-tree 變更清單 + path/hunk/line 級 staging、unstaged/commit diff viewer、branch popup(建立/切換/合併/刪除/改名,**並修掉「checkout 只能 detached」的明確 bug**:gitCheckout 送 fullHash → `git checkout {hash}` 永遠 detached,新增 gitCheckoutBranch 送 branch 名)、stash apply/pop/drop/branch、reset/rebase 入口、三路 conflict resolver(MVP 整檔 accept-side)、blame gutter、file history、export patch/archive、log filter 真正打後端,外加 git head 兩列重排。**第一刀 T1**(GitData + mapGitStatusGroups 帶入 status.changes)解掉「git_status 已抓卻被 mapGitLog 丟棄」的源頭。關鍵修正已驗證:git-model/git-diff-model 在 `src/features/git/`、st 映射用 exported `decorationMapFromStatus`(已確認 `decorationForChange` git-model.ts:548 無 export)、export destDir 用 `pickWorkspaceFolder()` 取絕對路徑(後端 !is_absolute 直接拒)、typed-confirmation token 須與後端 require_confirmation 逐字相符且複用 `confirmationTextForGitAction`、T3 須先在兩個 :root 補定義 --yz-5b2730/0e131d/3a1a22 三個被引用卻未定義的 CSS 變數。

- **SP3 — language-lsp(L,11 tasks)**:把後端 14 個 lsp_* 指令(全 completed、orphan)接進 v2。核心決策:編輯器維持「textarea 疊高亮層」不升 Monaco,分階段——**階段 1(T1-T10,必做)**接只需行級定位的高 CP 值能力:新 FnMode `lang` + LanguagePanelV2、LSP 文件生命週期(didOpen/didChange/didClose)、diagnostics(行底波浪 + gutter 圓點 + 面板)、go-to-definition、find references、rename(WorkspaceEdit 攤平 + applyTextEdits 純函式 + ConfirmModal 受影響檔數確認);**階段 2(T11)hover/completion 在焦點內但因 textarea 字元級像素定位脆弱獨立成 T11,明確標記為與焦點的偏差、待 owner 三選一(textarea 自製/延後/接回 Monaco)拍板前不開工**。三項硬修正已驗證:severity 後端是大寫 'Error'/'Warning'/...(lsp.rs:371-378,v1 比小寫是既有 bug)、右鍵時 textarea onBlur 已把 cursor 設 null(須 onContextMenu 當下擷取 selectionStart)、diagnostics 入站 key 須與 tab.path 同源。事件驅動 diagnostics 改用單檔 `lsp_document_diagnostics`(language-api 唯一新增一個 thin wrapper)。

- **SP4 — connected-domains(M,12 tasks)**:補完 database/remote-sftp/browser 三域中後端 100% ready 但 v2 沒接或接了丟資料的子集:**DB** query history(list_database_query_history)+ mutation 被動分類 chip(execute 回的 classification.kind 目前被丟棄)+ data footer total 在 count undefined 時 fallback;**remote** 顯式 disconnect/reconnect + 一次性 run_remote_command;**browser** 區域截圖升級為縮圖顯示(BrowserScreenshot.data_url 直接 `<img src>`,macOS-only)。焦點另一半因後端缺口排除(SFTP delete/rename/mkdir trait 無方法、browser console/network 後端皆無、DB 主動攔截維持後端 reject→confirmationFromError)。已修正草案兩個事實錯誤:footer 並非「永遠 —」、mutation chip re-run 會閃失(controller.ts:627 樂觀 grid 須補帶 kind)。`run_remote_command` native smoke 待真 SSH profile。

---

## 跨專案相依圖(文字)

```
硬依賴(跨子專案):無。 五個子專案彼此可獨立交付。
軟依賴(非阻塞,只影響埋點完整度):
  SP1.logDiag(ide-logger) ┄┄(optional fire-and-forget 埋點)┄┄▶ SP2 git 寫操作
  SP1.logDiag(ide-logger) ┄┄(optional 埋點)┄┄▶ SP3 LSP 動作
  SP1.logDiag(ide-logger) ┄┄(optional 埋點)┄┄▶ SP4 db/remote/browser 動作

子專案內部硬依賴(SP2,12 tasks 鏈):
  T1(GitData+mapGitStatusGroups working-tree 欄位)
     ├─▶ T2(discard 變更清單)  ├─▶ T4(DiffView)  └─▶ T9(conflict resolver)
  T3(typed ConfirmModal + 先補 3 個 CSS 變數)
     ├─▶ T2(discard) ├─▶ T6(checkout/delete) ├─▶ T7(stash drop) ├─▶ T8(reset/rebase) └─▶ T9(accept-side)
  T4(DiffView)
     ├─▶ T5(hunk/line staging)  └─▶ T12(commit detail 補 diff,保留 body)

子專案內部依賴(SP3):
  T1-T6(型別/純函式,含 normSeverity 大小寫正規化、applyTextEdits) ─▶ T7(controller LSP delegate) ─▶ T8-T10(UI)
  T11(hover/completion)= owner gate,不阻塞 T1-T10

子專案內部依賴(SP4):
  T1-T6(純函式/store) ─▶ T7(controller delegate) ─▶ T8-T10(UI)
  sftpReconnect 須先從 sftpOpen 抽 connectAndList helper 再讓兩者共用

跨域共用基座(全部已存在,不需新建):
  store→RealDelegate→controller delegate→features/*-api 分層 · createV2Store 測試工廠
  · ConfirmModal(SP2-T3 擴 typed 變體後,SP1 recovery discard 與後續所有 destructive 受惠)
  · happy-dom 就緒鏈 bunfig.toml→test-dom.preload.ts→test-dom.ts(SP0 新測試檔依賴)
  · core mock 慣例(須 export transformCallback/Channel,SP0/SP1-T4/SP2/SP3 的 controller 測試共用)
```

---

## 執行順序與理由

建議順序:**SP0 → SP1 → SP2 → SP3 → SP4**(理由如下,非唯一解;因無跨專案硬依賴,SP2/SP3/SP4 可在 SP1 後並行,只是各自少了 logger 埋點)。

1. **SP0 先清地雷(S)**:這是使用者明確回報、影響每次操作的 real 模式回歸 bug,工作量最小(5 行 + 1 import + 1 守門 + 1 測試),先做立刻恢復檔案樹可用性,且它建立/驗證了「controller 整合測試 + core mock(transformCallback/Channel)」的 pattern——這正是 SP1-T4 / SP2 / SP3 controller 測試要沿用的同一套 mock 慣例,讓後面省去從零摸索 mock-IPC 的成本。

2. **SP1 logger 先行(M)**:`logDiag` helper 一旦就緒,SP2 git 寫操作、SP3 LSP 動作、SP4 db/remote/browser 動作都能掛 fire-and-forget 埋點,讓後三者「免費」獲得可觀測性而不需回頭補。**且 SP1-T0 必須最先修**(append 包 {event}),否則整條 logger 鏈靜默失效、後面掛的埋點全是假的。SP1 也把 SettingsModal 自訂 render 出口打通,recovery 的 ConfirmModal discard 流程先行驗證 typed-confirm 的兼容性。

3. **SP2 Git(L,最大)**:依賴 SP0 的 mock pattern、可選用 SP1 logger;內部 12 task 有嚴格鏈,**先做 T1(解源頭 working-tree)再 T3(typed ConfirmModal,先補 3 個 CSS 變數)**,因 T3 是 5 個寫操作 task 的共同前置且補完的 ConfirmModal typed 變體會回饋給全 IDE。交付序:T1→T3→T2→T4→T5→T6(修 detached bug)→T7→T8→T9(MVP 整檔)→T10→T11(export 用 pickWorkspaceFolder)→T12(間距,保留 commit body)。

4. **SP3 LSP(L)**:新增 FnMode `lang` 是獨立 surface,與既有功能低耦合;內部先做 T1-T6 純函式/型別(高度可測、含 normSeverity 大小寫修正),再 T7 controller 接線(tsc 硬 gate + mock-IPC key 對齊),再 T8-T10 UI。**T11(hover/completion)在 owner 拍板前不計入交付**——這是與原始焦點的已知偏差,必須在里程碑 gate 顯式提報給 owner 決策。

5. **SP4 connected-domains(M)**:純前端三層樣板補齊,風險最低、與其他子專案最解耦,放最後收尾;同樣先純函式/store(T1-T6)→controller(T7,sftpReconnect 先抽 connectAndList)→UI(T8-T10)。

並行選項:資源充足時 SP2/SP3/SP4 可在 SP1 完成後三線並行(它們不共用可變狀態,只各自 import 既有 features/*-api),唯一需協調的是 **ConfirmModal**:SP2-T3 會擴 ConfirmState typed 變體,若 SP1 recovery discard 也碰 ConfirmModal,須由 SP2-T3 先落地該擴充、SP1 沿用,避免兩邊各改一份。

---

## 共用基礎先行(哪些先做讓後面受惠)

- **SP0 bug 先清** → 恢復 real 模式檔案樹;同時把「controller 整合測試 + core mock(必 export transformCallback/Channel,先設 window.__TAURI_INTERNALS__={})」這條 pattern 跑通,SP1-T4/SP2/SP3 的 controller 測試直接複製此慣例。
- **SP1-T0(append 包 {event})最先修** → 解開整條 ide-logger 鏈;之後 **SP1.logDiag helper** 落地 → SP2 git 寫操作 / SP3 LSP 動作 / SP4 db/remote/browser 動作皆可 fire-and-forget 埋點,免回頭補可觀測性。
- **SP2-T3 typed ConfirmModal + 補 3 個 CSS 變數(--yz-5b2730/0e131d/3a1a22)** → 不只 SP2 內 5 個寫操作 task,連 SP1 recovery discard 與全 IDE 未來 destructive 操作都受惠;CSS 變數補定義也修掉既有 `.yz2-btn-danger` 引用未定義變數的潛在樣式 bug。
- **SP2-T1(GitData working-tree 欄位)** → 子專案內 T2/T4/T9 的源頭,且修掉「git_status 已抓卻被 mapGitLog 丟棄」這個資料流斷點,讓所有讀 p.git 的元件(GitGraphView/SidePanel/badge)拿到完整資料。
- **既有不可動的鏈**:bunfig.toml→test-dom.preload.ts→test-dom.ts(happy-dom)、createV2Store 測試工廠、features/git 與 features/language 的 exported 純函式(decorationMapFromStatus/flattenTree/applyTextEdits 思路)——全部複用、零重造。

---

## 里程碑與每階段驗證 gate

每個 gate 的硬指標統一為:`bun test src/v2/` ≥ 上一里程碑 pass 數(基線 71,只增不減)、`bunx tsc --noEmit` EXIT 0(注意:package.json 無獨立 tsc script,build 為 `tsc && vite build`,故須直接 `bunx tsc --noEmit`)。

- **M0 — SP0 綠**:新 controller 整合測試先 RED 重現「子資料夾空白」、改 5 行+import+守門後轉綠;native 桌面殼手動驗證子資料夾可展開且 root 層展開不退步(144/158/719 行為不變)。Gate:`bun test src/v2/` ≥ 71+新測試、tsc EXIT 0。
- **M1 — SP1 三件套就緒**:T0 append {event} 修好;純函式測試綠;SettingsModal 三個 custom section 可開;**native 手動驗證 metric_snapshot 回得了真實數字**(v1 從未實跑)、logger 事件清單有資料、recovery autosave 寫得出備份且 restore 灌回 tab 後不立即 dirty(realPath 已設、saveFile 不 no-op)。Gate:測試數再增、tsc EXIT 0、logDiag helper 對外可用。
- **M2 — SP2 Git 完整**:T1→T12 依序綠;純函式(mapGitStatusGroups/mapDiffHunks/blameLineMap)TDD red-green;**checkout detached bug 修復驗證**(gitCheckoutBranch 送 branch 名、HEAD 落在 branch 而非 detached);typed-confirmation token 與後端逐字相符(複用 confirmationTextForGitAction);export 用絕對路徑成功;mock-IPC 手動驗 staging/diff/stash/reset/blame。Gate:`bun test src/v2/` 維持 71 不退 + 新 case、tsc EXIT 0。
- **M3 — SP3 LSP 階段 1**:T1-T10 已綠;normSeverity 大小寫兩種輸入已測;diagnostics 入站 key===tab.path 的 mock-IPC 斷言已通過;rename 跨檔 best-effort + 落盤同步 content/savedContent 已覆蓋。2026-06-13 gate:`bun test src/v2/`=158 pass,`bunx tsc --noEmit`=0。Owner 已選 T11 option 2,hover/completion 延後。
- **M4 — SP4 三域子集**:T1-T12 自動化實作已綠且 review 通過;sftpReconnect 抽 connectAndList 後既有 sftp store 測試仍守住 sftpOpen 行為;mutation chip re-run 不閃失(627 補 kind);browser 縮圖顯示;SFTP one-off command prompt 呼叫 `run_remote_command` 並 toast exit/stdout preview;SFTP stale enter/transfer responses 已補 guard。2026-06-13 gate:`bun test src/v2/`=180 pass,`bunx tsc --noEmit`=0。Native one-off command smoke 待真 SSH profile。

---

## 整體風險

1. **controller real 路徑普遍無單元測試覆蓋**(SP1-T4/SP2/SP3/SP4 共通):v2 controller import 即連帶拉 Tauri 模組(@tauri-apps/api/core + event),mock.module 須在 import 前生效且完整 export(transformCallback/Channel),否則 module-eval 期 throw(不是 test fail 是 load error)。緩解:邏輯盡量下沉到可測純函式 + smoke 測試,真 gate 落 native 手動驗證——這與 MEMORY 記錄的「mock-IPC 過不代表 native 過」陷阱一致。
2. **native 才能證實的指令**:metric_snapshot(SP1,v1 從未實跑)、全部 lsp_*(SP3,orphan 從未跑)、~30 個 git 寫操作(SP2)、browser_capture_preview(SP4,macOS-only)——mock-IPC 綠只證轉換正確,須桌面殼逐一確認回得了資料。
3. **camelCase / token 逐字相符陷阱**:SP0 的 args.workspaceRoot(非底線版,誤用會假綠)、SP2 的 typed-confirmation token 須與 Rust require_confirmation expected 逐字一致(reset/revert 的 short 後端用 short_hash_of 重算,abbrev 長度不同會被拒)、SP3 diagnostics 入站 key 須與 tab.path 同源——任一錯位都造成「測試綠但功能空/被拒」。
4. **ConfirmModal 雙寫風險**:若 SP1 recovery 與 SP2 寫操作並行各改 ConfirmState,須由 SP2-T3 先落地 typed 變體 + 補 3 個 CSS 變數,其餘沿用。
5. **範圍偏差須顯式提報**:SP3-T11(hover/completion)與 SP4 被排除的後端缺口子集(SFTP delete/rename/mkdir、browser console/network、DB 主動攔截)是與原始焦點的已知偏差,均因「需先動 Rust / textarea 像素定位脆弱」,須在 M3/M4 gate 向 owner 說明,而非靜默縮減。
6. **效能/全量 reload 退化**(SP2):reloadGit 多帶 working-tree groups 後變重,頻繁寫操作後全量 reload 成本上升;維持現有範式先不優化,但記錄為後續 perf 候選。
7. **多螢幕/高 DPI 座標偏移**(SP4 browser):screencapture -R 用實體像素 vs getBoundingClientRect 邏輯像素,MVP 單螢幕驗證、DPI 縮放列已知風險,刻意不前端硬編平台判斷。

---

## 附錄:統合結構化資料

### 執行順序

SP0 → SP1 → SP2 → SP3 → SP4

### 跨專案相依

- **SP2 → SP1**:軟相依非阻塞:SP2 git 寫操作(commit/checkout/reset/stash/merge)可選擇性掛 SP1 的 logDiag helper 做 fire-and-forget 埋點;SP1 未就緒時 SP2 仍可獨立交付,只是少了 diagnostic event 埋點
- **SP3 → SP1**:軟相依非阻塞:SP3 LSP 動作(gotoDefinition/findReferences/renameSymbol/openFile)可掛 SP1 logDiag 埋點;SP1 未完成時 SP3 接線仍可獨立交付
- **SP4 → SP1**:軟相依非阻塞:SP4 db/remote/browser 動作可掛 SP1 logger/共用基礎;無跨子專案硬依賴,SP4 自身 T1-T6 純函式為其 T7 controller、T8-T10 UI 的內部前置

### 里程碑

1. M0 — SP0 綠:controller 整合測試先 RED 重現子資料夾空白,改 5 行(168/347/772/829/862 scanWorkspace→scanDirectory)+1 import+toggleDir 守門後轉綠;native 驗證子資料夾可展開且 144/158/719 root 層不退步。Gate:bun test src/v2/ ≥ 71+新測試、bunx tsc --noEmit EXIT 0
2. M1 — SP1 三件套:先修 T0(appendDiagnosticEvent 包 {event},解開 logger 鏈);純函式測試綠;SettingsModal 三 custom section 可開;native 驗 metric_snapshot 回真實數字(v1 從未實跑)、logger 清單有資料、recovery restore 灌回 tab 不立即 dirty。Gate:測試數再增、tsc EXIT 0、logDiag helper 對外可用
3. M2 — SP2 Git 完整:T1(working-tree 源頭)→T3(typed ConfirmModal,先補 --yz-5b2730/0e131d/3a1a22)→...→T12 依序綠;純函式 TDD;checkout detached bug 修復(gitCheckoutBranch 送 branch 名);typed-confirmation token 與後端逐字相符;export 用絕對路徑成功。Gate:bun test src/v2/ 維持 71 不退+新 case、tsc EXIT 0
4. M3 — SP3 LSP 階段 1:T1-T10 已綠;normSeverity 大小寫兩種輸入已測;diagnostics 入站 key===tab.path 斷言通過;rename 跨檔 best-effort + 落盤同步 content/savedContent 已覆蓋。Gate 結果(2026-06-13):bun test src/v2/ = 158 pass,bunx tsc --noEmit = 0;owner 選 T11 option 2,hover/completion 延後
5. M4 — SP4 三域子集:T1-T12 自動化實作已綠且 review 通過;sftpReconnect 抽 connectAndList 後既有 sftp store 測試守住 sftpOpen;mutation chip re-run 不閃失(627 補 kind);browser 縮圖;run_remote_command prompt + exit/stdout preview;stale enter/transfer responses guard。Gate 結果(2026-06-13):bun test src/v2/ = 180 pass,bunx tsc --noEmit = 0;native one-off command smoke 待真 SSH profile

### 需求覆蓋檢查

7 項需求對照子計劃,0 遺漏(逐一交叉驗證 metadata 與 codebase 事實):
(1) language LSP → SP3(階段 1 T1-T10 必做:didOpen/didChange/didClose + diagnostics 行底線/gutter/面板 + go-to-definition + find references + rename;階段 2 T11 hover/completion 待 owner 拍板,屬已標記的範圍偏差非遺漏)。已驗證:FnMode 目前為 files|git|db|ssh|agent 無 lang→SP3 新增 lang;language-api 12 wrapper 已存在;SP3 唯一新增 thin wrapper getDocumentDiagnostics。
(2) 效能預算/監控 → SP1(metric_snapshot 數字卡 + 手動 Refresh)。已驗證為 v1 從未實跑的指令,native gate 在 M1。
(3) recovery → SP1(save/list/discard_unsaved_backup:autosave debounce + restore 灌回 tab + discard 走 ConfirmModal)。
(4) 更完整 git + UI 美觀 → SP2(staging/diff/branch/stash/reset/rebase/conflict/blame/file-history/export + log filter + git head 兩列重排,且修 checkout detached bug)。已驗證:git-api 41 wrapper 全齊、0 後端改動;decorationMapFromStatus 有 export、decorationForChange(git-model.ts:548)無 export 故 SP2 正確改用前者。
(5) ide-logger 設定頁籤 → SP1(append/list_diagnostic_events 埋點 + 事件清單,經 SettingsModal 自訂 render 出口呈現)。已驗證 T0 latent bug 屬實:appendDiagnosticEvent 送 flat {level,source,message} 但 Rust commands.rs:230 簽名為 event:DiagnosticEventInput→須包 {event}。
(6) 資料夾無法展開 bug → SP0(controller 5 處子目錄 scanWorkspace→scanDirectory)。已驗證:168/347/772/829/862 確為 scanWorkspace(<descendant>);144/158/719 為合法 root 層呼叫須保留。
(7) database/remote/browser 功能 → SP4(DB query history + mutation 分類 chip + footer total fallback;remote disconnect/reconnect + run_remote_command prompt;browser 區域截圖縮圖)。`run_remote_command` 已接自動化/IPC gate,native smoke 待真 SSH profile。被排除子集(SFTP delete/rename/mkdir、browser console/network、DB 主動攔截)已在 SP4 metadata 明確標記為後端缺口、需先動 Rust,屬範圍界定非遺漏。
基線一致性:三個子計劃聲稱的 bun test = 71 pass 已實測確認(71 pass/0 fail/3 檔);所有子計劃驗證 gate 統一為 bun test src/v2/ 不退 + bunx tsc --noEmit EXIT 0。

### 殘留風險

- controller real 路徑普遍無單元測試(SP1-T4/SP2/SP3/SP4):import 即拉 Tauri 模組,mock.module 須 import 前生效且完整 export transformCallback/Channel,否則 module-eval 期 throw(load error 非 test fail);緩解=純函式下沉+smoke+native gate,對齊 MEMORY 陷阱
- 多項能力 mock-IPC 綠不等於 native 綠,須桌面殼逐一確認:metric_snapshot(SP1,v1 從未實跑)、全部 lsp_*(SP3 orphan)、~30 git 寫操作(SP2)、browser_capture_preview(SP4 macOS-only)
- camelCase/token 逐字相符陷阱:SP0 args.workspaceRoot 非底線版(誤用假綠)、SP2 typed-confirmation 須與 Rust require_confirmation expected 逐字一致(reset/revert short 後端用 short_hash_of 重算,abbrev 長度不同會被拒)、SP3 diagnostics 入站 key 須與 tab.path 同源;任一錯位=測試綠但功能空/被拒
- ConfirmModal 雙寫:SP1 recovery discard 與 SP2 寫操作若並行各改 ConfirmState 會衝突;須 SP2-T3 先落地 typed 變體+補 3 個 CSS 變數(--yz-5b2730/0e131d/3a1a22),其餘沿用
- 範圍偏差須顯式向 owner 提報而非靜默縮減:SP3-T11 hover/completion(textarea 像素定位脆弱,M3 gate 三選一)、SP4 被排除子集 SFTP delete/rename/mkdir + browser console/network + DB 主動攔截(後端缺口,需先動 Rust)
- 效能退化(SP2):reloadGit 多帶 working-tree groups 後變重,頻繁寫操作後全量 reload 成本上升;維持現範式先不優化,記為後續 perf 候選
- 多螢幕/高 DPI 座標偏移(SP4 browser):screencapture -R 實體像素 vs getBoundingClientRect 邏輯像素,MVP 單螢幕驗證,DPI 縮放列已知風險;browser_capture_preview 非 mac 回 Err 但 UI 鈕仍可見(刻意不硬編平台判斷,errMsg→toast 兜底)
- autosave debounce 生命週期(SP1):setTabContent 高頻 onChange→controller 模組級 Map debounce 600ms,切 project/關 tab 須清 timer 否則寫到舊 tab;restore 後 realPath 未設會讓 saveFile(行 592 !tab.realPath 守衛)後續 silently no-op
