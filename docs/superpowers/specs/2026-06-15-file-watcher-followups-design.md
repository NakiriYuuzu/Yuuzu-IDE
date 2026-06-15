# File Watcher v2 後續三項(自動重載 / 樹同步 / 衝突處置)— 設計文件

- 日期:2026-06-15
- 範圍:在已上線的 file watcher「偵測+標記」基線上,補上三項使用者面向行為:**自動重載乾淨分頁**、**檔案樹同步增刪**、**衝突分頁處置 UI**。對應使用者最初的需求「外部變動會立刻更新到本地嗎?」
- 對應 plan:待 `writing-plans` 產出逐步執行版。
- 約束:本文件為設計 only,撰寫期間不修改任何程式碼。

---

## 1. 背景與現況

**基線已完成且驗證**(偵測+標記,14 測試綠 / tsc 0 / 對抗審查 7 修正):

- **Backend watcher 完整**(`src-tauri/src/file_watcher.rs`):`recommended_watcher` + `RecursiveMode::Recursive`,emit `workspace://file-changed`,payload `FileChangedEvent { workspace_root: PathBuf, path: PathBuf, version: Option<FileVersion> }`(`file_watcher.rs:18-21`)。
  - `path` 為**絕對 canonical 路徑**(`normalize_event_path` `file_watcher.rs:217`,canonicalize 後 `starts_with(root)`)。
  - `version` 由 `file_system::file_version(&path).ok()` 取得(`file_watcher.rs:179-185`)→ **檔案不存在/讀不到時為 `None`**(即刪除訊號)。
  - **不區分 create/delete/modify**,只送「某路徑變了」+ 當下 version。
- **前端基線接線**(`src/v2/Workbench.tsx:222-263` `useWorkspaceFileWatcher`):依 active workspace 啟停 `watchWorkspace`,訂閱事件後呼叫 `markExternalFileChange(activeId, ev.path, ev.version)`(`Workbench.tsx:250`),含 StrictMode 競態防護。
- **純函式**(`src/v2/file-watch.ts`):`normalizeFsPath`(跨來源路徑正規化:verbatim `\\?\`/UNC 前綴、Windows-only case-fold)、`externallyChangedTabIds`(比對 disk path + 版本差異,跳過 `version==null` 的載入中分頁)。
- **標記**:`markExternalFileChange`(`v2-store.ts:~1044`)對命中分頁設 `externalChange` 旗標;chip 顯示於 editor header(`ContentViews.tsx:199-205`)與分頁圓點(`TabStrip.tsx`)。
- **自存 echo 防護**:`saveFile`/`applyRenameEdits` 成功後清 `externalChange`;`writeTextFile` 帶 `expectedVersion` 做 stale-write 拒絕(`file_system.rs:258` `"file changed on disk"`)。

**缺口(本次要補)**:基線只標記,**不**更新內容、**不**動檔案樹、衝突時**無**處置動作。

**可重用資產(已逐一確認)**:

| 資產 | 位置 | 用途 |
|---|---|---|
| 受控 `<textarea value={content}>` | `ContentViews.tsx:115-117`(`EditableBody`) | 更新 `tab.content` 即自動重渲染,**無需** CodeMirror imperative API |
| `openFile` 載入路徑 | `controller.ts:766-814`(`readTextFile`→patch content/savedContent/version/tooLarge→`openLspDocument`) | 重載邏輯藍本 |
| `refreshDir(pid, displayDir)` | `controller.ts:413-437` | 樹刷新藍本(**但 root 分支 `p.open={}` 會摺疊全樹,不可直接重用**) |
| `saveFile` + `writeTextFile` | `controller.ts:1004-1051` | `expectedVersion=null` 繞過 stale check = force write |
| `scanWorkspace`/`scanDirectory`/`mapEntriesToNodes`/`setNodeChildren`/`findNode` | `file-api.ts`/`bridge.ts` | 樹掃描與組裝 |
| `shouldMarkExternalChange` | `file-model.ts:104-116`(任一 null 或版本異 → true) | 變更判定 |
| `evictHlCache(tabId)` | `hl-cache.ts:26` | 重載前清高亮快取(key 僅含 `length+slice(0,80)`,`hl-cache.ts:13`) |
| `delegate` / `registerRealDelegate` | `controller.ts:~700` / `v2-store.ts:134` | real-mode 委派模式 |

---

## 2. 目標與範圍

### In scope(使用者已勾選 + 已拍板決策)

1. **自動重載乾淨分頁** — 外部變更命中「無未存編輯(`!dirty && !saving`)」的開啟檔案分頁時,自動從磁碟重讀並更新編輯器內容、版本。
2. **檔案樹同步增刪** — 外部新增/刪除檔案時刷新側邊樹,**保留既有展開/摺疊狀態**。
3. **衝突分頁處置 UI** — 分頁有未存編輯且磁碟已變更時,提供 **Reload**(棄本地、讀磁碟)與 **Overwrite**(force 存檔覆蓋磁碟)兩顆按鈕。
4. **刪除的乾淨分頁** — **保留分頁 + 標記**(不自動關閉,絕不無聲毀掉開著的分頁)。

### Out of scope(YAGNI / 已知限制)

- **監看所有開啟專案** — 維持僅 active workspace(使用者未勾選)。
- **純「已刪除」專屬 UI**(Close/Recreate 按鈕)— 以衝突 UI + 保留標記涵蓋。
- **衝突的 Compare/Diff 與 Keep-editing 按鈕** — 僅 Reload/Overwrite(純 Dismiss 會在後續存檔被 stale-write 拒絕,是 footgun)。
- **目錄整個刪除/改名時逐一標記其下開啟分頁** — notify 行為因平台而異,暫不保證(見 §7)。
- **後端 ignore `.git`/`node_modules`/`target`** — 靠前端「未載入 dir 自然略過」+ temp 檔過濾涵蓋常見情境;後端過濾列為後續。
- **toast 通知、cursor/scroll 精準保留** — MVP 接受 textarea 重載的游標/捲動位移。

---

## 3. 架構總覽

沿用既有 v2 dual-mode 分層,不引入新模式;新增邏輯集中在 controller(async I/O)與一組純函式:

```
backend notify ──emit "workspace://file-changed"──▶ Workbench useWorkspaceFileWatcher
  {workspace_root(canonical), path(canonical abs), version: Option<FileVersion>}
                                                          │ 比對 watchedRoot 後
                                                          ▼
              store.markExternalFileChange(wsId, eventWorkspaceRoot, path, version)
                                                          │ real mode 委派
                                                          ▼
        controller.delegate.onExternalFileChange(wsId, eventRoot, path, version)
              ├─ 開啟分頁:externallyChangedTabIds → 逐分頁分類
              │     ├─ 乾淨 + 檔案存在 → readAndApply(force:false)  ← 自動重載
              │     └─ 髒 / 已刪除      → patchTab(externalChange:true) ← 衝突/刪除標記
              └─ 結構變更:treeRefreshTarget(...) → scheduleTreeSync(coalesce) → syncTreeDir
                                                          │
                       受控 textarea / 檔案樹 隨 store 變更自動重渲染
```

**關鍵原則**:async 檔案 I/O 一律在 controller(沿用 `openFile`/`refreshDir` 慣例);store action 保持同步、僅委派;純路徑/樹運算抽成可獨立測試的函式。

---

## 4. 純函式設計(`src/v2/file-watch.ts`,TDD)

新增四個純函式,皆不觸碰 I/O,可單元測試:

- `isTempWritePath(pathNorm: string): boolean`
  - 比對自存原子寫入的 temp 檔(`file_system.rs:187-189`:`.<filename>.<pid>.<counter>.tmp`),basename regex `^\.(.+)\.\d+\.\d+\.tmp$`。樹同步須略過,避免自存閃爍。

- `findByReal(tree: TreeNode[], norm: string): { node: TreeNode; displayPath: string } | null`
  - 沿樹下行,以 `normalizeFsPath(node.p)` 與 `norm` 比對(prefix 命中才 descend),用 `node.n` 累積 display path。real-mode 節點 `.p` 必有值。

- `treeRefreshTarget(tree, rootNorm, eventPathNorm, eventExists): string | null`
  - 回傳要刷新的 **display dir**(`""`=root),或 `null`(不需結構刷新):
    1. `isTempWritePath` → `null`;
    2. `eventExists && findByReal(eventPath)` 命中 → modify → `null`(內容重載另行處理);
    3. `dirname(eventPathNorm) === rootNorm` → `""`(root 層級增刪);
    4. parent 經 `findByReal` 命中且為 **loaded dir**(`node.d && node.loaded`)→ 回其 displayPath;
    5. 否則(parent 未載入)→ `null`(未展開的 dir 之後展開時自然載入)。

- `mergeTreeChildren(oldChildren: TreeNode[], freshNodes: TreeNode[]): TreeNode[]`
  - 以 `n`(name)比對:仍存在的子 dir **保留**其 `.d`/`loaded`(避免刷新丟失深層展開),新增者用 fresh node,消失者移除。

**測試案例**:temp 過濾;findByReal verbatim/UNC/case;create-in-loaded→parent、delete-loaded→parent、modify→null、create-in-unloaded→null、root-level→""、merge 保留展開子樹/移除消失節點。

---

## 5. Controller 設計(`src/v2/controller.ts`)

- `async readAndApply(pid, tabId, { force })` — 重載單一分頁的共用核心:
  - 讀前快照 `tab.version`;`readTextFile(root, realPath)` 後**重新取得 tab**,若已關閉/換檔(`realPath` 不符)→ 放棄;
  - **非 force 競態重檢**:`cur.dirty || cur.saving` 或 `cur.version` 與快照不符 → 放棄(讀取期間使用者已編輯);
  - 套用前 `evictHlCache(tabId)`;`patchTab` 設 `content/savedContent/version/tooLarge/dirty:false/saving:false/externalChange:false/loading:false`;
  - `read.content` 為 string 且 LSP 支援 → `openLspDocument` 重新同步;
  - `catch`(檔案已刪/讀不到):保留 `externalChange`,`force` 時 `showToast`。(天然處理 `too_large`/`content==null`。)

- `async syncTreeDir(pid, displayDir)` — 保留 open 狀態的樹刷新:
  - `displayDir===""` → `scanWorkspace(root)`;否則 `scanDirectory(root, findNode(...).p)`;
  - `fresh = mapEntriesToNodes(entries)`;
    - root:`p.treeData = mergeTreeChildren(p.treeData, fresh)`;
    - 子 dir:`p.treeData = setNodeChildren(p.treeData, displayDir, mergeTreeChildren(findNode(p.treeData, displayDir).d ?? [], fresh))`;
  - **完全不寫 `p.open`**(避開 `refreshDir(pid,"")` 清空 open 的摺疊 bug)。

- `scheduleTreeSync(pid, displayDir)` — 輕量 coalescer:~120ms trailing timer,以 `Set<displayDir>` 去重,flush 時逐一 `syncTreeDir`(吸收單次存檔多事件、git 批次)。

- `delegate.onExternalFileChange(workspaceId, eventWorkspaceRoot, eventPath, eventVersion)`:
  - `const p = store().ui[workspaceId]`;以**傳入的** `workspaceId`/`eventWorkspaceRoot` 為準(非 `store().active`/`meta.root`,避免切換專案競態與 symlink/lexical root 失誤);
  - `ids = externallyChangedTabIds(p.tabs, eventPath, eventVersion)`;逐 id:`eventVersion != null && !dirty && !saving` → `void readAndApply(workspaceId, id, {force:false})`;否則 `patchTab(externalChange:true)`;
  - `target = treeRefreshTarget(p.treeData, normalizeFsPath(eventWorkspaceRoot), normalizeFsPath(eventPath), eventVersion != null)`;`target !== null` → `scheduleTreeSync(workspaceId, target)`。

- `delegate.saveFile(tabId, force = false)` — `expectedVersion = force ? null : (tab.version ?? null)`,其餘不變。
- `delegate.reloadFile(tabId)` — `void readAndApply(store().active, tabId, { force:true })`。

---

## 6. Store + 接線(`src/v2/v2-store.ts` + `Workbench.tsx`)

- `RealDelegate` 型別(`v2-store.ts:~50`):新增 `onExternalFileChange`、`reloadFile`;`saveFile` 加 `force?: boolean`。
- `markExternalFileChange` 簽名改為 `(workspaceId, eventWorkspaceRoot, eventPath, eventVersion)`:real mode → `realDelegate?.onExternalFileChange(...)`;非 real 保留原純標記(忽略 root,維持既有 mock 測試)。
- 新增 store action `reloadTab(tabId)` → `realDelegate?.reloadFile`;`overwriteTab(tabId)` → `realDelegate?.saveFile(tabId, true)`。
- `Workbench.tsx` `useWorkspaceFileWatcher`:呼叫改為 `markExternalFileChange(activeId, ev.workspace_root, ev.path, ev.version)`。

---

## 7. UI + CSS(`src/v2/ContentViews.tsx` + `yuzu.css`)

- header chip(`ContentViews.tsx:199-205`)**dirty + externalChange** 分支:改為「⚠ changed on disk」+ 兩顆小按鈕 **Reload** / **Overwrite**(呼叫 `reloadTab`/`overwriteTab`)。
- **clean + externalChange** 分支(自動重載後理論上不殘留,僅刪除/讀不到時出現):維持 chip 文案、不放按鈕。
- `yuzu.css`:新增 `.yz2-ext-btn` 小按鈕樣式(沿用 ext-chip 的琥珀色系)。

---

## 8. 關鍵正確性決策(來自對抗審查)

| # | 決策 | 理由 |
|---|---|---|
| 1 | 不重用 `refreshDir(pid,"")`,改 `syncTreeDir`+`mergeTreeChildren` | `refreshDir` root 分支 `p.open={}` 會摺疊整棵樹(high-severity) |
| 2 | thread `workspaceId`+canonical `eventWorkspaceRoot` | 避免切換專案競態、symlink/lexical root 比對失誤 |
| 3 | 樹同步主動刷新 loaded dir 並保留展開狀態 | `toggleDir`(`controller.ts:753`)`if(node.loaded) return` → 摺疊再展開不重掃,不主動刷新會殘留舊資料 |
| 4 | auto-reload 在 patch 時版本重檢 | 防止 async 讀取期間使用者打字被覆蓋 |
| 5 | temp 檔過濾 + coalesce | 避免自存原子寫入、git 批次造成樹閃爍/讀取風暴 |
| 6 | `evictHlCache` 後再套用內容 | hl-cache key 僅含 `length+slice(0,80)`,同長度改動會殘留舊高亮 |
| 7 | 衝突僅 Reload/Overwrite,不放純 Dismiss | 清旗標後正常存檔仍被 stale-write 拒絕 |
| 8 | 刪除的乾淨分頁只標記、不自動關閉 | 絕不無聲毀掉開著的分頁;Overwrite 可從 buffer 重建 |

---

## 9. 錯誤處理與邊界

- **讀檔 throw**(檔案已刪/權限/非 UTF-8):`readAndApply` catch → 保留 `externalChange`,force 時 toast。
- **too_large / content==null**:`readAndApply` 照 patch,編輯器顯示既有「too large / binary」狀態。
- **自存 echo**:`saveFile` 後 version 即為磁碟版 → `externallyChangedTabIds` 回空;temp 檔由 `isTempWritePath` 略過。
- **競態**:讀取期間打字 → patch 時重檢放棄;切換專案 → 用捕獲的 `workspaceId`。
- **事件風暴**(`.git`/`node_modules`/`target` 遞迴監看):未展開 dir → `treeRefreshTarget` 回 null 自然略過;開啟分頁不會命中這些路徑;coalesce 再降頻。

---

## 10. 取捨與已知限制

- **目錄整個刪除/改名**:若 notify 僅送 dir 事件,其下開啟分頁可能未被即時標記(平台相依)。列為後續。
- **textarea 重載游標/捲動**:外部置換 `value` 可能重置游標/捲動;因僅作用於乾淨分頁,MVP 可接受。
- **hl-cache 同長度殘影**:`evictHlCache` 已涵蓋外部重載路徑;一般打字的既有限制不在本次範圍。
- **coalescer**:屬可調優化;若日後嫌複雜可移除(天然 guard 已涵蓋多數情境)。

---

## 11. 測試策略

- **純函式 TDD**(`file-watch.test.ts`):`isTempWritePath`/`findByReal`/`treeRefreshTarget`/`mergeTreeChildren` red→green。
- **store**(`v2-store.test.ts`):更新 `markExternalFileChange` 新簽名相關案例;`reloadTab`/`overwriteTab` 委派。
- **既有**:`ContentViews.test.tsx`、`folder-expand.test.ts` 確認不回歸。
- **typecheck**:`bunx tsc --noEmit` → EXIT 0。
- **手動 E2E**(Tauri runtime,需真實執行):
  - 外部改乾淨檔 → 編輯器自動更新;
  - 改有未存編輯的檔 → Reload/Overwrite 行為正確;
  - 外部增/刪(root 與展開子 dir)→ 樹更新且其他展開 dir 不摺疊;
  - IDE 內存檔 → 不誤觸重載、無 temp 閃爍;
  - `git checkout`/`pull` 批次 → 樹平順、不卡頓;
  - 外部刪除乾淨檔 → 分頁保留 + 標記、不關閉。

---

## 12. 執行策略(ultracode + sonnet-only)

`writing-plans` 產出逐步版後,以 Workflow pipeline 實作(subagent 全 sonnet):

1. **純函式 TDD**(`file-watch.ts` 四函式)— 先紅後綠,可平行。
2. **Controller + Store 接線**(依賴 1;同檔案區段序列)。
3. **UI + CSS**。
4. **對抗式 review**(read-only sonnet):競態、open 狀態保留、stale-write、self-echo、事件風暴。

每階段 `bun test` + `bunx tsc --noEmit` 把關。
