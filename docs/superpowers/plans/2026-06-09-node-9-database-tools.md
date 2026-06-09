# Node 9 Database Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bring SQLite, PostgreSQL, and MS SQL Server inspection, bounded query execution, query history, exports, read-only production profiles, and mutating-SQL confirmations into the Yuuzu-IDE workbench.

**Architecture:** Rust owns database profiles, local secret access, SQL safety classification, connection validation, schema inspection, query execution, result bounding, and CSV export. React owns the visible Database activity UI, a virtualized result surface, query drafts, selection state, and confirmation prompts, keeping only the currently rendered bounded result window in workspace-scoped view state. The roadmap contains browser-preview acceptance bullets under Node 9; treat those as Node 8 regression requirements to preserve, not new Node 9 implementation work.

**Tech Stack:** Tauri 2 commands, Rust 1.96.0, `rusqlite` latest (`0.40.1`) for SQLite, `tokio-postgres` latest (`0.7.17`) for PostgreSQL, `tiberius` latest (`0.12.3`) for MS SQL Server, `keyring` latest (`4.0.1`) for local OS secret storage, `sqlparser` latest (`0.62.0`) for SQL classification help, React 19.2.7, TypeScript 6.0.3, Vite 8.0.16, lucide-react 1.17.0, and `@tanstack/react-virtual` latest (`3.14.2`) for large tables.

---

## Source Context

- Roadmap scope: `roadmap.md` Node 9 requires SQLite, PostgreSQL, MS SQL Server, schema explorer, table view, query editor, history, export, read-only production option, and visible confirmation for mutating SQL.
- UI source of truth: `docs/ui-design/app.jsx` has a `database` rail item and `openDb(db, table)` behavior; `docs/ui-design/panels.jsx` lines around `DatabasePanel` show compact connection rows, status dots, tables folder, and table rows; `docs/ui-design/data.jsx` defines SQLite/PostgreSQL/MS SQL sample profiles and query results.
- Architecture source of truth: `docs/architecture/tech-stack.md` says Rust owns database connections/query execution/secrets and React must not own large database result sets beyond the currently rendered window.
- Existing app patterns: `src/features/browser/*`, `src/features/git/*`, `src/features/docs/*`, `src/app/workspace-view-state.ts`, `src/app/AppShell.tsx`, and `src-tauri/src/commands.rs`.

## File Structure

- Create `src-tauri/src/database.rs`: domain types, profile store, secret store abstraction, SQL classification, schema/query/export orchestration, SQLite/Postgres/MSSQL adapters, and Rust unit tests.
- Modify `src-tauri/src/commands.rs`: add AppState database store access and Tauri command wrappers.
- Modify `src-tauri/src/lib.rs`: register the database module and commands.
- Modify `src-tauri/Cargo.toml` / `Cargo.lock`: add latest database, secret, async, CSV, and URL dependencies via `cargo add`.
- Create `src/features/database/database-model.ts`: workspace-scoped state and pure reducers for profiles, schema, query drafts, history, safety, results, export state, and errors.
- Create `src/features/database/database-model.test.ts`: pure model tests.
- Create `src/features/database/database-api.ts`: typed Tauri command wrappers.
- Create `src/features/database/DatabasePanel.tsx`: connection list, schema explorer, query editor, history, export action, mutating confirmation UI.
- Create `src/features/database/DatabasePanel.test.tsx`: React behavior tests.
- Create `src/features/database/DatabaseResultView.tsx`: virtualized table result surface.
- Create `src/features/database/DatabaseResultView.test.tsx`: table virtualization/rendering tests.
- Modify `src/app/workspace-view-state.ts` and `src/app/workspace-view-state.test.ts`: add `database` state, freeze defaults, and workspace-scoped update function.
- Modify `src/app/AppShell.tsx` and `src/app/AppShell.contract.test.tsx`: wire DatabasePanel, result surface, API actions, startup profile loading, command palette entry, and Node 8 browser regression smoke.
- Modify `src/index.css`: database panel/result styles using existing design tokens and `dbgrid`.
- Modify `docs/architecture/progress.md`, `roadmap.md`, and create `docs/architecture/node-9-database-tools-results.md` after verification.

## Task 1: Rust Dependencies And Database Domain Model

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/database.rs`

- [ ] **Step 1: Install latest dependencies**

Run:

```bash
. "$HOME/.cargo/env" && cargo add rusqlite@0.40.1 --features bundled --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo add tokio-postgres@0.7.17 futures-util@0.3.32 keyring@4.0.1 sqlparser@0.62.0 csv@1.4.0 url@2.5.8 --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo add tokio@1.52.3 --features rt,time,net,macros --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo add tokio-util@0.7.18 --features compat --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo add tiberius@0.12.3 --no-default-features --features tds73,tokio,tokio-util,rustls --manifest-path src-tauri/Cargo.toml
```

Expected: dependencies are added to `src-tauri/Cargo.toml` and `Cargo.lock` without downgrading existing crates.

- [ ] **Step 2: Write failing Rust tests for SQL classification and bounded result data**

Add this test module to the new `src-tauri/src/database.rs` before implementation:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_reads_and_mutations_with_confirmation_policy() {
        assert_eq!(classify_sql("SELECT * FROM users").kind, QueryKind::Read);
        assert_eq!(classify_sql("  WITH recent AS (SELECT 1) SELECT * FROM recent").kind, QueryKind::Read);

        let update = classify_sql("UPDATE users SET role = 'admin'");
        assert_eq!(update.kind, QueryKind::Mutation);
        assert!(update.requires_confirmation);
        assert_eq!(update.confirmation_text, "RUN MUTATION");

        let drop_table = classify_sql("DROP TABLE users");
        assert_eq!(drop_table.kind, QueryKind::Destructive);
        assert!(drop_table.requires_confirmation);
        assert_eq!(drop_table.confirmation_text, "RUN DESTRUCTIVE SQL");
    }

    #[test]
    fn readonly_profiles_reject_mutating_sql_even_with_confirmation() {
        let profile = database_profile(
            "profile-1",
            DatabaseKind::PostgreSQL,
            true,
            true,
        );

        let result = validate_query_request(
            &profile,
            &DatabaseQueryRequest {
                profile_id: profile.id.clone(),
                sql: "DELETE FROM audit_log".to_string(),
                limit: 100,
                confirmation: Some("RUN DESTRUCTIVE SQL".to_string()),
            },
        );

        assert_eq!(
            result.expect_err("read-only profile blocks mutation"),
            "read-only database profile blocks mutating SQL"
        );
    }

    #[test]
    fn query_results_are_bounded_and_cells_are_truncated() {
        let result = DatabaseQueryResult::from_rows(
            vec!["id".to_string(), "payload".to_string()],
            (0..600)
                .map(|index| {
                    vec![
                        DatabaseCell::text(index.to_string()),
                        DatabaseCell::text("x".repeat(MAX_DATABASE_CELL_CHARS + 10)),
                    ]
                })
                .collect(),
            42,
        );

        assert_eq!(result.rows.len(), MAX_DATABASE_ROWS);
        assert!(result.truncated);
        assert_eq!(
            result.rows[0].cells[1].display.len(),
            MAX_DATABASE_CELL_CHARS
        );
    }

    fn database_profile(
        id: &str,
        kind: DatabaseKind,
        read_only: bool,
        production: bool,
    ) -> DatabaseProfile {
        DatabaseProfile {
            id: id.to_string(),
            workspace_root: "/workspace".to_string(),
            name: "Profile".to_string(),
            kind,
            source: DatabaseConnectionSource::Tcp {
                host: "localhost".to_string(),
                port: 5432,
                database: "app".to_string(),
                username: Some("yuuzu".to_string()),
                secret_id: Some("secret-1".to_string()),
            },
            read_only,
            production,
            created_ms: 1,
            updated_ms: 1,
        }
    }
}
```

- [ ] **Step 3: Run RED Rust test**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml database::tests
```

Expected: FAIL because `database` module/types/functions do not exist yet.

- [ ] **Step 4: Implement the domain model and pure safety functions**

Add the module with these public types and constants:

```rust
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_DATABASE_ROWS: usize = 500;
pub const MAX_DATABASE_CELL_CHARS: usize = 2_000;
pub const MAX_QUERY_HISTORY: usize = 30;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum DatabaseKind {
    SQLite,
    PostgreSQL,
    MsSql,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum DatabaseConnectionSource {
    SQLite { path: PathBuf },
    Tcp {
        host: String,
        port: u16,
        database: String,
        username: Option<String>,
        secret_id: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseProfile {
    pub id: String,
    pub workspace_root: String,
    pub name: String,
    pub kind: DatabaseKind,
    pub source: DatabaseConnectionSource,
    pub read_only: bool,
    pub production: bool,
    pub created_ms: u64,
    pub updated_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseProfileInput {
    pub id: Option<String>,
    pub workspace_root: String,
    pub name: String,
    pub kind: DatabaseKind,
    pub sqlite_path: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub read_only: bool,
    pub production: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseSchema {
    pub profile_id: String,
    pub tables: Vec<DatabaseTable>,
    pub refreshed_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseTable {
    pub schema: Option<String>,
    pub name: String,
    pub row_count: Option<u64>,
    pub columns: Vec<DatabaseColumn>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum QueryKind {
    Read,
    Mutation,
    Destructive,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct QueryClassification {
    pub kind: QueryKind,
    pub requires_confirmation: bool,
    pub confirmation_text: String,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseQueryRequest {
    pub profile_id: String,
    pub sql: String,
    pub limit: usize,
    pub confirmation: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseQueryResult {
    pub profile_id: String,
    pub sql: String,
    pub classification: QueryClassification,
    pub columns: Vec<String>,
    pub rows: Vec<DatabaseRow>,
    pub affected_rows: Option<u64>,
    pub truncated: bool,
    pub executed_ms: u64,
    pub history_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseRow {
    pub cells: Vec<DatabaseCell>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum DatabaseCellKind {
    Null,
    Text,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseCell {
    pub kind: DatabaseCellKind,
    pub display: String,
}

impl DatabaseCell {
    pub fn null() -> Self {
        Self {
            kind: DatabaseCellKind::Null,
            display: String::new(),
        }
    }

    pub fn text(value: impl Into<String>) -> Self {
        Self {
            kind: DatabaseCellKind::Text,
            display: truncate_cell(value.into()),
        }
    }
}
```

Implement `classify_sql`, `validate_query_request`, `DatabaseQueryResult::from_rows`, and a `database_now_ms()` helper. Keep classification conservative:

```rust
pub fn classify_sql(sql: &str) -> QueryClassification {
    let token = first_sql_token(sql);
    let kind = match token.as_deref() {
        Some("SELECT" | "WITH" | "EXPLAIN" | "SHOW" | "DESCRIBE") => QueryKind::Read,
        Some("INSERT" | "UPDATE" | "DELETE" | "MERGE" | "CALL") => QueryKind::Mutation,
        Some("DROP" | "TRUNCATE" | "ALTER" | "CREATE" | "REINDEX" | "VACUUM") => QueryKind::Destructive,
        _ => QueryKind::Destructive,
    };
    let (requires_confirmation, confirmation_text, reason) = match kind {
        QueryKind::Read => (false, String::new(), "read-only statement".to_string()),
        QueryKind::Mutation => (
            true,
            "RUN MUTATION".to_string(),
            "mutating SQL requires visible confirmation".to_string(),
        ),
        QueryKind::Destructive => (
            true,
            "RUN DESTRUCTIVE SQL".to_string(),
            "destructive or unknown SQL requires explicit confirmation".to_string(),
        ),
    };
    QueryClassification {
        kind,
        requires_confirmation,
        confirmation_text,
        reason,
    }
}
```

Strip leading whitespace plus `-- line` and `/* block */` comments in `first_sql_token`. Do not use `sqlparser` as the only safety gate; parser failures must default to destructive.

- [ ] **Step 5: Run GREEN Rust test**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml database::tests
```

Expected: PASS for the three database model tests.

- [ ] **Step 6: Commit Task 1**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/database.rs
git commit -m "feat: add database safety model"
```

## Task 2: Rust Profile Store And Local Secret Storage

**Files:**
- Modify: `src-tauri/src/database.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing tests for metadata-only persistence and secret store separation**

Append these tests to `src-tauri/src/database.rs`:

```rust
#[test]
fn profile_store_persists_metadata_without_passwords_or_connection_strings() {
    let temp = tempfile::tempdir().expect("temp dir");
    let store = DatabaseProfileStore::new(temp.path().join("database-profiles.json"));
    let secrets = InMemoryDatabaseSecretStore::default();

    let saved = store
        .save_profile(
            DatabaseProfileInput {
                id: None,
                workspace_root: "/workspace".to_string(),
                name: "prod".to_string(),
                kind: DatabaseKind::PostgreSQL,
                sqlite_path: None,
                host: Some("db.example.test".to_string()),
                port: Some(5432),
                database: Some("app".to_string()),
                username: Some("yuuzu".to_string()),
                password: Some("super-secret".to_string()),
                read_only: true,
                production: true,
            },
            &secrets,
            || Ok(10),
            || "profile-1".to_string(),
        )
        .expect("save profile");

    assert_eq!(secrets.get_secret(saved.source.secret_id().unwrap()).unwrap(), "super-secret");
    let persisted = std::fs::read_to_string(temp.path().join("database-profiles.json"))
        .expect("profile json");
    assert!(!persisted.contains("super-secret"));
    assert!(!persisted.contains("postgres://"));
    assert!(persisted.contains("secret_id"));
}

#[test]
fn deleting_profile_deletes_associated_secret() {
    let temp = tempfile::tempdir().expect("temp dir");
    let store = DatabaseProfileStore::new(temp.path().join("database-profiles.json"));
    let secrets = InMemoryDatabaseSecretStore::default();
    let saved = store
        .save_profile(
            DatabaseProfileInput {
                id: Some("profile-1".to_string()),
                workspace_root: "/workspace".to_string(),
                name: "legacy".to_string(),
                kind: DatabaseKind::MsSql,
                sqlite_path: None,
                host: Some("localhost".to_string()),
                port: Some(1433),
                database: Some("ERP".to_string()),
                username: Some("sa".to_string()),
                password: Some("pw".to_string()),
                read_only: false,
                production: false,
            },
            &secrets,
            || Ok(10),
            || "profile-1".to_string(),
        )
        .expect("save");

    let secret_id = saved.source.secret_id().unwrap().to_string();
    store.delete_profile("profile-1", &secrets).expect("delete");

    assert!(secrets.get_secret(&secret_id).is_err());
}
```

- [ ] **Step 2: Run RED profile-store tests**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml database::tests
```

Expected: FAIL because `DatabaseProfileStore`, `DatabaseSecretStore`, and helpers do not exist.

- [ ] **Step 3: Implement profile store, secret-store trait, and keyring implementation**

Implement in `src-tauri/src/database.rs`:

```rust
pub trait DatabaseSecretStore: Send + Sync {
    fn set_secret(&self, secret_id: &str, secret: &str) -> Result<(), String>;
    fn get_secret(&self, secret_id: &str) -> Result<String, String>;
    fn delete_secret(&self, secret_id: &str) -> Result<(), String>;
}

#[derive(Clone, Debug)]
pub struct KeyringDatabaseSecretStore {
    service: String,
}

impl KeyringDatabaseSecretStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self { service: service.into() }
    }
}
```

Use `keyring::Entry::new(&self.service, secret_id)` in `set_secret`, `get_secret`, and `delete_secret`. For tests, implement `InMemoryDatabaseSecretStore` under `#[cfg(test)]` with `Arc<Mutex<HashMap<String, String>>>`.

Implement `DatabaseProfileStore` with atomic JSON writes, sorted list output, `save_profile`, `delete_profile`, `get_profile`, and `list_profiles(workspace_root)`. The saved profile JSON must contain only metadata and `secret_id`; it must never contain `password`, `connection_string`, or raw DSNs.

Add `pub fn secret_id(&self) -> Option<&str>` on `DatabaseConnectionSource`.

- [ ] **Step 4: Wire AppState and Tauri commands**

In `src-tauri/src/commands.rs`, add fields to `AppState`:

```rust
database_profiles: crate::database::DatabaseProfileStore,
database_secrets: crate::database::KeyringDatabaseSecretStore,
```

Initialize with:

```rust
let database_profiles =
    crate::database::DatabaseProfileStore::new(config_dir.as_ref().join("database-profiles.json"));
let database_secrets =
    crate::database::KeyringDatabaseSecretStore::new("yuuzu-ide.database");
```

Add commands:

```rust
#[tauri::command]
pub fn list_database_profiles(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<crate::database::DatabaseProfile>, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    state
        .database_profiles
        .list_profiles(&workspace_root.to_string_lossy())
}

#[tauri::command]
pub fn save_database_profile(
    state: State<'_, AppState>,
    input: crate::database::DatabaseProfileInput,
) -> Result<crate::database::DatabaseProfile, String> {
    let workspace_root = state.trusted_workspace_root(&input.workspace_root)?;
    let input = crate::database::DatabaseProfileInput {
        workspace_root: workspace_root.to_string_lossy().to_string(),
        ..input
    };
    state.database_profiles.save_profile(
        input,
        &state.database_secrets,
        crate::database::database_now_ms,
        || uuid::Uuid::new_v4().to_string(),
    )
}

#[tauri::command]
pub fn delete_database_profile(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<(), String> {
    state
        .database_profiles
        .delete_profile(&profile_id, &state.database_secrets)
}
```

In `src-tauri/src/lib.rs`, add `pub mod database;` and register these commands.

- [ ] **Step 5: Run GREEN profile-store tests**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml database::tests
```

Expected: PASS.

- [ ] **Step 6: Run command signature regression**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml commands::tests
```

Expected: PASS. If command signature helpers require updates, add focused tests showing `list_database_profiles`, `save_database_profile`, and `delete_database_profile` keep flat Tauri argument signatures.

- [ ] **Step 7: Commit Task 2**

```bash
git add src-tauri/src/database.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: persist database profiles securely"
```

## Task 3: Rust Schema, Query, History, And Export Commands

**Files:**
- Modify: `src-tauri/src/database.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing SQLite behavior tests**

Add tests to `src-tauri/src/database.rs`:

```rust
#[test]
fn sqlite_schema_lists_tables_columns_and_row_counts() {
    let temp = tempfile::tempdir().expect("temp dir");
    let db_path = temp.path().join("local.db");
    seed_sqlite_database(&db_path);
    let profile = sqlite_profile("profile-1", &db_path, true);

    let schema = inspect_sqlite_schema(&profile).expect("schema");

    let users = schema.tables.iter().find(|table| table.name == "users").unwrap();
    assert_eq!(users.row_count, Some(2));
    assert!(users.columns.iter().any(|column| column.name == "id" && column.primary_key));
    assert!(users.columns.iter().any(|column| column.name == "email" && !column.nullable));
}

#[test]
fn sqlite_query_returns_bounded_rows_for_selects() {
    let temp = tempfile::tempdir().expect("temp dir");
    let db_path = temp.path().join("local.db");
    seed_sqlite_database(&db_path);
    let profile = sqlite_profile("profile-1", &db_path, true);

    let result = execute_sqlite_query(
        &profile,
        DatabaseQueryRequest {
            profile_id: profile.id.clone(),
            sql: "SELECT id, email FROM users ORDER BY id".to_string(),
            limit: 100,
            confirmation: None,
        },
        || Ok(99),
        || "history-1".to_string(),
    )
    .expect("query");

    assert_eq!(result.columns, vec!["id", "email"]);
    assert_eq!(result.rows.len(), 2);
    assert_eq!(result.rows[0].cells[1].display, "a@example.test");
    assert_eq!(result.classification.kind, QueryKind::Read);
}

#[test]
fn sqlite_mutation_requires_visible_confirmation() {
    let temp = tempfile::tempdir().expect("temp dir");
    let db_path = temp.path().join("local.db");
    seed_sqlite_database(&db_path);
    let profile = sqlite_profile("profile-1", &db_path, false);

    let err = execute_sqlite_query(
        &profile,
        DatabaseQueryRequest {
            profile_id: profile.id.clone(),
            sql: "UPDATE users SET email = 'x@example.test' WHERE id = 1".to_string(),
            limit: 100,
            confirmation: None,
        },
        || Ok(99),
        || "history-1".to_string(),
    )
    .expect_err("confirmation required");

    assert_eq!(err, "mutating SQL requires confirmation text: RUN MUTATION");
}

#[test]
fn csv_export_writes_headers_and_rows_without_secrets() {
    let temp = tempfile::tempdir().expect("temp dir");
    let result = DatabaseQueryResult::from_rows_for_profile(
        "profile-1",
        "SELECT email FROM users",
        classify_sql("SELECT email FROM users"),
        vec!["email".to_string()],
        vec![vec![DatabaseCell::text("a@example.test")]],
        12,
        "history-1".to_string(),
    );

    let path = export_query_result_csv(temp.path(), &result).expect("export");
    let csv = std::fs::read_to_string(path).expect("csv");

    assert!(csv.starts_with("email\n"));
    assert!(csv.contains("a@example.test"));
    assert!(!csv.contains("profile-1"));
}
```

Also add test helpers `seed_sqlite_database` and `sqlite_profile`.

- [ ] **Step 2: Run RED SQLite tests**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml database::tests
```

Expected: FAIL because schema/query/export functions do not exist.

- [ ] **Step 3: Implement SQLite schema/query/export and query history**

Implement:

```rust
pub fn inspect_database_schema(
    profile: &DatabaseProfile,
    secrets: &dyn DatabaseSecretStore,
) -> Result<DatabaseSchema, String>
```

Dispatch by kind. For SQLite, use `rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY` when `profile.read_only` is true and `SQLITE_OPEN_READ_WRITE` otherwise. Use `sqlite_master` for tables, `PRAGMA table_info('<table>')` for columns, and bounded `SELECT COUNT(*)` per table. Quote SQLite identifiers by doubling `"` characters.

Implement:

```rust
pub fn execute_database_query(
    profile: &DatabaseProfile,
    request: DatabaseQueryRequest,
    secrets: &dyn DatabaseSecretStore,
) -> Result<DatabaseQueryResult, String>
```

Validate classification first. For reads, run `query` and collect up to `request.limit.min(MAX_DATABASE_ROWS)`. For mutations/destructive statements, require exact confirmation text and return affected row count.

Implement `DatabaseQueryHistoryStore` in memory on AppState, scoped by `profile_id`, with `MAX_QUERY_HISTORY` entries. Query history must store SQL, kind, executed_ms, affected_rows, and row_count, not credentials or result payloads.

Implement `export_query_result_csv(export_root, result)` with the `csv` crate.

- [ ] **Step 4: Add PostgreSQL and MS SQL adapter skeletons with testable SQL builders**

Implement PostgreSQL support with `tokio-postgres`:

```rust
async fn inspect_postgres_schema(profile: &DatabaseProfile, password: Option<String>) -> Result<DatabaseSchema, String>
async fn execute_postgres_query(profile: &DatabaseProfile, request: DatabaseQueryRequest, password: Option<String>) -> Result<DatabaseQueryResult, String>
```

Use `information_schema.tables` and `information_schema.columns`; row counts can be `None` unless a cheap count is requested from a selected table. Convert common cell types (`TEXT`, `VARCHAR`, integer, float, bool, JSON, timestamp) to text, and fall back to `"<unsupported>"`.

Implement MS SQL support with `tiberius`:

```rust
async fn inspect_mssql_schema(profile: &DatabaseProfile, password: Option<String>) -> Result<DatabaseSchema, String>
async fn execute_mssql_query(profile: &DatabaseProfile, request: DatabaseQueryRequest, password: Option<String>) -> Result<DatabaseQueryResult, String>
```

Use `INFORMATION_SCHEMA.TABLES` and `INFORMATION_SCHEMA.COLUMNS`; connect with `tokio::net::TcpStream`, `tokio_util::compat::TokioAsyncWriteCompatExt`, and `tiberius::Client::connect`.

Add unit tests for connection option builders without needing live servers. Use a
small internal `TcpConnectionParts` struct so tests do not rely on third-party
`Debug` implementations:

```rust
#[test]
fn postgres_connection_parts_keep_password_out_of_redacted_labels() {
    let profile = tcp_profile(DatabaseKind::PostgreSQL, 5432, Some("secret-1"));
    let parts = postgres_connection_parts(&profile, Some("pw".to_string())).expect("parts");

    assert_eq!(parts.host, "localhost");
    assert_eq!(parts.port, 5432);
    assert_eq!(parts.password.as_deref(), Some("pw"));
    assert!(!parts.redacted_label().contains("pw"));
    assert!(parts.redacted_label().contains("localhost:5432"));
}

#[test]
fn mssql_connection_parts_use_profile_host_port_database_and_username() {
    let profile = tcp_profile(DatabaseKind::MsSql, 1433, Some("secret-1"));
    let parts = mssql_connection_parts(&profile, Some("pw".to_string())).expect("parts");

    assert_eq!(parts.host, "localhost");
    assert_eq!(parts.port, 1433);
    assert_eq!(parts.database, "app");
    assert_eq!(parts.username.as_deref(), Some("yuuzu"));
}
```

- [ ] **Step 5: Wire schema/query/history/export commands**

Add Tauri commands:

```rust
#[tauri::command]
pub async fn inspect_database_schema(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<crate::database::DatabaseSchema, String>

#[tauri::command]
pub async fn execute_database_query(
    state: State<'_, AppState>,
    request: crate::database::DatabaseQueryRequest,
) -> Result<crate::database::DatabaseQueryResult, String>

#[tauri::command]
pub fn list_database_query_history(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<crate::database::DatabaseQueryHistoryEntry>, String>

#[tauri::command]
pub fn export_database_query_result(
    state: State<'_, AppState>,
    workspace_root: String,
    result: crate::database::DatabaseQueryResult,
) -> Result<crate::database::DatabaseExport, String>
```

Export to an app-controlled config/export directory or a workspace-local `.yuuzu/database-exports/` directory only after confirming this does not expose secrets; CSV must not contain profile secrets.

- [ ] **Step 6: Run GREEN Rust database tests**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml database::tests
```

Expected: PASS.

- [ ] **Step 7: Run broader Rust check**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS. Record total test counts for Node 9 docs.

- [ ] **Step 8: Commit Task 3**

```bash
git add src-tauri/src/database.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add database query commands"
```

## Task 4: Frontend Database Model, API, Panel, And Result View

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `src/features/database/database-model.ts`
- Create: `src/features/database/database-model.test.ts`
- Create: `src/features/database/database-api.ts`
- Create: `src/features/database/DatabasePanel.tsx`
- Create: `src/features/database/DatabasePanel.test.tsx`
- Create: `src/features/database/DatabaseResultView.tsx`
- Create: `src/features/database/DatabaseResultView.test.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Install latest frontend virtualization dependency**

Run:

```bash
bun add @tanstack/react-virtual@latest
```

Expected: `@tanstack/react-virtual` resolves to `3.14.2` or newer.

- [ ] **Step 2: Write failing model tests**

Create `src/features/database/database-model.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  createDatabaseState,
  replaceDatabaseProfiles,
  selectDatabaseProfile,
  storeDatabaseSchema,
  updateDatabaseDraft,
  beginDatabaseQuery,
  storeDatabaseQueryResult,
  requireDatabaseConfirmation,
  databaseBadgeCount,
  type DatabaseProfile,
  type DatabaseQueryResult,
} from "./database-model";

describe("database model", () => {
  test("stores profiles and selects the first profile", () => {
    const state = replaceDatabaseProfiles(createDatabaseState(), [
      profile("local", "SQLite"),
      profile("prod", "PostgreSQL"),
    ]);

    expect(state.activeProfileId).toBe("local");
    expect(databaseBadgeCount(state)).toBe("2");
  });

  test("schema is scoped by profile id", () => {
    const state = storeDatabaseSchema(createDatabaseState(), {
      profile_id: "local",
      refreshed_ms: 1,
      tables: [{ schema: null, name: "users", row_count: 2, columns: [] }],
    });

    expect(state.schemaByProfileId.local.tables[0].name).toBe("users");
  });

  test("mutating SQL stores a visible confirmation requirement before running", () => {
    const state = requireDatabaseConfirmation(
      updateDatabaseDraft(createDatabaseState(), "DELETE FROM users"),
      {
        kind: "Destructive",
        requires_confirmation: true,
        confirmation_text: "RUN DESTRUCTIVE SQL",
        reason: "destructive or unknown SQL requires explicit confirmation",
      },
    );

    expect(state.confirmation?.confirmationText).toBe("RUN DESTRUCTIVE SQL");
    expect(state.pendingQuery).toBe("DELETE FROM users");
  });

  test("query result replaces loading state without storing unbounded payloads", () => {
    const loading = beginDatabaseQuery(createDatabaseState());
    const state = storeDatabaseQueryResult(loading, result("local", 600));

    expect(state.loading).toBe(false);
    expect(state.activeResult?.rows).toHaveLength(500);
    expect(state.activeResult?.truncated).toBe(true);
  });

  function profile(id: string, kind: DatabaseProfile["kind"]): DatabaseProfile {
    return {
      id,
      workspace_root: "/repo",
      name: id,
      kind,
      source: { kind: "SQLite", path: "/repo/local.db" },
      read_only: kind !== "SQLite",
      production: kind !== "SQLite",
      created_ms: 1,
      updated_ms: 1,
    };
  }

  function result(profileId: string, rows: number): DatabaseQueryResult {
    return {
      profile_id: profileId,
      sql: "SELECT id FROM users",
      classification: {
        kind: "Read",
        requires_confirmation: false,
        confirmation_text: "",
        reason: "read-only statement",
      },
      columns: ["id"],
      rows: Array.from({ length: rows }, (_, index) => ({
        cells: [{ kind: "Text", display: String(index) }],
      })).slice(0, 500),
      affected_rows: null,
      truncated: rows > 500,
      executed_ms: 10,
      history_id: "history-1",
    };
  }
});
```

- [ ] **Step 3: Run RED model tests**

Run:

```bash
bun test src/features/database/database-model.test.ts
```

Expected: FAIL because the database model file does not exist.

- [ ] **Step 4: Implement database model and API wrappers**

Create `src/features/database/database-model.ts` with Rust-compatible types. Use string enum values matching serde output (`"SQLite"`, `"PostgreSQL"`, `"MsSql"`, `"Read"`, `"Mutation"`, `"Destructive"`). Store only bounded `activeResult`, `queryDraft`, `history`, `schemaByProfileId`, `profiles`, `activeProfileId`, `activeTable`, `loading`, `error`, `confirmation`, and `export`.

Create `src/features/database/database-api.ts`:

```ts
import { call } from "../../lib/tauri";
import type {
  DatabaseExport,
  DatabaseProfile,
  DatabaseProfileInput,
  DatabaseQueryHistoryEntry,
  DatabaseQueryRequest,
  DatabaseQueryResult,
  DatabaseSchema,
} from "./database-model";

export function listDatabaseProfiles(workspaceRoot: string): Promise<DatabaseProfile[]> {
  return call("list_database_profiles", { workspaceRoot });
}

export function saveDatabaseProfile(input: DatabaseProfileInput): Promise<DatabaseProfile> {
  return call("save_database_profile", { input });
}

export function deleteDatabaseProfile(profileId: string): Promise<void> {
  return call("delete_database_profile", { profileId });
}

export function inspectDatabaseSchema(profileId: string): Promise<DatabaseSchema> {
  return call("inspect_database_schema", { profileId });
}

export function executeDatabaseQuery(request: DatabaseQueryRequest): Promise<DatabaseQueryResult> {
  return call("execute_database_query", { request });
}

export function listDatabaseQueryHistory(profileId: string): Promise<DatabaseQueryHistoryEntry[]> {
  return call("list_database_query_history", { profileId });
}

export function exportDatabaseQueryResult(
  workspaceRoot: string,
  result: DatabaseQueryResult,
): Promise<DatabaseExport> {
  return call("export_database_query_result", { workspaceRoot, result });
}
```

- [ ] **Step 5: Run GREEN model tests**

Run:

```bash
bun test src/features/database/database-model.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write failing panel and result-view tests**

Create `src/features/database/DatabasePanel.test.tsx`:

```tsx
/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { ensureTestDom } from "../../app/test-dom";
import { createDatabaseState, replaceDatabaseProfiles, storeDatabaseSchema } from "./database-model";
import { DatabasePanel } from "./DatabasePanel";

ensureTestDom();

const { cleanup, fireEvent, render } = await import("@testing-library/react");

afterEach(() => cleanup());

describe("DatabasePanel", () => {
  test("renders profiles, schema tables, and query controls from the design reference", () => {
    const onRunQuery = mock(() => {});
    const state = storeDatabaseSchema(
      replaceDatabaseProfiles(createDatabaseState(), [
        {
          id: "local",
          workspace_root: "/repo",
          name: "local.db",
          kind: "SQLite",
          source: { kind: "SQLite", path: "/repo/local.db" },
          read_only: false,
          production: false,
          created_ms: 1,
          updated_ms: 1,
        },
      ]),
      {
        profile_id: "local",
        refreshed_ms: 1,
        tables: [{ schema: null, name: "users", row_count: 2, columns: [] }],
      },
    );

    const view = render(
      <DatabasePanel
        state={{ ...state, queryDraft: "SELECT * FROM users" }}
        onRefreshProfiles={() => {}}
        onSelectProfile={() => {}}
        onInspectSchema={() => {}}
        onOpenTable={() => {}}
        onQueryDraftChange={() => {}}
        onRunQuery={onRunQuery}
        onConfirmQuery={() => {}}
        onCancelConfirmation={() => {}}
        onExportResult={() => {}}
        onSelectHistory={() => {}}
      />,
    );

    expect(view.getByText("local.db")).toBeTruthy();
    expect(view.getByRole("button", { name: "Open table users" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Run query" }));
    expect(onRunQuery).toHaveBeenCalled();
  });

  test("shows explicit confirmation text for mutating SQL", () => {
    const view = render(
      <DatabasePanel
        state={{
          ...createDatabaseState(),
          queryDraft: "DROP TABLE users",
          confirmation: {
            confirmationText: "RUN DESTRUCTIVE SQL",
            reason: "destructive or unknown SQL requires explicit confirmation",
            input: "",
          },
        }}
        onRefreshProfiles={() => {}}
        onSelectProfile={() => {}}
        onInspectSchema={() => {}}
        onOpenTable={() => {}}
        onQueryDraftChange={() => {}}
        onRunQuery={() => {}}
        onConfirmQuery={() => {}}
        onCancelConfirmation={() => {}}
        onExportResult={() => {}}
        onSelectHistory={() => {}}
      />,
    );

    expect(view.getByText("RUN DESTRUCTIVE SQL")).toBeTruthy();
    expect(view.getByRole("button", { name: "Run confirmed SQL" })).toBeDisabled();
  });
});
```

Create `src/features/database/DatabaseResultView.test.tsx`:

```tsx
/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test";
import { ensureTestDom } from "../../app/test-dom";
import { DatabaseResultView } from "./DatabaseResultView";
import type { DatabaseQueryResult } from "./database-model";

ensureTestDom();

const { cleanup, render } = await import("@testing-library/react");

afterEach(() => cleanup());

describe("DatabaseResultView", () => {
  test("renders query result columns, visible rows, and mutation badges", () => {
    const result: DatabaseQueryResult = {
      profile_id: "local",
      sql: "SELECT id, email FROM users",
      classification: {
        kind: "Read",
        requires_confirmation: false,
        confirmation_text: "",
        reason: "read-only statement",
      },
      columns: ["id", "email"],
      rows: [
        { cells: [{ kind: "Text", display: "1" }, { kind: "Text", display: "a@example.test" }] },
      ],
      affected_rows: null,
      truncated: false,
      executed_ms: 8,
      history_id: "history-1",
    };

    const view = render(<DatabaseResultView result={result} loading={false} error={null} />);

    expect(view.getByRole("columnheader", { name: "id" })).toBeTruthy();
    expect(view.getByText("a@example.test")).toBeTruthy();
    expect(view.getByText("Read")).toBeTruthy();
  });
});
```

- [ ] **Step 7: Run RED panel/result tests**

Run:

```bash
bun test src/features/database/DatabasePanel.test.tsx src/features/database/DatabaseResultView.test.tsx
```

Expected: FAIL because components do not exist.

- [ ] **Step 8: Implement DatabasePanel, DatabaseResultView, and CSS**

Use `lucide-react` icons: `Database`, `Plug`, `RefreshCw`, `Table2`, `Play`, `Download`, `ShieldAlert`, `History`, `ChevronDown`, `ChevronRight`.

`DatabasePanel` must match `docs/ui-design/panels.jsx` density: compact rows, profile status dot, connection kind metadata, nested Tables section, monospace table names, and row counts. Do not create a marketing/landing screen.

`DatabaseResultView` must:

- Render a `dbgrid` table.
- Use `useVirtualizer` from `@tanstack/react-virtual` for row virtualization.
- Show query kind badge (`Read`, `Mutation`, `Destructive`), affected row count, execution time, and truncated marker.
- Keep stable dimensions so table rows and toolbars do not shift.

Add CSS under existing database/table areas in `src/index.css`, reusing `--chrome`, `--line`, `--txt`, `--txt-dim`, `--yuzu`, `--danger`, `--warn`, `--hover`, and existing `.dbgrid`.

- [ ] **Step 9: Run GREEN frontend database tests**

Run:

```bash
bun test src/features/database/database-model.test.ts src/features/database/DatabasePanel.test.tsx src/features/database/DatabaseResultView.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit Task 4**

```bash
git add package.json bun.lock src/features/database src/index.css
git commit -m "feat: add database workbench UI"
```

## Task 5: AppShell Integration And Workspace-Scoped Database State

**Files:**
- Modify: `src/app/workspace-view-state.ts`
- Modify: `src/app/workspace-view-state.test.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.contract.test.tsx`

- [ ] **Step 1: Write failing workspace state test**

Add to `src/app/workspace-view-state.test.ts`:

```ts
test("database state is restored per workspace and frozen for unknown defaults", () => {
  const store = createWorkspaceViewStore();

  store.getState().updateDatabase("workspace-a", (database) =>
    replaceDatabaseProfiles(database, [
      {
        id: "local",
        workspace_root: "/repo-a",
        name: "local.db",
        kind: "SQLite",
        source: { kind: "SQLite", path: "/repo-a/local.db" },
        read_only: false,
        production: false,
        created_ms: 1,
        updated_ms: 1,
      },
    ]),
  );

  expect(store.getState().viewFor("workspace-a").database.profiles).toHaveLength(1);
  expect(store.getState().viewFor("workspace-b").database.profiles).toEqual([]);

  const unknown = store.getState().viewFor("unknown");
  expect(() => {
    unknown.database.profiles.push({
      id: "bad",
      workspace_root: "/repo",
      name: "bad",
      kind: "SQLite",
      source: { kind: "SQLite", path: "/repo/bad.db" },
      read_only: false,
      production: false,
      created_ms: 1,
      updated_ms: 1,
    });
  }).toThrow(TypeError);
});
```

- [ ] **Step 2: Run RED workspace state test**

Run:

```bash
bun test src/app/workspace-view-state.test.ts
```

Expected: FAIL because `database` state/updateDatabase is missing.

- [ ] **Step 3: Add database state to workspace store**

Import `createDatabaseState` and `DatabaseViewState`, add `database` to `WorkspaceViewState`, `defaultWorkspaceView`, `freezeWorkspaceView`, `WorkspaceViewStore`, and `updateDatabase`.

- [ ] **Step 4: Run GREEN workspace state test**

Run:

```bash
bun test src/app/workspace-view-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing AppShell contract tests**

Add tests to `src/app/AppShell.contract.test.tsx` using existing `PanelBody` pattern:

```tsx
test("PanelBody renders DatabasePanel for database activity", () => {
  const onRunQuery = mock(() => {});
  const state = {
    ...createDatabaseState(),
    profiles: [
      {
        id: "local",
        workspace_root: "/repo",
        name: "local.db",
        kind: "SQLite" as const,
        source: { kind: "SQLite" as const, path: "/repo/local.db" },
        read_only: false,
        production: false,
        created_ms: 1,
        updated_ms: 1,
      },
    ],
    activeProfileId: "local",
    queryDraft: "SELECT * FROM users",
  };

  const view = render(
    <PanelBody
      {...panelBodyBaseProps()}
      active="database"
      databaseState={state}
      onDatabaseRunQuery={onRunQuery}
    />,
  );

  expect(view.getByText("local.db")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Run query" }));
  expect(onRunQuery).toHaveBeenCalled();
});

test("database result surface renders query results beside workbench state", () => {
  const result = databaseResultFixture();
  const view = render(
    <DatabaseResultView result={result} loading={false} error={null} />,
  );

  expect(view.getByRole("columnheader", { name: "id" })).toBeTruthy();
});
```

If the existing `PanelBody` tests do not have `panelBodyBaseProps`, create a local helper in the test file to avoid repeating unrelated props.

- [ ] **Step 6: Run RED AppShell contract tests**

Run:

```bash
bun test src/app/AppShell.contract.test.tsx
```

Expected: FAIL because `PanelBody` has no database props/wiring.

- [ ] **Step 7: Wire AppShell database state and commands**

In `src/app/AppShell.tsx`:

- Import `DatabasePanel`, `DatabaseResultView`, database model reducers, and database API functions.
- Extend `PanelBody` props with `databaseState`, database handlers, and render `<DatabasePanel />` when `active === "database"`.
- Add `surface: "database-result"` to `Surface` in `workspace-view-state.ts` and the editor-content class condition.
- On active workspace changes, load database profiles with `listDatabaseProfiles(activeWorkspace.path)` and store them in workspace database state.
- Implement handlers:
  - `refreshDatabaseProfiles()`
  - `selectDatabaseProfile(profileId)`
  - `inspectDatabaseProfile(profileId)`
  - `openDatabaseTable(profileId, tableName)` builds `SELECT * FROM "table" LIMIT 100` and executes it.
  - `runDatabaseQuery()` classifies on frontend using model helper for prompt display, then calls `executeDatabaseQuery`.
  - `confirmDatabaseQuery(input)` runs only when exact confirmation text matches.
  - `exportDatabaseResult()`
  - `selectDatabaseHistory(entry)`
- Set `activeActivity: "database"`, `panelOpen: true`, and `surface: "database-result"` after successful query/table open.
- Keep query result bounded; never store secrets, raw profile passwords, or unbounded result sets in React state.

- [ ] **Step 8: Run GREEN AppShell contract tests**

Run:

```bash
bun test src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add src/app/workspace-view-state.ts src/app/workspace-view-state.test.ts src/app/AppShell.tsx src/app/AppShell.contract.test.tsx
git commit -m "feat: wire database workspace state"
```

## Task 6: Node 9 Verification, Docs, And Roadmap Update

**Files:**
- Create: `docs/architecture/node-9-database-tools-results.md`
- Modify: `docs/architecture/progress.md`
- Modify: `roadmap.md`

- [ ] **Step 1: Run full Node 9 verification**

Run:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
. "$HOME/.cargo/env" && bun run tauri build --debug
git diff --check
```

Expected:

- All Bun tests pass.
- Frontend build passes.
- Rust tests pass.
- Rust fmt/clippy pass.
- Tauri debug build produces the app and DMG artifacts.
- `git diff --check` exits 0.

- [ ] **Step 2: Run Node 8 browser regression smoke required by Node 9 roadmap acceptance**

Run:

```bash
bun test src/features/browser/browser-model.test.ts src/features/browser/BrowserPanel.test.tsx src/features/browser/BrowserPreviewSurface.test.tsx src/app/AppShell.contract.test.tsx
```

Expected: PASS. This preserves the embedded-preview acceptance bullets that are currently listed under Node 9.

- [ ] **Step 3: Run database-specific smoke tests**

Run:

```bash
bun test src/features/database/database-model.test.ts src/features/database/DatabasePanel.test.tsx src/features/database/DatabaseResultView.test.tsx src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml database::tests
```

Expected: PASS.

- [ ] **Step 4: Write Node 9 results doc**

Create `docs/architecture/node-9-database-tools-results.md` with sections:

```markdown
# Node 9 Database Tools Results

## Status

Completed and passed.

## Scope

- SQLite, PostgreSQL, and MS SQL Server profile support.
- Schema explorer and bounded table/query result rendering.
- Query editor, query history, CSV export.
- Read-only production profile mode.
- Visible confirmation for mutating and destructive SQL.
- Local OS secret storage through `keyring`; profile metadata does not store passwords in workspace/project files.
- Node 8 browser-preview regression smoke retained because the Node 9 roadmap acceptance block includes browser-preview bullets.

## TDD Evidence

Record each task's RED and GREEN commands with failure/pass counts.

## Review Evidence

Record implementer, spec-compliance reviewer, and code-quality reviewer agent IDs and outcomes.

## Verification Evidence

Record exact final command outputs and counts.

## Residual Risks

- Live PostgreSQL/MS SQL verification depends on user-provided servers and credentials; unit tests cover config/schema/query builders and SQLite covers end-to-end local execution.
- OS keyring availability can vary by platform; profile JSON still avoids raw secrets.
```

- [ ] **Step 5: Update progress and roadmap**

In `docs/architecture/progress.md`, add Node 9 completed section with changed files, commits, verification counts, live-server caveats, and link to `docs/architecture/node-9-database-tools-results.md`.

In `roadmap.md`, mark Node 9 completed and passed. Move `## Current Priority` from Node 9 to Node 10.

- [ ] **Step 6: Run docs gate**

Run:

```bash
test -f docs/architecture/node-9-database-tools-results.md
rg -n "T(BD)|TO(DO)|place(holder)|0 tests|0 pass|skip verification" docs/architecture/node-9-database-tools-results.md docs/architecture/progress.md roadmap.md
git diff --check
```

Expected:

- First command exits 0.
- `rg` exits 1 with no matches, unless the only matches are quoted RED evidence that is clearly labeled pre-fix.
- `git diff --check` exits 0.

- [ ] **Step 7: Commit Task 6 / Node 9**

```bash
git add docs/architecture/node-9-database-tools-results.md docs/architecture/progress.md roadmap.md
git commit -m "docs: record node 9 database results"
```

## Node-Level Acceptance Checklist

- [ ] User can inspect SQLite schemas through local file profiles.
- [ ] User can inspect PostgreSQL schemas through TCP profiles using local OS secret lookup.
- [ ] User can inspect MS SQL Server schemas through TCP profiles using local OS secret lookup.
- [ ] Query results render in a table with bounded row/cell storage and virtualized display.
- [ ] Mutating and destructive SQL are visibly differentiated from reads.
- [ ] Read-only/production profiles block mutating SQL.
- [ ] Mutating SQL requires exact confirmation text before execution.
- [ ] Connection secrets are not stored in workspace/project files or profile JSON.
- [ ] Query history and CSV export do not contain credentials.
- [ ] Node 8 browser-preview regression smoke remains passing.

## Plan Self-Review

- Spec coverage: every Node 9 scope item maps to Tasks 1-6. Browser-preview acceptance bullets are handled as a regression smoke because Node 8 owns the implementation and Node 9 must not regress it.
- Marker scan: no unresolved marker strings or undefined task references are intentionally left in this plan.
- Type consistency: Rust command names map directly to frontend API wrappers; `DatabaseKind` and `QueryKind` string values are reused in frontend tests and model types.
