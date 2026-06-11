use keyring_core::Entry;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::sync::{mpsc, Mutex as TokioMutex};
use tokio::time::{timeout, Duration};

use async_trait::async_trait;
use russh::client;
use russh::keys::{self, load_secret_key, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, Disconnect};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileType, OpenFlags};
use uuid::Uuid;

const SSH_AGENT_UNAVAILABLE_MESSAGE: &str = "SSH agent authentication is unavailable in this build";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RemoteAuthKind {
    Password,
    Key,
    Agent,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RemoteAuthSource {
    Password {
        secret_id: String,
    },
    Key {
        key_path: PathBuf,
        passphrase_secret_id: Option<String>,
    },
    Agent,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteHostProfile {
    pub id: String,
    pub workspace_root: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: RemoteAuthSource,
    pub default_remote_path: String,
    pub keepalive_seconds: u64,
    pub connect_timeout_seconds: u64,
    pub created_ms: u64,
    pub updated_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteHostProfileInput {
    pub id: Option<String>,
    pub workspace_root: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_kind: RemoteAuthKind,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub key_passphrase: Option<String>,
    pub default_remote_path: String,
    pub keepalive_seconds: u64,
    pub connect_timeout_seconds: u64,
}

pub trait RemoteSecretStore: Send + Sync {
    fn get_secret(&self, secret_id: &str) -> Result<String, String>;
    fn set_secret(&self, secret_id: &str, secret: &str) -> Result<(), String>;
    fn delete_secret(&self, secret_id: &str) -> Result<(), String>;
}

#[derive(Clone, Debug)]
pub struct KeyringRemoteSecretStore {
    service: String,
}

impl KeyringRemoteSecretStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }
}

impl RemoteSecretStore for KeyringRemoteSecretStore {
    fn get_secret(&self, secret_id: &str) -> Result<String, String> {
        crate::database::ensure_keyring_default_store()?;
        let entry = Entry::new(&self.service, secret_id).map_err(|err| err.to_string())?;
        let secret = entry.get_secret().map_err(|err| err.to_string())?;
        String::from_utf8(secret).map_err(|_| "stored secret is not valid UTF-8".to_string())
    }

    fn set_secret(&self, secret_id: &str, secret: &str) -> Result<(), String> {
        crate::database::ensure_keyring_default_store()?;
        let entry = Entry::new(&self.service, secret_id).map_err(|err| err.to_string())?;
        entry
            .set_secret(secret.as_bytes())
            .map_err(|err| err.to_string())
    }

    fn delete_secret(&self, secret_id: &str) -> Result<(), String> {
        crate::database::ensure_keyring_default_store()?;
        let entry = Entry::new(&self.service, secret_id).map_err(|err| err.to_string())?;
        entry.delete_credential().map_err(|err| err.to_string())
    }
}

#[derive(Clone, Debug)]
pub struct RemoteHostProfileStore {
    path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl RemoteHostProfileStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn list_profiles(&self, workspace_root: &str) -> Result<Vec<RemoteHostProfile>, String> {
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

    pub fn get_profile(&self, id: &str) -> Result<RemoteHostProfile, String> {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        self.load()?
            .into_iter()
            .find(|profile| profile.id == id)
            .ok_or_else(|| format!("remote host profile not found: {id}"))
    }

    pub fn save_profile<FNow, FId>(
        &self,
        input: RemoteHostProfileInput,
        secrets: &dyn RemoteSecretStore,
        now: FNow,
        id_factory: FId,
    ) -> Result<RemoteHostProfile, String>
    where
        FNow: Fn() -> Result<u64, String>,
        FId: Fn() -> String,
    {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        validate_remote_profile_input(&input)?;
        let now = now()?;

        let mut profiles = self.load()?;
        let profile_id = input.id.unwrap_or_else(&id_factory);
        let previous = profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .cloned();
        let previous_secret_ids = previous.as_ref().map(remote_secret_ids).unwrap_or_default();
        let previous_secret_values = read_existing_remote_secrets(&previous_secret_ids, secrets)?;
        let mut changed_secret_ids = Vec::new();

        let auth = match input.auth_kind {
            RemoteAuthKind::Password => {
                let secret_id = format!("remote-host:{profile_id}:password");
                let secret_id = match input.password.as_deref() {
                    Some(password) => {
                        secrets.set_secret(&secret_id, password)?;
                        changed_secret_ids.push(secret_id.clone());
                        secret_id
                    }
                    None => {
                        let existing = previous.as_ref().and_then(|profile| match &profile.auth {
                            RemoteAuthSource::Password { secret_id, .. } => Some(secret_id.clone()),
                            _ => None,
                        });

                        existing.ok_or_else(|| {
                            "SSH password is required for new password profiles".to_string()
                        })?
                    }
                };
                RemoteAuthSource::Password { secret_id }
            }
            RemoteAuthKind::Key => {
                let key_path = PathBuf::from(
                    input
                        .key_path
                        .clone()
                        .ok_or_else(|| "SSH key path is required".to_string())?,
                );
                let passphrase_secret_id = if let Some(passphrase) = input.key_passphrase.as_deref()
                {
                    let secret_id = format!("remote-host:{profile_id}:key-passphrase");
                    secrets.set_secret(&secret_id, passphrase)?;
                    changed_secret_ids.push(secret_id.clone());
                    Some(secret_id)
                } else {
                    previous.as_ref().and_then(|profile| match &profile.auth {
                        RemoteAuthSource::Key {
                            passphrase_secret_id,
                            ..
                        } => passphrase_secret_id.clone(),
                        _ => None,
                    })
                };
                RemoteAuthSource::Key {
                    key_path,
                    passphrase_secret_id,
                }
            }
            RemoteAuthKind::Agent => RemoteAuthSource::Agent,
        };

        let created_ms = previous.as_ref().map_or(now, |profile| profile.created_ms);
        let profile = RemoteHostProfile {
            id: profile_id.clone(),
            workspace_root: input.workspace_root,
            name: input.name.trim().to_string(),
            host: input.host.trim().to_string(),
            port: input.port,
            username: input.username.trim().to_string(),
            auth,
            default_remote_path: normalize_remote_path(&input.default_remote_path)?,
            keepalive_seconds: input.keepalive_seconds,
            connect_timeout_seconds: input.connect_timeout_seconds,
            created_ms,
            updated_ms: now,
        };

        profiles.retain(|profile| profile.id != profile_id);
        profiles.push(profile.clone());
        if let Err(save_error) = self.save(&profiles) {
            restore_remote_secrets(
                &previous_secret_values,
                &changed_secret_ids,
                secrets,
                save_error,
            )?;
        } else {
            let current_secret_ids = remote_secret_ids(&profile);
            let stale_secret_ids = previous_secret_ids
                .into_iter()
                .filter(|secret_id| !current_secret_ids.contains(secret_id))
                .collect::<Vec<_>>();
            for stale_secret_id in stale_secret_ids {
                if let Err(secret_error) = secrets.delete_secret(&stale_secret_id) {
                    return Err(format!(
                        "failed to remove obsolete remote secret '{stale_secret_id}': {secret_error}"
                    ));
                }
            }
        }

        Ok(profile)
    }

    pub fn delete_profile(&self, id: &str, secrets: &dyn RemoteSecretStore) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        let mut profiles = self.load()?;
        let index = profiles
            .iter()
            .position(|profile| profile.id == id)
            .ok_or_else(|| format!("remote host profile not found: {id}"))?;
        let secret_ids = remote_secret_ids(&profiles[index]);
        profiles.remove(index);
        self.save(&profiles)?;
        for secret_id in secret_ids {
            secrets.delete_secret(&secret_id)?;
        }
        Ok(())
    }

    fn load(&self) -> Result<Vec<RemoteHostProfile>, String> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let value = fs::read_to_string(&self.path).map_err(|err| err.to_string())?;
        if value.trim().is_empty() {
            return Ok(Vec::new());
        }
        serde_json::from_str(&value).map_err(|err| err.to_string())
    }

    fn save(&self, profiles: &[RemoteHostProfile]) -> Result<(), String> {
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
            .unwrap_or_else(|| std::ffi::OsStr::new("remote-hosts.json"));
        let file_name = OsString::from(file_name);
        let temp_path = parent.join(format!(
            ".{}.{}.tmp",
            file_name.to_string_lossy(),
            remote_now_ms(),
        ));
        fs::write(&temp_path, value).map_err(|err| err.to_string())?;
        fs::rename(&temp_path, &self.path).map_err(|err| err.to_string())?;
        Ok(())
    }
}

pub fn remote_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

pub fn new_remote_host_id() -> String {
    format!("remote-host-{}", Uuid::new_v4())
}

pub fn normalize_remote_path(path: &str) -> Result<String, String> {
    if path.contains('\0') {
        return Err("remote path cannot contain NUL".to_string());
    }

    let absolute = path.starts_with('/');
    let mut segments = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            value => segments.push(value),
        }
    }

    let joined = segments.join("/");
    if absolute {
        if joined.is_empty() {
            Ok("/".to_string())
        } else {
            Ok(format!("/{joined}"))
        }
    } else if joined.is_empty() {
        Ok(String::new())
    } else {
        Ok(joined)
    }
}

fn validate_remote_profile_input(input: &RemoteHostProfileInput) -> Result<(), String> {
    if input.name.trim().is_empty() {
        return Err("remote host name is required".to_string());
    }
    validate_ssh_host(&input.host)?;
    if input.port == 0 {
        return Err("SSH port must be between 1 and 65535".to_string());
    }
    if input.username.trim().is_empty() {
        return Err("SSH username is required".to_string());
    }
    if input.keepalive_seconds == 0 || input.keepalive_seconds > 3600 {
        return Err("keepalive seconds must be between 1 and 3600".to_string());
    }
    if input.connect_timeout_seconds == 0 || input.connect_timeout_seconds > 300 {
        return Err("connect timeout seconds must be between 1 and 300".to_string());
    }

    match input.auth_kind {
        RemoteAuthKind::Password
            if input.password.as_deref().unwrap_or_default().is_empty() && input.id.is_none() =>
        {
            Err("SSH password is required for new password profiles".to_string())
        }
        RemoteAuthKind::Key
            if input
                .key_path
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty() =>
        {
            Err("SSH key path is required".to_string())
        }
        _ => Ok(()),
    }
}

fn validate_ssh_host(host: &str) -> Result<(), String> {
    let trimmed = host.trim();
    if trimmed.is_empty()
        || trimmed.contains("://")
        || trimmed.contains('@')
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.chars().any(char::is_whitespace)
    {
        Err("SSH host must be a bare hostname or IP address".to_string())
    } else {
        Ok(())
    }
}

fn remote_secret_ids(profile: &RemoteHostProfile) -> Vec<String> {
    match &profile.auth {
        RemoteAuthSource::Password { secret_id } => vec![secret_id.clone()],
        RemoteAuthSource::Key {
            passphrase_secret_id,
            ..
        } => passphrase_secret_id.iter().cloned().collect(),
        RemoteAuthSource::Agent => Vec::new(),
    }
}

fn read_existing_remote_secrets(
    secret_ids: &[String],
    secrets: &dyn RemoteSecretStore,
) -> Result<HashMap<String, String>, String> {
    let mut values = HashMap::new();
    for secret_id in secret_ids {
        values.insert(secret_id.clone(), secrets.get_secret(secret_id)?);
    }
    Ok(values)
}

fn restore_remote_secrets(
    previous_secret_values: &HashMap<String, String>,
    changed_secret_ids: &[String],
    secrets: &dyn RemoteSecretStore,
    save_error: String,
) -> Result<(), String> {
    let mut restore_error: Option<(String, String)> = None;
    for secret_id in changed_secret_ids {
        let result = if let Some(previous_secret) = previous_secret_values.get(secret_id) {
            secrets.set_secret(secret_id, previous_secret)
        } else {
            secrets.delete_secret(secret_id)
        };

        if let Err(secret_error) = result {
            restore_error.get_or_insert_with(|| {
                (
                    secret_id.to_string(),
                    if previous_secret_values.contains_key(secret_id) {
                        format!("restore previous secret '{secret_id}': {secret_error}")
                    } else {
                        format!("remove newly created secret '{secret_id}': {secret_error}")
                    },
                )
            });
        }
    }

    if let Some((_, secret_error)) = restore_error {
        return Err(format!("{save_error}; unable to {secret_error}"));
    }

    Err(save_error)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RemoteConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteConnectionSnapshot {
    pub host_id: String,
    pub status: RemoteConnectionStatus,
    pub message: Option<String>,
    pub checked_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteTerminalSessionInfo {
    pub id: String,
    pub host_id: String,
    pub workspace_id: String,
    pub name: String,
    pub running: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteTerminalHandle {
    pub session_id: String,
    pub host_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RemoteFileKind {
    File,
    Directory,
    Symlink,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteFileEntry {
    pub host_id: String,
    pub path: String,
    pub name: String,
    pub kind: RemoteFileKind,
    pub size: Option<u64>,
    pub modified_ms: Option<u64>,
    pub link_target: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteCommandResult {
    pub host_id: String,
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<u32>,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteTransferResult {
    pub remote_path: String,
    pub local_path: PathBuf,
    pub bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteTerminalOutputEvent {
    pub session_id: String,
    pub chunk: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteTerminalExitEvent {
    pub session_id: String,
    pub exit_code: Option<u32>,
}

pub trait RemoteTerminalEventSink: Send + Sync {
    fn emit_output(&self, event: RemoteTerminalOutputEvent);
    fn emit_exit(&self, event: RemoteTerminalExitEvent);
}

#[derive(Clone, Default)]
pub struct NoopRemoteTerminalEventSink;

impl RemoteTerminalEventSink for NoopRemoteTerminalEventSink {
    fn emit_output(&self, _event: RemoteTerminalOutputEvent) {}

    fn emit_exit(&self, _event: RemoteTerminalExitEvent) {}
}

struct RemoteStateTerminalEventSink {
    inner: Arc<dyn RemoteTerminalEventSink>,
    terminal_sessions: Arc<Mutex<HashMap<String, RemoteTerminalSessionInfo>>>,
    exited_terminal_sessions: Arc<Mutex<HashSet<String>>>,
}

impl RemoteStateTerminalEventSink {
    fn new(
        inner: Arc<dyn RemoteTerminalEventSink>,
        terminal_sessions: Arc<Mutex<HashMap<String, RemoteTerminalSessionInfo>>>,
        exited_terminal_sessions: Arc<Mutex<HashSet<String>>>,
    ) -> Self {
        Self {
            inner,
            terminal_sessions,
            exited_terminal_sessions,
        }
    }
}

impl RemoteTerminalEventSink for RemoteStateTerminalEventSink {
    fn emit_output(&self, event: RemoteTerminalOutputEvent) {
        self.inner.emit_output(event);
    }

    fn emit_exit(&self, event: RemoteTerminalExitEvent) {
        let session_id = event.session_id.clone();
        if let Ok(mut sessions) = self.terminal_sessions.lock() {
            if let Some(session) = sessions.get_mut(&session_id) {
                session.running = false;
            } else if let Ok(mut exited) = self.exited_terminal_sessions.lock() {
                exited.insert(session_id);
            }
        }

        self.inner.emit_exit(event);
    }
}

#[derive(Clone)]
pub struct TauriRemoteTerminalEventSink {
    app: AppHandle,
}

impl TauriRemoteTerminalEventSink {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl RemoteTerminalEventSink for TauriRemoteTerminalEventSink {
    fn emit_output(&self, event: RemoteTerminalOutputEvent) {
        let _ = self.app.emit("workspace://ssh-terminal-output", event);
    }

    fn emit_exit(&self, event: RemoteTerminalExitEvent) {
        let _ = self.app.emit("workspace://ssh-terminal-exit", event);
    }
}

#[async_trait]
pub trait RemoteBackend: Send + Sync {
    async fn connect(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
    ) -> Result<RemoteConnectionSnapshot, String>;

    async fn disconnect(&self, host_id: &str) -> Result<RemoteConnectionSnapshot, String> {
        let _ = host_id;
        Err("SSH disconnect backend is unavailable".to_string())
    }

    async fn spawn_terminal(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        events: Arc<dyn RemoteTerminalEventSink>,
        rows: u16,
        cols: u16,
    ) -> Result<RemoteTerminalHandle, String> {
        let _ = (profile, secrets, events, rows, cols);
        Err("SSH terminal backend is unavailable".to_string())
    }

    async fn write_terminal(&self, session_id: &str, data: &str) -> Result<(), String> {
        let _ = (session_id, data);
        Err("SSH terminal write backend is unavailable".to_string())
    }

    async fn close_terminal(&self, session_id: &str) -> Result<RemoteTerminalSessionInfo, String> {
        let _ = session_id;
        Err("SSH terminal close backend is unavailable".to_string())
    }

    async fn run_command(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        command: &str,
    ) -> Result<RemoteCommandResult, String> {
        let _ = (profile, secrets, command);
        Err("remote command backend is unavailable".to_string())
    }

    async fn list_sftp_directory(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        path: &str,
    ) -> Result<Vec<RemoteFileEntry>, String> {
        let _ = (profile, secrets, path);
        Err("SFTP backend is unavailable".to_string())
    }

    async fn download_file(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        remote_path: &str,
        local_path: &Path,
    ) -> Result<RemoteTransferResult, String> {
        let _ = (profile, secrets, remote_path, local_path);
        Err("SFTP download backend is unavailable".to_string())
    }

    async fn upload_file(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        local_path: &Path,
        remote_path: &str,
    ) -> Result<RemoteTransferResult, String> {
        let _ = (profile, secrets, local_path, remote_path);
        Err("SFTP upload backend is unavailable".to_string())
    }
}

#[derive(Clone, Default)]
struct RusshClient {
    host: String,
    port: u16,
    known_hosts_path: Option<PathBuf>,
}

impl RusshClient {
    fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            host: host.into(),
            port,
            known_hosts_path: None,
        }
    }

    #[cfg(test)]
    fn with_known_hosts_path(
        host: impl Into<String>,
        port: u16,
        known_hosts_path: impl Into<PathBuf>,
    ) -> Self {
        Self {
            host: host.into(),
            port,
            known_hosts_path: Some(known_hosts_path.into()),
        }
    }
}

impl client::Handler for RusshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        check_known_host_key(
            &self.host,
            self.port,
            server_public_key,
            self.known_hosts_path.as_deref(),
        )
        .map_err(russh::Error::from)
    }
}

fn check_known_host_key(
    host: &str,
    port: u16,
    server_public_key: &keys::ssh_key::PublicKey,
    known_hosts_path: Option<&Path>,
) -> Result<bool, keys::Error> {
    match known_hosts_path {
        Some(path) => keys::check_known_hosts_path(host, port, server_public_key, path),
        None => keys::check_known_hosts(host, port, server_public_key),
    }
}

#[derive(Clone)]
struct RusshTerminalWriter {
    sender: mpsc::UnboundedSender<TerminalWriteCommand>,
    host_id: String,
    name: String,
}

enum TerminalWriteCommand {
    Data(Vec<u8>),
    Close,
}

type RusshSessionHandle = Arc<TokioMutex<client::Handle<RusshClient>>>;
type RusshChannel = russh::Channel<client::Msg>;

fn remote_file_kind(file_type: FileType) -> RemoteFileKind {
    if file_type.is_dir() {
        RemoteFileKind::Directory
    } else if file_type.is_symlink() {
        RemoteFileKind::Symlink
    } else {
        RemoteFileKind::File
    }
}

fn file_type_order(file_type: &RemoteFileKind) -> u8 {
    match file_type {
        RemoteFileKind::Directory => 0,
        RemoteFileKind::File => 1,
        RemoteFileKind::Symlink => 2,
    }
}

fn russh_client_config(profile: &RemoteHostProfile) -> client::Config {
    client::Config {
        keepalive_interval: Some(Duration::from_secs(profile.keepalive_seconds)),
        ..client::Config::default()
    }
}

#[derive(Default)]
pub struct RusshRemoteBackend {
    sessions: Arc<TokioMutex<u64>>,
    connections: Arc<TokioMutex<HashMap<String, RusshSessionHandle>>>,
    terminal_writers: Arc<TokioMutex<HashMap<String, RusshTerminalWriter>>>,
}

impl RusshRemoteBackend {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(TokioMutex::new(0)),
            connections: Arc::new(TokioMutex::new(HashMap::new())),
            terminal_writers: Arc::new(TokioMutex::new(HashMap::new())),
        }
    }

    async fn connect_handle(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
    ) -> Result<RusshSessionHandle, String> {
        if matches!(profile.auth, RemoteAuthSource::Agent) {
            return Err(SSH_AGENT_UNAVAILABLE_MESSAGE.to_string());
        }

        let timeout_secs = profile.connect_timeout_seconds.max(1);
        let config = russh_client_config(profile);

        let handshake = timeout(
            Duration::from_secs(timeout_secs),
            client::connect(
                Arc::new(config),
                (profile.host.as_str(), profile.port),
                RusshClient::new(profile.host.clone(), profile.port),
            ),
        )
        .await
        .map_err(|_| "SSH connection timed out".to_string())
        .and_then(|session| session.map_err(|err| err.to_string()))?;

        let handle = Arc::new(TokioMutex::new(handshake));
        {
            let mut session = handle.lock().await;
            let auth_result = match &profile.auth {
                RemoteAuthSource::Password { secret_id } => {
                    let password = secrets
                        .get_secret(secret_id)
                        .map_err(|err| format!("failed to read password secret: {err}"))?;
                    session
                        .authenticate_password(profile.username.clone(), password)
                        .await
                        .map_err(|err| format!("SSH password authentication failed: {err}"))?
                }
                RemoteAuthSource::Key {
                    key_path,
                    passphrase_secret_id,
                } => {
                    let passphrase = passphrase_secret_id
                        .as_deref()
                        .map(|secret_id| secrets.get_secret(secret_id))
                        .transpose()
                        .map_err(|err| format!("failed to read key passphrase secret: {err}"))?;
                    let key = load_secret_key(key_path, passphrase.as_deref()).map_err(|err| {
                        format!("failed to load SSH key {}: {err}", key_path.display())
                    })?;
                    let hash = session
                        .best_supported_rsa_hash()
                        .await
                        .map_err(|err| format!("failed to query RSA hash support: {err}"))?
                        .flatten();
                    session
                        .authenticate_publickey(
                            profile.username.clone(),
                            PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                        )
                        .await
                        .map_err(|err| format!("SSH key authentication failed: {err}"))?
                }
                RemoteAuthSource::Agent => unreachable!("agent auth returns before SSH connect"),
            };

            if !auth_result.success() {
                return Err("SSH authentication failed".to_string());
            }
        }

        Ok(handle)
    }

    async fn session_for(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
    ) -> Result<RusshSessionHandle, String> {
        if let Some(connection) = self.connections.lock().await.get(&profile.id).cloned() {
            return Ok(connection);
        }

        let connection = self.connect_handle(profile, secrets).await?;
        self.connections
            .lock()
            .await
            .insert(profile.id.clone(), connection.clone());
        Ok(connection)
    }

    async fn open_ssh_channel(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
    ) -> Result<RusshChannel, String> {
        let connection = self.session_for(profile, secrets).await?;
        let session = connection.lock().await;
        session
            .channel_open_session()
            .await
            .map_err(|err| err.to_string())
    }

    fn make_snapshot(host_id: &str, status: RemoteConnectionStatus) -> RemoteConnectionSnapshot {
        RemoteConnectionSnapshot {
            host_id: host_id.to_string(),
            status,
            message: None,
            checked_ms: remote_now_ms(),
        }
    }
}

#[async_trait]
impl RemoteBackend for RusshRemoteBackend {
    async fn connect(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
    ) -> Result<RemoteConnectionSnapshot, String> {
        let handle = self.connect_handle(profile, secrets).await?;
        self.connections
            .lock()
            .await
            .insert(profile.id.clone(), handle);
        Ok(Self::make_snapshot(
            &profile.id,
            RemoteConnectionStatus::Connected,
        ))
    }

    async fn disconnect(&self, host_id: &str) -> Result<RemoteConnectionSnapshot, String> {
        let maybe_connection = {
            let mut connections = self.connections.lock().await;
            connections.remove(host_id)
        };

        if let Some(connection) = maybe_connection {
            let session = connection.lock().await;
            let _ = session
                .disconnect(Disconnect::ByApplication, "disconnect", "en")
                .await;
        }

        Ok(Self::make_snapshot(
            host_id,
            RemoteConnectionStatus::Disconnected,
        ))
    }

    async fn spawn_terminal(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        events: Arc<dyn RemoteTerminalEventSink>,
        rows: u16,
        cols: u16,
    ) -> Result<RemoteTerminalHandle, String> {
        let channel = self
            .open_ssh_channel(profile, secrets)
            .await
            .map_err(|err| format!("failed to open SSH session: {err}"))?;

        channel
            .request_pty(
                true,
                "xterm-256color",
                cols.max(1) as u32,
                rows.max(1) as u32,
                0,
                0,
                &[],
            )
            .await
            .map_err(|err| format!("failed to request terminal pty: {err}"))?;
        channel
            .request_shell(true)
            .await
            .map_err(|err| format!("failed to request shell: {err}"))?;

        let session_id = {
            let mut sessions = self.sessions.lock().await;
            *sessions += 1;
            format!("{}:ssh-{sessions}", profile.id)
        };

        let (reader, writer) = channel.split();
        let (sender, mut receiver) = mpsc::unbounded_channel::<TerminalWriteCommand>();

        self.terminal_writers.lock().await.insert(
            session_id.clone(),
            RusshTerminalWriter {
                sender,
                host_id: profile.id.clone(),
                name: format!("{}@{}", profile.username, profile.host),
            },
        );

        let sink = events.clone();
        let output_session_id = session_id.clone();
        let terminal_writers = self.terminal_writers.clone();
        let cleanup_session_id = session_id.clone();
        tokio::spawn(async move {
            let mut exit_code = None;
            let mut reader = reader;
            let mut stream = String::new();
            loop {
                let Some(msg) = reader.wait().await else {
                    break;
                };
                match msg {
                    ChannelMsg::Data { data } => {
                        if !data.is_empty() {
                            stream.push_str(&String::from_utf8_lossy(&data));
                        }
                        sink.emit_output(RemoteTerminalOutputEvent {
                            session_id: output_session_id.clone(),
                            chunk: stream.clone(),
                        });
                        stream.clear();
                    }
                    ChannelMsg::ExtendedData { ext: 1, data } => {
                        if !data.is_empty() {
                            stream.push_str(&String::from_utf8_lossy(&data));
                        }
                        sink.emit_output(RemoteTerminalOutputEvent {
                            session_id: output_session_id.clone(),
                            chunk: stream.clone(),
                        });
                        stream.clear();
                    }
                    ChannelMsg::ExitStatus { exit_status } => {
                        exit_code = Some(exit_status);
                        break;
                    }
                    ChannelMsg::ExitSignal { .. } => {
                        break;
                    }
                    _ => {}
                }
            }

            terminal_writers.lock().await.remove(&cleanup_session_id);
            sink.emit_exit(RemoteTerminalExitEvent {
                session_id: output_session_id,
                exit_code,
            });
        });

        tokio::spawn(async move {
            while let Some(command) = receiver.recv().await {
                match command {
                    TerminalWriteCommand::Data(chunk) => {
                        let _ = writer.data_bytes(chunk).await;
                    }
                    TerminalWriteCommand::Close => {
                        let _ = writer.close().await;
                        break;
                    }
                }
            }
        });

        Ok(RemoteTerminalHandle {
            session_id,
            host_id: profile.id.clone(),
            name: format!("{}@{}", profile.username, profile.host),
        })
    }

    async fn write_terminal(&self, session_id: &str, data: &str) -> Result<(), String> {
        let terminal_writers = self.terminal_writers.lock().await;
        let sender = terminal_writers
            .get(session_id)
            .map(|writer| writer.sender.clone())
            .ok_or_else(|| format!("terminal session not found: {session_id}"))?;
        sender
            .send(TerminalWriteCommand::Data(data.as_bytes().to_vec()))
            .map_err(|_| format!("terminal session closed: {session_id}"))
    }

    async fn close_terminal(&self, session_id: &str) -> Result<RemoteTerminalSessionInfo, String> {
        let writer = {
            let mut terminal_writers = self.terminal_writers.lock().await;
            terminal_writers.remove(session_id)
        }
        .ok_or_else(|| format!("terminal session not found: {session_id}"))?;

        let _ = writer
            .sender
            .send(TerminalWriteCommand::Close)
            .map_err(|_| format!("failed to close terminal session: {session_id}"))?;

        Ok(RemoteTerminalSessionInfo {
            id: session_id.to_string(),
            host_id: writer.host_id,
            workspace_id: String::new(),
            name: writer.name,
            running: false,
        })
    }

    async fn run_command(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        command: &str,
    ) -> Result<RemoteCommandResult, String> {
        let mut channel = self
            .open_ssh_channel(profile, secrets)
            .await
            .map_err(|err| format!("failed to open SSH session: {err}"))?;

        let started = remote_now_ms();
        channel
            .exec(true, command)
            .await
            .map_err(|err| format!("failed to execute remote command: {err}"))?;

        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut exit_code = None;

        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } => stdout.push_str(&String::from_utf8_lossy(&data)),
                ChannelMsg::ExtendedData { ext: 1, data } => {
                    stderr.push_str(&String::from_utf8_lossy(&data))
                }
                ChannelMsg::ExitStatus { exit_status } => {
                    exit_code = Some(exit_status);
                }
                ChannelMsg::ExitSignal { .. } => {
                    exit_code = None;
                }
                _ => {}
            }
        }

        Ok(RemoteCommandResult {
            host_id: profile.id.clone(),
            command: command.to_string(),
            stdout,
            stderr,
            exit_code,
            duration_ms: remote_now_ms().saturating_sub(started),
        })
    }

    async fn list_sftp_directory(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        path: &str,
    ) -> Result<Vec<RemoteFileEntry>, String> {
        let channel = self
            .open_ssh_channel(profile, secrets)
            .await
            .map_err(|err| format!("failed to open SSH session: {err}"))?;

        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|err| format!("failed to open sftp subsystem: {err}"))?;

        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|err| format!("failed to initialize sftp session: {err}"))?;

        let entries = sftp
            .read_dir(path)
            .await
            .map_err(|err| format!("failed to read remote directory: {err}"))?;
        let mut rows = Vec::new();
        for entry in entries {
            let filename = entry.file_name();
            let metadata = entry.metadata();
            let file_type = remote_file_kind(metadata.file_type());
            let link_target = if matches!(file_type, RemoteFileKind::Symlink) {
                sftp.read_link(entry.path()).await.ok()
            } else {
                None
            };

            rows.push(RemoteFileEntry {
                host_id: profile.id.clone(),
                path: entry.path(),
                name: filename,
                kind: file_type,
                size: Some(metadata.len()),
                modified_ms: metadata.mtime.map(|value| u64::from(value) * 1000),
                link_target,
            });
        }

        rows.sort_by(|left, right| {
            file_type_order(&left.kind)
                .cmp(&file_type_order(&right.kind))
                .then_with(|| left.name.cmp(&right.name))
        });

        Ok(rows)
    }

    async fn download_file(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        remote_path: &str,
        local_path: &Path,
    ) -> Result<RemoteTransferResult, String> {
        let channel = self
            .open_ssh_channel(profile, secrets)
            .await
            .map_err(|err| format!("failed to open SSH session: {err}"))?;

        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|err| format!("failed to open sftp subsystem: {err}"))?;

        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|err| format!("failed to initialize sftp session: {err}"))?;

        if let Some(parent) = local_path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
        }

        let data = sftp
            .read(remote_path)
            .await
            .map_err(|err| format!("failed to download remote file: {err}"))?;
        fs::write(local_path, data.clone()).map_err(|err| err.to_string())?;

        Ok(RemoteTransferResult {
            remote_path: remote_path.to_string(),
            local_path: local_path.to_path_buf(),
            bytes: data.len() as u64,
        })
    }

    async fn upload_file(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        local_path: &Path,
        remote_path: &str,
    ) -> Result<RemoteTransferResult, String> {
        let channel = self
            .open_ssh_channel(profile, secrets)
            .await
            .map_err(|err| format!("failed to open SSH session: {err}"))?;

        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|err| format!("failed to open sftp subsystem: {err}"))?;

        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|err| format!("failed to initialize sftp session: {err}"))?;

        let bytes = fs::read(local_path).map_err(|err| err.to_string())?;
        let mut remote_file = sftp
            .open_with_flags(
                remote_path,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE | OpenFlags::READ,
            )
            .await
            .map_err(|err| format!("failed to open remote file: {err}"))?;

        remote_file
            .write_all(&bytes)
            .await
            .map_err(|err| format!("failed to upload file content: {err}"))?;
        remote_file
            .shutdown()
            .await
            .map_err(|err| format!("failed to finalize remote upload: {err}"))?;

        Ok(RemoteTransferResult {
            remote_path: remote_path.to_string(),
            local_path: local_path.to_path_buf(),
            bytes: bytes.len() as u64,
        })
    }
}

pub struct RemoteState {
    backend: Arc<dyn RemoteBackend>,
    connection_snapshots: Arc<Mutex<HashMap<String, RemoteConnectionSnapshot>>>,
    terminal_sessions: Arc<Mutex<HashMap<String, RemoteTerminalSessionInfo>>>,
    exited_terminal_sessions: Arc<Mutex<HashSet<String>>>,
}

impl RemoteState {
    pub fn new() -> Self {
        Self::new_with_backend(Arc::new(RusshRemoteBackend::new()))
    }

    pub fn new_with_backend(backend: Arc<dyn RemoteBackend>) -> Self {
        Self {
            backend,
            connection_snapshots: Arc::new(Mutex::new(HashMap::new())),
            terminal_sessions: Arc::new(Mutex::new(HashMap::new())),
            exited_terminal_sessions: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub fn connection_snapshot(&self, host_id: &str) -> Result<RemoteConnectionSnapshot, String> {
        let snapshots = self
            .connection_snapshots
            .lock()
            .map_err(|err| err.to_string())?;
        snapshots
            .get(host_id)
            .cloned()
            .ok_or_else(|| format!("remote host snapshot not found: {host_id}"))
    }

    pub fn list_ssh_terminal_sessions(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<RemoteTerminalSessionInfo>, String> {
        let mut sessions = self
            .terminal_sessions
            .lock()
            .map_err(|err| err.to_string())?
            .values()
            .filter(|session| session.workspace_id == workspace_id)
            .cloned()
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(sessions)
    }

    pub async fn connect_host(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
    ) -> Result<RemoteConnectionSnapshot, String> {
        self.set_connection(RemoteConnectionSnapshot {
            host_id: profile.id.clone(),
            status: RemoteConnectionStatus::Connecting,
            message: None,
            checked_ms: remote_now_ms(),
        })?;

        match self.backend.connect(profile, secrets).await {
            Ok(snapshot) => {
                self.set_connection(snapshot.clone())?;
                Ok(snapshot)
            }
            Err(error) => {
                self.set_connection(RemoteConnectionSnapshot {
                    host_id: profile.id.clone(),
                    status: RemoteConnectionStatus::Failed,
                    message: Some(error.clone()),
                    checked_ms: remote_now_ms(),
                })?;
                Err(error)
            }
        }
    }

    fn set_connection(&self, snapshot: RemoteConnectionSnapshot) -> Result<(), String> {
        let mut snapshots = self
            .connection_snapshots
            .lock()
            .map_err(|err| err.to_string())?;
        snapshots.insert(snapshot.host_id.clone(), snapshot);
        Ok(())
    }

    pub async fn disconnect_host(&self, host_id: &str) -> Result<RemoteConnectionSnapshot, String> {
        let snapshot = self.backend.disconnect(host_id).await?;
        self.set_connection(snapshot.clone())?;
        Ok(snapshot)
    }

    pub async fn spawn_ssh_terminal(
        &self,
        workspace_id: &str,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        events: Arc<dyn RemoteTerminalEventSink>,
        rows: u16,
        cols: u16,
    ) -> Result<RemoteTerminalSessionInfo, String> {
        let events = Arc::new(RemoteStateTerminalEventSink::new(
            events,
            self.terminal_sessions.clone(),
            self.exited_terminal_sessions.clone(),
        ));
        let handle = self
            .backend
            .spawn_terminal(profile, secrets, events, rows.max(1), cols.max(1))
            .await?;

        let mut sessions = self
            .terminal_sessions
            .lock()
            .map_err(|err| err.to_string())?;
        let running = !self
            .exited_terminal_sessions
            .lock()
            .map_err(|err| err.to_string())?
            .remove(&handle.session_id);
        let info = RemoteTerminalSessionInfo {
            id: handle.session_id.clone(),
            host_id: handle.host_id,
            workspace_id: workspace_id.to_string(),
            name: handle.name,
            running,
        };

        sessions.insert(handle.session_id.clone(), info.clone());

        Ok(info)
    }

    pub async fn write_ssh_terminal(&self, session_id: &str, data: &str) -> Result<(), String> {
        let running = self
            .terminal_sessions
            .lock()
            .map_err(|err| err.to_string())?
            .get(session_id)
            .map(|session| session.running)
            .ok_or_else(|| format!("terminal session not found: {session_id}"))?;
        if !running {
            return Err(format!("terminal session not running: {session_id}"));
        }

        self.backend.write_terminal(session_id, data).await
    }

    pub async fn close_ssh_terminal(
        &self,
        session_id: &str,
    ) -> Result<RemoteTerminalSessionInfo, String> {
        let session = {
            let mut sessions = self
                .terminal_sessions
                .lock()
                .map_err(|err| err.to_string())?;
            let session = sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| format!("terminal session not found: {session_id}"))?;
            if !session.running {
                let session = sessions
                    .remove(session_id)
                    .ok_or_else(|| format!("terminal session not found: {session_id}"))?;
                drop(sessions);
                self.exited_terminal_sessions
                    .lock()
                    .map_err(|err| err.to_string())?
                    .remove(session_id);
                return Ok(session);
            }
            session
        };

        let backend_info = self.backend.close_terminal(session_id).await?;
        let mut session = self
            .terminal_sessions
            .lock()
            .map_err(|err| err.to_string())?
            .remove(session_id)
            .unwrap_or(session);
        self.exited_terminal_sessions
            .lock()
            .map_err(|err| err.to_string())?
            .remove(session_id);
        session.name = if backend_info.name.is_empty() {
            session.name
        } else {
            backend_info.name
        };
        session.running = false;
        Ok(session)
    }

    pub async fn run_remote_command(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        command: &str,
    ) -> Result<RemoteCommandResult, String> {
        let command = command.trim();
        if command.is_empty() {
            return Err("remote command cannot be empty".to_string());
        }

        self.backend.run_command(profile, secrets, command).await
    }

    pub async fn list_sftp_directory(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        path: &str,
    ) -> Result<Vec<RemoteFileEntry>, String> {
        let normalized = normalize_remote_path(path)?;
        self.backend
            .list_sftp_directory(profile, secrets, &normalized)
            .await
    }

    pub async fn download_sftp_file(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        remote_path: &str,
        workspace_root: &Path,
        local_relative_path: &str,
    ) -> Result<RemoteTransferResult, String> {
        let normalized_remote = normalize_remote_path(remote_path)?;
        let local_path = crate::file_system::workspace_child_for_write(
            workspace_root,
            Path::new(local_relative_path),
        )?;
        self.backend
            .download_file(profile, secrets, &normalized_remote, &local_path)
            .await
    }

    pub async fn upload_sftp_file(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        workspace_root: &Path,
        local_relative_path: &str,
        remote_path: &str,
    ) -> Result<RemoteTransferResult, String> {
        let normalized_remote = normalize_remote_path(remote_path)?;
        let local_path = crate::file_system::workspace_child_for_existing_file(
            workspace_root,
            Path::new(local_relative_path),
        )?;
        self.backend
            .upload_file(profile, secrets, &local_path, &normalized_remote)
            .await
    }
}

impl Default for RemoteState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    pub(super) struct MemoryRemoteSecretStore {
        values: Arc<Mutex<HashMap<String, String>>>,
    }

    impl RemoteSecretStore for MemoryRemoteSecretStore {
        fn get_secret(&self, secret_id: &str) -> Result<String, String> {
            self.values
                .lock()
                .map_err(|err| err.to_string())?
                .get(secret_id)
                .cloned()
                .ok_or_else(|| format!("missing secret: {secret_id}"))
        }

        fn set_secret(&self, secret_id: &str, secret: &str) -> Result<(), String> {
            self.values
                .lock()
                .map_err(|err| err.to_string())?
                .insert(secret_id.to_string(), secret.to_string());
            Ok(())
        }

        fn delete_secret(&self, secret_id: &str) -> Result<(), String> {
            self.values
                .lock()
                .map_err(|err| err.to_string())?
                .remove(secret_id);
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct FailingDeleteRemoteSecretStore {
        values: Arc<Mutex<HashMap<String, String>>>,
        fail_delete: bool,
    }

    impl FailingDeleteRemoteSecretStore {
        fn with_fail_delete() -> Self {
            Self {
                values: Arc::new(Mutex::new(HashMap::new())),
                fail_delete: true,
            }
        }
    }

    impl RemoteSecretStore for FailingDeleteRemoteSecretStore {
        fn get_secret(&self, secret_id: &str) -> Result<String, String> {
            self.values
                .lock()
                .map_err(|err| err.to_string())?
                .get(secret_id)
                .cloned()
                .ok_or_else(|| format!("missing secret: {secret_id}"))
        }

        fn set_secret(&self, secret_id: &str, secret: &str) -> Result<(), String> {
            self.values
                .lock()
                .map_err(|err| err.to_string())?
                .insert(secret_id.to_string(), secret.to_string());
            Ok(())
        }

        fn delete_secret(&self, _secret_id: &str) -> Result<(), String> {
            if self.fail_delete {
                return Err("forced secret delete failure".to_string());
            }

            Ok(())
        }
    }

    fn remote_input(workspace_root: &str) -> RemoteHostProfileInput {
        RemoteHostProfileInput {
            id: Some("host-1".to_string()),
            workspace_root: workspace_root.to_string(),
            name: "edge-01".to_string(),
            host: "edge.example.com".to_string(),
            port: 22,
            username: "deploy".to_string(),
            auth_kind: RemoteAuthKind::Password,
            password: Some("super-secret".to_string()),
            key_path: None,
            key_passphrase: None,
            default_remote_path: "/var/www".to_string(),
            keepalive_seconds: 30,
            connect_timeout_seconds: 10,
        }
    }

    #[test]
    fn save_host_profile_stores_password_in_secret_store_only() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = RemoteHostProfileStore::new(temp.path().join("remote-hosts.json"));
        let secrets = MemoryRemoteSecretStore::default();

        let profile = store
            .save_profile(
                remote_input("/repo"),
                &secrets,
                || Ok(7),
                || "generated".to_string(),
            )
            .expect("save profile");

        assert_eq!(profile.id, "host-1");
        assert_eq!(profile.workspace_root, "/repo");
        assert_eq!(profile.default_remote_path, "/var/www");
        assert_eq!(profile.keepalive_seconds, 30);
        assert_eq!(profile.connect_timeout_seconds, 10);
        assert_eq!(
            profile.auth,
            RemoteAuthSource::Password {
                secret_id: "remote-host:host-1:password".to_string(),
            },
        );
        assert_eq!(
            secrets
                .get_secret("remote-host:host-1:password")
                .expect("secret"),
            "super-secret",
        );

        let persisted =
            std::fs::read_to_string(temp.path().join("remote-hosts.json")).expect("json");
        assert!(!persisted.contains("super-secret"));
        assert!(persisted.contains("remote-host:host-1:password"));
    }

    #[test]
    fn save_host_profile_rolls_back_new_secret_when_json_persist_fails() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = RemoteHostProfileStore::new(temp.path().to_path_buf());
        let secrets = MemoryRemoteSecretStore::default();

        let err = store
            .save_profile(
                remote_input("/repo"),
                &secrets,
                || Ok(7),
                || "generated".to_string(),
            )
            .expect_err("directory path cannot be overwritten by json");

        assert!(err.contains("Is a directory") || err.contains("directory"));
        assert!(secrets
            .get_secret("remote-host:host-1:password")
            .expect_err("secret rolled back")
            .contains("missing secret"),);
    }

    #[test]
    fn save_host_profile_password_to_agent_removes_old_secret() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = RemoteHostProfileStore::new(temp.path().join("remote-hosts.json"));
        let secrets = MemoryRemoteSecretStore::default();

        store
            .save_profile(
                remote_input("/repo"),
                &secrets,
                || Ok(7),
                || "generated".to_string(),
            )
            .expect("save profile");

        let mut input = remote_input("/repo");
        input.auth_kind = RemoteAuthKind::Agent;
        input.password = None;

        store
            .save_profile(input, &secrets, || Ok(8), || "generated".to_string())
            .expect("change auth");

        assert!(secrets.get_secret("remote-host:host-1:password").is_err());
    }

    #[test]
    fn save_host_profile_reports_error_when_restoring_new_secret_delete_fails() {
        let temp = tempfile::tempdir().expect("tempdir");
        let parent = temp.path().join("blocked-parent");
        std::fs::write(&parent, b"no-directory").expect("blocked directory");
        let store = RemoteHostProfileStore::new(parent.join("remote-hosts.json"));
        let secrets = FailingDeleteRemoteSecretStore::with_fail_delete();

        let err = store
            .save_profile(
                remote_input("/repo"),
                &secrets,
                || Ok(7),
                || "host-1".to_string(),
            )
            .expect_err("directory path cannot be overwritten by json");

        assert!(err.contains("forced secret delete failure"), "{err}");
        assert!(
            err.contains("File exists") || err.contains("directory"),
            "{}",
            err
        );
        assert_eq!(
            secrets
                .get_secret("remote-host:host-1:password")
                .expect("kept secret"),
            "super-secret",
        );
    }

    #[test]
    fn delete_host_profile_delays_secret_delete_until_json_is_durable() {
        let temp = tempfile::tempdir().expect("tempdir");
        let profile_path = temp.path().join("remote-hosts.json");
        let store = RemoteHostProfileStore::new(profile_path.clone());
        let secrets = MemoryRemoteSecretStore::default();
        store
            .save_profile(
                remote_input("/repo"),
                &secrets,
                || Ok(7),
                || "generated".to_string(),
            )
            .expect("save profile");
        std::fs::remove_file(&profile_path).expect("remove json file");
        std::fs::create_dir(&profile_path).expect("make json path a directory");

        let err = store
            .delete_profile("host-1", &secrets)
            .expect_err("json persist fails");

        assert!(err.contains("Is a directory") || err.contains("directory"));
        assert_eq!(
            secrets
                .get_secret("remote-host:host-1:password")
                .expect("secret retained"),
            "super-secret",
        );
    }

    #[test]
    fn list_profiles_is_workspace_scoped_and_sorted() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = RemoteHostProfileStore::new(temp.path().join("remote-hosts.json"));
        let secrets = MemoryRemoteSecretStore::default();
        let mut alpha = remote_input("/repo-a");
        alpha.id = Some("host-alpha".to_string());
        alpha.name = "alpha".to_string();
        let mut zeta = remote_input("/repo-a");
        zeta.id = Some("host-zeta".to_string());
        zeta.name = "zeta".to_string();
        let mut other = remote_input("/repo-b");
        other.id = Some("host-other".to_string());
        other.name = "other".to_string();

        store
            .save_profile(zeta, &secrets, || Ok(1), || "z".to_string())
            .expect("zeta");
        store
            .save_profile(other, &secrets, || Ok(2), || "o".to_string())
            .expect("other");
        store
            .save_profile(alpha, &secrets, || Ok(3), || "a".to_string())
            .expect("alpha");

        let profiles = store.list_profiles("/repo-a").expect("list");

        assert_eq!(
            profiles
                .iter()
                .map(|profile| profile.id.as_str())
                .collect::<Vec<_>>(),
            vec!["host-alpha", "host-zeta"]
        );
    }

    #[test]
    fn normalize_remote_path_rejects_nul_and_collapses_segments() {
        assert_eq!(
            normalize_remote_path("/var/www/../log/./app").expect("path"),
            "/var/log/app"
        );
        assert_eq!(
            normalize_remote_path("deploy/releases").expect("relative"),
            "deploy/releases"
        );
        assert_eq!(
            normalize_remote_path("/../../etc").expect("root clamp"),
            "/etc"
        );
        assert!(normalize_remote_path("/tmp/\0bad")
            .expect_err("nul")
            .contains("NUL"));
    }

    #[test]
    fn save_host_profile_rejects_ambiguous_host_values() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = RemoteHostProfileStore::new(temp.path().join("remote-hosts.json"));
        let secrets = MemoryRemoteSecretStore::default();
        for host in [
            "ssh://edge.example.com",
            "deploy@edge.example.com",
            "edge.example.com/path",
            "edge example",
        ] {
            let mut input = remote_input("/repo");
            input.host = host.to_string();
            let err = store
                .save_profile(input, &secrets, || Ok(7), || "generated".to_string())
                .expect_err("invalid host");
            assert!(err.contains("SSH host must be a bare hostname or IP address"));
        }
    }
}

#[cfg(test)]
mod runtime_tests {
    use super::*;
    use russh::client::Handler as _;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MockRemoteBackend {
        connected: Mutex<Vec<String>>,
        written: Mutex<Vec<(String, String)>>,
    }

    #[async_trait::async_trait]
    impl RemoteBackend for MockRemoteBackend {
        async fn connect(
            &self,
            profile: &RemoteHostProfile,
            _secrets: &dyn RemoteSecretStore,
        ) -> Result<RemoteConnectionSnapshot, String> {
            self.connected
                .lock()
                .map_err(|err| err.to_string())?
                .push(profile.id.clone());
            Ok(RemoteConnectionSnapshot {
                host_id: profile.id.clone(),
                status: RemoteConnectionStatus::Connected,
                message: None,
                checked_ms: 99,
            })
        }

        async fn disconnect(&self, host_id: &str) -> Result<RemoteConnectionSnapshot, String> {
            Ok(RemoteConnectionSnapshot {
                host_id: host_id.to_string(),
                status: RemoteConnectionStatus::Disconnected,
                message: None,
                checked_ms: 100,
            })
        }

        async fn spawn_terminal(
            &self,
            profile: &RemoteHostProfile,
            _secrets: &dyn RemoteSecretStore,
            _events: std::sync::Arc<dyn RemoteTerminalEventSink>,
            _rows: u16,
            _cols: u16,
        ) -> Result<RemoteTerminalHandle, String> {
            Ok(RemoteTerminalHandle {
                session_id: format!("{}:ssh-1", profile.id),
                host_id: profile.id.clone(),
                name: format!("{}@{}", profile.username, profile.host),
            })
        }

        async fn write_terminal(&self, session_id: &str, data: &str) -> Result<(), String> {
            self.written
                .lock()
                .map_err(|err| err.to_string())?
                .push((session_id.to_string(), data.to_string()));
            Ok(())
        }

        async fn close_terminal(
            &self,
            session_id: &str,
        ) -> Result<RemoteTerminalSessionInfo, String> {
            Ok(RemoteTerminalSessionInfo {
                id: session_id.to_string(),
                host_id: "host-1".to_string(),
                workspace_id: "workspace".to_string(),
                name: "deploy@edge.example.com".to_string(),
                running: false,
            })
        }

        async fn run_command(
            &self,
            profile: &RemoteHostProfile,
            _secrets: &dyn RemoteSecretStore,
            command: &str,
        ) -> Result<RemoteCommandResult, String> {
            Ok(RemoteCommandResult {
                host_id: profile.id.clone(),
                command: command.to_string(),
                stdout: "ok\n".to_string(),
                stderr: String::new(),
                exit_code: Some(0),
                duration_ms: 3,
            })
        }

        async fn list_sftp_directory(
            &self,
            profile: &RemoteHostProfile,
            _secrets: &dyn RemoteSecretStore,
            path: &str,
        ) -> Result<Vec<RemoteFileEntry>, String> {
            Ok(vec![RemoteFileEntry {
                host_id: profile.id.clone(),
                path: format!("{path}/app.js"),
                name: "app.js".to_string(),
                kind: RemoteFileKind::File,
                size: Some(42),
                modified_ms: None,
                link_target: None,
            }])
        }

        async fn download_file(
            &self,
            _profile: &RemoteHostProfile,
            _secrets: &dyn RemoteSecretStore,
            remote_path: &str,
            local_path: &Path,
        ) -> Result<RemoteTransferResult, String> {
            Ok(RemoteTransferResult {
                remote_path: remote_path.to_string(),
                local_path: local_path.to_path_buf(),
                bytes: 42,
            })
        }

        async fn upload_file(
            &self,
            _profile: &RemoteHostProfile,
            _secrets: &dyn RemoteSecretStore,
            local_path: &Path,
            remote_path: &str,
        ) -> Result<RemoteTransferResult, String> {
            Ok(RemoteTransferResult {
                remote_path: remote_path.to_string(),
                local_path: local_path.to_path_buf(),
                bytes: 42,
            })
        }
    }

    #[derive(Default)]
    struct ExitCapturingBackend {
        events: Mutex<Option<Arc<dyn RemoteTerminalEventSink>>>,
        written: Mutex<Vec<(String, String)>>,
        close_missing: bool,
    }

    #[async_trait::async_trait]
    impl RemoteBackend for ExitCapturingBackend {
        async fn connect(
            &self,
            profile: &RemoteHostProfile,
            _secrets: &dyn RemoteSecretStore,
        ) -> Result<RemoteConnectionSnapshot, String> {
            Ok(RemoteConnectionSnapshot {
                host_id: profile.id.clone(),
                status: RemoteConnectionStatus::Connected,
                message: None,
                checked_ms: 99,
            })
        }

        async fn spawn_terminal(
            &self,
            profile: &RemoteHostProfile,
            _secrets: &dyn RemoteSecretStore,
            events: Arc<dyn RemoteTerminalEventSink>,
            _rows: u16,
            _cols: u16,
        ) -> Result<RemoteTerminalHandle, String> {
            self.events
                .lock()
                .map_err(|err| err.to_string())?
                .replace(events);
            Ok(RemoteTerminalHandle {
                session_id: format!("{}:ssh-1", profile.id),
                host_id: profile.id.clone(),
                name: format!("{}@{}", profile.username, profile.host),
            })
        }

        async fn write_terminal(&self, session_id: &str, data: &str) -> Result<(), String> {
            self.written
                .lock()
                .map_err(|err| err.to_string())?
                .push((session_id.to_string(), data.to_string()));
            Ok(())
        }

        async fn close_terminal(
            &self,
            session_id: &str,
        ) -> Result<RemoteTerminalSessionInfo, String> {
            if self.close_missing {
                return Err(format!("terminal session not found: {session_id}"));
            }

            Ok(RemoteTerminalSessionInfo {
                id: session_id.to_string(),
                host_id: "host-1".to_string(),
                workspace_id: String::new(),
                name: "deploy@edge.example.com".to_string(),
                running: false,
            })
        }
    }

    fn known_hosts_test_key() -> keys::ssh_key::PublicKey {
        keys::parse_public_key_base64(
            "AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ",
        )
        .expect("test public key")
    }

    fn profile() -> RemoteHostProfile {
        RemoteHostProfile {
            id: "host-1".to_string(),
            workspace_root: "/repo".to_string(),
            name: "edge".to_string(),
            host: "edge.example.com".to_string(),
            port: 22,
            username: "deploy".to_string(),
            auth: RemoteAuthSource::Agent,
            default_remote_path: "/var/www".to_string(),
            keepalive_seconds: 30,
            connect_timeout_seconds: 10,
            created_ms: 1,
            updated_ms: 1,
        }
    }

    #[tokio::test]
    async fn unknown_server_key_is_rejected_by_default() {
        let temp = tempfile::tempdir().expect("known hosts dir");
        let mut client =
            RusshClient::with_known_hosts_path("edge.example.com", 22, temp.path().join("missing"));

        let accepted = client
            .check_server_key(&known_hosts_test_key())
            .await
            .expect("host key check");

        assert!(!accepted, "unknown SSH server keys must be rejected");
    }

    #[tokio::test]
    async fn changed_known_hosts_key_is_rejected() {
        let temp = tempfile::tempdir().expect("known hosts dir");
        let known_hosts_path = temp.path().join("known_hosts");
        std::fs::write(
            &known_hosts_path,
            "edge.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA6rWI3G2sz07DnfFlrouTcysQlj2P+jpNSOEWD9OJ3X\n",
        )
        .expect("known hosts");
        let mut client =
            RusshClient::with_known_hosts_path("edge.example.com", 22, known_hosts_path);

        let err = client
            .check_server_key(&known_hosts_test_key())
            .await
            .expect_err("changed host key");

        assert!(err.to_string().contains("server key changed"), "{err}");
    }

    #[tokio::test]
    async fn known_hosts_path_accepts_matching_server_key() {
        let temp = tempfile::tempdir().expect("known hosts dir");
        let known_hosts_path = temp.path().join("known_hosts");
        std::fs::write(
            &known_hosts_path,
            "edge.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ\n",
        )
        .expect("known hosts");
        let mut client =
            RusshClient::with_known_hosts_path("edge.example.com", 22, known_hosts_path);

        let accepted = client
            .check_server_key(&known_hosts_test_key())
            .await
            .expect("host key check");

        assert!(accepted, "matching known_hosts entries should be accepted");
    }

    #[test]
    fn russh_client_config_does_not_map_connect_timeout_to_inactivity_timeout() {
        let config = russh_client_config(&profile());

        assert_eq!(config.inactivity_timeout, None);
        assert_eq!(
            config.keepalive_interval,
            Some(Duration::from_secs(profile().keepalive_seconds)),
        );
    }

    #[tokio::test]
    async fn remote_state_records_connection_failure_as_visible_health() {
        struct FailingBackend;

        #[async_trait::async_trait]
        impl RemoteBackend for FailingBackend {
            async fn connect(
                &self,
                profile: &RemoteHostProfile,
                _secrets: &dyn RemoteSecretStore,
            ) -> Result<RemoteConnectionSnapshot, String> {
                Err(format!("{} refused connection", profile.host))
            }
        }

        let state = RemoteState::new_with_backend(Arc::new(FailingBackend));
        let secrets = super::tests::MemoryRemoteSecretStore::default();

        let err = state
            .connect_host(&profile(), &secrets)
            .await
            .expect_err("connect error");
        let health = state.connection_snapshot("host-1").expect("snapshot");

        assert!(err.contains("refused connection"));
        assert_eq!(health.status, RemoteConnectionStatus::Failed);
        assert_eq!(
            health.message.as_deref(),
            Some("edge.example.com refused connection"),
        );
    }

    #[tokio::test]
    async fn agent_auth_unavailable_is_recorded_as_visible_health() {
        let state = RemoteState::new_with_backend(Arc::new(RusshRemoteBackend::new()));
        let secrets = super::tests::MemoryRemoteSecretStore::default();

        let err = state
            .connect_host(&profile(), &secrets)
            .await
            .expect_err("agent auth unavailable");
        let health = state.connection_snapshot("host-1").expect("snapshot");

        assert_eq!(err, SSH_AGENT_UNAVAILABLE_MESSAGE);
        assert_eq!(health.status, RemoteConnectionStatus::Failed);
        assert_eq!(
            health.message.as_deref(),
            Some(SSH_AGENT_UNAVAILABLE_MESSAGE)
        );
    }

    #[tokio::test]
    async fn spawn_ssh_terminal_registers_workspace_scoped_session() {
        let state = RemoteState::new_with_backend(Arc::new(MockRemoteBackend::default()));
        let secrets = super::tests::MemoryRemoteSecretStore::default();
        let session = state
            .spawn_ssh_terminal(
                "workspace",
                &profile(),
                &secrets,
                Arc::new(NoopRemoteTerminalEventSink),
                24,
                80,
            )
            .await
            .expect("spawn");

        assert_eq!(session.id, "host-1:ssh-1");
        assert_eq!(session.workspace_id, "workspace");
        assert_eq!(session.host_id, "host-1");
        assert_eq!(
            state
                .list_ssh_terminal_sessions("workspace")
                .expect("list")
                .len(),
            1,
        );
    }

    #[tokio::test]
    async fn write_ssh_terminal_rejects_unregistered_session_before_backend_write() {
        let backend = Arc::new(MockRemoteBackend::default());
        let state = RemoteState::new_with_backend(backend.clone());

        let err = state
            .write_ssh_terminal("missing-session", "ls\n")
            .await
            .expect_err("unregistered session");

        assert!(err.contains("terminal session not found"));
        assert!(
            backend.written.lock().expect("written").is_empty(),
            "unregistered writes should not reach backend"
        );
    }

    #[tokio::test]
    async fn terminal_exit_sink_marks_session_stopped_before_backend_write() {
        let backend = Arc::new(ExitCapturingBackend::default());
        let state = RemoteState::new_with_backend(backend.clone());
        let secrets = super::tests::MemoryRemoteSecretStore::default();
        let session = state
            .spawn_ssh_terminal(
                "workspace",
                &profile(),
                &secrets,
                Arc::new(NoopRemoteTerminalEventSink),
                24,
                80,
            )
            .await
            .expect("spawn");
        let events = backend
            .events
            .lock()
            .expect("events")
            .as_ref()
            .expect("captured event sink")
            .clone();

        events.emit_exit(RemoteTerminalExitEvent {
            session_id: session.id.clone(),
            exit_code: Some(0),
        });

        let sessions = state
            .list_ssh_terminal_sessions("workspace")
            .expect("sessions");
        assert!(
            sessions
                .iter()
                .any(|item| item.id == session.id && !item.running),
            "exited sessions should be visible as stopped"
        );
        let err = state
            .write_ssh_terminal(&session.id, "ls\n")
            .await
            .expect_err("stopped session");

        assert!(err.contains("terminal session not running"), "{err}");
        assert!(
            backend.written.lock().expect("written").is_empty(),
            "stopped sessions should not write through to the backend"
        );
    }

    #[tokio::test]
    async fn close_ssh_terminal_removes_stopped_session_without_backend_writer() {
        let backend = Arc::new(ExitCapturingBackend {
            close_missing: true,
            ..ExitCapturingBackend::default()
        });
        let state = RemoteState::new_with_backend(backend.clone());
        let secrets = super::tests::MemoryRemoteSecretStore::default();
        let session = state
            .spawn_ssh_terminal(
                "workspace",
                &profile(),
                &secrets,
                Arc::new(NoopRemoteTerminalEventSink),
                24,
                80,
            )
            .await
            .expect("spawn");
        let events = backend
            .events
            .lock()
            .expect("events")
            .as_ref()
            .expect("captured event sink")
            .clone();
        events.emit_exit(RemoteTerminalExitEvent {
            session_id: session.id.clone(),
            exit_code: Some(0),
        });

        let closed = state
            .close_ssh_terminal(&session.id)
            .await
            .expect("close stopped session");

        assert_eq!(closed.id, session.id);
        assert!(!closed.running);
        assert!(
            state
                .list_ssh_terminal_sessions("workspace")
                .expect("sessions")
                .is_empty(),
            "closed stopped session should be removed from state"
        );
    }

    #[tokio::test]
    async fn close_ssh_terminal_keeps_running_session_when_backend_close_fails() {
        let backend = Arc::new(ExitCapturingBackend {
            close_missing: true,
            ..ExitCapturingBackend::default()
        });
        let state = RemoteState::new_with_backend(backend);
        let secrets = super::tests::MemoryRemoteSecretStore::default();
        let session = state
            .spawn_ssh_terminal(
                "workspace",
                &profile(),
                &secrets,
                Arc::new(NoopRemoteTerminalEventSink),
                24,
                80,
            )
            .await
            .expect("spawn");

        let err = state
            .close_ssh_terminal(&session.id)
            .await
            .expect_err("backend close failure");

        assert!(err.contains("terminal session not found"), "{err}");
        let sessions = state
            .list_ssh_terminal_sessions("workspace")
            .expect("sessions");
        assert!(
            sessions
                .iter()
                .any(|item| item.id == session.id && item.running),
            "running session should remain in state after backend close failure"
        );
    }

    #[tokio::test]
    async fn sftp_download_and_upload_are_limited_to_registered_workspace_children() {
        let workspace = tempfile::tempdir().expect("workspace");
        let local_file = workspace.path().join("dist/app.js");
        std::fs::create_dir_all(local_file.parent().expect("parent")).expect("mkdir");
        std::fs::write(&local_file, "console.log('ok')").expect("write");
        let state = RemoteState::new_with_backend(Arc::new(MockRemoteBackend::default()));
        let secrets = super::tests::MemoryRemoteSecretStore::default();

        let download = state
            .download_sftp_file(
                &profile(),
                &secrets,
                "/var/www/app.js",
                workspace.path(),
                "downloads/app.js",
            )
            .await
            .expect("download");
        let upload = state
            .upload_sftp_file(
                &profile(),
                &secrets,
                workspace.path(),
                "dist/app.js",
                "/var/www/app.js",
            )
            .await
            .expect("upload");
        let rejected = state
            .upload_sftp_file(
                &profile(),
                &secrets,
                workspace.path(),
                "../secret.txt",
                "/tmp/secret.txt",
            )
            .await
            .expect_err("outside workspace");

        assert!(download.local_path.ends_with("downloads/app.js"));
        assert_eq!(upload.remote_path, "/var/www/app.js");
        assert!(rejected.contains("outside workspace"));
    }
}
