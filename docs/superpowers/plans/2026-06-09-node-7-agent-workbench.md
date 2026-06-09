# Node 7 Agent Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a structured agent workbench where a user can compose an agent request from selected workspace context, persist the transcript, review diffs and verification evidence, gate risky actions, and export a reproducible prompt or plan.

**Architecture:** Rust owns durable agent sessions, bounded context snapshots, transcript entries, approval state, and export generation. React owns the compact workbench panel, prompt composer, mode controls, context selection UI, transcript rendering, and approval button interactions. Node 7 does not execute fully autonomous edits; it records and displays structured agent work so the user can review and reproduce it.

**Tech Stack:** Tauri 2, Rust 2021, `serde_json`, `uuid`, React 19.2.7, TypeScript 6.0.3, Vite 8.0.16, Bun 1.3.14, Zustand, lucide-react icons, shadcn-style controls, and `docs/ui-design/` panel/row/statusbar tokens.

**Subagent contract:** Development subagents must use `gpt-5.3-codex-spark` with `xhigh` reasoning. Spec-compliance and code-quality review subagents must use `gpt-5.5` with `xhigh` reasoning. Do not use `gpt-5.4`.

---

## Source Context

- `roadmap.md` Node 7 requires an agent session panel, prompt composer, selectable context from files/docs/diffs/diagnostics/terminal output, plan/edit/verify/review/report modes, transcript persistence, visible tool calls/command output/diffs/verification status, prompt/plan export, and approval gates.
- `docs/architecture/tech-stack.md` says Rust owns agent session persistence and context assembly; React renders streamed or bounded state.
- `docs/ui-design/app.jsx`, `docs/ui-design/panels.jsx`, and `docs/ui-design/ide.css` define the rail, compact panel head, dense rows, `badge2`, `dbgrid`, `statusbar`, `btn`, `input2`, and icon-button design source of truth.
- `src-tauri/src/docs.rs` already persists context packs with task and agent metadata links.
- `src/features/docs/*`, `src/features/git/*`, `src/features/tasks/*`, `src/features/terminal/*`, and `src/features/language/*` already expose bounded state that can become agent context.

## File Structure

- Create `src-tauri/src/agent.rs`: agent session types, session store, bounded context snapshots, transcript append, approval update, export generation, and Rust tests.
- Modify `src-tauri/src/commands.rs`: add `agent_store` to `AppState`, trusted workspace command wrappers, flat Tauri command functions, and command tests.
- Modify `src-tauri/src/lib.rs`: register the `agent` module and Tauri commands.
- Create `src/features/agents/agent-model.ts`: TypeScript types, pure state helpers, context summarizers, transcript grouping, export filename helpers, approval selectors, and state tests.
- Create `src/features/agents/agent-model.test.ts`: Bun tests for pure agent state and context selection.
- Create `src/features/agents/agent-api.ts`: typed Tauri wrappers for agent commands.
- Create `src/features/agents/AgentPanel.tsx`: compact panel with mode segmented control, prompt composer, context selector, session list, transcript rows, approval controls, and export button.
- Create `src/features/agents/AgentPanel.test.tsx`: UI tests for starting a session, context display, transcript evidence, approval buttons, and export action.
- Modify `src/app/activity-rail.tsx`: add Agents rail item using a lucide icon.
- Modify `src/app/command-palette-model.ts` and `src/app/command-palette-model.test.ts`: add agent commands.
- Modify `src/app/workspace-view-state.ts` and `src/app/workspace-view-state.test.ts`: add per-workspace `agent` view state and frozen defaults.
- Modify `src/app/AppShell.tsx`: wire agent commands, session loading, context assembly from existing bounded state, activity panel, and export.
- Modify `src/index.css`: add Agent panel, composer, context chips, transcript rows, diff/verification blocks, and responsive rules using existing panel tokens.
- Create `docs/architecture/node-7-agent-results.md`: verification, smoke evidence, TDD/review evidence, and residual risks.
- Modify `docs/architecture/progress.md`: append Node 7 status after verification.
- Modify `roadmap.md`: mark Node 7 complete and move current priority to Node 8 after verification.

## Command Contract

The Rust command surface for Node 7 is:

```text
list_agent_sessions(workspace_root)
start_agent_session(workspace_root, mode, prompt, context_items)
append_agent_transcript(session_id, entry)
update_agent_approval(session_id, approval_id, status)
export_agent_prompt(session_id)
```

All commands accept trusted workspace roots or session IDs already persisted for
registered workspaces. Context items are bounded strings captured at session
start, not live references to unbounded app state.

## Task 1: Rust Agent Session Store And Commands

**Files:**
- Create: `src-tauri/src/agent.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/agent.rs`
- Test: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write failing Rust tests for session persistence and export**

Create `src-tauri/src/agent.rs` with these tests first:

```rust
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
        assert_eq!(updated.transcript[1].approval_status, Some(AgentApprovalStatus::Approved));
        assert_eq!(updated.transcript[2].kind, AgentTranscriptKind::Verification);
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
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml agent::tests -- --nocapture
```

Expected: FAIL because `AgentSessionStore`, `AgentMode`, context types, and store methods are not implemented.

- [ ] **Step 3: Implement `src-tauri/src/agent.rs`**

Add the Rust module with these public types and methods:

```rust
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
        Self { path, lock: Arc::new(Mutex::new(())) }
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
            return Err(format!("transcript entry is not an approval: {approval_id}"));
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
        if let Some(parent) = self.path.parent().filter(|path| !path.as_os_str().is_empty()) {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let value = serde_json::to_string_pretty(sessions).map_err(|err| err.to_string())?;
        let parent = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let file_name = self.path.file_name().unwrap_or_else(|| OsStr::new("agent-sessions.json"));
        let temp_path = parent.join(format!(".{}.{}.tmp", file_name.to_string_lossy(), uuid::Uuid::new_v4()));
        let result = (|| {
            let mut file = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&temp_path)
                .map_err(|err| err.to_string())?;
            file.write_all(value.as_bytes()).map_err(|err| err.to_string())?;
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
```

Add these helpers below the `impl AgentSessionStore` block:

```rust
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
```

Add this label helper for `AgentContextKind` before `AgentTranscriptKind`:

```rust
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
```

- [ ] **Step 4: Run agent store tests for GREEN**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml agent::tests -- --nocapture
```

Expected: PASS with the new agent store tests.

- [ ] **Step 5: Add Tauri command wrappers and tests**

Modify `src-tauri/src/commands.rs`:

```rust
// AppState field
agent_store: crate::agent::AgentSessionStore,

// AppState::new
let agent_store =
    crate::agent::AgentSessionStore::new(config_dir.as_ref().join("agent-sessions.json"));

// Self construction
agent_store,

pub fn list_agent_sessions(
    &self,
    workspace_root: &str,
) -> Result<Vec<crate::agent::AgentSession>, String> {
    let workspace_root = self.trusted_workspace_root(workspace_root)?;
    self.agent_store
        .list_sessions(&workspace_root.to_string_lossy())
}

pub fn start_agent_session(
    &self,
    workspace_root: &str,
    mode: crate::agent::AgentMode,
    prompt: String,
    context_items: Vec<crate::agent::AgentContextItem>,
) -> Result<crate::agent::AgentSession, String> {
    let workspace_root = self.trusted_workspace_root(workspace_root)?;
    self.agent_store.start_session(
        &workspace_root.to_string_lossy(),
        mode,
        &prompt,
        context_items,
    )
}

pub fn append_agent_transcript(
    &self,
    session_id: String,
    entry: crate::agent::AgentTranscriptInput,
) -> Result<crate::agent::AgentTranscriptEntry, String> {
    self.agent_store.append_transcript(&session_id, entry)
}

pub fn update_agent_approval(
    &self,
    session_id: String,
    approval_id: String,
    status: crate::agent::AgentApprovalStatus,
) -> Result<crate::agent::AgentSession, String> {
    self.agent_store.update_approval(&session_id, &approval_id, status)
}

pub fn export_agent_prompt(
    &self,
    session_id: String,
) -> Result<crate::agent::AgentPromptExport, String> {
    self.agent_store.export_prompt(&session_id)
}
```

Add flat Tauri commands near the other command functions:

```rust
#[tauri::command]
pub fn list_agent_sessions(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<crate::agent::AgentSession>, String> {
    state.list_agent_sessions(&workspace_root)
}
```

Repeat that wrapper shape for `start_agent_session`, `append_agent_transcript`,
`update_agent_approval`, and `export_agent_prompt`.

Add command tests mirroring existing flat-signature tests:

```rust
#[test]
fn start_agent_session_preserves_flat_command_signature() {
    type FlatStartAgentSessionCommand = fn(
        State<'_, AppState>,
        String,
        crate::agent::AgentMode,
        String,
        Vec<crate::agent::AgentContextItem>,
    ) -> Result<crate::agent::AgentSession, String>;

    fn assert_flat_signature(_command: FlatStartAgentSessionCommand) {}

    assert_flat_signature(start_agent_session);
}

#[test]
fn agent_sessions_reject_unregistered_workspaces() {
    let config = tempfile::tempdir().expect("config dir");
    let state = AppState::new(config.path()).expect("state");

    let result = state.start_agent_session(
        "/not/registered",
        crate::agent::AgentMode::Plan,
        "Plan work".to_string(),
        Vec::new(),
    );

    assert!(result.unwrap_err().contains("workspace not registered"));
}
```

- [ ] **Step 6: Register module and commands**

Modify `src-tauri/src/lib.rs`:

```rust
pub mod agent;
```

Add these command names to `tauri::generate_handler!`:

```rust
commands::list_agent_sessions,
commands::start_agent_session,
commands::append_agent_transcript,
commands::update_agent_approval,
commands::export_agent_prompt,
```

- [ ] **Step 7: Verify and commit Task 1**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml agent::tests -- --nocapture
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml start_agent_session_preserves_flat_command_signature -- --nocapture
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml agent_sessions_reject_unregistered_workspaces -- --nocapture
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected: PASS. Then commit:

```bash
git add src-tauri/src/agent.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: persist agent sessions"
```

## Task 2: Frontend Agent Model And API

**Files:**
- Create: `src/features/agents/agent-model.ts`
- Create: `src/features/agents/agent-model.test.ts`
- Create: `src/features/agents/agent-api.ts`
- Modify: `src/app/workspace-view-state.ts`
- Modify: `src/app/workspace-view-state.test.ts`

- [ ] **Step 1: Write failing frontend model tests**

Create `src/features/agents/agent-model.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  activeAgentSession,
  agentBadgeCount,
  agentContextSummary,
  approvalEntries,
  createAgentState,
  replaceAgentSessions,
  selectAgentSession,
  storeAgentSession,
  transcriptByKind,
  type AgentSession,
} from "./agent-model";

function session(id: string, mode = "plan"): AgentSession {
  return {
    id,
    workspace_root: "/repo",
    mode,
    prompt: "Plan Node 7",
    context_items: [
      {
        id: "file:src/app/AppShell.tsx",
        kind: "file",
        label: "src/app/AppShell.tsx",
        path: "src/app/AppShell.tsx",
        content: "shell",
        truncated: false,
      },
    ],
    transcript: [
      {
        id: "prompt-1",
        session_id: id,
        kind: "user_prompt",
        title: "Prompt",
        content: "Plan Node 7",
        status: null,
        approval_status: null,
        metadata: {},
        created_ms: 1,
      },
      {
        id: "approval-1",
        session_id: id,
        kind: "approval_request",
        title: "Edit src/app/AppShell.tsx",
        content: "Requires review",
        status: "pending",
        approval_status: "pending",
        metadata: { path: "src/app/AppShell.tsx" },
        created_ms: 2,
      },
    ],
    created_ms: 1,
    updated_ms: 2,
  };
}

describe("agent model", () => {
  test("stores sessions and selects the newest active session", () => {
    const state = replaceAgentSessions(createAgentState(), [
      session("old"),
      { ...session("new"), updated_ms: 5 },
    ]);

    expect(state.activeSessionId).toBe("new");
    expect(activeAgentSession(state)?.id).toBe("new");
  });

  test("stores updated sessions without reordering unrelated sessions", () => {
    const state = replaceAgentSessions(createAgentState(), [
      session("one"),
      session("two"),
    ]);
    const updated = storeAgentSession(state, {
      ...session("one"),
      prompt: "Updated",
      updated_ms: 10,
    });

    expect(updated.sessions.map((item) => item.id)).toEqual(["one", "two"]);
    expect(updated.sessions[0].prompt).toBe("Updated");
  });

  test("summarizes context and approvals", () => {
    const state = replaceAgentSessions(createAgentState(), [session("one")]);

    expect(agentContextSummary(state.sessions[0])).toBe("1 file");
    expect(approvalEntries(state.sessions[0])).toHaveLength(1);
    expect(transcriptByKind(state.sessions[0], "approval_request")).toHaveLength(1);
    expect(agentBadgeCount(state)).toBe("1");
  });

  test("ignores missing selected sessions", () => {
    const state = replaceAgentSessions(createAgentState(), [session("one")]);

    expect(selectAgentSession(state, "missing").activeSessionId).toBe("one");
  });
});
```

- [ ] **Step 2: Run model tests for RED**

Run:

```bash
bun test src/features/agents/agent-model.test.ts
```

Expected: FAIL because the agent model file does not exist.

- [ ] **Step 3: Implement `agent-model.ts`**

Create `src/features/agents/agent-model.ts`:

```ts
export type AgentMode = "plan" | "edit" | "verify" | "review" | "report";
export type AgentContextKind = "file" | "doc" | "diff" | "diagnostic" | "terminal";
export type AgentTranscriptKind =
  | "user_prompt"
  | "assistant_message"
  | "tool_call"
  | "command_output"
  | "diff"
  | "verification"
  | "approval_request"
  | "report";
export type AgentEvidenceStatus = "pending" | "passed" | "failed" | "skipped";
export type AgentApprovalStatus = "pending" | "approved" | "rejected";

export type AgentContextItem = {
  id: string;
  kind: AgentContextKind;
  label: string;
  path: string | null;
  content: string;
  truncated: boolean;
};

export type AgentTranscriptEntry = {
  id: string;
  session_id: string;
  kind: AgentTranscriptKind;
  title: string;
  content: string;
  status: AgentEvidenceStatus | null;
  approval_status: AgentApprovalStatus | null;
  metadata: Record<string, unknown>;
  created_ms: number;
};

export type AgentTranscriptInput = {
  kind: AgentTranscriptKind;
  title: string;
  content: string;
  status: AgentEvidenceStatus | null;
  metadata: Record<string, unknown>;
};

export type AgentSession = {
  id: string;
  workspace_root: string;
  mode: AgentMode;
  prompt: string;
  context_items: AgentContextItem[];
  transcript: AgentTranscriptEntry[];
  created_ms: number;
  updated_ms: number;
};

export type AgentPromptExport = {
  session_id: string;
  filename: string;
  content: string;
};

export type AgentViewState = {
  sessions: AgentSession[];
  activeSessionId: string | null;
  mode: AgentMode;
  promptDraft: string;
  selectedContextIds: Record<string, true>;
  loading: boolean;
  error: string | null;
};

export function createAgentState(): AgentViewState {
  return {
    sessions: [],
    activeSessionId: null,
    mode: "plan",
    promptDraft: "",
    selectedContextIds: {},
    loading: false,
    error: null,
  };
}

export function replaceAgentSessions(
  state: AgentViewState,
  sessions: AgentSession[],
): AgentViewState {
  const sorted = [...sessions].sort((left, right) => right.updated_ms - left.updated_ms);
  const activeSessionId =
    sorted.find((session) => session.id === state.activeSessionId)?.id ??
    sorted[0]?.id ??
    null;
  return { ...state, sessions: sorted, activeSessionId, loading: false, error: null };
}

export function storeAgentSession(
  state: AgentViewState,
  session: AgentSession,
): AgentViewState {
  const exists = state.sessions.some((item) => item.id === session.id);
  const sessions = exists
    ? state.sessions.map((item) => (item.id === session.id ? session : item))
    : [session, ...state.sessions];
  return {
    ...state,
    sessions,
    activeSessionId: session.id,
    promptDraft: "",
    selectedContextIds: {},
    loading: false,
    error: null,
  };
}

export function activeAgentSession(state: AgentViewState): AgentSession | null {
  return state.sessions.find((session) => session.id === state.activeSessionId) ?? null;
}

export function selectAgentSession(
  state: AgentViewState,
  sessionId: string,
): AgentViewState {
  return state.sessions.some((session) => session.id === sessionId)
    ? { ...state, activeSessionId: sessionId }
    : state;
}

export function setAgentPromptDraft(
  state: AgentViewState,
  promptDraft: string,
): AgentViewState {
  return { ...state, promptDraft };
}

export function setAgentMode(
  state: AgentViewState,
  mode: AgentMode,
): AgentViewState {
  return { ...state, mode };
}

export function toggleAgentContext(
  state: AgentViewState,
  contextId: string,
  selected: boolean,
): AgentViewState {
  const selectedContextIds = { ...state.selectedContextIds };
  if (selected) {
    selectedContextIds[contextId] = true;
  } else {
    delete selectedContextIds[contextId];
  }
  return { ...state, selectedContextIds };
}

export function selectedContextItems(
  state: AgentViewState,
  available: AgentContextItem[],
): AgentContextItem[] {
  return available.filter((item) => state.selectedContextIds[item.id]);
}

export function agentContextSummary(session: AgentSession): string {
  const counts = new Map<AgentContextKind, number>();
  for (const item of session.context_items) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([kind, count]) => `${count} ${kind}${count === 1 ? "" : "s"}`)
    .join(" | ");
}

export function transcriptByKind(
  session: AgentSession,
  kind: AgentTranscriptKind,
): AgentTranscriptEntry[] {
  return session.transcript.filter((entry) => entry.kind === kind);
}

export function approvalEntries(session: AgentSession): AgentTranscriptEntry[] {
  return session.transcript.filter((entry) => entry.approval_status !== null);
}

export function agentBadgeCount(state: AgentViewState): string | null {
  const pending = state.sessions.reduce(
    (count, session) =>
      count +
      approvalEntries(session).filter((entry) => entry.approval_status === "pending").length,
    0,
  );
  return pending > 0 ? String(pending) : null;
}
```

- [ ] **Step 4: Implement `agent-api.ts`**

Create `src/features/agents/agent-api.ts`:

```ts
import { call } from "../../lib/tauri";
import type {
  AgentApprovalStatus,
  AgentContextItem,
  AgentMode,
  AgentPromptExport,
  AgentSession,
  AgentTranscriptEntry,
  AgentTranscriptInput,
} from "./agent-model";

export function listAgentSessions(workspaceRoot: string): Promise<AgentSession[]> {
  return call("list_agent_sessions", { workspaceRoot });
}

export function startAgentSession(args: {
  workspaceRoot: string;
  mode: AgentMode;
  prompt: string;
  contextItems: AgentContextItem[];
}): Promise<AgentSession> {
  return call("start_agent_session", args);
}

export function appendAgentTranscript(args: {
  sessionId: string;
  entry: AgentTranscriptInput;
}): Promise<AgentTranscriptEntry> {
  return call("append_agent_transcript", args);
}

export function updateAgentApproval(args: {
  sessionId: string;
  approvalId: string;
  status: AgentApprovalStatus;
}): Promise<AgentSession> {
  return call("update_agent_approval", args);
}

export function exportAgentPrompt(sessionId: string): Promise<AgentPromptExport> {
  return call("export_agent_prompt", { sessionId });
}
```

- [ ] **Step 5: Add workspace view state support**

Modify `src/app/workspace-view-state.ts`:

```ts
import {
  createAgentState,
  type AgentViewState,
} from "../features/agents/agent-model";

export type WorkspaceViewState = {
  // existing fields
  agent: AgentViewState;
};

type WorkspaceViewStore = {
  // existing methods
  updateAgent: (
    workspaceId: string | null,
    update: (agent: AgentViewState) => AgentViewState,
  ) => void;
};

function defaultWorkspaceView(): WorkspaceViewState {
  return {
    // existing fields
    agent: createAgentState(),
  };
}
```

Extend `freezeWorkspaceView` to freeze `view.agent.sessions`,
`view.agent.selectedContextIds`, each session's `context_items`, each session's
`transcript`, and `view.agent`.

Add `updateAgent` with the same shape as `updateDocs` and `updateLanguage`.

Extend `src/app/workspace-view-state.test.ts`:

```ts
import { replaceAgentSessions } from "../features/agents/agent-model";

test("agent sessions are restored per workspace", () => {
  const store = createWorkspaceViewStore();

  store.getState().updateAgent("workspace-a", (agent) =>
    replaceAgentSessions(agent, [
      {
        id: "agent-1",
        workspace_root: "/repo-a",
        mode: "plan",
        prompt: "Plan",
        context_items: [],
        transcript: [],
        created_ms: 1,
        updated_ms: 1,
      },
    ]),
  );

  expect(store.getState().viewFor("workspace-a").agent.activeSessionId).toBe("agent-1");
  expect(store.getState().viewFor("workspace-b").agent.sessions).toEqual([]);
});
```

- [ ] **Step 6: Run frontend model tests for GREEN and commit**

Run:

```bash
bun test src/features/agents/agent-model.test.ts src/app/workspace-view-state.test.ts
```

Expected: PASS. Then commit:

```bash
git add src/features/agents/agent-model.ts src/features/agents/agent-model.test.ts src/features/agents/agent-api.ts src/app/workspace-view-state.ts src/app/workspace-view-state.test.ts
git commit -m "feat: add agent workbench state"
```

## Task 3: Agent Context Assembly Helpers

**Files:**
- Modify: `src/features/agents/agent-model.ts`
- Modify: `src/features/agents/agent-model.test.ts`

- [ ] **Step 1: Write failing tests for context items from app state**

Extend `src/features/agents/agent-model.test.ts`:

```ts
import {
  agentContextFromDiagnostic,
  agentContextFromDiff,
  agentContextFromDoc,
  agentContextFromFile,
  agentContextFromTerminal,
} from "./agent-model";

test("builds bounded agent context items from selected sources", () => {
  expect(
    agentContextFromFile({
      path: "/repo/src/app.ts",
      workspaceRoot: "/repo",
      content: "export const app = true;",
    }),
  ).toMatchObject({
    id: "file:src/app.ts",
    kind: "file",
    label: "src/app.ts",
    path: "src/app.ts",
    truncated: false,
  });

  expect(
    agentContextFromDoc({
      path: "docs/architecture/tech-stack.md",
      title: "Tech Stack",
      content: "# Tech Stack",
    }),
  ).toMatchObject({
    id: "doc:docs/architecture/tech-stack.md",
    kind: "doc",
    label: "Tech Stack",
  });

  expect(
    agentContextFromDiff({
      path: "src/app/AppShell.tsx",
      staged: false,
      raw: "diff --git a/src/app/AppShell.tsx b/src/app/AppShell.tsx",
    }),
  ).toMatchObject({
    id: "diff:unstaged:src/app/AppShell.tsx",
    kind: "diff",
  });
});

test("bounds long terminal context", () => {
  const item = agentContextFromTerminal({
    sessionId: "w:terminal-1",
    name: "zsh",
    output: "x".repeat(130_000),
  });

  expect(item.content).toHaveLength(120_000);
  expect(item.truncated).toBe(true);
});
```

- [ ] **Step 2: Run context tests for RED**

Run:

```bash
bun test src/features/agents/agent-model.test.ts
```

Expected: FAIL because context helper functions are not implemented.

- [ ] **Step 3: Implement context helper functions**

Add to `src/features/agents/agent-model.ts`:

```ts
const MAX_AGENT_CONTEXT_CHARS = 120_000;

function boundContext(content: string): { content: string; truncated: boolean } {
  if (content.length <= MAX_AGENT_CONTEXT_CHARS) {
    return { content, truncated: false };
  }
  return {
    content: content.slice(content.length - MAX_AGENT_CONTEXT_CHARS),
    truncated: true,
  };
}

function workspaceRelativePath(workspaceRoot: string, path: string): string {
  const root = workspaceRoot.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : path;
}

export function agentContextFromFile(args: {
  workspaceRoot: string;
  path: string;
  content: string;
}): AgentContextItem {
  const relativePath = workspaceRelativePath(args.workspaceRoot, args.path);
  const bounded = boundContext(args.content);
  return {
    id: `file:${relativePath}`,
    kind: "file",
    label: relativePath,
    path: relativePath,
    content: bounded.content,
    truncated: bounded.truncated,
  };
}

export function agentContextFromDoc(args: {
  path: string;
  title: string;
  content: string;
}): AgentContextItem {
  const bounded = boundContext(args.content);
  return {
    id: `doc:${args.path}`,
    kind: "doc",
    label: args.title || args.path,
    path: args.path,
    content: bounded.content,
    truncated: bounded.truncated,
  };
}

export function agentContextFromDiff(args: {
  path: string;
  staged: boolean;
  raw: string;
}): AgentContextItem {
  const bounded = boundContext(args.raw);
  const stage = args.staged ? "staged" : "unstaged";
  return {
    id: `diff:${stage}:${args.path}`,
    kind: "diff",
    label: `${stage} diff: ${args.path}`,
    path: args.path,
    content: bounded.content,
    truncated: bounded.truncated,
  };
}

export function agentContextFromDiagnostic(args: {
  path: string;
  message: string;
  severity: string;
  line: number;
}): AgentContextItem {
  const label = `${args.severity}: ${args.path}:${args.line}`;
  return {
    id: `diagnostic:${args.path}:${args.line}:${args.message}`,
    kind: "diagnostic",
    label,
    path: args.path,
    content: args.message,
    truncated: false,
  };
}

export function agentContextFromTerminal(args: {
  sessionId: string;
  name: string;
  output: string;
}): AgentContextItem {
  const bounded = boundContext(args.output);
  return {
    id: `terminal:${args.sessionId}`,
    kind: "terminal",
    label: args.name,
    path: null,
    content: bounded.content,
    truncated: bounded.truncated,
  };
}
```

- [ ] **Step 4: Run tests for GREEN and commit**

Run:

```bash
bun test src/features/agents/agent-model.test.ts
```

Expected: PASS. Then commit:

```bash
git add src/features/agents/agent-model.ts src/features/agents/agent-model.test.ts
git commit -m "feat: assemble agent context items"
```

## Task 4: Agent Panel UI

**Files:**
- Create: `src/features/agents/AgentPanel.tsx`
- Create: `src/features/agents/AgentPanel.test.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing panel tests**

Create `src/features/agents/AgentPanel.test.tsx`:

```tsx
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";

import { AgentPanel } from "./AgentPanel";
import { createAgentState, type AgentSession } from "./agent-model";

function session(): AgentSession {
  return {
    id: "agent-1",
    workspace_root: "/repo",
    mode: "plan",
    prompt: "Plan Node 7",
    context_items: [
      {
        id: "file:src/app/AppShell.tsx",
        kind: "file",
        label: "src/app/AppShell.tsx",
        path: "src/app/AppShell.tsx",
        content: "shell",
        truncated: false,
      },
    ],
    transcript: [
      {
        id: "diff-1",
        session_id: "agent-1",
        kind: "diff",
        title: "Generated diff",
        content: "diff --git a/src/app/AppShell.tsx b/src/app/AppShell.tsx",
        status: "pending",
        approval_status: null,
        metadata: {},
        created_ms: 1,
      },
      {
        id: "verify-1",
        session_id: "agent-1",
        kind: "verification",
        title: "bun test",
        content: "145 pass",
        status: "passed",
        approval_status: null,
        metadata: { command: "bun test" },
        created_ms: 2,
      },
      {
        id: "approval-1",
        session_id: "agent-1",
        kind: "approval_request",
        title: "Apply edit",
        content: "Review required",
        status: "pending",
        approval_status: "pending",
        metadata: {},
        created_ms: 3,
      },
    ],
    created_ms: 1,
    updated_ms: 3,
  };
}

describe("AgentPanel", () => {
  test("starts an agent session with prompt and selected context", () => {
    const started: string[] = [];
    const view = render(
      <AgentPanel
        state={{
          ...createAgentState(),
          promptDraft: "Plan Node 7",
          selectedContextIds: { "file:src/app/AppShell.tsx": true },
        }}
        availableContext={[
          {
            id: "file:src/app/AppShell.tsx",
            kind: "file",
            label: "src/app/AppShell.tsx",
            path: "src/app/AppShell.tsx",
            content: "shell",
            truncated: false,
          },
        ]}
        onModeChange={() => {}}
        onPromptChange={() => {}}
        onToggleContext={() => {}}
        onStartSession={(prompt) => started.push(prompt)}
        onSelectSession={() => {}}
        onApprove={() => {}}
        onReject={() => {}}
        onExport={() => {}}
      />,
    );
    fireEvent.click(view.getByText("Start session"));

    expect(started).toEqual(["Plan Node 7"]);
  });

  test("renders diffs verification commands and approvals", () => {
    const approved: string[] = [];
    const view = render(
      <AgentPanel
        state={{ ...createAgentState(), sessions: [session()], activeSessionId: "agent-1" }}
        availableContext={[]}
        onModeChange={() => {}}
        onPromptChange={() => {}}
        onToggleContext={() => {}}
        onStartSession={() => {}}
        onSelectSession={() => {}}
        onApprove={(id) => approved.push(id)}
        onReject={() => {}}
        onExport={() => {}}
      />,
    );

    expect(view.getByText("Generated diff")).toBeTruthy();
    expect(view.getByText("bun test")).toBeTruthy();
    expect(view.getByText("145 pass")).toBeTruthy();
    fireEvent.click(view.getByLabelText("Approve Apply edit"));
    expect(approved).toEqual(["approval-1"]);
  });
});
```

- [ ] **Step 2: Run panel test for RED**

Run:

```bash
bun test src/features/agents/AgentPanel.test.tsx
```

Expected: FAIL because `AgentPanel.tsx` does not exist.

- [ ] **Step 3: Implement `AgentPanel.tsx`**

Create `src/features/agents/AgentPanel.tsx` using existing panel tokens and lucide icons:

```tsx
import {
  Bot,
  Check,
  ClipboardList,
  Download,
  FileText,
  Play,
  ShieldCheck,
  X,
} from "lucide-react";

import {
  activeAgentSession,
  agentContextSummary,
  approvalEntries,
  type AgentContextItem,
  type AgentMode,
  type AgentTranscriptEntry,
  type AgentViewState,
} from "./agent-model";

type AgentPanelProps = {
  state: AgentViewState;
  availableContext: AgentContextItem[];
  onModeChange: (mode: AgentMode) => void;
  onPromptChange: (prompt: string) => void;
  onToggleContext: (id: string, selected: boolean) => void;
  onStartSession: (prompt: string) => void;
  onSelectSession: (sessionId: string) => void;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
  onExport: () => void;
};

const modes: AgentMode[] = ["plan", "edit", "verify", "review", "report"];

function ContextRow({
  item,
  selected,
  onToggle,
}: {
  item: AgentContextItem;
  selected: boolean;
  onToggle: (selected: boolean) => void;
}) {
  return (
    <label className="agent-context-row">
      <input
        type="checkbox"
        checked={selected}
        onChange={(event) => onToggle(event.currentTarget.checked)}
      />
      <FileText aria-hidden="true" />
      <span className="agent-context-main">
        <span>{item.label}</span>
        <span className="mono">{item.kind}{item.truncated ? " | truncated" : ""}</span>
      </span>
    </label>
  );
}

function TranscriptRow({
  entry,
  onApprove,
  onReject,
}: {
  entry: AgentTranscriptEntry;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const isApproval = entry.approval_status !== null;
  return (
    <div className={`agent-transcript-row ${entry.kind}`}>
      <div className="agent-transcript-head">
        <span>{entry.title}</span>
        {entry.status ? <span className={`badge2 agent-status ${entry.status}`}>{entry.status}</span> : null}
      </div>
      <pre className="agent-transcript-content">{entry.content}</pre>
      {isApproval ? (
        <div className="agent-approval-actions">
          <button
            type="button"
            className="btn sm primary"
            aria-label={`Approve ${entry.title}`}
            onClick={() => onApprove(entry.id)}
            disabled={entry.approval_status !== "pending"}
          >
            <Check aria-hidden="true" /> Approve
          </button>
          <button
            type="button"
            className="btn sm ghost"
            aria-label={`Reject ${entry.title}`}
            onClick={() => onReject(entry.id)}
            disabled={entry.approval_status !== "pending"}
          >
            <X aria-hidden="true" /> Reject
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AgentPanel({
  state,
  availableContext,
  onModeChange,
  onPromptChange,
  onToggleContext,
  onStartSession,
  onSelectSession,
  onApprove,
  onReject,
  onExport,
}: AgentPanelProps) {
  const activeSession = activeAgentSession(state);
  const pendingApprovals = activeSession ? approvalEntries(activeSession) : [];

  return (
    <div className="panel-body agent-panel">
      <div className="agent-composer">
        <div className="agent-modes" aria-label="Agent mode">
          {modes.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`btn sm ${state.mode === mode ? "primary" : "ghost"}`}
              onClick={() => onModeChange(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        <textarea
          aria-label="Agent prompt"
          className="input2 agent-prompt"
          value={state.promptDraft}
          onChange={(event) => onPromptChange(event.currentTarget.value)}
        />
        <button
          type="button"
          className="btn primary agent-start"
          onClick={() => onStartSession(state.promptDraft)}
          disabled={!state.promptDraft.trim()}
        >
          <Play aria-hidden="true" /> Start session
        </button>
      </div>

      <div className="section-label">
        <span>Context</span>
        <span className="meta">{availableContext.length}</span>
      </div>
      <div className="agent-context-list">
        {availableContext.map((item) => (
          <ContextRow
            key={item.id}
            item={item}
            selected={state.selectedContextIds[item.id] === true}
            onToggle={(selected) => onToggleContext(item.id, selected)}
          />
        ))}
      </div>

      <div className="section-label">
        <span>Sessions</span>
        <span className="meta">{state.sessions.length}</span>
      </div>
      {state.sessions.map((session) => (
        <button
          type="button"
          key={session.id}
          className={`agent-session-row${state.activeSessionId === session.id ? " active" : ""}`}
          onClick={() => onSelectSession(session.id)}
        >
          <Bot aria-hidden="true" />
          <span>
            <strong>{session.mode}</strong>
            <span className="mono">{agentContextSummary(session)}</span>
          </span>
        </button>
      ))}

      {activeSession ? (
        <div className="agent-session-detail">
          <div className="agent-session-toolbar">
            <span className="badge2">
              <ShieldCheck aria-hidden="true" /> {pendingApprovals.length} approvals
            </span>
            <button type="button" className="iconbtn" title="Export prompt" onClick={onExport}>
              <Download aria-hidden="true" />
            </button>
          </div>
          {activeSession.transcript.map((entry) => (
            <TranscriptRow
              key={entry.id}
              entry={entry}
              onApprove={onApprove}
              onReject={onReject}
            />
          ))}
        </div>
      ) : (
        <div className="panel-empty">
          <ClipboardList aria-hidden="true" />
          <span>No agent sessions</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add CSS from design tokens**

Modify `src/index.css` with compact styles:

```css
.agent-panel {
  display: flex;
  flex-direction: column;
}

.agent-composer {
  padding: 10px;
  border-bottom: 1px solid var(--line);
}

.agent-modes {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
  margin-bottom: 8px;
}

.agent-prompt {
  min-height: 88px;
  resize: vertical;
  font-family: var(--font-sans);
}

.agent-start {
  width: 100%;
  justify-content: center;
  margin-top: 8px;
}

.agent-context-list {
  padding: 4px 8px 8px;
  display: grid;
  gap: 4px;
}

.agent-context-row,
.agent-session-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--txt);
  text-align: left;
  border-radius: var(--radius-sm);
}

.agent-session-row.active,
.agent-context-row:hover,
.agent-session-row:hover {
  background: var(--hover);
}

.agent-context-row svg,
.agent-session-row svg {
  width: 15px;
  height: 15px;
  color: var(--txt-dim);
}

.agent-context-main,
.agent-session-row span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.agent-context-main .mono,
.agent-session-row .mono {
  color: var(--txt-faint);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-session-detail {
  border-top: 1px solid var(--line);
  padding: 8px;
  display: grid;
  gap: 8px;
}

.agent-session-toolbar,
.agent-approval-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-session-toolbar {
  justify-content: space-between;
}

.agent-transcript-row {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--editor);
  overflow: hidden;
}

.agent-transcript-head {
  min-height: 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px;
  border-bottom: 1px solid var(--line);
  font-weight: 600;
}

.agent-transcript-content {
  margin: 0;
  padding: 8px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--txt-dim);
  font-family: var(--font-mono);
  font-size: 11.5px;
}
```

- [ ] **Step 5: Run panel tests for GREEN and commit**

Run:

```bash
bun test src/features/agents/AgentPanel.test.tsx src/features/agents/agent-model.test.ts
```

Expected: PASS. Then commit:

```bash
git add src/features/agents/AgentPanel.tsx src/features/agents/AgentPanel.test.tsx src/index.css
git commit -m "feat: add agent workbench panel"
```

## Task 5: App Shell Integration

**Files:**
- Modify: `src/app/activity-rail.tsx`
- Modify: `src/app/command-palette-model.ts`
- Modify: `src/app/command-palette-model.test.ts`
- Modify: `src/app/AppShell.tsx`

- [ ] **Step 1: Write failing command and rail tests**

Extend `src/app/command-palette-model.test.ts`:

```ts
test("includes agent workbench commands", () => {
  expect(allCommands).toContainEqual({
    id: "open-agents",
    label: "Agents: Open workbench",
    group: "Agents",
  });
  expect(allCommands).toContainEqual({
    id: "agent-start-session",
    label: "Agents: Start session",
    group: "Agents",
  });
  expect(filterCommands(allCommands, "agent")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "open-agents" }),
      expect.objectContaining({ id: "agent-export-prompt" }),
    ]),
  );
});
```

Extend `src/app/workspace-view-state.test.ts` if Task 2 did not already add the
agent view-state test.

- [ ] **Step 2: Run command tests for RED**

Run:

```bash
bun test src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts
```

Expected: FAIL because agent commands and activity ID are not wired.

- [ ] **Step 3: Add rail item and commands**

Modify `src/app/activity-rail.tsx`:

```ts
import { Bot, /* existing icons */ } from "lucide-react";

export type ActivityId =
  | "explorer"
  | "search"
  | "git"
  | "terminal"
  | "tasks"
  | "docs"
  | "language"
  | "agents"
  | "database"
  | "settings";

const activities: ActivityItem[] = [
  // existing entries
  { id: "agents", label: "Agents", icon: Bot },
  { id: "database", label: "Database", icon: Database },
  { id: "settings", label: "Settings", icon: Settings },
];
```

Modify `src/app/command-palette-model.ts`:

```ts
export const node7Commands: CommandItem[] = [
  { id: "open-agents", label: "Agents: Open workbench", group: "Agents" },
  { id: "agent-start-session", label: "Agents: Start session", group: "Agents" },
  { id: "agent-export-prompt", label: "Agents: Export prompt", group: "Agents" },
];

export const allCommands: CommandItem[] = [
  ...node1Commands,
  ...node5Commands,
  ...node6Commands,
  ...node7Commands,
];
```

- [ ] **Step 4: Wire `AppShell.tsx`**

Modify imports:

```ts
import {
  exportAgentPrompt,
  listAgentSessions,
  startAgentSession,
  updateAgentApproval,
} from "../features/agents/agent-api";
import { AgentPanel } from "../features/agents/AgentPanel";
import {
  agentBadgeCount,
  agentContextFromDiagnostic,
  agentContextFromDiff,
  agentContextFromDoc,
  agentContextFromFile,
  agentContextFromTerminal,
  replaceAgentSessions,
  selectedContextItems,
  setAgentMode,
  setAgentPromptDraft,
  storeAgentSession,
  toggleAgentContext,
  type AgentContextItem,
} from "../features/agents/agent-model";
```

Add `agents: "Agents"` to `panelTitles`.

Add `const updateAgent = useWorkspaceViewStore((state) => state.updateAgent);`.

Build `availableAgentContext` from existing bounded state:

```ts
const availableAgentContext = useMemo<AgentContextItem[]>(() => {
  const items: AgentContextItem[] = [];
  if (activeWorkspace && loadedFile) {
    items.push(
      agentContextFromFile({
        workspaceRoot: activeWorkspace.path,
        path: loadedFile.path,
        content: loadedFile.content,
      }),
    );
  }
  for (const preview of Object.values(view.docs.previewByPath)) {
    items.push(
      agentContextFromDoc({
        path: preview.path,
        title: preview.title,
        content: preview.content,
      }),
    );
  }
  if (selectedGitDiff) {
    items.push(
      agentContextFromDiff({
        path: selectedGitDiff.path,
        staged: selectedGitDiff.staged,
        raw: selectedGitDiff.raw,
      }),
    );
  }
  for (const diagnostic of activeFileDiagnostics) {
    items.push(
      agentContextFromDiagnostic({
        path: diagnostic.path,
        message: diagnostic.message,
        severity: diagnostic.severity,
        line: diagnostic.range.start_line + 1,
      }),
    );
  }
  if (activeTerminal && activeTerminalOutput) {
    items.push(
      agentContextFromTerminal({
        sessionId: activeTerminal.id,
        name: activeTerminal.name,
        output: activeTerminalOutput,
      }),
    );
  }
  return items;
}, [activeWorkspace, loadedFile, view.docs.previewByPath, selectedGitDiff, activeFileDiagnostics, activeTerminal, activeTerminalOutput]);
```

Load sessions when the active workspace changes:

```ts
useEffect(() => {
  if (!activeWorkspace) {
    return;
  }
  listAgentSessions(activeWorkspace.path)
    .then((sessions) => {
      updateAgent(activeWorkspace.id, (agent) => replaceAgentSessions(agent, sessions));
    })
    .catch((error) => {
      updateAgent(activeWorkspace.id, (agent) => ({
        ...agent,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
}, [activeWorkspace, updateAgent]);
```

Add handlers:

```ts
async function startAgentWorkbenchSession(prompt: string) {
  if (!activeWorkspace) return;
  const contextItems = selectedContextItems(view.agent, availableAgentContext);
  const session = await startAgentSession({
    workspaceRoot: activeWorkspace.path,
    mode: view.agent.mode,
    prompt,
    contextItems,
  });
  updateAgent(activeWorkspace.id, (agent) => storeAgentSession(agent, session));
  for (const pack of view.docs.contextPacks) {
    if (contextItems.some((item) => item.kind === "doc" && pack.doc_paths.includes(item.path ?? ""))) {
      await linkContextPack({ id: pack.id, agentSessionId: session.id });
    }
  }
}

async function setAgentApproval(approvalId: string, status: "approved" | "rejected") {
  const session = view.agent.sessions.find((item) => item.id === view.agent.activeSessionId);
  if (!session || !activeWorkspace) return;
  const updated = await updateAgentApproval({
    sessionId: session.id,
    approvalId,
    status,
  });
  updateAgent(activeWorkspace.id, (agent) => storeAgentSession(agent, updated));
}

async function exportActiveAgentPrompt() {
  const session = view.agent.sessions.find((item) => item.id === view.agent.activeSessionId);
  if (!session) return;
  const exported = await exportAgentPrompt(session.id);
  const blob = new Blob([exported.content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = exported.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
```

Render `AgentPanel` in `PanelBody` when `active === "agents"`, pass
`availableAgentContext`, and wire `onApprove`/`onReject` to `setAgentApproval`.

Add agent badge to `ActivityRail`:

```tsx
badges={{
  docs: docsBadgeCount(view.docs),
  git: changeBadgeCount(view.git.status),
  language: languageDiagnosticBadge,
  agents: agentBadgeCount(view.agent),
}}
```

- [ ] **Step 5: Run integration tests and commit**

Run:

```bash
bun test src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts src/features/agents/agent-model.test.ts src/features/agents/AgentPanel.test.tsx
```

Expected: PASS. Then commit:

```bash
git add src/app/activity-rail.tsx src/app/command-palette-model.ts src/app/command-palette-model.test.ts src/app/workspace-view-state.ts src/app/workspace-view-state.test.ts src/app/AppShell.tsx
git commit -m "feat: wire agent workbench"
```

## Task 6: Transcript Evidence And Approval Controls

**Files:**
- Modify: `src/features/agents/AgentPanel.tsx`
- Modify: `src/features/agents/AgentPanel.test.tsx`
- Modify: `src/features/agents/agent-model.ts`
- Modify: `src/features/agents/agent-model.test.ts`

- [ ] **Step 1: Write failing tests for transcript evidence grouping**

Extend `src/features/agents/agent-model.test.ts`:

```ts
import { verificationSummary } from "./agent-model";

test("summarizes verification evidence", () => {
  const state = replaceAgentSessions(createAgentState(), [session("agent-1")]);
  const active = activeAgentSession(state)!;

  expect(verificationSummary(active)).toBe("0 passed | 0 failed");

  const withVerification = {
    ...active,
    transcript: [
      ...active.transcript,
      {
        id: "verify-1",
        session_id: active.id,
        kind: "verification" as const,
        title: "bun test",
        content: "145 pass",
        status: "passed" as const,
        approval_status: null,
        metadata: { command: "bun test" },
        created_ms: 3,
      },
    ],
  };

  expect(verificationSummary(withVerification)).toBe("1 passed | 0 failed");
});
```

- [ ] **Step 2: Run tests for RED**

Run:

```bash
bun test src/features/agents/agent-model.test.ts src/features/agents/AgentPanel.test.tsx
```

Expected: FAIL because `verificationSummary` and the final UI labels are not complete.

- [ ] **Step 3: Add evidence summary and UI badges**

Add to `agent-model.ts`:

```ts
export function verificationSummary(session: AgentSession): string {
  const verifications = transcriptByKind(session, "verification");
  const passed = verifications.filter((entry) => entry.status === "passed").length;
  const failed = verifications.filter((entry) => entry.status === "failed").length;
  return `${passed} passed | ${failed} failed`;
}
```

Update `AgentPanel.tsx` session detail toolbar to show `verificationSummary(activeSession)`.
Keep diff and command-output transcript content in `pre` blocks and do not place
large content inside card-in-card layouts.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
bun test src/features/agents/agent-model.test.ts src/features/agents/AgentPanel.test.tsx
```

Expected: PASS. Then commit:

```bash
git add src/features/agents/agent-model.ts src/features/agents/agent-model.test.ts src/features/agents/AgentPanel.tsx src/features/agents/AgentPanel.test.tsx
git commit -m "feat: show agent transcript evidence"
```

## Task 7: Verification, Results, And Roadmap Update

**Files:**
- Create: `docs/architecture/node-7-agent-results.md`
- Modify: `docs/architecture/progress.md`
- Modify: `roadmap.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
. "$HOME/.cargo/env" && bun run tauri build --debug
git diff --check
```

Expected: every command exits 0. Vite chunk-size warnings remain acceptable if
the build exits 0.

- [ ] **Step 2: Write results document**

Create `docs/architecture/node-7-agent-results.md` with sections:

```markdown
# Node 7 Agent Results

## Scope

- Rust-owned agent session persistence, bounded context snapshots, transcript
  entries, approval state, and prompt export.
- React Agent panel with prompt composer, mode controls, context selection,
  session list, transcript evidence, approval controls, and export action.
- Context selection from files, docs, diffs, diagnostics, and terminal output.

## Verification

| Command | Result |
| --- | --- |
| `bun test` | PASS with measured Bun test count |
| `bun run build` | PASS: Vite chunk-size warning only if present |
| `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml` | PASS with measured Cargo test count |
| `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check` | PASS |
| `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | PASS |
| `. "$HOME/.cargo/env" && bun run tauri build --debug` | PASS |
| `git diff --check` | PASS |

## TDD And Review Evidence

- Summarize each task's RED/GREEN/refactor evidence with exact failing and
  passing commands.
- Summarize spec-compliance and code-quality reviewer outcomes.

## Residual Risks

- Node 7 records structured sessions and gates approvals; it does not execute
  fully autonomous edits.
- Export is local browser download behavior; native save dialog integration can
  be added in a later node.

## Result

Node 7 is complete and passed.
```

Replace the measured-count wording with exact command output before review.

- [ ] **Step 3: Update progress and roadmap**

Append Node 7 to `docs/architecture/progress.md` after Node 6. Include:

- completed task list;
- important files and commit milestones;
- verification evidence;
- residual risks;
- next decision: Node 8 browser preview and local dev loop.

Update `roadmap.md` current priority:

```markdown
Node 0, Node 1, Node 2, Node 3, Node 4, Node 5, Node 6, and Node 7 are complete.
The next active priority is Node 8: support frontend and full-stack development
loops beside code.
```

Add a Node 7 verification bullet below the current priority list.

- [ ] **Step 4: Run docs gate**

Run:

```bash
test -f docs/architecture/node-7-agent-results.md
rg -n 'T[B]D|T[O]DO|F[I]XME|place[ ]holder|fill with actual[ ]count|0 tests|0 pass' docs/architecture/node-7-agent-results.md docs/architecture/progress.md roadmap.md
git diff --check
```

Expected: the `test -f` command passes, `rg` finds no matches, and
`git diff --check` passes.

- [ ] **Step 5: Review and commit docs**

Dispatch spec-compliance and code-quality reviewers for the Node 7 docs. After
approval, commit:

```bash
git add docs/architecture/node-7-agent-results.md docs/architecture/progress.md roadmap.md
git commit -m "docs: record node 7 agent results"
```

## Final Verification Checklist

- `bun test`
- `bun run build`
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml`
- `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- `. "$HOME/.cargo/env" && bun run tauri build --debug`
- `git diff --check`

## Self-Review

- Node 7 acceptance coverage:
  - Start an agent session from a workspace with selected docs/files: Tasks 1,
    2, 3, 4, and 5.
  - Records context used: Tasks 1 and 3.
  - Shows generated diffs and verification commands clearly: Tasks 4 and 6.
  - Exports a reproducible prompt or plan: Tasks 1 and 5.
- Source-of-truth UI coverage:
  - Agent panel uses `panel-body`, compact rows, `badge2`, `btn`, `input2`,
    `iconbtn`, and dense operational layout from `docs/ui-design/`.
- Non-goal coverage:
  - No fully autonomous edit execution is introduced.
  - No cloud sync is introduced.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-09-node-7-agent-workbench.md`.

Use `superpowers:subagent-driven-development` and dispatch a fresh implementer
for each task, followed by spec-compliance and code-quality reviewers before
marking the task complete.
