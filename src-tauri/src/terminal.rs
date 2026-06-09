use portable_pty::{ChildKiller, CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct TerminalSessionInfo {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub cwd: PathBuf,
    pub shell: String,
    pub running: bool,
}

#[derive(Default)]
pub struct TerminalRegistry {
    next_by_workspace: HashMap<String, usize>,
    metadata: HashMap<String, TerminalSessionInfo>,
}

impl TerminalRegistry {
    pub fn reserve_metadata(
        &mut self,
        workspace_id: String,
        cwd: PathBuf,
        name: Option<String>,
    ) -> TerminalSessionInfo {
        let next = self
            .next_by_workspace
            .entry(workspace_id.clone())
            .or_insert(1);
        let id = format!("{workspace_id}:terminal-{next}");
        let session_name = name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("zsh {next}"));
        *next += 1;

        let info = TerminalSessionInfo {
            id: id.clone(),
            workspace_id,
            name: session_name,
            cwd,
            shell: crate::pty::default_shell(),
            running: true,
        };
        self.metadata.insert(id, info.clone());
        info
    }

    pub fn list_metadata(&self, workspace_id: &str) -> Vec<TerminalSessionInfo> {
        let mut sessions = self
            .metadata
            .values()
            .filter(|session| session.workspace_id == workspace_id)
            .cloned()
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| left.id.cmp(&right.id));
        sessions
    }

    pub fn remove_metadata(&mut self, id: &str) -> Option<TerminalSessionInfo> {
        self.metadata.remove(id)
    }
}

pub fn terminal_size(rows: u16, cols: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub chunk: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct TerminalExitEvent {
    pub session_id: String,
    pub exit_code: Option<i32>,
}

struct TerminalProcess {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    _waiter: thread::JoinHandle<()>,
}

pub struct TerminalState {
    registry: Mutex<TerminalRegistry>,
    processes: Mutex<HashMap<String, TerminalProcess>>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            registry: Mutex::new(TerminalRegistry::default()),
            processes: Mutex::new(HashMap::new()),
        }
    }

    pub fn list_sessions(&self, workspace_id: &str) -> Result<Vec<TerminalSessionInfo>, String> {
        self.registry
            .lock()
            .map_err(|err| err.to_string())
            .map(|registry| registry.list_metadata(workspace_id))
    }

    #[cfg(test)]
    pub fn register_test_session(
        &self,
        workspace_id: String,
        cwd: PathBuf,
        name: Option<String>,
    ) -> Result<TerminalSessionInfo, String> {
        let mut registry = self.registry.lock().map_err(|err| err.to_string())?;
        Ok(registry.reserve_metadata(workspace_id, cwd, name))
    }

    pub fn spawn_session(
        &self,
        app: AppHandle,
        workspace_id: String,
        cwd: PathBuf,
        name: Option<String>,
        rows: u16,
        cols: u16,
    ) -> Result<TerminalSessionInfo, String> {
        let cwd = cwd.canonicalize().map_err(|err| err.to_string())?;
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(terminal_size(rows, cols))
            .map_err(|err| err.to_string())?;

        let info = {
            let mut registry = self.registry.lock().map_err(|err| err.to_string())?;
            registry.reserve_metadata(workspace_id, cwd.clone(), name)
        };

        let mut command = CommandBuilder::new(&info.shell);
        command.cwd(&cwd);

        let mut child = match pair.slave.spawn_command(command) {
            Ok(child) => child,
            Err(err) => {
                let _ = self
                    .registry
                    .lock()
                    .map_err(|lock_err| lock_err.to_string())?
                    .remove_metadata(&info.id);
                return Err(err.to_string());
            }
        };
        let mut reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(err) => {
                let _ = child.kill();
                let _ = self
                    .registry
                    .lock()
                    .map(|mut registry| registry.remove_metadata(&info.id));
                return Err(err.to_string());
            }
        };
        let writer = Arc::new(Mutex::new(match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(err) => {
                let _ = child.kill();
                let _ = self
                    .registry
                    .lock()
                    .map(|mut registry| registry.remove_metadata(&info.id));
                return Err(err.to_string());
            }
        }));
        let killer = Arc::new(Mutex::new(child.clone_killer()));

        let output_session_id = info.id.clone();
        let output_app = app.clone();
        thread::spawn(move || {
            let mut buffer = [0_u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        let chunk = String::from_utf8_lossy(&buffer[..read]).into_owned();
                        let _ = output_app.emit(
                            "workspace://terminal-output",
                            TerminalOutputEvent {
                                session_id: output_session_id.clone(),
                                chunk,
                            },
                        );
                    }
                }
            }
        });

        let exit_session_id = info.id.clone();
        let waiter = thread::spawn(move || {
            let exit_code = child
                .wait()
                .ok()
                .and_then(|status| i32::try_from(status.exit_code()).ok());
            let _ = app.emit(
                "workspace://terminal-exit",
                TerminalExitEvent {
                    session_id: exit_session_id,
                    exit_code,
                },
            );
        });

        self.processes
            .lock()
            .map_err(|err| err.to_string())?
            .insert(
                info.id.clone(),
                TerminalProcess {
                    writer,
                    killer,
                    _waiter: waiter,
                },
            );

        Ok(info)
    }

    pub fn write_session(&self, session_id: &str, data: &str) -> Result<(), String> {
        let processes = self.processes.lock().map_err(|err| err.to_string())?;
        let process = processes
            .get(session_id)
            .ok_or_else(|| format!("missing terminal session: {session_id}"))?;
        let mut writer = process.writer.lock().map_err(|err| err.to_string())?;
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|err| err.to_string())
    }

    pub fn close_session(&self, session_id: &str) -> Result<TerminalSessionInfo, String> {
        if let Some(process) = self
            .processes
            .lock()
            .map_err(|err| err.to_string())?
            .remove(session_id)
        {
            let _ = process.killer.lock().map_err(|err| err.to_string())?.kill();
        }

        self.registry
            .lock()
            .map_err(|err| err.to_string())?
            .remove_metadata(session_id)
            .ok_or_else(|| format!("missing terminal session: {session_id}"))
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    #[test]
    fn terminal_ids_are_workspace_scoped_and_incrementing() {
        let mut registry = super::TerminalRegistry::default();

        let first =
            registry.reserve_metadata("workspace-a".to_string(), PathBuf::from("/repo-a"), None);
        let second = registry.reserve_metadata(
            "workspace-a".to_string(),
            PathBuf::from("/repo-a"),
            Some("server".to_string()),
        );
        let third =
            registry.reserve_metadata("workspace-b".to_string(), PathBuf::from("/repo-b"), None);

        assert_eq!(first.id, "workspace-a:terminal-1");
        assert_eq!(first.name, "zsh 1");
        assert_eq!(second.id, "workspace-a:terminal-2");
        assert_eq!(second.name, "server");
        assert_eq!(third.id, "workspace-b:terminal-1");
        assert_eq!(third.name, "zsh 1");
    }

    #[test]
    fn closing_terminal_removes_only_matching_workspace_session() {
        let mut registry = super::TerminalRegistry::default();
        let first =
            registry.reserve_metadata("workspace-a".to_string(), PathBuf::from("/repo-a"), None);
        let second =
            registry.reserve_metadata("workspace-b".to_string(), PathBuf::from("/repo-b"), None);

        assert!(registry.remove_metadata(&first.id).is_some());

        let remaining = registry.list_metadata("workspace-b");
        assert_eq!(remaining, vec![second]);
        assert!(registry.list_metadata("workspace-a").is_empty());
    }

    #[test]
    fn resize_dimensions_are_clamped_to_pty_safe_minimums() {
        let size = super::terminal_size(0, 0);

        assert_eq!(size.rows, 1);
        assert_eq!(size.cols, 1);
    }

    #[test]
    fn manager_lists_and_closes_workspace_sessions() {
        let manager = super::TerminalState::new();
        let first = manager
            .register_test_session(
                "workspace-a".to_string(),
                PathBuf::from("/repo-a"),
                Some("api".to_string()),
            )
            .expect("first");
        let _second = manager
            .register_test_session("workspace-b".to_string(), PathBuf::from("/repo-b"), None)
            .expect("second");

        assert_eq!(
            manager.list_sessions("workspace-a").expect("list"),
            vec![first.clone()]
        );
        assert_eq!(manager.close_session(&first.id).expect("close"), first);
        assert!(manager
            .list_sessions("workspace-a")
            .expect("list")
            .is_empty());
    }
}
