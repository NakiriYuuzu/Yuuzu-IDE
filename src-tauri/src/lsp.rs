use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Hash, Serialize, Deserialize)]
pub enum LanguageId {
    Rust,
    TypeScript,
    JavaScript,
    Python,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LanguageServerProfile {
    pub language: LanguageId,
    pub display_name: String,
    pub command: String,
    pub args: Vec<String>,
}

pub fn detect_language(path: &str) -> Option<LanguageId> {
    let extension = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();

    match extension.as_str() {
        "rs" => Some(LanguageId::Rust),
        "ts" | "tsx" | "mts" | "cts" => Some(LanguageId::TypeScript),
        "js" | "jsx" | "mjs" | "cjs" => Some(LanguageId::JavaScript),
        "py" | "pyw" | "pyi" => Some(LanguageId::Python),
        _ => None,
    }
}

pub fn server_profile(language: LanguageId) -> LanguageServerProfile {
    match language {
        LanguageId::Rust => LanguageServerProfile {
            language,
            display_name: "Rust Analyzer".to_string(),
            command: "rust-analyzer".to_string(),
            args: Vec::new(),
        },
        LanguageId::TypeScript => LanguageServerProfile {
            language,
            display_name: "TypeScript Language Server".to_string(),
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
        },
        LanguageId::JavaScript => LanguageServerProfile {
            language,
            display_name: "JavaScript Language Server".to_string(),
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
        },
        LanguageId::Python => LanguageServerProfile {
            language,
            display_name: "Python LSP Server".to_string(),
            command: "pylsp".to_string(),
            args: Vec::new(),
        },
    }
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
    MissingCommand,
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
    pub state: ServerState,
    pub pid: Option<u32>,
    pub memory_bytes: Option<u64>,
    pub open_documents: usize,
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

#[derive(Default)]
struct LanguageServerManagerState {
    test_profiles: HashMap<LanguageId, TestServerProfile>,
    servers: HashMap<LanguageServerKey, LanguageServerRecord>,
    diagnostics: HashMap<(String, String, String), Vec<LspDiagnostic>>,
    logs: HashMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
struct LanguageServerKey {
    workspace_id: String,
    workspace_root: String,
    language: LanguageId,
}

#[derive(Clone, Debug)]
struct LanguageServerRecord {
    display_name: String,
    state: ServerState,
    pid: Option<u32>,
    memory_bytes: Option<u64>,
    open_documents: HashSet<String>,
    last_used_at: u64,
    last_error: Option<String>,
}

impl LanguageServerRecord {
    fn from_profile(profile: &LanguageServerProfile, available: bool) -> Self {
        Self {
            display_name: profile.display_name.clone(),
            state: if available {
                ServerState::Running
            } else {
                ServerState::MissingCommand
            },
            pid: None,
            memory_bytes: None,
            open_documents: HashSet::new(),
            last_used_at: current_unix_millis(),
            last_error: None,
        }
    }

    fn status(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        language: LanguageId,
    ) -> LanguageServerStatus {
        LanguageServerStatus {
            workspace_id: workspace_id.to_string(),
            workspace_root: workspace_root.to_string(),
            language,
            display_name: self.display_name.clone(),
            state: self.state.clone(),
            pid: self.pid,
            memory_bytes: self.memory_bytes,
            open_documents: self.open_documents.len(),
            last_error: self.last_error.clone(),
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

pub struct LanguageServerManager {
    state: Mutex<LanguageServerManagerState>,
}

impl Default for LanguageServerManager {
    fn default() -> Self {
        Self::default_for_tests()
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
        ])
    }

    pub fn for_tests(profiles: Vec<TestServerProfile>) -> Self {
        let mut available = HashMap::new();
        for language in [
            LanguageId::Rust,
            LanguageId::TypeScript,
            LanguageId::JavaScript,
            LanguageId::Python,
        ] {
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
        }
    }

    pub fn open_document(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        _content: String,
    ) -> Result<LanguageServerStatus, String> {
        self.open_document_at(
            workspace_id,
            workspace_root,
            path,
            _content,
            current_unix_millis(),
        )
    }

    pub fn open_document_at(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        _content: String,
        now: u64,
    ) -> Result<LanguageServerStatus, String> {
        let Some(language) = detect_language(&path) else {
            return Ok(LanguageServerStatus {
                workspace_id,
                workspace_root,
                language: LanguageId::Rust,
                display_name: "Unsupported".to_string(),
                state: ServerState::Unsupported,
                pid: None,
                memory_bytes: None,
                open_documents: 0,
                last_error: Some("unsupported file type".to_string()),
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
        let server_profile = server_profile(language);
        let key = LanguageServerKey {
            workspace_id: workspace_id.clone(),
            workspace_root: workspace_root.clone(),
            language,
        };

        let entry = state.servers.entry(key.clone()).or_insert_with(|| {
            let mut record = LanguageServerRecord::from_profile(&server_profile, profile.available);
            if !profile.available {
                record.last_error = Some("command not available".to_string());
            }
            record
        });

        if profile.available {
            entry.state = ServerState::Running;
            entry.last_error = None;
            if let Some(pid) = entry.pid {
                if let Some(memory_bytes) = sample_memory_bytes(pid) {
                    entry.memory_bytes = Some(memory_bytes);
                }
            }
        } else {
            entry.state = ServerState::MissingCommand;
            entry.last_error = Some("command not available".to_string());
        }
        entry.open_documents.insert(path);
        entry.last_used_at = now;

        Ok(entry.status(&key.workspace_id, &key.workspace_root, key.language))
    }

    pub fn restart_server(
        &self,
        workspace_id: &str,
        language: LanguageId,
    ) -> Result<LanguageServerStatus, String> {
        let mut state = self.state.lock().map_err(|err| err.to_string())?;

        let key = state
            .servers
            .iter()
            .filter_map(|(key, record)| {
                if key.workspace_id == workspace_id && key.language == language {
                    Some((key.clone(), record.last_used_at))
                } else {
                    None
                }
            })
            .max_by_key(|(_, last_used_at)| *last_used_at)
            .map(|(key, _)| key);

        let Some(key) = key else {
            return Err(format!("language server not found for {workspace_id}"));
        };

        let profile = state
            .test_profiles
            .get(&language)
            .cloned()
            .unwrap_or(TestServerProfile {
                language,
                available: false,
            });
        let entry = state
            .servers
            .get_mut(&key)
            .ok_or_else(|| format!("language server not found for {workspace_id}"))?;
        let (status, log_line) = {
            let display_name = entry.display_name.clone();
            if let Some(pid) = entry.pid {
                if let Some(memory_bytes) = sample_memory_bytes(pid) {
                    entry.memory_bytes = Some(memory_bytes);
                }
            }

            if profile.available {
                entry.state = ServerState::Running;
                entry.last_error = None;
                (
                    entry.status(&key.workspace_id, &key.workspace_root, key.language),
                    format!("restarted {}", display_name),
                )
            } else {
                entry.state = ServerState::MissingCommand;
                entry.last_error = Some("command not available".to_string());
                (
                    entry.status(&key.workspace_id, &key.workspace_root, key.language),
                    format!("failed to restart {}", display_name),
                )
            }
        };

        entry.last_used_at = current_unix_millis();

        append_workspace_log(
            state.logs.entry(workspace_id.to_string()).or_default(),
            log_line,
        );

        Ok(status)
    }

    pub fn server_logs(&self, workspace_id: &str) -> Vec<String> {
        let Ok(state) = self.state.lock() else {
            return Vec::new();
        };

        state.logs.get(workspace_id).cloned().unwrap_or_default()
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
            entry.last_used_at = current_unix_millis();
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
                state: ServerState::Unsupported,
                pid: None,
                memory_bytes: None,
                open_documents: 0,
                last_error: Some("unsupported file type".to_string()),
            });
        };

        let mut state = self.state.lock().map_err(|err| err.to_string())?;
        let key = LanguageServerKey {
            workspace_id: workspace_id.clone(),
            workspace_root: workspace_root.clone(),
            language,
        };
        if let Some(entry) = state.servers.get_mut(&key) {
            entry.open_documents.remove(&path);
            if entry.state == ServerState::Running && entry.open_documents.is_empty() {
                entry.state = ServerState::Stopped;
            }
            entry.last_used_at = current_unix_millis();
            return Ok(entry.status(&key.workspace_id, &key.workspace_root, key.language));
        }

        let profile = state
            .test_profiles
            .get(&language)
            .cloned()
            .unwrap_or(TestServerProfile {
                language,
                available: false,
            });

        Ok(LanguageServerStatus {
            workspace_id,
            workspace_root,
            language,
            display_name: server_profile(language).display_name,
            state: if profile.available {
                ServerState::Stopped
            } else {
                ServerState::MissingCommand
            },
            pid: None,
            memory_bytes: None,
            open_documents: 0,
            last_error: None,
        })
    }

    pub fn statuses(&self) -> Vec<LanguageServerStatus> {
        let Ok(state) = self.state.lock() else {
            return Vec::new();
        };
        let mut statuses = state
            .servers
            .iter()
            .map(|(key, record)| {
                record.status(&key.workspace_id, &key.workspace_root, key.language)
            })
            .collect::<Vec<_>>();
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
        self.statuses()
            .into_iter()
            .filter(|status| {
                status.workspace_id == workspace_id && status.workspace_root == workspace_root
            })
            .collect()
    }

    pub fn document_status(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
    ) -> Option<LanguageServerStatus> {
        let language = detect_language(path)?;
        let state = self.state.lock().ok()?;
        let key = LanguageServerKey {
            workspace_id: workspace_id.to_string(),
            workspace_root: workspace_root.to_string(),
            language,
        };
        state
            .servers
            .get(&key)
            .map(|entry| entry.status(&key.workspace_id, &key.workspace_root, key.language))
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

    pub fn document_diagnostics(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
    ) -> Vec<LspDiagnostic> {
        let Ok(state) = self.state.lock() else {
            return Vec::new();
        };
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
        for record in state.servers.values_mut() {
            if record.state == ServerState::Running
                && now_ms.saturating_sub(record.last_used_at) > idle_timeout_ms
            {
                record.state = ServerState::Stopped;
            }
        }
    }
}

pub struct LspState {
    manager: Mutex<LanguageServerManager>,
}

impl Default for LspState {
    fn default() -> Self {
        Self::new()
    }
}

impl LspState {
    pub fn new() -> Self {
        Self {
            manager: Mutex::new(LanguageServerManager::new()),
        }
    }

    #[cfg(test)]
    pub fn new_for_tests() -> Self {
        Self {
            manager: Mutex::new(LanguageServerManager::default_for_tests()),
        }
    }

    pub fn open_document(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
        content: String,
    ) -> Result<LanguageServerStatus, String> {
        let manager = self.manager.lock().map_err(|err| err.to_string())?;
        manager.open_document(workspace_id, workspace_root, path, content)
    }

    pub fn close_document(
        &self,
        workspace_id: String,
        workspace_root: String,
        path: String,
    ) -> Result<LanguageServerStatus, String> {
        let manager = self.manager.lock().map_err(|err| err.to_string())?;
        manager.close_document(workspace_id, workspace_root, path)
    }

    pub fn restart_server(
        &self,
        workspace_id: String,
        language: LanguageId,
    ) -> Result<LanguageServerStatus, String> {
        let manager = self.manager.lock().map_err(|err| err.to_string())?;
        manager.restart_server(&workspace_id, language)
    }

    pub fn server_logs(&self, workspace_id: String) -> Vec<String> {
        if let Ok(manager) = self.manager.lock() {
            return manager.server_logs(&workspace_id);
        }

        Vec::new()
    }

    pub fn set_memory_for_tests(&self, workspace_id: String, language: LanguageId, bytes: u64) {
        if let Ok(manager) = self.manager.lock() {
            manager.set_memory_for_tests(&workspace_id, language, bytes);
        }
    }

    pub fn statuses(
        &self,
        workspace_id: String,
        workspace_root: String,
    ) -> Vec<LanguageServerStatus> {
        self.manager
            .lock()
            .map(|manager| manager.status_for_workspace(&workspace_id, &workspace_root))
            .unwrap_or_default()
    }

    pub fn document_status(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
    ) -> Result<Option<LanguageServerStatus>, String> {
        let manager = self.manager.lock().map_err(|err| err.to_string())?;
        Ok(manager.document_status(workspace_id, workspace_root, path))
    }

    pub fn document_diagnostics(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        path: &str,
    ) -> Vec<LspDiagnostic> {
        self.manager
            .lock()
            .map(|manager| manager.document_diagnostics(workspace_id, workspace_root, path))
            .unwrap_or_default()
    }

    pub fn workspace_diagnostics(
        &self,
        workspace_id: &str,
        workspace_root: &str,
    ) -> Vec<LspDiagnostic> {
        self.manager
            .lock()
            .map(|manager| manager.workspace_diagnostics(workspace_id, workspace_root))
            .unwrap_or_default()
    }

    pub fn sweep_idle_servers(&self, now_ms: u64, idle_timeout_ms: u64) {
        if let Ok(manager) = self.manager.lock() {
            manager.sweep_idle_servers(now_ms, idle_timeout_ms);
        }
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
        assert_eq!(
            server_profile(LanguageId::TypeScript).args,
            vec!["--stdio".to_string()]
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
            .restart_server("workspace", LanguageId::Rust)
            .expect("restart");

        assert_eq!(restarted.state, ServerState::Running);
        assert!(manager
            .server_logs("workspace")
            .iter()
            .any(|line| line.contains("restarted Rust Analyzer")));
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
}
