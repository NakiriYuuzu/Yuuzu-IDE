use std::{
    collections::HashMap,
    ffi::OsString,
    fs,
    fs::OpenOptions,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub const DEBUG_LOG_LIMIT: usize = 120_000;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
pub enum DebugAdapterKind {
    Lldb,
    Python,
    Custom,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
pub enum DebugRequestKind {
    Launch,
    Attach,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DebugEnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DebugAttachConfig {
    pub pid: Option<u32>,
    pub host: Option<String>,
    pub port: Option<u16>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DebugLaunchConfigInput {
    pub id: Option<String>,
    pub workspace_root: String,
    pub name: String,
    pub adapter: DebugAdapterKind,
    pub request: DebugRequestKind,
    pub program: String,
    pub cwd: String,
    pub args: Vec<String>,
    pub env: Vec<DebugEnvVar>,
    pub stop_on_entry: bool,
    pub attach: Option<DebugAttachConfig>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DebugLaunchConfig {
    pub id: String,
    pub workspace_root: String,
    pub name: String,
    pub adapter: DebugAdapterKind,
    pub request: DebugRequestKind,
    pub program: String,
    pub cwd: String,
    pub args: Vec<String>,
    pub env: Vec<DebugEnvVar>,
    pub stop_on_entry: bool,
    pub attach: Option<DebugAttachConfig>,
    pub created_ms: u64,
    pub updated_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DebugSourceBreakpointInput {
    pub line: u32,
    pub condition: Option<String>,
    pub log_message: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DebugSourceBreakpoint {
    pub line: u32,
    pub condition: Option<String>,
    pub log_message: Option<String>,
}

pub fn encode_dap_message(value: &Value) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(value).map_err(|err| err.to_string())?;
    let mut frame = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    frame.extend(body);
    Ok(frame)
}

pub fn decode_dap_message(buffer: &mut Vec<u8>) -> Result<Option<Value>, String> {
    let Some(header_end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") else {
        return Ok(None);
    };

    let header = std::str::from_utf8(&buffer[..header_end]).map_err(|err| err.to_string())?;
    let content_length_value = header
        .lines()
        .find_map(|line| line.strip_prefix("Content-Length: "))
        .ok_or_else(|| "missing DAP Content-Length header".to_string())?;
    let content_length = content_length_value
        .parse::<usize>()
        .map_err(|err| format!("invalid DAP Content-Length: {err}"))?;

    let body_start = header_end + 4;
    let body_end = body_start
        .checked_add(content_length)
        .ok_or_else(|| "invalid DAP Content-Length exceeds frame bounds".to_string())?;
    if buffer.len() < body_end {
        return Ok(None);
    }

    let body = buffer[body_start..body_end].to_vec();
    buffer.drain(..body_end);
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|err| err.to_string())
}

pub fn normalize_debug_source_path(
    workspace_root: &Path,
    source_path: &str,
) -> Result<String, String> {
    if source_path.contains('\0') {
        return Err("source path cannot contain NUL".to_string());
    }

    let root = workspace_root
        .canonicalize()
        .map_err(|err| err.to_string())?;
    let candidate = if Path::new(source_path).is_absolute() {
        PathBuf::from(source_path)
    } else {
        root.join(source_path)
    };
    let normalized = normalize_path(&candidate)?;
    if !normalized.starts_with(&root) {
        return Err(format!(
            "source path outside workspace: {}",
            candidate.display()
        ));
    }

    let contained = if candidate.exists() {
        let canonical = candidate.canonicalize().map_err(|err| err.to_string())?;
        if !canonical.starts_with(&root) {
            return Err(format!(
                "source path outside workspace: {}",
                candidate.display()
            ));
        }
        canonical
    } else {
        normalized
    };

    let relative = contained
        .strip_prefix(&root)
        .map_err(|_| format!("source path outside workspace: {}", candidate.display()))?;
    relative_path_string(relative)
}

pub fn debug_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

pub fn new_debug_config_id() -> String {
    format!("debug-config-{}", Uuid::new_v4())
}

pub struct DebugLaunchConfigStore {
    path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl DebugLaunchConfigStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn list_configs(&self, workspace_root: &str) -> Result<Vec<DebugLaunchConfig>, String> {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        let mut configs = self.load()?;
        configs.retain(|config| config.workspace_root == workspace_root);
        configs.sort_by(|left, right| {
            left.name
                .cmp(&right.name)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(configs)
    }

    pub fn save_config<FNow, FId>(
        &self,
        input: DebugLaunchConfigInput,
        now: FNow,
        id_factory: FId,
    ) -> Result<DebugLaunchConfig, String>
    where
        FNow: Fn() -> Result<u64, String>,
        FId: Fn() -> String,
    {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        let now = now()?;
        let mut configs = self.load()?;
        let config_id = input.id.unwrap_or_else(&id_factory);
        let previous = configs
            .iter()
            .find(|config| config.id == config_id)
            .cloned();
        let created_ms = previous.as_ref().map_or(now, |config| config.created_ms);
        let config = DebugLaunchConfig {
            id: config_id.clone(),
            workspace_root: input.workspace_root,
            name: input.name,
            adapter: input.adapter,
            request: input.request,
            program: input.program,
            cwd: input.cwd,
            args: input.args,
            env: input.env,
            stop_on_entry: input.stop_on_entry,
            attach: input.attach,
            created_ms,
            updated_ms: now,
        };

        configs.retain(|config| config.id != config_id);
        configs.push(config.clone());
        self.save(&configs)?;
        Ok(config)
    }

    pub fn delete_config(&self, id: &str) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        let mut configs = self.load()?;
        let index = configs
            .iter()
            .position(|config| config.id == id)
            .ok_or_else(|| format!("debug launch config not found: {id}"))?;
        configs.remove(index);
        self.save(&configs)
    }

    pub fn get_config(&self, id: &str) -> Result<DebugLaunchConfig, String> {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        self.load()?
            .into_iter()
            .find(|config| config.id == id)
            .ok_or_else(|| format!("debug launch config not found: {id}"))
    }

    fn load(&self) -> Result<Vec<DebugLaunchConfig>, String> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }

        let value = fs::read_to_string(&self.path).map_err(|err| err.to_string())?;
        if value.trim().is_empty() {
            return Ok(Vec::new());
        }
        serde_json::from_str(&value).map_err(|err| err.to_string())
    }

    fn save(&self, configs: &[DebugLaunchConfig]) -> Result<(), String> {
        if let Some(parent) = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let value = serde_json::to_string_pretty(configs).map_err(|err| err.to_string())?;
        let parent = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let file_name = self
            .path
            .file_name()
            .unwrap_or_else(|| std::ffi::OsStr::new("debug-launch.json"));
        let file_name = OsString::from(file_name);
        let temp_path = parent.join(format!(
            ".{}.{}.tmp",
            file_name.to_string_lossy(),
            Uuid::new_v4()
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

#[derive(Default)]
pub struct DebugState {
    breakpoints: Arc<Mutex<HashMap<DebugBreakpointKey, Vec<DebugSourceBreakpoint>>>>,
}

impl DebugState {
    pub fn new_for_tests() -> Self {
        Self::default()
    }

    pub fn set_breakpoints(
        &self,
        workspace_id: String,
        workspace_root: String,
        source_path: String,
        breakpoints: Vec<DebugSourceBreakpointInput>,
    ) -> Result<Vec<DebugSourceBreakpoint>, String> {
        let key = DebugBreakpointKey {
            workspace_id,
            workspace_root,
            source_path,
        };
        let breakpoints = breakpoints
            .into_iter()
            .map(|breakpoint| DebugSourceBreakpoint {
                line: breakpoint.line,
                condition: breakpoint.condition,
                log_message: breakpoint.log_message,
            })
            .collect::<Vec<_>>();
        let mut state = self.breakpoints.lock().map_err(|err| err.to_string())?;
        state.insert(key, breakpoints.clone());
        Ok(breakpoints)
    }

    pub fn breakpoints_for(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        source_path: &str,
    ) -> Vec<DebugSourceBreakpoint> {
        let key = DebugBreakpointKey {
            workspace_id: workspace_id.to_string(),
            workspace_root: workspace_root.to_string(),
            source_path: source_path.to_string(),
        };
        self.breakpoints
            .lock()
            .map(|state| state.get(&key).cloned().unwrap_or_default())
            .unwrap_or_default()
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct DebugBreakpointKey {
    workspace_id: String,
    workspace_root: String,
    source_path: String,
}

fn normalize_path(path: &Path) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::Normal(value) => normalized.push(value),
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(format!("source path outside workspace: {}", path.display()));
                }
            }
        }
    }
    Ok(normalized)
}

fn relative_path_string(path: &Path) -> Result<String, String> {
    let parts = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>();
    if parts.is_empty() {
        return Err("source path must reference a file inside workspace".to_string());
    }
    Ok(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dap_framing_decodes_split_messages_and_rejects_missing_length() {
        let value = serde_json::json!({
            "seq": 1,
            "type": "request",
            "command": "initialize",
            "arguments": { "clientID": "yuuzu-ide" }
        });
        let encoded = encode_dap_message(&value).expect("encode");
        assert!(std::str::from_utf8(&encoded)
            .expect("utf8")
            .starts_with("Content-Length: "));

        let split_at = encoded.len() - 3;
        let mut buffer = encoded[..split_at].to_vec();
        assert_eq!(decode_dap_message(&mut buffer).expect("partial"), None);
        buffer.extend_from_slice(&encoded[split_at..]);
        assert_eq!(
            decode_dap_message(&mut buffer).expect("complete"),
            Some(value)
        );

        let mut bad = b"Content-Type: application/json\r\n\r\n{}".to_vec();
        assert!(decode_dap_message(&mut bad)
            .expect_err("missing length")
            .contains("Content-Length"));
    }

    #[test]
    fn save_launch_config_is_workspace_scoped_and_sorted() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = DebugLaunchConfigStore::new(temp.path().join("debug-launch.json"));
        let first = debug_config_input("/repo-a", "script", DebugAdapterKind::Python);
        let mut second = debug_config_input("/repo-a", "compiled", DebugAdapterKind::Lldb);
        second.id = Some("cfg-compiled".to_string());
        let other = debug_config_input("/repo-b", "other", DebugAdapterKind::Python);

        store
            .save_config(first, || Ok(10), || "cfg-script".to_string())
            .expect("script");
        store
            .save_config(other, || Ok(11), || "cfg-other".to_string())
            .expect("other");
        store
            .save_config(second, || Ok(12), || "cfg-fallback".to_string())
            .expect("compiled");

        let configs = store.list_configs("/repo-a").expect("list");
        assert_eq!(
            configs
                .iter()
                .map(|config| config.name.as_str())
                .collect::<Vec<_>>(),
            vec!["compiled", "script"],
        );
    }

    #[test]
    fn normalize_debug_source_path_rejects_paths_outside_workspace() {
        let temp = tempfile::tempdir().expect("tempdir");
        let workspace = temp.path();
        std::fs::create_dir_all(workspace.join("src")).expect("src dir");
        std::fs::write(workspace.join("src/main.rs"), "fn main() {}\n").expect("source");
        let outside = tempfile::NamedTempFile::new().expect("outside");

        let inside = normalize_debug_source_path(workspace, "src/main.rs").expect("inside");
        assert_eq!(inside, "src/main.rs");

        assert!(normalize_debug_source_path(workspace, "../main.rs")
            .expect_err("escape")
            .contains("outside workspace"));
        assert!(
            normalize_debug_source_path(workspace, outside.path().to_string_lossy().as_ref())
                .expect_err("outside")
                .contains("outside workspace")
        );
    }

    #[test]
    fn breakpoints_replace_per_source_without_cross_workspace_leakage() {
        let state = DebugState::new_for_tests();
        let workspace_a = "/repo-a";
        let workspace_b = "/repo-b";

        let a = state
            .set_breakpoints(
                "workspace-a".to_string(),
                workspace_a.to_string(),
                "src/main.rs".to_string(),
                vec![DebugSourceBreakpointInput {
                    line: 12,
                    condition: None,
                    log_message: None,
                }],
            )
            .expect("set a");
        let b = state
            .set_breakpoints(
                "workspace-b".to_string(),
                workspace_b.to_string(),
                "src/main.rs".to_string(),
                vec![DebugSourceBreakpointInput {
                    line: 3,
                    condition: Some("x > 1".to_string()),
                    log_message: None,
                }],
            )
            .expect("set b");

        assert_eq!(a[0].line, 12);
        assert_eq!(b[0].line, 3);
        assert_eq!(
            state
                .breakpoints_for("workspace-a", workspace_a, "src/main.rs")
                .len(),
            1
        );
        assert_eq!(
            state
                .breakpoints_for("workspace-b", workspace_b, "src/main.rs")
                .len(),
            1
        );
    }

    fn debug_config_input(
        workspace_root: &str,
        name: &str,
        adapter: DebugAdapterKind,
    ) -> DebugLaunchConfigInput {
        DebugLaunchConfigInput {
            id: None,
            workspace_root: workspace_root.to_string(),
            name: name.to_string(),
            adapter,
            request: DebugRequestKind::Launch,
            program: "src/main.py".to_string(),
            cwd: ".".to_string(),
            args: vec!["--port".to_string(), "3000".to_string()],
            env: vec![DebugEnvVar {
                key: "RUST_LOG".to_string(),
                value: "debug".to_string(),
            }],
            stop_on_entry: true,
            attach: None,
        }
    }
}
