# SP2 Git Power & UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 v2 Git 從 log/commit 基礎功能升級為完整 source-control surface，包含 staging、diff、branch、stash、reset/rebase、conflict、blame、file history、export 與 UI 間距修正。

**Architecture:** Git data 先在 `bridge.ts` / `v2-model.ts` 補齊可測純函式與狀態，再由 store actions 透過 RealDelegate 委派 controller；controller 只做 async git-api glue 和 reload。所有 destructive 操作走 typed ConfirmModal，所有 demo 分支要保留不需 Tauri 的 fallback。

**Tech Stack:** React TSX、Bun test、Tauri git wrappers、`src/features/git/*`、`src/v2/v2-store.ts`、`src/v2/controller.ts`、`src/v2/SidePanel.tsx`、`src/v2/GitGraphView.tsx`。

---

> 子計劃 · 2026-06-13 · 規模:12 tasks · L（大型子專案）。後端 0 改動、git-api wrapper 0 改動（41 個 command + 對應 wrapper 全齊，confirmation 參數位置已逐一驗證）。工作量集中在:store git actions(~30 個)/controller git delegate methods(~28 個)/5 個新 UI 元件(DiffView/ConflictView/BranchPopup/StashPanel + blame 疊層)/ConfirmModal typed 變體(含補 3 個 CSS 變數)/SidePanel GitBody 重寫/GitGraphView 兩列 head 重排 + 一批 yz2-git-* CSS。純函式(mapGitStatusGroups 用 decorationMapFromStatus+groupGitChanges、mapDiffHunks、blameLineMap)可 TDD red-green 且不動 features/git 任何 export;store demo 分支與 typed-confirm 流程可單元測(createV2Store);controller real 路徑靠 mock-IPC 手動驗。交付順序 T1(解源頭)→T3(解 typed confirm 前置,先補 CSS 變數)→T2→T4(DiffView)→T5→T6(修 detached bug)→T7→T8→T9(MVP 整檔 accept-side)→T10→T11(export 用 pickWorkspaceFolder)→T12(間距,保留 commit body)。

**相依:**

- SP2-T1 為 T2/T4/T9 的前置(GitData working-tree 欄位)
- SP2-T3 typed ConfirmModal 為 T2(discard)/T6(checkout/delete)/T7(drop)/T8(reset/rebase)/T9(accept-side) 的前置；T3 GREEN 前須先在兩個 :root 補定義 --yz-5b2730/0e131d/3a1a22
- SP2-T4 DiffView 為 T5(hunk staging)/T12(detail 補 diff) 的前置
- 本子專案不依賴 SP1 logger;若 SP1 已就緒,git 寫操作(commit/checkout/reset/stash/merge)可選擇性加 fire-and-forget logDiag 埋點,但非必要
- 共用基礎:git-model.ts/git-diff-model.ts/git-api.ts 全部在 src/features/git/(非 src/v2/),v2 以 ../features/git/ 相對路徑 import;確認 createV2Store 測試工廠(v2-store.test.ts 既有)用於 store demo 分支與 confirm 流程測試

**摘要:** 把後端早已齊全的 git 指令裡尚未接的 ~30 個（41 個 git command + 對應 git-api wrapper 全齊、0 後端改動）接進 v2 兩個既有 surface（SidePanel GitBody + GitGraphView），讓 source control 具備一般 IDE 的完整能力：working-tree 變更清單與 path/hunk/line 級 staging、unstaged/commit diff viewer、branch popup（建立/切換/合併/刪除/改名，並修掉「checkout 只能 detached」的明確 bug）、stash 清單與 apply/pop/drop/branch、reset(soft/mixed/hard)/rebase 入口、三路 conflict resolver（MVP 先整檔 accept-side，per-block 寫回為次階段）、blame gutter、file history、export patch/archive，外加 log filter 真正打後端。全部嚴格照 store→RealDelegate→controller delegate→git-api 分層、demo/real 雙模式、新增的 typed-confirmation ConfirmModal 變體，與 yz2-*/--yz-* 樣式。關鍵修正（對抗審查後）：(1) git-model.ts / git-diff-model.ts 在 src/features/git/ 而非 src/v2/，v2 已用 ../features/git/ 路徑 import；(2) st 映射用既有 exported decorationMapFromStatus（path→A/M/D/U），不依賴 private 的 decorationForChange；(3) export destDir 必須絕對路徑，用既有 pickWorkspaceFolder()（open({directory:true})）選資料夾，移除「固定 ~/Downloads」假設（Rust 端 !dest.is_absolute() 直接拒、不展開 ~）；(4) ConfirmState 先擴 typed 變體並在兩個 :root 補定義三個未定義變數；(5) blame/conflict/diff 送 repo-relative tab.path（後端以 repository_root 正規化），標註 workspace_root===repository_root 前提。第一刀（T1 GitData+mapGitStatusGroups 帶入 status.changes）解掉「git_status 已抓卻被 mapGitLog 丟棄」的源頭。產出：擴充的 GitData/bridge mapper（純函式可測）、一批 store git actions、controller git delegate methods、新 DiffView/ConflictView tab 與 BranchPopup/StashPanel/ResetMenu/blame overlay 元件、yz2-git-* CSS 與兩列式 git head 重排。

---

## 目標

把 git 從目前 v2 只接的 ~11 個指令（log 瀏覽 + commit + cherry-pick/revert/checkout-commit + sync）升級到完整版控，接滿後端已存在的能力，並把 git UI 從「擠在單行 44px」整理成兩列式、加 min-width 與可捲區。功能對齊一般 IDE 的 source control 期待：

1. **Working-tree staging**：顯示 staged / changes / conflicts 三段檔案清單，path 級 stage/unstage/discard，hunk/line 級部分暫存。
2. **Diff viewer**：點 working-tree 檔案看 unstaged/staged diff（`git_diff_hunks`）、點 commit 內檔案看該 commit diff（`git_commit_file_diff`），補掉 GitGraphView real 模式 detail 面板的「永遠空 diff」缺口。
3. **Branch ops**：branch popup（`git_branches_full`）做 create/checkout/merge/delete/rename，**修正明確 bug**：現有 `gitCheckout`（controller.ts:875）呼叫 `checkoutGitBranch(root, fullHash, "CHECKOUT " + fullHash)`，把 commit full hash 當 branch name 送 → `git checkout {hash}` → 永遠 detached；新增 `gitCheckoutBranch(name)` 傳 branch 名修掉，舊的 commit-checkout（detached）行為保留。
4. **Stash**：清單 + apply/pop/drop(typed)/branch。
5. **Reset / Rebase 入口**：commit 右鍵加 reset-to(soft/mixed/hard)，head 加 reset-hard / rebase-onto。
6. **Conflict resolver**：MVP 整檔 ours/theirs accept-side（後端 `accept_conflict_side`），三欄顯示 base/ours/theirs 與 per-block pick UI；per-block 文字寫回（`resolveConflictText` + writeTextFile + markGitResolved）列為次階段。
7. **Blame gutter**：編輯器疊層顯示每行 author/commit。
8. **File history**：檔案右鍵「此檔 git 歷史」。
9. **Export commit**：commit 右鍵 export patch/archive（destDir 經 pickWorkspaceFolder 取絕對路徑）。
10. **Log filter (real)**：`setGitFilter` 真正回打 `git_log_page` 的 author filter；commit 暴露 amend/push-after。

非目標：不新增 FnMode（git 既有兩個 surface 夠用）；不改後端（41 指令全齊）；不把編輯器換成 Monaco（blame 用 textarea 疊層 gutter）；不做 GitGraphView 的 SVG DAG 重寫（只重排 head/detail 間距）；不做 per-block 三路自動合併演算法（僅用既有 accept-side + resolveConflictText 文字組裝）；不做 commit signing/GPG、不做 interactive rebase todo 編輯（後端只給 rebase_onto）；不做「從指定 commit 建 branch」（`create_branch` 只能從 HEAD，無 start-point）。

## File Structure

- Modify: `src/v2/v2-model.ts` — extend `GitData`, `TabKind`, tab fields, commit options, blame helper.
- Modify: `src/v2/bridge.ts` — add `mapGitStatusGroups` and `mapDiffHunks`; keep `mapGitLog` signature stable.
- Modify: `src/v2/v2-store.ts` — add git actions, typed confirmations, demo fallbacks, and RealDelegate git methods.
- Modify: `src/v2/controller.ts` — implement real git delegate methods and expand `reloadGit`.
- Modify: `src/v2/Overlays.tsx` — add typed ConfirmModal input and git context menu actions.
- Modify: `src/v2/SidePanel.tsx` — replace GitBody with source-control sections.
- Modify: `src/v2/GitGraphView.tsx` — split head into two rows and preserve commit body while adding commit-file diff.
- Modify: `src/v2/ContentViews.tsx` — add diff/conflict/history view hooks and blame gutter wiring.
- Modify: `src/v2/TabStrip.tsx` — add glyphs for `diff`, `conflict`, and `history`.
- Create: `src/v2/DiffView.tsx` — render working-tree and commit diffs.
- Create: `src/v2/ConflictView.tsx` — render conflict MVP accept-side flow.
- Create: `src/v2/BranchPopup.tsx` — render branch operations.
- Create: `src/v2/StashPanel.tsx` — render stash operations.
- Modify: `src/v2/yuzu.css` — add typed confirm, git source-control, diff, conflict, branch, stash, blame styles.
- Test: `src/v2/bridge.test.ts`, `src/v2/v2-model.test.ts`, `src/v2/v2-store.test.ts`.

---

## ⚠️ 對抗審查後的關鍵修正（實作前必讀）

**A. 檔案路徑：git-model.ts / git-diff-model.ts 在 `src/features/git/`，不在 v2 目錄。** 舊草案曾把 git model 寫成 v2 下的檔案，這是錯的。bridge.ts 已有 `import type { GitRepositoryStatus } from "../features/git/git-model"`、controller.ts 已 `from "../features/git/git-api"`。所有複用一律走 `../features/git/...` 相對路徑。

**B. st 映射不要依賴 `decorationForChange`（private）。** git-model.ts:548 `decorationForChange` 無 export 關鍵字，bridge import 會編譯失敗。**改用既有 exported `decorationMapFromStatus(status): Record<path, "A"|"D"|"M"|"U">`（git-model.ts:507）** —— 它內部就呼叫 decorationForChange，回傳 path→st 的 map，bridge 直接查表即可，無需動 git-model 任何 export。`groupGitChanges`（:364，已 export，回 `{staged, unstaged, conflicts}`）負責分組。兩者組合即可產出 GitFile[]。

**C. Export destDir 必須絕對路徑。** Rust `git_export_commit`（commands.rs:1973）對 dest 做 `dest.as_os_str().is_empty() || !dest.is_absolute()` 檢查，失敗回 `export destination must be an absolute path`，且**不展開 `~`**。**移除草案「固定 ~/Downloads」MVP** —— 改用 controller 已 import 的 `pickWorkspaceFolder()`（features/workspace/workspace-api.ts:41，`open({directory:true})`，回絕對路徑或 null）讓使用者選資料夾；null 則取消。

**D. ConfirmModal typed 變體與 CSS 變數必須先補。** `ConfirmState`（v2-store.ts:213）目前只有 `{title, body, label, danger?, action}`，**無 typed 欄**；`ConfirmModal`（Overlays.tsx:443）無 input gate。yuzu.css 的 `--yz-5b2730 / --yz-0e131d / --yz-3a1a22` 被引用（:1679/:1694/:1714/:1717，含既有 .yz2-btn-danger）但**在兩個 :root（:51 dark、:103 light）都未定義**。T3 GREEN 前必須在兩個 :root 補定義這三個變數，否則新 danger 樣式與既有 .yz2-btn-danger 都吃到無效變數。

**E. blame/conflict/diff 的 path 基準是 repository_root，不是 workspace scan root。** git.rs `blame_file`(:1458)/`conflict_file`(:1332)、git_log.rs `file_history`(:830) 與既有的 `stage_paths`(:124)/`diff_hunks` 都用 `normalize_*paths(&repository_root, ...)`。v2 的 `tab.path` 是相對 workspace scan root；**當 workspace_root === repository_root 時才一致**（既有 stage/diff 共用此假設，非本計畫新引入）。一律送 `tab.path`（相對、非 realPath 絕對），並在 wiringNotes 標註 workspace 為 repo 子目錄時可能錯位（沿用既有模式，先不修但記錄）。

**F. GitGraphView real 模式 detail 下半不是空白，是 commit body。** GitGraphView.tsx:80 `diff = selC && !isReal ? buildDiff(selC) : []`（real 永遠空），:215 顯示的是 `realBody || selC?.m`（commit message body，:81）。T12「補 diff」要**保留 body 顯示**（移位或在 CHANGED FILES 點檔時切換到 diff），勿回歸刪掉 commit message。

**G. confirmation short hash 基準。** 後端 reset_to/revert（git_log.rs:768/786）的 token 用 `short_hash_of(workspace_root, &full_hash)` **重算**，非取自 client。v2 commit 的 `c.h` = mapGitLog 的 `r.short_hash`（git log 預設縮寫），與 `short_hash_of` 同源通常一致，但屬潛在風險：token 一律用 `confirmationTextForGitAction({kind:"reset-to", short: c.h, mode})`，若後端因 abbrev 長度不同而拒，需以 full hash 對齊（次階段）。

**H. getGitFileHistory 回 GitLogPage 不是 GitCommit[]。** 簽名 `getGitFileHistory(root, path, limit): Promise<GitLogPage>`（git-api.ts:337）；history tab 取 `page.rows`（GitLogRow[]），用既有 `mapGitLog`/git row 樣式渲染。

**I. 基線：`bun test src/v2/` = 71 pass / tsc EXIT=0**（bridge 18 + v2-model 22 + v2-store 31 風格，bun 展開 71）。新增 case 後須維持 71 不退 + 新增綠燈。

---

## 架構與接線點（鐵則：store 絕不 import controller；real 走 `realDelegate?.xxx()`，demo 走假資料；destructive 走 ConfirmModal + typed confirmation）

### 0. 根因：bridge.ts `mapGitLog` 丟棄 `status.changes`
`bridge.ts:99 mapGitLog()` 只回 `{ahead, behind, commits}`，把 `GitRepositoryStatus.changes`（`GitFileStatus[]`，含 `index_status`/`worktree_status`/`kind`）整批丟掉；`v2-model.ts:123 GitData` 也只有 `ahead/behind/commits`，無 working-tree 欄位。**這是所有 staging/diff 缺口的源頭，必須先補。**

- **GitData 擴充**（`v2-model.ts:123`）新增：
  ```
  staged: GitFile[]
  unstaged: GitFile[]
  conflicts: GitFile[]
  hasConflicts: boolean
  branch: string          // 目前 branch（status.branch ?? ""）
  upstream: string | null
  branchesFull: GitBranchFull[]   // branch popup 資料（初始 []）
  stashes: GitStashEntry[]        // stash panel 資料（初始 []）
  conflictChoices: Record<number, "ours" | "theirs">  // 純 UI per-block 選邊（初始 {}）
  ```
  新增型別 `GitFile = { path: string; kind: GitChangeKind; st: "A"|"M"|"D"|"U"; staged: boolean }`（`kind`/`GitBranchFull`/`GitStashEntry` 從 `../features/git/git-model` re-import 型別；`st` 由 `decorationMapFromStatus` 查表得）。
- **新 bridge 純函式** `mapGitStatusGroups(status: GitRepositoryStatus | null): { staged; unstaged; conflicts; hasConflicts; branch; upstream }`：內部 `const grouped = groupGitChanges(status.changes)`（已分 staged/unstaged/conflicts）+ `const decos = decorationMapFromStatus(status)`（path→st）；對每組 map 成 `GitFile`（`st: decos[c.path]`、`staged: 組別`）。status 為 null 回空組 + `branch:""`/`upstream:null`/`hasConflicts:false`。**不引用 private decorationForChange。** bridge.test.ts 加 case。
- **`mapGitLog` 不擴簽名**（保持回 `{ahead,behind,commits}`，避免牽動既有測試）；改在 `reloadGit` 內把 `mapGitLog(...)` 與 `mapGitStatusGroups(status)` 合併寫進 `p.git`（見 §4）。
- **新 bridge 純函式** `mapDiffHunks(hunks: GitDiffHunks): DiffRow[]`：攤平 `hunks[].lines[].{kind,old_no,new_no,text}` 成 v2 顯示用 `DiffRow = { t: "h"|"x"|"a"|"d"; s: string; oldNo: number|null; newNo: number|null; hunkIndex: number; lineIndex: number }`（kind add→`a`/del→`d`/context→`x`，每個 hunk 前插一列 `t:"h", s: hunk.header`）。lineIndex 為該 hunk 內 line 序（給 hunk/line 級 selectionsForApi 用）。沿用既有 `.yz2-diff-line` 視覺。bridge.test.ts 加 case。

### 1. RealDelegate 介面擴充（`v2-store.ts` RealDelegate type）
新增 method 簽名（同步、回 void，controller 內用 `void (async()=>{})()`）；token 參數由 store 端 ConfirmModal 取得使用者輸入後 forward：
```
gitStage: (paths: string[]) => void
gitUnstage: (paths: string[]) => void
gitDiscard: (paths: string[], token: string) => void
gitStageAll: () => void                               // = gitStage(全部 unstaged path)
gitUnstageAll: () => void
gitOpenDiff: (path: string, staged: boolean) => void
gitStageHunks: (path: string, sel: HunkSelection[]) => void
gitUnstageHunks: (path: string, sel: HunkSelection[]) => void
gitRevertHunk: (path: string, sel: HunkSelection[], token: string) => void
gitOpenCommitDiff: (hash: string, path: string) => void
gitLoadBranches: () => void
gitCreateBranch: (name: string) => void
gitCheckoutBranch: (name: string, token: string) => void   // 修 detached bug
gitMergeBranch: (name: string) => void
gitDeleteBranch: (name: string, token: string) => void
gitRenameBranch: (from: string, to: string) => void
gitLoadStashes: () => void
gitStash: (message: string, includeUntracked: boolean) => void
gitStashApply: (index: number) => void
gitStashPop: (index: number) => void
gitStashDrop: (index: number, token: string) => void
gitStashBranch: (index: number, name: string) => void
gitResetHard: (token: string) => void
gitResetTo: (hash: string, mode: "soft"|"mixed"|"hard", token: string) => void
gitRebaseOnto: (target: string, token: string) => void
gitLoadConflict: (path: string) => void
gitAcceptSide: (path: string, side: "ours"|"theirs", token: string) => void
gitMarkResolved: (path: string) => void
gitResolveWrite: (tabId: number, path: string, content: string) => void  // 次階段
gitLoadBlame: (tabId: number, path: string) => void
gitFileHistory: (path: string) => void
gitExportCommit: (hash: string, scope: GitExportScope, format: GitExportFormat) => void  // destDir 由 controller 經 pickWorkspaceFolder 取
setGitLogFilter: (author: string | null) => void
commitGit2: (message: string, amend: boolean, pushAfter: boolean) => void
```

### 2. store git actions（`v2-store.ts`，每個 real 委派 / demo 假資料）
新增對外 action（demo 分支用 `upd()`/`get().showToast()`，real 分支 `realDelegate?.xxx(); return`）。**所有 typed confirmation 用新的 ConfirmModal typed 變體（§6），token 字串一律由 `../features/git/git-model` 的 `confirmationTextForGitAction()` 產生**（已驗證逐字編碼：discard→`DISCARD`、checkout→`CHECKOUT {branch}`、reset-hard→`RESET HARD`、rebase→`REBASE {target}`、reset-to→`RESET {short}`/`RESET HARD {short}`、drop-stash→`DROP stash@{index}`、delete-branch→`DELETE {branch}`、accept-side→`ACCEPT OURS`/`ACCEPT THEIRS`、revert-commit→`REVERT {short}`）。**切勿自拼字串，切勿用 `confirmationFromError`**（那是 SQL 專用 marker `requires confirmation text:`；git 後端是「先要 token 才執行」、失敗回 `confirmation must be exactly:`）。

- `stageFiles(paths)` / `unstageFiles(paths)` / `stageAll()` / `unstageAll()`
- `discardFiles(paths)`：`openConfirm({danger:true, typed: confirmationTextForGitAction({kind:"discard",paths}), action: () => realDelegate?.gitDiscard(paths, "DISCARD")})`
- `openWorkingDiff(path, staged)`、`openCommitFileDiff(hash, path)`
- `stageHunks/unstageHunks`、`revertHunk(path, sel)`（typed `DISCARD`）
- `openBranchPopup()`（real → `gitLoadBranches`；toggle `branchPopupOpen`）、`createBranch(name)`、`checkoutBranch(name)`（typed `CHECKOUT {name}`，action 內 `gitCheckoutBranch(name, token)`）、`mergeBranch(name)`、`deleteBranch(name)`（typed `DELETE {name}`）、`renameBranch(from,to)`、`closeBranchPopup()`
- `openStashPanel()`、`stashChanges(msg, incl)`、`applyStash(i)/popStash(i)/dropStash(i)`（typed `DROP stash@{i}`）/`stashToBranch(i, name)`
- `resetHard()`（typed `RESET HARD`）、`resetTo(idx, mode)`（typed，short 用 `commits[idx].h`）、`rebaseOnto(target)`（typed `REBASE {target}`）
- `openConflict(path)`、`chooseConflictBlock(blockIdx, side)`（純 UI，寫 `p.git.conflictChoices`）、`acceptConflictSide(path, side)`（typed `ACCEPT OURS/THEIRS`）、`markResolved(path)`、`writeResolution(tabId, path)`（次階段：用 `resolveConflictText(tab.conflict.working, tab.conflict.blocks, p.git.conflictChoices)` 組內容 → `gitResolveWrite`）
- `toggleBlame(tabId)`（real → `gitLoadBlame`）
- `openFileHistory(path)`、`exportCommit(idx, scope, format)`
- `setGitFilter(filter)` 改寫：保留前端 dim（`upd(q=>{q.gitFilter=filter})`），real 模式額外 `realDelegate?.setGitLogFilter(filter==="all"?null:filter)`
- `setCommitAmend(v)`/`setCommitPush(v)`：寫 `p.commitAmend`/`p.commitPush`
- `doCommit` 改：保留簽名與既有 confirm（若有），real 分支由 `commitGit2(msg, p.commitAmend, p.commitPush)` 取代固定 `false,false`

### 3. controller git delegate methods（`controller.ts`，import 既有 git-api wrapper）
在頂部 git-api import 區（`controller.ts:25-35` 的 `from "../features/git/git-api"` block）補入：`getGitDiffHunks, stageGitPaths, unstageGitPaths, discardGitPaths, stageGitHunks, unstageGitHunks, revertGitHunk, getGitCommitFileDiff, getGitBranchesFull, createGitBranch, mergeGitBranch, deleteGitBranch, renameGitBranch, getGitStashList, stashGit, applyGitStash, popGitStash, dropGitStash, branchFromGitStash, resetGitHard, resetGitTo, rebaseGitOnto, getGitConflictFile, acceptGitConflictSide, markGitResolved, getGitBlameFile, getGitFileHistory, exportGitCommit`（`checkoutGitBranch`/`commitGit`/`revertGitCommit`/`cherryPickGit` 已 import）。另從 git-api 補 type `GitExportScope, GitExportFormat`；從 features/workspace 的 pickWorkspaceFolder 已 import。bridge 補 import `mapGitStatusGroups, mapDiffHunks`。

delegate 物件新增對應 method，全部遵循既有慣例（範式同 doCommit `controller.ts:453`、gitCheckout `:875`）：
```
const pid = store().active; const root = rootOf(pid); if(!root) return
void(async()=>{ try{ await api(...); patchProject(pid, q=>{q.gitLoaded=false}); await reloadGit(pid); store().showToast("✓ ...") }
  catch(e){ store().showToast("Git: "+errMsg(e)) } })()
```
要點：
- **寫操作後一律** `set gitLoaded=false` → `await reloadGit(pid)` 重抓。
- **`gitCheckoutBranch(name, token)`**：`await checkoutGitBranch(root, name, token)`（name=branch 名、token=`CHECKOUT {name}`）→ 修掉 detached bug；舊 `gitCheckout(fullHash, short)` 保留給 commit-checkout。
- **diff tab**：`gitOpenDiff(path, staged)` 用 `tabId()` 開 `type:"diff"` tab，`await getGitDiffHunks(root, path, staged)` → `patchTab` 塞 `t.diff = mapDiffHunks(hunks)`、`t.diffStaged = staged`、`t.path = path`；`gitOpenCommitDiff(hash,path)` 同理用 `getGitCommitFileDiff(root, hash, path)`，`t.diffStaged = undefined`（唯讀）。
- **conflict tab**：`gitLoadConflict(path)` 開 `type:"conflict"` tab，`await getGitConflictFile(root, path)` → `t.conflict = file`、`t.path = path`。
- **blame**：`gitLoadBlame(tabId, path)`：`await getGitBlameFile(root, path)`（path=tab.path 相對）→ `patchTab(pid, tabId, t=>({...t, blame: file}))`。
- **branch popup**：`gitLoadBranches()`：`await getGitBranchesFull(root)` → `patchProject(pid, q=>{q.git.branchesFull = data})`（不 reloadGit）；create/merge/rename 回的也是 GitBranchFull[]/status，寫操作後 reloadGit + 重抓 branchesFull。
- **stash list**：`gitLoadStashes()`：`await getGitStashList(root)` → `q.git.stashes = data`。
- **typed destructive**：discard/checkout-branch/delete-branch/reset-hard/reset-to/rebase/stash-drop/accept-side/revert/revert-hunk 全部把 token 當對應 api 的 confirmation 參數 forward（位置已驗證：discardGitPaths 第3、checkoutGitBranch 第3、deleteGitBranch 第3、dropGitStash 第3、resetGitTo 第4、resetGitHard 第2、rebaseGitOnto 第2、acceptGitConflictSide 第4、revertGitHunk 第4）。
- **conflict 寫回（次階段）**：`gitResolveWrite(tabId, path, content)`：取 tab.version → `await writeTextFile(root, tab.realPath, content, version)`（複用 file-api）→ `await markGitResolved(root, path)` → reloadGit。
- **export**：`gitExportCommit(hash, scope, format)`：先 `const dir = await pickWorkspaceFolder(); if(!dir) return`（絕對路徑）→ `await exportGitCommit(root, hash, scope, format, dir, false)` → toast `exported.destination`（GitExportReport 的 destination 欄）。**不送 ~。**
- **log filter**：`setGitLogFilter(author)`：`await getGitLogPage(root, author?{author}:{}, 120)` → 只 `patchProject` 更新 `q.git.commits`（mapGitLog 重映射 rows，保留 working-tree groups）。
- **file history**：`gitFileHistory(path)`：`await getGitFileHistory(root, path, 200)` → 開 `type:"git"` 或新 `type:"history"` tab，塞 `t.history = mapGitLog(page.rows, null, now).commits`。
- **commit**：`commitGit2(msg, amend, pushAfter)`：`await commitGit(root, msg, amend, pushAfter)` → 清 commitMsg/重置 amend/push → reloadGit。

### 4. reloadGit 擴充（`controller.ts:186`）
現為 `Promise.all([getGitStatus, getGitLogPage])` → `p.git = mapGitLog(page.rows, status, now)`。改成：
```
const base = mapGitLog(page.rows, status, now)
const groups = mapGitStatusGroups(status)
p.git = { ...base, ...groups, branchesFull: p.git.branchesFull ?? [], stashes: p.git.stashes ?? [], conflictChoices: p.git.conflictChoices ?? {} }
```
保留 `selectCommit` 預載 detail 與 meta.branch 同步行為。這樣 SidePanel GitBody 與 GitGraphView 都拿得到變更檔案。

### 5. ProjectUI 同步（`v2-store.ts` defUI:162 / emptyUI:187 對稱）
- **ProjectUI** 新增 `commitAmend: boolean`（預設 false）、`commitPush: boolean`（預設 false）、`branchPopupOpen: boolean`（預設 false）、`stashPanelOpen: boolean`（預設 false）。
- **defUI**：`git: gitFor(pid)` → gitFor（v2-model.ts:321）回傳值需補 working-tree 欄位（staged/unstaged/conflicts 用假分組或空、hasConflicts、branch:meta.branch、upstream:null、branchesFull:[]、stashes:[]、conflictChoices:{}），其餘新欄位於 defUI return 補。
- **emptyUI**：`git: { ahead:0, behind:0, commits:[], staged:[], unstaged:[], conflicts:[], hasConflicts:false, branch:"", upstream:null, branchesFull:[], stashes:[], conflictChoices:{} }`，三個 ProjectUI 新欄位補 false。
- **Tab type**（`v2-model.ts:20`）新增 real 欄位：`diff?: DiffRow[]`、`diffStaged?: boolean`、`conflict?: GitConflictFile`、`blame?: GitBlameFile`、`history?: GitCommit[]`。**TabKind**（`v2-model.ts:7`）擴 `| "diff" | "conflict" | "history"`。`tabGlyph`（TabStrip.tsx:5）為新 kind 補 glyph（diff `±`、conflict `⚠`、history `⟲`）。**Workbench 主 view switch**（Workbench.tsx:194 的 `at.type === "git" ? ...` 鏈）加 `at.type==="diff" → <DiffView tab={at}/>`、`"conflict" → <ConflictView tab={at}/>`、`"history" → 重用 git row 列表`。

### 6. ConfirmModal typed-confirmation 變體（`v2-store.ts` ConfirmState + `Overlays.tsx` ConfirmModal）
- **`ConfirmState`（v2-store.ts:213）** 加可選 `typed?: string`（預期 token）。其餘不變。
- **`ConfirmModal`（Overlays.tsx:443）**：`typed` 存在時，多渲染 `<input>`（component 內 `useState("")`）與提示「Type **{typed}** to confirm」，確認鈕 `disabled={confirm.typed != null && input !== confirm.typed}`，按下 `closeConfirm(); confirm.action()`。無 typed 時行為完全不變（既有 checkout/revert/sftp-delete confirm 不受影響）。
- **CSS**：**先在兩個 :root（yuzu.css:51 dark、:103 light）補定義 `--yz-5b2730 / --yz-0e131d / --yz-3a1a22`**（dark 給合理 hex、light 給對應淺色；參考既有色票語意：5b2730≈深紅邊、0e131d≈深底、3a1a22≈hover 紅底）；再加 `.yz2-confirm-typed` input class（沿用 `.yz2-sc-card input` 風格 + danger 紅邊用 `--yz-f07178`）。

### 7. UI 元件

**A. SidePanel GitBody 重寫（`SidePanel.tsx:125`）— 最大視覺缺口**
加三段檔案清單（CONFLICTS / STAGED / CHANGES），讀 `p.git.conflicts/staged/unstaged`：
- 列 = `st` badge（A/M/D/U 配色 ffcb6b(M)/9ccc65(A)/f07178(D)/82aaff(U) 從 `--yz-*` 取）+ 檔名（ellipsis）+ hover 行內按鈕。
- CHANGES 段每列：點開 `openWorkingDiff(path,false)`；hover `+`(stage 單檔)、`↺`(discard 單檔,typed)。
- STAGED 段每列：點開 `openWorkingDiff(path,true)`；hover `−`(unstage 單檔)。
- CONFLICTS 段每列：點開 `openConflict(path)`。
- 段標題右側「Stage all / Unstage all」。
- commit card 加 amend / push-after 兩 toggle（接 `p.commitAmend/commitPush`）；Commit 鈕 disabled 條件：無 staged 或無 message 或 hasConflicts（複用 `canCommit` 概念）。
- sync 改露 Fetch/Pull/Push 三顆（目前只露 Fetch）。
- branch chip 改可點 → `openBranchPopup()`；加 stash 入口 → `openStashPanel()`。
新 CSS：`.yz2-sc-section`、`.yz2-sc-file`（列高 25-27px 對齊 tree-row）、`.yz2-sc-file .st/.nm/.acts`、`.yz2-sc-fileact`、`.yz2-sc-allbtn`。

**B. GitGraphView head 兩列重排 + detail 補 diff（`GitGraphView.tsx`）**
- `.yz2-git-head`：第一列 branch chip(點開 popup) + ahead/behind + Fetch/Pull/Push；第二列 filter(All/yuuzu/claude) + commit 數提示。改 `height:auto; flex-wrap` 或新增 `.yz2-git-head-2`。
- detail `.yz2-gd` 加 `min-width:320px`。**real 模式 detail 下半保留 commit body（realBody||selC?.m）**，但 CHANGED FILES 列（:202 `files.map`）加 `onClick={() => openCommitFileDiff(selC.fullHash ?? selC.h, f.path)}` → 開 commit-file diff tab，補掉「real 模式 diff 永遠空」。body 顯示移到 CHANGED FILES 上方或保留於下半，勿刪。
- commit detail head Checkout 鈕語意保留（detached，加說明）。

**C. DiffView 新元件（`DiffView.tsx`）**
渲染 `tab.diff`（DiffRow[]，沿用 `.yz2-diff-line`）。working-tree diff（`tab.diffStaged !== undefined`）每個 hunk 標題列加 Stage/Unstage hunk 鈕，每行可勾選；底部「Stage selected / Unstage selected / Revert selected(typed)」→ 用 `../features/git/git-diff-model` 的 `createDiffSelection`/`toggleHunk`/`toggleLine`/`selectionsForApi` 把選取轉 `HunkSelection[]` 傳 `stageHunks/unstageHunks/revertHunk`。commit diff（diffStaged===undefined）唯讀。新 CSS：`.yz2-diff-head`、`.yz2-diff-hunkbtn`、`.yz2-diff-line.is-sel`（`--yz-34421d` 選取底）。

**D. BranchPopup 新元件**
渲染 `p.git.branchesFull`（current 綠點 / ahead-behind chip / upstream）。每列點 → `checkoutBranch(name)`(typed)；hover 出 rename/delete(typed)/merge-into-current。底部「+ Create branch」輸入 → `createBranch(name)`（從 HEAD，無 start-point）。掛 SidePanel/GitGraphView 或全域 Overlays，由 `branchPopupOpen` 控制。新 CSS：`.yz2-branch-popup`、`.yz2-branch-row`(30px)、`.yz2-branch-cur`、`.yz2-branch-ab`。

**E. StashPanel 新元件**
渲染 `p.git.stashes`（index/message/when_unix）。每列 apply/pop/branch；drop 走 typed。頂部「Stash changes」輸入 + include-untracked toggle → `stashChanges`。新 CSS：`.yz2-stash-row`、`.yz2-stash-acts`。

**F. ConflictView 新元件（`ConflictView.tsx`）— MVP 整檔 accept-side**
`tab.conflict` = `{ours, theirs, base, working, blocks}`。三欄渲染 base(中)/ours(左)/theirs(右)；每 block 兩顆「Use ours / Use theirs」→ `chooseConflictBlock(i, side)`（寫 conflictChoices，純 UI）。頂部「Accept all ours / Accept all theirs」(typed `ACCEPT OURS/THEIRS` → `acceptConflictSide`) 與「Mark resolved」(→ markResolved)。**MVP 先支援整檔 accept-side**；per-block 寫回（`resolveConflictText` + writeResolution）為次階段，UI 預留鈕但可先 disabled/toast「pending」。新 CSS：`.yz2-conflict`、`.yz2-conflict-col`、`.yz2-conflict-block`、`.yz2-conflict-pick`（ours `--yz-0f1a0c` 綠底、theirs `--yz-10202e` 藍底）。

**G. Blame gutter（`ContentViews.tsx` EditableBody）**
`.yz2-ed-gutter` 旁疊 blame 欄：tab.blame.segments 每段覆蓋 `line_start..line_count`，顯示 short_hash + author（hover 出完整）。editor head 加「⎇ Blame」toggle → `toggleBlame(tab.id)`。blame 用純函式 `blameLineMap(file): Record<number,{short,author}>`（放 v2-model.ts，攤平 segment，可測）。新 CSS：`.yz2-ed-blame`、`.yz2-ed-blame-seg`（窄欄、`--yz-5a6675` 文字、左 1px border）。path 送 `tab.path`（相對）。

**H. commit 右鍵選單擴充（`Overlays.tsx:198 case "commit"`）**
現有：Checkout this commit / New branch from here(pending) / Cherry-pick / Revert / Copy hash / Compare。新增：Reset to here ▸（soft/mixed/hard 子項，hard typed `RESET HARD {short}`、soft/mixed typed `RESET {short}`，short=`commits[ci].h`）→ `resetTo(ci, mode)`；Export…（scope folder/zip → `exportCommit(ci, scope, format)`）；「Compare with working tree」可改接 `openCommitFileDiff`。「New branch from here」維持 pending（後端 create_branch 無 start-point，hedge 正確）。

**I. file 右鍵加「Git history」（`Overlays.tsx:36 case "file"`）**
加一項 → `openFileHistory(path)` 開 history tab（重用 git row 樣式列出該檔 commits）。

---

## TDD Task 分解（每 task: RED → GREEN → verify；純函式優先下沉到 bridge/v2-model 再測，store action 用 createV2Store 測 demo 分支與 confirm 流程；controller real 路徑靠 mock-IPC 手動驗，不在單元測試）

整體驗證 gate：`bun test src/v2/`（維持 71 綠 + 新 case）+ `bunx tsc --noEmit` + native mock-IPC 抽驗（controller real 路徑只在 Tauri 內可測）。建議順序 T1→T3→T2→T4→T5→T6→T7→T8→T9→T10→T11→T12。

### Task SP2-1: Add working-tree data model and bridge mapping

**Files:**
- Modify: `src/v2/v2-model.ts`
- Modify: `src/v2/bridge.ts`
- Test: `src/v2/bridge.test.ts`

- [ ] Write failing tests for `mapGitStatusGroups(status)` using `staged`, `unstaged`, and `conflicts` fixtures.
- [ ] Run `bun test src/v2/bridge.test.ts` and confirm RED.
- [ ] Implement `GitFile`, expanded `GitData`, and `mapGitStatusGroups` with `groupGitChanges(status.changes)` plus `decorationMapFromStatus(status)`.
- [ ] Run `bun test src/v2/bridge.test.ts` and confirm PASS.
- [ ] Commit with `git add src/v2/v2-model.ts src/v2/bridge.ts src/v2/bridge.test.ts && git commit -m "feat(v2): map git working tree groups"`.

### Task SP2-3: Add typed ConfirmModal and missing CSS variables

**Files:**
- Modify: `src/v2/v2-store.ts`
- Modify: `src/v2/Overlays.tsx`
- Modify: `src/v2/yuzu.css`
- Test: `src/v2/v2-store.test.ts`

- [ ] Write failing tests that `discardFiles(["a.ts"])`, `checkoutBranch("topic")`, and `dropStash(0)` open confirms with expected typed tokens.
- [ ] Run `bun test src/v2/v2-store.test.ts` and confirm RED.
- [ ] Extend `ConfirmState` with `typed?: string`.
- [ ] Add typed input gate in `ConfirmModal`; confirmation button is disabled until input equals `confirm.typed`.
- [ ] Define `--yz-5b2730`, `--yz-0e131d`, and `--yz-3a1a22` in both dark and light `:root` blocks before adding typed danger styles.
- [ ] Run `bun test src/v2/v2-store.test.ts && bunx tsc --noEmit`.
- [ ] Commit with `git add src/v2/v2-store.ts src/v2/Overlays.tsx src/v2/yuzu.css src/v2/v2-store.test.ts && git commit -m "feat(v2): add typed confirmations"`.

### Task SP2-2: Add path-level stage, unstage, discard actions

**Files:**
- Modify: `src/v2/v2-store.ts`
- Modify: `src/v2/controller.ts`
- Modify: `src/v2/SidePanel.tsx`

- [ ] Add store tests for demo `stageFiles`, `unstageFiles`, `stageAll`, `unstageAll`, and typed `discardFiles`.
- [ ] Run `bun test src/v2/v2-store.test.ts` and confirm RED.
- [ ] Implement store actions and RealDelegate methods.
- [ ] Implement controller calls to `stageGitPaths`, `unstageGitPaths`, and `discardGitPaths`; reload Git after writes.
- [ ] Render STAGED / CHANGES / CONFLICTS sections in `SidePanel.tsx`.
- [ ] Run `bun test src/v2/ && bunx tsc --noEmit`.
- [ ] Commit with `git add src/v2 && git commit -m "feat(v2): add git source control file actions"`.

### Task SP2-4: Add DiffView and diff mapping

**Files:**
- Create: `src/v2/DiffView.tsx`
- Modify: `src/v2/bridge.ts`
- Modify: `src/v2/v2-model.ts`
- Modify: `src/v2/controller.ts`
- Modify: `src/v2/Workbench.tsx`
- Test: `src/v2/bridge.test.ts`

- [ ] Write failing `mapDiffHunks` tests for hunk header, context, add, and delete rows.
- [ ] Run `bun test src/v2/bridge.test.ts` and confirm RED.
- [ ] Implement `DiffRow`, `mapDiffHunks`, `diff` tab fields, `gitOpenDiff`, and `<DiffView />`.
- [ ] Run `bun test src/v2/ && bunx tsc --noEmit`.
- [ ] Commit with `git add src/v2 && git commit -m "feat(v2): add git diff view"`.

### Task SP2-5: Add hunk and line staging

**Files:**
- Modify: `src/v2/DiffView.tsx`
- Modify: `src/v2/v2-store.ts`
- Modify: `src/v2/controller.ts`

- [ ] Add store tests that selected hunk/line actions call typed confirm for revert and delegate for stage/unstage.
- [ ] Run `bun test src/v2/v2-store.test.ts` and confirm RED.
- [ ] Use existing `src/features/git/git-diff-model.ts` selection helpers; do not reimplement selection encoding.
- [ ] Wire `stageGitHunks`, `unstageGitHunks`, and `revertGitHunk`.
- [ ] Run `bun test src/v2/ && bunx tsc --noEmit`.
- [ ] Commit with `git add src/v2 && git commit -m "feat(v2): add git hunk staging"`.

### Task SP2-6: Add branch popup and fix branch checkout

**Files:**
- Create: `src/v2/BranchPopup.tsx`
- Modify: `src/v2/v2-store.ts`
- Modify: `src/v2/controller.ts`
- Modify: `src/v2/SidePanel.tsx`
- Modify: `src/v2/GitGraphView.tsx`

- [ ] Add store tests that `checkoutBranch("topic")` uses typed token `CHECKOUT topic`.
- [ ] Run `bun test src/v2/v2-store.test.ts` and confirm RED.
- [ ] Implement `gitLoadBranches`, `gitCreateBranch`, `gitCheckoutBranch`, `gitMergeBranch`, `gitDeleteBranch`, and `gitRenameBranch`.
- [ ] Ensure controller passes branch name to `checkoutGitBranch`, not commit hash.
- [ ] Run `bun test src/v2/ && bunx tsc --noEmit`.
- [ ] Commit with `git add src/v2 && git commit -m "feat(v2): add git branch operations"`.

### Task SP2-7: Add stash panel

**Files:**
- Create: `src/v2/StashPanel.tsx`
- Modify: `src/v2/v2-store.ts`
- Modify: `src/v2/controller.ts`
- Modify: `src/v2/SidePanel.tsx`

- [ ] Add store tests for `stashChanges`, `applyStash`, `popStash`, typed `dropStash`, and `stashToBranch`.
- [ ] Run `bun test src/v2/v2-store.test.ts` and confirm RED.
- [ ] Implement stash store/controller/UI flow with existing `git-api.ts` wrappers.
- [ ] Run `bun test src/v2/ && bunx tsc --noEmit`.
- [ ] Commit with `git add src/v2 && git commit -m "feat(v2): add git stash operations"`.

### Task SP2-8: Add reset and rebase actions

**Files:**
- Modify: `src/v2/v2-store.ts`
- Modify: `src/v2/controller.ts`
- Modify: `src/v2/Overlays.tsx`

- [ ] Add store tests for typed `resetHard`, `resetTo(idx, mode)`, and `rebaseOnto(target)`.
- [ ] Run `bun test src/v2/v2-store.test.ts` and confirm RED.
- [ ] Wire `resetGitHard`, `resetGitTo`, and `rebaseGitOnto`.
- [ ] Add context menu entries without removing existing commit body display.
- [ ] Run `bun test src/v2/ && bunx tsc --noEmit`.
- [ ] Commit with `git add src/v2 && git commit -m "feat(v2): add git reset and rebase actions"`.

### Task SP2-9: Add conflict resolver MVP

**Files:**
- Create: `src/v2/ConflictView.tsx`
- Modify: `src/v2/v2-model.ts`
- Modify: `src/v2/v2-store.ts`
- Modify: `src/v2/controller.ts`
- Modify: `src/v2/Workbench.tsx`

- [ ] Add store tests for `chooseConflictBlock`, typed `acceptConflictSide`, and `markResolved`.
- [ ] Run `bun test src/v2/v2-store.test.ts` and confirm RED.
- [ ] Wire `getGitConflictFile`, `acceptGitConflictSide`, and `markGitResolved`.
- [ ] Render conflict tab with whole-file accept-side MVP; keep per-block write disabled or toast-only.
- [ ] Run `bun test src/v2/ && bunx tsc --noEmit`.
- [ ] Commit with `git add src/v2 && git commit -m "feat(v2): add git conflict resolver"`.

### Task SP2-10: Add blame gutter and file history

**Files:**
- Modify: `src/v2/v2-model.ts`
- Modify: `src/v2/ContentViews.tsx`
- Modify: `src/v2/controller.ts`
- Modify: `src/v2/Overlays.tsx`
- Test: `src/v2/v2-model.test.ts`

- [ ] Write failing `blameLineMap` test for multiple blame segments.
- [ ] Run `bun test src/v2/v2-model.test.ts` and confirm RED.
- [ ] Implement `blameLineMap`, `gitLoadBlame`, `gitFileHistory`, editor gutter rendering, and file context action.
- [ ] Run `bun test src/v2/ && bunx tsc --noEmit`.
- [ ] Commit with `git add src/v2 && git commit -m "feat(v2): add git blame and file history"`.

### Task SP2-11: Add commit export with absolute destination

**Files:**
- Modify: `src/v2/v2-store.ts`
- Modify: `src/v2/controller.ts`
- Modify: `src/v2/Overlays.tsx`

- [ ] Add store test that `exportCommit` delegates without hardcoding `~/Downloads`.
- [ ] Run `bun test src/v2/v2-store.test.ts` and confirm RED.
- [ ] In controller, call `pickWorkspaceFolder()` and pass the returned absolute folder to `exportGitCommit`.
- [ ] Run `bun test src/v2/ && bunx tsc --noEmit`.
- [ ] Commit with `git add src/v2 && git commit -m "feat(v2): export git commits"`.

### Task SP2-12: Finish Git UI spacing and commit detail diff

**Files:**
- Modify: `src/v2/GitGraphView.tsx`
- Modify: `src/v2/yuzu.css`

- [ ] Preserve `realBody || selC?.m` in GitGraphView.
- [ ] Add two-row git head layout and min widths.
- [ ] Wire changed files click to `openCommitFileDiff`.
- [ ] Run `bun test src/v2/ && bunx tsc --noEmit`.
- [ ] Commit with `git add src/v2/GitGraphView.tsx src/v2/yuzu.css && git commit -m "style(v2): refine git power UI"`.

---

## UI 考量

- 間距對齊既有慣例：檔案列 25-27px / branch·stash 列 30px / commit 列 38px；按鈕圓角 5-6px、popup 7-9px、chip 3px·9-13px；字級 13/12/11/10；border `1px solid var(--yz-1c2433)`；popup 陰影 `0 14-24px 36-70px rgba(0,0,0,.5)` + `yzIn` 進場。
- 色票一律從既有 `--yz-*` 挑：st badge ffcb6b(M)/9ccc65(A)/f07178(D)/82aaff(U)；diff add/del 用 0f1a0c/1d0f12 底；conflict ours 綠、theirs 藍；blame dim 5a6675。**不硬編 hex**（唯一例外：T3 在 :root 補定義 --yz-5b2730/0e131d/3a1a22 三個本就被引用卻未定義的變數）。
- git head 兩列重排後窄視窗不裁切右側提示；detail 面板 min-width 防壓扁。

---

## 驗證 gate

1. `bun test src/v2/`：bridge.test.ts 新增 `mapGitStatusGroups`/`mapDiffHunks` case 綠（mapGitStatusGroups 驗 staged/unstaged/conflicts 分組 + st 映射 + hasConflicts + branch/upstream 透傳；mapDiffHunks 驗 h/x/a/d 攤平）；v2-model.test.ts 新增 `blameLineMap` case；v2-store.test.ts 新增 stage/unstage/discard(typed confirm)/conflict-choose/reset-to(typed)/checkout-branch(typed token==='CHECKOUT '+name)/drop-stash(typed token==='DROP stash@{n}')/commit amend 等 demo 分支 + confirm 流程 case。**既有 71 tests 不退。**
2. `bunx tsc --noEmit` EXIT=0（新 Tab 欄位、RealDelegate 新 method、GitData 新欄位、ConfirmState.typed、DiffRow/GitFile 全鏈一致）。
3. native mock-IPC（手動）：mock `@tauri-apps/api/core` invoke（需額外 export `transformCallback`/`Channel`，並先設 `window.__TAURI_INTERNALS__={}` 讓 isTauri 為真——見既有 wiringNotes 同款陷阱），逐一驗 controller delegate 對 `git_stage_paths`/`git_diff_hunks`/`git_commit_file_diff`/`git_branches_full`/`git_checkout_branch`(name 非 hash)/`git_stash_*`/`git_conflict_file`/`git_blame_file`/`git_export_commit`(destDir 為絕對路徑)/`git_log_page`(filter.author) 的參數與 reload 行為。
4. 人工 smoke（桌面殼）：在有變更/有 stash/有 conflict 的 repo 跑一輪 stage→commit(amend toggle)→branch checkout(驗非 detached)→stash→reset→製造 conflict→accept-side→export(選資料夾)，確認 toast、reload、token 接受正確。

---

## 風險

- **typed confirmation token 必須與後端 `require_confirmation` expected 逐字相符**（DISCARD / CHECKOUT {name} / RESET HARD / REBASE {target} / REVERT {short} / RESET {short} / RESET HARD {short} / DROP stash@{n} / DELETE {name} / ACCEPT OURS|THEIRS）。已交叉驗證 Rust(git.rs/git_log.rs)與 TS(confirmationTextForGitAction)完全一致。**務必複用 confirmationTextForGitAction，勿自拼、勿用 confirmationFromError**（SQL 專用）。**short hash 風險**：後端 reset_to/revert 用 `short_hash_of(full_hash)` 重算，client 送的 `c.h`(=r.short_hash) 同源通常一致但 abbrev 長度若不同會被拒，次階段以 full hash 對齊。
- **decorationForChange 是 private**：bridge 改用 exported `decorationMapFromStatus`（path→st map）+ `groupGitChanges`，不動 git-model export。
- **GitData 擴充牽動所有讀 `p.git` 的元件**（GitGraphView/SidePanel/badge）；defUI(gitFor)/emptyUI 不對稱會在某模式 undefined → 先補對稱（含 gitFor 回傳值）再接 UI。
- **ConfirmState 目前無 typed 欄、CSS 三變數未定義**：T3 必須先於所有 destructive task，且 GREEN 前先在兩個 :root 補定義 --yz-5b2730/0e131d/3a1a22。
- **export destDir 必須絕對**：用 pickWorkspaceFolder 取，勿送 ~（Rust 拒、不展開）。
- **blame/conflict/diff path 基準是 repository_root**：送 tab.path(相對 workspace scan root)，僅 workspace_root===repository_root 時一致（既有 stage/diff 共用此假設）；workspace 為 repo 子目錄時可能錯位，沿用既有模式先不修但記錄。
- **GitGraphView real detail 既有 commit body 顯示**：T12 補 diff 時保留 body(realBody||selC?.m)，勿回歸。
- **conflict 文字寫回**靠 resolveConflictText 依 marker 切塊，blocks 與實際 marker 不符會錯位 → MVP 先整檔 accept-side，per-block 寫回次階段。
- **reloadGit 變重**（多帶 working-tree groups）：頻繁寫操作後全量 reload 成本上升，維持現有範式先不優化。
- **controller 幾乎無單元測試覆蓋**：real 邏輯盡量下沉到可測純函式（mapGitStatusGroups/mapDiffHunks/blameLineMap），controller 只留 async glue，real 行為靠 mock-IPC 手動驗。

## 非目標
- 不新增 FnMode、不換 Monaco、不重寫 GitDagSvg；不接後端不存在的能力（per-block 三路自動合併、從指定 commit 建 branch—create_branch 無 start-point）；不做 commit signing/GPG、不做 interactive rebase todo 編輯（後端只給 rebase_onto）；不做 export 自訂檔名（用後端預設）。
