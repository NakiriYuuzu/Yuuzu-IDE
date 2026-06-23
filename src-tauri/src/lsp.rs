use std::{
    collections::{HashMap, HashSet, VecDeque},
    ffi::{OsStr, OsString},
    io::{ErrorKind, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Stdio},
    sync::{
        mpsc::{self, RecvTimeoutError, TryRecvError},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::background_process::background_command;

const DEFAULT_LSP_REQUEST_TIMEOUT_MS: u64 = 10_000;
const INTERACTIVE_LSP_REQUEST_TIMEOUT_MS: u64 = 2_000;
const MAX_WORKSPACE_LANGUAGE_SCAN_FILES: usize = 20_000;
const LANGUAGE_SCAN_SKIP_DIRS: &[&str] = &[".git", "node_modules", "target"];
const LSP_HOME_BIN_DIRS: &[&str] = &[".cargo/bin", ".bun/bin", ".local/bin"];
const LSP_WINDOWS_HOME_BIN_DIRS: &[&str] = &["AppData/Roaming/npm"];
const LSP_ABSOLUTE_BIN_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin"];
const LSP_WINDOWS_EXECUTABLE_EXTENSIONS: &[&str] = &[".com", ".exe", ".bat", ".cmd"];

fn request_timeout_for_method(method: &str) -> Duration {
    match method {
        "textDocument/hover" | "textDocument/completion" => {
            Duration::from_millis(INTERACTIVE_LSP_REQUEST_TIMEOUT_MS)
        }
        _ => Duration::from_millis(DEFAULT_LSP_REQUEST_TIMEOUT_MS),
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Hash, Serialize, Deserialize)]
pub enum LanguageId {
    Rust,
    TypeScript,
    JavaScript,
    Python,
    CSharp,
    Kotlin,
}

const ALL_LANGUAGES: [LanguageId; 6] = [
    LanguageId::Rust,
    LanguageId::TypeScript,
    LanguageId::JavaScript,
    LanguageId::Python,
    LanguageId::CSharp,
    LanguageId::Kotlin,
];

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LanguageServerProfile {
    pub language: LanguageId,
    pub display_name: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
}

pub fn detect_language(path: &str) -> Option<LanguageId> {
    let extension = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();

    match extension.as_str() {
        "rs" => Some(LanguageId::Rust),
        "ts" | "tsx" | "mts" | "cts" => Some(LanguageId::TypeScript),
        "js" | "jsx" | "mjs" | "cjs" => Some(LanguageId::JavaScript),
        "py" | "pyw" | "pyi" => Some(LanguageId::Python),
        "cs" => Some(LanguageId::CSharp),
        "kt" | "kts" => Some(LanguageId::Kotlin),
        _ => None,
    }
}

fn detect_workspace_languages(workspace_root: &str) -> Vec<LanguageId> {
    let root = Path::new(workspace_root);
    if !root.is_dir() {
        return Vec::new();
    }

    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(false)
        .parents(true)
        .ignore(true)
        .git_ignore(true);
    builder.filter_entry(|entry| !should_skip_language_scan_entry(entry.path(), entry.file_type()));

    let mut languages = HashSet::new();
    let mut scanned_files = 0usize;

    for entry in builder.build() {
        let Ok(entry) = entry else {
            continue;
        };
        if !entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            continue;
        }

        scanned_files = scanned_files.saturating_add(1);
        if scanned_files > MAX_WORKSPACE_LANGUAGE_SCAN_FILES {
            break;
        }

        let path = entry
            .path()
            .strip_prefix(root)
            .ok()
            .and_then(|path| path.to_str())
            .map(str::to_string)
            .unwrap_or_else(|| entry.path().to_string_lossy().into_owned());

        if let Some(language) = detect_language(&path) {
            languages.insert(language);
            if languages.len() == ALL_LANGUAGES.len() {
                break;
            }
        }
    }

    let mut languages = languages.into_iter().collect::<Vec<_>>();
    languages.sort();
    languages
}

fn should_skip_language_scan_entry(path: &Path, file_type: Option<std::fs::FileType>) -> bool {
    if !file_type.is_some_and(|file_type| file_type.is_dir()) {
        return false;
    }

    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| LANGUAGE_SCAN_SKIP_DIRS.contains(&name))
}

pub fn server_profile(language: LanguageId) -> LanguageServerProfile {
    match language {
        LanguageId::Rust => LanguageServerProfile {
            language,
            display_name: "Rust Analyzer".to_string(),
            command: "rust-analyzer".to_string(),
            args: Vec::new(),
            cwd: None,
        },
        LanguageId::TypeScript => LanguageServerProfile {
            language,
            display_name: "TypeScript Language Server".to_string(),
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            cwd: None,
        },
        LanguageId::JavaScript => LanguageServerProfile {
            language,
            display_name: "JavaScript Language Server".to_string(),
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            cwd: None,
        },
        LanguageId::Python => LanguageServerProfile {
            language,
            display_name: "Python LSP Server".to_string(),
            command: "pylsp".to_string(),
            args: Vec::new(),
            cwd: None,
        },
        LanguageId::CSharp => LanguageServerProfile {
            language,
            display_name: "C# Language Server".to_string(),
            command: "csharp-ls".to_string(),
            args: Vec::new(),
            cwd: None,
        },
        LanguageId::Kotlin => LanguageServerProfile {
            language,
            display_name: "Kotlin Language Server".to_string(),
            command: "kotlin-language-server".to_string(),
            args: Vec::new(),
            cwd: None,
        },
    }
}

pub fn server_profile_for_workspace(
    language: LanguageId,
    workspace_root: &str,
) -> LanguageServerProfile {
    let mut profile = server_profile(language);
    let root = Path::new(workspace_root);
    if language == LanguageId::Python && is_uv_python_workspace(root) {
        profile.command = "uv".to_string();
        profile.args = ["run", "--no-sync", "--with", "python-lsp-server", "pylsp"]
            .into_iter()
            .map(str::to_string)
            .collect();
        profile.cwd = Some(root.to_path_buf());
    }
    profile
}

fn is_uv_python_workspace(root: &Path) -> bool {
    root.join("pyproject.toml").is_file() || root.join("uv.lock").is_file()
}

pub fn encode_lsp_message(value: &serde_json::Value) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(value).map_err(|err| err.to_string())?;
    let mut frame = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    frame.extend(body);
    Ok(frame)
}

pub fn decode_lsp_message(buffer: &mut Vec<u8>) -> Result<Option<serde_json::Value>, String> {
    let Some(header_end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") else {
        return Ok(None);
    };

    let header = std::str::from_utf8(&buffer[..header_end]).map_err(|err| err.to_string())?;
    let content_length_value = header
        .lines()
        .find_map(|line| line.strip_prefix("Content-Length: "))
        .ok_or_else(|| "missing LSP Content-Length header".to_string())?;
    let content_length = content_length_value
        .parse::<usize>()
        .map_err(|err| format!("invalid LSP Content-Length: {err}"))?;

    let body_start = header_end + 4;
    let body_end = body_start
        .checked_add(content_length)
        .ok_or_else(|| "invalid LSP Content-Length exceeds frame bounds".to_string())?;
    if buffer.len() < body_end {
        return Ok(None);
    }

    let body = buffer[body_start..body_end].to_vec();
    buffer.drain(..body_end);
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|err| err.to_string())
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ServerState {
    Unsupported,
    Idle,
    MissingCommand,
    Starting,
    Running,
    Stopped,
    Error,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LanguageServerStatus {
    pub workspace_id: String,
    pub workspace_root: String,
    pub language: LanguageId,
    pub display_name: String,
    pub command: Option<String>,
    pub state: ServerState,
    pub pid: Option<u32>,
    pub memory_bytes: Option<u64>,
    pub open_documents: usize,
    pub last_error: Option<String>,
    pub resolved_command_path: Option<String>,
    pub last_stderr: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum DocumentReadiness {
    Unsupported,
    Syncing,
    Ready,
    Stale,
    MissingCommand,
    Error,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LspEnsureDocumentResult {
    pub workspace_id: String,
    pub workspace_root: String,
    pub path: String,
    pub language: Option<LanguageId>,
    pub readiness: DocumentReadiness,
    pub server: LanguageServerStatus,
    pub command: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TestServerProfile {
    pub language: LanguageId,
    pub available: bool,
}

impl TestServerProfile {
    pub fn available(language: LanguageId) -> Self {
        Self {
            language,
            available: true,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LspRange {
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LspDiagnostic {
    pub path: String,
    pub range: LspRange,
    pub severity: String,
    pub message: String,
    pub source: Option<String>,
}

type DiagnosticUpdates = Vec<(String, Vec<LspDiagnostic>)>;
type LspResultWithDiagnostics = (Value, DiagnosticUpdates);

#[derive(Default)]
struct LanguageServerManagerState {
    test_profiles: HashMap<LanguageId, TestServerProfile>,
    servers: HashMap<LanguageServerKey, LanguageServerRecord>,
    diagnostics: HashMap<(String, String, String), Vec<LspDiagnostic>>,
    logs: HashMap<(String, String), Vec<String>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
struct LanguageServerKey {
    workspace_id: String,
    workspace_root: String,
    language: LanguageId,
}

struct LanguageServerRecord {
    display_name: String,
    language: LanguageId,
    command: String,
    state: ServerState,
    pid: Option<u32>,
    memory_bytes: Option<u64>,
    open_documents: HashSet<String>,
    open_contents: HashMap<String, String>,
    open_versions: HashMap<String, i32>,
    last_used_at: u64,
    last_error: Option<String>,
    resolved_command_path: Option<String>,
    last_stderr: Option<String>,
    transport: Option<Box<dyn LspTransport>>,
    initialized: bool,
    next_request_id: u64,
}

impl LanguageServerRecord {
    fn from_profile(profile: &LanguageServerProfile, available: bool) -> Self {
        Self {
            display_name: profile.display_name.clone(),
            language: profile.language,
            command: profile.command.clone(),
            state: if available {
                ServerState::Idle
            } else {
                ServerState::MissingCommand
            },
            pid: None,
            memory_bytes: None,
            open_documents: HashSet::new(),
            open_contents: HashMap::new(),
            open_versions: HashMap::new(),
            last_used_at: current_unix_millis(),
            last_error: None,
            resolved_command_path: Some(profile.command.clone()),
            last_stderr: None,
            transport: None,
            initialized: false,
            next_request_id: 1,
        }
    }

    fn status(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        language: LanguageId,
    ) -> LanguageServerStatus {
        let (pid, memory_bytes) = if self.state == ServerState::Running {
            (self.pid, self.memory_bytes)
        } else {
            (None, None)
        };

        LanguageServerStatus {
            workspace_id: workspace_id.to_string(),
            workspace_root: workspace_root.to_string(),
            language,
            display_name: self.display_name.clone(),
            command: Some(self.command.clone()),
            state: self.state.clone(),
            pid,
            memory_bytes,
            open_documents: self.open_documents.len(),
            last_error: self.last_error.clone(),
            resolved_command_path: self.resolved_command_path.clone(),
            last_stderr: self.last_stderr.clone(),
        }
    }
}

fn append_workspace_log(logs: &mut Vec<String>, line: impl Into<String>) {
    logs.push(line.into());
    if logs.len() > 120 {
        logs.drain(..logs.len() - 120);
    }
}

fn sample_memory_bytes(pid: u32) -> Option<u64> {
    crate::metrics::process_memory_bytes(pid)
}

fn language_id_for_lsp(language: LanguageId) -> &'static str {
    match language {
        LanguageId::Rust => "rust",
        LanguageId::TypeScript => "typescript",
        LanguageId::JavaScript => "javascript",
        LanguageId::Python => "python",
        LanguageId::CSharp => "csharp",
        LanguageId::Kotlin => "kotlin",
    }
}

fn is_windows_drive_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn normalize_lsp_path_text(path: &str) -> String {
    path.replace('\\', "/")
}

fn percent_encode_file_path(path: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::new();
    for (index, byte) in path.bytes().enumerate() {
        let is_unreserved = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_');
        let is_drive_colon = index == 1 && byte == b':' && path.as_bytes()[0].is_ascii_alphabetic();
        if is_unreserved || byte == b'/' || is_drive_colon {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    encoded
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn percent_decode_file_path(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = *bytes.get(index + 1)?;
            let low = *bytes.get(index + 2)?;
            decoded.push(hex_value(high)? * 16 + hex_value(low)?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn as_file_uri(workspace_root: &str, path: &str) -> String {
    let path = if is_windows_drive_path(workspace_root) {
        let root = normalize_lsp_path_text(workspace_root)
            .trim_end_matches('/')
            .to_string();
        let relative = normalize_lsp_path_text(path);
        let relative = relative.trim_start_matches('/');
        if relative.is_empty() {
            root
        } else {
            format!("{root}/{relative}")
        }
    } else {
        let absolute = Path::new(workspace_root).join(path.trim_start_matches('/'));
        normalize_lsp_path_text(&absolute.to_string_lossy())
    };
    let encoded = percent_encode_file_path(&path);
    if is_windows_drive_path(&path) {
        format!("file:///{encoded}")
    } else {
        format!("file://{encoded}")
    }
}

fn relative_path_from_uri(workspace_root: &str, uri: &str) -> Option<String> {
    let uri_path = uri.strip_prefix("file://")?;
    let mut decoded = normalize_lsp_path_text(&percent_decode_file_path(uri_path)?);
    let root = normalize_lsp_path_text(workspace_root)
        .trim_end_matches('/')
        .to_string();
    let case_insensitive = is_windows_drive_path(&root);
    if case_insensitive
        && decoded.as_bytes().first() == Some(&b'/')
        && is_windows_drive_path(&decoded[1..])
    {
        decoded = decoded[1..].to_string();
    }
    if decoded.split('/').any(|part| part == "..") {
        return None;
    }
    let compare_root = if case_insensitive {
        root.to_ascii_lowercase()
    } else {
        root.clone()
    };
    let compare_path = if case_insensitive {
        decoded.to_ascii_lowercase()
    } else {
        decoded.clone()
    };
    let prefix = format!("{compare_root}/");
    if !compare_path.starts_with(&prefix) {
        return None;
    }
    let relative = decoded[root.len() + 1..].to_string();
    if relative.is_empty() {
        None
    } else {
        Some(relative)
    }
}

fn extract_lsp_result(response: Value) -> Result<Value, String> {
    if response.get("error").is_some() {
        return Err("language server request returned error".to_string());
    }

    response
        .get("result")
        .cloned()
        .ok_or_else(|| "language server response missing result".to_string())
}

fn is_missing_command_error(message: &str) -> bool {
    message.contains("command not found")
        || message.contains("No such file")
        || message.contains("not found")
}

fn lsp_child_path_env() -> OsString {
    let path = std::env::var_os("PATH");
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    let local_appdata = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    lsp_child_path_env_for(
        path.as_deref(),
        home.as_deref(),
        appdata.as_deref(),
        local_appdata.as_deref(),
    )
}

fn lsp_child_path_env_for(
    path_env: Option<&OsStr>,
    home: Option<&Path>,
    appdata: Option<&Path>,
    local_appdata: Option<&Path>,
) -> OsString {
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();

    if let Some(path_env) = path_env {
        for dir in std::env::split_paths(path_env) {
            push_lsp_path_dir(&mut dirs, &mut seen, dir);
        }
    }

    if let Some(home) = home {
        for relative in LSP_HOME_BIN_DIRS {
            push_lsp_path_dir(&mut dirs, &mut seen, home.join(relative));
        }
        for relative in LSP_WINDOWS_HOME_BIN_DIRS {
            push_lsp_path_dir(&mut dirs, &mut seen, home.join(relative));
        }
        push_lsp_python_script_dirs(
            &mut dirs,
            &mut seen,
            home.join("AppData/Local/Programs/Python"),
        );
    }

    if let Some(appdata) = appdata {
        push_lsp_path_dir(&mut dirs, &mut seen, appdata.join("npm"));
    }

    if let Some(local_appdata) = local_appdata {
        push_lsp_python_script_dirs(&mut dirs, &mut seen, local_appdata.join("Programs/Python"));
    }

    for absolute in LSP_ABSOLUTE_BIN_DIRS {
        push_lsp_path_dir(&mut dirs, &mut seen, PathBuf::from(absolute));
    }

    std::env::join_paths(&dirs)
        .unwrap_or_else(|_| path_env.map(OsStr::to_os_string).unwrap_or_default())
}

fn push_lsp_path_dir(dirs: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>, dir: PathBuf) {
    if dir.as_os_str().is_empty() {
        return;
    }
    if seen.insert(dir.clone()) {
        dirs.push(dir);
    }
}

fn push_lsp_python_script_dirs(
    dirs: &mut Vec<PathBuf>,
    seen: &mut HashSet<PathBuf>,
    python_programs: PathBuf,
) {
    if let Ok(entries) = std::fs::read_dir(python_programs) {
        for entry in entries.flatten() {
            push_lsp_path_dir(dirs, seen, entry.path().join("Scripts"));
        }
    }
}

fn resolve_lsp_command_path_with_path(command: &str, path_env: &OsStr) -> PathBuf {
    let command_path = PathBuf::from(command);
    if command.contains('/') || command.contains('\\') {
        return command_path;
    }
    let has_extension = command_path.extension().is_some();

    for dir in std::env::split_paths(path_env) {
        let candidate = dir.join(command);
        if candidate.is_file() {
            return candidate;
        }
        if !has_extension {
            for extension in LSP_WINDOWS_EXECUTABLE_EXTENSIONS {
                let candidate = dir.join(format!("{command}{extension}"));
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
    }

    command_path
}

fn parse_diagnostic_range(value: &Value) -> Option<LspRange> {
    let start = value.get("start")?;
    let end = value.get("end")?;

    Some(LspRange {
        start_line: start.get("line")?.as_u64()?.try_into().ok()?,
        start_character: start.get("character")?.as_u64()?.try_into().ok()?,
        end_line: end.get("line")?.as_u64()?.try_into().ok()?,
        end_character: end.get("character")?.as_u64()?.try_into().ok()?,
    })
}

fn parse_diagnostic_severity(value: Option<&Value>) -> String {
    match value.and_then(|value| value.as_u64()) {
        Some(1) => "Error".to_string(),
        Some(2) => "Warning".to_string(),
        Some(3) => "Information".to_string(),
        Some(4) => "Hint".to_string(),
        _ => "Unknown".to_string(),
    }
}

fn as_path_or_object_position(line: u32, character: u32) -> Value {
    serde_json::json!({
        "line": line,
        "character": character,
    })
}

fn request_payload(method: &str, id: u64, params: Value) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
    })
}

fn notification_payload(method: &str, params: Value) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params
    })
}

fn as_result_array(value: Value) -> Vec<Value> {
    match value {
        Value::Array(items) => items,
        Value::Null => Vec::new(),
        value => vec![value],
    }
}

fn is_lsp_response_for(value: &Value, response_id: u64) -> bool {
    value.get("method").is_none()
        && value.get("id").and_then(Value::as_u64) == Some(response_id)
        && (value.get("result").is_some() || value.get("error").is_some())
}

fn server_request_response(event: &Value) -> Option<Value> {
    if value_is_lsp_request(event) {
        let id = event.get("id")?.clone();
        let method = event.get("method").and_then(Value::as_str)?;
        let response = match method {
            "workspace/configuration" => {
                let items = event
                    .get("params")
                    .and_then(|params| params.get("items"))
                    .and_then(Value::as_array)
                    .map_or(0usize, |items| items.len());

                let response = (0..items)
                    .map(|_| serde_json::json!({}))
                    .collect::<Vec<_>>();
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": response
                })
            }
            _ => serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": "Method not found"
                }
            }),
        };
        return Some(response);
    }
    None
}

fn value_is_lsp_request(value: &Value) -> bool {
    value.get("result").is_none()
        && value.get("error").is_none()
        && value.get("id").is_some()
        && value.get("method").is_some()
}

type TransportFactory =
    dyn Fn(&LanguageServerProfile) -> Result<Box<dyn LspTransport>, String> + Send + Sync;

fn real_transport_factory(
    profile: &LanguageServerProfile,
) -> Result<Box<dyn LspTransport>, String> {
    Ok(Box::new(StdioTransport::new(profile)?))
}

fn noop_transport_factory(_: &LanguageServerProfile) -> Result<Box<dyn LspTransport>, String> {
    Ok(Box::new(NoopTransport::new()))
}

trait LspTransport: Send {
    fn pid(&self) -> Option<u32>;
    fn is_running(&mut self) -> bool;
    fn send(&mut self, value: Value) -> Result<(), String>;
    fn request(&mut self, payload: Value, timeout: Duration) -> Result<Value, String>;
    fn poll_events(&mut self) -> Vec<Value>;
    fn stderr_excerpt(&self) -> Option<String> {
        None
    }
    fn stop(&mut self);
}

struct StdioTransport {
    child: Option<Child>,
    stdin: Arc<Mutex<ChildStdin>>,
    rx: std::sync::mpsc::Receiver<Value>,
    queued_events: VecDeque<Value>,
    stderr_tail: Arc<Mutex<Vec<u8>>>,
}

impl StdioTransport {
    fn new(profile: &LanguageServerProfile) -> Result<Self, String> {
        let path_env = lsp_child_path_env();
        let mut command = background_command(resolve_lsp_command_path_with_path(
            &profile.command,
            &path_env,
        ));
        command.args(&profile.args);
        if let Some(cwd) = &profile.cwd {
            command.current_dir(cwd);
        }
        command.env("PATH", path_env);
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());

        let mut child = command.spawn().map_err(|err| match err.kind() {
            ErrorKind::NotFound => "command not found".to_string(),
            _ => err.to_string(),
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "missing stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "missing stdout".to_string())?;
        let stderr = child.stderr.take();

        let (tx, rx) = mpsc::channel::<Value>();
        thread::spawn(move || {
            let mut reader = std::io::BufReader::new(stdout);
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 4096];

            while let Ok(bytes_read) = reader.read(&mut chunk) {
                if bytes_read == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..bytes_read]);

                loop {
                    match decode_lsp_message(&mut buffer) {
                        Ok(Some(message)) => {
                            if tx.send(message).is_err() {
                                break;
                            }
                        }
                        Ok(None) => break,
                        Err(_) => break,
                    }
                }
            }
        });
        let stderr_tail = Arc::new(Mutex::new(Vec::new()));
        if let Some(stderr) = stderr {
            let stderr_tail_for_thread = Arc::clone(&stderr_tail);
            thread::spawn(move || {
                let mut reader = std::io::BufReader::new(stderr);
                let mut chunk = [0u8; 4096];
                while let Ok(bytes_read) = reader.read(&mut chunk) {
                    if bytes_read == 0 {
                        break;
                    }
                    if let Ok(mut tail) = stderr_tail_for_thread.lock() {
                        tail.extend_from_slice(&chunk[..bytes_read]);
                        if tail.len() > 8192 {
                            let extra = tail.len() - 8192;
                            tail.drain(..extra);
                        }
                    }
                }
            });
        }

        Ok(Self {
            child: Some(child),
            stdin: Arc::new(Mutex::new(stdin)),
            rx,
            queued_events: VecDeque::new(),
            stderr_tail,
        })
    }

    fn frame_and_write(&self, message: Value) -> Result<(), String> {
        let frame = encode_lsp_message(&message)?;
        let mut stdin = self.stdin.lock().map_err(|err| err.to_string())?;
        stdin.write_all(&frame).map_err(|err| err.to_string())?;
        stdin.flush().map_err(|err| err.to_string())
    }

    fn take_event_id(value: &Value) -> Option<u64> {
        value.get("id").and_then(|value| value.as_u64())
    }

    fn send_server_request_response(&mut self, event: &Value) -> Option<Result<(), String>> {
        let response = server_request_response(event)?;

        Some(self.send(response))
    }

    fn restore_deferred_events(&mut self, mut deferred: VecDeque<Value>) {
        deferred.extend(std::mem::take(&mut self.queued_events));
        self.queued_events = deferred;
    }

    fn process_queued_events(
        &mut self,
        response_id: u64,
        deferred: &mut VecDeque<Value>,
    ) -> Option<Result<Value, String>> {
        while let Some(event) = self.queued_events.pop_front() {
            if let Some(result) = self.send_server_request_response(&event) {
                if let Err(error) = result {
                    return Some(Err(error));
                }
                continue;
            }
            if is_lsp_response_for(&event, response_id) {
                self.restore_deferred_events(std::mem::take(deferred));
                return Some(Ok(event));
            }
            deferred.push_back(event);
        }
        None
    }

    fn process_event(
        &mut self,
        event: Value,
        response_id: u64,
        deferred: &mut VecDeque<Value>,
    ) -> Option<Result<Value, String>> {
        if let Some(result) = self.send_server_request_response(&event) {
            if let Err(error) = result {
                return Some(Err(error));
            }
            return None;
        }
        if is_lsp_response_for(&event, response_id) {
            return Some(Ok(event));
        }
        deferred.push_back(event);
        None
    }
}

impl LspTransport for StdioTransport {
    fn pid(&self) -> Option<u32> {
        self.child.as_ref().map(|child| child.id())
    }

    fn is_running(&mut self) -> bool {
        let Some(child) = &mut self.child else {
            return false;
        };
        match child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) => false,
            Err(_) => false,
        }
    }

    fn send(&mut self, value: Value) -> Result<(), String> {
        self.frame_and_write(value)
    }

    fn request(&mut self, payload: Value, timeout: Duration) -> Result<Value, String> {
        let response_id = Self::take_event_id(&payload)
            .ok_or_else(|| "request payload missing numeric id".to_string())?;
        self.send(payload)?;

        let deadline = Instant::now() + timeout;
        let mut deferred = VecDeque::new();
        loop {
            if let Some(response) = self.process_queued_events(response_id, &mut deferred) {
                return response;
            }

            let now = Instant::now();
            if now >= deadline {
                self.restore_deferred_events(deferred);
                return Err("language server request timed out".to_string());
            }

            let event = match self
                .rx
                .recv_timeout(deadline.saturating_duration_since(now))
            {
                Ok(event) => event,
                Err(RecvTimeoutError::Timeout) => {
                    self.restore_deferred_events(deferred);
                    return Err("language server request timed out".to_string());
                }
                Err(RecvTimeoutError::Disconnected) => {
                    self.restore_deferred_events(deferred);
                    return Err("language server transport disconnected".to_string());
                }
            };
            if let Some(response) = self.process_event(event, response_id, &mut deferred) {
                self.restore_deferred_events(deferred);
                return response;
            }
        }
    }

    fn poll_events(&mut self) -> Vec<Value> {
        let mut events = Vec::new();
        while let Some(event) = self.queued_events.pop_front() {
            if self.send_server_request_response(&event).is_some() {
                continue;
            }
            events.push(event);
        }
        loop {
            match self.rx.try_recv() {
                Ok(event) => {
                    if self.send_server_request_response(&event).is_none() {
                        events.push(event);
                    }
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => break,
            }
        }
        events
    }

    fn stderr_excerpt(&self) -> Option<String> {
        let tail = self.stderr_tail.lock().ok()?;
        if tail.is_empty() {
            None
        } else {
            Some(String::from_utf8_lossy(&tail).into_owned())
        }
    }

    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = self.request(
                request_payload("shutdown", 0, Value::Null),
                Duration::from_millis(750),
            );
            let _ = self.send(notification_payload("exit", Value::Null));
            for _ in 0..10 {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                thread::sleep(Duration::from_millis(20));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        self.stop();
    }
}

struct NoopTransport {
    responses: Arc<Mutex<VecDeque<Value>>>,
    outbound_messages: Arc<Mutex<Vec<Value>>>,
    events: Arc<Mutex<VecDeque<Value>>>,
    stopped: bool,
}

impl NoopTransport {
    fn new() -> Self {
        Self {
            responses: Arc::new(Mutex::new(VecDeque::new())),
            outbound_messages: Arc::new(Mutex::new(Vec::new())),
            events: Arc::new(Mutex::new(VecDeque::new())),
            stopped: false,
        }
    }
}

impl LspTransport for NoopTransport {
    fn pid(&self) -> Option<u32> {
        Some(42_424)
    }

    fn is_running(&mut self) -> bool {
        !self.stopped
    }

    fn send(&mut self, value: Value) -> Result<(), String> {
        if self.stopped {
            return Err("transport stopped".to_string());
        }
        self.outbound_messages
            .lock()
            .map_err(|err| err.to_string())?
            .push(value);
        Ok(())
    }

    fn request(&mut self, payload: Value, _timeout: Duration) -> Result<Value, String> {
        if self.stopped {
            return Err("transport stopped".to_string());
        }
        self.outbound_messages
            .lock()
            .map_err(|err| err.to_string())?
            .push(payload);

        let id = self
            .outbound_messages
            .lock()
            .map_err(|err| err.to_string())?
            .last()
            .and_then(|message| message.get("id").and_then(Value::as_u64))
            .unwrap_or(0);

        if let Some(response) = self
            .responses
            .lock()
            .map_err(|err| err.to_string())?
            .pop_front()
        {
            return Ok(response);
        }

        Ok(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": serde_json::json!({})
        }))
    }

    fn poll_events(&mut self) -> Vec<Value> {
        self.events
            .lock()
            .map(|mut events| events.drain(..).collect())
            .unwrap_or_default()
    }

    fn stop(&mut self) {
        self.stopped = true;
    }
}

pub struct LanguageServerManager {
    state: Mutex<LanguageServerManagerState>,
    transport_factory: Arc<TransportFactory>,
}

impl Default for LanguageServerManager {
    fn default() -> Self {
        Self::for_tests_with_factory(
            vec![
                TestServerProfile::available(LanguageId::Rust),
                TestServerProfile::available(LanguageId::TypeScript),
                TestServerProfile::available(LanguageId::JavaScript),
                TestServerProfile::available(LanguageId::Python),
                TestServerProfile::available(LanguageId::CSharp),
                TestServerProfile::available(LanguageId::Kotlin),
            ],
            real_transport_factory,
        )
    }
}

impl LanguageServerManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn default_for_tests() -> Self {
        Self::for_tests(vec![
            TestServerProfile::available(LanguageId::Rust),
            TestServerProfile::available(LanguageId::TypeScript),
            TestServerProfile::available(LanguageId::JavaScript),
            TestServerProfile::available(LanguageId::Python),
            TestServerProfile::available(LanguageId::CSharp),
            TestServerProfile::available(LanguageId::Kotlin),
        ])
    }

    pub fn for_tests(profiles: Vec<TestServerProfile>) -> Self {
        Self::for_tests_with_factory(profiles, noop_transport_factory)
    }

    fn for_tests_with_factory(
        profiles: Vec<TestServerProfile>,
        transport_factory: impl Fn(&LanguageServerProfile) -> Result<Box<dyn LspTransport>, String>
            + Send
            + Sync
            + 'static,
    ) -> Self {
        let mut available = HashMap::new();
        for language in ALL_LANGUAGES {
            available.insert(
                language,
                TestServerProfile {
                    language,
                    available: false,
                },
            );
        }

        for profile in profiles {
            available.insert(profile.language, profile);
        }

        Self {
            state: Mutex::new(LanguageServerManagerState {
                test_profiles: available,
                servers: HashMap::new(),
                diagnostics: HashMap::new(),
                logs: HashMap::new(),
            }),
            transport_factory: Arc::new(transport_factory),
        }
    }

    fn next_request_id(record: &mut LanguageServerRecord) -> u64 {
        let id = record.next_request_id;
        record.next_request_id = record.next_request_id.saturating_add(1);
        id
    }

    fn stop_transport(record: &mut LanguageServerRecord) {
        if let Some(mut transport) = record.transport.take() {
            transport.stop();
        }
        record.transport = None;
        record.pid = None;
        record.initialized = false;
        record.memory_bytes = None;
    }

    fn append_workspace_log(
        state: &mut LanguageServerManagerState,
        workspace_id: &str,
        workspace_root: &str,
        line: impl Into<String>,
    ) {
        append_workspace_log(
            state
                .logs
                .entry((workspace_id.to_string(), workspace_root.to_string()))
                .or_default(),
            line,
        );
    }

    fn refresh_transport_state(record: &mut LanguageServerRecord) -> Option<String> {
        let mut stopped_log = None;

        if record.state == ServerState::Running {
            let mut running = true;
            if let Some(transport) = record.transport.as_mut() {
                record.last_stderr = transport.stderr_excerpt();
                if !transport.is_running() {
                    running = false;
                }
            } else {
                running = false;
            }

            if !running {
                Self::stop_transport(record);
                record.state = ServerState::Stopped;
                stopped_log = Some(format!("{} process stopped", record.display_name));
            }
        }

        if record.state == ServerState::Running {
            if let Some(pid) = record.pid {
                if let Some(memory_bytes) = sample_memory_bytes(pid) {
                    record.memory_bytes = Some(memory_bytes);
                }
            }
        }

        stopped_log
    }

    fn drain_publish_diagnostics(
        &self,
        workspace_root: &str,
        record: &mut LanguageServerRecord,
    ) -> Vec<(String, Vec<LspDiagnostic>)> {
        if record.state == ServerState::Running {
            let Some(transport) = record.transport.as_mut() else {
                return Vec::new();
            };

            let mut diagnostics = Vec::new();
            let events = transport.poll_events();
            for event in events {
                if event.get("method").and_then(Value::as_str)
                    != Some("textDocument/publishDiagnostics")
                {
                    continue;
                }

                let params = match event.get("params") {
                    Some(params) => params,
                    None => continue,
                };

                let uri = match params.get("uri").and_then(Value::as_str) {
                    Some(uri) => uri,
                    None => continue,
                };
                let path = match relative_path_from_uri(workspace_root, uri) {
                    Some(path) => path,
                    None => continue,
                };

                let values = params
                    .get("diagnostics")
                    .and_then(Value::as_array)
                    .map_or_else(Vec::new, |items| {
                        items
                            .iter()
                            .filter_map(|item| {
                                Some(LspDiagnostic {
                                    path: path.clone(),
                                    range: parse_diagnostic_range(item.get("range")?)?,
                                    severity: parse_diagnostic_severity(item.get("severity")),
                                    message: item
                                        .get("message")
                                        .and_then(Value::as_str)
                                        .unwrap_or_default()
                                        .to_string(),
                                    source: item
                                        .get("source")
                                        .and_then(Value::as_str)
                                        .map(ToString::to_string),
                                })
                            })
                            .collect()
                    });

                diagnostics.push((path, values));
            }

            diagnostics
        } else {
            Vec::new()
        }
    }

    fn send_initialize(
        &self,
        workspace_root: &str,
        record: &mut LanguageServerRecord,
    ) -> Result<(), String> {
        let request_id = Self::next_request_id(record);
        let response = {
            let transport = record
                .transport
                .as_mut()
                .ok_or_else(|| "language server transport not running".to_string())?;

            transport.request(
                request_payload(
                    "initialize",
                    request_id,
                    serde_json::json!({
                        "processId": serde_json::Value::Null,
                        "rootPath": workspace_root,
                        "rootUri": as_file_uri(workspace_root, ""),
                        "capabilities": {},
                        "clientInfo": {
                            "name": "yuuzu-ide",
                            "version": "0.1.0",
                        },
                    }),
                ),
                Duration::from_millis(DEFAULT_LSP_REQUEST_TIMEOUT_MS),
            )?
        };
        extract_lsp_result(response)?;
        if let Some(transport) = record.transport.as_mut() {
            transport.send(notification_payload("initialized", serde_json::json!({})))?;
        }
        record.initialized = true;
        Ok(())
    }

    fn start_transport(
        &self,
        workspace_root: &str,
        profile: &LanguageServerProfile,
        record: &mut LanguageServerRecord,
    ) -> Result<(), String> {
        Self::stop_transport(record);
        let path_env = lsp_child_path_env();
        let resolved_command_path = resolve_lsp_command_path_with_path(&profile.command, &path_env)
            .to_string_lossy()
            .into_owned();
        record.resolved_command_path = Some(resolved_command_path);

        let transport = match (self.transport_factory)(profile) {
            Ok(transport) => transport,
            Err(error) => {
                let error = format!("{}: {}", profile.command, error);
                if is_missing_command_error(&error) {
                    record.state = ServerState::MissingCommand;
                } else {
                    record.state = ServerState::Error;
                }
                record.last_error = Some(error.clone());
                return Err(error);
            }
        };

        record.pid = transport.pid();
        record.transport = Some(transport);
        record.state = ServerState::Running;
        record.last_error = None;
        record.last_stderr = None;
        let initialize = self.send_initialize(workspace_root, record);
        if let Err(error) = initialize {
            record.state = ServerState::Error;
            record.last_error = Some(error.clone());
            Self::stop_transport(record);
            return Err(error);
        }

        Ok(())
    }

    fn ensure_transport(
        &self,
        workspace_root: &str,
        profile: &LanguageServerProfile,
        profile_available: bool,
        record: &mut LanguageServerRecord,
    ) -> (bool, bool) {
        if !profile_available {
            record.state = ServerState::MissingCommand;
            record.last_error = Some(format!("{}: command not available", profile.command));
            return (false, false);
        }

        Self::refresh_transport_state(record);
        if record.state == ServerState::Running && record.initialized {
            if let Some(pid) = record.pid {
                if let Some(memory_bytes) = sample_memory_bytes(pid) {
                    record.memory_bytes = Some(memory_bytes);
                }
            }
            return (true, false);
        }

        if self
            .start_transport(workspace_root, profile, record)
            .is_ok()
        {
            if let Err(error) = self.replay_open_documents(workspace_root, record) {
                record.state = ServerState::Error;
                record.last_error = Some(error);
                Self::stop_transport(record);
                return (false, false);
            }
            return (true, true);
        }
        (false, false)
    }

    fn send_did_open(
        &self,
        workspace_root: &str,
        path: &str,
        content: &str,
        version: i32,
        record: &mut LanguageServerRecord,
    ) -> Result<(), String> {
        let Some(transport) = record.transport.as_mut() else {
            return Ok(());
        };
        transport.send(notification_payload(
            "textDocument/didOpen",
            serde_json::json!({
                "textDocument": {
                    "uri": as_file_uri(workspace_root, path),
                    "languageId": language_id_for_lsp(record.language),
                    "version": version,
                    "text": content,
                },
            }),
        ))?;
        Ok(())
    }

    fn send_did_change(
        &self,
        workspace_root: &str,
        path: &str,
        content: &str,
        version: i32,
        record: &mut LanguageServerRecord,
    ) -> Result<(), String> {
        let Some(transport) = record.transport.as_mut() else {
            return Ok(());
        };
        transport.send(notification_payload(
            "textDocument/didChange",
            serde_json::json!({
                "textDocument": {
                    "uri": as_file_uri(workspace_root, path),
                    "version": version,
                },
                "contentChanges": [{
                    "text": content,
                }],
            }),
        ))?;
        Ok(())
    }

    fn send_did_close(
        &self,
        workspace_root: &str,
        path: &str,
        record: &mut LanguageServerRecord,
    ) -> Result<(), String> {
        let Some(transport) = record.transport.as_mut() else {
            return Ok(());
        };
        transport.send(notification_payload(
            "textDocument/didClose",
            serde_json::json!({
                "textDocument": {
                    "uri": as_file_uri(workspace_root, path),
                },
            }),
        ))?;
        Ok(())
    }

    fn replay_open_documents(
        &self,
        workspace_root: &str,
        record: &mut LanguageServerRecord,
    ) -> Result<(), String> {
        let open_documents = record
            .open_contents
            .iter()
            .map(|(path, content)| {
                (
                    path.clone(),
                    content.clone(),
                    *record.open_versions.get(path).unwrap_or(&1),
                )
            })
            .collect::<Vec<_>>();

        for (path, content, version) in open_documents {
            self.send_did_open(workspace_root, &path, &content, version, record)?;
        }
        Ok(())
    }

    fn request(
        &self,
        workspace_root: &str,
        path: &str,
        method: &str,
        params: Value,
        record: &mut LanguageServerRecord,
    ) -> Result<LspResultWithDiagnostics, String> {
        let mut diagnostics = Vec::new();
        diagnostics.extend(self.drain_publish_diagnostics(workspace_root, record));

        let id = Self::next_request_id(record);
        let response = {
            let transport = record
                .transport
                .as_mut()
                .ok_or_else(|| "language server transport not running".to_string())?;
            transport.request(
                request_payload(method, id, params),
                request_timeout_for_method(method),
            )?
        };

        diagnostics.extend(self.drain_publish_diagnostics(workspace_root, record));
        let response =
            extract_lsp_result(response).map_err(|error| format!("{error} for {path}"))?;
        Ok((response, diagnostics))
    }

    pub fn hover(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
        line: u32,
        character: u32,
    ) -> Result<Value, String> {
        self.with_opened_server_record(workspace_id, workspace_root, path, |record, _profile| {
            let (response, diagnostics) = self.request(
                workspace_root,
                path,
                "textDocument/hover",
                serde_json::json!({
                    "textDocument": {
                        "uri": as_file_uri(workspace_root, path)
                    },
                    "position": as_path_or_object_position(line, character),
                }),
                record,
            )?;
            Ok((response, diagnostics))
        })
    }

    pub fn definition(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
        line: u32,
        character: u32,
    ) -> Result<Vec<Value>, String> {
        self.with_opened_server_record(workspace_id, workspace_root, path, |record, _profile| {
            let (response, diagnostics) = self.request(
                workspace_root,
                path,
                "textDocument/definition",
                serde_json::json!({
                    "textDocument": {
                        "uri": as_file_uri(workspace_root, path)
                    },
                    "position": as_path_or_object_position(line, character),
                }),
                record,
            )?;
            Ok((as_result_array(response), diagnostics))
        })
    }

    pub fn references(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
        line: u32,
        character: u32,
    ) -> Result<Vec<Value>, String> {
        self.with_opened_server_record(workspace_id, workspace_root, path, |record, _profile| {
            let (response, diagnostics) = self.request(
                workspace_root,
                path,
                "textDocument/references",
                serde_json::json!({
                    "textDocument": {
                        "uri": as_file_uri(workspace_root, path)
                    },
                    "position": as_path_or_object_position(line, character),
                    "context": {
                        "includeDeclaration": true,
                    },
                }),
                record,
            )?;
            Ok((as_result_array(response), diagnostics))
        })
    }

    pub fn completion(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
        line: u32,
        character: u32,
    ) -> Result<Value, String> {
        self.with_opened_server_record(workspace_id, workspace_root, path, |record, _profile| {
            let (response, diagnostics) = self.request(
                workspace_root,
                path,
                "textDocument/completion",
                serde_json::json!({
                    "textDocument": {
                        "uri": as_file_uri(workspace_root, path)
                    },
                    "position": as_path_or_object_position(line, character),
                }),
                record,
            )?;
            Ok((response, diagnostics))
        })
    }

    pub fn code_actions(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
        line: u32,
        character: u32,
    ) -> Result<Vec<Value>, String> {
        self.with_opened_server_record(workspace_id, workspace_root, path, |record, _profile| {
            let (response, diagnostics) = self.request(
                workspace_root,
                path,
                "textDocument/codeAction",
                serde_json::json!({
                    "textDocument": {
                        "uri": as_file_uri(workspace_root, path)
                    },
                    "range": {
                        "start": as_path_or_object_position(line, character),
                        "end": as_path_or_object_position(line, character),
                    },
                    "context": {
                        "diagnostics": [],
                    },
                }),
                record,
            )?;
            Ok((as_result_array(response), diagnostics))
        })
    }

    pub fn rename(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
        line: u32,
        character: u32,
        new_name: &str,
    ) -> Result<Value, String> {
        self.with_opened_server_record(workspace_id, workspace_root, path, |record, _profile| {
            let (response, diagnostics) = self.request(
                workspace_root,
                path,
                "textDocument/rename",
                serde_json::json!({
                    "textDocument": {
                        "uri": as_file_uri(workspace_root, path)
                    },
                    "position": as_path_or_object_position(line, character),
                    "newName": new_name,
                }),
                record,
            )?;
            Ok((response, diagnostics))
        })
    }

    pub fn symbols(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        query: &str,
    ) -> Result<Vec<Value>, String> {
        let mut state = self.state.lock().map_err(|err| err.to_string())?;

        let mut symbols = Vec::new();
        let keys: Vec<LanguageServerKey> = state
            .servers
            .iter()
            .filter(|(key, record)| {
                key.workspace_id == workspace_id
                    && key.workspace_root == workspace_root
                    && (record.state == ServerState::Running
                        || (!record.open_documents.is_empty()
                            && record.state != ServerState::MissingCommand))
            })
            .map(|(key, _)| key.clone())
            .collect();

        for key in keys {
            let Some(profile) = state.test_profiles.get(&key.language).cloned() else {
                continue;
            };
            let server_profile = server_profile_for_workspace(key.language, &key.workspace_root);
            let Some(record) = state.servers.get_mut(&key) else {
                continue;
            };

            let (transport_ready, _) =
                self.ensure_transport(workspace_root, &server_profile, profile.available, record);
            if !transport_ready {
                continue;
            }

            let (response, diagnostics) = {
                self.request(
                    workspace_root,
                    "",
                    "workspace/symbol",
                    serde_json::json!({
                        "query": query,
                    }),
                    record,
                )?
            };

            for (relative_path, items) in diagnostics {
                state.diagnostics.insert(
                    (
                        key.workspace_id.to_string(),
                        key.workspace_root.to_string(),
                        relative_path,
                    ),
                    items,
                );
            }

            symbols.extend(as_result_array(response));
        }

        Ok(symbols)
    }

    fn with_opened_server_record<T>(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
        callback: impl FnOnce(
            &mut LanguageServerRecord,
            &LanguageServerProfile,
        ) -> Result<(T, Vec<(String, Vec<LspDiagnostic>)>), String>,
    ) -> Result<T, String> {
        let language = detect_language(path).ok_or_else(|| "unsupported file type".to_string())?;
        let mut state = self.state.lock().map_err(|err| err.to_string())?;
        let profile = state
            .test_profiles
            .get(&language)
            .cloned()
            .unwrap_or(TestServerProfile {
                language,
                available: false,
            });

        let server_profile = server_profile_for_workspace(language, workspace_root);
        let key = LanguageServerKey {
            workspace_id: workspace_id.to_string(),
            workspace_root: workspace_root.to_string(),
            language,
        };
        let record = state.servers.get_mut(&key).ok_or_else(|| {
            format!("language server not found for {workspace_id} at {workspace_root}")
        })?;

        let (transport_ready, _) =
            self.ensure_transport(workspace_root, &server_profile, profile.available, record);
        if !transport_ready {
            return Err(format!(
                "language server {} not running",
                record.display_name
            ));
        }

        let (response, diagnostics) = callback(record, &server_profile)?;
        for (relative_path, entries) in diagnostics {
            state.diagnostics.insert(
                (
                    workspace_id.to_string(),
                    workspace_root.to_string(),
                    relative_path,
                ),
                entries,
            );
        }

        Ok(response)
    }

    pub fn open_document(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        content: String,
    ) -> Result<LanguageServerStatus, String> {
        self.open_document_with_version_at(
            workspace_id,
            workspace_root,
            path,
            content,
            None,
            current_unix_millis(),
        )
    }

    pub fn open_document_at(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        content: String,
        now: u64,
    ) -> Result<LanguageServerStatus, String> {
        self.open_document_with_version_at(workspace_id, workspace_root, path, content, None, now)
    }

    fn open_document_with_version_at(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        content: String,
        requested_version: Option<i32>,
        now: u64,
    ) -> Result<LanguageServerStatus, String> {
        let Some(language) = detect_language(&path) else {
            return Ok(LanguageServerStatus {
                workspace_id,
                workspace_root,
                language: LanguageId::Rust,
                display_name: "Unsupported".to_string(),
                command: None,
                state: ServerState::Unsupported,
                pid: None,
                memory_bytes: None,
                open_documents: 0,
                last_error: Some("unsupported file type".to_string()),
                resolved_command_path: None,
                last_stderr: None,
            });
        };

        let mut state = self.state.lock().map_err(|err| err.to_string())?;
        let profile = state
            .test_profiles
            .get(&language)
            .cloned()
            .unwrap_or(TestServerProfile {
                language,
                available: false,
            });
        let server_profile = server_profile_for_workspace(language, &workspace_root);
        let key = LanguageServerKey {
            workspace_id: workspace_id.clone(),
            workspace_root: workspace_root.clone(),
            language,
        };

        let mut diagnostics = Vec::new();
        let mut logs = Vec::new();
        {
            let entry = state.servers.entry(key.clone()).or_insert_with(|| {
                let mut record =
                    LanguageServerRecord::from_profile(&server_profile, profile.available);
                if !profile.available {
                    record.last_error = Some("command not available".to_string());
                }
                record
            });
            let was_open = entry.open_documents.contains(&path);
            let previous_content = entry.open_contents.get(&path).cloned();
            let was_running_initialized = entry.state == ServerState::Running && entry.initialized;
            let version = requested_version.unwrap_or_else(|| {
                if previous_content.as_deref() == Some(content.as_str()) {
                    *entry.open_versions.get(&path).unwrap_or(&1)
                } else {
                    entry
                        .open_versions
                        .get(&path)
                        .copied()
                        .unwrap_or(0)
                        .saturating_add(1)
                }
            });
            entry.open_documents.insert(path.clone());
            entry.open_contents.insert(path.clone(), content.clone());
            entry.open_versions.insert(path.clone(), version);
            entry.last_used_at = now;

            let (transport_ready, transport_recovered) =
                self.ensure_transport(&workspace_root, &server_profile, profile.available, entry);
            if transport_ready {
                let notification_result = if !was_running_initialized || transport_recovered {
                    Ok(())
                } else if was_open {
                    if previous_content.as_deref() == Some(content.as_str()) {
                        Ok(())
                    } else {
                        self.send_did_change(&workspace_root, &path, &content, version, entry)
                    }
                } else {
                    self.send_did_open(&workspace_root, &path, &content, version, entry)
                };

                if let Err(error) = notification_result {
                    entry.state = ServerState::Error;
                    entry.last_error = Some(error);
                    Self::stop_transport(entry);
                }
            } else if let Some(last_error) = entry.last_error.clone() {
                if is_missing_command_error(&last_error) {
                    entry.state = ServerState::MissingCommand;
                } else {
                    entry.state = ServerState::Error;
                }
                logs.push(format!(
                    "failed to start {}: {last_error}",
                    entry.display_name
                ));
            } else {
                entry.state = ServerState::Error;
                entry.last_error = Some("language server not running".to_string());
                logs.push(format!(
                    "failed to start {}: language server not running",
                    entry.display_name
                ));
            }

            if let Some(log_line) = Self::refresh_transport_state(entry) {
                logs.push(log_line);
            }
            diagnostics.extend(self.drain_publish_diagnostics(&workspace_root, entry));
        }

        for log_line in logs {
            append_workspace_log(
                state
                    .logs
                    .entry((workspace_id.clone(), workspace_root.clone()))
                    .or_default(),
                log_line,
            );
        }

        for (relative_path, values) in diagnostics {
            state.diagnostics.insert(
                (
                    workspace_id.to_string(),
                    workspace_root.to_string(),
                    relative_path,
                ),
                values,
            );
        }

        let entry = state
            .servers
            .get(&key)
            .ok_or_else(|| "language server record vanished".to_string())?;
        Ok(entry.status(&key.workspace_id, &key.workspace_root, key.language))
    }

    pub fn ensure_document(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        content: String,
        version: Option<i32>,
    ) -> Result<LspEnsureDocumentResult, String> {
        let language = detect_language(&path);
        let status = self.open_document_with_version_at(
            workspace_id.clone(),
            workspace_root.clone(),
            path.clone(),
            content,
            version,
            current_unix_millis(),
        )?;
        let readiness = match status.state {
            ServerState::Unsupported => DocumentReadiness::Unsupported,
            ServerState::Idle | ServerState::Stopped => DocumentReadiness::Stale,
            ServerState::Starting => DocumentReadiness::Syncing,
            ServerState::Running => DocumentReadiness::Ready,
            ServerState::MissingCommand => DocumentReadiness::MissingCommand,
            ServerState::Error => DocumentReadiness::Error,
        };

        Ok(LspEnsureDocumentResult {
            workspace_id,
            workspace_root,
            path,
            language,
            command: status.command.clone(),
            last_error: status.last_error.clone(),
            readiness,
            server: status,
        })
    }

    pub fn restart_server(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        language: LanguageId,
    ) -> Result<LanguageServerStatus, String> {
        let mut state = self.state.lock().map_err(|err| err.to_string())?;

        let key = LanguageServerKey {
            workspace_id: workspace_id.to_string(),
            workspace_root: workspace_root.to_string(),
            language,
        };

        let profile = state
            .test_profiles
            .get(&language)
            .cloned()
            .unwrap_or(TestServerProfile {
                language,
                available: false,
            });
        let profile_available = profile.available;
        let server_profile = server_profile_for_workspace(language, workspace_root);

        let log_line = {
            let entry = state.servers.entry(key.clone()).or_insert_with(|| {
                let mut record =
                    LanguageServerRecord::from_profile(&server_profile, profile_available);
                if !profile_available {
                    record.last_error = Some("command not available".to_string());
                }
                record
            });

            Self::stop_transport(entry);

            let log_line = if profile_available {
                match self.start_transport(workspace_root, &server_profile, entry) {
                    Ok(()) => match self.replay_open_documents(workspace_root, entry) {
                        Ok(()) => {
                            entry.last_error = None;
                            format!("restarted {}", entry.display_name)
                        }
                        Err(error) => {
                            entry.state = ServerState::Error;
                            entry.last_error = Some(error);
                            Self::stop_transport(entry);
                            format!("failed to restart {}", entry.display_name)
                        }
                    },
                    Err(error) => {
                        entry.state = ServerState::Error;
                        entry.last_error = Some(error);
                        format!("failed to restart {}", entry.display_name)
                    }
                }
            } else {
                entry.state = ServerState::MissingCommand;
                entry.last_error = Some("command not available".to_string());
                format!("failed to restart {}", entry.display_name)
            };

            entry.last_used_at = current_unix_millis();
            log_line
        };

        Self::append_workspace_log(&mut state, &key.workspace_id, &key.workspace_root, log_line);

        let entry = state
            .servers
            .get(&key)
            .ok_or_else(|| "language server record vanished".to_string())?;
        Ok(entry.status(&key.workspace_id, &key.workspace_root, key.language))
    }

    pub fn server_logs(&self, workspace_id: &str, workspace_root: &str) -> Vec<String> {
        let Ok(state) = self.state.lock() else {
            return Vec::new();
        };

        state
            .logs
            .get(&(workspace_id.to_string(), workspace_root.to_string()))
            .cloned()
            .unwrap_or_default()
    }

    pub fn set_memory_for_tests(&self, workspace_id: &str, language: LanguageId, bytes: u64) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };

        for (_key, entry) in state
            .servers
            .iter_mut()
            .filter(|(key, _)| key.workspace_id == workspace_id && key.language == language)
        {
            entry.memory_bytes = Some(bytes);
        }
    }

    pub fn close_document(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
    ) -> Result<LanguageServerStatus, String> {
        let Some(language) = detect_language(&path) else {
            return Ok(LanguageServerStatus {
                workspace_id,
                workspace_root,
                language: LanguageId::Rust,
                display_name: "Unsupported".to_string(),
                command: None,
                state: ServerState::Unsupported,
                pid: None,
                memory_bytes: None,
                open_documents: 0,
                last_error: Some("unsupported file type".to_string()),
                resolved_command_path: None,
                last_stderr: None,
            });
        };

        let mut state = self.state.lock().map_err(|err| err.to_string())?;
        let key = LanguageServerKey {
            workspace_id: workspace_id.clone(),
            workspace_root: workspace_root.clone(),
            language,
        };
        let status = if let Some(entry) = state.servers.get_mut(&key) {
            let was_open = entry.open_documents.remove(&path);
            entry.open_contents.remove(&path);
            entry.open_versions.remove(&path);

            if was_open && entry.state == ServerState::Running {
                if let Err(error) = self.send_did_close(&workspace_root, &path, entry) {
                    entry.last_error = Some(error);
                }
            }

            if entry.open_documents.is_empty() && entry.state == ServerState::Running {
                Self::stop_transport(entry);
                entry.state = ServerState::Stopped;
            }

            entry.last_used_at = current_unix_millis();
            entry.status(&key.workspace_id, &key.workspace_root, key.language)
        } else {
            let profile =
                state
                    .test_profiles
                    .get(&language)
                    .cloned()
                    .unwrap_or(TestServerProfile {
                        language,
                        available: false,
                    });
            let server_profile = server_profile_for_workspace(language, &workspace_root);

            LanguageServerStatus {
                workspace_id,
                workspace_root,
                language,
                display_name: server_profile.display_name,
                command: Some(server_profile.command.clone()),
                state: if profile.available {
                    ServerState::Idle
                } else {
                    ServerState::MissingCommand
                },
                pid: None,
                memory_bytes: None,
                open_documents: 0,
                last_error: None,
                resolved_command_path: Some(server_profile.command),
                last_stderr: None,
            }
        };

        Ok(status)
    }

    pub fn statuses(&self) -> Vec<LanguageServerStatus> {
        let Ok(mut state) = self.state.lock() else {
            return Vec::new();
        };
        let keys: Vec<LanguageServerKey> = state.servers.keys().cloned().collect();
        let mut statuses = Vec::with_capacity(keys.len());
        let mut logs = Vec::new();
        let mut diagnostic_updates = Vec::new();

        for key in keys {
            if let Some(record) = state.servers.get_mut(&key) {
                if let Some(log_line) = Self::refresh_transport_state(record) {
                    logs.push((
                        key.workspace_id.clone(),
                        key.workspace_root.clone(),
                        log_line,
                    ));
                }
                for (path, diagnostics) in
                    self.drain_publish_diagnostics(&key.workspace_root, record)
                {
                    diagnostic_updates.push((
                        key.workspace_id.clone(),
                        key.workspace_root.clone(),
                        path,
                        diagnostics,
                    ));
                }
                statuses.push(record.status(&key.workspace_id, &key.workspace_root, key.language));
            }
        }

        for (workspace_id, workspace_root, path, diagnostics) in diagnostic_updates {
            state
                .diagnostics
                .insert((workspace_id, workspace_root, path), diagnostics);
        }

        for (workspace_id, workspace_root, line) in logs {
            append_workspace_log(
                state
                    .logs
                    .entry((workspace_id, workspace_root))
                    .or_default(),
                line,
            );
        }

        statuses.sort_by(|left, right| {
            left.workspace_id
                .cmp(&right.workspace_id)
                .then_with(|| left.language.cmp(&right.language))
                .then_with(|| left.workspace_root.cmp(&right.workspace_root))
        });
        statuses
    }

    pub fn status_for_workspace(
        &self,
        workspace_id: &str,
        workspace_root: &str,
    ) -> Vec<LanguageServerStatus> {
        let mut statuses = self
            .statuses()
            .into_iter()
            .filter(|status| {
                status.workspace_id == workspace_id && status.workspace_root == workspace_root
            })
            .collect::<Vec<_>>();
        let existing_languages = statuses
            .iter()
            .map(|status| status.language)
            .collect::<HashSet<_>>();
        let detected_languages = detect_workspace_languages(workspace_root);

        if detected_languages
            .iter()
            .any(|language| !existing_languages.contains(language))
        {
            let Ok(state) = self.state.lock() else {
                return statuses;
            };
            for language in detected_languages {
                if existing_languages.contains(&language) {
                    continue;
                }
                statuses.push(Self::inactive_workspace_status(
                    &state,
                    workspace_id,
                    workspace_root,
                    language,
                ));
            }
        }

        statuses.sort_by(|left, right| {
            left.workspace_id
                .cmp(&right.workspace_id)
                .then_with(|| left.language.cmp(&right.language))
                .then_with(|| left.workspace_root.cmp(&right.workspace_root))
        });
        statuses
    }

    fn inactive_workspace_status(
        state: &LanguageServerManagerState,
        workspace_id: &str,
        workspace_root: &str,
        language: LanguageId,
    ) -> LanguageServerStatus {
        let profile = state
            .test_profiles
            .get(&language)
            .cloned()
            .unwrap_or(TestServerProfile {
                language,
                available: false,
            });

        let server_profile = server_profile_for_workspace(language, workspace_root);

        LanguageServerStatus {
            workspace_id: workspace_id.to_string(),
            workspace_root: workspace_root.to_string(),
            language,
            display_name: server_profile.display_name,
            command: Some(server_profile.command.clone()),
            state: if profile.available {
                ServerState::Idle
            } else {
                ServerState::MissingCommand
            },
            pid: None,
            memory_bytes: None,
            open_documents: 0,
            last_error: None,
            resolved_command_path: Some(server_profile.command),
            last_stderr: None,
        }
    }

    pub fn document_status(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
    ) -> Option<LanguageServerStatus> {
        let language = detect_language(path)?;
        self.statuses().into_iter().find(|status| {
            status.workspace_id == workspace_id
                && status.workspace_root == workspace_root
                && status.language == language
        })
    }

    pub fn store_diagnostics(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
        diagnostics: Vec<LspDiagnostic>,
    ) {
        if let Ok(mut state) = self.state.lock() {
            state.diagnostics.insert(
                (
                    workspace_id.to_string(),
                    workspace_root.to_string(),
                    path.to_string(),
                ),
                diagnostics,
            );
        }
    }

    fn drain_workspace_diagnostics(
        &self,
        state: &mut LanguageServerManagerState,
        workspace_id: &str,
        workspace_root: &str,
    ) {
        let keys = state
            .servers
            .keys()
            .filter(|key| key.workspace_id == workspace_id && key.workspace_root == workspace_root)
            .cloned()
            .collect::<Vec<_>>();
        let mut diagnostic_updates = Vec::new();

        for key in keys {
            if let Some(record) = state.servers.get_mut(&key) {
                for (path, diagnostics) in self.drain_publish_diagnostics(workspace_root, record) {
                    diagnostic_updates.push((path, diagnostics));
                }
            }
        }

        for (path, diagnostics) in diagnostic_updates {
            state.diagnostics.insert(
                (workspace_id.to_string(), workspace_root.to_string(), path),
                diagnostics,
            );
        }
    }

    pub fn document_diagnostics(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
    ) -> Vec<LspDiagnostic> {
        let Ok(state) = self.state.lock() else {
            return Vec::new();
        };
        let mut state = state;
        self.drain_workspace_diagnostics(&mut state, workspace_id, workspace_root);
        state
            .diagnostics
            .get(&(
                workspace_id.to_string(),
                workspace_root.to_string(),
                path.to_string(),
            ))
            .cloned()
            .unwrap_or_default()
    }

    pub fn workspace_diagnostics(
        &self,
        workspace_id: &str,
        workspace_root: &str,
    ) -> Vec<LspDiagnostic> {
        let Ok(state) = self.state.lock() else {
            return Vec::new();
        };
        let mut state = state;
        self.drain_workspace_diagnostics(&mut state, workspace_id, workspace_root);
        let mut diagnostics = Vec::new();
        for ((candidate_workspace_id, candidate_workspace_root, _path), diagnostic) in
            &state.diagnostics
        {
            if candidate_workspace_id == workspace_id && candidate_workspace_root == workspace_root
            {
                diagnostics.extend(diagnostic.clone());
            }
        }
        diagnostics
    }

    pub fn sweep_idle_servers(&self, now_ms: u64, idle_timeout_ms: u64) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let mut keys: Vec<LanguageServerKey> = state.servers.keys().cloned().collect();
        keys.retain(|key| {
            state.servers.get(key).is_some_and(|record| {
                record.state == ServerState::Running
                    && now_ms.saturating_sub(record.last_used_at) > idle_timeout_ms
            })
        });

        let mut logs = Vec::new();

        for key in keys {
            let Some(record) = state.servers.get_mut(&key) else {
                continue;
            };

            if record.state == ServerState::Running
                && now_ms.saturating_sub(record.last_used_at) > idle_timeout_ms
            {
                logs.push((
                    key.workspace_id.clone(),
                    key.workspace_root.clone(),
                    format!("{} idle timeout", record.display_name),
                ));
                Self::stop_transport(record);
                record.state = ServerState::Stopped;
            }
        }

        for (workspace_id, workspace_root, line) in logs {
            append_workspace_log(
                state
                    .logs
                    .entry((workspace_id, workspace_root))
                    .or_default(),
                line,
            );
        }
    }
}

#[derive(Clone)]
pub struct LspState {
    manager: Arc<LanguageServerManager>,
}

impl Default for LspState {
    fn default() -> Self {
        Self::new()
    }
}

impl LspState {
    pub fn new() -> Self {
        Self {
            manager: Arc::new(LanguageServerManager::new()),
        }
    }

    #[cfg(test)]
    pub fn new_for_tests() -> Self {
        Self {
            manager: Arc::new(LanguageServerManager::default_for_tests()),
        }
    }

    pub fn open_document(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        content: String,
    ) -> Result<LanguageServerStatus, String> {
        self.manager
            .open_document(workspace_id, workspace_root, path, content)
    }

    pub fn ensure_document(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        content: String,
        version: Option<i32>,
    ) -> Result<LspEnsureDocumentResult, String> {
        self.manager
            .ensure_document(workspace_id, workspace_root, path, content, version)
    }

    pub fn close_document(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
    ) -> Result<LanguageServerStatus, String> {
        self.manager
            .close_document(workspace_id, workspace_root, path)
    }

    pub fn hover(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        line: u32,
        character: u32,
    ) -> Result<serde_json::Value, String> {
        self.manager
            .hover(&workspace_id, &workspace_root, &path, line, character)
    }

    pub fn definition(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        line: u32,
        character: u32,
    ) -> Result<Vec<serde_json::Value>, String> {
        self.manager
            .definition(&workspace_id, &workspace_root, &path, line, character)
    }

    pub fn references(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        line: u32,
        character: u32,
    ) -> Result<Vec<serde_json::Value>, String> {
        self.manager
            .references(&workspace_id, &workspace_root, &path, line, character)
    }

    pub fn completion(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        line: u32,
        character: u32,
    ) -> Result<serde_json::Value, String> {
        self.manager
            .completion(&workspace_id, &workspace_root, &path, line, character)
    }

    pub fn code_actions(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        line: u32,
        character: u32,
    ) -> Result<Vec<serde_json::Value>, String> {
        self.manager
            .code_actions(&workspace_id, &workspace_root, &path, line, character)
    }

    pub fn symbols(
        &self,
        workspace_id: String,
        workspace_root: String,
        query: String,
    ) -> Result<Vec<serde_json::Value>, String> {
        self.manager.symbols(&workspace_id, &workspace_root, &query)
    }

    pub fn rename(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        line: u32,
        character: u32,
        new_name: String,
    ) -> Result<serde_json::Value, String> {
        self.manager.rename(
            &workspace_id,
            &workspace_root,
            &path,
            line,
            character,
            &new_name,
        )
    }

    pub fn restart_server(
        &self,
        workspace_id: String,
        workspace_root: String,
        language: LanguageId,
    ) -> Result<LanguageServerStatus, String> {
        self.manager
            .restart_server(&workspace_id, &workspace_root, language)
    }

    pub fn server_logs(&self, workspace_id: String, workspace_root: String) -> Vec<String> {
        self.manager.server_logs(&workspace_id, &workspace_root)
    }

    pub fn set_memory_for_tests(&self, workspace_id: String, language: LanguageId, bytes: u64) {
        self.manager
            .set_memory_for_tests(&workspace_id, language, bytes);
    }

    pub fn statuses(
        &self,
        workspace_id: String,
        workspace_root: String,
    ) -> Vec<LanguageServerStatus> {
        self.manager
            .status_for_workspace(&workspace_id, &workspace_root)
    }

    pub fn document_status(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
    ) -> Result<Option<LanguageServerStatus>, String> {
        Ok(self
            .manager
            .document_status(workspace_id, workspace_root, path))
    }

    pub fn document_diagnostics(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
    ) -> Vec<LspDiagnostic> {
        self.manager
            .document_diagnostics(workspace_id, workspace_root, path)
    }

    pub fn workspace_diagnostics(
        &self,
        workspace_id: &str,
        workspace_root: &str,
    ) -> Vec<LspDiagnostic> {
        self.manager
            .workspace_diagnostics(workspace_id, workspace_root)
    }

    pub fn sweep_idle_servers(&self, now_ms: u64, idle_timeout_ms: u64) {
        self.manager.sweep_idle_servers(now_ms, idle_timeout_ms);
    }
}

fn current_unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interactive_lsp_requests_use_a_short_timeout() {
        assert_eq!(
            request_timeout_for_method("textDocument/hover"),
            Duration::from_millis(INTERACTIVE_LSP_REQUEST_TIMEOUT_MS)
        );
        assert_eq!(
            request_timeout_for_method("textDocument/completion"),
            Duration::from_millis(INTERACTIVE_LSP_REQUEST_TIMEOUT_MS)
        );
    }

    #[test]
    fn non_interactive_lsp_requests_keep_the_default_timeout() {
        for method in [
            "textDocument/definition",
            "textDocument/references",
            "textDocument/codeAction",
            "textDocument/documentSymbol",
            "textDocument/rename",
            "initialize",
        ] {
            assert_eq!(
                request_timeout_for_method(method),
                Duration::from_millis(DEFAULT_LSP_REQUEST_TIMEOUT_MS),
                "{method} must keep the default timeout"
            );
        }
    }

    #[test]
    fn detects_supported_languages_from_workspace_paths() {
        assert_eq!(detect_language("src/main.rs"), Some(LanguageId::Rust));
        assert_eq!(detect_language("src/app.ts"), Some(LanguageId::TypeScript));
        assert_eq!(detect_language("src/app.tsx"), Some(LanguageId::TypeScript));
        assert_eq!(detect_language("src/app.mts"), Some(LanguageId::TypeScript));
        assert_eq!(detect_language("src/app.cts"), Some(LanguageId::TypeScript));
        assert_eq!(detect_language("src/app.js"), Some(LanguageId::JavaScript));
        assert_eq!(detect_language("src/app.mjs"), Some(LanguageId::JavaScript));
        assert_eq!(detect_language("src/app.cjs"), Some(LanguageId::JavaScript));
        assert_eq!(
            detect_language("scripts/build.py"),
            Some(LanguageId::Python)
        );
        assert_eq!(
            detect_language("scripts/build.pyw"),
            Some(LanguageId::Python)
        );
        assert_eq!(
            detect_language("typings/build.pyi"),
            Some(LanguageId::Python)
        );
        assert_eq!(detect_language("src/Program.cs"), Some(LanguageId::CSharp));
        assert_eq!(detect_language("src/Main.kt"), Some(LanguageId::Kotlin));
        assert_eq!(
            detect_language("build.gradle.kts"),
            Some(LanguageId::Kotlin)
        );
        assert_eq!(detect_language("README.md"), None);
    }

    #[test]
    fn profiles_use_expected_language_server_commands() {
        assert_eq!(server_profile(LanguageId::Rust).command, "rust-analyzer");
        assert_eq!(
            server_profile(LanguageId::TypeScript).command,
            "typescript-language-server"
        );
        assert_eq!(
            server_profile(LanguageId::JavaScript).command,
            "typescript-language-server"
        );
        assert_eq!(server_profile(LanguageId::Python).command, "pylsp");
        assert_eq!(server_profile(LanguageId::CSharp).command, "csharp-ls");
        assert_eq!(
            server_profile(LanguageId::Kotlin).command,
            "kotlin-language-server"
        );
        assert_eq!(
            server_profile(LanguageId::TypeScript).args,
            vec!["--stdio".to_string()]
        );
        assert!(server_profile(LanguageId::CSharp).args.is_empty());
        assert!(server_profile(LanguageId::Kotlin).args.is_empty());
    }

    #[test]
    fn python_profile_uses_uv_in_uv_workspace() {
        let workspace = tempfile::tempdir().expect("workspace");
        std::fs::write(
            workspace.path().join("pyproject.toml"),
            "[project]\nname = \"demo\"\n",
        )
        .expect("pyproject");

        let profile =
            server_profile_for_workspace(LanguageId::Python, &workspace.path().to_string_lossy());

        assert_eq!(profile.command, "uv");
        assert_eq!(
            profile.args,
            vec![
                "run".to_string(),
                "--no-sync".to_string(),
                "--with".to_string(),
                "python-lsp-server".to_string(),
                "pylsp".to_string(),
            ]
        );
        assert_eq!(profile.cwd.as_deref(), Some(workspace.path()));
    }

    #[test]
    fn python_profile_keeps_pylsp_for_non_uv_workspace() {
        let workspace = tempfile::tempdir().expect("workspace");

        let profile =
            server_profile_for_workspace(LanguageId::Python, &workspace.path().to_string_lossy());

        assert_eq!(profile.command, "pylsp");
        assert!(profile.args.is_empty());
        assert_eq!(profile.cwd, None);
    }

    #[test]
    fn lsp_command_path_env_adds_common_user_tool_dirs_for_gui_launches() {
        let home = tempfile::tempdir().expect("home");
        let cargo_bin = home.path().join(".cargo/bin");
        let bun_bin = home.path().join(".bun/bin");
        let local_bin = home.path().join(".local/bin");
        std::fs::create_dir_all(&cargo_bin).expect("cargo bin");
        std::fs::create_dir_all(&bun_bin).expect("bun bin");
        std::fs::create_dir_all(&local_bin).expect("local bin");
        std::fs::write(cargo_bin.join("rust-analyzer"), "").expect("rust analyzer");
        std::fs::write(bun_bin.join("typescript-language-server"), "").expect("tsserver");
        std::fs::write(local_bin.join("pylsp"), "").expect("pylsp");

        let path_env = lsp_child_path_env_for(
            Some(std::ffi::OsStr::new("/usr/bin:/bin")),
            Some(home.path()),
            None,
            None,
        );

        assert_eq!(
            resolve_lsp_command_path_with_path("rust-analyzer", &path_env),
            cargo_bin.join("rust-analyzer")
        );
        assert_eq!(
            resolve_lsp_command_path_with_path("typescript-language-server", &path_env),
            bun_bin.join("typescript-language-server")
        );
        assert_eq!(
            resolve_lsp_command_path_with_path("pylsp", &path_env),
            local_bin.join("pylsp")
        );
    }

    #[test]
    fn resolve_lsp_command_path_uses_windows_wrapper_extensions() {
        let dir = tempfile::tempdir().expect("path dir");
        std::fs::write(dir.path().join("typescript-language-server.cmd"), "").expect("ts cmd");
        std::fs::write(dir.path().join("rust-analyzer.exe"), "").expect("rust analyzer exe");
        let path_env = std::env::join_paths([dir.path()]).expect("path env");

        assert_eq!(
            resolve_lsp_command_path_with_path("typescript-language-server", &path_env),
            dir.path().join("typescript-language-server.cmd")
        );
        assert_eq!(
            resolve_lsp_command_path_with_path("rust-analyzer", &path_env),
            dir.path().join("rust-analyzer.exe")
        );
    }

    #[test]
    fn lsp_command_path_env_adds_windows_user_tool_dirs_for_gui_launches() {
        let home = tempfile::tempdir().expect("home");
        let npm_bin = home.path().join("AppData/Roaming/npm");
        let python_scripts = home
            .path()
            .join("AppData/Local/Programs/Python/Python312/Scripts");
        std::fs::create_dir_all(&npm_bin).expect("npm bin");
        std::fs::create_dir_all(&python_scripts).expect("python scripts");
        std::fs::write(npm_bin.join("npm-lsp"), "").expect("npm lsp");
        std::fs::write(python_scripts.join("pylsp"), "").expect("pylsp");

        let path_env = lsp_child_path_env_for(
            Some(std::ffi::OsStr::new("/usr/bin:/bin")),
            Some(home.path()),
            None,
            None,
        );

        assert_eq!(
            resolve_lsp_command_path_with_path("npm-lsp", &path_env),
            npm_bin.join("npm-lsp")
        );
        assert_eq!(
            resolve_lsp_command_path_with_path("pylsp", &path_env),
            python_scripts.join("pylsp")
        );
    }

    #[test]
    fn lsp_command_path_env_adds_windows_appdata_tool_dirs_without_home() {
        let appdata = tempfile::tempdir().expect("appdata");
        let local_appdata = tempfile::tempdir().expect("local appdata");
        let npm_bin = appdata.path().join("npm");
        let python_scripts = local_appdata
            .path()
            .join("Programs/Python/Python312/Scripts");
        std::fs::create_dir_all(&npm_bin).expect("npm bin");
        std::fs::create_dir_all(&python_scripts).expect("python scripts");
        std::fs::write(npm_bin.join("npm-lsp.cmd"), "").expect("npm lsp cmd");
        std::fs::write(python_scripts.join("pylsp.exe"), "").expect("pylsp exe");

        let path_env = lsp_child_path_env_for(
            Some(std::ffi::OsStr::new("/usr/bin:/bin")),
            None,
            Some(appdata.path()),
            Some(local_appdata.path()),
        );

        assert_eq!(
            resolve_lsp_command_path_with_path("npm-lsp", &path_env),
            npm_bin.join("npm-lsp.cmd")
        );
        assert_eq!(
            resolve_lsp_command_path_with_path("pylsp", &path_env),
            python_scripts.join("pylsp.exe")
        );
    }

    #[test]
    fn encodes_and_decodes_lsp_content_length_frames() {
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize"
        });
        let frame = encode_lsp_message(&payload).expect("encode");
        let mut buffer = frame.clone();

        let decoded = decode_lsp_message(&mut buffer)
            .expect("decode")
            .expect("message");

        assert_eq!(decoded, payload);
        assert!(buffer.is_empty());
    }

    #[test]
    fn waits_for_complete_lsp_frame_body() {
        let mut buffer = b"Content-Length: 12\r\n\r\n{\"jsonrpc\"".to_vec();
        assert!(decode_lsp_message(&mut buffer).expect("decode").is_none());
        assert_eq!(
            buffer.len(),
            b"Content-Length: 12\r\n\r\n{\"jsonrpc\"".len()
        );
    }

    #[test]
    fn reports_invalid_lsp_content_length_header() {
        let mut buffer = b"Content-Length: abc\r\n\r\n{}".to_vec();

        let error = decode_lsp_message(&mut buffer).expect_err("invalid length");

        assert!(error.contains("invalid LSP Content-Length"));
        assert_eq!(buffer, b"Content-Length: abc\r\n\r\n{}".to_vec());
    }

    #[test]
    fn rejects_lsp_content_length_that_overflows_frame_end() {
        let mut buffer = format!("Content-Length: {}\r\n\r\n{{}}", usize::MAX).into_bytes();

        let error = decode_lsp_message(&mut buffer).expect_err("overflowing length");

        assert_eq!(error, "invalid LSP Content-Length exceeds frame bounds");
        assert!(buffer.starts_with(b"Content-Length: "));
    }

    #[test]
    fn opening_supported_document_starts_only_that_language_server() {
        let manager = LanguageServerManager::for_tests(vec![
            TestServerProfile::available(LanguageId::Rust),
            TestServerProfile::available(LanguageId::TypeScript),
        ]);

        let status = manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open document");

        assert_eq!(status.language, LanguageId::Rust);
        assert_eq!(status.state, ServerState::Running);
        assert_eq!(manager.statuses().len(), 1);
    }

    #[test]
    fn unsupported_documents_do_not_start_language_servers() {
        let manager =
            LanguageServerManager::for_tests(vec![TestServerProfile::available(LanguageId::Rust)]);

        let status = manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "README.md".to_string(),
                "# Docs".to_string(),
            )
            .expect("open document");

        assert_eq!(status.state, ServerState::Unsupported);
        assert!(manager.statuses().is_empty());
    }

    fn sample_diagnostic(message: &str) -> LspDiagnostic {
        LspDiagnostic {
            path: "src/main.rs".to_string(),
            range: LspRange {
                start_line: 1,
                start_character: 0,
                end_line: 1,
                end_character: 5,
            },
            severity: "Error".to_string(),
            message: message.to_string(),
            source: Some("test".to_string()),
        }
    }

    #[test]
    fn diagnostics_cache_is_workspace_and_file_scoped() {
        let manager = LanguageServerManager::default_for_tests();
        manager.store_diagnostics(
            "workspace-a",
            "/workspace-a",
            "src/main.rs",
            vec![sample_diagnostic("unused variable")],
        );
        manager.store_diagnostics(
            "workspace-b",
            "/workspace-b",
            "src/main.rs",
            vec![sample_diagnostic("syntax error")],
        );

        assert_eq!(
            manager.document_diagnostics("workspace-a", "/workspace-a", "src/main.rs")[0].message,
            "unused variable"
        );
        assert_eq!(
            manager
                .workspace_diagnostics("workspace-b", "/workspace-b")
                .len(),
            1
        );
    }

    #[test]
    fn diagnostics_cache_is_scoped_by_workspace_root() {
        let manager = LanguageServerManager::default_for_tests();
        manager.store_diagnostics(
            "workspace",
            "/old-root",
            "src/main.rs",
            vec![sample_diagnostic("old root")],
        );
        manager.store_diagnostics(
            "workspace",
            "/new-root",
            "src/main.rs",
            vec![sample_diagnostic("new root")],
        );

        let document = manager.document_diagnostics("workspace", "/new-root", "src/main.rs");
        let workspace = manager.workspace_diagnostics("workspace", "/new-root");

        assert_eq!(document.len(), 1);
        assert_eq!(document[0].message, "new root");
        assert_eq!(workspace.len(), 1);
        assert_eq!(workspace[0].message, "new root");
    }

    #[test]
    fn idle_sweep_keeps_recent_servers_and_stops_old_servers() {
        let manager = LanguageServerManager::default_for_tests();
        manager
            .open_document_at(
                "workspace-a".to_string(),
                "/a".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
                1000,
            )
            .expect("open");

        manager.sweep_idle_servers(1300, 500);
        assert_eq!(manager.statuses()[0].state, ServerState::Running);

        manager.sweep_idle_servers(1701, 500);
        assert_eq!(manager.statuses()[0].state, ServerState::Stopped);
    }

    #[test]
    fn workspace_statuses_are_scoped_by_workspace_root() {
        let manager = LanguageServerManager::default_for_tests();
        manager
            .open_document(
                "workspace".to_string(),
                "/old-root".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open old root");
        manager
            .open_document(
                "workspace".to_string(),
                "/new-root".to_string(),
                "src/app.ts".to_string(),
                "export {};".to_string(),
            )
            .expect("open new root");

        let statuses = manager.status_for_workspace("workspace", "/new-root");

        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].workspace_root, "/new-root");
        assert_eq!(statuses[0].language, LanguageId::TypeScript);
    }

    #[test]
    fn workspace_statuses_include_detected_languages_even_when_only_one_server_was_opened() {
        let workspace = tempfile::tempdir().expect("workspace");
        std::fs::create_dir_all(workspace.path().join("src")).expect("src dir");
        std::fs::create_dir_all(workspace.path().join("scripts")).expect("scripts dir");
        std::fs::write(workspace.path().join("src/main.rs"), "fn main() {}\n").expect("rust file");
        std::fs::write(
            workspace.path().join("src/app.ts"),
            "export const app = true;\n",
        )
        .expect("typescript file");
        std::fs::write(workspace.path().join("scripts/tool.py"), "print('ok')\n")
            .expect("python file");

        let manager = LanguageServerManager::default_for_tests();
        manager
            .open_document(
                "workspace".to_string(),
                workspace.path().to_string_lossy().into_owned(),
                "scripts/tool.py".to_string(),
                "print('ok')\n".to_string(),
            )
            .expect("open python document");

        let statuses =
            manager.status_for_workspace("workspace", &workspace.path().to_string_lossy());
        let languages = statuses
            .iter()
            .map(|status| status.language)
            .collect::<Vec<_>>();

        assert_eq!(
            languages,
            vec![LanguageId::Rust, LanguageId::TypeScript, LanguageId::Python],
        );
        assert_eq!(
            statuses
                .iter()
                .find(|status| status.language == LanguageId::Python)
                .expect("python status")
                .open_documents,
            1,
        );
    }

    #[test]
    fn detected_unopened_workspace_language_is_idle() {
        let workspace = tempfile::tempdir().expect("workspace");
        std::fs::create_dir_all(workspace.path().join("src")).expect("src dir");
        std::fs::write(
            workspace.path().join("src/app.ts"),
            "export const app = true;\n",
        )
        .expect("typescript file");

        let manager = LanguageServerManager::default_for_tests();
        let statuses =
            manager.status_for_workspace("workspace", &workspace.path().to_string_lossy());

        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].language, LanguageId::TypeScript);
        assert_eq!(statuses[0].state, ServerState::Idle);
        assert_eq!(statuses[0].pid, None);
        assert_eq!(statuses[0].open_documents, 0);
    }

    #[test]
    fn restart_replaces_status_and_records_log_line() {
        let manager = LanguageServerManager::default_for_tests();

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open");

        let restarted = manager
            .restart_server("workspace", "/workspace", LanguageId::Rust)
            .expect("restart");

        assert_eq!(restarted.state, ServerState::Running);
        assert!(manager
            .server_logs("workspace", "/workspace")
            .iter()
            .any(|line| line.contains("restarted Rust Analyzer")));
    }

    #[test]
    fn restart_and_logs_are_scoped_by_workspace_root() {
        let manager = LanguageServerManager::default_for_tests();
        manager
            .open_document_at(
                "workspace".to_string(),
                "/old-root".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
                1,
            )
            .expect("open old root");
        manager
            .open_document_at(
                "workspace".to_string(),
                "/new-root".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
                2,
            )
            .expect("open new root");

        let restarted = manager
            .restart_server("workspace", "/old-root", LanguageId::Rust)
            .expect("restart old root");

        assert_eq!(restarted.workspace_root, "/old-root");
        assert!(manager
            .server_logs("workspace", "/old-root")
            .iter()
            .any(|line| line.contains("restarted Rust Analyzer")));
        assert!(manager.server_logs("workspace", "/new-root").is_empty());
    }

    #[test]
    fn status_exposes_memory_bytes_for_running_servers() {
        let manager = LanguageServerManager::default_for_tests();

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open");
        manager.set_memory_for_tests("workspace", LanguageId::Rust, 4096);

        let status = manager.statuses();

        assert_eq!(status[0].memory_bytes, Some(4096));
    }

    #[test]
    fn stopped_servers_do_not_expose_stale_memory() {
        let manager = LanguageServerManager::default_for_tests();
        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open");
        manager.set_memory_for_tests("workspace", LanguageId::Rust, 4096);

        let closed = manager
            .close_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
            )
            .expect("close");

        assert_eq!(closed.state, ServerState::Stopped);
        assert_eq!(closed.pid, None);
        assert_eq!(closed.memory_bytes, None);
        assert_eq!(manager.statuses()[0].memory_bytes, None);
    }

    #[test]
    fn swept_servers_do_not_expose_stale_memory() {
        let manager = LanguageServerManager::default_for_tests();
        manager
            .open_document_at(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
                1,
            )
            .expect("open");
        manager.set_memory_for_tests("workspace", LanguageId::Rust, 4096);

        manager.sweep_idle_servers(10_000, 100);

        let status = manager.statuses();
        assert_eq!(status[0].state, ServerState::Stopped);
        assert_eq!(status[0].pid, None);
        assert_eq!(status[0].memory_bytes, None);
    }

    #[derive(Clone, Default)]
    struct TransportFixtureState {
        sent: std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>,
        responses: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<serde_json::Value>>>,
        events: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<serde_json::Value>>>,
        stopped: std::sync::Arc<std::sync::Mutex<bool>>,
        send_calls: std::sync::Arc<std::sync::Mutex<usize>>,
        send_fail_at: std::sync::Arc<std::sync::Mutex<Option<usize>>>,
        stderr: std::sync::Arc<std::sync::Mutex<Option<String>>>,
    }

    struct TestTransport {
        state: TransportFixtureState,
    }

    impl TestTransport {
        fn new(state: TransportFixtureState) -> Self {
            *state.stopped.lock().expect("stopped lock") = false;
            Self { state }
        }

        fn push_response(&self, response: serde_json::Value) {
            self.state
                .responses
                .lock()
                .expect("responses lock")
                .push_back(response);
        }

        fn push_event(&self, event: serde_json::Value) {
            self.state
                .events
                .lock()
                .expect("events lock")
                .push_back(event);
        }

        fn fail_send_on_call(&self, call: usize) {
            *self.state.send_fail_at.lock().expect("send fail lock") = Some(call);
        }

        fn set_stderr(&self, stderr: impl Into<String>) {
            *self.state.stderr.lock().expect("stderr lock") = Some(stderr.into());
        }

        fn sent_messages(&self) -> Vec<serde_json::Value> {
            self.state.sent.lock().expect("sent lock").clone()
        }
    }

    impl LspTransport for TestTransport {
        fn pid(&self) -> Option<u32> {
            Some(42_424)
        }

        fn is_running(&mut self) -> bool {
            !*self.state.stopped.lock().expect("running lock")
        }

        fn send(&mut self, value: serde_json::Value) -> Result<(), String> {
            if *self.state.stopped.lock().expect("stopped lock") {
                return Err("transport stopped".to_string());
            }
            let mut send_calls = self.state.send_calls.lock().expect("send calls lock");
            *send_calls += 1;
            let should_fail_on_call = *self.state.send_fail_at.lock().expect("send fail lock");
            if Some(*send_calls) == should_fail_on_call {
                return Err("simulated transport send failure".to_string());
            }
            self.state.sent.lock().expect("sent lock").push(value);
            Ok(())
        }

        fn request(
            &mut self,
            value: serde_json::Value,
            _timeout: std::time::Duration,
        ) -> Result<serde_json::Value, String> {
            if *self.state.stopped.lock().expect("stopped lock") {
                return Err("transport stopped".to_string());
            }
            self.state
                .sent
                .lock()
                .expect("sent lock")
                .push(value.clone());
            if let Some(response) = self
                .state
                .responses
                .lock()
                .expect("responses lock")
                .pop_front()
            {
                return Ok(response);
            }

            let id = value
                .get("id")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
            Ok(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": serde_json::json!({}),
            }))
        }

        fn poll_events(&mut self) -> Vec<serde_json::Value> {
            self.state
                .events
                .lock()
                .expect("events lock")
                .drain(..)
                .collect()
        }

        fn stderr_excerpt(&self) -> Option<String> {
            self.state.stderr.lock().expect("stderr lock").clone()
        }

        fn stop(&mut self) {
            *self.state.stopped.lock().expect("stopped lock") = true;
        }
    }

    #[test]
    fn opening_supported_document_sends_initialize_and_did_open() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        let status = manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open document");

        assert_eq!(status.state, ServerState::Running);

        let messages = transport.sent_messages();
        assert_eq!(messages.len(), 3);
        assert_eq!(
            messages[0].get("method").and_then(|value| value.as_str()),
            Some("initialize")
        );
        assert_eq!(
            messages[1].get("method").and_then(|value| value.as_str()),
            Some("initialized")
        );
        assert_eq!(
            messages[2].get("method").and_then(|value| value.as_str()),
            Some("textDocument/didOpen")
        );
    }

    #[test]
    fn opening_typescript_document_uses_typescript_language_id() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::TypeScript)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/app.ts".to_string(),
                "export const answer = 42;".to_string(),
            )
            .expect("open document");

        let messages = transport.sent_messages();
        let did_open = messages
            .iter()
            .find(|message| {
                message.get("method").and_then(|value| value.as_str())
                    == Some("textDocument/didOpen")
            })
            .expect("didOpen message");

        assert_eq!(
            did_open
                .pointer("/params/textDocument/languageId")
                .and_then(|value| value.as_str()),
            Some("typescript")
        );
    }

    #[test]
    fn duplicate_open_sends_did_change_instead_of_second_did_open() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}\n".to_string(),
            )
            .expect("open first version");
        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() { println!(\"hi\"); }\n".to_string(),
            )
            .expect("open second version");

        let methods = transport
            .sent_messages()
            .into_iter()
            .filter_map(|message| {
                message
                    .get("method")
                    .and_then(serde_json::Value::as_str)
                    .map(ToString::to_string)
            })
            .collect::<Vec<_>>();

        assert_eq!(
            methods
                .iter()
                .filter(|method| method.as_str() == "textDocument/didOpen")
                .count(),
            1
        );
        assert_eq!(
            methods
                .iter()
                .filter(|method| method.as_str() == "textDocument/didChange")
                .count(),
            1
        );
    }

    #[test]
    fn ensure_unsupported_document_returns_unsupported_without_starting_server() {
        let manager = LanguageServerManager::default_for_tests();

        let result = manager
            .ensure_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "README.md".to_string(),
                "# Notes\n".to_string(),
                None,
            )
            .expect("ensure unsupported");

        assert_eq!(result.readiness, DocumentReadiness::Unsupported);
        assert_eq!(result.language, None);
        assert_eq!(result.server.state, ServerState::Unsupported);
        assert_eq!(result.command, None);
        assert!(manager.statuses().is_empty());
    }

    #[test]
    fn ensure_supported_document_starts_server_and_reports_ready() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        let result = manager
            .ensure_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}\n".to_string(),
                Some(7),
            )
            .expect("ensure document");

        assert_eq!(result.readiness, DocumentReadiness::Ready);
        assert_eq!(result.language, Some(LanguageId::Rust));
        assert_eq!(result.server.state, ServerState::Running);
        assert_eq!(result.server.open_documents, 1);
        assert_eq!(result.command.as_deref(), Some("rust-analyzer"));

        let methods = transport
            .sent_messages()
            .into_iter()
            .filter_map(|message| {
                message
                    .get("method")
                    .and_then(serde_json::Value::as_str)
                    .map(ToString::to_string)
            })
            .collect::<Vec<_>>();

        assert_eq!(
            methods,
            vec!["initialize", "initialized", "textDocument/didOpen"]
        );
    }

    #[test]
    fn ensure_open_document_sends_did_change_for_new_content() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        manager
            .ensure_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}\n".to_string(),
                Some(1),
            )
            .expect("ensure first version");
        let result = manager
            .ensure_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() { println!(\"hi\"); }\n".to_string(),
                Some(2),
            )
            .expect("ensure second version");

        assert_eq!(result.readiness, DocumentReadiness::Ready);
        assert_eq!(
            transport
                .sent_messages()
                .iter()
                .filter(|message| {
                    message.get("method").and_then(serde_json::Value::as_str)
                        == Some("textDocument/didChange")
                })
                .count(),
            1
        );
    }

    #[test]
    fn ensure_same_content_does_not_send_duplicate_did_change() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        manager
            .ensure_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}\n".to_string(),
                Some(1),
            )
            .expect("ensure first version");
        manager
            .ensure_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}\n".to_string(),
                Some(1),
            )
            .expect("ensure same version");

        assert_eq!(
            transport
                .sent_messages()
                .iter()
                .filter(|message| {
                    message.get("method").and_then(serde_json::Value::as_str)
                        == Some("textDocument/didChange")
                })
                .count(),
            0
        );
    }

    #[test]
    fn ensure_missing_command_reports_command_without_starting_server() {
        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            |_profile| Err("command not found".to_string()),
        );

        let result = manager
            .ensure_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}\n".to_string(),
                None,
            )
            .expect("ensure missing command");

        assert_eq!(result.readiness, DocumentReadiness::MissingCommand);
        assert_eq!(result.server.state, ServerState::MissingCommand);
        assert_eq!(result.command.as_deref(), Some("rust-analyzer"));
        assert_eq!(
            result.last_error.as_deref(),
            Some("rust-analyzer: command not found")
        );
    }

    #[test]
    fn running_status_serializes_command_resolution_details() {
        let manager = LanguageServerManager::default_for_tests();

        let status = manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}\n".to_string(),
            )
            .expect("open");
        let value = serde_json::to_value(status).expect("serialize status");

        let resolved = value
            .get("resolved_command_path")
            .and_then(serde_json::Value::as_str)
            .expect("resolved command path");
        assert!(
            resolved.ends_with("rust-analyzer"),
            "resolved path should name rust-analyzer, got {resolved}"
        );
        assert_eq!(value.get("last_stderr"), Some(&serde_json::Value::Null));
    }

    #[test]
    fn running_status_refreshes_transport_stderr_excerpt() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));
        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}\n".to_string(),
            )
            .expect("open");
        transport.set_stderr("rust-analyzer stderr line\n");

        let status = manager
            .status_for_workspace("workspace", "/workspace")
            .into_iter()
            .find(|status| status.language == LanguageId::Rust)
            .expect("rust status");

        assert_eq!(
            status.last_stderr.as_deref(),
            Some("rust-analyzer stderr line\n")
        );
    }

    #[test]
    fn missing_command_status_and_logs_include_configured_command() {
        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            |_profile| Err("command not found".to_string()),
        );

        let result = manager
            .ensure_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}\n".to_string(),
                None,
            )
            .expect("ensure missing command");
        let logs = manager.server_logs("workspace", "/workspace");

        assert_eq!(
            result.last_error.as_deref(),
            Some("rust-analyzer: command not found")
        );
        assert!(logs
            .iter()
            .any(|line| line.contains("rust-analyzer") && line.contains("command not found")));
    }

    #[test]
    fn closing_one_of_two_open_documents_sends_did_close_without_stopping_server() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}\n".to_string(),
            )
            .expect("open main");
        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/lib.rs".to_string(),
                "pub fn lib() {}\n".to_string(),
            )
            .expect("open lib");

        let status = manager
            .close_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
            )
            .expect("close main");

        assert_eq!(status.state, ServerState::Running);
        assert_eq!(status.open_documents, 1);
        assert!(transport.sent_messages().iter().any(|message| {
            message.get("method").and_then(serde_json::Value::as_str)
                == Some("textDocument/didClose")
                && message
                    .pointer("/params/textDocument/uri")
                    .and_then(serde_json::Value::as_str)
                    == Some("file:///workspace/src/main.rs")
        }));
    }

    #[test]
    fn restart_replays_tracked_open_documents() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": serde_json::json!({}),
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}\n".to_string(),
            )
            .expect("open");
        manager
            .restart_server("workspace", "/workspace", LanguageId::Rust)
            .expect("restart");

        assert_eq!(
            transport
                .sent_messages()
                .iter()
                .filter(|message| {
                    message.get("method").and_then(serde_json::Value::as_str)
                        == Some("textDocument/didOpen")
                })
                .count(),
            2
        );
    }

    #[test]
    fn opening_documents_consumes_publish_diagnostics_events() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );
        transport.push_event(serde_json::json!({
            "method": "textDocument/publishDiagnostics",
            "params": {
                "uri": "file:///workspace/src/main.rs",
                "diagnostics": [{
                    "range": {
                        "start": { "line": 1, "character": 0 },
                        "end": { "line": 1, "character": 4 },
                    },
                    "severity": 1,
                    "message": "unexpected token",
                    "source": "test",
                }],
            },
        }));

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open");

        let diagnostics = manager.document_diagnostics("workspace", "/workspace", "src/main.rs");
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message, "unexpected token");
        assert_eq!(diagnostics[0].path, "src/main.rs");
    }

    #[test]
    fn workspace_diagnostics_drain_events_that_arrive_after_open() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open");
        transport.push_event(serde_json::json!({
            "method": "textDocument/publishDiagnostics",
            "params": {
                "uri": "file:///workspace/src/main.rs",
                "diagnostics": [{
                    "range": {
                        "start": { "line": 2, "character": 0 },
                        "end": { "line": 2, "character": 4 },
                    },
                    "severity": 2,
                    "message": "late diagnostic",
                    "source": "test",
                }],
            },
        }));

        let diagnostics = manager.workspace_diagnostics("workspace", "/workspace");

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message, "late diagnostic");
    }

    #[test]
    fn missing_command_reports_missing_state_without_starting_servers() {
        let capture = TransportFixtureState::default();
        let _unused_transport = TestTransport::new(capture);

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            |_profile| Err("command not found".to_string()),
        );

        let status = manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open document");

        assert_eq!(status.state, ServerState::MissingCommand);
        assert_eq!(
            status.last_error,
            Some("rust-analyzer: command not found".to_string()),
        );
    }

    #[test]
    fn provider_requests_return_raw_lsp_results() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": serde_json::json!({
                "contents": "hover payload",
            }),
        }));
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "result": serde_json::json!([{
                "uri": "file:///workspace/src/main.rs",
            }]),
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open");

        let hover = manager
            .hover("workspace", "/workspace", "src/main.rs", 0, 5)
            .expect("hover");
        let definition = manager
            .definition("workspace", "/workspace", "src/main.rs", 0, 5)
            .expect("definition");

        assert_eq!(hover, serde_json::json!({ "contents": "hover payload" }));
        assert_eq!(
            definition,
            vec![serde_json::json!({
                "uri": "file:///workspace/src/main.rs",
            })],
        );
    }

    #[test]
    fn completion_preserves_completion_list_shape() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": {
                "isIncomplete": true,
                "items": [{
                    "label": "main",
                    "kind": 3,
                    "insertText": "main()",
                }],
            },
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open");

        let completion = manager
            .completion("workspace", "/workspace", "src/main.rs", 0, 5)
            .expect("completion");

        assert_eq!(
            completion
                .pointer("/items/0/label")
                .and_then(serde_json::Value::as_str),
            Some("main")
        );
        assert_eq!(
            completion
                .get("isIncomplete")
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn symbols_request_uses_lsp_workspace_symbol_method() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": [],
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open");
        manager
            .symbols("workspace", "/workspace", "User")
            .expect("symbols");

        assert!(transport.sent_messages().iter().any(|message| {
            message.get("method").and_then(serde_json::Value::as_str) == Some("workspace/symbol")
                && message
                    .pointer("/params/query")
                    .and_then(serde_json::Value::as_str)
                    == Some("User")
        }));
    }

    #[test]
    fn symbols_request_recovers_stopped_server_with_open_documents() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": serde_json::json!({}),
        }));
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "result": [],
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open document");

        {
            let mut state = manager.state.lock().expect("state lock");
            let key = LanguageServerKey {
                workspace_id: "workspace".to_string(),
                workspace_root: "/workspace".to_string(),
                language: LanguageId::Rust,
            };
            let record = state.servers.get_mut(&key).expect("record");
            record.state = ServerState::Stopped;
            record.transport = None;
            record.initialized = false;
        }

        let symbols = manager
            .symbols("workspace", "/workspace", "main")
            .expect("symbols");

        assert!(transport.sent_messages().iter().any(|message| {
            message.get("method").and_then(serde_json::Value::as_str) == Some("workspace/symbol")
                && message
                    .pointer("/params/query")
                    .and_then(serde_json::Value::as_str)
                    == Some("main")
        }));
        assert!(symbols.is_empty());
    }

    #[test]
    fn restart_recovery_of_stopped_server_does_not_duplicate_did_open_for_new_document() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        let closure_capture = capture.clone();
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": serde_json::json!({}),
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(closure_capture.clone()))),
        );

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open first document");

        {
            let mut state = manager.state.lock().expect("state lock");
            let key = LanguageServerKey {
                workspace_id: "workspace".to_string(),
                workspace_root: "/workspace".to_string(),
                language: LanguageId::Rust,
            };
            let record = state.servers.get_mut(&key).expect("record");
            record.state = ServerState::Running;
            record.initialized = true;
            let dead_transport = TestTransport::new(capture.clone());
            *dead_transport
                .state
                .stopped
                .lock()
                .expect("dead transport stopped lock") = true;
            record.transport = Some(Box::new(dead_transport));
        }

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/lib.rs".to_string(),
                "fn lib() {}".to_string(),
            )
            .expect("open second document");

        let lib_open_count = transport
            .sent_messages()
            .iter()
            .filter(|message| {
                message.get("method").and_then(serde_json::Value::as_str)
                    == Some("textDocument/didOpen")
                    && message
                        .pointer("/params/textDocument/uri")
                        .and_then(serde_json::Value::as_str)
                        == Some("file:///workspace/src/lib.rs")
            })
            .count();
        assert_eq!(lib_open_count, 1);
    }

    #[test]
    fn restart_server_failure_from_did_open_marks_server_error() {
        let capture = TransportFixtureState::default();
        let transport = TestTransport::new(capture.clone());
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": serde_json::json!({}),
        }));
        transport.push_response(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": serde_json::json!({}),
        }));

        let manager = LanguageServerManager::for_tests_with_factory(
            vec![TestServerProfile::available(LanguageId::Rust)],
            move |_profile| Ok(Box::new(TestTransport::new(capture.clone()))),
        );

        manager
            .open_document(
                "workspace".to_string(),
                "/workspace".to_string(),
                "src/main.rs".to_string(),
                "fn main() {}".to_string(),
            )
            .expect("open");

        transport.fail_send_on_call(4);

        let restarted = manager
            .restart_server("workspace", "/workspace", LanguageId::Rust)
            .expect("restart");

        assert_eq!(restarted.state, ServerState::Error);
        assert_eq!(
            restarted.last_error,
            Some("simulated transport send failure".to_string())
        );
        assert!(manager
            .server_logs("workspace", "/workspace")
            .iter()
            .any(|line| line.contains("failed to restart")));
    }

    #[test]
    fn file_uri_helpers_encode_spaces_and_reject_prefix_sibling_roots() {
        assert_eq!(
            as_file_uri("/workspace root", "src/main file.rs"),
            "file:///workspace%20root/src/main%20file.rs"
        );
        assert_eq!(
            relative_path_from_uri(
                "/workspace root",
                "file:///workspace%20root/src/main%20file.rs",
            ),
            Some("src/main file.rs".to_string())
        );
        assert_eq!(
            relative_path_from_uri("/workspace", "file:///workspace-other/src/main.rs"),
            None
        );
    }

    #[test]
    fn file_uri_helpers_support_windows_drive_paths() {
        assert_eq!(
            as_file_uri("C:\\workspace\\app", "src\\main file.ts"),
            "file:///C:/workspace/app/src/main%20file.ts"
        );
        assert_eq!(
            as_file_uri("c:\\workspace\\app", "src/a b.ts"),
            "file:///c:/workspace/app/src/a%20b.ts"
        );
    }

    #[test]
    fn relative_path_from_uri_supports_windows_drive_paths_and_rejects_escape() {
        assert_eq!(
            relative_path_from_uri(
                "C:\\workspace\\app",
                "file:///C:/workspace/app/src/main%20file.ts",
            ),
            Some("src/main file.ts".to_string())
        );
        assert_eq!(
            relative_path_from_uri("C:\\workspace\\app", "file:///c:/workspace/app/src/main.ts",),
            Some("src/main.ts".to_string())
        );
        assert_eq!(
            relative_path_from_uri(
                "C:\\workspace\\app",
                "file:///C:/workspace/app2/src/main.ts"
            ),
            None
        );
        assert_eq!(
            relative_path_from_uri(
                "C:\\workspace\\app",
                "file:///C:/workspace/app/%2e%2e/other.ts"
            ),
            None
        );
    }

    #[test]
    fn server_requests_with_colliding_ids_are_not_treated_as_responses() {
        assert!(!is_lsp_response_for(
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "workspace/configuration",
                "params": {},
            }),
            2,
        ));
        assert!(is_lsp_response_for(
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "result": {},
            }),
            2,
        ));
    }

    #[test]
    fn workspace_configuration_requests_receive_matching_response_items() {
        let response = server_request_response(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 99,
            "method": "workspace/configuration",
            "params": {
                "items": [{}, {}, {}]
            },
        }))
        .expect("response");

        assert_eq!(response.get("id"), Some(&serde_json::json!(99)));
        assert_eq!(
            response
                .get("result")
                .and_then(serde_json::Value::as_array)
                .map(Vec::len),
            Some(3)
        );
    }

    #[test]
    fn server_request_responses_preserve_string_json_rpc_ids() {
        let response = server_request_response(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": "cfg-1",
            "method": "workspace/configuration",
            "params": {
                "items": [{}]
            },
        }))
        .expect("response");

        assert_eq!(response.get("id"), Some(&serde_json::json!("cfg-1")));
        assert_eq!(
            response
                .get("result")
                .and_then(serde_json::Value::as_array)
                .map(Vec::len),
            Some(1)
        );
    }

    #[test]
    fn server_requests_with_json_rpc_id_are_answered_when_waiting_for_response() {
        let workspace = tempfile::tempdir().expect("temp workspace");
        let script_path = workspace.path().join("mock_stdio_server.py");
        let log_path = workspace.path().join("request-log.json");

        let script = r#"
import json
import select
import sys


def write_message(message):
    body = json.dumps(message, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii"))
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()


def read_frame(timeout_seconds):
    readers, _, _ = select.select([sys.stdin.buffer], [], [], timeout_seconds)
    if not readers:
        return None

    header = bytearray()
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        if line in (b"\r\n", b"\n"):
            break
        header.extend(line)

    content_length = None
    for line in header.splitlines():
        if line.startswith(b"Content-Length:"):
            content_length = int(line.split(b":", 1)[1].strip())
            break

    if content_length is None:
        return None

    body = sys.stdin.buffer.read(content_length)
    return json.loads(body)


write_message({
    "jsonrpc": "2.0",
    "id": 99,
    "method": "workspace/configuration",
    "params": {"items": [{} , {}]},
})

initialize = read_frame(2.0)
configuration_response = read_frame(3.0)

with open("__LOG_PATH__", "w", encoding="utf-8") as logfile:
    logfile.write(json.dumps(configuration_response))

write_message({
    "jsonrpc": "2.0",
    "id": (initialize.get("id") if isinstance(initialize, dict) else 1),
    "result": {},
})
"#;
        let script = script.replace("__LOG_PATH__", &log_path.to_string_lossy());
        std::fs::write(&script_path, script).expect("write script");

        let profile = LanguageServerProfile {
            language: LanguageId::Rust,
            display_name: "mock-lsp".to_string(),
            command: "python3".to_string(),
            args: vec![script_path.to_string_lossy().to_string()],
            cwd: None,
        };
        let mut transport = StdioTransport::new(&profile).expect("create transport");

        let response = transport
            .request(
                request_payload("initialize", 1, serde_json::json!({})),
                std::time::Duration::from_millis(2500),
            )
            .expect("request");
        assert_eq!(
            response
                .get("result")
                .and_then(serde_json::Value::as_object),
            Some(&serde_json::Map::new())
        );

        let log = std::fs::read_to_string(log_path).expect("read log");
        let response: serde_json::Value =
            serde_json::from_str(&log).unwrap_or(serde_json::json!(null));
        assert_eq!(response.get("id"), Some(&serde_json::json!(99)));
        assert!(response.get("result").is_some());
    }

    #[test]
    #[ignore = "requires rust-analyzer, typescript-language-server, and pylsp on PATH"]
    fn real_language_servers_open_baseline_documents() {
        let workspace = tempfile::tempdir().expect("workspace");
        let workspace_root = workspace
            .path()
            .to_str()
            .expect("workspace path")
            .to_string();
        std::fs::create_dir_all(workspace.path().join("src")).expect("src dir");
        std::fs::write(
            workspace.path().join("Cargo.toml"),
            "[package]\nname = \"lsp_smoke\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )
        .expect("cargo manifest");
        std::fs::write(workspace.path().join("src/main.rs"), "fn main() {}\n").expect("rust file");
        std::fs::write(workspace.path().join("package.json"), "{}\n").expect("package manifest");
        std::fs::write(
            workspace.path().join("src/app.ts"),
            "export const answer: number = 42;\n",
        )
        .expect("typescript file");
        std::fs::write(
            workspace.path().join("src/app.js"),
            "export const answer = 42;\n",
        )
        .expect("javascript file");
        std::fs::write(workspace.path().join("app.py"), "answer = 42\n").expect("python file");

        let manager = LanguageServerManager::new();
        let documents = [
            ("src/main.rs", "fn main() {}\n", LanguageId::Rust),
            (
                "src/app.ts",
                "export const answer: number = 42;\n",
                LanguageId::TypeScript,
            ),
            (
                "src/app.js",
                "export const answer = 42;\n",
                LanguageId::JavaScript,
            ),
            ("app.py", "answer = 42\n", LanguageId::Python),
        ];
        for (path, content, language) in documents {
            let status = manager
                .open_document(
                    "workspace".to_string(),
                    workspace_root.clone(),
                    path.to_string(),
                    content.to_string(),
                )
                .unwrap_or_else(|error| panic!("{language:?} open failed: {error}"));

            assert_eq!(status.language, language);
            assert_eq!(
                status.state,
                ServerState::Running,
                "{language:?} should run, last_error: {:?}",
                status.last_error
            );
            assert!(status.pid.is_some(), "{language:?} should expose a pid");
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
        for (path, _, _) in documents {
            let status = manager
                .close_document(
                    "workspace".to_string(),
                    workspace_root.clone(),
                    path.to_string(),
                )
                .unwrap_or_else(|error| panic!("{path} close failed: {error}"));
            assert_eq!(status.state, ServerState::Stopped);
        }
    }
}
