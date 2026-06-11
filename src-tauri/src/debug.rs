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
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

pub const DEBUG_LOG_LIMIT: usize = 120_000;
pub const DAP_MESSAGE_BODY_LIMIT: usize = 120_000;
pub const DEBUG_SESSION_EVENT: &str = "workspace://debug-session";
pub const DEBUG_CONSOLE_EVENT: &str = "workspace://debug-console";
pub const DEBUG_STOPPED_EVENT: &str = "workspace://debug-stopped";
pub const DEBUG_EXITED_EVENT: &str = "workspace://debug-exited";

pub trait DebugEventSink: Send + Sync {
    fn emit_debug_event(&self, event_name: &'static str, payload: Value);
}

#[derive(Clone, Default)]
pub struct NoopDebugEventSink;

impl DebugEventSink for NoopDebugEventSink {
    fn emit_debug_event(&self, _event_name: &'static str, _payload: Value) {}
}

#[derive(Clone)]
pub struct TauriDebugEventSink {
    app: AppHandle,
}

impl TauriDebugEventSink {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl DebugEventSink for TauriDebugEventSink {
    fn emit_debug_event(&self, event_name: &'static str, payload: Value) {
        let _ = self.app.emit(event_name, payload);
    }
}

#[cfg(test)]
#[derive(Clone, Debug, PartialEq)]
pub struct DebugRecordedEvent {
    pub name: &'static str,
    pub payload: Value,
}

#[cfg(test)]
#[derive(Default)]
pub struct TestDebugEventSink {
    events: Mutex<Vec<DebugRecordedEvent>>,
}

#[cfg(test)]
impl TestDebugEventSink {
    pub fn events(&self) -> Vec<DebugRecordedEvent> {
        self.events
            .lock()
            .map(|events| events.clone())
            .unwrap_or_default()
    }
}

#[cfg(test)]
impl DebugEventSink for TestDebugEventSink {
    fn emit_debug_event(&self, event_name: &'static str, payload: Value) {
        if let Ok(mut events) = self.events.lock() {
            events.push(DebugRecordedEvent {
                name: event_name,
                payload,
            });
        }
    }
}

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
    pub sequence: u64,
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
            sequence: 0,
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

    pub fn save_config_for_workspace<FNow, FId>(
        &self,
        workspace_root: &str,
        input: DebugLaunchConfigInput,
        now: FNow,
        id_factory: FId,
    ) -> Result<DebugLaunchConfig, String>
    where
        FNow: Fn() -> Result<u64, String>,
        FId: Fn() -> String,
    {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        if input.workspace_root != workspace_root {
            return Err("debug launch config does not belong to workspace".to_string());
        }

        let now = now()?;
        let mut configs = self.load()?;
        let config_id = input.id.unwrap_or_else(&id_factory);
        let previous = configs
            .iter()
            .find(|config| config.id == config_id)
            .cloned();
        if previous
            .as_ref()
            .is_some_and(|config| config.workspace_root != workspace_root)
        {
            return Err("debug launch config does not belong to workspace".to_string());
        }

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

    pub fn delete_config_for_workspace(
        &self,
        workspace_root: &str,
        id: &str,
    ) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        let mut configs = self.load()?;
        let index = configs
            .iter()
            .position(|config| config.id == id)
            .ok_or_else(|| format!("debug launch config not found: {id}"))?;
        if configs[index].workspace_root != workspace_root {
            return Err("debug launch config does not belong to workspace".to_string());
        }

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

pub struct DebugState {
    breakpoints: Arc<Mutex<HashMap<DebugBreakpointKey, Vec<DebugSourceBreakpoint>>>>,
    runtime: Arc<Mutex<DebugRuntimeState>>,
    event_sink: Arc<dyn DebugEventSink>,
}

impl Default for DebugState {
    fn default() -> Self {
        Self::new_with_event_sink(Arc::new(NoopDebugEventSink))
    }
}

impl DebugState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn new_with_event_sink<T>(event_sink: Arc<T>) -> Self
    where
        T: DebugEventSink + 'static,
    {
        Self {
            breakpoints: Arc::new(Mutex::new(HashMap::new())),
            runtime: Arc::new(Mutex::new(DebugRuntimeState::default())),
            event_sink,
        }
    }

    pub fn new_for_tests() -> Self {
        Self::new()
    }

    #[cfg(test)]
    pub fn new_for_tests_with_event_sink<T>(event_sink: Arc<T>) -> Self
    where
        T: DebugEventSink + 'static,
    {
        Self::new_with_event_sink(event_sink)
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

        let (info, events) = {
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
            let mut record = adapter.launch(request, session_id);
            let session_id = record.info.id.clone();
            let mut events = vec![PendingDebugEvent::session(next_session_info(&mut record))];
            push_workspace_log(
                &mut runtime.logs_by_workspace,
                &workspace_id,
                format!("started debug session {session_id}"),
            );
            for log in &logs {
                if push_workspace_log(&mut runtime.logs_by_workspace, &workspace_id, log.clone()) {
                    events.push(PendingDebugEvent::console(
                        next_session_info(&mut record),
                        log.clone(),
                    ));
                }
            }
            if record.info.status == DebugSessionStatus::Stopped {
                events.push(PendingDebugEvent::stopped(next_session_info(&mut record)));
            }
            let info = record.info.clone();
            runtime.sessions.insert(session_id, record);
            (info, events)
        };

        self.emit_pending_events(events);
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
            let info = next_session_info(record);
            (info.workspace_id.clone(), info)
        };
        push_workspace_log(
            &mut runtime.logs_by_workspace,
            &workspace_id,
            format!("continued debug session {session_id}"),
        );
        drop(runtime);
        self.emit_session_event(&info);
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
            let info = next_session_info(record);
            (info.workspace_id.clone(), info)
        };
        push_workspace_log(
            &mut runtime.logs_by_workspace,
            &workspace_id,
            format!("stepped over debug session {session_id}"),
        );
        drop(runtime);
        self.emit_session_event(&info);
        self.emit_stopped_event(&info);
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
            let info = next_session_info(record);
            (info.workspace_id.clone(), info)
        };
        push_workspace_log(
            &mut runtime.logs_by_workspace,
            &workspace_id,
            format!("paused debug session {session_id}"),
        );
        drop(runtime);
        self.emit_session_event(&info);
        self.emit_stopped_event(&info);
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
            let info = next_session_info(record);
            (info.workspace_id.clone(), info)
        };
        push_workspace_log(
            &mut runtime.logs_by_workspace,
            &workspace_id,
            format!("disconnected debug session {session_id}"),
        );
        drop(runtime);
        self.emit_session_event(&info);
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
        let dispatch = {
            let mut runtime = self.runtime.lock().map_err(|err| err.to_string())?;
            let Some(record) = runtime.sessions.get_mut(&event.session_id) else {
                return Ok(());
            };
            let workspace_id = record.info.workspace_id.clone();
            if event.event == "output"
                && event
                    .body
                    .get("output")
                    .and_then(Value::as_str)
                    .is_some_and(str::is_empty)
            {
                return Ok(());
            }

            if matches!(
                record.info.status,
                DebugSessionStatus::Disconnected
                    | DebugSessionStatus::Exited
                    | DebugSessionStatus::Failed
            ) {
                push_workspace_log(
                    &mut runtime.logs_by_workspace,
                    &workspace_id,
                    format!(
                        "ignored late event {} for session {}",
                        event.event, event.session_id
                    ),
                );
                return Ok(());
            }

            let console_chunk = event
                .body
                .get("output")
                .and_then(Value::as_str)
                .filter(|_| event.event == "output")
                .map(str::to_string);
            let emits_stopped = event.event == "stopped";
            let emits_exited = matches!(event.event.as_str(), "exited" | "terminated");
            let log_message = apply_debug_event(record, &event);
            let info = next_session_info(record);
            let log_stored =
                push_workspace_log(&mut runtime.logs_by_workspace, &workspace_id, log_message);
            DebugEventDispatch {
                info,
                console_chunk: console_chunk.filter(|_| log_stored),
                emits_session: event.event != "output",
                emits_stopped,
                emits_exited,
            }
        };

        if dispatch.emits_session {
            self.emit_session_event(&dispatch.info);
        }
        if let Some(chunk) = dispatch.console_chunk {
            self.emit_console_event(&dispatch.info, chunk);
        }
        if dispatch.emits_stopped {
            self.emit_stopped_event(&dispatch.info);
        }
        if dispatch.emits_exited {
            self.emit_exited_event(&dispatch.info);
        }
        Ok(())
    }

    fn emit_session_event(&self, info: &DebugSessionInfo) {
        self.event_sink.emit_debug_event(
            DEBUG_SESSION_EVENT,
            json!({
                "session_id": &info.id,
                "workspace_id": &info.workspace_id,
                "workspace_root": &info.workspace_root,
                "status": &info.status,
                "reason": &info.stopped_reason,
                "sequence": info.sequence,
            }),
        );
    }

    fn emit_console_event(&self, info: &DebugSessionInfo, chunk: String) {
        self.event_sink.emit_debug_event(
            DEBUG_CONSOLE_EVENT,
            json!({
                "session_id": &info.id,
                "workspace_id": &info.workspace_id,
                "workspace_root": &info.workspace_root,
                "chunk": chunk,
                "sequence": info.sequence,
            }),
        );
    }

    fn emit_stopped_event(&self, info: &DebugSessionInfo) {
        self.event_sink.emit_debug_event(
            DEBUG_STOPPED_EVENT,
            json!({
                "session_id": &info.id,
                "workspace_id": &info.workspace_id,
                "workspace_root": &info.workspace_root,
                "thread_id": info.active_thread_id,
                "reason": &info.stopped_reason,
                "status": &info.status,
                "sequence": info.sequence,
            }),
        );
    }

    fn emit_exited_event(&self, info: &DebugSessionInfo) {
        self.event_sink.emit_debug_event(
            DEBUG_EXITED_EVENT,
            json!({
                "session_id": &info.id,
                "workspace_id": &info.workspace_id,
                "workspace_root": &info.workspace_root,
                "status": &info.status,
                "reason": &info.stopped_reason,
                "sequence": info.sequence,
            }),
        );
    }

    fn emit_pending_events(&self, events: Vec<PendingDebugEvent>) {
        for event in events {
            match event.name {
                DEBUG_SESSION_EVENT => self.emit_session_event(&event.info),
                DEBUG_CONSOLE_EVENT => {
                    if let Some(chunk) = event.chunk {
                        self.emit_console_event(&event.info, chunk);
                    }
                }
                DEBUG_STOPPED_EVENT => self.emit_stopped_event(&event.info),
                DEBUG_EXITED_EVENT => self.emit_exited_event(&event.info),
                _ => {}
            }
        }
    }
}

struct DebugEventDispatch {
    info: DebugSessionInfo,
    console_chunk: Option<String>,
    emits_session: bool,
    emits_stopped: bool,
    emits_exited: bool,
}

struct PendingDebugEvent {
    name: &'static str,
    info: DebugSessionInfo,
    chunk: Option<String>,
}

impl PendingDebugEvent {
    fn session(info: DebugSessionInfo) -> Self {
        Self {
            name: DEBUG_SESSION_EVENT,
            info,
            chunk: None,
        }
    }

    fn console(info: DebugSessionInfo, chunk: String) -> Self {
        Self {
            name: DEBUG_CONSOLE_EVENT,
            info,
            chunk: Some(chunk),
        }
    }

    fn stopped(info: DebugSessionInfo) -> Self {
        Self {
            name: DEBUG_STOPPED_EVENT,
            info,
            chunk: None,
        }
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

fn next_session_info(record: &mut DebugSessionRecord) -> DebugSessionInfo {
    record.info.sequence = record.info.sequence.saturating_add(1);
    record.info.clone()
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
) -> bool {
    if message.is_empty() {
        return false;
    }

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
    true
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
use real_adapter_helpers::{
    compile_c_fixture, find_lldb_dap, require_debug_smoke, run_real_dap_smoke, RealDapSmokeProgram,
};

#[cfg(test)]
mod real_adapter_helpers {
    use super::*;
    use std::{
        collections::VecDeque,
        io::{Read, Write},
        process::{Child, ChildStdin, Command, Stdio},
        sync::mpsc::{self, Receiver},
        thread,
        time::{Duration, Instant},
    };

    const DAP_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
    const DAP_LAUNCH_TIMEOUT: Duration = Duration::from_secs(90);

    #[derive(Clone, Debug)]
    pub(super) struct RealDapSmokeProgram {
        pub program: String,
        pub source_path: String,
        pub breakpoint_line: u32,
        pub expected_variable: (String, String),
    }

    #[derive(Clone, Debug)]
    pub(super) struct RealDapSmokeResult {
        pub stopped_reason: Option<String>,
        pub stack: Vec<DebugStackFrame>,
    }

    #[derive(Clone, Debug)]
    struct RealDapBreakpoint {
        source_path: String,
        line: u32,
    }

    #[derive(Clone, Debug)]
    struct RealDapLaunchResult {
        stopped_reason: Option<String>,
        stack: Vec<DebugStackFrame>,
        variables: Vec<DebugVariable>,
    }

    pub(super) fn require_debug_smoke() {
        assert_eq!(
            std::env::var("YUZZU_DEBUG_SMOKE").ok().as_deref(),
            Some("1"),
            "set YUZZU_DEBUG_SMOKE=1 to run real debug adapter smoke tests"
        );
    }

    pub(super) fn find_lldb_dap() -> Result<String, String> {
        let output = Command::new("xcrun")
            .args(["--find", "lldb-dap"])
            .output()
            .map_err(|err| format!("lldb-dap lookup failed: xcrun is unavailable: {err}"))?;
        if !output.status.success() {
            return Err(format!(
                "lldb-dap not found via xcrun --find lldb-dap: {}",
                command_output_summary(&output)
            ));
        }

        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() {
            return Err("lldb-dap not found via xcrun --find lldb-dap: empty path".to_string());
        }
        Ok(path)
    }

    pub(super) fn compile_c_fixture(fixture_path: &str) -> Result<String, String> {
        let source = repo_root().join(fixture_path);
        let source = source
            .canonicalize()
            .map_err(|err| format!("failed to resolve {}: {err}", source.display()))?;
        let output_dir = std::env::temp_dir().join("yuuzu-ide-debug-smoke");
        std::fs::create_dir_all(&output_dir).map_err(|err| err.to_string())?;
        let binary = output_dir.join(format!("compiled-main-{}", std::process::id()));
        let output = Command::new("xcrun")
            .args(["clang", "-g", "-O0"])
            .arg(&source)
            .arg("-o")
            .arg(&binary)
            .output()
            .map_err(|err| format!("xcrun clang failed to start: {err}"))?;
        if !output.status.success() {
            return Err(format!(
                "xcrun clang -g -O0 failed for {}: {}",
                source.display(),
                command_output_summary(&output)
            ));
        }
        Ok(binary.to_string_lossy().into_owned())
    }

    pub(super) fn run_real_dap_smoke(
        adapter: DebugAdapterKind,
        adapter_command: String,
        program: RealDapSmokeProgram,
    ) -> Result<RealDapSmokeResult, String> {
        let workspace_root = repo_root().to_string_lossy().into_owned();
        let command_args = adapter_command_args(adapter);
        let request = DebugStartSessionRequest {
            workspace_id: "debug-smoke-workspace".to_string(),
            workspace_root: workspace_root.clone(),
            config: DebugLaunchConfig {
                id: "debug-smoke-config".to_string(),
                workspace_root,
                name: "Real adapter smoke".to_string(),
                adapter,
                request: DebugRequestKind::Launch,
                program: program.program.clone(),
                cwd: ".".to_string(),
                args: Vec::new(),
                env: Vec::new(),
                stop_on_entry: false,
                attach: None,
                created_ms: 1,
                updated_ms: 1,
            },
        };
        let result = run_real_dap_launch(
            &request,
            adapter_command,
            command_args,
            Some(RealDapBreakpoint {
                source_path: program.source_path,
                line: program.breakpoint_line,
            }),
        )?;

        let expected = &program.expected_variable;
        let actual = result
            .variables
            .iter()
            .find(|variable| variable.name == expected.0)
            .ok_or_else(|| format!("expected variable {} was not returned", expected.0))?;
        if actual.value != expected.1 {
            return Err(format!(
                "expected variable {}={} but adapter returned {}",
                expected.0, expected.1, actual.value
            ));
        }

        Ok(RealDapSmokeResult {
            stopped_reason: result.stopped_reason,
            stack: result.stack,
        })
    }

    fn run_real_dap_launch(
        request: &DebugStartSessionRequest,
        adapter_command: String,
        adapter_args: Vec<String>,
        breakpoint: Option<RealDapBreakpoint>,
    ) -> Result<RealDapLaunchResult, String> {
        if request.config.request != DebugRequestKind::Launch {
            return Err("real DAP smoke only supports launch requests".to_string());
        }

        let workspace_root = PathBuf::from(&request.workspace_root);
        let cwd = resolve_workspace_path(&workspace_root, &request.config.cwd)?;
        let program = resolve_workspace_path(&workspace_root, &request.config.program)?;
        let source_path = breakpoint
            .as_ref()
            .map(|breakpoint| resolve_workspace_path(&workspace_root, &breakpoint.source_path))
            .transpose()?;
        let mut client = DapClient::spawn(adapter_command, adapter_args, &cwd)?;

        let initialize = client.send_request(
            "initialize",
            json!({
                "clientID": "yuuzu-ide",
                "clientName": "Yuuzu-IDE",
                "adapterID": adapter_id(request.config.adapter),
                "pathFormat": "path",
                "linesStartAt1": true,
                "columnsStartAt1": true,
                "supportsVariableType": true,
                "supportsVariablePaging": false,
                "supportsRunInTerminalRequest": false,
                "locale": "en-us",
            }),
        )?;
        client
            .wait_for_response(initialize, DAP_REQUEST_TIMEOUT)
            .map_err(|err| format!("initialize response failed: {err}"))?;

        let launch = client.send_request("launch", launch_arguments(request, &program, &cwd)?)?;
        client
            .wait_for_event("initialized", DAP_REQUEST_TIMEOUT)
            .map_err(|err| format!("initialized event failed: {err}"))?;

        if let (Some(breakpoint), Some(source_path)) = (&breakpoint, source_path.as_ref()) {
            let set_breakpoints = client.send_request(
                "setBreakpoints",
                json!({
                    "source": {
                        "name": file_name(source_path),
                        "path": source_path.to_string_lossy(),
                    },
                    "breakpoints": [{ "line": breakpoint.line }],
                    "lines": [breakpoint.line],
                    "sourceModified": false,
                }),
            )?;
            client
                .wait_for_response(set_breakpoints, DAP_REQUEST_TIMEOUT)
                .map_err(|err| format!("setBreakpoints response failed: {err}"))?;
        }

        let set_exception_breakpoints = client.send_request(
            "setExceptionBreakpoints",
            json!({
                "filters": [],
            }),
        )?;
        client
            .wait_for_response(set_exception_breakpoints, DAP_REQUEST_TIMEOUT)
            .map_err(|err| format!("setExceptionBreakpoints response failed: {err}"))?;

        let configuration_done = client.send_request("configurationDone", json!({}))?;
        client
            .wait_for_response(configuration_done, DAP_REQUEST_TIMEOUT)
            .map_err(|err| format!("configurationDone response failed: {err}"))?;
        client
            .wait_for_response(launch, DAP_REQUEST_TIMEOUT)
            .map_err(|err| format!("launch response failed: {err}"))?;

        let stopped = client
            .wait_for_one_of_events(&["stopped", "exited", "terminated"], DAP_LAUNCH_TIMEOUT)
            .map_err(|err| format!("stopped/exited event failed: {err}"))?;
        let event_name = stopped
            .get("event")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if event_name != "stopped" {
            let _ = client.disconnect();
            return Err(format!("adapter exited before breakpoint: {stopped}"));
        }

        let stopped_body = stopped.get("body").cloned().unwrap_or_else(|| json!({}));
        let stopped_reason = stopped_body
            .get("reason")
            .and_then(Value::as_str)
            .map(str::to_string);
        let thread_id = stopped_body
            .get("threadId")
            .and_then(Value::as_i64)
            .ok_or_else(|| format!("stopped event missing threadId: {stopped_body}"))?;
        let stack = client.stack_trace(thread_id)?;
        let mut variables = Vec::new();
        for frame in &stack {
            for scope in client.scopes(frame.id)? {
                variables.extend(client.variables(scope.variables_reference)?);
            }
        }

        client.disconnect()?;
        Ok(RealDapLaunchResult {
            stopped_reason,
            stack,
            variables,
        })
    }

    struct DapClient {
        child: Child,
        stdin: ChildStdin,
        messages: Receiver<Result<Value, String>>,
        pending: VecDeque<Value>,
        next_seq: i64,
    }

    impl DapClient {
        fn spawn(program: String, args: Vec<String>, cwd: &Path) -> Result<Self, String> {
            let mut command = Command::new(&program);
            command
                .args(&args)
                .current_dir(cwd)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                command.process_group(0);
            }
            let mut child = command.spawn().map_err(|err| {
                format!(
                    "failed to start DAP adapter `{}`: {err}",
                    command_line(&program, &args)
                )
            })?;
            let stdin = child
                .stdin
                .take()
                .ok_or_else(|| "DAP adapter stdin was not captured".to_string())?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| "DAP adapter stdout was not captured".to_string())?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| "DAP adapter stderr was not captured".to_string())?;
            let (messages_tx, messages) = mpsc::channel();

            thread::spawn(move || {
                let mut stdout = stdout;
                let mut buffer = Vec::new();
                let mut chunk = [0_u8; 8192];
                loop {
                    match stdout.read(&mut chunk) {
                        Ok(0) => {
                            let _ = messages_tx.send(Err("DAP adapter stdout closed".to_string()));
                            break;
                        }
                        Ok(len) => {
                            buffer.extend_from_slice(&chunk[..len]);
                            loop {
                                match decode_dap_message(&mut buffer) {
                                    Ok(Some(message)) => {
                                        if messages_tx.send(Ok(message)).is_err() {
                                            return;
                                        }
                                    }
                                    Ok(None) => break,
                                    Err(err) => {
                                        let _ = messages_tx.send(Err(err));
                                        return;
                                    }
                                }
                            }
                        }
                        Err(err) => {
                            let _ = messages_tx
                                .send(Err(format!("failed to read DAP adapter stdout: {err}")));
                            break;
                        }
                    }
                }
            });
            thread::spawn(move || {
                let mut stderr = stderr;
                let mut sink = Vec::new();
                let _ = stderr.read_to_end(&mut sink);
            });

            Ok(Self {
                child,
                stdin,
                messages,
                pending: VecDeque::new(),
                next_seq: 1,
            })
        }

        fn send_request(&mut self, command: &str, arguments: Value) -> Result<i64, String> {
            let seq = self.next_seq;
            self.next_seq += 1;
            let message = json!({
                "seq": seq,
                "type": "request",
                "command": command,
                "arguments": arguments,
            });
            let encoded = encode_dap_message(&message)?;
            self.stdin.write_all(&encoded).map_err(|err| {
                format!("failed to write DAP request `{command}` to adapter: {err}")
            })?;
            self.stdin.flush().map_err(|err| {
                format!("failed to flush DAP request `{command}` to adapter: {err}")
            })?;
            Ok(seq)
        }

        fn wait_for_response(
            &mut self,
            request_seq: i64,
            timeout: Duration,
        ) -> Result<Value, String> {
            let deadline = Instant::now() + timeout;
            loop {
                if let Some(message) = self.take_pending_response(request_seq) {
                    return response_body(message);
                }

                let message = self.receive_message(deadline)?;
                if message.get("type").and_then(Value::as_str) == Some("response")
                    && message.get("request_seq").and_then(Value::as_i64) == Some(request_seq)
                {
                    return response_body(message);
                }
                self.pending.push_back(message);
            }
        }

        fn wait_for_event(&mut self, event: &str, timeout: Duration) -> Result<Value, String> {
            self.wait_for_one_of_events(&[event], timeout)
        }

        fn wait_for_one_of_events(
            &mut self,
            events: &[&str],
            timeout: Duration,
        ) -> Result<Value, String> {
            let deadline = Instant::now() + timeout;
            loop {
                if let Some(message) = self.take_pending_event(events) {
                    return Ok(message);
                }

                let message = self.receive_message(deadline)?;
                if message.get("type").and_then(Value::as_str) == Some("event")
                    && message
                        .get("event")
                        .and_then(Value::as_str)
                        .is_some_and(|event| events.contains(&event))
                {
                    return Ok(message);
                }
                self.pending.push_back(message);
            }
        }

        fn stack_trace(&mut self, thread_id: i64) -> Result<Vec<DebugStackFrame>, String> {
            let request = self.send_request("stackTrace", json!({ "threadId": thread_id }))?;
            let body = self.wait_for_response(request, DAP_REQUEST_TIMEOUT)?;
            Ok(body
                .get("stackFrames")
                .and_then(Value::as_array)
                .map(|frames| {
                    frames
                        .iter()
                        .filter_map(parse_stack_frame)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default())
        }

        fn scopes(&mut self, frame_id: i64) -> Result<Vec<DebugScope>, String> {
            let request = self.send_request("scopes", json!({ "frameId": frame_id }))?;
            let body = self.wait_for_response(request, DAP_REQUEST_TIMEOUT)?;
            Ok(body
                .get("scopes")
                .and_then(Value::as_array)
                .map(|scopes| scopes.iter().filter_map(parse_scope).collect::<Vec<_>>())
                .unwrap_or_default())
        }

        fn variables(&mut self, variables_reference: i64) -> Result<Vec<DebugVariable>, String> {
            if variables_reference == 0 {
                return Ok(Vec::new());
            }

            let request = self.send_request(
                "variables",
                json!({ "variablesReference": variables_reference }),
            )?;
            let body = self.wait_for_response(request, DAP_REQUEST_TIMEOUT)?;
            Ok(body
                .get("variables")
                .and_then(Value::as_array)
                .map(|variables| {
                    variables
                        .iter()
                        .filter_map(parse_variable)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default())
        }

        fn disconnect(&mut self) -> Result<(), String> {
            let request = self.send_request(
                "disconnect",
                json!({
                    "terminateDebuggee": true,
                    "restart": false,
                }),
            )?;
            let _ = self.wait_for_response(request, Duration::from_secs(5));
            self.terminate();
            Ok(())
        }

        fn receive_message(&mut self, deadline: Instant) -> Result<Value, String> {
            let now = Instant::now();
            if now >= deadline {
                return Err("timed out waiting for DAP adapter message".to_string());
            }
            let remaining = deadline.saturating_duration_since(now);
            match self.messages.recv_timeout(remaining) {
                Ok(Ok(message)) => Ok(message),
                Ok(Err(err)) => Err(err),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    Err("timed out waiting for DAP adapter message".to_string())
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    Err("DAP adapter message channel closed".to_string())
                }
            }
        }

        fn take_pending_response(&mut self, request_seq: i64) -> Option<Value> {
            let index = self.pending.iter().position(|message| {
                message.get("type").and_then(Value::as_str) == Some("response")
                    && message.get("request_seq").and_then(Value::as_i64) == Some(request_seq)
            })?;
            self.pending.remove(index)
        }

        fn take_pending_event(&mut self, events: &[&str]) -> Option<Value> {
            let index = self.pending.iter().position(|message| {
                message.get("type").and_then(Value::as_str) == Some("event")
                    && message
                        .get("event")
                        .and_then(Value::as_str)
                        .is_some_and(|event| events.contains(&event))
            })?;
            self.pending.remove(index)
        }

        fn terminate(&mut self) {
            #[cfg(unix)]
            terminate_process_group(self.child.id());
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }

    impl Drop for DapClient {
        fn drop(&mut self) {
            self.terminate();
        }
    }

    fn adapter_command_args(adapter: DebugAdapterKind) -> Vec<String> {
        match adapter {
            DebugAdapterKind::Python => [
                "run",
                "--with",
                "debugpy",
                "python",
                "-m",
                "debugpy.adapter",
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
            DebugAdapterKind::Lldb | DebugAdapterKind::Custom => Vec::new(),
        }
    }

    fn launch_arguments(
        request: &DebugStartSessionRequest,
        program: &Path,
        cwd: &Path,
    ) -> Result<Value, String> {
        let program = program.to_string_lossy();
        let cwd = cwd.to_string_lossy();
        match request.config.adapter {
            DebugAdapterKind::Lldb => Ok(json!({
                "name": request.config.name,
                "type": "lldb-dap",
                "request": "launch",
                "program": program,
                "cwd": cwd,
                "stopOnEntry": request.config.stop_on_entry,
                "args": request.config.args,
            })),
            DebugAdapterKind::Python => Ok(json!({
                "program": program,
                "cwd": cwd,
                "stopOnEntry": request.config.stop_on_entry,
                "console": "internalConsole",
            })),
            DebugAdapterKind::Custom => {
                Err("real DAP smoke does not support custom adapters".to_string())
            }
        }
    }

    fn adapter_id(adapter: DebugAdapterKind) -> &'static str {
        match adapter {
            DebugAdapterKind::Lldb => "lldb",
            DebugAdapterKind::Python => "python",
            DebugAdapterKind::Custom => "custom",
        }
    }

    fn parse_stack_frame(value: &Value) -> Option<DebugStackFrame> {
        Some(DebugStackFrame {
            id: value.get("id")?.as_i64()?,
            name: value.get("name")?.as_str()?.to_string(),
            source_path: value
                .get("source")
                .and_then(|source| source.get("path"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            line: value
                .get("line")
                .and_then(Value::as_u64)
                .and_then(|line| u32::try_from(line).ok())
                .unwrap_or(0),
            column: value
                .get("column")
                .and_then(Value::as_u64)
                .and_then(|column| u32::try_from(column).ok())
                .unwrap_or(0),
        })
    }

    fn parse_scope(value: &Value) -> Option<DebugScope> {
        Some(DebugScope {
            name: value.get("name")?.as_str()?.to_string(),
            variables_reference: value.get("variablesReference")?.as_i64()?,
            expensive: value
                .get("expensive")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        })
    }

    fn parse_variable(value: &Value) -> Option<DebugVariable> {
        Some(DebugVariable {
            name: value.get("name")?.as_str()?.to_string(),
            value: value.get("value")?.as_str()?.to_string(),
            type_name: value
                .get("type")
                .and_then(Value::as_str)
                .map(str::to_string),
            variables_reference: value
                .get("variablesReference")
                .and_then(Value::as_i64)
                .unwrap_or(0),
        })
    }

    fn response_body(message: Value) -> Result<Value, String> {
        if message
            .get("success")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Ok(message.get("body").cloned().unwrap_or_else(|| json!({})));
        }
        Err(format!(
            "DAP request failed: {}",
            message
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown adapter error")
        ))
    }

    fn resolve_workspace_path(workspace_root: &Path, value: &str) -> Result<PathBuf, String> {
        let path = Path::new(value);
        let resolved = if path.is_absolute() {
            path.to_path_buf()
        } else {
            workspace_root.join(path)
        };
        resolved
            .canonicalize()
            .map_err(|err| format!("failed to resolve {}: {err}", resolved.display()))
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
    }

    fn file_name(path: &Path) -> String {
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned())
    }

    fn command_line(program: &str, args: &[String]) -> String {
        std::iter::once(program.to_string())
            .chain(args.iter().cloned())
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn command_output_summary(output: &std::process::Output) -> String {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        format!(
            "status={} stdout={} stderr={}",
            output.status,
            stdout.trim(),
            stderr.trim()
        )
    }

    #[cfg(unix)]
    fn terminate_process_group(pid: u32) {
        let group = format!("-{pid}");
        let _ = Command::new("kill")
            .args(["-TERM", &group])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        thread::sleep(Duration::from_millis(200));
        let _ = Command::new("kill")
            .args(["-KILL", &group])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
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
    fn save_delete_launch_config_validate_workspace_inside_store_lock() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = DebugLaunchConfigStore::new(temp.path().join("debug-launch.json"));
        let mut first = debug_config_input("/repo-a", "script", DebugAdapterKind::Python);
        first.id = Some("cfg-shared".to_string());
        store
            .save_config_for_workspace("/repo-a", first, || Ok(10), || "unused".to_string())
            .expect("save first");

        let mut forged = debug_config_input("/repo-b", "forged", DebugAdapterKind::Python);
        forged.id = Some("cfg-shared".to_string());
        let save =
            store.save_config_for_workspace("/repo-b", forged, || Ok(20), || "unused".to_string());
        assert!(save
            .expect_err("workspace mismatch")
            .contains("debug launch config does not belong to workspace"));

        let delete = store.delete_config_for_workspace("/repo-b", "cfg-shared");
        assert!(delete
            .expect_err("workspace mismatch")
            .contains("debug launch config does not belong to workspace"));

        let configs = store.list_configs("/repo-a").expect("repo-a configs");
        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].name, "script");
        assert!(store
            .list_configs("/repo-b")
            .expect("repo-b configs")
            .is_empty());
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
    use std::sync::Arc;

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

    #[test]
    fn scripted_adapter_launch_emits_session_console_and_stopped_events() {
        let sink = Arc::new(TestDebugEventSink::default());
        let state = DebugState::new_for_tests_with_event_sink(sink.clone());
        state.install_test_adapter(
            DebugAdapterKind::Python,
            ScriptedDebugAdapter::python_stopped_at_line(8),
        );

        let session = state
            .start_test_python_session("workspace-a", "/repo")
            .expect("start");

        let events = sink.events();
        let session_event = events
            .iter()
            .find(|event| event.name == DEBUG_SESSION_EVENT)
            .expect("session event");
        assert_eq!(session_event.payload["session_id"], session.id);
        assert_eq!(session_event.payload["workspace_id"], "workspace-a");
        assert_eq!(session_event.payload["workspace_root"], "/repo");
        assert_eq!(session_event.payload["status"], "Stopped");

        let stopped_event = events
            .iter()
            .find(|event| event.name == DEBUG_STOPPED_EVENT)
            .expect("stopped event");
        assert_eq!(stopped_event.payload["session_id"], session.id);
        assert_eq!(stopped_event.payload["reason"], "breakpoint");
        assert_eq!(stopped_event.payload["thread_id"], 1);
        assert!(
            stopped_event.payload["sequence"]
                .as_u64()
                .expect("stopped sequence")
                > session_event.payload["sequence"]
                    .as_u64()
                    .expect("session sequence")
        );
        assert_eq!(
            session.sequence,
            stopped_event.payload["sequence"]
                .as_u64()
                .expect("stopped sequence")
        );

        let console_event = events
            .iter()
            .find(|event| event.name == DEBUG_CONSOLE_EVENT)
            .expect("console event");
        assert_eq!(console_event.payload["session_id"], session.id);
        assert!(console_event.payload["chunk"]
            .as_str()
            .expect("chunk")
            .contains("Python debug adapter launched"));
    }

    #[test]
    fn debug_event_sequence_increases_across_start_stopped_and_disconnect() {
        let sink = Arc::new(TestDebugEventSink::default());
        let state = DebugState::new_for_tests_with_event_sink(sink.clone());
        state.install_test_adapter(
            DebugAdapterKind::Python,
            ScriptedDebugAdapter::python_stopped_at_line(8),
        );

        let session = state
            .start_test_python_session("workspace-a", "/repo")
            .expect("start");
        let events = sink.events();
        let start_sequence = events
            .iter()
            .find(|event| event.name == DEBUG_SESSION_EVENT)
            .and_then(|event| event.payload["sequence"].as_u64())
            .expect("start sequence");
        let stopped_sequence = events
            .iter()
            .find(|event| event.name == DEBUG_STOPPED_EVENT)
            .and_then(|event| event.payload["sequence"].as_u64())
            .expect("stopped sequence");
        assert!(stopped_sequence > start_sequence);
        assert_eq!(session.sequence, stopped_sequence);

        let disconnected = state.disconnect_session(&session.id).expect("disconnect");
        let events = sink.events();
        let disconnect_sequence = events
            .iter()
            .rev()
            .find(|event| event.name == DEBUG_SESSION_EVENT)
            .and_then(|event| event.payload["sequence"].as_u64())
            .expect("disconnect sequence");
        assert!(disconnect_sequence > stopped_sequence);
        assert_eq!(disconnected.sequence, disconnect_sequence);
    }

    #[test]
    fn empty_output_events_do_not_grow_logs_or_emit_console_events() {
        let sink = Arc::new(TestDebugEventSink::default());
        let state = DebugState::new_for_tests_with_event_sink(sink.clone());
        state.install_test_adapter(
            DebugAdapterKind::Python,
            ScriptedDebugAdapter::python_stopped_at_line(8),
        );
        let session = state
            .start_test_python_session("workspace-a", "/repo")
            .expect("start");
        let initial_logs = state.session_logs("workspace-a").len();
        let initial_console_events = sink
            .events()
            .into_iter()
            .filter(|event| event.name == DEBUG_CONSOLE_EVENT)
            .count();

        for _ in 0..3 {
            state
                .handle_debug_event(DebugAdapterEvent {
                    session_id: session.id.clone(),
                    event: "output".to_string(),
                    body: serde_json::json!({ "output": "" }),
                })
                .expect("empty output");
        }

        assert_eq!(state.session_logs("workspace-a").len(), initial_logs);
        let console_events = sink
            .events()
            .into_iter()
            .filter(|event| event.name == DEBUG_CONSOLE_EVENT)
            .count();
        assert_eq!(console_events, initial_console_events);
    }

    #[test]
    fn adapter_exited_event_emits_debug_exited_event() {
        let sink = Arc::new(TestDebugEventSink::default());
        let state = DebugState::new_for_tests_with_event_sink(sink.clone());
        state.install_test_adapter(
            DebugAdapterKind::Python,
            ScriptedDebugAdapter::python_stopped_at_line(8),
        );
        let session = state
            .start_test_python_session("workspace-a", "/repo")
            .expect("start");

        state
            .handle_debug_event(DebugAdapterEvent {
                session_id: session.id.clone(),
                event: "exited".to_string(),
                body: serde_json::json!({ "exitCode": 0 }),
            })
            .expect("exited event");

        let events = sink.events();
        let exited_event = events
            .iter()
            .find(|event| event.name == DEBUG_EXITED_EVENT)
            .expect("exited event");
        assert_eq!(exited_event.payload["session_id"], session.id);
        assert_eq!(exited_event.payload["workspace_id"], "workspace-a");
        assert_eq!(exited_event.payload["status"], "Exited");
    }
}

#[cfg(test)]
mod adapter_smoke_tests {
    use super::*;

    #[test]
    #[ignore]
    fn lldb_dap_debugs_compiled_c_fixture_to_breakpoint() {
        require_debug_smoke();
        let lldb_dap = find_lldb_dap().expect("lldb-dap");
        let binary = compile_c_fixture("fixtures/debug/compiled-main.c").expect("compile fixture");
        let result = run_real_dap_smoke(
            DebugAdapterKind::Lldb,
            lldb_dap,
            RealDapSmokeProgram {
                program: binary,
                source_path: "fixtures/debug/compiled-main.c".to_string(),
                breakpoint_line: 6,
                expected_variable: ("counter".to_string(), "3".to_string()),
            },
        )
        .expect("lldb smoke");

        assert_eq!(result.stopped_reason.as_deref(), Some("breakpoint"));
        assert!(result.stack.iter().any(|frame| frame.name.contains("main")));
    }

    #[test]
    #[ignore]
    fn debugpy_debugs_python_fixture_to_breakpoint() {
        require_debug_smoke();
        let result = run_real_dap_smoke(
            DebugAdapterKind::Python,
            "uv".to_string(),
            RealDapSmokeProgram {
                program: "fixtures/debug/script-main.py".to_string(),
                source_path: "fixtures/debug/script-main.py".to_string(),
                breakpoint_line: 5,
                expected_variable: ("counter".to_string(), "3".to_string()),
            },
        )
        .expect("debugpy smoke");

        assert_eq!(result.stopped_reason.as_deref(), Some("breakpoint"));
        assert!(result.stack.iter().any(|frame| frame.name.contains("main")));
    }
}
