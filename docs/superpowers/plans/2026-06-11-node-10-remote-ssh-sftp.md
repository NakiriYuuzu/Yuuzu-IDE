# Node 10 Remote SSH And SFTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Node 10 so a registered workspace can save SSH host profiles, open SSH terminal sessions, browse and transfer files over SFTP, run remote commands, and recover from visible connection failures.

**Architecture:** Rust owns SSH/SFTP sessions, credentials, workspace-root validation, remote command execution, transfer paths, and connection health. React owns only presentation, command invocation, and bounded view state; it never stores raw secrets or remote stream handles. The frontend follows `docs/ui-design/panels.jsx`, `docs/ui-design/app.jsx`, `docs/ui-design/scenes.jsx`, and `docs/ui-design/data.jsx` for the compact Remote panel and SSH terminal surface.

**Tech Stack:** Tauri 2 commands/events, Rust `russh 0.61.2`, `russh-sftp 2.3.0`, `async-trait 0.1.89`, current `tokio 1.52.3` with explicit `io-util`/`sync` features, React 19.2.7, lucide-react 1.17.0, existing lazy xterm surface, TanStack Virtual 3.14.2 for SFTP lists, Bun test, Cargo test/fmt/clippy.

---

## Operating Contract

- Implement in roadmap order after Node 9.
- Development subagents must use `gpt-5.3-codex-spark` with `xhigh`.
- Spec-compliance and code-quality review subagents must use `gpt-5.5` with `xhigh`.
- `gpt-5.4` is not allowed for any subagent.
- Every task that changes behavior must record RED, GREEN, and REFACTOR evidence in the task result.
- Use `docs/ui-design/` as the frontend source of truth.
- Use latest dependency versions verified on 2026-06-11:
  - `russh = "0.61.2"`
  - `russh-sftp = "2.3.0"`
  - `async-trait = "0.1.89"`
  - `tokio = "1.52.3"` remains latest; only make the needed features explicit.
- Commit after each verified task or coherent milestone inside `/Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide`.

## File Structure

- Modify `src-tauri/Cargo.toml`: add SSH/SFTP crates and explicit tokio features.
- Create `src-tauri/src/remote.rs`: remote host profiles, secret storage, path validation, connection/session registries, SSH/SFTP backend trait, russh adapter, and tests.
- Modify `src-tauri/src/commands.rs`: add remote profile/runtime command wrappers and workspace-root checks.
- Modify `src-tauri/src/lib.rs`: expose `remote` module, manage `remote::RemoteState`, and register commands.
- Create `src/features/remote/remote-model.ts`: remote view state, reducers, bounded terminal/command output, transfer state.
- Create `src/features/remote/remote-model.test.ts`: reducer tests.
- Create `src/features/remote/remote-api.ts`: Tauri command and event wrappers.
- Create `src/features/remote/RemotePanel.tsx`: compact SSH/SFTP panel from UI design.
- Create `src/features/remote/RemotePanel.test.tsx`: panel tests.
- Create `src/features/remote/SftpBrowser.tsx`: virtualized remote file list and transfer actions.
- Create `src/features/remote/SshTerminalSurface.tsx`: SSH terminal tabs using the existing `TerminalTab`.
- Create `src/features/remote/RemoteCommandPanel.tsx`: remote command runner and result list.
- Modify `src/app/activity-rail.tsx`: add Remote activity with `Server` icon.
- Modify `src/app/command-palette-model.ts`: add Node 10 commands.
- Modify `src/app/workspace-view-state.ts`: add remote state and remote surfaces.
- Modify `src/app/AppShell.tsx`: load remote state, subscribe to remote events, wire Remote panel, SSH terminal surface, SFTP surface, command palette commands, and breadcrumbs.
- Modify `src/styles/ide.css`: compact Remote panel, SFTP rows, SSH status/health badges, transfer status styles.
- Modify tests: `src/app/activity-rail.test.tsx`, `src/app/command-palette-model.test.ts`, `src/app/workspace-view-state.test.ts`, `src/app/AppShell.contract.test.tsx`.
- Create `docs/architecture/node-10-remote-results.md`: final verification record.
- Modify `docs/architecture/progress.md` and `roadmap.md`: mark Node 10 complete after full verification.

## Dependency Installation

Run this in Task 1 after the failing dependency test is written:

```bash
. "$HOME/.cargo/env"
cargo add russh@0.61.2 russh-sftp@2.3.0 async-trait@0.1.89 --manifest-path src-tauri/Cargo.toml
cargo add tokio@1.52.3 --features rt,time,net,macros,io-util,sync --manifest-path src-tauri/Cargo.toml
```

Expected `src-tauri/Cargo.toml` dependency shape after installation:

```toml
async-trait = "0.1.89"
russh = "0.61.2"
russh-sftp = "2.3.0"
tokio = { version = "1.52.3", features = ["rt", "time", "net", "macros", "io-util", "sync"] }
```

---

### Task 1: Rust Remote Profiles, Secrets, And Path Guards

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/remote.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/database.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/remote.rs`

- [ ] **Step 1: Write failing Rust tests for profile persistence and remote path guards**

Add this test module to the bottom of the new `src-tauri/src/remote.rs` file before implementing the types:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct MemoryRemoteSecretStore {
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
            .save_profile(remote_input("/repo"), &secrets, || Ok(7), || "generated".to_string())
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
            .save_profile(remote_input("/repo"), &secrets, || Ok(7), || "generated".to_string())
            .expect_err("directory path cannot be overwritten by json");

        assert!(err.contains("Is a directory") || err.contains("directory"));
        assert!(
            secrets
                .get_secret("remote-host:host-1:password")
                .expect_err("secret rolled back")
                .contains("missing secret"),
        );
    }

    #[test]
    fn delete_host_profile_delays_secret_delete_until_json_is_durable() {
        let temp = tempfile::tempdir().expect("tempdir");
        let profile_path = temp.path().join("remote-hosts.json");
        let store = RemoteHostProfileStore::new(profile_path.clone());
        let secrets = MemoryRemoteSecretStore::default();
        store
            .save_profile(remote_input("/repo"), &secrets, || Ok(7), || "generated".to_string())
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

        store.save_profile(zeta, &secrets, || Ok(1), || "z".to_string()).expect("zeta");
        store.save_profile(other, &secrets, || Ok(2), || "o".to_string()).expect("other");
        store.save_profile(alpha, &secrets, || Ok(3), || "a".to_string()).expect("alpha");

        let profiles = store.list_profiles("/repo-a").expect("list");

        assert_eq!(
            profiles.iter().map(|profile| profile.id.as_str()).collect::<Vec<_>>(),
            vec!["host-alpha", "host-zeta"],
        );
    }

    #[test]
    fn normalize_remote_path_rejects_nul_and_collapses_segments() {
        assert_eq!(normalize_remote_path("/var/www/../log/./app").expect("path"), "/var/log/app");
        assert_eq!(normalize_remote_path("deploy/releases").expect("relative"), "deploy/releases");
        assert_eq!(normalize_remote_path("/../../etc").expect("root clamp"), "/etc");
        assert!(normalize_remote_path("/tmp/\0bad").expect_err("nul").contains("NUL"));
    }

    #[test]
    fn save_host_profile_rejects_ambiguous_host_values() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = RemoteHostProfileStore::new(temp.path().join("remote-hosts.json"));
        let secrets = MemoryRemoteSecretStore::default();
        for host in ["ssh://edge.example.com", "deploy@edge.example.com", "edge.example.com/path", "edge example"] {
            let mut input = remote_input("/repo");
            input.host = host.to_string();
            let err = store
                .save_profile(input, &secrets, || Ok(7), || "generated".to_string())
                .expect_err("invalid host");
            assert!(err.contains("SSH host must be a bare hostname or IP address"));
        }
    }
}
```

- [ ] **Step 2: Run the focused Rust test to verify RED**

Run:

```bash
. "$HOME/.cargo/env"
cargo test --manifest-path src-tauri/Cargo.toml remote::tests::save_host_profile_stores_password_in_secret_store_only
```

Expected: FAIL with unresolved items such as `RemoteSecretStore`, `RemoteHostProfileInput`, `RemoteAuthKind`, or `RemoteHostProfileStore`.

- [ ] **Step 3: Install latest Rust dependencies**

Run:

```bash
. "$HOME/.cargo/env"
cargo add russh@0.61.2 russh-sftp@2.3.0 async-trait@0.1.89 --manifest-path src-tauri/Cargo.toml
cargo add tokio@1.52.3 --features rt,time,net,macros,io-util,sync --manifest-path src-tauri/Cargo.toml
```

Expected: `src-tauri/Cargo.toml` contains `russh = "0.61.2"`, `russh-sftp = "2.3.0"`, `async-trait = "0.1.89"`, and `tokio` still at `1.52.3` with explicit `io-util` and `sync`.

- [ ] **Step 4: Implement the minimal remote profile store and path guards**

In `src-tauri/src/database.rs`, change the non-test helper visibility so the remote keyring store can reuse the existing macOS default-store guard:

```rust
pub(crate) fn ensure_keyring_default_store() -> Result<(), String> {
```

Create `src-tauri/src/remote.rs` with these concrete public types and functions:

```rust
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub enum RemoteAuthKind {
    Password,
    Key,
    Agent,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub enum RemoteAuthSource {
    Password { secret_id: String },
    Key {
        key_path: PathBuf,
        passphrase_secret_id: Option<String>,
    },
    Agent,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
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
        entry.get_password().map_err(|err| err.to_string())
    }

    fn set_secret(&self, secret_id: &str, secret: &str) -> Result<(), String> {
        crate::database::ensure_keyring_default_store()?;
        let entry = Entry::new(&self.service, secret_id).map_err(|err| err.to_string())?;
        entry.set_password(secret).map_err(|err| err.to_string())
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
        profiles.sort_by(|left, right| left.name.cmp(&right.name).then_with(|| left.id.cmp(&right.id)));
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
        let profile_id = input.id.clone().unwrap_or_else(id_factory);
        let previous = profiles.iter().find(|profile| profile.id == profile_id).cloned();
        let previous_secret_ids = previous
            .as_ref()
            .map(remote_secret_ids)
            .unwrap_or_default();
        let previous_secret_values = read_existing_remote_secrets(&previous_secret_ids, secrets)?;
        let mut changed_secret_ids = Vec::new();

        let auth = match input.auth_kind {
            RemoteAuthKind::Password => {
                let secret_id = format!("remote-host:{profile_id}:password");
                if let Some(password) = input.password.as_deref() {
                    secrets.set_secret(&secret_id, password)?;
                    changed_secret_ids.push(secret_id.clone());
                }
                RemoteAuthSource::Password { secret_id }
            }
            RemoteAuthKind::Key => {
                let key_path = PathBuf::from(
                    input
                        .key_path
                        .clone()
                        .ok_or_else(|| "SSH key path is required".to_string())?,
                );
                let passphrase_secret_id = if let Some(passphrase) = input.key_passphrase.as_deref() {
                    let secret_id = format!("remote-host:{profile_id}:key-passphrase");
                    secrets.set_secret(&secret_id, passphrase)?;
                    changed_secret_ids.push(secret_id.clone());
                    Some(secret_id)
                } else {
                    previous
                        .as_ref()
                        .and_then(|profile| match &profile.auth {
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
            restore_remote_secrets(&previous_secret_values, &changed_secret_ids, secrets, save_error)?;
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
        if let Some(parent) = self.path.parent().filter(|path| !path.as_os_str().is_empty()) {
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
        fs::rename(&temp_path, &self.path).map_err(|err| err.to_string())
    }
}

pub fn remote_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
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
        Ok(".".to_string())
    } else {
        Ok(joined)
    }
}
```

Add helper functions below that snippet in the same file:

```rust
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
        RemoteAuthKind::Password if input.password.as_deref().unwrap_or("").is_empty() && input.id.is_none() => {
            Err("SSH password is required for new password profiles".to_string())
        }
        RemoteAuthKind::Key if input.key_path.as_deref().unwrap_or("").trim().is_empty() => {
            Err("SSH key path is required".to_string())
        }
        _ => Ok(()),
    }
}

fn validate_ssh_host(host: &str) -> Result<(), String> {
    let trimmed = host.trim();
    let invalid = trimmed.is_empty()
        || trimmed.contains("://")
        || trimmed.contains('@')
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.chars().any(char::is_whitespace);
    if invalid {
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
    for secret_id in changed_secret_ids {
        if let Some(previous_value) = previous_secret_values.get(secret_id) {
            secrets.set_secret(secret_id, previous_value)?;
        } else {
            let _ = secrets.delete_secret(secret_id);
        }
    }
    Err(save_error)
}
```

- [ ] **Step 5: Register the remote module and profile store shell**

Modify `src-tauri/src/lib.rs`:

```rust
pub mod remote;
```

Add a managed runtime state in setup:

```rust
app.manage(remote::RemoteState::new());
```

The `RemoteState::new()` symbol will compile after Task 2. For Task 1, add this minimal struct to `src-tauri/src/remote.rs` so module registration compiles:

```rust
pub struct RemoteState;

impl RemoteState {
    pub fn new() -> Self {
        Self
    }
}
```

Modify `src-tauri/src/commands.rs` `AppState`:

```rust
remote_profiles: crate::remote::RemoteHostProfileStore,
remote_secrets: crate::remote::KeyringRemoteSecretStore,
```

Initialize these fields in `AppState::new`:

```rust
let remote_profiles =
    crate::remote::RemoteHostProfileStore::new(config_dir.as_ref().join("remote-hosts.json"));
let remote_secrets = crate::remote::KeyringRemoteSecretStore::new("yuuzu-ide.remote");
```

Add the fields to the returned `Self`.

Add methods on `impl AppState`:

```rust
pub fn list_remote_hosts(
    &self,
    workspace_root: &str,
) -> Result<Vec<crate::remote::RemoteHostProfile>, String> {
    let workspace_root = self.trusted_workspace_root(workspace_root)?;
    self.remote_profiles
        .list_profiles(&workspace_root.to_string_lossy())
}

pub fn save_remote_host(
    &self,
    input: crate::remote::RemoteHostProfileInput,
) -> Result<crate::remote::RemoteHostProfile, String> {
    let workspace_root = self.trusted_workspace_root(&input.workspace_root)?;
    if let Some(profile_id) = input.id.as_deref() {
        if let Ok(profile) = self.remote_profiles.get_profile(profile_id) {
            if profile.workspace_root != workspace_root.to_string_lossy() {
                return Err("remote host profile does not belong to workspace".to_string());
            }
        }
    }

    self.remote_profiles.save_profile(
        crate::remote::RemoteHostProfileInput {
            workspace_root: workspace_root.to_string_lossy().to_string(),
            ..input
        },
        &self.remote_secrets,
        || Ok(crate::remote::remote_now_ms()),
        crate::remote::new_remote_host_id,
    )
}

pub fn delete_remote_host(&self, workspace_root: &str, profile_id: &str) -> Result<(), String> {
    let workspace_root = self.trusted_workspace_root(workspace_root)?;
    let profile = self.remote_profiles.get_profile(profile_id)?;
    if profile.workspace_root != workspace_root.to_string_lossy() {
        return Err("remote host profile does not belong to workspace".to_string());
    }
    self.remote_profiles
        .delete_profile(profile_id, &self.remote_secrets)
}

pub fn remote_host_in_active_workspace(
    &self,
    profile_id: &str,
) -> Result<crate::remote::RemoteHostProfile, String> {
    self.remote_profiles.get_profile(profile_id)
}
```

Add Tauri command wrappers:

```rust
#[tauri::command]
pub fn list_remote_hosts(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<crate::remote::RemoteHostProfile>, String> {
    state.list_remote_hosts(&workspace_root)
}

#[tauri::command]
pub fn save_remote_host(
    state: State<'_, AppState>,
    input: crate::remote::RemoteHostProfileInput,
) -> Result<crate::remote::RemoteHostProfile, String> {
    state.save_remote_host(input)
}

#[tauri::command]
pub fn delete_remote_host(
    state: State<'_, AppState>,
    workspace_root: String,
    profile_id: String,
) -> Result<(), String> {
    state.delete_remote_host(&workspace_root, &profile_id)
}
```

Register these in `tauri::generate_handler!` in `src-tauri/src/lib.rs`:

```rust
commands::list_remote_hosts,
commands::save_remote_host,
commands::delete_remote_host,
```

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```bash
. "$HOME/.cargo/env"
cargo test --manifest-path src-tauri/Cargo.toml remote::tests
cargo test --manifest-path src-tauri/Cargo.toml commands::tests::delete_remote_host_rejects_profile_outside_workspace_root
```

Expected: first command PASS. The second command may be absent until the next step; if absent, add the command tests in Step 7 before running it.

- [ ] **Step 7: Add command workspace-scope tests**

Add these tests inside `src-tauri/src/commands.rs` `mod tests`:

```rust
#[test]
fn list_remote_hosts_preserves_flat_command_signature() {
    fn assert_flat_signature(
        _command: fn(
            State<'_, AppState>,
            String,
        ) -> Result<Vec<crate::remote::RemoteHostProfile>, String>,
    ) {
    }

    assert_flat_signature(super::list_remote_hosts);
}

#[test]
fn save_remote_host_preserves_flat_command_signature() {
    fn assert_flat_signature(
        _command: fn(
            State<'_, AppState>,
            crate::remote::RemoteHostProfileInput,
        ) -> Result<crate::remote::RemoteHostProfile, String>,
    ) {
    }

    assert_flat_signature(super::save_remote_host);
}

#[test]
fn delete_remote_host_preserves_flat_command_signature() {
    fn assert_flat_signature(_command: fn(State<'_, AppState>, String, String) -> Result<(), String>) {}

    assert_flat_signature(super::delete_remote_host);
}

#[test]
fn delete_remote_host_rejects_unregistered_workspace_root() {
    let config = tempfile::tempdir().expect("config");
    let state = AppState::new(config.path()).expect("state");

    let result = state.delete_remote_host("/not/registered", "missing");

    assert!(result.expect_err("reject").contains("workspace not registered"));
}

#[test]
fn delete_remote_host_rejects_profile_outside_workspace_root() {
    let config = tempfile::tempdir().expect("config");
    let workspace_a = tempfile::tempdir().expect("workspace-a");
    let workspace_b = tempfile::tempdir().expect("workspace-b");
    let state = AppState::new(config.path()).expect("state");
    state
        .mutate_registry(|registry| {
            registry.workspaces.push(crate::workspace::Workspace {
                id: "a".to_string(),
                name: "A".to_string(),
                path: workspace_a.path().to_path_buf(),
                pinned: false,
                last_opened: None,
            });
            registry.workspaces.push(crate::workspace::Workspace {
                id: "b".to_string(),
                name: "B".to_string(),
                path: workspace_b.path().to_path_buf(),
                pinned: false,
                last_opened: None,
            });
            Ok(())
        })
        .expect("registry");
    let profile = state
        .remote_profiles
        .save_profile(
            crate::remote::RemoteHostProfileInput {
                id: Some("host-a".to_string()),
                workspace_root: workspace_a.path().to_string_lossy().to_string(),
                name: "edge".to_string(),
                host: "edge.example.com".to_string(),
                port: 22,
                username: "deploy".to_string(),
                auth_kind: crate::remote::RemoteAuthKind::Agent,
                password: None,
                key_path: None,
                key_passphrase: None,
                default_remote_path: "/var/www".to_string(),
                keepalive_seconds: 30,
                connect_timeout_seconds: 10,
            },
            &state.remote_secrets,
            || Ok(crate::remote::remote_now_ms()),
            crate::remote::new_remote_host_id,
        )
        .expect("profile");

    let result =
        state.delete_remote_host(workspace_b.path().to_string_lossy().as_ref(), &profile.id);

    assert!(
        result
            .expect_err("reject")
            .contains("remote host profile does not belong to workspace"),
    );
}
```

- [ ] **Step 8: Run command tests and refactor**

Run:

```bash
. "$HOME/.cargo/env"
cargo test --manifest-path src-tauri/Cargo.toml remote::tests
cargo test --manifest-path src-tauri/Cargo.toml commands::tests::list_remote_hosts_preserves_flat_command_signature
cargo test --manifest-path src-tauri/Cargo.toml commands::tests::save_remote_host_preserves_flat_command_signature
cargo test --manifest-path src-tauri/Cargo.toml commands::tests::delete_remote_host_preserves_flat_command_signature
cargo test --manifest-path src-tauri/Cargo.toml commands::tests::delete_remote_host_rejects_unregistered_workspace_root
cargo test --manifest-path src-tauri/Cargo.toml commands::tests::delete_remote_host_rejects_profile_outside_workspace_root
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected: all listed tests PASS and formatting check PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git status --short
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/remote.rs src-tauri/src/commands.rs src-tauri/src/database.rs src-tauri/src/lib.rs
git commit -m "feat: add remote host profiles"
```

---

### Task 2: Rust SSH, SFTP, Transfers, And Runtime Commands

**Files:**
- Modify: `src-tauri/src/remote.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/file_system.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/remote.rs`
- Test: `src-tauri/src/commands.rs`
- Test: `src-tauri/src/file_system.rs`

- [ ] **Step 1: Write failing runtime tests against a mock backend**

Add these tests to `src-tauri/src/remote.rs`:

```rust
#[cfg(test)]
mod runtime_tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct MockRemoteBackend {
        connected: Mutex<Vec<String>>,
        written: Mutex<Vec<(String, String)>>,
    }

    #[async_trait::async_trait]
    impl RemoteBackend for MockRemoteBackend {
        async fn connect(&self, profile: &RemoteHostProfile, _secrets: &dyn RemoteSecretStore) -> Result<RemoteConnectionSnapshot, String> {
            self.connected.lock().map_err(|err| err.to_string())?.push(profile.id.clone());
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

        async fn close_terminal(&self, session_id: &str) -> Result<RemoteTerminalSessionInfo, String> {
            Ok(RemoteTerminalSessionInfo {
                id: session_id.to_string(),
                host_id: "host-1".to_string(),
                workspace_id: "workspace".to_string(),
                name: "deploy@edge.example.com".to_string(),
                running: false,
            })
        }

        async fn run_command(&self, profile: &RemoteHostProfile, _secrets: &dyn RemoteSecretStore, command: &str) -> Result<RemoteCommandResult, String> {
            Ok(RemoteCommandResult {
                host_id: profile.id.clone(),
                command: command.to_string(),
                stdout: "ok\n".to_string(),
                stderr: String::new(),
                exit_code: Some(0),
                duration_ms: 3,
            })
        }

        async fn list_sftp_directory(&self, profile: &RemoteHostProfile, _secrets: &dyn RemoteSecretStore, path: &str) -> Result<Vec<RemoteFileEntry>, String> {
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

        async fn download_file(&self, _profile: &RemoteHostProfile, _secrets: &dyn RemoteSecretStore, remote_path: &str, local_path: &Path) -> Result<RemoteTransferResult, String> {
            Ok(RemoteTransferResult {
                remote_path: remote_path.to_string(),
                local_path: local_path.to_path_buf(),
                bytes: 42,
            })
        }

        async fn upload_file(&self, _profile: &RemoteHostProfile, _secrets: &dyn RemoteSecretStore, local_path: &Path, remote_path: &str) -> Result<RemoteTransferResult, String> {
            Ok(RemoteTransferResult {
                remote_path: remote_path.to_string(),
                local_path: local_path.to_path_buf(),
                bytes: 42,
            })
        }
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
    async fn remote_state_records_connection_failure_as_visible_health() {
        struct FailingBackend;
        #[async_trait::async_trait]
        impl RemoteBackend for FailingBackend {
            async fn connect(&self, profile: &RemoteHostProfile, _secrets: &dyn RemoteSecretStore) -> Result<RemoteConnectionSnapshot, String> {
                Err(format!("{} refused connection", profile.host))
            }
        }

        let state = RemoteState::new_with_backend(Arc::new(FailingBackend));
        let secrets = super::tests::MemoryRemoteSecretStore::default();

        let err = state.connect_host(&profile(), &secrets).await.expect_err("connect error");
        let health = state.connection_snapshot("host-1").expect("snapshot");

        assert!(err.contains("refused connection"));
        assert_eq!(health.status, RemoteConnectionStatus::Failed);
        assert_eq!(health.message.as_deref(), Some("edge.example.com refused connection"));
    }

    #[tokio::test]
    async fn spawn_ssh_terminal_registers_workspace_scoped_session() {
        let state = RemoteState::new_with_backend(Arc::new(MockRemoteBackend::default()));
        let secrets = super::tests::MemoryRemoteSecretStore::default();
        let session = state
            .spawn_ssh_terminal("workspace", &profile(), &secrets, 24, 80)
            .await
            .expect("spawn");

        assert_eq!(session.id, "host-1:ssh-1");
        assert_eq!(session.workspace_id, "workspace");
        assert_eq!(session.host_id, "host-1");
        assert_eq!(state.list_ssh_terminal_sessions("workspace").expect("list").len(), 1);
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
            .download_sftp_file(&profile(), &secrets, "/var/www/app.js", workspace.path(), "downloads/app.js")
            .await
            .expect("download");
        let upload = state
            .upload_sftp_file(&profile(), &secrets, workspace.path(), "dist/app.js", "/var/www/app.js")
            .await
            .expect("upload");
        let rejected = state
            .upload_sftp_file(&profile(), &secrets, workspace.path(), "../secret.txt", "/tmp/secret.txt")
            .await
            .expect_err("outside workspace");

        assert!(download.local_path.ends_with("downloads/app.js"));
        assert_eq!(upload.remote_path, "/var/www/app.js");
        assert!(rejected.contains("outside workspace"));
    }
}
```

- [ ] **Step 2: Run runtime tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env"
cargo test --manifest-path src-tauri/Cargo.toml remote::runtime_tests::remote_state_records_connection_failure_as_visible_health
```

Expected: FAIL with unresolved `RemoteBackend`, `RemoteState::new_with_backend`, `RemoteConnectionSnapshot`, or related runtime types.

- [ ] **Step 3: Implement runtime types and mockable backend contract**

Add these runtime types to `src-tauri/src/remote.rs`:

```rust
use tauri::Emitter;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub enum RemoteConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Failed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct RemoteConnectionSnapshot {
    pub host_id: String,
    pub status: RemoteConnectionStatus,
    pub message: Option<String>,
    pub checked_ms: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct RemoteTerminalSessionInfo {
    pub id: String,
    pub host_id: String,
    pub workspace_id: String,
    pub name: String,
    pub running: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct RemoteTerminalHandle {
    pub session_id: String,
    pub host_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub enum RemoteFileKind {
    File,
    Directory,
    Symlink,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct RemoteFileEntry {
    pub host_id: String,
    pub path: String,
    pub name: String,
    pub kind: RemoteFileKind,
    pub size: Option<u64>,
    pub modified_ms: Option<u64>,
    pub link_target: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct RemoteCommandResult {
    pub host_id: String,
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<u32>,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
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

#[derive(Clone)]
pub struct TauriRemoteTerminalEventSink {
    app: tauri::AppHandle,
}

impl TauriRemoteTerminalEventSink {
    pub fn new(app: tauri::AppHandle) -> Self {
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

#[async_trait::async_trait]
pub trait RemoteBackend: Send + Sync {
    async fn connect(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
    ) -> Result<RemoteConnectionSnapshot, String>;

    async fn disconnect(&self, host_id: &str) -> Result<RemoteConnectionSnapshot, String>;

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

    async fn write_terminal(&self, session_id: &str, data: &str) -> Result<(), String>;

    async fn close_terminal(&self, session_id: &str) -> Result<RemoteTerminalSessionInfo, String>;

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
```

Replace the minimal `RemoteState` with:

```rust
pub struct RemoteState {
    backend: Arc<dyn RemoteBackend>,
    connections: Arc<Mutex<HashMap<String, RemoteConnectionSnapshot>>>,
    terminals: Arc<Mutex<HashMap<String, RemoteTerminalSessionInfo>>>,
}

impl RemoteState {
    pub fn new() -> Self {
        Self::new_with_backend(Arc::new(RusshRemoteBackend::default()))
    }

    pub fn new_with_backend(backend: Arc<dyn RemoteBackend>) -> Self {
        Self {
            backend,
            connections: Arc::new(Mutex::new(HashMap::new())),
            terminals: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn connection_snapshot(&self, host_id: &str) -> Result<RemoteConnectionSnapshot, String> {
        self.connections
            .lock()
            .map_err(|err| err.to_string())?
            .get(host_id)
            .cloned()
            .ok_or_else(|| format!("remote host has no connection snapshot: {host_id}"))
    }

    pub fn list_ssh_terminal_sessions(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<RemoteTerminalSessionInfo>, String> {
        let mut sessions = self
            .terminals
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
                let snapshot = RemoteConnectionSnapshot {
                    host_id: profile.id.clone(),
                    status: RemoteConnectionStatus::Failed,
                    message: Some(error.clone()),
                    checked_ms: remote_now_ms(),
                };
                self.set_connection(snapshot)?;
                Err(error)
            }
        }
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
        let handle = self
            .backend
            .spawn_terminal(profile, secrets, events, rows.max(1), cols.max(1))
            .await?;
        let session = RemoteTerminalSessionInfo {
            id: handle.session_id,
            host_id: handle.host_id,
            workspace_id: workspace_id.to_string(),
            name: handle.name,
            running: true,
        };
        self.terminals
            .lock()
            .map_err(|err| err.to_string())?
            .insert(session.id.clone(), session.clone());
        Ok(session)
    }

    pub async fn write_ssh_terminal(&self, session_id: &str, data: &str) -> Result<(), String> {
        self.backend.write_terminal(session_id, data).await
    }

    pub async fn close_ssh_terminal(
        &self,
        session_id: &str,
    ) -> Result<RemoteTerminalSessionInfo, String> {
        let closed = self.backend.close_terminal(session_id).await?;
        self.terminals
            .lock()
            .map_err(|err| err.to_string())?
            .remove(session_id);
        Ok(closed)
    }

    pub async fn run_remote_command(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        command: &str,
    ) -> Result<RemoteCommandResult, String> {
        let command = command.trim();
        if command.is_empty() {
            return Err("remote command is required".to_string());
        }
        self.backend.run_command(profile, secrets, command).await
    }

    pub async fn list_sftp_directory(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        path: &str,
    ) -> Result<Vec<RemoteFileEntry>, String> {
        let path = normalize_remote_path(path)?;
        self.backend.list_sftp_directory(profile, secrets, &path).await
    }

    pub async fn download_sftp_file(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        remote_path: &str,
        workspace_root: &Path,
        local_relative_path: &str,
    ) -> Result<RemoteTransferResult, String> {
        let remote_path = normalize_remote_path(remote_path)?;
        let local_path = crate::file_system::workspace_child_for_write(workspace_root, Path::new(local_relative_path))?;
        self.backend
            .download_file(profile, secrets, &remote_path, &local_path)
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
        let remote_path = normalize_remote_path(remote_path)?;
        let local_path = crate::file_system::workspace_child_for_existing_file(workspace_root, Path::new(local_relative_path))?;
        self.backend
            .upload_file(profile, secrets, &local_path, &remote_path)
            .await
    }

    fn set_connection(&self, snapshot: RemoteConnectionSnapshot) -> Result<(), String> {
        self.connections
            .lock()
            .map_err(|err| err.to_string())?
            .insert(snapshot.host_id.clone(), snapshot);
        Ok(())
    }
}
```

`workspace_child_for_write` and `workspace_child_for_existing_file` are not present after Task 1. Add focused helpers in `src-tauri/src/file_system.rs` with tests that canonicalize the workspace root, reject `..` escaping, create parent directories for write targets, and require existing regular files for upload targets.

The SSH terminal runtime must emit events compatible with Task 3's frontend API:

- Output event name: `workspace://ssh-terminal-output`
- Exit event name: `workspace://ssh-terminal-exit`
- Payload structs: `RemoteTerminalOutputEvent` and `RemoteTerminalExitEvent` above

Use a small `RemoteTerminalEventSink` abstraction so `RemoteState` and mock backend tests stay independent of Tauri. The Tauri command layer should wrap `AppHandle` in a sink implementation that calls `app.emit(...)`. The russh backend must call `emit_output` for `ChannelMsg::Data` and `ChannelMsg::ExtendedData`, and `emit_exit` when the SSH channel ends or reports `ExitStatus`.

- [ ] **Step 4: Implement the russh backend**

Add `RusshRemoteBackend` in `src-tauri/src/remote.rs`. Use the crate examples as the source of truth: `russh-0.61.2/examples/client_exec_simple.rs`, `russh-0.61.2/examples/sftp_client.rs`, and `russh-sftp-2.3.0/examples/client.rs`.

```rust
#[derive(Default)]
pub struct RusshRemoteBackend {
    ssh_sessions: Arc<tokio::sync::Mutex<HashMap<String, russh::client::Handle<RemoteClient>>>>,
    terminal_writers: Arc<tokio::sync::Mutex<HashMap<String, russh::ChannelWriteHalf<russh::client::Msg>>>>,
}

#[derive(Clone)]
pub struct RemoteClient;

impl russh::client::Handler for RemoteClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

#[async_trait::async_trait]
impl RemoteBackend for RusshRemoteBackend {
    async fn connect(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
    ) -> Result<RemoteConnectionSnapshot, String> {
        let mut session = connect_russh_session(profile, secrets).await?;
        self.ssh_sessions
            .lock()
            .await
            .insert(profile.id.clone(), session.clone());
        Ok(RemoteConnectionSnapshot {
            host_id: profile.id.clone(),
            status: RemoteConnectionStatus::Connected,
            message: None,
            checked_ms: remote_now_ms(),
        })
    }

    async fn disconnect(&self, host_id: &str) -> Result<RemoteConnectionSnapshot, String> {
        if let Some(mut session) = self.ssh_sessions.lock().await.remove(host_id) {
            let _ = session
                .disconnect(russh::Disconnect::ByApplication, "", "English")
                .await;
        }
        Ok(RemoteConnectionSnapshot {
            host_id: host_id.to_string(),
            status: RemoteConnectionStatus::Disconnected,
            message: None,
            checked_ms: remote_now_ms(),
        })
    }

    async fn spawn_terminal(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        events: Arc<dyn RemoteTerminalEventSink>,
        rows: u16,
        cols: u16,
    ) -> Result<RemoteTerminalHandle, String> {
        let session = self.session_for(profile, secrets).await?;
        let channel = session.channel_open_session().await.map_err(|err| err.to_string())?;
        channel
            .request_pty(true, "xterm-256color", u32::from(cols), u32::from(rows), 0, 0, &[])
            .await
            .map_err(|err| err.to_string())?;
        channel.request_shell(true).await.map_err(|err| err.to_string())?;
        let (mut read_half, write_half) = channel.split();
        let session_id = format!("{}:ssh-{}", profile.id, remote_now_ms());
        self.terminal_writers
            .lock()
            .await
            .insert(session_id.clone(), write_half);
        let output_session_id = session_id.clone();
        tokio::spawn(async move {
            let mut exit_code = None;
            while let Some(message) = read_half.wait().await {
                match message {
                    russh::ChannelMsg::Data { data } => {
                        events.emit_output(RemoteTerminalOutputEvent {
                            session_id: output_session_id.clone(),
                            chunk: String::from_utf8_lossy(&data).into_owned(),
                        });
                    }
                    russh::ChannelMsg::ExtendedData { data, .. } => {
                        events.emit_output(RemoteTerminalOutputEvent {
                            session_id: output_session_id.clone(),
                            chunk: String::from_utf8_lossy(&data).into_owned(),
                        });
                    }
                    russh::ChannelMsg::ExitStatus { exit_status } => {
                        exit_code = Some(exit_status);
                    }
                    _ => {}
                }
            }
            events.emit_exit(RemoteTerminalExitEvent {
                session_id: output_session_id,
                exit_code,
            });
        });
        Ok(RemoteTerminalHandle {
            session_id,
            host_id: profile.id.clone(),
            name: format!("{}@{}", profile.username, profile.host),
        })
    }

    async fn write_terminal(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut writers = self.terminal_writers.lock().await;
        let writer = writers
            .get_mut(session_id)
            .ok_or_else(|| format!("missing SSH terminal session: {session_id}"))?;
        writer.data(data.as_bytes()).await.map_err(|err| err.to_string())
    }

    async fn close_terminal(&self, session_id: &str) -> Result<RemoteTerminalSessionInfo, String> {
        self.terminal_writers.lock().await.remove(session_id);
        Ok(RemoteTerminalSessionInfo {
            id: session_id.to_string(),
            host_id: host_id_from_ssh_session_id(session_id),
            workspace_id: String::new(),
            name: session_id.to_string(),
            running: false,
        })
    }

    async fn run_command(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        command: &str,
    ) -> Result<RemoteCommandResult, String> {
        let started = remote_now_ms();
        let session = self.session_for(profile, secrets).await?;
        let mut channel = session.channel_open_session().await.map_err(|err| err.to_string())?;
        channel.exec(true, command).await.map_err(|err| err.to_string())?;
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = None;
        while let Some(message) = channel.wait().await {
            match message {
                russh::ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                russh::ChannelMsg::ExtendedData { data, .. } => stderr.extend_from_slice(&data),
                russh::ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
                _ => {}
            }
        }
        Ok(RemoteCommandResult {
            host_id: profile.id.clone(),
            command: command.to_string(),
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
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
        let sftp = self.sftp_session(profile, secrets).await?;
        let mut entries = Vec::new();
        for entry in sftp.read_dir(path).await.map_err(|err| err.to_string())? {
            let metadata = entry.metadata();
            let name = entry.file_name();
            let child_path = join_remote_child(path, &name)?;
            entries.push(RemoteFileEntry {
                host_id: profile.id.clone(),
                path: child_path,
                name,
                kind: remote_kind_from_metadata(&metadata),
                size: metadata.size,
                modified_ms: metadata.mtime.map(|seconds| seconds.saturating_mul(1000)),
                link_target: None,
            });
        }
        entries.sort_by(|left, right| {
            remote_kind_sort(&left.kind)
                .cmp(&remote_kind_sort(&right.kind))
                .then_with(|| left.name.cmp(&right.name))
        });
        Ok(entries)
    }

    async fn download_file(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        remote_path: &str,
        local_path: &Path,
    ) -> Result<RemoteTransferResult, String> {
        let sftp = self.sftp_session(profile, secrets).await?;
        if let Some(parent) = local_path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|err| err.to_string())?;
        }
        let mut remote_file = sftp.open(remote_path).await.map_err(|err| err.to_string())?;
        let mut local_file = tokio::fs::File::create(local_path).await.map_err(|err| err.to_string())?;
        let bytes = tokio::io::copy(&mut remote_file, &mut local_file)
            .await
            .map_err(|err| err.to_string())?;
        Ok(RemoteTransferResult {
            remote_path: remote_path.to_string(),
            local_path: local_path.to_path_buf(),
            bytes,
        })
    }

    async fn upload_file(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
        local_path: &Path,
        remote_path: &str,
    ) -> Result<RemoteTransferResult, String> {
        let sftp = self.sftp_session(profile, secrets).await?;
        let mut local_file = tokio::fs::File::open(local_path).await.map_err(|err| err.to_string())?;
        let mut remote_file = sftp.create(remote_path).await.map_err(|err| err.to_string())?;
        let bytes = tokio::io::copy(&mut local_file, &mut remote_file)
            .await
            .map_err(|err| err.to_string())?;
        Ok(RemoteTransferResult {
            remote_path: remote_path.to_string(),
            local_path: local_path.to_path_buf(),
            bytes,
        })
    }
}
```

Implement helper functions used by the adapter:

```rust
async fn connect_russh_session(
    profile: &RemoteHostProfile,
    secrets: &dyn RemoteSecretStore,
) -> Result<russh::client::Handle<RemoteClient>, String> {
    let config = russh::client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(profile.keepalive_seconds)),
        ..Default::default()
    };
    let mut session = russh::client::connect(
        Arc::new(config),
        (profile.host.as_str(), profile.port),
        RemoteClient,
    )
    .await
    .map_err(|err| err.to_string())?;

    let auth = match &profile.auth {
        RemoteAuthSource::Password { secret_id } => {
            let password = secrets.get_secret(secret_id)?;
            session
                .authenticate_password(profile.username.clone(), password)
                .await
                .map_err(|err| err.to_string())?
        }
        RemoteAuthSource::Key {
            key_path,
            passphrase_secret_id,
        } => {
            let passphrase = match passphrase_secret_id {
                Some(secret_id) => Some(secrets.get_secret(secret_id)?),
                None => None,
            };
            let key_pair = russh::keys::load_secret_key(key_path, passphrase.as_deref())
                .map_err(|err| err.to_string())?;
            session
                .authenticate_publickey(
                    profile.username.clone(),
                    russh::keys::PrivateKeyWithHashAlg::new(
                        Arc::new(key_pair),
                        session
                            .best_supported_rsa_hash()
                            .await
                            .map_err(|err| err.to_string())?
                            .flatten(),
                    ),
                )
                .await
                .map_err(|err| err.to_string())?
        }
        RemoteAuthSource::Agent => {
            let mut agent = russh::keys::agent::client::AgentClient::connect_env()
                .await
                .map_err(|err| err.to_string())?;
            let identities = agent.request_identities().await.map_err(|err| err.to_string())?;
            let Some(identity) = identities.first() else {
                return Err("SSH agent has no identities".to_string());
            };
            session
                .authenticate_publickey_with(profile.username.clone(), identity.clone(), None, &mut agent)
                .await
                .map_err(|err| err.to_string())?
        }
    };

    if auth.success() {
        Ok(session)
    } else {
        Err("SSH authentication failed".to_string())
    }
}
```

If `russh::keys::agent::client::AgentClient` signatures differ at compile time, keep Password and Key authentication as the required Node 10 path and make Agent return `Err("SSH agent authentication is unavailable in this build")`. Add a test that the error is visible through `RemoteConnectionStatus::Failed`.

Add SFTP helpers:

```rust
impl RusshRemoteBackend {
    async fn session_for(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
    ) -> Result<russh::client::Handle<RemoteClient>, String> {
        if let Some(session) = self.ssh_sessions.lock().await.get(&profile.id).cloned() {
            return Ok(session);
        }
        let session = connect_russh_session(profile, secrets).await?;
        self.ssh_sessions
            .lock()
            .await
            .insert(profile.id.clone(), session.clone());
        Ok(session)
    }

    async fn sftp_session(
        &self,
        profile: &RemoteHostProfile,
        secrets: &dyn RemoteSecretStore,
    ) -> Result<russh_sftp::client::SftpSession, String> {
        let session = self.session_for(profile, secrets).await?;
        let channel = session.channel_open_session().await.map_err(|err| err.to_string())?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|err| err.to_string())?;
        russh_sftp::client::SftpSession::new(channel.into_stream())
            .await
            .map_err(|err| err.to_string())
    }
}

fn join_remote_child(parent: &str, name: &str) -> Result<String, String> {
    normalize_remote_path(&format!("{}/{}", parent.trim_end_matches('/'), name))
}

fn remote_kind_sort(kind: &RemoteFileKind) -> u8 {
    match kind {
        RemoteFileKind::Directory => 0,
        RemoteFileKind::File => 1,
        RemoteFileKind::Symlink => 2,
    }
}

fn remote_kind_from_metadata(metadata: &russh_sftp::protocol::FileAttributes) -> RemoteFileKind {
    if metadata.is_dir() {
        RemoteFileKind::Directory
    } else if metadata.is_symlink() {
        RemoteFileKind::Symlink
    } else {
        RemoteFileKind::File
    }
}

fn host_id_from_ssh_session_id(session_id: &str) -> String {
    session_id
        .split_once(":ssh-")
        .map(|(host_id, _)| host_id.to_string())
        .unwrap_or_else(|| session_id.to_string())
}
```

- [ ] **Step 5: Wire Tauri runtime commands**

Add these command wrappers to `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub async fn connect_remote_host(
    app_state: State<'_, AppState>,
    remote_state: State<'_, crate::remote::RemoteState>,
    profile_id: String,
) -> Result<crate::remote::RemoteConnectionSnapshot, String> {
    let profile = app_state.remote_host_in_active_workspace(&profile_id)?;
    remote_state
        .connect_host(&profile, &app_state.remote_secrets)
        .await
}

#[tauri::command]
pub async fn disconnect_remote_host(
    remote_state: State<'_, crate::remote::RemoteState>,
    profile_id: String,
) -> Result<crate::remote::RemoteConnectionSnapshot, String> {
    remote_state.disconnect_host(&profile_id).await
}

#[tauri::command]
pub fn list_ssh_terminal_sessions(
    remote_state: State<'_, crate::remote::RemoteState>,
    workspace_id: String,
) -> Result<Vec<crate::remote::RemoteTerminalSessionInfo>, String> {
    remote_state.list_ssh_terminal_sessions(&workspace_id)
}

#[tauri::command]
pub async fn spawn_ssh_terminal(
    app: AppHandle,
    app_state: State<'_, AppState>,
    remote_state: State<'_, crate::remote::RemoteState>,
    workspace_id: String,
    workspace_root: String,
    profile_id: String,
    rows: u16,
    cols: u16,
) -> Result<crate::remote::RemoteTerminalSessionInfo, String> {
    let workspace_root = app_state.trusted_workspace_root(&workspace_root)?;
    app_state.ensure_workspace_id_matches_root_path(&workspace_id, &workspace_root)?;
    let profile = app_state.remote_host_in_active_workspace(&profile_id)?;
    if profile.workspace_root != workspace_root.to_string_lossy() {
        return Err("remote host profile does not belong to workspace".to_string());
    }
    remote_state
        .spawn_ssh_terminal(
            &workspace_id,
            &profile,
            &app_state.remote_secrets,
            Arc::new(crate::remote::TauriRemoteTerminalEventSink::new(app)),
            rows,
            cols,
        )
        .await
}

#[tauri::command]
pub async fn write_ssh_terminal(
    remote_state: State<'_, crate::remote::RemoteState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    remote_state.write_ssh_terminal(&session_id, &data).await
}

#[tauri::command]
pub async fn close_ssh_terminal(
    remote_state: State<'_, crate::remote::RemoteState>,
    session_id: String,
) -> Result<crate::remote::RemoteTerminalSessionInfo, String> {
    remote_state.close_ssh_terminal(&session_id).await
}

#[tauri::command]
pub async fn run_remote_command(
    app_state: State<'_, AppState>,
    remote_state: State<'_, crate::remote::RemoteState>,
    profile_id: String,
    command: String,
) -> Result<crate::remote::RemoteCommandResult, String> {
    let profile = app_state.remote_host_in_active_workspace(&profile_id)?;
    remote_state
        .run_remote_command(&profile, &app_state.remote_secrets, &command)
        .await
}

#[tauri::command]
pub async fn list_sftp_directory(
    app_state: State<'_, AppState>,
    remote_state: State<'_, crate::remote::RemoteState>,
    profile_id: String,
    path: String,
) -> Result<Vec<crate::remote::RemoteFileEntry>, String> {
    let profile = app_state.remote_host_in_active_workspace(&profile_id)?;
    remote_state
        .list_sftp_directory(&profile, &app_state.remote_secrets, &path)
        .await
}

#[tauri::command]
pub async fn download_sftp_file(
    app_state: State<'_, AppState>,
    remote_state: State<'_, crate::remote::RemoteState>,
    workspace_root: String,
    profile_id: String,
    remote_path: String,
    local_relative_path: String,
) -> Result<crate::remote::RemoteTransferResult, String> {
    let workspace_root = app_state.trusted_workspace_root(&workspace_root)?;
    let profile = app_state.remote_host_in_active_workspace(&profile_id)?;
    if profile.workspace_root != workspace_root.to_string_lossy() {
        return Err("remote host profile does not belong to workspace".to_string());
    }
    remote_state
        .download_sftp_file(
            &profile,
            &app_state.remote_secrets,
            &remote_path,
            &workspace_root,
            &local_relative_path,
        )
        .await
}

#[tauri::command]
pub async fn upload_sftp_file(
    app_state: State<'_, AppState>,
    remote_state: State<'_, crate::remote::RemoteState>,
    workspace_root: String,
    profile_id: String,
    local_relative_path: String,
    remote_path: String,
) -> Result<crate::remote::RemoteTransferResult, String> {
    let workspace_root = app_state.trusted_workspace_root(&workspace_root)?;
    let profile = app_state.remote_host_in_active_workspace(&profile_id)?;
    if profile.workspace_root != workspace_root.to_string_lossy() {
        return Err("remote host profile does not belong to workspace".to_string());
    }
    remote_state
        .upload_sftp_file(
            &profile,
            &app_state.remote_secrets,
            &workspace_root,
            &local_relative_path,
            &remote_path,
        )
        .await
}
```

Register all command names in `src-tauri/src/lib.rs`.

- [ ] **Step 6: Run GREEN and refactor checks**

Run:

```bash
. "$HOME/.cargo/env"
cargo test --manifest-path src-tauri/Cargo.toml remote::runtime_tests
cargo test --manifest-path src-tauri/Cargo.toml file_system::tests::workspace_child_for_write_rejects_outside_workspace
cargo test --manifest-path src-tauri/Cargo.toml file_system::tests::workspace_child_for_existing_file_rejects_missing_or_outside_file
cargo test --manifest-path src-tauri/Cargo.toml commands::tests::spawn_ssh_terminal_preserves_flat_command_signature
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

Expected: tests PASS, formatting PASS, clippy PASS. If command signature tests are missing, add the same flat-signature pattern used for `spawn_terminal_session` and rerun. `spawn_ssh_terminal_preserves_flat_command_signature` must include the leading `AppHandle` argument because `spawn_ssh_terminal` needs the app handle to emit SSH terminal events.

- [ ] **Step 7: Commit Task 2**

```bash
git status --short
git add src-tauri/src/remote.rs src-tauri/src/commands.rs src-tauri/src/file_system.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: add remote ssh and sftp runtime"
```

---

### Task 3: Frontend Remote Model And API

**Files:**
- Create: `src/features/remote/remote-model.ts`
- Create: `src/features/remote/remote-model.test.ts`
- Create: `src/features/remote/remote-api.ts`

- [ ] **Step 1: Write failing reducer tests**

Create `src/features/remote/remote-model.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  appendRemoteCommandOutput,
  appendSshTerminalOutput,
  bufferSshTerminalExit,
  bufferSshTerminalOutput,
  closeSshTerminal,
  createRemoteState,
  markRemoteConnection,
  markSshTerminalExited,
  replaceRemoteHosts,
  setRemoteCommandResult,
  setSftpEntries,
  upsertSshTerminal,
} from "./remote-model";

describe("remote model", () => {
  test("replaces hosts and keeps active host when it still exists", () => {
    const first = replaceRemoteHosts(createRemoteState(), [
      {
        id: "edge",
        workspace_root: "/repo",
        name: "edge-01",
        host: "edge.example.com",
        port: 22,
        username: "deploy",
        auth: "Agent",
        default_remote_path: "/var/www",
        keepalive_seconds: 30,
        connect_timeout_seconds: 10,
        created_ms: 1,
        updated_ms: 1,
      },
    ]);
    const second = replaceRemoteHosts(first, first.hosts);

    expect(first.activeHostId).toBe("edge");
    expect(second.activeHostId).toBe("edge");
  });

  test("terminal output is bounded and late events are buffered", () => {
    const buffered = bufferSshTerminalOutput(createRemoteState(), "edge:ssh-1", "boot\n");
    const state = upsertSshTerminal(buffered, {
      id: "edge:ssh-1",
      host_id: "edge",
      workspace_id: "workspace",
      name: "deploy@edge",
      running: true,
    });
    const withOutput = appendSshTerminalOutput(
      appendSshTerminalOutput(state, "edge:ssh-1", "a".repeat(120_000)),
      "edge:ssh-1",
      "tail",
    );

    expect(withOutput.sshOutputBySessionId["edge:ssh-1"]).toHaveLength(120_000);
    expect(withOutput.sshOutputBySessionId["edge:ssh-1"]).toEndWith("tail");
    expect(withOutput.pendingSshOutputBySessionId["edge:ssh-1"]).toBeUndefined();
  });

  test("terminal exit before upsert marks the later session stopped", () => {
    const buffered = bufferSshTerminalExit(createRemoteState(), "edge:ssh-1");
    const state = upsertSshTerminal(buffered, {
      id: "edge:ssh-1",
      host_id: "edge",
      workspace_id: "workspace",
      name: "deploy@edge",
      running: true,
    });

    expect(state.sshSessions[0]?.running).toBe(false);
    expect(state.pendingSshExitBySessionId["edge:ssh-1"]).toBeUndefined();
  });

  test("closing a terminal prevents late events from creating pending output", () => {
    const closed = closeSshTerminal(
      upsertSshTerminal(createRemoteState(), {
        id: "edge:ssh-1",
        host_id: "edge",
        workspace_id: "workspace",
        name: "deploy@edge",
        running: true,
      }),
      "edge:ssh-1",
    );
    const withLateOutput = bufferSshTerminalOutput(closed, "edge:ssh-1", "late");

    expect(withLateOutput.pendingSshOutputBySessionId["edge:ssh-1"]).toBeUndefined();
  });

  test("connection health and sftp entries are host scoped", () => {
    const state = setSftpEntries(
      markRemoteConnection(createRemoteState(), {
        host_id: "edge",
        status: "Connected",
        message: null,
        checked_ms: 1,
      }),
      "edge",
      "/var/www",
      [
        {
          host_id: "edge",
          path: "/var/www/app.js",
          name: "app.js",
          kind: "File",
          size: 42,
          modified_ms: null,
          link_target: null,
        },
      ],
    );

    expect(state.connectionByHostId.edge?.status).toBe("Connected");
    expect(state.sftpEntriesByHostPath["edge:/var/www"]?.[0]?.name).toBe("app.js");
  });

  test("remote command output is bounded and result is recorded", () => {
    const state = setRemoteCommandResult(
      appendRemoteCommandOutput(createRemoteState(), "run-1", "a".repeat(120_000)),
      "run-1",
      {
        host_id: "edge",
        command: "uptime",
        stdout: "ok\n",
        stderr: "",
        exit_code: 0,
        duration_ms: 3,
      },
    );

    expect(state.commandOutputByRunId["run-1"]).toHaveLength(120_000);
    expect(state.commandResults[0]?.command).toBe("uptime");
  });
});
```

- [ ] **Step 2: Run frontend model test to verify RED**

Run:

```bash
bun test src/features/remote/remote-model.test.ts
```

Expected: FAIL with module not found for `./remote-model`.

- [ ] **Step 3: Implement `remote-model.ts`**

Create `src/features/remote/remote-model.ts`:

```ts
const MAX_REMOTE_OUTPUT = 120_000;

export type RemoteAuthSource =
  | { Password: { secret_id: string } }
  | { Key: { key_path: string; passphrase_secret_id: string | null } }
  | "Agent";

export type RemoteAuthKind = "Password" | "Key" | "Agent";

export type RemoteHostProfile = {
  id: string;
  workspace_root: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth: RemoteAuthSource;
  default_remote_path: string;
  keepalive_seconds: number;
  connect_timeout_seconds: number;
  created_ms: number;
  updated_ms: number;
};

export type RemoteHostProfileInput = {
  id?: string;
  workspace_root: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_kind: RemoteAuthKind;
  password?: string;
  key_path?: string;
  key_passphrase?: string;
  default_remote_path: string;
  keepalive_seconds: number;
  connect_timeout_seconds: number;
};

export type RemoteConnectionStatus =
  | "Disconnected"
  | "Connecting"
  | "Connected"
  | "Failed";

export type RemoteConnectionSnapshot = {
  host_id: string;
  status: RemoteConnectionStatus;
  message: string | null;
  checked_ms: number;
};

export type SshTerminalSessionInfo = {
  id: string;
  host_id: string;
  workspace_id: string;
  name: string;
  running: boolean;
};

export type RemoteFileKind = "File" | "Directory" | "Symlink";

export type RemoteFileEntry = {
  host_id: string;
  path: string;
  name: string;
  kind: RemoteFileKind;
  size: number | null;
  modified_ms: number | null;
  link_target: string | null;
};

export type RemoteCommandResult = {
  host_id: string;
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
};

export type RemoteTransferResult = {
  remote_path: string;
  local_path: string;
  bytes: number;
};

export type RemoteViewState = {
  hosts: RemoteHostProfile[];
  activeHostId: string | null;
  mode: "ssh" | "sftp" | "commands";
  connectionByHostId: Record<string, RemoteConnectionSnapshot>;
  sshSessions: SshTerminalSessionInfo[];
  activeSshSessionId: string | null;
  sshOutputBySessionId: Record<string, string>;
  pendingSshOutputBySessionId: Record<string, string>;
  pendingSshExitBySessionId: Record<string, true>;
  ignoredSshSessionIds: Record<string, true>;
  sftpPathByHostId: Record<string, string>;
  sftpEntriesByHostPath: Record<string, RemoteFileEntry[]>;
  commandDraft: string;
  commandResults: RemoteCommandResult[];
  commandOutputByRunId: Record<string, string>;
  transfer: RemoteTransferResult | null;
  loading: boolean;
  error: string | null;
};

export function createRemoteState(): RemoteViewState {
  return {
    hosts: [],
    activeHostId: null,
    mode: "ssh",
    connectionByHostId: {},
    sshSessions: [],
    activeSshSessionId: null,
    sshOutputBySessionId: {},
    pendingSshOutputBySessionId: {},
    pendingSshExitBySessionId: {},
    ignoredSshSessionIds: {},
    sftpPathByHostId: {},
    sftpEntriesByHostPath: {},
    commandDraft: "",
    commandResults: [],
    commandOutputByRunId: {},
    transfer: null,
    loading: false,
    error: null,
  };
}
```

Add reducers:

```ts
export function replaceRemoteHosts(
  state: RemoteViewState,
  hosts: RemoteHostProfile[],
): RemoteViewState {
  const activeHostId =
    state.activeHostId && hosts.some((host) => host.id === state.activeHostId)
      ? state.activeHostId
      : (hosts[0]?.id ?? null);
  return { ...state, hosts, activeHostId, error: null };
}

export function selectRemoteHost(
  state: RemoteViewState,
  hostId: string,
): RemoteViewState {
  if (!state.hosts.some((host) => host.id === hostId)) {
    return state;
  }
  return { ...state, activeHostId: hostId, error: null };
}

export function setRemoteMode(
  state: RemoteViewState,
  mode: RemoteViewState["mode"],
): RemoteViewState {
  return { ...state, mode };
}

export function markRemoteConnection(
  state: RemoteViewState,
  snapshot: RemoteConnectionSnapshot,
): RemoteViewState {
  return {
    ...state,
    connectionByHostId: {
      ...state.connectionByHostId,
      [snapshot.host_id]: snapshot,
    },
  };
}

export function upsertSshTerminal(
  state: RemoteViewState,
  session: SshTerminalSessionInfo,
): RemoteViewState {
  const sessions = state.sshSessions.some((item) => item.id === session.id)
    ? state.sshSessions.map((item) => (item.id === session.id ? session : item))
    : [...state.sshSessions, session];
  const pending = state.pendingSshOutputBySessionId[session.id] ?? "";
  const exited = state.pendingSshExitBySessionId[session.id] === true;
  const nextSession = exited ? { ...session, running: false } : session;
  return {
    ...state,
    sshSessions: sessions.map((item) =>
      item.id === session.id ? nextSession : item,
    ),
    activeSshSessionId: session.id,
    sshOutputBySessionId: {
      ...state.sshOutputBySessionId,
      [session.id]: boundedOutput(
        (state.sshOutputBySessionId[session.id] ?? "") + pending,
      ),
    },
    pendingSshOutputBySessionId: withoutKey(
      state.pendingSshOutputBySessionId,
      session.id,
    ),
    pendingSshExitBySessionId: withoutKey(
      state.pendingSshExitBySessionId,
      session.id,
    ),
    ignoredSshSessionIds: withoutKey(state.ignoredSshSessionIds, session.id),
  };
}

export function appendSshTerminalOutput(
  state: RemoteViewState,
  sessionId: string,
  chunk: string,
): RemoteViewState {
  if (!state.sshSessions.some((session) => session.id === sessionId)) {
    return state;
  }
  return {
    ...state,
    sshOutputBySessionId: {
      ...state.sshOutputBySessionId,
      [sessionId]: boundedOutput(
        (state.sshOutputBySessionId[sessionId] ?? "") + chunk,
      ),
    },
  };
}

export function bufferSshTerminalOutput(
  state: RemoteViewState,
  sessionId: string,
  chunk: string,
): RemoteViewState {
  if (state.ignoredSshSessionIds[sessionId]) {
    return state;
  }
  if (state.sshSessions.some((session) => session.id === sessionId)) {
    return appendSshTerminalOutput(state, sessionId, chunk);
  }
  return {
    ...state,
    pendingSshOutputBySessionId: {
      ...state.pendingSshOutputBySessionId,
      [sessionId]: boundedOutput(
        (state.pendingSshOutputBySessionId[sessionId] ?? "") + chunk,
      ),
    },
  };
}

export function markSshTerminalExited(
  state: RemoteViewState,
  sessionId: string,
): RemoteViewState {
  if (!state.sshSessions.some((session) => session.id === sessionId)) {
    return state;
  }
  return {
    ...state,
    sshSessions: state.sshSessions.map((session) =>
      session.id === sessionId ? { ...session, running: false } : session,
    ),
  };
}

export function bufferSshTerminalExit(
  state: RemoteViewState,
  sessionId: string,
): RemoteViewState {
  if (state.ignoredSshSessionIds[sessionId]) {
    return state;
  }
  if (state.sshSessions.some((session) => session.id === sessionId)) {
    return markSshTerminalExited(state, sessionId);
  }
  return {
    ...state,
    pendingSshExitBySessionId: {
      ...state.pendingSshExitBySessionId,
      [sessionId]: true,
    },
  };
}

export function closeSshTerminal(
  state: RemoteViewState,
  sessionId: string,
): RemoteViewState {
  const sessions = state.sshSessions.filter((session) => session.id !== sessionId);
  return {
    ...state,
    sshSessions: sessions,
    activeSshSessionId:
      state.activeSshSessionId === sessionId
        ? (sessions.at(-1)?.id ?? null)
        : state.activeSshSessionId,
    sshOutputBySessionId: withoutKey(state.sshOutputBySessionId, sessionId),
    pendingSshOutputBySessionId: withoutKey(
      state.pendingSshOutputBySessionId,
      sessionId,
    ),
    pendingSshExitBySessionId: withoutKey(
      state.pendingSshExitBySessionId,
      sessionId,
    ),
    ignoredSshSessionIds: { ...state.ignoredSshSessionIds, [sessionId]: true },
  };
}

export function setSftpEntries(
  state: RemoteViewState,
  hostId: string,
  path: string,
  entries: RemoteFileEntry[],
): RemoteViewState {
  return {
    ...state,
    sftpPathByHostId: { ...state.sftpPathByHostId, [hostId]: path },
    sftpEntriesByHostPath: {
      ...state.sftpEntriesByHostPath,
      [`${hostId}:${path}`]: entries,
    },
  };
}

export function appendRemoteCommandOutput(
  state: RemoteViewState,
  runId: string,
  chunk: string,
): RemoteViewState {
  return {
    ...state,
    commandOutputByRunId: {
      ...state.commandOutputByRunId,
      [runId]: boundedOutput((state.commandOutputByRunId[runId] ?? "") + chunk),
    },
  };
}

export function setRemoteCommandResult(
  state: RemoteViewState,
  runId: string,
  result: RemoteCommandResult,
): RemoteViewState {
  return {
    ...state,
    commandResults: [result, ...state.commandResults].slice(0, 25),
    commandOutputByRunId: {
      ...state.commandOutputByRunId,
      [runId]: boundedOutput(
        `${state.commandOutputByRunId[runId] ?? ""}${result.stdout}${result.stderr}`,
      ),
    },
  };
}

function boundedOutput(value: string): string {
  return value.length > MAX_REMOTE_OUTPUT
    ? value.slice(value.length - MAX_REMOTE_OUTPUT)
    : value;
}

function withoutKey<T>(
  value: Record<string, T>,
  key: string,
): Record<string, T> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}
```

- [ ] **Step 4: Implement Tauri API wrappers**

Create `src/features/remote/remote-api.ts`:

```ts
import { listen } from "@tauri-apps/api/event";

import { call } from "../../lib/tauri";
import type {
  RemoteCommandResult,
  RemoteConnectionSnapshot,
  RemoteFileEntry,
  RemoteHostProfile,
  RemoteHostProfileInput,
  RemoteTransferResult,
  SshTerminalSessionInfo,
} from "./remote-model";

export type SshTerminalOutputEvent = {
  session_id: string;
  chunk: string;
};

export type SshTerminalExitEvent = {
  session_id: string;
  exit_code: number | null;
};

export function listRemoteHosts(workspaceRoot: string): Promise<RemoteHostProfile[]> {
  return call("list_remote_hosts", { workspaceRoot });
}

export function saveRemoteHost(
  input: RemoteHostProfileInput,
): Promise<RemoteHostProfile> {
  return call("save_remote_host", { input });
}

export function deleteRemoteHost(
  workspaceRoot: string,
  profileId: string,
): Promise<void> {
  return call("delete_remote_host", { workspaceRoot, profileId });
}

export function connectRemoteHost(
  profileId: string,
): Promise<RemoteConnectionSnapshot> {
  return call("connect_remote_host", { profileId });
}

export function disconnectRemoteHost(
  profileId: string,
): Promise<RemoteConnectionSnapshot> {
  return call("disconnect_remote_host", { profileId });
}

export function listSshTerminalSessions(
  workspaceId: string,
): Promise<SshTerminalSessionInfo[]> {
  return call("list_ssh_terminal_sessions", { workspaceId });
}

export function spawnSshTerminal(args: {
  workspaceId: string;
  workspaceRoot: string;
  profileId: string;
  rows: number;
  cols: number;
}): Promise<SshTerminalSessionInfo> {
  return call("spawn_ssh_terminal", args);
}

export function writeSshTerminal(
  sessionId: string,
  data: string,
): Promise<void> {
  return call("write_ssh_terminal", { sessionId, data });
}

export function closeSshTerminalSession(
  sessionId: string,
): Promise<SshTerminalSessionInfo> {
  return call("close_ssh_terminal", { sessionId });
}

export function runRemoteCommand(
  profileId: string,
  command: string,
): Promise<RemoteCommandResult> {
  return call("run_remote_command", { profileId, command });
}

export function listSftpDirectory(
  profileId: string,
  path: string,
): Promise<RemoteFileEntry[]> {
  return call("list_sftp_directory", { profileId, path });
}

export function downloadSftpFile(args: {
  workspaceRoot: string;
  profileId: string;
  remotePath: string;
  localRelativePath: string;
}): Promise<RemoteTransferResult> {
  return call("download_sftp_file", args);
}

export function uploadSftpFile(args: {
  workspaceRoot: string;
  profileId: string;
  localRelativePath: string;
  remotePath: string;
}): Promise<RemoteTransferResult> {
  return call("upload_sftp_file", args);
}

export function listenSshTerminalOutput(
  onEvent: (event: SshTerminalOutputEvent) => void,
): Promise<() => void> {
  return listen<SshTerminalOutputEvent>("workspace://ssh-terminal-output", (event) =>
    onEvent(event.payload),
  );
}

export function listenSshTerminalExit(
  onEvent: (event: SshTerminalExitEvent) => void,
): Promise<() => void> {
  return listen<SshTerminalExitEvent>("workspace://ssh-terminal-exit", (event) =>
    onEvent(event.payload),
  );
}
```

- [ ] **Step 5: Run GREEN and refactor**

Run:

```bash
bun test src/features/remote/remote-model.test.ts
bun run build
```

Expected: remote model tests PASS and TypeScript build PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git status --short
git add src/features/remote/remote-model.ts src/features/remote/remote-model.test.ts src/features/remote/remote-api.ts
git commit -m "feat: add remote frontend state"
```

---

### Task 4: Remote Panel, SFTP Browser, And Command UI

**Files:**
- Create: `src/features/remote/RemotePanel.tsx`
- Create: `src/features/remote/SftpBrowser.tsx`
- Create: `src/features/remote/RemoteCommandPanel.tsx`
- Create: `src/features/remote/RemotePanel.test.tsx`
- Modify: `src/styles/ide.css`

- [ ] **Step 1: Write failing RemotePanel tests from `docs/ui-design/panels.jsx`**

Create `src/features/remote/RemotePanel.test.tsx`:

```tsx
/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { ensureTestDom } from "../../app/test-dom";
import { createRemoteState, replaceRemoteHosts, setSftpEntries } from "./remote-model";
import { RemotePanel } from "./RemotePanel";

ensureTestDom();

const { cleanup, fireEvent, render } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
});

function stateWithHost() {
  const state = replaceRemoteHosts(createRemoteState(), [
    {
      id: "edge",
      workspace_root: "/repo",
      name: "edge-01",
      host: "edge.example.com",
      port: 22,
      username: "deploy",
      auth: "Agent",
      default_remote_path: "/var/www",
      keepalive_seconds: 30,
      connect_timeout_seconds: 10,
      created_ms: 1,
      updated_ms: 1,
    },
  ]);
  return setSftpEntries(state, "edge", "/var/www", [
    {
      host_id: "edge",
      path: "/var/www/app.js",
      name: "app.js",
      kind: "File",
      size: 42,
      modified_ms: null,
      link_target: null,
    },
  ]);
}

describe("RemotePanel", () => {
  test("renders compact SSH host rows and opens SSH terminal", () => {
    const onOpenSsh = mock(() => {});
    const result = render(
      <RemotePanel
        state={stateWithHost()}
        onModeChange={() => {}}
        onSelectHost={() => {}}
        onRefresh={() => {}}
        onCreateHost={() => {}}
        onConnectHost={() => {}}
        onOpenSsh={onOpenSsh}
        onOpenSftp={() => {}}
        onRunCommand={() => {}}
        onCommandDraftChange={() => {}}
        onListSftpDirectory={() => {}}
        onDownloadFile={() => {}}
        onUploadFile={() => {}}
      />,
    );

    expect(result.getByText("edge-01")).toBeTruthy();
    expect(result.getByText("deploy@edge.example.com")).toBeTruthy();
    fireEvent.click(result.getByLabelText("Open SSH for edge-01"));
    expect(onOpenSsh).toHaveBeenCalledWith("edge");
  });

  test("switches to SFTP and renders remote files", () => {
    const result = render(
      <RemotePanel
        state={stateWithHost()}
        onModeChange={() => {}}
        onSelectHost={() => {}}
        onRefresh={() => {}}
        onCreateHost={() => {}}
        onConnectHost={() => {}}
        onOpenSsh={() => {}}
        onOpenSftp={() => {}}
        onRunCommand={() => {}}
        onCommandDraftChange={() => {}}
        onListSftpDirectory={() => {}}
        onDownloadFile={() => {}}
        onUploadFile={() => {}}
      />,
    );

    fireEvent.click(result.getByRole("button", { name: "SFTP" }));

    expect(result.getByText("deploy@edge-01:/var/www")).toBeTruthy();
    expect(result.getByText("app.js")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run panel tests to verify RED**

Run:

```bash
bun test src/features/remote/RemotePanel.test.tsx
```

Expected: FAIL with module not found for `./RemotePanel`.

- [ ] **Step 3: Implement `RemotePanel.tsx`**

Create `src/features/remote/RemotePanel.tsx`:

```tsx
import {
  Play,
  Plus,
  RefreshCw,
  Server,
  TerminalSquare,
} from "lucide-react";

import type { RemoteViewState } from "./remote-model";
import { RemoteCommandPanel } from "./RemoteCommandPanel";
import { SftpBrowser } from "./SftpBrowser";

type RemotePanelProps = {
  state: RemoteViewState;
  onModeChange: (mode: RemoteViewState["mode"]) => void;
  onSelectHost: (hostId: string) => void;
  onRefresh: () => void;
  onCreateHost: () => void;
  onConnectHost: (hostId: string) => void;
  onOpenSsh: (hostId: string) => void;
  onOpenSftp: (hostId: string) => void;
  onRunCommand: () => void;
  onCommandDraftChange: (value: string) => void;
  onListSftpDirectory: (hostId: string, path: string) => void;
  onDownloadFile: (path: string) => void;
  onUploadFile: (path: string) => void;
};

export function RemotePanel({
  state,
  onModeChange,
  onSelectHost,
  onRefresh,
  onCreateHost,
  onConnectHost,
  onOpenSsh,
  onOpenSftp,
  onRunCommand,
  onCommandDraftChange,
  onListSftpDirectory,
  onDownloadFile,
  onUploadFile,
}: RemotePanelProps) {
  const activeHost = state.hosts.find((host) => host.id === state.activeHostId) ?? null;
  const activePath =
    activeHost ? (state.sftpPathByHostId[activeHost.id] ?? activeHost.default_remote_path) : "/";
  const entries =
    activeHost ? (state.sftpEntriesByHostPath[`${activeHost.id}:${activePath}`] ?? []) : [];

  return (
    <div className="panel-body remote-panel">
      <div className="remote-toolbar">
        <button type="button" className="iconbtn" title="New host" aria-label="New host" onClick={onCreateHost}>
          <Plus aria-hidden="true" />
        </button>
        <button type="button" className="iconbtn" title="Refresh remote hosts" aria-label="Refresh remote hosts" onClick={onRefresh}>
          <RefreshCw aria-hidden="true" />
        </button>
      </div>
      <div className="segmented remote-segments" role="tablist" aria-label="Remote mode">
        {(["ssh", "sftp", "commands"] as const).map((mode) => (
          <button
            type="button"
            key={mode}
            className={`seg${state.mode === mode ? " on" : ""}`}
            role="tab"
            aria-selected={state.mode === mode}
            onClick={() => onModeChange(mode)}
          >
            {mode === "ssh" ? "SSH" : mode === "sftp" ? "SFTP" : "Cmd"}
          </button>
        ))}
      </div>
      {state.error ? <div className="terminal-inline-error" role="alert">{state.error}</div> : null}
      {state.mode === "ssh" ? (
        <div className="remote-host-list">
          {state.hosts.map((host) => {
            const health = state.connectionByHostId[host.id];
            const connected = health?.status === "Connected";
            return (
              <div
                className={`remote-host-row${host.id === state.activeHostId ? " active" : ""}`}
                key={host.id}
                onClick={() => onSelectHost(host.id)}
              >
                <Server aria-hidden="true" className={connected ? "remote-connected" : ""} />
                <div className="remote-host-copy">
                  <span>{host.name}</span>
                  <span className="mono">{host.username}@{host.host}</span>
                </div>
                <span className={`remote-dot ${health?.status?.toLowerCase() ?? "disconnected"}`} />
                <button type="button" className="iconbtn" title={`Connect ${host.name}`} aria-label={`Connect ${host.name}`} onClick={(event) => {
                  event.stopPropagation();
                  onConnectHost(host.id);
                }}>
                  <Play aria-hidden="true" />
                </button>
                <button type="button" className="iconbtn" title={`Open SSH for ${host.name}`} aria-label={`Open SSH for ${host.name}`} onClick={(event) => {
                  event.stopPropagation();
                  onOpenSsh(host.id);
                }}>
                  <TerminalSquare aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      ) : state.mode === "sftp" && activeHost ? (
        <SftpBrowser
          host={activeHost}
          path={activePath}
          entries={entries}
          onOpenSftp={onOpenSftp}
          onListDirectory={onListSftpDirectory}
          onDownloadFile={onDownloadFile}
          onUploadFile={onUploadFile}
        />
      ) : state.mode === "commands" ? (
        <RemoteCommandPanel
          state={state}
          activeHost={activeHost}
          onDraftChange={onCommandDraftChange}
          onRunCommand={onRunCommand}
        />
      ) : (
        <div className="panel-empty">No remote hosts</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement `SftpBrowser.tsx`**

Create `src/features/remote/SftpBrowser.tsx`:

```tsx
import { Download, File, Folder, Upload } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

import type { RemoteFileEntry, RemoteHostProfile } from "./remote-model";

type SftpBrowserProps = {
  host: RemoteHostProfile;
  path: string;
  entries: RemoteFileEntry[];
  onOpenSftp: (hostId: string) => void;
  onListDirectory: (hostId: string, path: string) => void;
  onDownloadFile: (path: string) => void;
  onUploadFile: (path: string) => void;
};

export function SftpBrowser({
  host,
  path,
  entries,
  onOpenSftp,
  onListDirectory,
  onDownloadFile,
  onUploadFile,
}: SftpBrowserProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 8,
  });

  return (
    <div className="remote-sftp">
      <div className="section-label">
        <span className="mono">{host.username}@{host.name}:{path}</span>
      </div>
      <div className="remote-sftp-actions">
        <button type="button" className="btn sm" onClick={() => onOpenSftp(host.id)}>
          <Folder aria-hidden="true" />
          Open
        </button>
        <button type="button" className="btn sm" onClick={() => onUploadFile(path)}>
          <Upload aria-hidden="true" />
          Upload
        </button>
      </div>
      <div className="remote-sftp-list" ref={parentRef}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const entry = entries[item.index];
            if (!entry) {
              return null;
            }
            const directory = entry.kind === "Directory";
            const Icon = directory ? Folder : File;
            return (
              <button
                type="button"
                key={entry.path}
                className="remote-sftp-row"
                style={{ transform: `translateY(${item.start}px)` }}
                onClick={() =>
                  directory
                    ? onListDirectory(host.id, entry.path)
                    : onDownloadFile(entry.path)
                }
              >
                <Icon aria-hidden="true" className={directory ? "ico-folder" : "ico-md"} />
                <span className="nm mono">{entry.name}{entry.link_target ? ` -> ${entry.link_target}` : ""}</span>
                <span className="meta">{formatBytes(entry.size)}</span>
                {!directory ? <Download aria-hidden="true" className="remote-row-action" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatBytes(size: number | null): string {
  if (size === null) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  return `${Math.round(size / 1024)} KB`;
}
```

- [ ] **Step 5: Implement `RemoteCommandPanel.tsx`**

Create `src/features/remote/RemoteCommandPanel.tsx`:

```tsx
import { Play } from "lucide-react";

import type { RemoteHostProfile, RemoteViewState } from "./remote-model";

type RemoteCommandPanelProps = {
  state: RemoteViewState;
  activeHost: RemoteHostProfile | null;
  onDraftChange: (value: string) => void;
  onRunCommand: () => void;
};

export function RemoteCommandPanel({
  state,
  activeHost,
  onDraftChange,
  onRunCommand,
}: RemoteCommandPanelProps) {
  return (
    <div className="remote-command-panel">
      <div className="section-label">
        <span>{activeHost ? `${activeHost.username}@${activeHost.name}` : "No host"}</span>
      </div>
      <div className="remote-command-form">
        <input
          className="input2 mono"
          value={state.commandDraft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          aria-label="Remote command"
        />
        <button
          type="button"
          className="iconbtn"
          title="Run remote command"
          aria-label="Run remote command"
          disabled={!activeHost || state.commandDraft.trim().length === 0}
          onClick={onRunCommand}
        >
          <Play aria-hidden="true" />
        </button>
      </div>
      {state.commandResults.map((result) => (
        <div className="remote-command-result" key={`${result.host_id}:${result.command}:${result.duration_ms}`}>
          <div className="remote-command-title mono">{result.command}</div>
          <pre className="remote-command-output">{result.stdout}{result.stderr}</pre>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Add CSS from UI design**

Append compact styles to `src/styles/ide.css` near existing terminal/database panel styles:

```css
.remote-panel {
  padding: 0;
}

.remote-toolbar,
.remote-sftp-actions,
.remote-command-form {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 4px;
}

.remote-segments {
  margin: 8px 10px 4px;
}

.remote-host-list {
  display: flex;
  flex-direction: column;
}

.remote-host-row {
  min-height: 38px;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 8px 28px 28px;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 10px;
  border: 0;
  background: transparent;
  color: var(--txt);
  text-align: left;
}

.remote-host-row.active,
.remote-host-row:hover {
  background: var(--active);
}

.remote-host-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  line-height: 1.25;
}

.remote-host-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remote-host-copy .mono {
  color: var(--txt-faint);
  font-size: 10.5px;
}

.remote-connected {
  color: var(--yuzu);
}

.remote-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--txt-faint);
}

.remote-dot.connected {
  background: var(--yuzu);
  box-shadow: 0 0 0 2px var(--yuzu-wash);
}

.remote-dot.failed {
  background: var(--danger);
}

.remote-sftp-list {
  height: min(420px, calc(100vh - 300px));
  overflow: auto;
}

.remote-sftp-row {
  position: absolute;
  left: 0;
  right: 0;
  height: 28px;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto 16px;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: var(--txt);
  text-align: left;
}

.remote-sftp-row:hover {
  background: var(--active);
}

.remote-sftp-row .nm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remote-row-action {
  width: 14px;
  height: 14px;
  color: var(--txt-faint);
}

.remote-command-panel {
  padding-bottom: 10px;
}

.remote-command-form {
  padding-top: 10px;
}

.remote-command-form .input2 {
  min-width: 0;
  flex: 1;
}

.remote-command-result {
  border-top: 1px solid var(--line);
  padding: 8px 10px;
}

.remote-command-title {
  color: var(--txt-dim);
  font-size: 11px;
  margin-bottom: 6px;
}

.remote-command-output {
  max-height: 120px;
  overflow: auto;
  margin: 0;
  color: var(--txt);
  font-family: var(--font-mono);
  font-size: 11.5px;
  white-space: pre-wrap;
}
```

- [ ] **Step 7: Run GREEN and refactor**

Run:

```bash
bun test src/features/remote/RemotePanel.test.tsx
bun test src/features/remote/remote-model.test.ts
bun run build
```

Expected: tests PASS and build PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git status --short
git add src/features/remote/RemotePanel.tsx src/features/remote/SftpBrowser.tsx src/features/remote/RemoteCommandPanel.tsx src/features/remote/RemotePanel.test.tsx src/styles/ide.css
git commit -m "feat: add remote workbench panel"
```

---

### Task 5: AppShell Activity, Surfaces, Events, And Command Palette

**Files:**
- Modify: `src/app/activity-rail.tsx`
- Modify: `src/app/activity-rail.test.tsx`
- Modify: `src/app/command-palette-model.ts`
- Modify: `src/app/command-palette-model.test.ts`
- Modify: `src/app/workspace-view-state.ts`
- Modify: `src/app/workspace-view-state.test.ts`
- Modify: `src/app/AppShell.tsx`
- Create: `src/features/remote/SshTerminalSurface.tsx`
- Test: `src/app/AppShell.contract.test.tsx`

- [ ] **Step 1: Write failing integration tests**

Update `src/app/activity-rail.test.tsx` with:

```tsx
test("renders remote activity and notifies callback", () => {
  const onSelect = mock(() => {});
  const result = render(
    <ActivityRail
      active="explorer"
      onSelect={onSelect}
    />,
  );

  fireEvent.click(result.getByLabelText("Remotes"));

  expect(onSelect).toHaveBeenCalledWith("remote");
});
```

Update `src/app/command-palette-model.test.ts` imports to include `node10Commands`, then add:

```ts
test("includes remote commands in palette", () => {
  expect(node10Commands).toEqual([
    { id: "open-remote", label: "Remote: Open panel", group: "Remote" },
    { id: "remote-connect", label: "Remote: Connect active host", group: "Remote" },
    { id: "remote-open-ssh", label: "Remote: Open SSH terminal", group: "Remote" },
    { id: "remote-open-sftp", label: "Remote: Open SFTP browser", group: "Remote" },
  ]);
  expect(allCommands.map((command) => command.id)).toEqual(
    expect.arrayContaining([
      "open-remote",
      "remote-connect",
      "remote-open-ssh",
      "remote-open-sftp",
    ]),
  );
});
```

Update `src/app/workspace-view-state.test.ts` with:

```ts
test("default workspace view includes isolated remote state", () => {
  const store = createWorkspaceViewStore();
  const first = store.getState().viewFor("first");
  const second = store.getState().viewFor("second");

  expect(first.remote.hosts).toEqual([]);
  expect(first.remote).not.toBe(second.remote);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts
```

Expected: FAIL because Remote activity, commands, and remote workspace state are missing.

- [ ] **Step 3: Add activity rail and command palette wiring**

Modify `src/app/activity-rail.tsx`:

```tsx
import { Server } from "lucide-react";
```

Add `"remote"` to `KnownActivityId` before `"database"`:

```ts
| "remote"
```

Add the activity near Browser/Database:

```ts
{ id: "remote", label: "Remotes", icon: Server },
```

Modify `src/app/command-palette-model.ts`:

```ts
export const node10Commands: CommandItem[] = [
  { id: "open-remote", label: "Remote: Open panel", group: "Remote" },
  { id: "remote-connect", label: "Remote: Connect active host", group: "Remote" },
  { id: "remote-open-ssh", label: "Remote: Open SSH terminal", group: "Remote" },
  { id: "remote-open-sftp", label: "Remote: Open SFTP browser", group: "Remote" },
];
```

Append `...node10Commands` to `allCommands`.

- [ ] **Step 4: Add remote workspace state**

Modify `src/app/workspace-view-state.ts`:

```ts
import {
  createRemoteState,
  type RemoteViewState,
} from "../features/remote/remote-model";
```

Extend `Surface`:

```ts
| "ssh-terminal"
| "sftp-browser"
```

Extend `WorkspaceViewState`:

```ts
remote: RemoteViewState;
```

Add to `defaultWorkspaceView()`:

```ts
remote: createRemoteState(),
```

Add store updater:

```ts
updateRemote: (
  workspaceId: string | null,
  update: (remote: RemoteViewState) => RemoteViewState,
) => void;
```

Implement it beside `updateDatabase`:

```ts
updateRemote: (workspaceId, update) =>
  set((state) => {
    const key = workspaceId ?? shellKey;
    const current = state.views[key] ?? defaultView;

    return {
      views: {
        ...state.views,
        [key]: { ...current, remote: update(current.remote) },
      },
    };
  }),
```

Add freeze logic:

```ts
Object.freeze(view.remote.hosts);
Object.freeze(view.remote.connectionByHostId);
Object.freeze(view.remote.sshSessions);
Object.freeze(view.remote.sshOutputBySessionId);
Object.freeze(view.remote.pendingSshOutputBySessionId);
Object.freeze(view.remote.pendingSshExitBySessionId);
Object.freeze(view.remote.ignoredSshSessionIds);
Object.freeze(view.remote.sftpPathByHostId);
Object.freeze(view.remote.sftpEntriesByHostPath);
for (const entries of Object.values(view.remote.sftpEntriesByHostPath)) {
  Object.freeze(entries);
}
Object.freeze(view.remote.commandResults);
Object.freeze(view.remote.commandOutputByRunId);
if (view.remote.transfer) {
  Object.freeze(view.remote.transfer);
}
Object.freeze(view.remote);
```

- [ ] **Step 5: Add SSH terminal surface component**

Create `src/features/remote/SshTerminalSurface.tsx`:

```tsx
import { Plus, Server, X } from "lucide-react";
import { Suspense } from "react";

import { TerminalTab } from "../terminal/TerminalTab";
import type { RemoteViewState } from "./remote-model";

type SshTerminalSurfaceProps = {
  state: RemoteViewState;
  output: string;
  onActivate: (sessionId: string) => void;
  onInput: (sessionId: string, data: string) => void;
  onNewTerminal: () => void;
  onClose: (sessionId: string) => void;
};

export function SshTerminalSurface({
  state,
  output,
  onActivate,
  onInput,
  onNewTerminal,
  onClose,
}: SshTerminalSurfaceProps) {
  const active =
    state.sshSessions.find((session) => session.id === state.activeSshSessionId) ??
    state.sshSessions[0] ??
    null;

  if (!active) {
    return (
      <div className="terminal-empty-state">
        <Server aria-hidden="true" />
        <span>No SSH terminal sessions</span>
        <button type="button" className="btn primary" onClick={onNewTerminal}>
          <Plus aria-hidden="true" />
          Start SSH
        </button>
      </div>
    );
  }

  return (
    <div className="terminal-surface">
      <div className="term-tabs" role="tablist">
        {state.sshSessions.map((session) => (
          <button
            type="button"
            className={`tt${session.id === active.id ? " active" : ""}`}
            role="tab"
            aria-selected={session.id === active.id}
            key={session.id}
            onClick={() => onActivate(session.id)}
          >
            <Server aria-hidden="true" />
            <span className="tt-label">{session.name}</span>
            {!session.running ? <span className="meta">stopped</span> : null}
          </button>
        ))}
        <div className="term-tabs-spacer" />
        <button type="button" className="iconbtn" title="New SSH terminal" aria-label="New SSH terminal" onClick={onNewTerminal}>
          <Plus aria-hidden="true" />
        </button>
        <button type="button" className="iconbtn" title="Close SSH terminal" aria-label="Close SSH terminal" onClick={() => onClose(active.id)}>
          <X aria-hidden="true" />
        </button>
      </div>
      <Suspense fallback={<div className="editor-loading">Loading terminal</div>}>
        <TerminalTab
          key={active.id}
          sessionId={active.id}
          output={output}
          onInput={onInput}
        />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 6: Wire AppShell imports and state**

Modify `src/app/AppShell.tsx` imports:

```tsx
import { RemotePanel } from "../features/remote/RemotePanel";
import { SshTerminalSurface } from "../features/remote/SshTerminalSurface";
import {
  closeSshTerminalSession,
  connectRemoteHost,
  deleteRemoteHost,
  disconnectRemoteHost,
  downloadSftpFile,
  listRemoteHosts,
  listSftpDirectory,
  listSshTerminalSessions,
  runRemoteCommand,
  saveRemoteHost,
  spawnSshTerminal,
  uploadSftpFile,
  writeSshTerminal,
  listenSshTerminalExit,
  listenSshTerminalOutput,
} from "../features/remote/remote-api";
import {
  appendSshTerminalOutput,
  bufferSshTerminalExit,
  bufferSshTerminalOutput,
  closeSshTerminal,
  markRemoteConnection,
  markSshTerminalExited,
  replaceRemoteHosts,
  selectRemoteHost,
  setRemoteCommandResult,
  setRemoteMode,
  setSftpEntries,
  upsertSshTerminal,
} from "../features/remote/remote-model";
```

Add `remote: "Remote"` to `panelTitles`.

Read updater from store:

```ts
const updateRemote = useWorkspaceViewStore((state) => state.updateRemote);
```

Derive active SSH output:

```ts
const activeSshSession =
  view.remote.sshSessions.find(
    (session) => session.id === view.remote.activeSshSessionId,
  ) ??
  view.remote.sshSessions[0] ??
  null;
const activeSshOutput = activeSshSession
  ? (view.remote.sshOutputBySessionId[activeSshSession.id] ?? "")
  : "";
```

- [ ] **Step 7: Subscribe to SSH terminal events**

Add a `useEffect` near the local terminal event listeners:

```tsx
useEffect(() => {
  let disposed = false;
  let unlistenOutput: (() => void) | undefined;
  let unlistenExit: (() => void) | undefined;

  void listenSshTerminalOutput((event) => {
    if (disposed) {
      return;
    }
    const workspaceId = knownWorkspaceIdForSshTerminal(event.session_id);
    if (workspaceId) {
      updateRemote(workspaceId, (remote) =>
        appendSshTerminalOutput(remote, event.session_id, event.chunk),
      );
    } else {
      updateRemote(activeWorkspaceId, (remote) =>
        bufferSshTerminalOutput(remote, event.session_id, event.chunk),
      );
    }
  }).then((unlisten) => {
    unlistenOutput = unlisten;
  });

  void listenSshTerminalExit((event) => {
    if (disposed) {
      return;
    }
    const workspaceId = knownWorkspaceIdForSshTerminal(event.session_id);
    if (workspaceId) {
      updateRemote(workspaceId, (remote) =>
        markSshTerminalExited(remote, event.session_id),
      );
    } else {
      updateRemote(activeWorkspaceId, (remote) =>
        bufferSshTerminalExit(remote, event.session_id),
      );
    }
  }).then((unlisten) => {
    unlistenExit = unlisten;
  });

  return () => {
    disposed = true;
    unlistenOutput?.();
    unlistenExit?.();
  };
}, [activeWorkspaceId, updateRemote]);
```

Add helper:

```ts
function knownWorkspaceIdForSshTerminal(sessionId: string): string | null {
  for (const [workspaceId, workspaceView] of Object.entries(
    workspaceViewStore.getState().views,
  )) {
    if (
      workspaceView.remote.sshSessions.some((session) => session.id === sessionId)
    ) {
      return workspaceId;
    }
  }
  return null;
}
```

- [ ] **Step 8: Wire Remote panel handlers**

Add functions in `AppShell`:

```ts
async function refreshRemoteHosts() {
  if (!activeWorkspace) {
    return;
  }
  try {
    const hosts = await listRemoteHosts(activeWorkspace.path);
    updateRemote(activeWorkspaceId, (remote) => replaceRemoteHosts(remote, hosts));
  } catch (error) {
    updateRemote(activeWorkspaceId, (remote) => ({
      ...remote,
      error: `Remote refresh failed: ${terminalErrorMessage(error)}`,
    }));
  }
}

function selectRemoteHostById(hostId: string) {
  updateRemote(activeWorkspaceId, (remote) => selectRemoteHost(remote, hostId));
}

function setRemoteWorkbenchMode(mode: "ssh" | "sftp" | "commands") {
  updateRemote(activeWorkspaceId, (remote) => setRemoteMode(remote, mode));
}

async function connectActiveRemoteHost(hostId = view.remote.activeHostId) {
  if (!hostId) {
    return;
  }
  try {
    const snapshot = await connectRemoteHost(hostId);
    updateRemote(activeWorkspaceId, (remote) => markRemoteConnection(remote, snapshot));
  } catch (error) {
    updateRemote(activeWorkspaceId, (remote) => ({
      ...remote,
      error: `Connect failed: ${terminalErrorMessage(error)}`,
    }));
  }
}

async function openSshForHost(hostId = view.remote.activeHostId) {
  if (!activeWorkspace || !activeWorkspaceId || !hostId) {
    return;
  }
  try {
    const session = await spawnSshTerminal({
      workspaceId: activeWorkspaceId,
      workspaceRoot: activeWorkspace.path,
      profileId: hostId,
      rows: 24,
      cols: 80,
    });
    updateRemote(activeWorkspaceId, (remote) => upsertSshTerminal(remote, session));
    updateView(activeWorkspaceId, {
      activeActivity: "remote",
      surface: "ssh-terminal",
    });
  } catch (error) {
    updateRemote(activeWorkspaceId, (remote) => ({
      ...remote,
      error: `SSH failed: ${terminalErrorMessage(error)}`,
    }));
  }
}

async function openSftpForHost(hostId = view.remote.activeHostId) {
  const host = view.remote.hosts.find((item) => item.id === hostId);
  if (!host) {
    return;
  }
  try {
    const entries = await listSftpDirectory(host.id, host.default_remote_path);
    updateRemote(activeWorkspaceId, (remote) =>
      setSftpEntries(remote, host.id, host.default_remote_path, entries),
    );
    updateView(activeWorkspaceId, {
      activeActivity: "remote",
      surface: "sftp-browser",
    });
  } catch (error) {
    updateRemote(activeWorkspaceId, (remote) => ({
      ...remote,
      error: `SFTP failed: ${terminalErrorMessage(error)}`,
    }));
  }
}

function writeSshInput(sessionId: string, data: string) {
  void writeSshTerminal(sessionId, data).catch((error) => {
    updateRemote(activeWorkspaceId, (remote) => ({
      ...remote,
      error: `SSH input failed: ${terminalErrorMessage(error)}`,
    }));
  });
}

async function closeSshById(sessionId: string) {
  try {
    await closeSshTerminalSession(sessionId);
  } catch (error) {
    updateRemote(activeWorkspaceId, (remote) => ({
      ...remote,
      error: `Close SSH failed: ${terminalErrorMessage(error)}`,
    }));
  }
  updateRemote(activeWorkspaceId, (remote) => closeSshTerminal(remote, sessionId));
}
```

Add command runner:

```ts
async function runActiveRemoteCommand() {
  const hostId = view.remote.activeHostId;
  const command = view.remote.commandDraft.trim();
  if (!hostId || !command) {
    return;
  }
  try {
    const result = await runRemoteCommand(hostId, command);
    updateRemote(activeWorkspaceId, (remote) =>
      setRemoteCommandResult(remote, `${hostId}:${Date.now()}`, result),
    );
  } catch (error) {
    updateRemote(activeWorkspaceId, (remote) => ({
      ...remote,
      error: `Remote command failed: ${terminalErrorMessage(error)}`,
    }));
  }
}
```

- [ ] **Step 9: Render `RemotePanel` and surfaces**

In `PanelBody` props and call sites, add:

```tsx
remoteState: RemoteViewState;
onRemoteModeChange: (mode: RemoteViewState["mode"]) => void;
onRemoteSelectHost: (hostId: string) => void;
onRemoteRefresh: () => void;
onRemoteCreateHost: () => void;
onRemoteConnectHost: (hostId: string) => void;
onRemoteOpenSsh: (hostId: string) => void;
onRemoteOpenSftp: (hostId: string) => void;
onRemoteRunCommand: () => void;
onRemoteCommandDraftChange: (value: string) => void;
onRemoteListSftpDirectory: (hostId: string, path: string) => void;
onRemoteDownloadFile: (path: string) => void;
onRemoteUploadFile: (path: string) => void;
```

Add a `PanelBody` branch:

```tsx
if (active === "remote") {
  return (
    <RemotePanel
      state={remoteState}
      onModeChange={onRemoteModeChange}
      onSelectHost={onRemoteSelectHost}
      onRefresh={onRemoteRefresh}
      onCreateHost={onRemoteCreateHost}
      onConnectHost={onRemoteConnectHost}
      onOpenSsh={onRemoteOpenSsh}
      onOpenSftp={onRemoteOpenSftp}
      onRunCommand={onRemoteRunCommand}
      onCommandDraftChange={onRemoteCommandDraftChange}
      onListSftpDirectory={onRemoteListSftpDirectory}
      onDownloadFile={onRemoteDownloadFile}
      onUploadFile={onRemoteUploadFile}
    />
  );
}
```

Add main surface rendering:

```tsx
) : surface === "ssh-terminal" ? (
  <SshTerminalSurface
    state={view.remote}
    output={activeSshOutput}
    onActivate={(sessionId) =>
      updateRemote(activeWorkspaceId, (remote) => ({
        ...remote,
        activeSshSessionId: sessionId,
      }))
    }
    onInput={writeSshInput}
    onNewTerminal={() => void openSshForHost()}
    onClose={(sessionId) => void closeSshById(sessionId)}
  />
) : surface === "sftp-browser" ? (
  <div className="terminal-surface">
    <RemotePanel
      state={{ ...view.remote, mode: "sftp" }}
      onModeChange={setRemoteWorkbenchMode}
      onSelectHost={selectRemoteHostById}
      onRefresh={() => void refreshRemoteHosts()}
      onCreateHost={() => void createRemoteHostFromPrompt()}
      onConnectHost={(hostId) => void connectActiveRemoteHost(hostId)}
      onOpenSsh={(hostId) => void openSshForHost(hostId)}
      onOpenSftp={(hostId) => void openSftpForHost(hostId)}
      onRunCommand={() => void runActiveRemoteCommand()}
      onCommandDraftChange={(value) =>
        updateRemote(activeWorkspaceId, (remote) => ({
          ...remote,
          commandDraft: value,
        }))
      }
      onListSftpDirectory={(hostId, path) => void listRemoteDirectory(hostId, path)}
      onDownloadFile={(path) => void downloadRemoteFile(path)}
      onUploadFile={(path) => void uploadRemoteFile(path)}
    />
  </div>
```

Add tabstrip and breadcrumb branches for `"ssh-terminal"` and `"sftp-browser"` using `Server`/`Folder` icons.

- [ ] **Step 10: Add palette command handling**

Add `runCommand` cases:

```ts
case "open-remote":
  setActiveActivity("remote");
  setPanelOpen(true);
  break;
case "remote-connect":
  void connectActiveRemoteHost();
  break;
case "remote-open-ssh":
  void openSshForHost();
  break;
case "remote-open-sftp":
  void openSftpForHost();
  break;
```

- [ ] **Step 11: Run GREEN and refactor**

Run:

```bash
bun test src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts src/features/remote/RemotePanel.test.tsx
bun test src/app/AppShell.contract.test.tsx
bun run build
```

Expected: tests PASS and build PASS.

- [ ] **Step 12: Commit Task 5**

```bash
git status --short
git add src/app/activity-rail.tsx src/app/activity-rail.test.tsx src/app/command-palette-model.ts src/app/command-palette-model.test.ts src/app/workspace-view-state.ts src/app/workspace-view-state.test.ts src/app/AppShell.tsx src/features/remote/SshTerminalSurface.tsx
git commit -m "feat: integrate remote workbench"
```

---

### Task 6: Host Creation, Reconnect, SFTP Transfer Actions, And UI Evidence

**Files:**
- Modify: `src/app/AppShell.tsx`
- Modify: `src/features/remote/RemotePanel.tsx`
- Modify: `src/features/remote/RemotePanel.test.tsx`
- Modify: `src/features/remote/remote-model.ts`
- Modify: `src/features/remote/remote-model.test.ts`
- Modify: `src/styles/ide.css`

- [ ] **Step 1: Write failing tests for recoverable connection failures and transfer actions**

Extend `src/features/remote/RemotePanel.test.tsx`:

```tsx
test("shows connection failure and lets user retry", () => {
  const state = {
    ...stateWithHost(),
    connectionByHostId: {
      edge: {
        host_id: "edge",
        status: "Failed" as const,
        message: "edge.example.com refused connection",
        checked_ms: 1,
      },
    },
  };
  const onConnectHost = mock(() => {});

  const result = render(
    <RemotePanel
      state={state}
      onModeChange={() => {}}
      onSelectHost={() => {}}
      onRefresh={() => {}}
      onCreateHost={() => {}}
      onConnectHost={onConnectHost}
      onOpenSsh={() => {}}
      onOpenSftp={() => {}}
      onRunCommand={() => {}}
      onCommandDraftChange={() => {}}
      onListSftpDirectory={() => {}}
      onDownloadFile={() => {}}
      onUploadFile={() => {}}
    />,
  );

  expect(result.getByText("edge.example.com refused connection")).toBeTruthy();
  fireEvent.click(result.getByLabelText("Connect edge-01"));
  expect(onConnectHost).toHaveBeenCalledWith("edge");
});
```

Extend `src/features/remote/remote-model.test.ts`:

```ts
test("records latest transfer result and clears stale errors", () => {
  const state = recordRemoteTransfer(
    { ...createRemoteState(), error: "old" },
    {
      remote_path: "/var/www/app.js",
      local_path: "/repo/downloads/app.js",
      bytes: 42,
    },
  );

  expect(state.transfer?.bytes).toBe(42);
  expect(state.error).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/features/remote/RemotePanel.test.tsx src/features/remote/remote-model.test.ts
```

Expected: FAIL because failure message rendering and `recordRemoteTransfer` are missing.

- [ ] **Step 3: Implement transfer reducer and health copy**

Add to `remote-model.ts`:

```ts
export function recordRemoteTransfer(
  state: RemoteViewState,
  transfer: RemoteTransferResult,
): RemoteViewState {
  return { ...state, transfer, error: null };
}
```

In `RemotePanel.tsx`, render health message inside the SSH host row:

```tsx
{health?.status === "Failed" && health.message ? (
  <span className="remote-health mono">{health.message}</span>
) : null}
```

Place it inside `.remote-host-copy` below the `username@host` line.

Add CSS:

```css
.remote-health {
  color: var(--danger);
  font-size: 10.5px;
}
```

- [ ] **Step 4: Implement host creation using a compact prompt path**

In `AppShell.tsx`, add a narrow host-creation function that satisfies Node 10 without a large modal:

```ts
async function createRemoteHostFromPrompt() {
  if (!activeWorkspace) {
    return;
  }
  const target = window.prompt("SSH host as user@hostname[:port]", "deploy@edge.example.com");
  if (!target) {
    return;
  }
  const match = target.match(/^([^@\s]+)@([^:\s]+)(?::([0-9]{1,5}))?$/);
  if (!match) {
    updateRemote(activeWorkspaceId, (remote) => ({
      ...remote,
      error: "Use user@hostname[:port]",
    }));
    return;
  }
  const [, username, host, portValue] = match;
  try {
    const profile = await saveRemoteHost({
      workspace_root: activeWorkspace.path,
      name: host,
      host,
      port: portValue ? Number(portValue) : 22,
      username,
      auth_kind: "Agent",
      default_remote_path: ".",
      keepalive_seconds: 30,
      connect_timeout_seconds: 10,
    });
    updateRemote(activeWorkspaceId, (remote) =>
      replaceRemoteHosts(remote, [...remote.hosts.filter((item) => item.id !== profile.id), profile]),
    );
  } catch (error) {
    updateRemote(activeWorkspaceId, (remote) => ({
      ...remote,
      error: `Save host failed: ${terminalErrorMessage(error)}`,
    }));
  }
}
```

This keeps the first Node 10 UI shippable. Password and key profile editing is available through the Rust command contract and can be expanded by a later node without changing the persisted format.

- [ ] **Step 5: Implement list/download/upload handlers**

Add to `AppShell.tsx`:

```ts
async function listRemoteDirectory(hostId: string, path: string) {
  try {
    const entries = await listSftpDirectory(hostId, path);
    updateRemote(activeWorkspaceId, (remote) =>
      setSftpEntries(remote, hostId, path, entries),
    );
  } catch (error) {
    updateRemote(activeWorkspaceId, (remote) => ({
      ...remote,
      error: `SFTP list failed: ${terminalErrorMessage(error)}`,
    }));
  }
}

async function downloadRemoteFile(remotePath: string) {
  if (!activeWorkspace || !view.remote.activeHostId) {
    return;
  }
  const localRelativePath = window.prompt("Download to workspace path", `downloads/${remotePath.split("/").pop() ?? "remote-file"}`);
  if (!localRelativePath) {
    return;
  }
  try {
    const transfer = await downloadSftpFile({
      workspaceRoot: activeWorkspace.path,
      profileId: view.remote.activeHostId,
      remotePath,
      localRelativePath,
    });
    updateRemote(activeWorkspaceId, (remote) => recordRemoteTransfer(remote, transfer));
  } catch (error) {
    updateRemote(activeWorkspaceId, (remote) => ({
      ...remote,
      error: `Download failed: ${terminalErrorMessage(error)}`,
    }));
  }
}

async function uploadRemoteFile(remoteDirectory: string) {
  if (!activeWorkspace || !view.remote.activeHostId) {
    return;
  }
  const localRelativePath = window.prompt("Upload workspace path", "dist/app.js");
  if (!localRelativePath) {
    return;
  }
  const fileName = localRelativePath.split("/").pop() ?? "upload.bin";
  try {
    const transfer = await uploadSftpFile({
      workspaceRoot: activeWorkspace.path,
      profileId: view.remote.activeHostId,
      localRelativePath,
      remotePath: `${remoteDirectory.replace(/\/$/, "")}/${fileName}`,
    });
    updateRemote(activeWorkspaceId, (remote) => recordRemoteTransfer(remote, transfer));
  } catch (error) {
    updateRemote(activeWorkspaceId, (remote) => ({
      ...remote,
      error: `Upload failed: ${terminalErrorMessage(error)}`,
    }));
  }
}
```

Render transfer result in `RemotePanel.tsx`:

```tsx
{state.transfer ? (
  <div className="remote-transfer mono">
    {state.transfer.bytes} bytes · {state.transfer.remote_path}
  </div>
) : null}
```

Add CSS:

```css
.remote-transfer {
  padding: 6px 10px;
  color: var(--txt-dim);
  border-top: 1px solid var(--line);
}
```

- [ ] **Step 6: Run GREEN and visual/browser checks**

Run:

```bash
bun test src/features/remote/RemotePanel.test.tsx src/features/remote/remote-model.test.ts
bun run build
```

Then start the app shell dev server:

```bash
bun run dev --host 127.0.0.1
```

Open `http://127.0.0.1:5173` with the Browser plugin. Verify:

- Remote rail button is visible.
- Remote panel matches the compact UI from `docs/ui-design/panels.jsx`.
- SSH/SFTP segmented control does not overflow at 390px width.
- SFTP rows and transfer status do not overlap.
- SSH terminal surface can render an empty state without layout shift.

Stop the dev server before ending the task.

- [ ] **Step 7: Commit Task 6**

```bash
git status --short
git add src/app/AppShell.tsx src/features/remote/RemotePanel.tsx src/features/remote/RemotePanel.test.tsx src/features/remote/remote-model.ts src/features/remote/remote-model.test.ts src/styles/ide.css
git commit -m "feat: complete remote recovery and transfers"
```

---

### Task 7: Final Verification, Results Docs, Roadmap Update

**Files:**
- Create: `docs/architecture/node-10-remote-results.md`
- Modify: `docs/architecture/progress.md`
- Modify: `roadmap.md`

- [ ] **Step 1: Run full verification before documentation**

Run:

```bash
bun test
bun run build
. "$HOME/.cargo/env"
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
bun run tauri build --debug
```

Expected:
- `bun test`: PASS with no failed tests.
- `bun run build`: PASS.
- `cargo test`: PASS with no failed tests beyond any pre-existing ignored tests.
- `cargo fmt --check`: PASS.
- `cargo clippy`: PASS with no warnings.
- `bun run tauri build --debug`: PASS and produces macOS debug app/bundle artifacts.

- [ ] **Step 2: Run focused Node 10 smoke commands**

Run:

```bash
bun test src/features/remote/remote-model.test.ts src/features/remote/RemotePanel.test.tsx
bun test src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx
. "$HOME/.cargo/env"
cargo test --manifest-path src-tauri/Cargo.toml remote::tests
cargo test --manifest-path src-tauri/Cargo.toml remote::runtime_tests
```

Expected: all focused smoke commands PASS.

- [ ] **Step 3: Create results documentation**

Create `docs/architecture/node-10-remote-results.md`:

```markdown
# Node 10 Remote SSH And SFTP Results

Date: 2026-06-11

## Scope Delivered

- SSH host profiles are stored per registered workspace.
- SSH credentials are referenced by keyring secret IDs and raw secrets are not persisted in `remote-hosts.json`.
- SSH terminal sessions are exposed through the Remote workbench and use the existing lazy xterm renderer.
- SFTP directory browsing is available from the Remote panel and Remote surface.
- SFTP download and upload commands keep local paths inside the registered workspace root.
- Remote command tasks can run against the active host and show bounded output/results.
- Connection failures are visible in the Remote panel and retryable through the connect action.
- Host-specific settings include default remote path, keepalive seconds, and connect timeout seconds.

## TDD Evidence

### Task 1

- RED: `cargo test --manifest-path src-tauri/Cargo.toml remote::tests::save_host_profile_stores_password_in_secret_store_only` failed before profile types existed.
- GREEN: `cargo test --manifest-path src-tauri/Cargo.toml remote::tests` passed after profile store implementation.
- REFACTOR: `cargo fmt --manifest-path src-tauri/Cargo.toml --check` passed after command-scope cleanup.

### Task 2

- RED: `cargo test --manifest-path src-tauri/Cargo.toml remote::runtime_tests::remote_state_records_connection_failure_as_visible_health` failed before runtime types existed.
- GREEN: `cargo test --manifest-path src-tauri/Cargo.toml remote::runtime_tests` passed after runtime/backend implementation.
- REFACTOR: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` passed.

### Task 3

- RED: `bun test src/features/remote/remote-model.test.ts` failed before `remote-model.ts` existed.
- GREEN: `bun test src/features/remote/remote-model.test.ts` passed after reducers were implemented.
- REFACTOR: `bun run build` passed.

### Task 4

- RED: `bun test src/features/remote/RemotePanel.test.tsx` failed before `RemotePanel.tsx` existed.
- GREEN: `bun test src/features/remote/RemotePanel.test.tsx` passed after panel implementation.
- REFACTOR: `bun run build` passed after CSS/type cleanup.

### Task 5

- RED: `bun test src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts` failed before Remote integration.
- GREEN: The same command passed after Remote activity, commands, and state were wired.
- REFACTOR: `bun test src/app/AppShell.contract.test.tsx` and `bun run build` passed.

### Task 6

- RED: `bun test src/features/remote/RemotePanel.test.tsx src/features/remote/remote-model.test.ts` failed before recovery/transfer UI.
- GREEN: The same command passed after recovery and transfer reducers/UI.
- REFACTOR: Browser smoke verified the compact Remote panel and surfaces at desktop/mobile widths.

## Full Verification

- `bun test`: PASS
- `bun run build`: PASS
- `cargo test --manifest-path src-tauri/Cargo.toml`: PASS
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: PASS
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`: PASS
- `bun run tauri build --debug`: PASS

## Acceptance Criteria

- User can open SSH terminals per workspace: PASS
- User can browse and transfer files through SFTP: PASS
- Connection failures are visible and recoverable: PASS

## Residual Notes

- Node 10 intentionally does not implement full remote workspace editing.
- Node 10 intentionally does not implement remote container orchestration.
```

Replace each `PASS` line with actual command output counts before committing. Keep exact dates as `2026-06-11` unless implementation completes on a later calendar date; if later, use the actual date.

- [ ] **Step 4: Update `docs/architecture/progress.md`**

Add a Node 10 section after Node 9:

```markdown
### Node 10: Remote SSH And SFTP

Node 10 is complete. The implementation adds workspace-scoped SSH host profiles,
keyring-backed remote secrets, SSH terminal sessions, SFTP browsing and transfers,
remote command execution, and visible connection health/retry UI.

Evidence is recorded in `docs/architecture/node-10-remote-results.md`.

Next: Node 11 Extensions And Plugin System.
```

- [ ] **Step 5: Update `roadmap.md`**

In Node 10, mark Status complete and add an evidence bullet:

```markdown
**Status:** Complete

**Evidence:** See `docs/architecture/node-10-remote-results.md`.
```

Update `Current Priority`:

```markdown
Node 0 through Node 10 are complete. The next active priority is Node 11.
```

- [ ] **Step 6: Final scan**

Run:

```bash
rg -n "T(BD)|TO(DO)|place(holder)|0 tests|0 pass|skip verification" docs/architecture/node-10-remote-results.md docs/architecture/progress.md roadmap.md
git diff --check
git status --short
```

Expected: `rg` exits 1 with no matches, `git diff --check` exits 0, and `git status --short` lists only Node 10 docs if previous code tasks were already committed.

- [ ] **Step 7: Commit Node 10 documentation**

```bash
git add docs/architecture/node-10-remote-results.md docs/architecture/progress.md roadmap.md
git commit -m "docs: record node 10 remote results"
```

---

## Plan Self-Review

Spec coverage:
- SSH host profiles: Task 1, Task 4, Task 6.
- SSH terminal: Task 2, Task 3, Task 5.
- SFTP file browser: Task 2, Task 4, Task 5.
- Upload/download: Task 2, Task 6.
- Remote command tasks: Task 2, Task 3, Task 4, Task 6.
- Reconnect and connection health: Task 2, Task 4, Task 6.
- Host-specific settings: Task 1 stores default path, keepalive, and connect timeout.
- Acceptance criteria: Task 7 verifies SSH terminals, SFTP browsing/transfers, and visible recoverable failures.
- Non-goals preserved: no full remote workspace editing and no remote container orchestration.

Type consistency:
- Rust command names match `remote-api.ts`.
- Rust serde field names use snake_case and TypeScript wrappers send camelCase arguments only at Tauri command boundaries, matching existing `call` usage.
- Frontend `Surface` values are `"ssh-terminal"` and `"sftp-browser"` across state, AppShell rendering, tabs, and breadcrumbs.
- Remote output buffering mirrors the local terminal model to avoid unbounded frontend memory.
