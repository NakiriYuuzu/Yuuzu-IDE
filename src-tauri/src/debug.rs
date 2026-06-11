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
pub const DAP_MESSAGE_BODY_LIMIT: usize = 120_000;

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
    pub verified: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DebugStartSessionRequest {
    pub workspace_id: String,
    pub workspace_root: String,
    pub config: DebugLaunchConfig,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum DebugSessionStatus {
    Starting,
    Running,
    Stopped,
    Exited,
    Disconnected,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DebugSessionInfo {
    pub id: String,
    pub workspace_id: String,
    pub workspace_root: String,
    pub config_id: String,
    pub name: String,
    pub adapter: DebugAdapterKind,
    pub status: DebugSessionStatus,
    pub active_thread_id: Option<i64>,
    pub stopped_reason: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DebugAdapterEvent {
    pub session_id: String,
    pub event: String,
    pub body: Value,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DebugStackFrame {
    pub id: i64,
    pub name: String,
    pub source_path: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DebugScope {
    pub name: String,
    pub variables_reference: i64,
    pub expensive: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DebugVariable {
    pub name: String,
    pub value: String,
    #[serde(rename = "type")]
    pub type_name: Option<String>,
    pub variables_reference: i64,
}

#[derive(Clone, Debug)]
pub struct ScriptedDebugAdapter {
    stopped_line: u32,
    logs: Vec<String>,
}

impl ScriptedDebugAdapter {
    pub fn python_stopped_at_line(line: u32) -> Self {
        Self {
            stopped_line: line,
            logs: vec![
                "console: Python debug adapter launched".to_string(),
                format!("stopped at breakpoint line {line}"),
            ],
        }
    }

    fn launch(&self, request: DebugStartSessionRequest, session_id: String) -> DebugSessionRecord {
        let variables_reference = 1_000;
        let frame_id = 1;
        let thread_id = 1;
        let counter = DebugVariable {
            name: "counter".to_string(),
            value: "8".to_string(),
            type_name: Some("int".to_string()),
            variables_reference: 0,
        };
        let frame = DebugStackFrame {
            id: frame_id,
            name: "main".to_string(),
            source_path: request.config.program.clone(),
            line: self.stopped_line,
            column: 1,
        };
        let scope = DebugScope {
            name: "Locals".to_string(),
            variables_reference,
            expensive: false,
        };
        let info = DebugSessionInfo {
            id: session_id,
            workspace_id: request.workspace_id,
            workspace_root: request.workspace_root,
            config_id: request.config.id,
            name: request.config.name,
            adapter: request.config.adapter,
            status: DebugSessionStatus::Stopped,
            active_thread_id: Some(thread_id),
            stopped_reason: Some("breakpoint".to_string()),
            last_error: None,
        };

        DebugSessionRecord {
            info,
            stack_by_thread: HashMap::from([(thread_id, vec![frame])]),
            scopes_by_frame: HashMap::from([(frame_id, vec![scope])]),
            variables_by_reference: HashMap::from([(variables_reference, vec![counter.clone()])]),
            evaluate_results: HashMap::from([("counter".to_string(), counter)]),
            breakpoints_by_source: HashMap::new(),
        }
    }

    fn verify_breakpoints(
        &self,
        breakpoints: Vec<DebugSourceBreakpointInput>,
    ) -> Vec<DebugSourceBreakpoint> {
        breakpoints
            .into_iter()
            .map(|breakpoint| DebugSourceBreakpoint {
                line: breakpoint.line,
                condition: breakpoint.condition,
                log_message: breakpoint.log_message,
                verified: breakpoint.line == self.stopped_line,
            })
            .collect()
    }
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
    if content_length > DAP_MESSAGE_BODY_LIMIT {
        return Err(format!(
            "DAP message body too large: {content_length} bytes exceeds {DAP_MESSAGE_BODY_LIMIT}"
        ));
    }

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
        let existing_parent = nearest_existing_parent(&normalized)?
            .canonicalize()
            .map_err(|err| err.to_string())?;
        if !existing_parent.starts_with(&root) {
            return Err(format!(
                "source path outside workspace: {}",
                candidate.display()
            ));
        }
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

#[derive(Clone, Debug)]
struct DebugSessionRecord {
    info: DebugSessionInfo,
    stack_by_thread: HashMap<i64, Vec<DebugStackFrame>>,
    scopes_by_frame: HashMap<i64, Vec<DebugScope>>,
    variables_by_reference: HashMap<i64, Vec<DebugVariable>>,
    evaluate_results: HashMap<String, DebugVariable>,
    breakpoints_by_source: HashMap<String, Vec<DebugSourceBreakpoint>>,
}

#[derive(Default)]
struct DebugRuntimeState {
    next_by_workspace: HashMap<String, usize>,
    test_adapters: HashMap<DebugAdapterKind, ScriptedDebugAdapter>,
    sessions: HashMap<String, DebugSessionRecord>,
    logs_by_workspace: HashMap<String, Vec<String>>,
}

#[derive(Default)]
pub struct DebugState {
    breakpoints: Arc<Mutex<HashMap<DebugBreakpointKey, Vec<DebugSourceBreakpoint>>>>,
    runtime: Arc<Mutex<DebugRuntimeState>>,
}

impl DebugState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn new_for_tests() -> Self {
        Self::new()
    }

    pub fn install_test_adapter(&self, adapter: DebugAdapterKind, scripted: ScriptedDebugAdapter) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.test_adapters.insert(adapter, scripted);
        }
    }

    pub fn start_session(
        &self,
        request: DebugStartSessionRequest,
    ) -> Result<DebugSessionInfo, String> {
        if request.config.workspace_root != request.workspace_root {
            return Err("debug launch config does not belong to workspace".to_string());
        }

        let mut runtime = self.runtime.lock().map_err(|err| err.to_string())?;
        let adapter = runtime
            .test_adapters
            .get(&request.config.adapter)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "debug adapter is not available for {:?}",
                    request.config.adapter
                )
            })?;
        let next = runtime
            .next_by_workspace
            .entry(request.workspace_id.clone())
            .or_insert(1);
        let session_id = format!("{}:debug-{next}", request.workspace_id);
        *next += 1;

        let workspace_id = request.workspace_id.clone();
        let logs = adapter.logs.clone();
        let record = adapter.launch(request, session_id);
        let info = record.info.clone();
        runtime.sessions.insert(info.id.clone(), record);
        push_workspace_log(
            &mut runtime.logs_by_workspace,
            &workspace_id,
            format!("started debug session {}", info.id),
        );
        for log in logs {
            push_workspace_log(&mut runtime.logs_by_workspace, &workspace_id, log);
        }
        Ok(info)
    }

    pub fn start_test_python_session(
        &self,
        workspace_id: &str,
        workspace_root: &str,
    ) -> Result<DebugSessionInfo, String> {
        self.start_session(DebugStartSessionRequest {
            workspace_id: workspace_id.to_string(),
            workspace_root: workspace_root.to_string(),
            config: DebugLaunchConfig {
                id: "cfg-test-python".to_string(),
                workspace_root: workspace_root.to_string(),
                name: "Python file".to_string(),
                adapter: DebugAdapterKind::Python,
                request: DebugRequestKind::Launch,
                program: "app.py".to_string(),
                cwd: ".".to_string(),
                args: Vec::new(),
                env: Vec::new(),
                stop_on_entry: true,
                attach: None,
                created_ms: 1,
                updated_ms: 1,
            },
        })
    }

    pub fn list_sessions(&self, workspace_id: &str) -> Vec<DebugSessionInfo> {
        let Ok(runtime) = self.runtime.lock() else {
            return Vec::new();
        };
        let mut sessions = runtime
            .sessions
            .values()
            .filter(|record| record.info.workspace_id == workspace_id)
            .map(|record| record.info.clone())
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| left.id.cmp(&right.id));
        sessions
    }

    pub fn session_belongs_to(
        &self,
        session_id: &str,
        workspace_id: &str,
        workspace_root: &str,
    ) -> Result<bool, String> {
        let runtime = self.runtime.lock().map_err(|err| err.to_string())?;
        let Some(record) = runtime.sessions.get(session_id) else {
            return Err(format!("debug session not found: {session_id}"));
        };
        Ok(
            record.info.workspace_id == workspace_id
                && record.info.workspace_root == workspace_root,
        )
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
                verified: false,
            })
            .collect::<Vec<_>>();
        let mut state = self.breakpoints.lock().map_err(|err| err.to_string())?;
        state.insert(key, breakpoints.clone());
        Ok(breakpoints)
    }

    pub fn set_session_breakpoints(
        &self,
        session_id: &str,
        source_path: String,
        breakpoints: Vec<DebugSourceBreakpointInput>,
    ) -> Result<Vec<DebugSourceBreakpoint>, String> {
        let mut runtime = self.runtime.lock().map_err(|err| err.to_string())?;
        let adapter_kind = runtime
            .sessions
            .get(session_id)
            .map(|record| record.info.adapter)
            .ok_or_else(|| format!("debug session not found: {session_id}"))?;
        let breakpoints = if let Some(adapter) = runtime.test_adapters.get(&adapter_kind) {
            adapter.verify_breakpoints(breakpoints)
        } else {
            breakpoints
                .into_iter()
                .map(|breakpoint| DebugSourceBreakpoint {
                    line: breakpoint.line,
                    condition: breakpoint.condition,
                    log_message: breakpoint.log_message,
                    verified: false,
                })
                .collect()
        };
        let workspace_id = {
            let record = runtime
                .sessions
                .get_mut(session_id)
                .ok_or_else(|| format!("debug session not found: {session_id}"))?;
            record
                .breakpoints_by_source
                .insert(source_path.clone(), breakpoints.clone());
            record.info.workspace_id.clone()
        };
        push_workspace_log(
            &mut runtime.logs_by_workspace,
            &workspace_id,
            format!(
                "set {} breakpoints for session {session_id} in {source_path}",
                breakpoints.len()
            ),
        );
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

    pub fn continue_session(&self, session_id: &str) -> Result<DebugSessionInfo, String> {
        let mut runtime = self.runtime.lock().map_err(|err| err.to_string())?;
        let (workspace_id, info) = {
            let record = runtime
                .sessions
                .get_mut(session_id)
                .ok_or_else(|| format!("debug session not found: {session_id}"))?;
            ensure_session_can_run(&record.info)?;
            record.info.status = DebugSessionStatus::Running;
            record.info.stopped_reason = None;
            (record.info.workspace_id.clone(), record.info.clone())
        };
        push_workspace_log(
            &mut runtime.logs_by_workspace,
            &workspace_id,
            format!("continued debug session {session_id}"),
        );
        Ok(info)
    }

    pub fn step_over(&self, session_id: &str) -> Result<DebugSessionInfo, String> {
        let mut runtime = self.runtime.lock().map_err(|err| err.to_string())?;
        let (workspace_id, info) = {
            let record = runtime
                .sessions
                .get_mut(session_id)
                .ok_or_else(|| format!("debug session not found: {session_id}"))?;
            ensure_session_can_run(&record.info)?;
            if let Some(thread_id) = record.info.active_thread_id {
                if let Some(frames) = record.stack_by_thread.get_mut(&thread_id) {
                    if let Some(frame) = frames.first_mut() {
                        frame.line = frame.line.saturating_add(1);
                    }
                }
            }
            record.info.status = DebugSessionStatus::Stopped;
            record.info.stopped_reason = Some("step".to_string());
            (record.info.workspace_id.clone(), record.info.clone())
        };
        push_workspace_log(
            &mut runtime.logs_by_workspace,
            &workspace_id,
            format!("stepped over debug session {session_id}"),
        );
        Ok(info)
    }

    pub fn pause(&self, session_id: &str) -> Result<DebugSessionInfo, String> {
        let mut runtime = self.runtime.lock().map_err(|err| err.to_string())?;
        let (workspace_id, info) = {
            let record = runtime
                .sessions
                .get_mut(session_id)
                .ok_or_else(|| format!("debug session not found: {session_id}"))?;
            ensure_session_can_run(&record.info)?;
            record.info.status = DebugSessionStatus::Stopped;
            record.info.stopped_reason = Some("pause".to_string());
            record.info.active_thread_id = record.info.active_thread_id.or(Some(1));
            (record.info.workspace_id.clone(), record.info.clone())
        };
        push_workspace_log(
            &mut runtime.logs_by_workspace,
            &workspace_id,
            format!("paused debug session {session_id}"),
        );
        Ok(info)
    }

    pub fn disconnect_session(&self, session_id: &str) -> Result<DebugSessionInfo, String> {
        let mut runtime = self.runtime.lock().map_err(|err| err.to_string())?;
        let (workspace_id, info) = {
            let record = runtime
                .sessions
                .get_mut(session_id)
                .ok_or_else(|| format!("debug session not found: {session_id}"))?;
            record.info.status = DebugSessionStatus::Disconnected;
            record.info.stopped_reason = None;
            (record.info.workspace_id.clone(), record.info.clone())
        };
        push_workspace_log(
            &mut runtime.logs_by_workspace,
            &workspace_id,
            format!("disconnected debug session {session_id}"),
        );
        Ok(info)
    }

    pub fn stack_trace(
        &self,
        session_id: &str,
        thread_id: i64,
    ) -> Result<Vec<DebugStackFrame>, String> {
        let runtime = self.runtime.lock().map_err(|err| err.to_string())?;
        let record = runtime
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("debug session not found: {session_id}"))?;
        Ok(record
            .stack_by_thread
            .get(&thread_id)
            .cloned()
            .unwrap_or_default())
    }

    pub fn scopes(&self, session_id: &str, frame_id: i64) -> Result<Vec<DebugScope>, String> {
        let runtime = self.runtime.lock().map_err(|err| err.to_string())?;
        let record = runtime
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("debug session not found: {session_id}"))?;
        Ok(record
            .scopes_by_frame
            .get(&frame_id)
            .cloned()
            .unwrap_or_default())
    }

    pub fn variables(
        &self,
        session_id: &str,
        variables_reference: i64,
    ) -> Result<Vec<DebugVariable>, String> {
        let runtime = self.runtime.lock().map_err(|err| err.to_string())?;
        let record = runtime
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("debug session not found: {session_id}"))?;
        Ok(record
            .variables_by_reference
            .get(&variables_reference)
            .cloned()
            .unwrap_or_default())
    }

    pub fn evaluate(&self, session_id: &str, expression: &str) -> Result<DebugVariable, String> {
        let runtime = self.runtime.lock().map_err(|err| err.to_string())?;
        let record = runtime
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("debug session not found: {session_id}"))?;
        let expression = expression.trim();
        Ok(record
            .evaluate_results
            .get(expression)
            .cloned()
            .unwrap_or_else(|| DebugVariable {
                name: expression.to_string(),
                value: "<unavailable>".to_string(),
                type_name: None,
                variables_reference: 0,
            }))
    }

    pub fn session_logs(&self, workspace_id: &str) -> Vec<String> {
        self.runtime
            .lock()
            .map(|runtime| {
                runtime
                    .logs_by_workspace
                    .get(workspace_id)
                    .cloned()
                    .unwrap_or_default()
            })
            .unwrap_or_default()
    }

    pub fn handle_debug_event(&self, event: DebugAdapterEvent) -> Result<(), String> {
        let mut runtime = self.runtime.lock().map_err(|err| err.to_string())?;
        let Some(record) = runtime.sessions.get_mut(&event.session_id) else {
            return Ok(());
        };
        let workspace_id = record.info.workspace_id.clone();
        let log_message = if matches!(
            record.info.status,
            DebugSessionStatus::Disconnected
                | DebugSessionStatus::Exited
                | DebugSessionStatus::Failed
        ) {
            format!(
                "ignored late event {} for session {}",
                event.event, event.session_id
            )
        } else {
            apply_debug_event(record, &event)
        };
        push_workspace_log(&mut runtime.logs_by_workspace, &workspace_id, log_message);
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct DebugBreakpointKey {
    workspace_id: String,
    workspace_root: String,
    source_path: String,
}

fn ensure_session_can_run(info: &DebugSessionInfo) -> Result<(), String> {
    match info.status {
        DebugSessionStatus::Disconnected => Err("debug session is disconnected".to_string()),
        DebugSessionStatus::Exited => Err("debug session has exited".to_string()),
        DebugSessionStatus::Failed => Err("debug session has failed".to_string()),
        DebugSessionStatus::Starting
        | DebugSessionStatus::Running
        | DebugSessionStatus::Stopped => Ok(()),
    }
}

fn apply_debug_event(record: &mut DebugSessionRecord, event: &DebugAdapterEvent) -> String {
    match event.event.as_str() {
        "stopped" => {
            record.info.status = DebugSessionStatus::Stopped;
            record.info.stopped_reason = event
                .body
                .get("reason")
                .and_then(Value::as_str)
                .map(str::to_string);
            record.info.active_thread_id = event.body.get("threadId").and_then(Value::as_i64);
            format!("debug event stopped for session {}", event.session_id)
        }
        "continued" => {
            record.info.status = DebugSessionStatus::Running;
            record.info.stopped_reason = None;
            "debug event continued".to_string()
        }
        "exited" => {
            record.info.status = DebugSessionStatus::Exited;
            record.info.stopped_reason = None;
            "debug event exited".to_string()
        }
        "terminated" => {
            record.info.status = DebugSessionStatus::Exited;
            record.info.stopped_reason = None;
            "debug event terminated".to_string()
        }
        "output" => event
            .body
            .get("output")
            .and_then(Value::as_str)
            .map_or_else(|| "debug output event".to_string(), str::to_string),
        other => format!("debug event {other}"),
    }
}

fn push_workspace_log(
    logs_by_workspace: &mut HashMap<String, Vec<String>>,
    workspace_id: &str,
    message: String,
) {
    let logs = logs_by_workspace
        .entry(workspace_id.to_string())
        .or_default();
    logs.push(message);
    while logs.iter().map(String::len).sum::<usize>() > DEBUG_LOG_LIMIT {
        if logs.is_empty() {
            break;
        }
        logs.remove(0);
    }
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

fn nearest_existing_parent(path: &Path) -> Result<PathBuf, String> {
    let mut current = path
        .parent()
        .ok_or_else(|| "source path has no parent".to_string())?
        .to_path_buf();
    while !current.exists() {
        current = current
            .parent()
            .ok_or_else(|| "source path has no existing parent".to_string())?
            .to_path_buf();
    }
    Ok(current)
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
    fn dap_framing_rejects_oversized_content_length() {
        let mut buffer =
            format!("Content-Length: {}\r\n\r\n", DAP_MESSAGE_BODY_LIMIT + 1).into_bytes();

        assert!(decode_dap_message(&mut buffer)
            .expect_err("oversized frame")
            .contains("too large"));
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
    fn normalize_debug_source_path_rejects_nonexistent_child_below_symlinked_parent() {
        let temp = tempfile::tempdir().expect("tempdir");
        let outside = tempfile::tempdir().expect("outside");
        create_dir_symlink(outside.path(), &temp.path().join("link")).expect("symlink");

        assert!(normalize_debug_source_path(temp.path(), "link/new.py")
            .expect_err("symlink escape")
            .contains("outside workspace"));
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

    fn create_dir_symlink(target: &std::path::Path, link: &std::path::Path) -> std::io::Result<()> {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link)
        }

        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_dir(target, link)
        }
    }
}

#[cfg(test)]
mod runtime_tests {
    use super::*;

    #[test]
    fn scripted_adapter_launch_sets_breakpoints_and_records_stopped_stack_variables() {
        let state = DebugState::new_for_tests();
        state.install_test_adapter(
            DebugAdapterKind::Python,
            ScriptedDebugAdapter::python_stopped_at_line(8),
        );

        let session = state
            .start_session(DebugStartSessionRequest {
                workspace_id: "workspace-a".to_string(),
                workspace_root: "/repo".to_string(),
                config: DebugLaunchConfig {
                    id: "cfg-script".to_string(),
                    workspace_root: "/repo".to_string(),
                    name: "Python file".to_string(),
                    adapter: DebugAdapterKind::Python,
                    request: DebugRequestKind::Launch,
                    program: "app.py".to_string(),
                    cwd: ".".to_string(),
                    args: Vec::new(),
                    env: Vec::new(),
                    stop_on_entry: true,
                    attach: None,
                    created_ms: 1,
                    updated_ms: 1,
                },
            })
            .expect("start");

        assert_eq!(session.workspace_id, "workspace-a");
        assert_eq!(session.status, DebugSessionStatus::Stopped);

        let breakpoints = state
            .set_session_breakpoints(
                &session.id,
                "app.py".to_string(),
                vec![DebugSourceBreakpointInput {
                    line: 8,
                    condition: None,
                    log_message: None,
                }],
            )
            .expect("breakpoints");
        assert!(breakpoints[0].verified);

        let stack = state.stack_trace(&session.id, 1).expect("stack");
        assert_eq!(stack[0].name, "main");
        let scopes = state.scopes(&session.id, stack[0].id).expect("scopes");
        let variables = state
            .variables(&session.id, scopes[0].variables_reference)
            .expect("variables");
        assert_eq!(variables[0].name, "counter");
        assert_eq!(variables[0].value, "8");
    }

    #[test]
    fn late_events_for_disconnected_session_are_logged_but_do_not_reactivate_session() {
        let state = DebugState::new_for_tests();
        state.install_test_adapter(
            DebugAdapterKind::Python,
            ScriptedDebugAdapter::python_stopped_at_line(8),
        );
        let session = state
            .start_test_python_session("workspace-a", "/repo")
            .expect("start");

        state.disconnect_session(&session.id).expect("disconnect");
        state
            .handle_debug_event(DebugAdapterEvent {
                session_id: session.id.clone(),
                event: "stopped".to_string(),
                body: serde_json::json!({ "reason": "breakpoint", "threadId": 1 }),
            })
            .expect("late event");

        let sessions = state.list_sessions("workspace-a");
        assert_eq!(sessions[0].status, DebugSessionStatus::Disconnected);
        assert!(state
            .session_logs("workspace-a")
            .join("\n")
            .contains("ignored late event"));
    }
}
