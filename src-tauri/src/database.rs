use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    ffi::OsString,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use futures_util::stream::TryStreamExt;
use keyring_core::{get_default_store, Entry};

use csv::Writer;
use rusqlite::{params_from_iter, types::ValueRef, Connection, OpenFlags};
use tiberius::{AuthMethod, Client as TiberiusClient, Config as TiberiusConfig, QueryItem};
use tokio::net::TcpStream;
use tokio_postgres::{Config as PostgresConfig, NoTls};
use tokio_util::compat::TokioAsyncWriteCompatExt;

#[cfg(not(test))]
use keyring::use_native_store;
#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};

#[cfg(not(test))]
fn ensure_keyring_default_store() -> Result<(), String> {
    ensure_keyring_default_store_with(
        || get_default_store().is_some(),
        || use_native_store(false).map_err(|err| format!("failed to initialize OS keyring: {err}")),
    )
}

#[cfg(test)]
fn ensure_keyring_default_store_with<GetDefault, SetNative>(
    get_default_store: GetDefault,
    set_native_store: SetNative,
) -> Result<(), String>
where
    GetDefault: Fn() -> bool,
    SetNative: Fn() -> Result<(), String>,
{
    if get_default_store() {
        return Ok(());
    }

    set_native_store()
}

#[cfg(not(test))]
fn ensure_keyring_default_store_with<GetDefault, SetNative>(
    get_default_store: GetDefault,
    set_native_store: SetNative,
) -> Result<(), String>
where
    GetDefault: Fn() -> bool,
    SetNative: Fn() -> Result<(), String>,
{
    if get_default_store() {
        return Ok(());
    }

    set_native_store()
}

#[cfg(test)]
fn ensure_keyring_default_store() -> Result<(), String> {
    ensure_keyring_default_store_with(|| get_default_store().is_some(), || Ok(()))
}

pub const MAX_DATABASE_ROWS: usize = 500;
pub const MAX_DATABASE_CELL_CHARS: usize = 2000;
pub const MAX_QUERY_HISTORY: usize = 30;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum DatabaseKind {
    SQLite,
    PostgreSQL,
    MsSql,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum DatabaseConnectionSource {
    SQLite {
        path: PathBuf,
    },
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
pub struct DatabaseExport {
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseQueryHistoryEntry {
    pub id: String,
    pub profile_id: String,
    pub sql: String,
    pub kind: QueryKind,
    pub executed_ms: u64,
    pub affected_rows: Option<u64>,
    pub row_count: Option<u64>,
}

#[derive(Clone, Default)]
pub struct DatabaseQueryHistoryStore {
    entries: Arc<Mutex<HashMap<String, Vec<DatabaseQueryHistoryEntry>>>>,
}

impl DatabaseQueryHistoryStore {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn record(
        &self,
        profile_id: impl Into<String>,
        sql: impl Into<String>,
        kind: QueryKind,
        executed_ms: u64,
        affected_rows: Option<u64>,
        row_count: Option<u64>,
    ) -> String {
        let profile_id = profile_id.into();
        let id = uuid::Uuid::new_v4().to_string();
        let entry = DatabaseQueryHistoryEntry {
            id: id.clone(),
            profile_id: profile_id.clone(),
            sql: sql.into(),
            kind,
            executed_ms,
            affected_rows,
            row_count,
        };

        let mut entries = self.entries.lock().expect("database query history lock");
        let bucket = entries.entry(profile_id).or_default();
        bucket.push(entry);
        if bucket.len() > MAX_QUERY_HISTORY {
            let overflow = bucket.len() - MAX_QUERY_HISTORY;
            bucket.drain(0..overflow);
        }

        id
    }

    pub fn list(&self, profile_id: &str) -> Vec<DatabaseQueryHistoryEntry> {
        self.entries
            .lock()
            .expect("database query history lock")
            .get(profile_id)
            .cloned()
            .unwrap_or_default()
    }
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

impl DatabaseQueryResult {
    pub fn from_rows(columns: Vec<String>, rows: Vec<Vec<DatabaseCell>>, executed_ms: u64) -> Self {
        let (bounded_rows, truncated) = Self::bounded_rows_and_truncated(rows);

        Self {
            profile_id: String::new(),
            sql: String::new(),
            columns,
            rows: bounded_rows,
            affected_rows: None,
            truncated,
            executed_ms,
            history_id: String::new(),
            classification: QueryClassification {
                kind: QueryKind::Read,
                requires_confirmation: false,
                confirmation_text: String::new(),
                reason: String::new(),
            },
        }
    }

    pub fn from_rows_for_profile(
        profile_id: impl Into<String>,
        sql: impl Into<String>,
        classification: QueryClassification,
        columns: Vec<String>,
        rows: Vec<Vec<DatabaseCell>>,
        executed_ms: u64,
        history_id: impl Into<String>,
    ) -> Self {
        let (rows, truncated) = Self::bounded_rows_and_truncated(rows);
        Self {
            profile_id: profile_id.into(),
            sql: sql.into(),
            classification,
            columns,
            rows,
            affected_rows: None,
            truncated,
            executed_ms,
            history_id: history_id.into(),
        }
    }

    fn with_truncated(mut self, truncated: bool) -> Self {
        self.truncated = truncated;
        self
    }

    fn bounded_rows_and_truncated(rows: Vec<Vec<DatabaseCell>>) -> (Vec<DatabaseRow>, bool) {
        let truncated = rows.len() > MAX_DATABASE_ROWS;
        let bounded_rows = rows
            .into_iter()
            .take(MAX_DATABASE_ROWS)
            .map(|cells| DatabaseRow {
                cells: cells
                    .into_iter()
                    .map(|cell| match cell.kind {
                        DatabaseCellKind::Null => cell,
                        DatabaseCellKind::Text => DatabaseCell {
                            kind: DatabaseCellKind::Text,
                            display: truncate_cell(cell.display),
                        },
                    })
                    .collect(),
            })
            .collect();

        (bounded_rows, truncated)
    }
}

impl DatabaseConnectionSource {
    pub fn secret_id(&self) -> Option<&str> {
        match self {
            Self::Tcp { secret_id, .. } => secret_id.as_deref(),
            Self::SQLite { .. } => None,
        }
    }
}

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
        Self {
            service: service.into(),
        }
    }
}

impl DatabaseSecretStore for KeyringDatabaseSecretStore {
    fn set_secret(&self, secret_id: &str, secret: &str) -> Result<(), String> {
        ensure_keyring_default_store()?;
        let entry = Entry::new(&self.service, secret_id).map_err(|err| err.to_string())?;
        entry
            .set_secret(secret.as_bytes())
            .map_err(|err| err.to_string())
    }

    fn get_secret(&self, secret_id: &str) -> Result<String, String> {
        ensure_keyring_default_store()?;
        let entry = Entry::new(&self.service, secret_id).map_err(|err| err.to_string())?;
        let secret = entry.get_secret().map_err(|err| err.to_string())?;
        String::from_utf8(secret).map_err(|_| "stored secret is not valid UTF-8".to_string())
    }

    fn delete_secret(&self, secret_id: &str) -> Result<(), String> {
        ensure_keyring_default_store()?;
        let entry = Entry::new(&self.service, secret_id).map_err(|err| err.to_string())?;
        entry.delete_credential().map_err(|err| err.to_string())
    }
}

#[derive(Clone, Debug)]
pub struct DatabaseProfileStore {
    path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl DatabaseProfileStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn list_profiles(&self, workspace_root: &str) -> Result<Vec<DatabaseProfile>, String> {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        let mut profiles = self.load()?;
        profiles.retain(|profile| profile.workspace_root == workspace_root);
        profiles.sort_by(|left, right| {
            left.name
                .cmp(&right.name)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(profiles)
    }

    pub fn get_profile(&self, id: &str) -> Result<DatabaseProfile, String> {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        self.load()?
            .into_iter()
            .find(|profile| profile.id == id)
            .ok_or_else(|| format!("database profile not found: {id}"))
    }

    pub fn save_profile<FNow, FId>(
        &self,
        input: DatabaseProfileInput,
        secrets: &dyn DatabaseSecretStore,
        now: FNow,
        id_factory: FId,
    ) -> Result<DatabaseProfile, String>
    where
        FNow: Fn() -> Result<u64, String>,
        FId: Fn() -> String,
    {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        let now = now()?;

        let mut profiles = self.load()?;
        let profile_id = input.id.unwrap_or_else(&id_factory);
        let previous = profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .cloned();
        let previous_secret_id = previous
            .as_ref()
            .and_then(|profile| profile.source.secret_id())
            .map(|secret_id| secret_id.to_string());
        let mut changed_secret = None;
        let mut old_secret = None;

        let source = match input.kind {
            DatabaseKind::SQLite => {
                let sqlite_path = input
                    .sqlite_path
                    .ok_or_else(|| "sqlite path is required".to_string())?;
                validate_not_raw_dsn("sqlite_path", &sqlite_path)?;
                let sqlite_path = PathBuf::from(sqlite_path);
                DatabaseConnectionSource::SQLite { path: sqlite_path }
            }
            DatabaseKind::PostgreSQL | DatabaseKind::MsSql => {
                let host = input
                    .host
                    .ok_or_else(|| "database host is required".to_string())?;
                let port = input
                    .port
                    .ok_or_else(|| "database port is required".to_string())?;
                let database = input
                    .database
                    .ok_or_else(|| "database name is required".to_string())?;
                let username = input.username;
                if let Some(ref username) = username {
                    validate_not_raw_dsn("username", username)?;
                }
                validate_not_raw_dsn("host", &host)?;
                validate_not_raw_dsn("database", &database)?;

                let secret_id = if let Some(password) = input.password.as_deref() {
                    let secret_id = previous_secret_id
                        .clone()
                        .unwrap_or_else(|| format!("database-profile:{profile_id}"));

                    if let Some(previous_secret_id) = previous_secret_id.as_deref() {
                        let previous_secret = secrets.get_secret(previous_secret_id)?;
                        old_secret = Some(previous_secret);
                    }

                    secrets.set_secret(&secret_id, password)?;
                    changed_secret = Some(secret_id.clone());
                    Some(secret_id)
                } else {
                    previous_secret_id.clone()
                };

                DatabaseConnectionSource::Tcp {
                    host,
                    port,
                    database,
                    username,
                    secret_id,
                }
            }
        };

        let created_ms = previous.as_ref().map_or(now, |profile| profile.created_ms);
        let profile = DatabaseProfile {
            id: profile_id.clone(),
            workspace_root: input.workspace_root,
            name: input.name,
            kind: input.kind,
            source,
            read_only: input.read_only,
            production: input.production,
            created_ms,
            updated_ms: now,
        };

        profiles.retain(|profile| profile.id != profile_id);
        profiles.push(profile.clone());
        if let Err(save_error) = self.save(&profiles) {
            if let Some(secret_id) = changed_secret {
                if let Some(previous_secret_id) = previous_secret_id {
                    if let Some(previous_secret) = old_secret {
                        if let Err(secret_error) =
                            secrets.set_secret(&previous_secret_id, &previous_secret)
                        {
                            return Err(format!(
                                "{save_error}; unable to restore previous secret: {secret_error}"
                            ));
                        }
                    } else if let Err(secret_error) = secrets.delete_secret(&previous_secret_id) {
                        return Err(format!(
                            "{save_error}; unable to remove new profile secret: {secret_error}"
                        ));
                    }
                } else if let Err(secret_error) = secrets.delete_secret(&secret_id) {
                    return Err(format!(
                        "{save_error}; unable to remove new profile secret: {secret_error}"
                    ));
                }
            }

            return Err(save_error);
        }

        Ok(profile)
    }

    pub fn delete_profile(
        &self,
        id: &str,
        secrets: &dyn DatabaseSecretStore,
    ) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        let mut profiles = self.load()?;
        let index = profiles
            .iter()
            .position(|profile| profile.id == id)
            .ok_or_else(|| format!("database profile not found: {id}"))?;
        let secret_id = profiles[index].source.secret_id().map(|id| id.to_string());
        profiles.remove(index);
        self.save(&profiles)?;
        if let Some(secret_id) = secret_id {
            secrets.delete_secret(&secret_id)?;
        }
        Ok(())
    }

    fn load(&self) -> Result<Vec<DatabaseProfile>, String> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }

        let value = fs::read_to_string(&self.path).map_err(|err| err.to_string())?;
        if value.trim().is_empty() {
            return Ok(Vec::new());
        }
        serde_json::from_str(&value).map_err(|err| err.to_string())
    }

    fn save(&self, profiles: &[DatabaseProfile]) -> Result<(), String> {
        if let Some(parent) = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let value = serde_json::to_string_pretty(profiles).map_err(|err| err.to_string())?;
        let parent = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let file_name = self
            .path
            .file_name()
            .unwrap_or_else(|| std::ffi::OsStr::new("database-profiles.json"));
        let file_name = OsString::from(file_name);
        let temp_path = parent.join(format!(
            ".{}.{}.tmp",
            file_name.to_string_lossy(),
            uuid::Uuid::new_v4()
        ));

        let result = (|| {
            match fs::remove_file(&temp_path) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(err.to_string()),
            }

            let mut file = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&temp_path)
                .map_err(|err| err.to_string())?;
            file.write_all(value.as_bytes())
                .map_err(|err| err.to_string())?;
            file.sync_all().map_err(|err| err.to_string())?;
            drop(file);
            fs::rename(&temp_path, &self.path).map_err(|err| err.to_string())
        })();

        if result.is_err() {
            let _ = fs::remove_file(&temp_path);
        }

        result
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TcpConnectionParts {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

impl TcpConnectionParts {
    pub fn redacted_label(&self) -> String {
        let mut label = format!("{}:{}", self.host, self.port);
        if let Some(username) = self.username.as_deref() {
            label = format!("{username}@{label}");
        }
        label.push('/');
        label.push_str(&self.database);
        label
    }
}

pub fn postgres_connection_parts(
    profile: &DatabaseProfile,
    password: Option<String>,
) -> Result<TcpConnectionParts, String> {
    match &profile.source {
        DatabaseConnectionSource::Tcp {
            host,
            port,
            database,
            username,
            ..
        } => Ok(TcpConnectionParts {
            host: host.clone(),
            port: *port,
            database: database.clone(),
            username: username.clone(),
            password,
        }),
        _ => Err("profile is not TCP based".to_string()),
    }
}

pub fn mssql_connection_parts(
    profile: &DatabaseProfile,
    password: Option<String>,
) -> Result<TcpConnectionParts, String> {
    postgres_connection_parts(profile, password)
}

fn profile_secret(
    profile: &DatabaseProfile,
    secrets: &dyn DatabaseSecretStore,
) -> Result<Option<String>, String> {
    match profile.source.secret_id() {
        Some(secret_id) => Ok(Some(secrets.get_secret(secret_id)?)),
        None => Ok(None),
    }
}

pub fn inspect_database_schema(
    profile: &DatabaseProfile,
    secrets: &dyn DatabaseSecretStore,
) -> Result<DatabaseSchema, String> {
    match profile.kind {
        DatabaseKind::SQLite => inspect_sqlite_schema(profile),
        DatabaseKind::PostgreSQL => {
            let password = profile_secret(profile, secrets)?;
            let runtime = tokio::runtime::Runtime::new().map_err(|err| err.to_string())?;
            runtime.block_on(async { inspect_postgres_schema(profile, password).await })
        }
        DatabaseKind::MsSql => {
            let password = profile_secret(profile, secrets)?;
            let runtime = tokio::runtime::Runtime::new().map_err(|err| err.to_string())?;
            runtime.block_on(async { inspect_mssql_schema(profile, password).await })
        }
    }
}

pub fn execute_database_query(
    profile: &DatabaseProfile,
    mut request: DatabaseQueryRequest,
    secrets: &dyn DatabaseSecretStore,
) -> Result<DatabaseQueryResult, String> {
    request.limit = request.limit.min(MAX_DATABASE_ROWS);
    let classification = validate_query_request(profile, &request)?;

    match profile.kind {
        DatabaseKind::SQLite => execute_sqlite_query(profile, request, &classification),
        DatabaseKind::PostgreSQL => {
            let password = profile_secret(profile, secrets)?;
            let runtime = tokio::runtime::Runtime::new().map_err(|err| err.to_string())?;
            runtime.block_on(async {
                execute_postgres_query(profile, request, &classification, password).await
            })
        }
        DatabaseKind::MsSql => {
            let password = profile_secret(profile, secrets)?;
            let runtime = tokio::runtime::Runtime::new().map_err(|err| err.to_string())?;
            runtime.block_on(async {
                execute_mssql_query(profile, request, &classification, password).await
            })
        }
    }
}

pub async fn inspect_database_schema_async(
    profile: &DatabaseProfile,
    secrets: &dyn DatabaseSecretStore,
) -> Result<DatabaseSchema, String> {
    let password = profile_secret(profile, secrets)?;
    match profile.kind {
        DatabaseKind::SQLite => inspect_sqlite_schema(profile),
        DatabaseKind::PostgreSQL => inspect_postgres_schema(profile, password).await,
        DatabaseKind::MsSql => inspect_mssql_schema(profile, password).await,
    }
}

pub async fn execute_database_query_async(
    profile: &DatabaseProfile,
    mut request: DatabaseQueryRequest,
    secrets: &dyn DatabaseSecretStore,
) -> Result<DatabaseQueryResult, String> {
    request.limit = request.limit.min(MAX_DATABASE_ROWS);
    let classification = validate_query_request(profile, &request)?;

    let password = profile_secret(profile, secrets)?;
    match profile.kind {
        DatabaseKind::SQLite => execute_sqlite_query(profile, request, &classification),
        DatabaseKind::PostgreSQL => {
            execute_postgres_query(profile, request, &classification, password).await
        }
        DatabaseKind::MsSql => {
            execute_mssql_query(profile, request, &classification, password).await
        }
    }
}

pub fn export_query_result_csv(
    export_root: impl AsRef<Path>,
    result: &DatabaseQueryResult,
) -> Result<PathBuf, String> {
    let export_root = export_root.as_ref();
    if !export_root.exists() {
        fs::create_dir_all(export_root).map_err(|err| err.to_string())?;
    }

    let filename = format!(
        "database-query-{}-{}.csv",
        database_now_ms(),
        uuid::Uuid::new_v4()
    );
    let path = export_root.join(filename);

    let mut writer = Writer::from_path(&path).map_err(|err| err.to_string())?;
    writer
        .write_record(&result.columns)
        .map_err(|err| err.to_string())?;
    for row in &result.rows {
        let values: Vec<_> = row
            .cells
            .iter()
            .map(|cell| match cell.kind {
                DatabaseCellKind::Null => String::new(),
                DatabaseCellKind::Text => cell.display.clone(),
            })
            .collect();
        writer
            .write_record(&values)
            .map_err(|err| err.to_string())?;
    }
    writer.flush().map_err(|err| err.to_string())?;
    Ok(path)
}

fn inspect_sqlite_schema(profile: &DatabaseProfile) -> Result<DatabaseSchema, String> {
    let DatabaseConnectionSource::SQLite { path } = &profile.source else {
        return Err("profile is not SQLite".to_string());
    };

    let flags = if profile.read_only {
        OpenFlags::SQLITE_OPEN_READ_ONLY
    } else {
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE
    };
    let connection = Connection::open_with_flags(path, flags)
        .map_err(|err| format!("failed to open sqlite database: {err}"))?;

    let mut tables = Vec::new();
    let mut table_statement = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(|err| format!("failed to enumerate sqlite tables: {err}"))?;
    let table_rows = table_statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| format!("failed to enumerate sqlite tables: {err}"))?;

    let mut table_names = Vec::new();
    for table_row in table_rows {
        table_names
            .push(table_row.map_err(|err| format!("failed to read sqlite table name: {err}"))?);
    }

    for table_name in table_names {
        let quoted_table = quote_sqlite_identifier(&table_name);
        let mut columns = Vec::new();

        let mut column_statement = connection
            .prepare(&format!("PRAGMA table_info({quoted_table})"))
            .map_err(|err| format!("failed to read sqlite columns: {err}"))?;
        let columns_rows = column_statement
            .query_map([], |row| {
                Ok(DatabaseColumn {
                    name: row.get::<_, String>(1)?,
                    data_type: row.get::<_, String>(2)?,
                    nullable: !row.get::<_, bool>(3)?,
                    primary_key: row.get::<_, i32>(5)? > 0,
                })
            })
            .map_err(|err| format!("failed to enumerate sqlite columns for {table_name}: {err}"))?;

        for column in columns_rows {
            columns.push(
                column.map_err(|err| {
                    format!("failed to read sqlite column for {table_name}: {err}")
                })?,
            );
        }

        let row_count = inspect_sqlite_table_row_count(&connection, &quoted_table)
            .map_err(|err| format!("failed to count rows for {table_name}: {err}"))?;

        tables.push(DatabaseTable {
            schema: None,
            name: table_name,
            row_count: Some(row_count),
            columns,
        });
    }

    Ok(DatabaseSchema {
        profile_id: profile.id.clone(),
        tables,
        refreshed_ms: database_now_ms(),
    })
}

fn inspect_sqlite_table_row_count(
    connection: &Connection,
    quoted_table_name: &str,
) -> Result<u64, String> {
    let count = connection
        .query_row(
            &format!("SELECT COUNT(*) FROM {quoted_table_name}"),
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|err| format!("failed to count sqlite rows: {err}"))?;
    Ok(count as u64)
}

fn execute_sqlite_query(
    profile: &DatabaseProfile,
    request: DatabaseQueryRequest,
    classification: &QueryClassification,
) -> Result<DatabaseQueryResult, String> {
    let DatabaseConnectionSource::SQLite { path } = &profile.source else {
        return Err("profile is not SQLite".to_string());
    };

    let flags = if profile.read_only {
        OpenFlags::SQLITE_OPEN_READ_ONLY
    } else {
        OpenFlags::SQLITE_OPEN_READ_WRITE
    };
    let connection = Connection::open_with_flags(path, flags)
        .map_err(|err| format!("failed to open sqlite database: {err}"))?;
    let start = database_now_ms();

    if matches!(classification.kind, QueryKind::Read) {
        let mut rows_value = Vec::new();
        let limit = request.limit.min(MAX_DATABASE_ROWS);
        let mut statement = connection
            .prepare(&request.sql)
            .map_err(|err| format!("failed to prepare SQL: {err}"))?;
        let column_count = statement.column_count();
        let columns = statement
            .column_names()
            .iter()
            .map(|name| (*name).to_string())
            .collect::<Vec<_>>();
        let mut rows = statement
            .query([])
            .map_err(|err| format!("failed to execute SQL: {err}"))?;
        while rows_value.len() < limit + 1 {
            let row = rows.next().map_err(|err| {
                format!(
                    "failed to collect sqlite rows for {}: {err}",
                    request.profile_id
                )
            })?;
            let Some(row) = row else {
                break;
            };

            let mut cells = Vec::new();
            for index in 0..column_count {
                let value = row
                    .get_ref(index)
                    .map_err(|err| format!("failed to read sqlite value: {err}"))?;
                cells.push(sqlite_cell_to_text(value));
            }
            rows_value.push(cells);
        }

        let truncated = rows_value.len() > limit;
        if truncated {
            rows_value.truncate(limit);
        }

        Ok(DatabaseQueryResult::from_rows_for_profile(
            &request.profile_id,
            request.sql.clone(),
            classification.clone(),
            columns,
            rows_value,
            database_now_ms().saturating_sub(start),
            String::new(),
        )
        .with_truncated(truncated))
    } else {
        let affected_rows = connection
            .execute(&request.sql, params_from_iter(std::iter::empty::<&str>()))
            .map_err(|err| format!("failed to execute SQL: {err}"))?;
        Ok(DatabaseQueryResult {
            profile_id: request.profile_id,
            sql: request.sql,
            classification: classification.clone(),
            columns: Vec::new(),
            rows: Vec::new(),
            affected_rows: Some(affected_rows as u64),
            truncated: false,
            executed_ms: database_now_ms().saturating_sub(start),
            history_id: String::new(),
        })
    }
}

fn sqlite_cell_to_text(value: ValueRef<'_>) -> DatabaseCell {
    match value {
        ValueRef::Null => DatabaseCell::null(),
        ValueRef::Integer(value) => DatabaseCell::text(value.to_string()),
        ValueRef::Real(value) => DatabaseCell::text(value.to_string()),
        ValueRef::Text(value) => DatabaseCell::text(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => DatabaseCell::text(format!("<blob:{}>", value.len())),
    }
}

async fn inspect_postgres_schema(
    profile: &DatabaseProfile,
    password: Option<String>,
) -> Result<DatabaseSchema, String> {
    let parts = postgres_connection_parts(profile, password)?;
    let mut config = PostgresConfig::new();
    config.host(&parts.host);
    config.port(parts.port);
    config.dbname(&parts.database);
    if let Some(username) = parts.username.as_deref() {
        config.user(username);
    }
    if let Some(password) = parts.password.as_deref() {
        config.password(password);
    }

    let (client, connection) = config.connect(NoTls).await.map_err(|err| err.to_string())?;
    tokio::spawn(async move {
        let _ = connection.await;
    });

    let tables = client
        .query(
            "SELECT table_schema, table_name FROM information_schema.tables \
            WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema') \
            ORDER BY table_schema, table_name",
            &[],
        )
        .await
        .map_err(|err| err.to_string())?;
    let mut schema = Vec::new();
    for table in tables {
        let table_schema = table
            .try_get::<_, String>(0)
            .map_err(|err| err.to_string())?;
        let table_name = table
            .try_get::<_, String>(1)
            .map_err(|err| err.to_string())?;
        let columns_rows = client
            .query(
                "SELECT column_name, data_type, is_nullable, ordinal_position FROM information_schema.columns \
                WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
                &[&table_schema, &table_name],
            )
            .await
            .map_err(|err| err.to_string())?;

        let mut columns = Vec::new();
        for column in columns_rows {
            let name = column
                .try_get::<_, String>(0)
                .map_err(|err| err.to_string())?;
            let data_type = column
                .try_get::<_, String>(1)
                .map_err(|err| err.to_string())?;
            let nullable = column
                .try_get::<_, String>(2)
                .map_err(|err| err.to_string())?
                .eq_ignore_ascii_case("YES");
            columns.push(DatabaseColumn {
                name,
                data_type,
                nullable,
                primary_key: false,
            });
        }

        schema.push(DatabaseTable {
            schema: Some(table_schema),
            name: table_name,
            row_count: None,
            columns,
        });
    }

    Ok(DatabaseSchema {
        profile_id: profile.id.clone(),
        tables: schema,
        refreshed_ms: database_now_ms(),
    })
}

async fn execute_postgres_query(
    profile: &DatabaseProfile,
    request: DatabaseQueryRequest,
    classification: &QueryClassification,
    password: Option<String>,
) -> Result<DatabaseQueryResult, String> {
    let parts = postgres_connection_parts(profile, password)?;
    let mut config = PostgresConfig::new();
    config.host(&parts.host);
    config.port(parts.port);
    config.dbname(&parts.database);
    if let Some(username) = parts.username.as_deref() {
        config.user(username);
    }
    if let Some(password) = parts.password.as_deref() {
        config.password(password);
    }

    let (client, connection) = config.connect(NoTls).await.map_err(|err| err.to_string())?;
    tokio::spawn(async move {
        let _ = connection.await;
    });

    let start = database_now_ms();
    if matches!(classification.kind, QueryKind::Read) {
        let limit = request.limit.min(MAX_DATABASE_ROWS);
        let rows = client
            .query(&request.sql, &[])
            .await
            .map_err(|err| format!("failed to execute SQL: {err}"))?;
        let mut columns = Vec::new();
        if let Some(first) = rows.first() {
            columns.extend(
                first
                    .columns()
                    .iter()
                    .map(|column| column.name().to_string()),
            );
        }

        let mut row_values = Vec::new();
        for row in rows.into_iter().take(limit + 1) {
            let mut cells = Vec::new();
            for index in 0..row.columns().len() {
                cells.push(database_cell_from_postgres_value(&row, index));
            }
            row_values.push(cells);
        }

        let truncated = row_values.len() > limit;
        if truncated {
            row_values.truncate(limit);
        }

        Ok(DatabaseQueryResult {
            profile_id: request.profile_id,
            sql: request.sql,
            classification: classification.clone(),
            columns,
            rows: row_values
                .into_iter()
                .map(|row| DatabaseRow { cells: row })
                .collect(),
            affected_rows: None,
            truncated,
            executed_ms: database_now_ms().saturating_sub(start),
            history_id: String::new(),
        })
    } else {
        let affected_rows = client
            .execute(&request.sql, &[])
            .await
            .map_err(|err| format!("failed to execute SQL: {err}"))?;

        Ok(DatabaseQueryResult {
            profile_id: request.profile_id,
            sql: request.sql,
            classification: classification.clone(),
            columns: Vec::new(),
            rows: Vec::new(),
            affected_rows: Some(affected_rows as u64),
            truncated: false,
            executed_ms: database_now_ms().saturating_sub(start),
            history_id: String::new(),
        })
    }
}

fn database_cell_from_postgres_value(row: &tokio_postgres::Row, index: usize) -> DatabaseCell {
    if let Ok(value) = row.try_get::<_, Option<String>>(index) {
        return value.map_or_else(DatabaseCell::null, DatabaseCell::text);
    }
    if let Ok(value) = row.try_get::<_, Option<bool>>(index) {
        return value.map_or_else(DatabaseCell::null, |value| {
            DatabaseCell::text(value.to_string())
        });
    }
    if let Ok(value) = row.try_get::<_, Option<i32>>(index) {
        return value.map_or_else(DatabaseCell::null, |value| {
            DatabaseCell::text(value.to_string())
        });
    }
    if let Ok(value) = row.try_get::<_, Option<i64>>(index) {
        return value.map_or_else(DatabaseCell::null, |value| {
            DatabaseCell::text(value.to_string())
        });
    }
    if let Ok(value) = row.try_get::<_, Option<f32>>(index) {
        return value.map_or_else(DatabaseCell::null, |value| {
            DatabaseCell::text(value.to_string())
        });
    }
    if let Ok(value) = row.try_get::<_, Option<f64>>(index) {
        return value.map_or_else(DatabaseCell::null, |value| {
            DatabaseCell::text(value.to_string())
        });
    }
    if let Ok(value) = row.try_get::<_, Option<Vec<u8>>>(index) {
        return value.map_or_else(DatabaseCell::null, |value| {
            String::from_utf8(value)
                .map_or_else(|_| DatabaseCell::text("<binary>"), DatabaseCell::text)
        });
    }

    DatabaseCell::text("<unsupported>")
}

async fn inspect_mssql_schema(
    profile: &DatabaseProfile,
    password: Option<String>,
) -> Result<DatabaseSchema, String> {
    let parts = mssql_connection_parts(profile, password)?;
    let mut config = TiberiusConfig::new();
    config.host(&parts.host);
    config.port(parts.port);
    config.database(&parts.database);
    if let Some(username) = parts.username.as_deref() {
        config.authentication(AuthMethod::sql_server(
            username,
            parts.password.as_deref().unwrap_or_default(),
        ));
    }

    let stream = TcpStream::connect((parts.host.as_str(), parts.port))
        .await
        .map_err(|err| err.to_string())?;
    let mut client = TiberiusClient::connect(config, stream.compat_write())
        .await
        .map_err(|err| err.to_string())?;

    let mut table_stream = client
        .query(
            "SELECT TABLE_SCHEMA, TABLE_NAME \
            FROM INFORMATION_SCHEMA.TABLES \
            WHERE TABLE_TYPE = 'BASE TABLE' \
            AND TABLE_SCHEMA NOT IN ('sys', 'information_schema') \
            ORDER BY TABLE_SCHEMA, TABLE_NAME",
            &[],
        )
        .await
        .map_err(|err| err.to_string())?;

    let mut table_rows = Vec::new();
    while let Some(item) = table_stream
        .try_next()
        .await
        .map_err(|err| format!("failed to enumerate mssql tables: {err}"))?
    {
        let QueryItem::Row(row) = item else {
            continue;
        };

        let schema: String = row
            .try_get::<&str, _>("TABLE_SCHEMA")
            .map_err(|err| format!("failed to read mssql schema name: {err}"))?
            .ok_or_else(|| "missing mssql table schema".to_string())?
            .to_string();
        let table: String = row
            .try_get::<&str, _>("TABLE_NAME")
            .map_err(|err| format!("failed to read mssql table name: {err}"))?
            .ok_or_else(|| "missing mssql table name".to_string())?
            .to_string();

        table_rows.push((schema, table));
    }
    drop(table_stream);

    let mut tables = Vec::new();
    for (schema, table) in table_rows {
        let mut columns_query = client
            .query(
                "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, ORDINAL_POSITION \
                FROM INFORMATION_SCHEMA.COLUMNS \
                WHERE TABLE_SCHEMA = @P1 AND TABLE_NAME = @P2 \
                ORDER BY ORDINAL_POSITION",
                &[&schema, &table],
            )
            .await
            .map_err(|err| format!("failed to read mssql columns for {schema}.{table}: {err}"))?;

        let mut columns = Vec::new();
        while let Some(column_item) = columns_query
            .try_next()
            .await
            .map_err(|err| format!("failed to read mssql columns for {schema}.{table}: {err}"))?
        {
            let QueryItem::Row(column_row) = column_item else {
                continue;
            };

            let name: String = column_row
                .try_get::<&str, _>("COLUMN_NAME")
                .map_err(|err| {
                    format!("failed to read mssql column name for {schema}.{table}: {err}")
                })?
                .ok_or_else(|| "missing mssql column name".to_string())?
                .to_string();
            let data_type: String = column_row
                .try_get::<&str, _>("DATA_TYPE")
                .map_err(|err| {
                    format!("failed to read mssql data type for {schema}.{table}.{name}: {err}")
                })?
                .ok_or_else(|| "missing mssql data type".to_string())?
                .to_string();
            let nullable: String = column_row
                .try_get::<&str, _>("IS_NULLABLE")
                .map_err(|err| {
                    format!("failed to read mssql nullable flag for {schema}.{table}.{name}: {err}")
                })?
                .ok_or_else(|| "missing mssql nullability".to_string())?
                .to_string();

            columns.push(DatabaseColumn {
                name,
                data_type,
                nullable: nullable.eq_ignore_ascii_case("YES"),
                primary_key: false,
            });
        }

        tables.push(DatabaseTable {
            schema: Some(schema),
            name: table,
            row_count: None,
            columns,
        });
    }

    Ok(DatabaseSchema {
        profile_id: profile.id.clone(),
        tables,
        refreshed_ms: database_now_ms(),
    })
}

async fn execute_mssql_query(
    profile: &DatabaseProfile,
    request: DatabaseQueryRequest,
    classification: &QueryClassification,
    password: Option<String>,
) -> Result<DatabaseQueryResult, String> {
    let parts = mssql_connection_parts(profile, password)?;
    let mut config = TiberiusConfig::new();
    config.host(&parts.host);
    config.port(parts.port);
    config.database(&parts.database);
    if let Some(username) = parts.username.as_deref() {
        config.authentication(AuthMethod::sql_server(
            username,
            parts.password.as_deref().unwrap_or_default(),
        ));
    }

    let stream = TcpStream::connect((parts.host.as_str(), parts.port))
        .await
        .map_err(|err| err.to_string())?;
    let mut client = TiberiusClient::connect(config, stream.compat_write())
        .await
        .map_err(|err| err.to_string())?;

    let start = database_now_ms();
    if matches!(classification.kind, QueryKind::Read) {
        let limit = request.limit.min(MAX_DATABASE_ROWS);
        let mut stream = client
            .query(&request.sql, &[])
            .await
            .map_err(|err| format!("failed to execute SQL: {err}"))?;
        let columns = stream
            .columns()
            .await
            .map_err(|err| format!("failed to read mssql columns: {err}"))?
            .unwrap_or_default()
            .iter()
            .map(|column| column.name().to_string())
            .collect::<Vec<_>>();

        let mut row_values = Vec::new();
        let mut truncated = false;
        while let Some(item) = stream
            .try_next()
            .await
            .map_err(|err| format!("failed to collect mssql query rows: {err}"))?
        {
            let QueryItem::Row(row) = item else {
                continue;
            };

            if row_values.len() == limit {
                truncated = true;
                break;
            }

            let mut cells = Vec::new();
            for index in 0..row.columns().len() {
                cells.push(database_cell_from_mssql_value(&row, index));
            }
            row_values.push(cells);
        }

        Ok(DatabaseQueryResult {
            profile_id: request.profile_id,
            sql: request.sql,
            classification: classification.clone(),
            columns,
            rows: row_values
                .into_iter()
                .map(|cells| DatabaseRow { cells })
                .collect(),
            affected_rows: None,
            truncated,
            executed_ms: database_now_ms().saturating_sub(start),
            history_id: String::new(),
        })
    } else {
        let affected_rows = client
            .execute(&request.sql, &[])
            .await
            .map_err(|err| format!("failed to execute SQL: {err}"))?
            .total();

        Ok(DatabaseQueryResult {
            profile_id: request.profile_id,
            sql: request.sql,
            classification: classification.clone(),
            columns: Vec::new(),
            rows: Vec::new(),
            affected_rows: Some(affected_rows),
            truncated: false,
            executed_ms: database_now_ms().saturating_sub(start),
            history_id: String::new(),
        })
    }
}

fn database_cell_from_mssql_value(row: &tiberius::Row, index: usize) -> DatabaseCell {
    macro_rules! cell_from_optional_scalar {
        ($type:ty) => {
            if let Ok(Some(value)) = row.try_get::<$type, _>(index) {
                return DatabaseCell::text(value.to_string());
            }
        };
    }

    if let Ok(Some(value)) = row.try_get::<&str, _>(index) {
        return DatabaseCell::text(value.to_string());
    }

    cell_from_optional_scalar!(bool);
    cell_from_optional_scalar!(i16);
    cell_from_optional_scalar!(i32);
    cell_from_optional_scalar!(f32);
    cell_from_optional_scalar!(f64);

    if let Ok(Some(value)) = row.try_get::<&[u8], _>(index) {
        return String::from_utf8(value.to_vec())
            .map_or_else(|_| DatabaseCell::text("<binary>"), DatabaseCell::text);
    }

    DatabaseCell::text("<unsupported>")
}

fn quote_sqlite_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn validate_not_raw_dsn(field: &str, value: &str) -> Result<(), String> {
    if has_raw_dsn_prefix(value) {
        return Err(format!("raw database DSNs are not accepted in {field}"));
    }
    Ok(())
}

fn has_raw_dsn_prefix(value: &str) -> bool {
    const RAW_DSN_PREFIXES: [&str; 7] = [
        "postgres://",
        "postgresql://",
        "jdbc:",
        "mssql://",
        "sqlserver://",
        "sqlite://",
        "file:",
    ];

    let lowered = value.trim().to_lowercase();
    RAW_DSN_PREFIXES
        .iter()
        .any(|prefix| lowered.starts_with(prefix))
        || has_dsn_key_value_connection_string(&lowered)
}

fn has_dsn_key_value_connection_string(value: &str) -> bool {
    let normalized = value
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();

    const RAW_DSN_KEYS: [&str; 12] = [
        "host=",
        "server=",
        "database=",
        "dbname=",
        "user=",
        "username=",
        "datasource=",
        "initialcatalog=",
        "userid=",
        "uid=",
        "password=",
        "pwd=",
    ];

    RAW_DSN_KEYS.iter().any(|key| {
        normalized.starts_with(key)
            || normalized.contains(&format!(";{key}"))
            || normalized.contains(&format!("&{key}"))
    })
}

#[cfg(test)]
#[derive(Clone, Debug)]
struct InMemoryDatabaseSecretStore {
    values: Arc<Mutex<HashMap<String, String>>>,
}

#[cfg(test)]
impl Default for InMemoryDatabaseSecretStore {
    fn default() -> Self {
        Self {
            values: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[cfg(test)]
impl DatabaseSecretStore for InMemoryDatabaseSecretStore {
    fn set_secret(&self, secret_id: &str, secret: &str) -> Result<(), String> {
        let mut values = self.values.lock().map_err(|err| err.to_string())?;
        values.insert(secret_id.to_string(), secret.to_string());
        Ok(())
    }

    fn get_secret(&self, secret_id: &str) -> Result<String, String> {
        let values = self.values.lock().map_err(|err| err.to_string())?;
        values
            .get(secret_id)
            .cloned()
            .ok_or_else(|| format!("secret not found: {secret_id}"))
    }

    fn delete_secret(&self, secret_id: &str) -> Result<(), String> {
        let mut values = self.values.lock().map_err(|err| err.to_string())?;
        values
            .remove(secret_id)
            .map(|_| ())
            .ok_or_else(|| format!("secret not found: {secret_id}"))
    }
}

#[cfg(test)]
#[derive(Clone, Debug, Default)]
struct FailingReadDatabaseSecretStore {
    values: Arc<Mutex<HashMap<String, String>>>,
    get_calls: Arc<AtomicUsize>,
    set_calls: Arc<AtomicUsize>,
    delete_calls: Arc<AtomicUsize>,
}

#[cfg(test)]
impl FailingReadDatabaseSecretStore {
    fn with_secret(secret_id: &str, secret: &str) -> Self {
        let store = Self::default();
        let mut values = store.values.lock().expect("secret store lock");
        values.insert(secret_id.to_string(), secret.to_string());
        drop(values);
        store
    }

    fn get_call_count(&self) -> usize {
        self.get_calls.load(Ordering::SeqCst)
    }

    fn set_call_count(&self) -> usize {
        self.set_calls.load(Ordering::SeqCst)
    }

    fn delete_call_count(&self) -> usize {
        self.delete_calls.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
impl DatabaseSecretStore for FailingReadDatabaseSecretStore {
    fn set_secret(&self, secret_id: &str, secret: &str) -> Result<(), String> {
        self.set_calls.fetch_add(1, Ordering::SeqCst);
        let mut values = self.values.lock().map_err(|err| err.to_string())?;
        values.insert(secret_id.to_string(), secret.to_string());
        Ok(())
    }

    fn get_secret(&self, secret_id: &str) -> Result<String, String> {
        self.get_calls.fetch_add(1, Ordering::SeqCst);
        Err(format!("failed to read secret: {secret_id}"))
    }

    fn delete_secret(&self, secret_id: &str) -> Result<(), String> {
        self.delete_calls.fetch_add(1, Ordering::SeqCst);
        let mut values = self.values.lock().map_err(|err| err.to_string())?;
        values
            .remove(secret_id)
            .map(|_| ())
            .ok_or_else(|| format!("secret not found: {secret_id}"))
    }
}

pub fn classify_sql(sql: &str) -> QueryClassification {
    let mut has_executable_statement = false;
    let mut kind = QueryKind::Read;

    for statement in split_sql_statements(sql) {
        if let Some(token) = first_sql_token(statement) {
            has_executable_statement = true;
            let statement_kind = match token.as_str() {
                "SELECT" | "WITH" | "EXPLAIN" | "SHOW" | "DESCRIBE" => QueryKind::Read,
                "INSERT" | "UPDATE" | "DELETE" | "MERGE" | "CALL" => QueryKind::Mutation,
                "DROP" | "TRUNCATE" | "ALTER" | "CREATE" | "REINDEX" | "VACUUM" => {
                    QueryKind::Destructive
                }
                _ => QueryKind::Destructive,
            };

            if matches!(statement_kind, QueryKind::Destructive) {
                kind = QueryKind::Destructive;
                break;
            }

            if matches!(statement_kind, QueryKind::Mutation) && matches!(kind, QueryKind::Read) {
                kind = QueryKind::Mutation;
            }
        }
    }

    if !has_executable_statement {
        kind = QueryKind::Destructive;
    }

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

pub fn validate_query_request(
    profile: &DatabaseProfile,
    request: &DatabaseQueryRequest,
) -> Result<QueryClassification, String> {
    if request.profile_id != profile.id {
        return Err("profile id mismatch".to_string());
    }

    let classification = classify_sql(&request.sql);

    if profile.read_only && !matches!(classification.kind, QueryKind::Read) {
        return Err("read-only database profile blocks mutating SQL".to_string());
    }

    if classification.requires_confirmation
        && request.confirmation.as_deref() != Some(classification.confirmation_text.as_str())
    {
        let action = match classification.kind {
            QueryKind::Mutation => "mutating SQL",
            QueryKind::Destructive => "destructive SQL",
            QueryKind::Read => "read-only SQL",
        };

        return Err(format!(
            "{action} requires confirmation text: {}",
            classification.confirmation_text
        ));
    }

    Ok(classification)
}

fn split_sql_statements(sql: &str) -> Vec<&str> {
    let bytes = sql.as_bytes();
    let mut statements = Vec::new();

    let mut statement_start = 0;
    let mut index = 0;
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    while index < bytes.len() {
        if in_line_comment {
            if bytes[index] == b'\n' {
                in_line_comment = false;
            }
            index += 1;
            continue;
        }

        if in_block_comment {
            if bytes[index] == b'*' && index + 1 < bytes.len() && bytes[index + 1] == b'/' {
                in_block_comment = false;
                index += 2;
                continue;
            }

            index += 1;
            continue;
        }

        if in_single_quote {
            if bytes[index] == b'\'' {
                if index + 1 < bytes.len() && bytes[index + 1] == b'\'' {
                    index += 2;
                    continue;
                }
                in_single_quote = false;
            }
            index += 1;
            continue;
        }

        if in_double_quote {
            if bytes[index] == b'"' {
                if index + 1 < bytes.len() && bytes[index + 1] == b'"' {
                    index += 2;
                    continue;
                }
                in_double_quote = false;
            }
            index += 1;
            continue;
        }

        if bytes[index] == b'\'' {
            in_single_quote = true;
            index += 1;
            continue;
        }

        if bytes[index] == b'"' {
            in_double_quote = true;
            index += 1;
            continue;
        }

        if bytes[index] == b'-' && index + 1 < bytes.len() && bytes[index + 1] == b'-' {
            in_line_comment = true;
            index += 2;
            continue;
        }

        if bytes[index] == b'/' && index + 1 < bytes.len() && bytes[index + 1] == b'*' {
            in_block_comment = true;
            index += 2;
            continue;
        }

        if bytes[index] == b';' {
            let statement = sql[statement_start..index].trim();
            if !statement.is_empty() {
                statements.push(statement);
            }
            statement_start = index + 1;
            index += 1;
            continue;
        }

        index += 1;
    }

    let trailing_statement = sql[statement_start..].trim();
    if !trailing_statement.is_empty() {
        statements.push(trailing_statement);
    }

    statements
}

pub fn database_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}

fn first_sql_token(sql: &str) -> Option<String> {
    let bytes = sql.as_bytes();
    let mut index = 0;
    let first = next_token(bytes, &mut index)?;
    if first != "WITH" {
        return Some(first);
    }

    let mut current = skip_whitespace_and_comments(bytes, index).unwrap_or(index);

    let mut recursive_probe = current;
    if next_token(bytes, &mut recursive_probe).as_deref() == Some("RECURSIVE") {
        current = skip_whitespace_and_comments(bytes, recursive_probe).unwrap_or(recursive_probe);
    }

    loop {
        current = skip_whitespace_and_comments(bytes, current).unwrap_or(current);
        if current >= bytes.len() {
            return None;
        }

        next_token(bytes, &mut current)?;

        current = skip_whitespace_and_comments(bytes, current).unwrap_or(current);
        if matches_current_char(bytes, current, b'(') {
            current = skip_nested_parentheses(bytes, current)?;
            current = skip_whitespace_and_comments(bytes, current).unwrap_or(current);
        }

        if next_token(bytes, &mut current).as_deref() != Some("AS") {
            return None;
        }

        current = skip_whitespace_and_comments(bytes, current).unwrap_or(current);
        if !matches_current_char(bytes, current, b'(') {
            return None;
        }

        current = skip_nested_parentheses(bytes, current)?;
        current = skip_whitespace_and_comments(bytes, current).unwrap_or(current);
        if current >= bytes.len() {
            return None;
        }

        if bytes[current] == b',' {
            current += 1;
            continue;
        }

        break;
    }

    next_token(bytes, &mut current)
}

fn skip_nested_parentheses(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start;
    if !matches_current_char(bytes, index, b'(') {
        return None;
    }

    let mut depth = 0usize;
    index += 1;
    depth += 1;

    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'\'' {
            index = skip_single_quote(bytes, index)?;
            continue;
        }
        if byte == b'"' {
            index = skip_double_quote(bytes, index)?;
            continue;
        }
        if byte == b'-' && index + 1 < bytes.len() && bytes[index + 1] == b'-' {
            index = skip_line_comment(bytes, index)?;
            continue;
        }
        if byte == b'/' && index + 1 < bytes.len() && bytes[index + 1] == b'*' {
            index = skip_block_comment(bytes, index)?;
            continue;
        }

        if byte == b'(' {
            depth = depth.saturating_add(1);
        } else if byte == b')' {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return Some(index + 1);
            }
        }
        index += 1;
    }
    None
}

fn next_token(bytes: &[u8], index: &mut usize) -> Option<String> {
    *index = skip_whitespace_and_comments(bytes, *index)?;
    let start = *index;

    while *index < bytes.len() {
        if bytes[*index].is_ascii_whitespace() {
            break;
        }
        if bytes[*index] == b'-' && *index + 1 < bytes.len() && bytes[*index + 1] == b'-' {
            break;
        }
        if bytes[*index] == b'/' && *index + 1 < bytes.len() && bytes[*index + 1] == b'*' {
            break;
        }
        if bytes[*index] == b';' || bytes[*index] == b',' {
            break;
        }
        *index += 1;
    }

    if *index == start {
        return None;
    }

    let token = std::str::from_utf8(&bytes[start..*index]).ok()?;
    let token = token.trim_matches(&[';', '(', ')'][..]);
    Some(token.to_ascii_uppercase())
}

fn skip_whitespace_and_comments(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start;

    while index < bytes.len() {
        if bytes[index].is_ascii_whitespace() {
            index += 1;
            continue;
        }

        if bytes[index] == b'-' && index + 1 < bytes.len() && bytes[index + 1] == b'-' {
            index = skip_line_comment(bytes, index)?;
            continue;
        }

        if bytes[index] == b'/' && index + 1 < bytes.len() && bytes[index + 1] == b'*' {
            index = skip_block_comment(bytes, index)?;
            continue;
        }

        return Some(index);
    }

    None
}

fn skip_line_comment(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start + 2;
    while index < bytes.len() && bytes[index] != b'\n' {
        index += 1;
    }
    if index < bytes.len() {
        Some(index + 1)
    } else {
        None
    }
}

fn skip_block_comment(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start + 2;
    while index + 1 < bytes.len() {
        if bytes[index] == b'*' && bytes[index + 1] == b'/' {
            return Some(index + 2);
        }
        index += 1;
    }
    None
}

fn skip_single_quote(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start + 1;
    while index < bytes.len() {
        if bytes[index] == b'\'' {
            if index + 1 < bytes.len() && bytes[index + 1] == b'\'' {
                index += 2;
                continue;
            }
            return Some(index + 1);
        }
        index += 1;
    }
    None
}

fn skip_double_quote(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start + 1;
    while index < bytes.len() {
        if bytes[index] == b'"' {
            if index + 1 < bytes.len() && bytes[index + 1] == b'"' {
                index += 2;
                continue;
            }
            return Some(index + 1);
        }
        index += 1;
    }
    None
}

fn matches_current_char(bytes: &[u8], index: usize, expected: u8) -> bool {
    if index >= bytes.len() {
        return false;
    }
    bytes[index] == expected
}

fn truncate_cell(value: String) -> String {
    value.chars().take(MAX_DATABASE_CELL_CHARS).collect()
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use super::*;

    #[cfg(unix)]
    fn set_permissions(path: &Path, mode: u32) {
        let permissions = std::fs::Permissions::from_mode(mode);
        std::fs::set_permissions(path, permissions).expect("set permissions");
    }

    #[test]
    fn classifies_reads_and_mutations_with_confirmation_policy() {
        assert_eq!(classify_sql("SELECT * FROM users").kind, QueryKind::Read);
        assert_eq!(
            classify_sql("  WITH recent AS (SELECT 1) SELECT * FROM recent").kind,
            QueryKind::Read,
        );

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
    fn classifies_multistatement_sql_as_destructive() {
        let result = classify_sql("SELECT 1; DROP TABLE users");

        assert_eq!(result.kind, QueryKind::Destructive);
        assert!(result.requires_confirmation);
        assert_eq!(result.confirmation_text, "RUN DESTRUCTIVE SQL");
    }

    #[test]
    fn with_cte_with_mutation_is_not_read() {
        let result = classify_sql("WITH cte AS (SELECT 1) DELETE FROM users");

        assert_ne!(result.kind, QueryKind::Read);
        assert!(result.requires_confirmation);
        match result.kind {
            QueryKind::Mutation => assert_eq!(result.confirmation_text, "RUN MUTATION"),
            QueryKind::Destructive => assert_eq!(result.confirmation_text, "RUN DESTRUCTIVE SQL"),
            QueryKind::Read => unreachable!(),
        }
    }

    #[test]
    fn readonly_profiles_reject_mutating_sql_even_with_confirmation() {
        let profile = database_profile("profile-1", DatabaseKind::PostgreSQL, true, true);

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
    fn readonly_profiles_reject_mutation_after_read_statement() {
        let profile = database_profile("profile-1", DatabaseKind::PostgreSQL, true, true);

        let result = validate_query_request(
            &profile,
            &DatabaseQueryRequest {
                profile_id: profile.id.clone(),
                sql: "SELECT 1; DELETE FROM users".to_string(),
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
    fn readonly_profiles_reject_with_mutating_cte() {
        let profile = database_profile("profile-1", DatabaseKind::PostgreSQL, true, true);

        let result = validate_query_request(
            &profile,
            &DatabaseQueryRequest {
                profile_id: profile.id.clone(),
                sql: "WITH cte AS (SELECT 1) DELETE FROM users".to_string(),
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

        assert_eq!(
            secrets
                .get_secret(saved.source.secret_id().expect("secret id"))
                .unwrap(),
            "super-secret"
        );
        let persisted = std::fs::read_to_string(temp.path().join("database-profiles.json"))
            .expect("profile json");
        assert!(!persisted.contains("super-secret"));
        assert!(!persisted.contains("postgres://"));
        assert!(!persisted.contains("mssql://"));
        assert!(!persisted.contains("sqlite://"));
        assert!(persisted.contains("secret_id"));
    }

    #[test]
    fn has_raw_dsn_prefix_rejects_key_value_and_jdbc_forms() {
        assert!(has_raw_dsn_prefix("jdbc:postgresql://localhost/db"));
        assert!(has_raw_dsn_prefix("jdbc:sqlite:/tmp/app.db"));
        assert!(has_raw_dsn_prefix("jdbc:sqlserver://db:1433;password=pw"));
        assert!(has_raw_dsn_prefix("host=db;password=secret"));
        assert!(has_raw_dsn_prefix(
            "Server=localhost; Password=pw;Database=app"
        ));
        assert!(has_raw_dsn_prefix("host=localhost dbname=app user=yuuzu"));
        assert!(has_raw_dsn_prefix("Server=localhost;Database=app"));
        assert!(has_raw_dsn_prefix("host = localhost password = pw"));
        assert!(has_raw_dsn_prefix(
            "Data Source=localhost;Initial Catalog=app;User ID=sa;Password=pw"
        ));
        assert!(has_raw_dsn_prefix(
            "Data Source=localhost;UID=sa;PWD=pw;Database=app"
        ));
        assert!(!has_raw_dsn_prefix("localhost"));
        assert!(!has_raw_dsn_prefix("user_only"));
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

        let secret_id = saved.source.secret_id().expect("secret id").to_string();
        store.delete_profile("profile-1", &secrets).expect("delete");

        assert!(secrets.get_secret(&secret_id).is_err());
    }

    #[test]
    fn profile_store_rejects_sqlite_dsn_paths_before_persisting() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = DatabaseProfileStore::new(temp.path().join("database-profiles.json"));
        let secrets = InMemoryDatabaseSecretStore::default();
        let result = store.save_profile(
            DatabaseProfileInput {
                id: None,
                workspace_root: "/workspace".to_string(),
                name: "legacy".to_string(),
                kind: DatabaseKind::SQLite,
                sqlite_path: Some("sqlite:///tmp/app.db".to_string()),
                host: None,
                port: None,
                database: None,
                username: None,
                password: None,
                read_only: false,
                production: false,
            },
            &secrets,
            || Ok(10),
            || "sqlite-profile".to_string(),
        );

        let err = result.expect_err("sqlite dsn path should be rejected");
        assert!(err.contains("raw database DSNs are not accepted"));

        let profile_file = temp.path().join("database-profiles.json");
        if profile_file.exists() {
            let contents = std::fs::read_to_string(&profile_file).expect("database profile json");
            assert!(!contents.contains("sqlite://"));
            assert!(!contents.contains("app.db"));
        }

        let values = secrets.values.lock().expect("secret store lock");
        assert!(values.is_empty());
    }

    #[test]
    fn profile_store_rejects_sqlite_dsn_paths_with_leading_whitespace() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = DatabaseProfileStore::new(temp.path().join("database-profiles.json"));
        let secrets = InMemoryDatabaseSecretStore::default();
        let result = store.save_profile(
            DatabaseProfileInput {
                id: None,
                workspace_root: "/workspace".to_string(),
                name: "legacy".to_string(),
                kind: DatabaseKind::SQLite,
                sqlite_path: Some("\tsqlite:///tmp/app.db".to_string()),
                host: None,
                port: None,
                database: None,
                username: None,
                password: None,
                read_only: false,
                production: false,
            },
            &secrets,
            || Ok(10),
            || "sqlite-profile".to_string(),
        );

        let err = result.expect_err("sqlite leading-whitespace dsn should be rejected");
        assert!(err.contains("raw database DSNs are not accepted"));
        assert!(!temp.path().join("database-profiles.json").exists());
    }

    #[test]
    fn profile_store_rejects_tcp_dsn_hosts_before_persisting() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = DatabaseProfileStore::new(temp.path().join("database-profiles.json"));
        let secrets = InMemoryDatabaseSecretStore::default();
        let inputs = [
            (
                DatabaseKind::PostgreSQL,
                "postgres://user:pw@db/app".to_string(),
            ),
            (DatabaseKind::MsSql, "mssql://user:pw@db/app".to_string()),
            (
                DatabaseKind::PostgreSQL,
                "jdbc:postgresql://localhost:5432/app".to_string(),
            ),
            (
                DatabaseKind::PostgreSQL,
                "Server=localhost;Password=pw;Database=app".to_string(),
            ),
            (
                DatabaseKind::PostgreSQL,
                "host=localhost;password=pw".to_string(),
            ),
            (
                DatabaseKind::PostgreSQL,
                "Server=localhost;Database=app".to_string(),
            ),
            (
                DatabaseKind::PostgreSQL,
                "host=localhost dbname=app user=yuuzu".to_string(),
            ),
            (
                DatabaseKind::PostgreSQL,
                "jdbc:sqlite:/tmp/app.db".to_string(),
            ),
            (
                DatabaseKind::PostgreSQL,
                "jdbc:sqlserver://db:1433;password=pw".to_string(),
            ),
            (
                DatabaseKind::MsSql,
                "Data Source=localhost;Initial Catalog=app;User ID=sa;Password=pw".to_string(),
            ),
            (
                DatabaseKind::MsSql,
                "server=localhost;UID=sa;PWD=pw;Database=app".to_string(),
            ),
        ];

        for (index, (kind, host)) in inputs.iter().enumerate() {
            let result = store.save_profile(
                DatabaseProfileInput {
                    id: Some(format!("profile-{index}")),
                    workspace_root: "/workspace".to_string(),
                    name: "legacy".to_string(),
                    kind: kind.clone(),
                    sqlite_path: None,
                    host: Some(host.clone()),
                    port: Some(5432),
                    database: Some("app".to_string()),
                    username: Some("user".to_string()),
                    password: Some("pw".to_string()),
                    read_only: false,
                    production: false,
                },
                &secrets,
                || Ok(10),
                || "tcp-profile".to_string(),
            );
            let err = result.expect_err("tcp dsn host should be rejected");
            assert!(err.contains("raw database DSNs are not accepted"));
        }

        let profile_file = temp.path().join("database-profiles.json");
        if profile_file.exists() {
            let contents = std::fs::read_to_string(&profile_file).expect("database profile json");
            assert!(!contents.contains("postgres://"));
            assert!(!contents.contains("mssql://"));
            assert!(!contents.contains("jdbc:postgresql://"));
            assert!(!contents.contains("Server=localhost"));
            assert!(!contents.contains("host=localhost"));
            assert!(!contents.contains("user:pw"));
        }
        let values = secrets.values.lock().expect("secret store lock");
        assert!(values.is_empty());
    }

    #[test]
    fn profile_store_rejects_tcp_host_with_leading_space_without_secret() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = DatabaseProfileStore::new(temp.path().join("database-profiles.json"));
        let secrets = InMemoryDatabaseSecretStore::default();
        let result = store.save_profile(
            DatabaseProfileInput {
                id: Some("profile-1".to_string()),
                workspace_root: "/workspace".to_string(),
                name: "legacy".to_string(),
                kind: DatabaseKind::PostgreSQL,
                sqlite_path: None,
                host: Some(" postgres://user:pw@db/app".to_string()),
                port: Some(5432),
                database: Some("app".to_string()),
                username: Some("user".to_string()),
                password: Some("pw".to_string()),
                read_only: false,
                production: false,
            },
            &secrets,
            || Ok(10),
            || "tcp-profile".to_string(),
        );

        let err = result.expect_err("tcp leading-space dsn host should be rejected");
        assert!(err.contains("raw database DSNs are not accepted"));
        assert!(!temp.path().join("database-profiles.json").exists());
        let values = secrets.values.lock().expect("secret store lock");
        assert!(values.is_empty());
    }

    #[test]
    fn save_profile_rejects_update_if_existing_secret_is_unreadable() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("database-profiles.json");
        let store = DatabaseProfileStore::new(path.clone());
        let secrets = InMemoryDatabaseSecretStore::default();

        let saved = store
            .save_profile(
                DatabaseProfileInput {
                    id: Some("profile-1".to_string()),
                    workspace_root: "/workspace".to_string(),
                    name: "legacy".to_string(),
                    kind: DatabaseKind::PostgreSQL,
                    sqlite_path: None,
                    host: Some("localhost".to_string()),
                    port: Some(5432),
                    database: Some("app".to_string()),
                    username: Some("user".to_string()),
                    password: Some("old".to_string()),
                    read_only: false,
                    production: false,
                },
                &secrets,
                || Ok(10),
                || "profile-1".to_string(),
            )
            .expect("seed profile");

        let failing_secrets = FailingReadDatabaseSecretStore::with_secret(
            saved.source.secret_id().expect("secret id"),
            "old",
        );
        let before = std::fs::read_to_string(&path).expect("profile json");

        let result = store.save_profile(
            DatabaseProfileInput {
                id: Some("profile-1".to_string()),
                workspace_root: "/workspace".to_string(),
                name: "legacy-updated".to_string(),
                kind: DatabaseKind::PostgreSQL,
                sqlite_path: None,
                host: Some("localhost".to_string()),
                port: Some(5432),
                database: Some("app".to_string()),
                username: Some("user".to_string()),
                password: Some("new".to_string()),
                read_only: false,
                production: false,
            },
            &failing_secrets,
            || Ok(10),
            || "profile-1".to_string(),
        );

        assert!(result.is_err());
        let err = result.expect_err("unreadable previous secret should block update");
        assert!(err.contains("failed to read"));
        assert!(err.contains("database-profile:profile-1"));
        assert_eq!(failing_secrets.get_call_count(), 1);
        assert_eq!(failing_secrets.set_call_count(), 0);
        assert_eq!(failing_secrets.delete_call_count(), 0);

        let after = std::fs::read_to_string(&path).expect("profile json");
        assert_eq!(after, before);
        assert!(after.contains("legacy"));
        assert!(!after.contains("legacy-updated"));
    }

    #[cfg(unix)]
    #[test]
    fn save_profile_rolls_back_secret_when_json_persist_fails() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = DatabaseProfileStore::new(temp.path().join("database-profiles.json"));
        let secrets = InMemoryDatabaseSecretStore::default();
        let saved = store
            .save_profile(
                DatabaseProfileInput {
                    id: Some("profile-1".to_string()),
                    workspace_root: "/workspace".to_string(),
                    name: "legacy".to_string(),
                    kind: DatabaseKind::PostgreSQL,
                    sqlite_path: None,
                    host: Some("localhost".to_string()),
                    port: Some(5432),
                    database: Some("app".to_string()),
                    username: Some("user".to_string()),
                    password: Some("old".to_string()),
                    read_only: false,
                    production: false,
                },
                &secrets,
                || Ok(10),
                || "profile-1".to_string(),
            )
            .expect("seed profile");
        let old_secret_id = saved.source.secret_id().expect("secret id").to_string();

        set_permissions(temp.path(), 0o500);
        let result = store.save_profile(
            DatabaseProfileInput {
                id: Some("profile-1".to_string()),
                workspace_root: "/workspace".to_string(),
                name: "legacy-updated".to_string(),
                kind: DatabaseKind::PostgreSQL,
                sqlite_path: None,
                host: Some("localhost".to_string()),
                port: Some(5432),
                database: Some("app".to_string()),
                username: Some("user".to_string()),
                password: Some("new".to_string()),
                read_only: false,
                production: false,
            },
            &secrets,
            || Ok(11),
            || "profile-1".to_string(),
        );
        set_permissions(temp.path(), 0o700);

        assert!(result.is_err());
        assert_eq!(
            secrets
                .get_secret(&old_secret_id)
                .expect("existing secret should be restored"),
            "old"
        );
    }

    #[cfg(unix)]
    #[test]
    fn save_profile_rolls_back_new_secret_when_json_persist_fails() {
        let temp = tempfile::tempdir().expect("temp dir");
        set_permissions(temp.path(), 0o500);
        let store = DatabaseProfileStore::new(temp.path().join("database-profiles.json"));
        let secrets = InMemoryDatabaseSecretStore::default();
        let result = store.save_profile(
            DatabaseProfileInput {
                id: Some("profile-1".to_string()),
                workspace_root: "/workspace".to_string(),
                name: "new".to_string(),
                kind: DatabaseKind::PostgreSQL,
                sqlite_path: None,
                host: Some("localhost".to_string()),
                port: Some(5432),
                database: Some("app".to_string()),
                username: Some("user".to_string()),
                password: Some("new-password".to_string()),
                read_only: false,
                production: false,
            },
            &secrets,
            || Ok(10),
            || "profile-1".to_string(),
        );
        set_permissions(temp.path(), 0o700);

        assert!(result.is_err());
        assert!(secrets.values.lock().expect("secret store lock").is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn delete_profile_does_not_delete_secret_when_json_persist_fails() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = DatabaseProfileStore::new(temp.path().join("database-profiles.json"));
        let secrets = InMemoryDatabaseSecretStore::default();
        let saved = store
            .save_profile(
                DatabaseProfileInput {
                    id: Some("profile-1".to_string()),
                    workspace_root: "/workspace".to_string(),
                    name: "legacy".to_string(),
                    kind: DatabaseKind::PostgreSQL,
                    sqlite_path: None,
                    host: Some("localhost".to_string()),
                    port: Some(5432),
                    database: Some("app".to_string()),
                    username: Some("user".to_string()),
                    password: Some("pw".to_string()),
                    read_only: false,
                    production: false,
                },
                &secrets,
                || Ok(10),
                || "profile-1".to_string(),
            )
            .expect("seed profile");
        let secret_id = saved.source.secret_id().expect("secret id").to_string();

        set_permissions(temp.path(), 0o500);
        let result = store.delete_profile("profile-1", &secrets);
        set_permissions(temp.path(), 0o700);

        assert!(result.is_err());
        let persisted = std::fs::read_to_string(temp.path().join("database-profiles.json"))
            .expect("profile json");
        assert!(persisted.contains("profile-1"));
        assert_eq!(
            secrets
                .get_secret(&secret_id)
                .expect("secret should remain"),
            "pw"
        );
    }

    #[test]
    fn keyring_store_initializer_runs_when_default_store_is_missing() {
        let init_calls = Arc::new(AtomicUsize::new(0));
        let init_calls_for_set = Arc::clone(&init_calls);
        let result = ensure_keyring_default_store_with(
            || false,
            || {
                init_calls_for_set.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        );

        assert!(
            result.is_ok(),
            "initializer should run when missing default store"
        );
        assert_eq!(init_calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn keyring_store_initializer_is_skipped_when_default_store_already_exists() {
        let init_calls = Arc::new(AtomicUsize::new(0));
        let init_calls_for_set = Arc::clone(&init_calls);
        let result = ensure_keyring_default_store_with(
            || true,
            || {
                init_calls_for_set.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        );

        assert!(
            result.is_ok(),
            "pre-existing default store should be reused"
        );
        assert_eq!(init_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn keyring_store_initializer_errors_are_propagated() {
        let result = ensure_keyring_default_store_with(
            || false,
            || Err("native store unavailable".to_string()),
        );

        assert_eq!(
            result.expect_err("expected initialization failure"),
            "native store unavailable"
        );
    }

    #[test]
    fn sqlite_schema_lists_tables_columns_and_row_counts() {
        let temp = tempfile::tempdir().expect("temp dir");
        let db_path = temp.path().join("local.db");
        seed_sqlite_database(&db_path);
        let profile = sqlite_profile("profile-1", &db_path, true);

        let schema = inspect_sqlite_schema(&profile).expect("schema");

        let users = schema
            .tables
            .into_iter()
            .find(|table| table.name == "users")
            .expect("users table");

        assert_eq!(users.row_count, Some(2));
        assert!(users
            .columns
            .iter()
            .any(|column| column.name == "id" && column.primary_key));
        assert!(users
            .columns
            .iter()
            .any(|column| column.name == "email" && !column.nullable));
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
            &classify_sql("SELECT id, email FROM users ORDER BY id"),
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

        let request = DatabaseQueryRequest {
            profile_id: profile.id.clone(),
            sql: "UPDATE users SET email = 'x@example.test' WHERE id = 1".to_string(),
            limit: 100,
            confirmation: None,
        };

        let result = validate_query_request(&profile, &request);
        assert_eq!(
            result.expect_err("confirmation required"),
            "mutating SQL requires confirmation text: RUN MUTATION"
        );
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

    fn seed_sqlite_database(path: &Path) {
        let connection = Connection::open(path).expect("open sqlite");
        connection
            .execute_batch(
                "DROP TABLE IF EXISTS users;\
                CREATE TABLE users (\
                    id INTEGER PRIMARY KEY NOT NULL,\
                    email TEXT NOT NULL\
                );\
                INSERT INTO users (id, email) VALUES\
                    (1, 'a@example.test'),\
                    (2, 'b@example.test');",
            )
            .expect("seed users table");
    }

    fn sqlite_profile(id: &str, path: &Path, read_only: bool) -> DatabaseProfile {
        DatabaseProfile {
            id: id.to_string(),
            workspace_root: "/workspace".to_string(),
            name: "SQLite".to_string(),
            kind: DatabaseKind::SQLite,
            source: DatabaseConnectionSource::SQLite {
                path: path.to_path_buf(),
            },
            read_only,
            production: false,
            created_ms: 1,
            updated_ms: 1,
        }
    }

    fn tcp_profile(kind: DatabaseKind, port: u16, secret_id: Option<&str>) -> DatabaseProfile {
        DatabaseProfile {
            id: format!("{kind:?}-{port}"),
            workspace_root: "/workspace".to_string(),
            name: "Profile".to_string(),
            kind,
            source: DatabaseConnectionSource::Tcp {
                host: "localhost".to_string(),
                port,
                database: "app".to_string(),
                username: Some("yuuzu".to_string()),
                secret_id: secret_id.map(str::to_string),
            },
            read_only: false,
            production: false,
            created_ms: 1,
            updated_ms: 1,
        }
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
