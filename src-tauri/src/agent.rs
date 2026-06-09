use std::{
    ffi::OsStr,
    fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_AGENT_CONTEXT_CHARS: usize = 120_000;
pub const MAX_AGENT_TRANSCRIPT_CHARS: usize = 120_000;
const MAX_AGENT_SESSIONS: usize = 80;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
    Plan,
    Edit,
    Verify,
    Review,
    Report,
}

impl AgentMode {
    fn as_label(&self) -> &'static str {
        match self {
            AgentMode::Plan => "plan",
            AgentMode::Edit => "edit",
            AgentMode::Verify => "verify",
            AgentMode::Review => "review",
            AgentMode::Report => "report",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentContextKind {
    File,
    Doc,
    Diff,
    Diagnostic,
    Terminal,
}

impl AgentContextKind {
    fn as_label(&self) -> &'static str {
        match self {
            AgentContextKind::File => "file",
            AgentContextKind::Doc => "doc",
            AgentContextKind::Diff => "diff",
            AgentContextKind::Diagnostic => "diagnostic",
            AgentContextKind::Terminal => "terminal",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AgentContextItem {
    pub id: String,
    pub kind: AgentContextKind,
    pub label: String,
    pub path: Option<String>,
    pub content: String,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentTranscriptKind {
    UserPrompt,
    AssistantMessage,
    ToolCall,
    CommandOutput,
    Diff,
    Verification,
    ApprovalRequest,
    Report,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentEvidenceStatus {
    Pending,
    Passed,
    Failed,
    Skipped,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentApprovalStatus {
    Pending,
    Approved,
    Rejected,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AgentTranscriptEntry {
    pub id: String,
    pub session_id: String,
    pub kind: AgentTranscriptKind,
    pub title: String,
    pub content: String,
    pub status: Option<AgentEvidenceStatus>,
    pub approval_status: Option<AgentApprovalStatus>,
    pub metadata: serde_json::Value,
    pub created_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AgentTranscriptInput {
    pub kind: AgentTranscriptKind,
    pub title: String,
    pub content: String,
    pub status: Option<AgentEvidenceStatus>,
    pub metadata: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AgentSession {
    pub id: String,
    pub workspace_root: String,
    pub mode: AgentMode,
    pub prompt: String,
    pub context_items: Vec<AgentContextItem>,
    pub transcript: Vec<AgentTranscriptEntry>,
    pub created_ms: u64,
    pub updated_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AgentPromptExport {
    pub session_id: String,
    pub filename: String,
    pub content: String,
}

#[derive(Clone, Debug)]
pub struct AgentSessionStore {
    path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl AgentSessionStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn list_sessions(&self, workspace_root: &str) -> Result<Vec<AgentSession>, String> {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        Ok(self
            .load()?
            .into_iter()
            .filter(|session| session.workspace_root == workspace_root)
            .collect())
    }

    pub fn start_session(
        &self,
        workspace_root: &str,
        mode: AgentMode,
        prompt: &str,
        context_items: Vec<AgentContextItem>,
    ) -> Result<AgentSession, String> {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        let mut sessions = self.load()?;
        let now = current_time_ms()?;
        let session_id = uuid::Uuid::new_v4().to_string();
        let mut session = AgentSession {
            id: session_id.clone(),
            workspace_root: workspace_root.to_string(),
            mode,
            prompt: bound_string(prompt, MAX_AGENT_TRANSCRIPT_CHARS).0,
            context_items: bound_context_items(context_items),
            transcript: Vec::new(),
            created_ms: now,
            updated_ms: now,
        };
        session.transcript.push(AgentTranscriptEntry {
            id: uuid::Uuid::new_v4().to_string(),
            session_id,
            kind: AgentTranscriptKind::UserPrompt,
            title: "Prompt".to_string(),
            content: session.prompt.clone(),
            status: None,
            approval_status: None,
            metadata: serde_json::json!({ "mode": session.mode.as_label() }),
            created_ms: now,
        });
        sessions.push(session.clone());
        trim_sessions(&mut sessions);
        self.save(&sessions)?;
        Ok(session)
    }

    pub fn append_transcript(
        &self,
        session_id: &str,
        entry: AgentTranscriptInput,
    ) -> Result<AgentTranscriptEntry, String> {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        let mut sessions = self.load()?;
        let now = current_time_ms()?;
        let session = session_mut(&mut sessions, session_id)?;
        let approval_status = match entry.kind {
            AgentTranscriptKind::ApprovalRequest => Some(AgentApprovalStatus::Pending),
            _ => None,
        };
        let transcript = AgentTranscriptEntry {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            kind: entry.kind,
            title: bound_string(&entry.title, 512).0,
            content: bound_string(&entry.content, MAX_AGENT_TRANSCRIPT_CHARS).0,
            status: entry.status,
            approval_status,
            metadata: entry.metadata,
            created_ms: now,
        };
        session.transcript.push(transcript.clone());
        session.updated_ms = now.max(session.updated_ms.saturating_add(1));
        self.save(&sessions)?;
        Ok(transcript)
    }

    pub fn update_approval(
        &self,
        session_id: &str,
        approval_id: &str,
        status: AgentApprovalStatus,
    ) -> Result<AgentSession, String> {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        let mut sessions = self.load()?;
        let now = current_time_ms()?;
        let session = session_mut(&mut sessions, session_id)?;
        let entry = session
            .transcript
            .iter_mut()
            .find(|entry| entry.id == approval_id)
            .ok_or_else(|| format!("approval not found: {approval_id}"))?;

        if entry.approval_status.is_none() {
            return Err(format!(
                "transcript entry is not an approval: {approval_id}"
            ));
        }

        entry.approval_status = Some(status);
        session.updated_ms = now.max(session.updated_ms.saturating_add(1));
        let updated = session.clone();
        self.save(&sessions)?;
        Ok(updated)
    }

    pub fn export_prompt(&self, session_id: &str) -> Result<AgentPromptExport, String> {
        let _guard = self.lock.lock().map_err(|err| err.to_string())?;
        let sessions = self.load()?;
        let session = sessions
            .iter()
            .find(|session| session.id == session_id)
            .ok_or_else(|| format!("agent session not found: {session_id}"))?;

        Ok(AgentPromptExport {
            session_id: session.id.clone(),
            filename: format!("agent-session-{}.md", &session.id[..8]),
            content: render_prompt_export(session),
        })
    }

    fn load(&self) -> Result<Vec<AgentSession>, String> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }

        let value = fs::read_to_string(&self.path).map_err(|err| err.to_string())?;
        serde_json::from_str(&value).map_err(|err| err.to_string())
    }

    fn save(&self, sessions: &[AgentSession]) -> Result<(), String> {
        if let Some(parent) = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let value = serde_json::to_string_pretty(sessions).map_err(|err| err.to_string())?;
        let parent = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let file_name = self
            .path
            .file_name()
            .unwrap_or_else(|| OsStr::new("agent-sessions.json"));
        let temp_path = parent.join(format!(
            ".{}.{}.tmp",
            file_name.to_string_lossy(),
            uuid::Uuid::new_v4()
        ));

        let result = (|| {
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

fn current_time_ms() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis() as u64)
}

fn bound_string(value: &str, max_chars: usize) -> (String, bool) {
    if value.chars().count() <= max_chars {
        return (value.to_string(), false);
    }

    let bounded = value
        .chars()
        .rev()
        .take(max_chars)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    (bounded, true)
}

fn bound_context_items(context_items: Vec<AgentContextItem>) -> Vec<AgentContextItem> {
    context_items
        .into_iter()
        .map(|mut item| {
            let (content, truncated) = bound_string(&item.content, MAX_AGENT_CONTEXT_CHARS);
            item.content = content;
            item.truncated = item.truncated || truncated;
            item
        })
        .collect()
}

fn trim_sessions(sessions: &mut Vec<AgentSession>) {
    sessions.sort_by(|left, right| right.updated_ms.cmp(&left.updated_ms));
    sessions.truncate(MAX_AGENT_SESSIONS);
}

fn session_mut<'a>(
    sessions: &'a mut [AgentSession],
    session_id: &str,
) -> Result<&'a mut AgentSession, String> {
    sessions
        .iter_mut()
        .find(|session| session.id == session_id)
        .ok_or_else(|| format!("agent session not found: {session_id}"))
}

fn render_prompt_export(session: &AgentSession) -> String {
    let mut output = String::new();
    output.push_str("# Agent Session Export\n\n");
    output.push_str(&format!("Session: {}\n", session.id));
    output.push_str(&format!("Mode: {}\n\n", session.mode.as_label()));
    output.push_str("## Prompt\n\n");
    output.push_str(&session.prompt);
    output.push_str("\n\n## Context Manifest\n\n");
    for item in &session.context_items {
        let path = item.path.as_deref().unwrap_or("-");
        output.push_str(&format!(
            "- [{}] {} ({}){}\n",
            item.kind.as_label(),
            item.label,
            path,
            if item.truncated { " truncated" } else { "" }
        ));
    }
    output.push_str("\n## Context\n\n");
    for item in &session.context_items {
        output.push_str(&format!(
            "### [{}] {}\n\n```text\n{}\n```\n\n",
            item.kind.as_label(),
            item.label,
            item.content
        ));
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context_item(kind: AgentContextKind, label: &str, content: &str) -> AgentContextItem {
        AgentContextItem {
            id: label.to_string(),
            kind,
            label: label.to_string(),
            path: Some(label.to_string()),
            content: content.to_string(),
            truncated: false,
        }
    }

    #[test]
    fn store_creates_workspace_scoped_session_with_context_manifest() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = AgentSessionStore::new(temp.path().join("agent-sessions.json"));

        let session = store
            .start_session(
                "/workspace",
                AgentMode::Plan,
                "Implement Node 7",
                vec![
                    context_item(AgentContextKind::Doc, "roadmap.md", "Node 7"),
                    context_item(AgentContextKind::File, "src/app/AppShell.tsx", "shell"),
                ],
            )
            .expect("start session");

        assert_eq!(session.workspace_root, "/workspace");
        assert_eq!(session.mode, AgentMode::Plan);
        assert_eq!(session.context_items.len(), 2);
        assert!(session
            .transcript
            .iter()
            .any(|entry| entry.kind == AgentTranscriptKind::UserPrompt));

        let other_workspace = store.list_sessions("/other").expect("list other");
        assert!(other_workspace.is_empty());

        let exported = store.export_prompt(&session.id).expect("export");
        assert!(exported.content.contains("Mode: plan"));
        assert!(exported.content.contains("roadmap.md"));
        assert!(exported.content.contains("src/app/AppShell.tsx"));
    }

    #[test]
    fn transcript_entries_and_approvals_persist_in_order() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = AgentSessionStore::new(temp.path().join("agent-sessions.json"));
        let session = store
            .start_session("/workspace", AgentMode::Edit, "Patch files", Vec::new())
            .expect("start session");

        let approval = store
            .append_transcript(
                &session.id,
                AgentTranscriptInput {
                    kind: AgentTranscriptKind::ApprovalRequest,
                    title: "Edit src/app/AppShell.tsx".to_string(),
                    content: "Requires review".to_string(),
                    status: Some(AgentEvidenceStatus::Pending),
                    metadata: serde_json::json!({ "approval_id": "approval-1" }),
                },
            )
            .expect("append approval");
        store
            .append_transcript(
                &session.id,
                AgentTranscriptInput {
                    kind: AgentTranscriptKind::Verification,
                    title: "bun test".to_string(),
                    content: "145 pass".to_string(),
                    status: Some(AgentEvidenceStatus::Passed),
                    metadata: serde_json::json!({ "command": "bun test" }),
                },
            )
            .expect("append verification");

        let updated = store
            .update_approval(&session.id, &approval.id, AgentApprovalStatus::Approved)
            .expect("approve");

        assert_eq!(updated.transcript.len(), 3);
        assert_eq!(
            updated.transcript[1].approval_status,
            Some(AgentApprovalStatus::Approved)
        );
        assert_eq!(
            updated.transcript[2].kind,
            AgentTranscriptKind::Verification
        );
    }

    #[test]
    fn context_and_transcript_content_are_bounded() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = AgentSessionStore::new(temp.path().join("agent-sessions.json"));
        let session = store
            .start_session(
                "/workspace",
                AgentMode::Report,
                "Summarize",
                vec![context_item(
                    AgentContextKind::Terminal,
                    "terminal:zsh",
                    &"x".repeat(MAX_AGENT_CONTEXT_CHARS + 32),
                )],
            )
            .expect("start session");

        assert_eq!(
            session.context_items[0].content.len(),
            MAX_AGENT_CONTEXT_CHARS
        );
        assert!(session.context_items[0].truncated);
    }
}
