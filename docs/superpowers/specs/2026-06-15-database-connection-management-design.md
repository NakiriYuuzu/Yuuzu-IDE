# Database 連線管理 — 設計文件

> 🟡 **實作狀態:部分實作**(2026-06-15 核對)— 後端 profile CRUD(`save/delete/list_database_profile`、keyring secret)與基礎 DB 瀏覽/查詢已有;**缺**新增/編輯/測試連線 UI、`test_database_connection` command 與 `ConnectionTestResult`。對應 plan:`docs/superpowers/plans/2026-06-15-database-connection-management.md`

- 日期:2026-06-15
- 範圍:在 Yuuzu-IDE 補上「建立與管理 database 連線」的前端,對標 JetBrains Data Source 的核心流程。
- 支援的 driver:PostgreSQL、MSSQL、SQLite(不擴充其他)。

---

## 1. 背景與現況

Yuuzu-IDE 已有相當完整的 database backend 與「查詢/瀏覽」前端,唯獨缺「連線管理」的入口。

既有(可重用):

- **Backend**(`src-tauri/src/database.rs`,約 108KB):
  - 三種 driver 的真實連線(SQLite `Connection::open` / PostgreSQL `tokio_postgres` / MSSQL `tiberius`)。
  - Profile CRUD:`DatabaseProfileStore::save_profile`(`database.rs:442`)、`delete_profile`(`database.rs:566`)、`list_profiles`、`get_profile`。
  - 密碼安全儲存:`KeyringDatabaseSecretStore`(keyring)。
  - schema inspect、query 執行與安全分類(read/mutation/destructive + confirmation)、query history、CSV export。
  - 品質佳:DSN 注入防護(`validate_not_raw_dsn`)、row 上限、save 失敗的 secret rollback(`database.rs:537`)。
- **Backend commands**:`save_database_profile` / `delete_database_profile` / `list_database_profiles` / `inspect_database_schema` / `execute_database_query` / `list_database_query_history` / `export_database_query_result` 皆已註冊(`lib.rs:107-113`)。
- **前端 API**(`src/features/database/database-api.ts`):已封裝 `saveDatabaseProfile` / `deleteDatabaseProfile` / `listDatabaseProfiles` / `inspectDatabaseSchema` / `executeDatabaseQuery` / `listDatabaseQueryHistory` / `exportDatabaseQueryResult`。
- **前端 v2 整合**:
  - `SidePanel.tsx:288` 的 `DbBody` 已列出連線、可展開看 table。
  - `DbTableView.tsx` 跑 query、看結果。
  - `controller.ts` 已串接 list/inspect/execute/history/export(但**未** import save/delete)。
  - `bridge.ts:402` 的 `mapDbProfiles` 將 backend `DatabaseProfile` 映射成 v2 `DbConn`。

缺口(本次要補):

- 沒有任何**新增 / 編輯 / 刪除 / 測試**連線的 UI。
- 孤立的 `src/features/database/DatabasePanel.tsx:229` 有一顆 **disabled** 的「Create database connection」按鈕,title 寫「(not available yet)」,證實此功能從未實作。該元件目前無人 import(已被 v2 的 `DbBody` 取代)。
- 目前要新增連線只能手動編輯 `database-profiles.json`。

---

## 2. 目標與範圍

### In scope

1. **新增連線**:dialog 表單,選 SQLite / PostgreSQL / MSSQL,填參數,儲存(密碼寫入 keyring)。
2. **編輯連線**:同一 dialog 預填既有參數;密碼欄留空 = 不變更既有密碼。
3. **刪除連線**:含確認對話框,移除 profile 與其 keyring 密碼。
4. **測試連線**:在「儲存前」對正在輸入的參數驗證連通性(新增一個輕量 backend command)。

### Out of scope(YAGNI)

- table 資料分頁/排序/篩選、cell 編輯寫回、DDL 檢視/產生、ER 圖、多 SQL console。
- 不改動孤立的 `features/database/DatabasePanel.tsx`(建議日後另案清理,本次只在文件記錄)。
- 不處理 SSH host 的同類缺口(`save_remote_host` 同樣缺前端新增 UI,但非本次範圍)。
- 連線池、SSH tunnel、SSL 進階選項、連線分組/資料夾、連線匯入匯出。
- 連線健康狀態的背景輪詢(`DbConn.live` 欄位保留現狀,不做背景檢查)。
- 連線建立程式碼的抽共用重構(PG/MSSQL 的 connect 段目前於 `inspect_*` / `execute_*` 各重複一次,本次 test 再自帶一份;三處統一留待日後另案)。

---

## 3. 架構總覽

沿用既有分層(與 git 模組同構),不引入新模式:

```
React 元件 (SidePanel DbBody / DbConnDialog)
      │  呼叫 store action
      ▼
v2-store.ts (V2State actions + RealDelegate interface)
      │  real mode 轉派
      ▼
controller.ts (RealDelegate 實作,保留 raw profiles)
      │  呼叫 feature api
      ▼
features/database/database-api.ts (call 封裝)
      │  invoke
      ▼
Tauri command (commands.rs) → database.rs (DatabaseProfileStore / driver 連線)
```

demo mode 在 store 內以本地陣列模擬;real mode 轉派給 `RealDelegate`,與既有 `dbRun` / `dbExport` 等一致。

---

## 4. Backend 改動(唯一一處)

新增 `test_database_connection` command。

- **新型別**(`database.rs`):
  ```rust
  pub struct ConnectionTestResult {
      pub ok: bool,
      pub message: String,
      pub elapsed_ms: u64,
  }
  ```
- **新函式**(`database.rs`):`pub async fn test_database_connection_input(input: &DatabaseProfileInput) -> ConnectionTestResult`
  - 直接從 `input` 的明文欄位組連線參數(`host` / `port` / `database` / `username` / `password` 或 `sqlite_path`),**不經過 keyring、不經過既有 `connection_parts`**(那些接的是已存檔的 `DatabaseProfile`,型別與用途不同)。
  - 各 driver 跑最小驗證:
    - SQLite:`Connection::open` + `PRAGMA schema_version`。
    - PostgreSQL:`PostgresConfig` connect(NoTls) + `SELECT 1`。
    - MSSQL:`TcpStream::connect` + `TiberiusClient::connect` + `SELECT 1`。
  - **自帶精簡連線(約 15 行 / driver),不抽共用、不改動既有 `inspect_*` / `execute_*` 四個函式** —— 最 surgical、零回歸風險。連線建立的重複留待日後另案清理(見 §2 out-of-scope)。
  - **必須包 `tokio::time::timeout`(預設 10 秒,tokio `"time"` feature 已啟用)**:既有 `inspect_*` / `execute_*` 的連線均無 timeout,使用者填錯 host 時會卡在 OS TCP timeout(20~75 秒),Test 體驗無法接受。
  - 回傳 `ok=false` 時帶 backend 的精準錯誤(連線被拒 / 認證失敗 / 逾時 / 檔案不存在)。
  - 限制:PG 沿用既有 `NoTls`,連要求 SSL 的正式 PG 會失敗(屬既有限制,SSL 見 §2 out-of-scope)。
- **command 包裝**(`commands.rs`,照 `inspect_database_schema` 模式):
  ```rust
  pub async fn test_database_connection(input: DatabaseProfileInput, state: State<'_, AppState>)
      -> Result<ConnectionTestResult, String>
  ```
- 註冊到 `lib.rs` 的 `invoke_handler`。

> 其餘(save / delete / 編輯時保留密碼)**backend 完全不用改**:`save_profile`(`database.rs:495-510`)已實作「`password=Some` 寫 keyring、`password=None` 保留既有 secret」,且 `input.id` 有無即決定編輯或新增。

---

## 5. 前端元件:DbConnDialog

新檔 `src/v2/DbConnDialog.tsx`,沿用 `BranchPopup.tsx` 的結構與 `yz2-branch-popup` 樣式風格(新 class 前綴 `yz2-dbdlg`)。

- **開關狀態**:由 store 控制 `dbDialog: { mode: "new" } | { mode: "edit"; profileId: string } | null`(比照 `branchPopupOpen`)。
- **表單欄位**(對應 `DatabaseProfileInput`):
  - `name`(必填)
  - `kind`:SQLite / PostgreSQL / MsSql 三選一;切換時顯示對應欄位。
  - SQLite:`sqlite_path` + 用 `@tauri-apps/plugin-dialog` 的檔案選擇按鈕。
  - TCP(PG/MSSQL):`host` / `port`(預設 PG `5432`、MSSQL `1433`)/ `database` / `username` / `password`。
  - `read_only`、`production` 兩個開關。
- **動作列**:
  - **Test Connection** → `testDbConn(input)`,在 dialog 內 inline 顯示 ok / 錯誤訊息與耗時(`elapsed_ms`)。
  - **Save** → 新增走 `saveDbConn`(無 id)、編輯走 `saveDbConn`(帶 id)。
  - **Cancel** → 關閉 dialog。
- **編輯模式**:用 `profileId` 從 controller 保留的 raw profile 預填欄位;`password` 不預填,placeholder 標「留空 = 不變更」。
- **驗證**:前端做基本必填檢查(name、依 kind 的必填欄位);深度驗證交給 backend(save/test 回錯)。

掛載點:`Workbench.tsx` 與 `BranchPopup` 同層加入 `<DbConnDialog />`。

---

## 6. 前端串接細節

### (a) `features/database/database-api.ts` + `database-model.ts`

- 加 `testDatabaseConnection(input) → call("test_database_connection", { input })`。
- `database-model.ts` 加 `ConnectionTestResult` 型別。

### (b) `controller.ts`(RealDelegate)

新增 3 個方法,並保留 raw profiles 供編輯預填:

- `dbSaveConn(input)` → `saveDatabaseProfile(input)`(`input.id` 有無即區分新增/編輯)→ 重新 `listDatabaseProfiles` → `mapDbProfiles` 更新 `dbConns` + 更新 raw profiles map → 關 dialog + toast。
- `dbDeleteConn(profileId)` → `deleteDatabaseProfile(root, profileId)` → refresh `dbConns` 與 raw profiles。
- `dbTestConn(input)` → `testDatabaseConnection(input)` → 回傳 `ConnectionTestResult` 給 dialog 顯示。
- 新增 `rawProfiles: Map<string, DatabaseProfile>`,於 bootstrap(`controller.ts:514`)與每次 add/edit/delete 後同步更新。

### (c) `v2-store.ts`

- `RealDelegate` interface 加 3 方法簽名:`dbSaveConn` / `dbDeleteConn` / `dbTestConn`。
- `V2State` 加 actions:`openDbConnDialog(mode, profileId?)` / `closeDbConnDialog` / `saveDbConn(input)` / `deleteDbConn(profileId)` / `testDbConn(input)`。
- 加 `dbDialog` 開關狀態(per-project UI 狀態,比照既有 `branchPopupOpen`)。
- demo mode:本地模擬(直接操作 `dbConns` 陣列);real mode:轉派 `realDelegate`。

### (d) `SidePanel.tsx` 的 `DbBody`

- panel header 加「**+**」按鈕 → `openDbConnDialog("new")`。
- 每個連線 row 加 hover 動作:**編輯**(`openDbConnDialog("edit", profileId)`)、**刪除**(confirm → `deleteDbConn`)。
- 沿用既有 row action 的樣式與互動。

### (e) `yuzu.css`

- 加 `yz2-dbdlg-*` 樣式,沿用 `yz2-branch-popup` 的 backdrop / popup / input / btn 與 `--yz-*` 變數。

---

## 7. 資料流

- **新增**:`DbBody`「+」→ `openDbConnDialog("new")` → 填表 →(可選)Test → Save → `saveDbConn(input 無 id)` → `saveDatabaseProfile` → backend 建 profile + 寫 keyring → `listDatabaseProfiles` → 更新 `dbConns` → 關 dialog → toast。
- **編輯**:row 編輯鈕 → `openDbConnDialog("edit", id)` → 由 raw profile 預填 → 改 → Save → `saveDbConn(input 帶 id)` → `saveDatabaseProfile`(密碼留空則保留既有 secret)→ refresh。
- **刪除**:row 刪除鈕 → `ConfirmModal`(`Overlays.tsx:626`)→ `deleteDbConn` → `deleteDatabaseProfile` → backend 移除 profile + secret → refresh。
- **測試**:Test 鈕 → `testDbConn(當前表單 input)` → `test_database_connection` → 明文連線 + 最小 query → 回 `{ ok, message, elapsed_ms }` → dialog inline 顯示。

---

## 8. 錯誤處理

- backend 連線 / save / delete 錯誤 → `Result::Err(String)` → 前端 catch → dialog inline 錯誤列或 toast。
- **Test 失敗**:顯示 backend 回傳的精準訊息(連線被拒、認證失敗、逾時、SQLite 檔不存在等)。
- **save 失敗**:backend 已有 secret rollback(`database.rs:537`);前端顯示錯誤並保持 dialog 開啟,不關閉、不清空使用者輸入。
- **必填缺漏**:前端 disable Save 並行內提示。
- **刪除不存在的 profile**:backend 容錯;前端 refresh 後狀態一致。

---

## 9. 測試策略

沿用既有測試風格(前端 happy-dom + `@testing-library/react`;後端 Rust `#[test]`)。

- **Backend**(`database.rs` tests):
  - `test_database_connection` 對 SQLite 用 `tempfile` 建真檔測 `ok=true`。
  - PG / MSSQL 在無真 server 時,測參數驗證與錯誤訊息格式(`ok=false` 路徑)。
  - 沿用既有 in-memory secret store / tempfile 測試模式。
- **前端元件**(`DbConnDialog.test.tsx`):渲染、kind 切換顯示對應欄位、必填驗證、Test / Save / Cancel 觸發對應 action(mock delegate)、編輯模式預填且密碼留空。
- **store**(`v2-store.test.ts`):`openDbConnDialog` / `saveDbConn` / `deleteDbConn` / `testDbConn` 的 demo 行為。
- **SidePanel**(`SidePanel.test.tsx`):`DbBody` 的「+」與 row 動作觸發正確 action。

驗收標準:在 real mode 下能於 IDE 內新增一個 SQLite 連線、Test 通過、儲存後出現在 `DbBody`、展開可看 table、可編輯與刪除;PG / MSSQL 連線同樣可新增與測試。

---

## 10. 待驗證點 / 風險

- **已驗證**:PG/MSSQL 的連線建立段在 `inspect_*` 與 `execute_*` 各重複一次,且**均無 timeout**;test 採自帶精簡連線並自行加 `tokio::time::timeout`(§4),不動既有四函式 → 零回歸風險,代價是連線程式碼多一份重複(見 §2 out-of-scope)。
- MSSQL config 沿用既有 `tds73` + rustls 設定;timeout 秒數(預設 10s)上線後可再調。
- 編輯預填依賴 controller 的 raw profiles;add / edit / delete 後都要同步更新,避免預填過期資料。
- SQLite 檔案選擇用 `@tauri-apps/plugin-dialog`(已裝);確認選取後的 path 正確寫回表單。
- `bridge.mapDbProfiles` 目前為精簡映射;編輯改走 raw profiles,**不需**擴充 v2 `DbConn` model(避免污染 v2 model)。
- `DatabaseProfileInput` 無 SSL 欄位,故 SSL 不在範圍;若日後要支援需同時改 backend struct。

---

## 11. 變更檔案清單(預估)

新增:

- `src/v2/DbConnDialog.tsx`
- `src/v2/DbConnDialog.test.tsx`

修改:

- `src-tauri/src/database.rs`(新 `ConnectionTestResult` + test 函式 + 抽共用連線)
- `src-tauri/src/commands.rs`(`test_database_connection` command)
- `src-tauri/src/lib.rs`(註冊 command)
- `src/features/database/database-api.ts`(`testDatabaseConnection`)
- `src/features/database/database-model.ts`(`ConnectionTestResult`)
- `src/v2/controller.ts`(RealDelegate 4 方法 + raw profiles)
- `src/v2/v2-store.ts`(actions + RealDelegate interface + dbDialog 狀態)
- `src/v2/SidePanel.tsx`(DbBody「+」與 row 動作)
- `src/v2/Workbench.tsx`(掛載 DbConnDialog)
- `src/v2/yuzu.css`(dialog 樣式)

不動:`src/features/database/DatabasePanel.tsx`(孤立舊元件)。
