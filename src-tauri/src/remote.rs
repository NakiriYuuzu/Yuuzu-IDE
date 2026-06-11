use keyring_core::Entry;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

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

pub struct RemoteState;

impl RemoteState {
    pub fn new() -> Self {
        Self
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
