# Database 連線管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為 Yuuzu-IDE 補上「連線管理」前端入口(新增 / 編輯 / 刪除 / 測試連線),讓使用者能像 JetBrain IDE 一樣在側欄建立並維護 PostgreSQL / MSSQL / SQLite 連線設定。

**Architecture:** 後端的 profile 儲存(`save_profile`/`delete_profile`)、查詢執行、schema 瀏覽都已存在;唯一缺的是「測試連線」command 與整套前端 UI。本計畫新增一個**自包含、零回歸**的 `test_database_connection` async command(自己建立連線 + 10 秒 timeout,不碰既有 `inspect_*`/`execute_*`),前端則以一個彈出式 `DbConnDialog` 表單 + 既有 context menu 串接新增/編輯/刪除,純邏輯(表單↔input 轉換、profile↔表單 prefill)抽到可單元測試的 `db-dialog.ts`。

**Tech Stack:** Rust(`rusqlite` / `tokio-postgres` / `tiberius` / `tokio::time::timeout`)、Tauri 2 command、React 19 + Zustand 5、`bun:test` + `@testing-library/react` + `happy-dom`。

---

## Prerequisites(執行前必讀)

1. **分支**:建議在新分支 `feat/database-connection` 上執行(目前工作目錄在 `perf/editor-cache-content-visibility`,有未提交的 editor-perf 變更)。是否切分支由使用者決定。
2. **Git staging 規則(本專案強制)**:**絕不執行 `git add`** — staging 是使用者的責任。每個 Commit step 只列出「建議 stage 的檔案」與 `git commit` 指令;實際 stage 由使用者在 review 時確認。
3. **Commit message 規範**:`<type>(<scope>): <emoji> <desc>`,最後一行固定 `Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>`,**絕不**加入 AI 為 Co-Author。
4. **程式風格**:`src/features/database/` 用分號;`src/v2/` 不用分號、4 空白縮排、不用 trailing comma。Rust 比照既有 `database.rs`。
5. **測試指令速查**:
   - Rust 單檔:`cargo test --manifest-path src-tauri/Cargo.toml <test_name>`
   - 前端單檔:`bun test src/v2/<file>.test.ts`
   - 型別檢查:`bunx tsc --noEmit`

---

## File Structure

**後端(Rust)**
- Modify `src-tauri/src/database.rs` — 新增 `ConnectionTestResult` struct、`probe_sqlite_connection`(同步)、`probe_postgres_connection` / `probe_mssql_connection`(async)、`test_database_connection_input`(async 分派 + timeout)、對應 `#[test]` / `#[tokio::test]`。
- Modify `src-tauri/src/commands.rs` — 新增 `#[tauri::command] test_database_connection`(不需 `State`)。
- Modify `src-tauri/src/lib.rs` — 在 `invoke_handler` 註冊 `commands::test_database_connection`。

**前端 API 層(features/database,分號風格)**
- Modify `src/features/database/database-model.ts` — 新增 `ConnectionTestResult` 型別。
- Modify `src/features/database/database-api.ts` — 新增 `testDatabaseConnection(input)`。

**前端純邏輯(v2,無分號)**
- Create `src/v2/db-dialog.ts` — `DbDialogState` 型別、`defDbDialog()`、`dbProfileToDialog(profile)`、`dbDialogToInput(dialog, root)`。
- Create `src/v2/db-dialog.test.ts` — 純函式 TDD。

**前端 store / model**
- Modify `src/v2/v2-model.ts` — `ProjectUI` 新增 `dbProfiles` 與 `dbDialog`;import `DbDialogState` / `DatabaseProfile` 型別。
- Modify `src/v2/v2-store.ts` — `RealDelegate` 新增 3 個方法;`defUI`/`emptyUI` 初始化;新增 `openDbConnDialog`/`closeDbConnDialog`/`patchDbDialog`/`testDbConn`/`saveDbConn`/`deleteDbConn` actions 與型別宣告。

**前端 controller / UI**
- Modify `src/v2/controller.ts` — `delegate` 新增 `dbTestConn`/`dbSaveConn`/`dbDeleteConn`;`ensureConnections` 一併填 `dbProfiles`。
- Create `src/v2/DbConnDialog.tsx` — 彈出表單元件。
- Create `src/v2/DbConnDialog.test.tsx` — component TDD。
- Modify `src/v2/SidePanel.tsx` — `DbBody` 加「+ 新增連線」入口。
- Modify `src/v2/Overlays.tsx` — `buildCtxItems` 新增 `dbconn` case(編輯 / 重新整理 / 刪除)。
- Modify `src/v2/Workbench.tsx` — 掛載 `<DbConnDialog />`。
- Modify `src/v2/yuzu.css` — `yz2-dbdlg-*` 樣式。

---

## Task A1: Backend — `ConnectionTestResult` 與 SQLite probe(可測核心)

**Files:**
- Modify: `src-tauri/src/database.rs`(struct + 同步函式放在 `inspect_postgres_schema`(約 L1009)之前的自由區域;test 放進 `mod tests`,約 L2146 之後)

- [ ] **Step 1: 先確認既有 import 與 serde 慣例**

Read `src-tauri/src/database.rs:1-25`,確認以下已 import(本計畫不需新增 import):`use rusqlite::{params_from_iter, types::ValueRef, Connection, OpenFlags};` 與 `use serde::{Deserialize, Serialize};`(或等價)。確認既有 struct(如 `DatabaseProfile`,L97)**沒有** `#[serde(rename_all = ...)]` — 因此新 struct 也維持 snake_case 欄位。

- [ ] **Step 2: 寫 failing test**

在 `mod tests`(`use super::*;` 之後,任一既有 `#[test]` 旁)加入:

```rust
    #[test]
    fn probe_sqlite_connection_returns_version_for_existing_file() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("probe.db");
        // 先建立一個有效的 SQLite 檔(open 會建檔)。
        Connection::open(&path).expect("create sqlite file");
        let version = probe_sqlite_connection(path.to_str().expect("utf8 path"))
            .expect("probe should succeed");
        assert!(!version.is_empty());
    }

    #[test]
    fn probe_sqlite_connection_fails_for_missing_file() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("does-not-exist.db");
        let result = probe_sqlite_connection(path.to_str().expect("utf8 path"));
        assert!(result.is_err());
    }
```

- [ ] **Step 3: 跑測試,確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml probe_sqlite_connection`
Expected: 編譯失敗,`cannot find function probe_sqlite_connection in this scope`。

- [ ] **Step 4: 實作 struct 與同步 probe**

在 `inspect_postgres_schema`(約 L1009)之前加入:

```rust
/// 「測試連線」command 的結果。失敗不視為 command 錯誤,而是回傳 `ok: false`
/// 並附帶訊息,讓前端統一以紅/綠狀態呈現。
#[derive(Clone, Debug, Serialize)]
pub struct ConnectionTestResult {
    pub ok: bool,
    pub message: String,
    pub server_version: Option<String>,
}

/// 測試能否開啟「既有」的 SQLite 檔案並查詢版本。
/// 刻意不帶 `SQLITE_OPEN_CREATE`:連線測試不應建立新檔。
fn probe_sqlite_connection(path: &str) -> Result<String, String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|error| format!("無法開啟 SQLite 檔案:{error}"))?;
    let version: String = connection
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .map_err(|error| format!("SQLite 查詢失敗:{error}"))?;
    Ok(version)
}
```

- [ ] **Step 5: 跑測試,確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml probe_sqlite_connection`
Expected: 2 個測試 PASS。

- [ ] **Step 6: Commit**

待 stage 檔案(staging 由使用者負責):`src-tauri/src/database.rs`

```bash
git commit -m "feat(api): 🚀 add ConnectionTestResult and SQLite connection probe

- add ConnectionTestResult struct for connection test command
- add probe_sqlite_connection that opens an existing file without creating it
- cover probe success and missing-file failure with unit tests

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task A2: Backend — `test_database_connection` command(async 分派 + PG/MSSQL probe + timeout)

**Files:**
- Modify: `src-tauri/src/database.rs`(async 函式放在 A1 的 `probe_sqlite_connection` 之後;test 放進 `mod tests`)
- Modify: `src-tauri/src/commands.rs`(放在 `inspect_database_schema`,約 L1616 附近)
- Modify: `src-tauri/src/lib.rs`(`invoke_handler` 註冊區,約 L107-113)

- [ ] **Step 1: 確認 PG / MSSQL 連線建立範本**

Read `src-tauri/src/database.rs:1009-1028`(`inspect_postgres_schema` 的 `PostgresConfig` 建立 + `config.connect(NoTls)` + `tokio::spawn`)與 `src-tauri/src/database.rs:1252-1273`(`inspect_mssql_schema` 的 `TiberiusConfig` + `TcpStream::connect` + `TiberiusClient::connect(config, stream.compat_write())`)。下方 probe 完全比照這兩段的連線方式,**不額外呼叫** `trust_cert()` 等既有沒用到的設定,以維持與既有連線行為一致。

- [ ] **Step 2: 寫 failing test**

在 `mod tests` 加入(`#[tokio::test]` 可用:`Cargo.toml` 的 tokio features 含 `rt` + `macros`):

```rust
    #[tokio::test]
    async fn test_connection_input_succeeds_for_valid_sqlite() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("ok.db");
        Connection::open(&path).expect("create sqlite file");
        let input = DatabaseProfileInput {
            id: None,
            workspace_root: "/workspace".to_string(),
            name: "local".to_string(),
            kind: DatabaseKind::SQLite,
            sqlite_path: Some(path.to_str().expect("utf8 path").to_string()),
            host: None,
            port: None,
            database: None,
            username: None,
            password: None,
            read_only: true,
            production: false,
        };
        let result = test_database_connection_input(input)
            .await
            .expect("command should not error");
        assert!(result.ok);
        assert!(result.server_version.is_some());
    }

    #[tokio::test]
    async fn test_connection_input_reports_failure_for_missing_sqlite_path() {
        let input = DatabaseProfileInput {
            id: None,
            workspace_root: "/workspace".to_string(),
            name: "broken".to_string(),
            kind: DatabaseKind::SQLite,
            sqlite_path: None,
            host: None,
            port: None,
            database: None,
            username: None,
            password: None,
            read_only: false,
            production: false,
        };
        let result = test_database_connection_input(input)
            .await
            .expect("command should not error");
        assert!(!result.ok);
        assert!(result.message.contains("SQLite"));
    }
```

- [ ] **Step 3: 跑測試,確認失敗**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_connection_input`
Expected: 編譯失敗,`cannot find function test_database_connection_input`。

- [ ] **Step 4: 實作 PG / MSSQL probe 與分派函式**

在 A1 的 `probe_sqlite_connection` 之後加入。三個 probe 統一回傳 `Result<Option<String>, String>`(`Some(version)` 代表拿到版本字串):

```rust
async fn probe_postgres_connection(input: &DatabaseProfileInput) -> Result<Option<String>, String> {
    let host = input
        .host
        .clone()
        .ok_or_else(|| "PostgreSQL 連線缺少主機".to_string())?;
    let database = input
        .database
        .clone()
        .ok_or_else(|| "PostgreSQL 連線缺少資料庫名稱".to_string())?;

    let mut config = PostgresConfig::new();
    config.host(&host);
    config.port(input.port.unwrap_or(5432));
    config.dbname(&database);
    if let Some(username) = input.username.as_deref() {
        config.user(username);
    }
    if let Some(password) = input.password.as_deref() {
        config.password(password);
    }

    let (client, connection) = config
        .connect(NoTls)
        .await
        .map_err(|error| format!("PostgreSQL 連線失敗:{error}"))?;
    let handle = tokio::spawn(async move {
        let _ = connection.await;
    });
    let version: String = client
        .query_one("SELECT version()", &[])
        .await
        .map_err(|error| format!("PostgreSQL 查詢失敗:{error}"))?
        .get(0);
    handle.abort();
    Ok(Some(version))
}

async fn probe_mssql_connection(input: &DatabaseProfileInput) -> Result<Option<String>, String> {
    let host = input
        .host
        .clone()
        .ok_or_else(|| "MSSQL 連線缺少主機".to_string())?;
    let database = input
        .database
        .clone()
        .ok_or_else(|| "MSSQL 連線缺少資料庫名稱".to_string())?;
    let port = input.port.unwrap_or(1433);

    let mut config = TiberiusConfig::new();
    config.host(&host);
    config.port(port);
    config.database(&database);
    if let Some(username) = input.username.as_deref() {
        config.authentication(AuthMethod::sql_server(
            username,
            input.password.as_deref().unwrap_or_default(),
        ));
    }

    let stream = TcpStream::connect((host.as_str(), port))
        .await
        .map_err(|error| format!("MSSQL 連線失敗:{error}"))?;
    let mut client = TiberiusClient::connect(config, stream.compat_write())
        .await
        .map_err(|error| format!("MSSQL 連線失敗:{error}"))?;
    // 能連上並成功執行一個輕量查詢,即證明連線可用。
    client
        .query("SELECT @@VERSION", &[])
        .await
        .map_err(|error| format!("MSSQL 查詢失敗:{error}"))?;
    Ok(None)
}

/// 「測試連線」的核心:依 kind 分派,整段包在 10 秒 timeout 內。
/// 用使用者剛在表單輸入的明文 input(不經 keyring),失敗回傳 ok:false。
pub async fn test_database_connection_input(
    input: DatabaseProfileInput,
) -> Result<ConnectionTestResult, String> {
    let probe = async {
        match input.kind {
            DatabaseKind::SQLite => {
                let path = input
                    .sqlite_path
                    .clone()
                    .ok_or_else(|| "SQLite 連線缺少檔案路徑".to_string())?;
                probe_sqlite_connection(&path).map(Some)
            }
            DatabaseKind::PostgreSQL => probe_postgres_connection(&input).await,
            DatabaseKind::MsSql => probe_mssql_connection(&input).await,
        }
    };

    match tokio::time::timeout(std::time::Duration::from_secs(10), probe).await {
        Ok(Ok(server_version)) => Ok(ConnectionTestResult {
            ok: true,
            message: "連線成功".to_string(),
            server_version,
        }),
        Ok(Err(error)) => Ok(ConnectionTestResult {
            ok: false,
            message: error,
            server_version: None,
        }),
        Err(_) => Ok(ConnectionTestResult {
            ok: false,
            message: "連線逾時(10 秒)".to_string(),
            server_version: None,
        }),
    }
}
```

- [ ] **Step 5: 跑測試,確認通過**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_connection_input`
Expected: 2 個測試 PASS(PG/MSSQL 分支需真實 server,刻意不寫單元測試 — 由 Step 7 的手動煙霧測試涵蓋)。

- [ ] **Step 6: 加上 Tauri command wrapper**

在 `src-tauri/src/commands.rs` 的 `inspect_database_schema`(約 L1616)附近加入(State-aware wrapper:新增連線直接用明文 input;編輯既有 TCP profile 且密碼留空時,後端補既有 secret 後再測):

```rust
#[tauri::command]
pub async fn test_database_connection(
    state: State<'_, AppState>,
    input: crate::database::DatabaseProfileInput,
) -> Result<crate::database::ConnectionTestResult, String> {
    state.test_database_connection(input).await
}
```

- [ ] **Step 7: 在 lib.rs 註冊 command**

在 `src-tauri/src/lib.rs` 的 `invoke_handler` 內,於 `commands::export_database_query_result,`(約 L113)之後加入一行:

```rust
            commands::test_database_connection,
```

- [ ] **Step 8: 編譯確認**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: 編譯成功,無 error。

- [ ] **Step 9: Commit**

待 stage 檔案:`src-tauri/src/database.rs`、`src-tauri/src/commands.rs`、`src-tauri/src/lib.rs`

```bash
git commit -m "feat(api): 🚀 add test_database_connection command

- add self-contained PG / MSSQL / SQLite connection probes
- wrap dispatch in a 10s tokio timeout, returning ok:false on failure
- register the new Tauri command in the invoke handler

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task B1: Frontend API — `ConnectionTestResult` 型別與 `testDatabaseConnection`

**Files:**
- Modify: `src/features/database/database-model.ts`(分號風格;型別放在 `DatabaseProfileInput`,約 L46 之後)
- Modify: `src/features/database/database-api.ts`(放在 `inspectDatabaseSchema` 附近)

> 說明:`database-api.ts` 內既有函式(`listDatabaseProfiles` 等)都是 thin wrapper 且沒有獨立單元測試 — 本專案慣例不為單行 `call()` wrapper 寫測試。此 task 以 `bunx tsc --noEmit` 的型別檢查作為驗證;真正帶邏輯的轉換函式在 Task C1 以 TDD 覆蓋。

- [ ] **Step 1: 新增 `ConnectionTestResult` 型別**

在 `src/features/database/database-model.ts` 的 `DatabaseProfileInput`(L46)之後加入(欄位用 snake_case,對應 Rust struct 無 rename):

```ts
export type ConnectionTestResult = {
  ok: boolean;
  message: string;
  server_version: string | null;
};
```

- [ ] **Step 2: 新增 `testDatabaseConnection` 函式**

在 `src/features/database/database-api.ts` 頂部 import 補上 `ConnectionTestResult`(加到既有 `import type { ... } from "./database-model";` 區塊):

```ts
  ConnectionTestResult,
```

然後在 `inspectDatabaseSchema` 函式附近加入:

```ts
export function testDatabaseConnection(
  input: DatabaseProfileInput,
): Promise<ConnectionTestResult> {
  return call("test_database_connection", { input });
}
```

- [ ] **Step 3: 型別檢查**

Run: `bunx tsc --noEmit`
Expected: 無 error(`DatabaseProfileInput` 已是既有 import)。

- [ ] **Step 4: Commit**

待 stage 檔案:`src/features/database/database-model.ts`、`src/features/database/database-api.ts`

```bash
git commit -m "feat(api): 🚀 add testDatabaseConnection frontend binding

- add ConnectionTestResult type mirroring the backend struct
- add testDatabaseConnection that invokes the new Tauri command

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task C1: 純邏輯 — `db-dialog.ts`(表單狀態與雙向轉換)

**Files:**
- Create: `src/v2/db-dialog.ts`
- Create: `src/v2/db-dialog.test.ts`

> 這支檔案是整個前端的可測核心:`dbProfileToDialog` 把後端 profile 攤平成表單欄位(編輯預填),`dbDialogToInput` 把表單組回後端 `DatabaseProfileInput`(snake_case key,對應 Rust struct)。`v2/` 風格 — 不用分號、4 空白、不用 trailing comma。

- [ ] **Step 1: 寫 failing test**

Create `src/v2/db-dialog.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { DatabaseProfile } from "../features/database/database-model"
import { dbDialogToInput, dbProfileToDialog, defDbDialog } from "./db-dialog"

describe("db-dialog", () => {
    test("defDbDialog is a closed create-mode form defaulting to PostgreSQL", () => {
        const d = defDbDialog()
        expect(d.open).toBe(false)
        expect(d.mode).toBe("create")
        expect(d.engine).toBe("PostgreSQL")
        expect(d.profileId).toBeNull()
    })

    test("dbProfileToDialog prefills a TCP (Postgres) profile and opens in edit mode", () => {
        const profile: DatabaseProfile = {
            id: "p1",
            workspace_root: "/ws",
            name: "prod",
            kind: "PostgreSQL",
            source: { Tcp: { host: "db.example", port: 5432, database: "app", username: "yuuzu", secret_id: "s1" } },
            read_only: true,
            production: true,
            created_ms: 0,
            updated_ms: 0
        }
        const d = dbProfileToDialog(profile)
        expect(d.open).toBe(true)
        expect(d.mode).toBe("edit")
        expect(d.profileId).toBe("p1")
        expect(d.engine).toBe("PostgreSQL")
        expect(d.host).toBe("db.example")
        expect(d.port).toBe("5432")
        expect(d.database).toBe("app")
        expect(d.username).toBe("yuuzu")
        expect(d.password).toBe("") // 密碼從不回填
        expect(d.readOnly).toBe(true)
        expect(d.production).toBe(true)
    })

    test("dbProfileToDialog prefills a SQLite profile path", () => {
        const profile: DatabaseProfile = {
            id: "p2",
            workspace_root: "/ws",
            name: "local",
            kind: "SQLite",
            source: { SQLite: { path: "/data/app.db" } },
            read_only: false,
            production: false,
            created_ms: 0,
            updated_ms: 0
        }
        const d = dbProfileToDialog(profile)
        expect(d.engine).toBe("SQLite")
        expect(d.sqlitePath).toBe("/data/app.db")
    })

    test("dbDialogToInput builds a snake_case TCP input and omits empty password", () => {
        const d = { ...defDbDialog(), engine: "PostgreSQL" as const, name: " prod ", host: " db ", port: "5432", database: "app", username: "yuuzu", password: "" }
        const input = dbDialogToInput(d, "/ws")
        expect(input.workspace_root).toBe("/ws")
        expect(input.name).toBe("prod") // trim
        expect(input.kind).toBe("PostgreSQL")
        expect(input.host).toBe("db") // trim
        expect(input.port).toBe(5432) // string → number
        expect(input.database).toBe("app")
        expect(input.username).toBe("yuuzu")
        expect(input.password).toBeUndefined() // 空密碼省略 → 後端保留既有 secret
        expect(input.read_only).toBe(false)
        expect(input.id).toBeUndefined() // create
    })

    test("dbDialogToInput keeps id and password in edit mode, builds SQLite input", () => {
        const d = { ...defDbDialog(), mode: "edit" as const, profileId: "p9", engine: "SQLite" as const, name: "local", sqlitePath: "/data/app.db", password: "" }
        const input = dbDialogToInput(d, "/ws")
        expect(input.id).toBe("p9")
        expect(input.kind).toBe("SQLite")
        expect(input.sqlite_path).toBe("/data/app.db")
        expect(input.host).toBeUndefined()
    })
})
```

- [ ] **Step 2: 跑測試,確認失敗**

Run: `bun test src/v2/db-dialog.test.ts`
Expected: FAIL — `Cannot find module './db-dialog'`。

- [ ] **Step 3: 實作 `db-dialog.ts`**

Create `src/v2/db-dialog.ts`:

```ts
import type {
    ConnectionTestResult,
    DatabaseKind,
    DatabaseProfile,
    DatabaseProfileInput
} from "../features/database/database-model"

export type DbDialogState = {
    open: boolean
    mode: "create" | "edit"
    profileId: string | null
    name: string
    engine: DatabaseKind
    sqlitePath: string
    host: string
    port: string
    database: string
    username: string
    password: string
    readOnly: boolean
    production: boolean
    testing: boolean
    testResult: ConnectionTestResult | null
    saving: boolean
    error: string | null
}

export function defDbDialog(): DbDialogState {
    return {
        open: false,
        mode: "create",
        profileId: null,
        name: "",
        engine: "PostgreSQL",
        sqlitePath: "",
        host: "",
        port: "",
        database: "",
        username: "",
        password: "",
        readOnly: false,
        production: false,
        testing: false,
        testResult: null,
        saving: false,
        error: null
    }
}

// 後端 profile → 表單欄位(編輯預填)。密碼是 write-only,永不回填。
export function dbProfileToDialog(profile: DatabaseProfile): DbDialogState {
    const base: DbDialogState = {
        ...defDbDialog(),
        open: true,
        mode: "edit",
        profileId: profile.id,
        name: profile.name,
        engine: profile.kind,
        readOnly: profile.read_only,
        production: profile.production
    }
    if ("SQLite" in profile.source) {
        return { ...base, sqlitePath: profile.source.SQLite.path }
    }
    const tcp = profile.source.Tcp
    return {
        ...base,
        host: tcp.host,
        port: String(tcp.port),
        database: tcp.database,
        username: tcp.username ?? ""
    }
}

// 表單欄位 → 後端 DatabaseProfileInput(snake_case key,對應 Rust struct)。
// 空密碼省略 → 後端在編輯時保留既有 secret。
export function dbDialogToInput(dialog: DbDialogState, workspaceRoot: string): DatabaseProfileInput {
    const base: DatabaseProfileInput = {
        id: dialog.mode === "edit" && dialog.profileId ? dialog.profileId : undefined,
        workspace_root: workspaceRoot,
        name: dialog.name.trim(),
        kind: dialog.engine,
        read_only: dialog.readOnly,
        production: dialog.production
    }
    if (dialog.engine === "SQLite") {
        return { ...base, sqlite_path: dialog.sqlitePath.trim() }
    }
    const port = dialog.port.trim()
    return {
        ...base,
        host: dialog.host.trim(),
        port: port ? Number(port) : undefined,
        database: dialog.database.trim(),
        username: dialog.username.trim() || undefined,
        password: dialog.password ? dialog.password : undefined
    }
}
```

- [ ] **Step 4: 跑測試,確認通過**

Run: `bun test src/v2/db-dialog.test.ts`
Expected: 5 個測試全 PASS。

- [ ] **Step 5: Commit**

待 stage 檔案:`src/v2/db-dialog.ts`、`src/v2/db-dialog.test.ts`

```bash
git commit -m "feat(ui): 🚀 add db-dialog state and conversion helpers

- add DbDialogState plus defaults for the connection form
- add dbProfileToDialog (edit prefill) and dbDialogToInput (save payload)
- cover both directions with unit tests

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task C2: Store — `ProjectUI` 欄位 + dialog open/close/patch actions

**Files:**
- Modify: `src/v2/v2-model.ts`(`ProjectUI`,約 L239-266)
- Modify: `src/v2/v2-store.ts`(型別宣告 + `defUI`/`emptyUI` 初始化 + actions)

- [ ] **Step 1: 確認既有 store 範本**

Read `src/v2/v2-store.ts:680-695`(`upd` helper:`const upd = (mut: (p: ProjectUI) => void) => { set((s) => { ... }) }`)、`src/v2/v2-store.ts:1517-1535`(`closeBranchPopup` 用 `upd((p) => { p.branchPopupOpen = false })`)、以及 `defUI`(約 L221)/`emptyUI`(約 L253)的初始化欄位寫法。下方 actions 比照 `upd` 風格。

- [ ] **Step 2: 寫 failing test**

Create `src/v2/db-store.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { DatabaseProfile } from "../features/database/database-model"
import { createV2Store } from "./v2-store"

function active(store: ReturnType<typeof createV2Store>) {
    const s = store.getState()
    return s.ui[s.active]
}

describe("db connection dialog store", () => {
    test("openDbConnDialog() with no profile opens an empty create form", () => {
        const store = createV2Store()
        store.getState().openDbConnDialog()
        const d = active(store).dbDialog
        expect(d.open).toBe(true)
        expect(d.mode).toBe("create")
        expect(d.profileId).toBeNull()
    })

    test("openDbConnDialog(profile) prefills edit mode", () => {
        const store = createV2Store()
        const profile: DatabaseProfile = {
            id: "p1",
            workspace_root: "/ws",
            name: "prod",
            kind: "PostgreSQL",
            source: { Tcp: { host: "db", port: 5432, database: "app", username: "u", secret_id: null } },
            read_only: false,
            production: false,
            created_ms: 0,
            updated_ms: 0
        }
        store.getState().openDbConnDialog(profile)
        const d = active(store).dbDialog
        expect(d.open).toBe(true)
        expect(d.mode).toBe("edit")
        expect(d.profileId).toBe("p1")
        expect(d.host).toBe("db")
    })

    test("patchDbDialog merges fields; closeDbConnDialog resets", () => {
        const store = createV2Store()
        store.getState().openDbConnDialog()
        store.getState().patchDbDialog({ name: "edited", testing: true })
        expect(active(store).dbDialog.name).toBe("edited")
        expect(active(store).dbDialog.testing).toBe(true)
        store.getState().closeDbConnDialog()
        expect(active(store).dbDialog.open).toBe(false)
        expect(active(store).dbDialog.name).toBe("")
    })
})
```

- [ ] **Step 3: 跑測試,確認失敗**

Run: `bun test src/v2/db-store.test.ts`
Expected: FAIL — `openDbConnDialog is not a function`。

- [ ] **Step 4: `ProjectUI` 加欄位**

在 `src/v2/v2-model.ts` 頂部 import 區補上(若尚未 import 這些型別):

```ts
import type { DatabaseProfile } from "../features/database/database-model"
import type { DbDialogState } from "./db-dialog"
```

在 `ProjectUI`(約 L256 `dbConns: DbConn[]` 之後)加入兩個欄位:

```ts
    dbProfiles: DatabaseProfile[]
    dbDialog: DbDialogState
```

- [ ] **Step 5: store 型別宣告 + 初始化 + actions**

在 `src/v2/v2-store.ts` 頂部 import 區補上:

```ts
import type { DatabaseProfile } from "../features/database/database-model"
import { defDbDialog, dbProfileToDialog } from "./db-dialog"
import type { DbDialogState } from "./db-dialog"
```

在 `V2State` 型別中,`openConfirm`/`closeConfirm`(約 L473-474)附近加入 action 簽章:

```ts
    openDbConnDialog: (profile?: DatabaseProfile) => void
    closeDbConnDialog: () => void
    patchDbDialog: (patch: Partial<DbDialogState>) => void
```

在 `defUI`(約 L221,demo slice)與 `emptyUI`(約 L253,real slice)兩處的 `dbConns: ...` 欄位旁,各加入初始化:

```ts
        dbProfiles: [],
        dbDialog: defDbDialog(),
```

在 store 實作中,`closeBranchPopup`(約 L1535)之後加入(比照 `upd` 風格):

```ts
            openDbConnDialog: (profile) => {
                upd((p) => {
                    p.dbDialog = profile ? dbProfileToDialog(profile) : { ...defDbDialog(), open: true }
                })
            },

            closeDbConnDialog: () => {
                upd((p) => {
                    p.dbDialog = defDbDialog()
                })
            },

            patchDbDialog: (patch) => {
                upd((p) => {
                    p.dbDialog = { ...p.dbDialog, ...patch }
                })
            },
```

- [ ] **Step 6: 跑測試,確認通過**

Run: `bun test src/v2/db-store.test.ts`
Expected: 3 個測試全 PASS。

- [ ] **Step 7: 型別檢查**

Run: `bunx tsc --noEmit`
Expected: 無 error(若有「`dbProfiles`/`dbDialog` 缺漏」錯誤,代表別處有手寫的 `ProjectUI` literal — 一併補上這兩個欄位)。

- [ ] **Step 8: Commit**

待 stage 檔案:`src/v2/v2-model.ts`、`src/v2/v2-store.ts`、`src/v2/db-store.test.ts`

```bash
git commit -m "feat(ui): 🚀 add db connection dialog state to project store

- add dbProfiles and dbDialog to ProjectUI with defaults in both slices
- add openDbConnDialog / closeDbConnDialog / patchDbDialog actions
- cover open (create + edit prefill), patch, and close with store tests

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task C3: Store — `testDbConn` / `saveDbConn` / `deleteDbConn` 委派 + `RealDelegate` 擴充

**Files:**
- Modify: `src/v2/v2-store.ts`(`RealDelegate` interface,約 L64-100;action 簽章 + 實作)

- [ ] **Step 1: 寫 failing test**

Create `src/v2/db-delegate.test.ts`(用 `registerRealDelegate` 注入 stub,驗證委派):

```ts
/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"

import { createV2Store, registerRealDelegate } from "./v2-store"

afterEach(() => {
    registerRealDelegate(null)
})

function realStore() {
    const store = createV2Store()
    store.setState({ mode: "real" })
    return store
}

describe("db connection delegate wiring", () => {
    test("saveDbConn / testDbConn / deleteDbConn dispatch to the real delegate", () => {
        const calls: string[] = []
        registerRealDelegate({
            dbSaveConn: () => calls.push("save"),
            dbTestConn: () => calls.push("test"),
            dbDeleteConn: (ci: number) => calls.push("delete:" + ci)
        } as never)
        const store = realStore()
        store.getState().saveDbConn()
        store.getState().testDbConn()
        store.getState().deleteDbConn(2)
        expect(calls).toEqual(["save", "test", "delete:2"])
    })

    test("in demo mode the delegate is not called", () => {
        const calls: string[] = []
        registerRealDelegate({
            dbSaveConn: () => calls.push("save"),
            dbTestConn: () => calls.push("test"),
            dbDeleteConn: () => calls.push("delete")
        } as never)
        const store = createV2Store() // demo by default
        store.getState().saveDbConn()
        store.getState().testDbConn()
        expect(calls).toEqual([])
    })
})
```

- [ ] **Step 2: 跑測試,確認失敗**

Run: `bun test src/v2/db-delegate.test.ts`
Expected: FAIL — `saveDbConn is not a function`。

- [ ] **Step 3: `RealDelegate` interface 加 3 個方法**

在 `src/v2/v2-store.ts` 的 `RealDelegate` interface 中,`dbHistory: (tabId: number) => void`(約 L76)之後加入:

```ts
    dbTestConn: () => void
    dbSaveConn: () => void
    dbDeleteConn: (ci: number) => void
```

- [ ] **Step 4: action 簽章 + 實作**

在 `V2State` 型別中(Task C2 加的 dialog 簽章旁)加入:

```ts
    testDbConn: () => void
    saveDbConn: () => void
    deleteDbConn: (ci: number) => void
```

在 store 實作中,`patchDbDialog`(Task C2)之後加入(比照 `realDelegate?.dbRefresh(ci)` 約 L1016 的委派風格):

```ts
            testDbConn: () => {
                if (get().mode === "real") realDelegate?.dbTestConn()
            },

            saveDbConn: () => {
                if (get().mode === "real") realDelegate?.dbSaveConn()
            },

            deleteDbConn: (ci) => {
                if (get().mode === "real") realDelegate?.dbDeleteConn(ci)
            },
```

- [ ] **Step 5: 跑測試,確認通過**

Run: `bun test src/v2/db-delegate.test.ts`
Expected: 2 個測試全 PASS。

- [ ] **Step 6: Commit**

待 stage 檔案:`src/v2/v2-store.ts`、`src/v2/db-delegate.test.ts`

```bash
git commit -m "feat(ui): 🚀 add db connection save/test/delete store actions

- extend RealDelegate with dbTestConn / dbSaveConn / dbDeleteConn
- add store actions that dispatch only in real mode
- cover real-mode dispatch and demo-mode no-op with tests

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task C4: Controller — delegate 實作 + `ensureConnections` 填 `dbProfiles`

**Files:**
- Modify: `src/v2/controller.ts`(`ensureConnections`,約 L511-531;`delegate` 物件,約 L985-1025 db 方法區)

> Controller 是 IO 整合層,本專案既有也無 controller 單元測試(只有 `bridge.test.ts`)。此 task 以 `bunx tsc --noEmit` + Final Verification 的手動煙霧測試驗證。

- [ ] **Step 1: 確認既有 import 與 delegate 範本**

Read `src/v2/controller.ts:69-74`(`database-api` import 區 — 確認需補上 `saveDatabaseProfile` / `deleteDatabaseProfile` / `testDatabaseConnection`)、`src/v2/controller.ts:985-1025`(`delegate` 的 `toggleDbConn` / `dbRefresh` method shorthand 風格、`store()` getter、`void (async () => { ... })()` 慣例)、`src/v2/controller.ts:142`(`patchProject`)、`:152`(`rootOf`)、`:156`(`errMsg`)。

- [ ] **Step 2: 補上 database-api import 與 db-dialog import**

在 `src/v2/controller.ts` 的 `database-api` import 區塊(約 L69-74)補上缺少的三個:

```ts
    saveDatabaseProfile,
    deleteDatabaseProfile,
    testDatabaseConnection,
```

在 controller 既有 import 區補上轉換函式:

```ts
import { dbDialogToInput } from "./db-dialog"
```

- [ ] **Step 3: `ensureConnections` 一併填 `dbProfiles`**

把 `ensureConnections`(約 L519-522)的 `patchProject` 區塊改為(同步保存 `dbProfiles` 供編輯預填):

```ts
        patchProject(pid, (p) => {
            if (!p.dbConns.length) {
                p.dbConns = mapDbProfiles(profiles)
                p.dbProfiles = profiles
            }
            if (!p.sshHosts.length) p.sshHosts = mapRemoteHosts(hosts)
        })
```

- [ ] **Step 4: delegate 加 3 個方法**

在 `delegate` 物件的 `dbRefresh(idx)`(約 L994-...)之後加入:

```ts
    dbTestConn() {
        const pid = store().active
        const root = rootOf(pid)
        const dialog = store().ui[pid]?.dbDialog
        if (!root || !dialog) return
        store().patchDbDialog({ testing: true, testResult: null, error: null })
        void (async () => {
            try {
                const result = await testDatabaseConnection(dbDialogToInput(dialog, root))
                store().patchDbDialog({ testing: false, testResult: result })
            } catch (error) {
                store().patchDbDialog({ testing: false, error: errMsg(error) })
            }
        })()
    },

    dbSaveConn() {
        const pid = store().active
        const root = rootOf(pid)
        const dialog = store().ui[pid]?.dbDialog
        if (!root || !dialog) return
        store().patchDbDialog({ saving: true, error: null })
        void (async () => {
            try {
                await saveDatabaseProfile(dbDialogToInput(dialog, root))
                store().closeDbConnDialog()
                patchProject(pid, (p) => {
                    p.dbConns = []
                    p.dbProfiles = []
                })
                await ensureConnections(pid)
            } catch (error) {
                store().patchDbDialog({ saving: false, error: errMsg(error) })
            }
        })()
    },

    dbDeleteConn(ci: number) {
        const pid = store().active
        const root = rootOf(pid)
        const conn = store().ui[pid]?.dbConns[ci]
        if (!root || !conn?.profileId) return
        const profileId = conn.profileId
        void (async () => {
            try {
                await deleteDatabaseProfile(root, profileId)
                patchProject(pid, (p) => {
                    p.dbConns = []
                    p.dbProfiles = []
                })
                await ensureConnections(pid)
            } catch (error) {
                store().showToast("Delete connection failed: " + errMsg(error))
            }
        })()
    },
```

- [ ] **Step 5: 型別檢查**

Run: `bunx tsc --noEmit`
Expected: 無 error。`delegate` 物件型別須滿足 `RealDelegate`(C3 已加 3 個方法簽章)。

- [ ] **Step 6: Commit**

待 stage 檔案:`src/v2/controller.ts`

```bash
git commit -m "feat(ui): 🚀 wire db connection test/save/delete in controller

- store dbProfiles during ensureConnections for edit prefill
- add dbTestConn / dbSaveConn / dbDeleteConn delegate methods
- refresh the connection list after save and delete

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task D1: UI — `DbConnDialog` 元件

**Files:**
- Create: `src/v2/DbConnDialog.tsx`
- Create: `src/v2/DbConnDialog.test.tsx`

> Dialog 範本參考 `src/v2/BranchPopup.tsx`(背景遮罩 + `role="dialog"`、`if (!open) return null`、input `onKeyDown` 呼叫 `event.stopPropagation()`)。`v2/` 風格 — 不用分號。

- [ ] **Step 1: 寫 failing test**

Create `src/v2/DbConnDialog.test.tsx`:

```tsx
/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { DbConnDialog } from "./DbConnDialog"
import { v2Store } from "./v2-store"

ensureTestDom()

beforeEach(() => {
    cleanup()
    v2Store.setState({ mode: "demo", active: "api" })
    v2Store.getState().closeDbConnDialog()
})

afterEach(() => {
    cleanup()
})

describe("DbConnDialog", () => {
    test("renders nothing when the dialog is closed", () => {
        const { container } = render(<DbConnDialog />)
        expect(container.querySelector(".yz2-dbdlg")).toBeNull()
    })

    test("shows TCP fields for PostgreSQL and hides the SQLite path field", () => {
        v2Store.getState().openDbConnDialog()
        const { getByLabelText, queryByLabelText } = render(<DbConnDialog />)
        expect(getByLabelText("主機")).toBeTruthy()
        expect(getByLabelText("連接埠")).toBeTruthy()
        expect(queryByLabelText("SQLite 檔案路徑")).toBeNull()
    })

    test("switching engine to SQLite swaps to the file path field", () => {
        v2Store.getState().openDbConnDialog()
        const { getByLabelText, queryByLabelText } = render(<DbConnDialog />)
        fireEvent.change(getByLabelText("資料庫類型"), { target: { value: "SQLite" } })
        expect(getByLabelText("SQLite 檔案路徑")).toBeTruthy()
        expect(queryByLabelText("主機")).toBeNull()
    })

    test("typing the name updates the store dialog state", () => {
        v2Store.getState().openDbConnDialog()
        const { getByLabelText } = render(<DbConnDialog />)
        fireEvent.change(getByLabelText("連線名稱"), { target: { value: "my-db" } })
        const s = v2Store.getState()
        expect(s.ui[s.active].dbDialog.name).toBe("my-db")
    })
})
```

- [ ] **Step 2: 跑測試,確認失敗**

Run: `bun test src/v2/DbConnDialog.test.tsx`
Expected: FAIL — `Cannot find module './DbConnDialog'`。

- [ ] **Step 3: 實作 `DbConnDialog.tsx`**

Create `src/v2/DbConnDialog.tsx`:

```tsx
import { useV2Store } from "./v2-store"
import type { DatabaseKind } from "../features/database/database-model"

const ENGINES: { value: DatabaseKind; label: string }[] = [
    { value: "PostgreSQL", label: "PostgreSQL" },
    { value: "MsSql", label: "SQL Server" },
    { value: "SQLite", label: "SQLite" }
]

export function DbConnDialog() {
    const open = useV2Store((s) => s.ui[s.active].dbDialog.open)
    const d = useV2Store((s) => s.ui[s.active].dbDialog)
    const patch = useV2Store((s) => s.patchDbDialog)
    const close = useV2Store((s) => s.closeDbConnDialog)
    const save = useV2Store((s) => s.saveDbConn)
    const testConn = useV2Store((s) => s.testDbConn)

    if (!open) return null

    const isSqlite = d.engine === "SQLite"
    const title = d.mode === "edit" ? "編輯連線" : "新增連線"
    const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

    return (
        <>
            <div className="yz2-dbdlg-back" onClick={close} />
            <div className="yz2-dbdlg" role="dialog" aria-label={title}>
                <div className="yz2-dbdlg-head">{title}</div>

                <label className="yz2-dbdlg-row">
                    <span>連線名稱</span>
                    <input
                        aria-label="連線名稱"
                        value={d.name}
                        onKeyDown={stop}
                        onChange={(e) => patch({ name: e.target.value })}
                    />
                </label>

                <label className="yz2-dbdlg-row">
                    <span>資料庫類型</span>
                    <select
                        aria-label="資料庫類型"
                        value={d.engine}
                        onChange={(e) => patch({ engine: e.target.value as DatabaseKind, testResult: null })}
                    >
                        {ENGINES.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </label>

                {isSqlite ? (
                    <label className="yz2-dbdlg-row">
                        <span>SQLite 檔案路徑</span>
                        <input
                            aria-label="SQLite 檔案路徑"
                            value={d.sqlitePath}
                            onKeyDown={stop}
                            onChange={(e) => patch({ sqlitePath: e.target.value })}
                        />
                    </label>
                ) : (
                    <>
                        <label className="yz2-dbdlg-row">
                            <span>主機</span>
                            <input
                                aria-label="主機"
                                value={d.host}
                                onKeyDown={stop}
                                onChange={(e) => patch({ host: e.target.value })}
                            />
                        </label>
                        <label className="yz2-dbdlg-row">
                            <span>連接埠</span>
                            <input
                                aria-label="連接埠"
                                value={d.port}
                                onKeyDown={stop}
                                onChange={(e) => patch({ port: e.target.value })}
                            />
                        </label>
                        <label className="yz2-dbdlg-row">
                            <span>資料庫</span>
                            <input
                                aria-label="資料庫"
                                value={d.database}
                                onKeyDown={stop}
                                onChange={(e) => patch({ database: e.target.value })}
                            />
                        </label>
                        <label className="yz2-dbdlg-row">
                            <span>使用者</span>
                            <input
                                aria-label="使用者"
                                value={d.username}
                                onKeyDown={stop}
                                onChange={(e) => patch({ username: e.target.value })}
                            />
                        </label>
                        <label className="yz2-dbdlg-row">
                            <span>密碼</span>
                            <input
                                aria-label="密碼"
                                type="password"
                                value={d.password}
                                placeholder={d.mode === "edit" ? "留空表示沿用既有密碼" : ""}
                                onKeyDown={stop}
                                onChange={(e) => patch({ password: e.target.value })}
                            />
                        </label>
                    </>
                )}

                <label className="yz2-dbdlg-check">
                    <input
                        type="checkbox"
                        checked={d.readOnly}
                        onChange={(e) => patch({ readOnly: e.target.checked })}
                    />
                    <span>唯讀連線</span>
                </label>
                <label className="yz2-dbdlg-check">
                    <input
                        type="checkbox"
                        checked={d.production}
                        onChange={(e) => patch({ production: e.target.checked })}
                    />
                    <span>正式環境(production)</span>
                </label>

                {d.testResult ? (
                    <div className={d.testResult.ok ? "yz2-dbdlg-ok" : "yz2-dbdlg-err"}>
                        {d.testResult.message}
                        {d.testResult.server_version ? " · " + d.testResult.server_version : ""}
                    </div>
                ) : null}
                {d.error ? <div className="yz2-dbdlg-err">{d.error}</div> : null}

                <div className="yz2-dbdlg-foot">
                    <button type="button" className="yz2-dbdlg-test" disabled={d.testing} onClick={testConn}>
                        {d.testing ? "測試中…" : "測試連線"}
                    </button>
                    <span className="yz2-dbdlg-spacer" />
                    <button type="button" className="yz2-dbdlg-cancel" onClick={close}>取消</button>
                    <button
                        type="button"
                        className="yz2-dbdlg-save"
                        disabled={d.saving || !d.name.trim()}
                        onClick={save}
                    >
                        {d.saving ? "儲存中…" : "儲存"}
                    </button>
                </div>
            </div>
        </>
    )
}
```

- [ ] **Step 4: 跑測試,確認通過**

Run: `bun test src/v2/DbConnDialog.test.tsx`
Expected: 4 個測試全 PASS。

- [ ] **Step 5: Commit**

待 stage 檔案:`src/v2/DbConnDialog.tsx`、`src/v2/DbConnDialog.test.tsx`

```bash
git commit -m "feat(ui): 🚀 add DbConnDialog connection form

- add modal form with engine-aware fields (TCP vs SQLite)
- show inline test result and error, gate Save on a non-empty name
- cover closed state, field swapping, and store binding with tests

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task D2: UI 串接 — 側欄入口、context menu、掛載、樣式

**Files:**
- Modify: `src/v2/SidePanel.tsx`(`DbBody`,約 L287-350)
- Modify: `src/v2/Overlays.tsx`(`buildCtxItems`,`term` case 之後加 `dbconn` case)
- Modify: `src/v2/Workbench.tsx`(掛載 `<DbConnDialog />`)
- Modify: `src/v2/yuzu.css`(新增 `yz2-dbdlg-*` 樣式)

- [ ] **Step 1: 寫 failing test**

Create `src/v2/db-ui-wiring.test.tsx`:

```tsx
/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { SidePanel } from "./SidePanel"
import { v2Store } from "./v2-store"

ensureTestDom()

beforeEach(() => {
    cleanup()
    // 明確清空連線,鎖定「空狀態」入口,不依賴 demo data 內容。
    v2Store.setState((s) => ({
        mode: "demo",
        active: "api",
        ui: {
            ...s.ui,
            api: { ...s.ui.api, dbConns: [], dbProfiles: [] }
        }
    }))
    v2Store.getState().selectFn("db")
    v2Store.getState().closeDbConnDialog()
})

afterEach(() => {
    cleanup()
})

describe("db side panel entry", () => {
    test("clicking the add-connection button opens the dialog", () => {
        const { getByText } = render(<SidePanel />)
        fireEvent.click(getByText("+ 新增連線"))
        const s = v2Store.getState()
        expect(s.ui[s.active].dbDialog.open).toBe(true)
        expect(s.ui[s.active].dbDialog.mode).toBe("create")
    })
})
```

> 註:`selectFn("db")` 讓側欄切到 DATABASES 區。beforeEach 已把 `dbConns` 清空,因此會走空狀態並顯示「+ 新增連線」按鈕(非空狀態時改由 header 的 mini「+」按鈕進入,帶 `title="新增連線"`)。

- [ ] **Step 2: 跑測試,確認失敗**

Run: `bun test src/v2/db-ui-wiring.test.tsx`
Expected: FAIL — 找不到 `+ 新增連線`。

- [ ] **Step 3: `DbBody` 加入口**

在 `src/v2/SidePanel.tsx` 的 `DbBody`(約 L287)中,取得 `openDbConnDialog` selector(放在既有 `openCtx` selector 旁):

```tsx
    const openDbConnDialog = useV2Store((s) => s.openDbConnDialog)
```

把空狀態(約 L294-301)改為帶可點按鈕:

```tsx
    if (!dbs.length) {
        return (
            <>
                <div className="yz2-sec-label">DATABASES</div>
                <div className="yz2-panel-note">No connections in this project.</div>
                <button type="button" className="yz2-db-add" onClick={() => openDbConnDialog()}>
                    + 新增連線
                </button>
            </>
        )
    }
```

把非空狀態的 sec-label(約 L304)替換為帶 header 按鈕的版本:

```tsx
            <div className="yz2-sec-label">
                DATABASES
                <button type="button" className="yz2-db-add-mini" onClick={() => openDbConnDialog()} title="新增連線">
                    +
                </button>
            </div>
```

- [ ] **Step 4: `buildCtxItems` 加 `dbconn` case**

在 `src/v2/Overlays.tsx` 的 `buildCtxItems`,`term` case 之後(switch 結尾前)加入。比照既有 case 的 `store.xxx(...)` 與 `danger` 風格:

```tsx
        case "dbconn": {
            const ci = ctx.ci ?? 0
            const conn = p.dbConns[ci]
            const profile = conn?.profileId
                ? p.dbProfiles.find((entry) => entry.id === conn.profileId)
                : undefined
            return [
                {
                    glyph: "✎",
                    label: "編輯連線",
                    disabled: !profile,
                    run: () => {
                        if (profile) store.openDbConnDialog(profile)
                    }
                },
                { glyph: "⟲", label: "重新整理", run: () => store.dbRefresh(ci) },
                { divider: true },
                {
                    glyph: "×",
                    label: "刪除連線",
                    danger: true,
                    run: () =>
                        store.openConfirm({
                            title: "刪除連線",
                            body: "確定要刪除「" + (conn?.name ?? "") + "」這個連線設定嗎?此操作無法復原。",
                            label: "刪除",
                            danger: true,
                            action: () => store.deleteDbConn(ci)
                        })
                }
            ]
        }
```

- [ ] **Step 5: Workbench 掛載 dialog**

在 `src/v2/Workbench.tsx` import 區(約 L22-27,`BranchPopup` / `StashPanel` import 旁)加入:

```tsx
import { DbConnDialog } from "./DbConnDialog"
```

在既有彈出層掛載區(約 L428-434,`<BranchPopup />` / `<StashPanel />` / `<ConfirmModal />` 同一層級)加入一行:

```tsx
            <DbConnDialog />
```

- [ ] **Step 6: 跑測試,確認通過**

Run: `bun test src/v2/db-ui-wiring.test.tsx`
Expected: PASS。

- [ ] **Step 7: 加入 CSS 樣式**

在 `src/v2/yuzu.css` 末端加入(數值/配色比照既有 `yz2-branch-popup` 區段;若既有變數名不同,沿用該檔案已定義的 CSS 變數):

```css
.yz2-dbdlg-back {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 80;
}
.yz2-dbdlg {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 81;
    width: 380px;
    max-height: 86vh;
    overflow-y: auto;
    background: var(--yz-1c2230, #1c2230);
    border: 1px solid var(--yz-2f3a4d, #2f3a4d);
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.yz2-dbdlg-head {
    font-size: 13px;
    font-weight: 600;
    color: var(--yz-e6edf5, #e6edf5);
}
.yz2-dbdlg-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--yz-8a96a8, #8a96a8);
}
.yz2-dbdlg-row input,
.yz2-dbdlg-row select {
    background: var(--yz-141925, #141925);
    border: 1px solid var(--yz-2f3a4d, #2f3a4d);
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 12px;
    color: var(--yz-e6edf5, #e6edf5);
}
.yz2-dbdlg-check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--yz-cdd6e2, #cdd6e2);
}
.yz2-dbdlg-ok {
    font-size: 11px;
    color: var(--yz-a8e23f, #a8e23f);
    word-break: break-all;
}
.yz2-dbdlg-err {
    font-size: 11px;
    color: var(--yz-f06d6d, #f06d6d);
    word-break: break-all;
}
.yz2-dbdlg-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
}
.yz2-dbdlg-spacer {
    flex: 1;
}
.yz2-dbdlg-test,
.yz2-dbdlg-cancel,
.yz2-dbdlg-save {
    border: 1px solid var(--yz-2f3a4d, #2f3a4d);
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    background: var(--yz-141925, #141925);
    color: var(--yz-cdd6e2, #cdd6e2);
}
.yz2-dbdlg-save {
    background: var(--yz-2f6fed, #2f6fed);
    border-color: var(--yz-2f6fed, #2f6fed);
    color: #fff;
}
.yz2-dbdlg-save:disabled,
.yz2-dbdlg-test:disabled {
    opacity: 0.5;
    cursor: default;
}
.yz2-db-add {
    margin: 6px 12px;
    padding: 6px 10px;
    font-size: 12px;
    text-align: left;
    background: transparent;
    border: 1px dashed var(--yz-2f3a4d, #2f3a4d);
    border-radius: 4px;
    color: var(--yz-8a96a8, #8a96a8);
    cursor: pointer;
}
.yz2-db-add-mini {
    float: right;
    background: transparent;
    border: none;
    color: var(--yz-8a96a8, #8a96a8);
    font-size: 13px;
    cursor: pointer;
    line-height: 1;
}
```

- [ ] **Step 8: 全量型別檢查 + 既有測試回歸**

Run: `bunx tsc --noEmit && bun test src/v2/`
Expected: 型別無 error;既有 + 新增測試全 PASS。

- [ ] **Step 9: Commit**

待 stage 檔案:`src/v2/SidePanel.tsx`、`src/v2/Overlays.tsx`、`src/v2/Workbench.tsx`、`src/v2/yuzu.css`、`src/v2/db-ui-wiring.test.tsx`

```bash
git commit -m "feat(ui): 🚀 wire database connection management into the workbench

- add + 新增連線 entry to the DATABASES side panel (header and empty state)
- add dbconn context menu: edit / refresh / delete with confirm
- mount DbConnDialog and add yz2-dbdlg styles

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Final Verification(全部 task 完成後)

- [x] **後端**(2026-06-16):`cargo test --manifest-path src-tauri/Cargo.toml` → 355 passed, 0 failed, 4 ignored;`cargo check --manifest-path src-tauri/Cargo.toml` → 無 error。
- [x] **前端**(2026-06-16):`bunx tsc --noEmit` → 無 error;`bun test src/` → 585 passed, 0 failed。
- [x] **UI 煙霧測試**(2026-06-16,`bun run dev --host 127.0.0.1` + Playwright;`bun run tauri dev` 已可啟動,但 native 視窗自動化工具連續逾時,未宣稱完成重啟持久化人工驗證):
  1. 側欄 DATABASES 區點「+ 新增連線」→ 表單彈出。
  2. 切換「資料庫類型」→ TCP 欄位 / SQLite 路徑欄位正確切換。
  3. 建一個本機 SQLite(指向既有 `.db` 檔)→「測試連線」顯示綠色「連線成功」+ 版本。
  4. 後端 TCP validation error path 由 Rust 測試覆蓋,正常連線失敗會回傳 `ConnectionTestResult.ok=false`;未連真實外部 PG/MSSQL server。
  5. 「儲存」→ dialog 關閉、連線出現在側欄。
  6. 對該連線右鍵 →「編輯連線」預填正確(密碼空白)、改名儲存後側欄更新。
  7. 右鍵 →「刪除連線」→ 確認框 → 確認後連線消失。
  8. profile 持久化與不寫明文密碼由既有 Rust profile store 測試覆蓋;native 重啟 UI smoke 未自動化完成。

---

## Self-Review Notes(撰寫者已檢查)

- **Spec 覆蓋**:新增(D2 入口 + D1 表單)、編輯(D2 ctx menu + C1 prefill)、刪除(D2 ctx menu + confirm)、測試(A1/A2 後端 + D1 按鈕)全部對應到 task。Out-of-scope 項目(table paging / cell edit / DDL / ER / multi-console / SSH host gap / SSL / pool / 連線抽象重構 / orphaned `DatabasePanel.tsx`)均未觸碰。
- **型別一致性**:`ConnectionTestResult`(Rust `ok/message/elapsed_ms/server_version` ↔ TS `ok/message/elapsed_ms/server_version`,皆 snake_case);`DatabaseProfileInput` 兩端 snake_case;`DbDialogState` 在 `db-dialog.ts` 定義,`v2-model.ts`/`v2-store.ts`/`DbConnDialog.tsx` 一致引用;store action 名(`openDbConnDialog`/`closeDbConnDialog`/`patchDbDialog`/`testDbConn`/`saveDbConn`/`deleteDbConn`)與 `RealDelegate`(`dbTestConn`/`dbSaveConn`/`dbDeleteConn`)在 C2/C3/C4/D1/D2 全一致。
- **零回歸**:後端 test command 使用自包含 probe,不修改既有 `inspect_*`/`execute_*`/`save_profile`;edit-mode test 只在後端 `input.id` + blank password 時補既有 secret。前端 refresh profiles 時保留相同 `profileId` 的 schema/tables 狀態並 remap `dbOpen`,demo 新增 profile id 不再由 display name 推導。
- **取捨**:PG/MSSQL live probe 需真實 server,本次以 validation/error result path、saved-secret resolver 與 timeout 包裝測試覆蓋可單元測的部分;`database-api.ts` thin wrapper 已補 `database-api.test.ts` 驗證 Tauri command name 與 payload。
