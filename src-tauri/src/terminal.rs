use portable_pty::{
    Child, ChildKiller, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

const OUTPUT_COALESCE_WINDOW: Duration = Duration::from_millis(10);
const MAX_COALESCED_CHUNK_BYTES: usize = 64 * 1024;

fn apply_terminal_session_env(command: &mut CommandBuilder) {
    #[cfg(not(windows))]
    command.arg("-l");
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "yuuzu-ide");
    if command.get_env("LANG").is_none_or(|value| value.is_empty()) {
        command.env("LANG", "en_US.UTF-8");
    }
}

fn next_coalesced_chunk(
    receiver: &mpsc::Receiver<String>,
    window: Duration,
    max_chunk_bytes: usize,
) -> Option<String> {
    let mut combined = receiver.recv().ok()?;
    let deadline = Instant::now() + window;

    while combined.len() < max_chunk_bytes {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match receiver.recv_timeout(remaining) {
            Ok(chunk) => combined.push_str(&chunk),
            Err(_) => break,
        }
    }

    Some(combined)
}

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

    pub fn mark_stopped(&mut self, id: &str) -> Option<TerminalSessionInfo> {
        let session = self.metadata.get_mut(id)?;
        session.running = false;
        Some(session.clone())
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
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
}

pub struct TerminalState {
    registry: Arc<Mutex<TerminalRegistry>>,
    processes: Arc<Mutex<HashMap<String, TerminalProcess>>>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            registry: Arc::new(Mutex::new(TerminalRegistry::default())),
            processes: Arc::new(Mutex::new(HashMap::new())),
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

    #[cfg(test)]
    fn mark_session_exited(&self, session_id: &str) -> Result<Option<TerminalSessionInfo>, String> {
        mark_session_exited_in_state(&self.registry, &self.processes, session_id)
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
        let cwd = normalize_session_cwd(&cwd)?;
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(terminal_size(rows, cols))
            .map_err(|err| err.to_string())?;

        let info = {
            let mut registry = self.registry.lock().map_err(|err| err.to_string())?;
            registry.reserve_metadata(workspace_id, cwd.clone(), name)
        };

        let mut command = CommandBuilder::new(&info.shell);
        apply_terminal_session_env(&mut command);
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
                kill_and_wait(&mut *child);
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
                kill_and_wait(&mut *child);
                let _ = self
                    .registry
                    .lock()
                    .map(|mut registry| registry.remove_metadata(&info.id));
                return Err(err.to_string());
            }
        }));
        let killer = Arc::new(Mutex::new(child.clone_killer()));

        let (chunk_tx, chunk_rx) = mpsc::channel::<String>();
        thread::spawn(move || {
            let mut buffer = [0_u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        let chunk = String::from_utf8_lossy(&buffer[..read]).into_owned();
                        if chunk_tx.send(chunk).is_err() {
                            break;
                        }
                    }
                }
            }
        });

        let output_session_id = info.id.clone();
        let output_app = app.clone();
        thread::spawn(move || {
            while let Some(chunk) =
                next_coalesced_chunk(&chunk_rx, OUTPUT_COALESCE_WINDOW, MAX_COALESCED_CHUNK_BYTES)
            {
                let _ = output_app.emit(
                    "workspace://terminal-output",
                    TerminalOutputEvent {
                        session_id: output_session_id.clone(),
                        chunk,
                    },
                );
            }
        });

        let master = Arc::new(Mutex::new(pair.master));
        if let Err(err) = self.processes.lock().map(|mut processes| {
            processes.insert(
                info.id.clone(),
                TerminalProcess {
                    writer,
                    killer,
                    master,
                },
            );
        }) {
            kill_and_wait(&mut *child);
            let _ = self
                .registry
                .lock()
                .map(|mut registry| registry.remove_metadata(&info.id));
            return Err(err.to_string());
        }

        let exit_session_id = info.id.clone();
        let exit_registry = Arc::clone(&self.registry);
        let exit_processes = Arc::clone(&self.processes);
        thread::spawn(move || {
            let exit_code = child
                .wait()
                .ok()
                .and_then(|status| i32::try_from(status.exit_code()).ok());
            let _ = mark_session_exited_in_state(&exit_registry, &exit_processes, &exit_session_id);
            let _ = app.emit(
                "workspace://terminal-exit",
                TerminalExitEvent {
                    session_id: exit_session_id,
                    exit_code,
                },
            );
        });

        Ok(info)
    }

    pub fn resize_session(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let master = {
            let processes = self.processes.lock().map_err(|err| err.to_string())?;
            Arc::clone(
                &processes
                    .get(session_id)
                    .ok_or_else(|| format!("missing terminal session: {session_id}"))?
                    .master,
            )
        };
        let master = master.lock().map_err(|err| err.to_string())?;
        master
            .resize(terminal_size(rows, cols))
            .map_err(|err| err.to_string())
    }

    pub fn write_session(&self, session_id: &str, data: &str) -> Result<(), String> {
        let writer = {
            let processes = self.processes.lock().map_err(|err| err.to_string())?;
            Arc::clone(
                &processes
                    .get(session_id)
                    .ok_or_else(|| format!("missing terminal session: {session_id}"))?
                    .writer,
            )
        };
        let mut writer = writer.lock().map_err(|err| err.to_string())?;
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

fn mark_session_exited_in_state(
    registry: &Mutex<TerminalRegistry>,
    processes: &Mutex<HashMap<String, TerminalProcess>>,
    session_id: &str,
) -> Result<Option<TerminalSessionInfo>, String> {
    processes
        .lock()
        .map_err(|err| err.to_string())?
        .remove(session_id);

    Ok(registry
        .lock()
        .map_err(|err| err.to_string())?
        .mark_stopped(session_id))
}

fn kill_and_wait(child: &mut dyn Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Canonicalizes a terminal session's working directory without the Windows
/// `\\?\` verbatim prefix that `std::fs::canonicalize` emits. `CreateProcessW`'s
/// `lpCurrentDirectory` does not honor verbatim paths, so a verbatim cwd silently
/// drops the shell into the system default directory (e.g. `C:\Windows`) instead
/// of the workspace. `dunce::canonicalize` matches std on non-Windows platforms.
fn normalize_session_cwd(cwd: &Path) -> Result<PathBuf, String> {
    dunce::canonicalize(cwd).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use portable_pty::{Child, ChildKiller, ExitStatus, PtySystem};
    use std::{
        io::{self, Write},
        path::PathBuf,
        sync::{mpsc, Arc, Mutex},
        thread,
        time::Duration,
    };
    use tempfile::tempdir;

    #[derive(Debug)]
    struct NoopKiller;

    impl ChildKiller for NoopKiller {
        fn kill(&mut self) -> io::Result<()> {
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(Self)
        }
    }

    struct BlockingWriter {
        entered: Option<mpsc::Sender<()>>,
        release: mpsc::Receiver<()>,
    }

    impl Write for BlockingWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            if let Some(entered) = self.entered.take() {
                let _ = entered.send(());
            }
            let _ = self.release.recv_timeout(Duration::from_secs(5));

            Ok(buffer.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[derive(Clone, Debug)]
    struct EventChild {
        events: Arc<Mutex<Vec<&'static str>>>,
    }

    impl ChildKiller for EventChild {
        fn kill(&mut self) -> io::Result<()> {
            self.events.lock().expect("events").push("kill");
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(self.clone())
        }
    }

    impl Child for EventChild {
        fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
            Ok(None)
        }

        fn wait(&mut self) -> io::Result<ExitStatus> {
            self.events.lock().expect("events").push("wait");
            Ok(ExitStatus::with_exit_code(0))
        }

        fn process_id(&self) -> Option<u32> {
            None
        }
    }

    fn insert_test_process(
        manager: &super::TerminalState,
        session_id: &str,
        writer: Box<dyn Write + Send>,
    ) {
        let pair = portable_pty::NativePtySystem::default()
            .openpty(super::terminal_size(24, 80))
            .expect("openpty");
        manager.processes.lock().expect("processes").insert(
            session_id.to_string(),
            super::TerminalProcess {
                writer: Arc::new(Mutex::new(writer)),
                killer: Arc::new(Mutex::new(Box::new(NoopKiller))),
                master: Arc::new(Mutex::new(pair.master)),
            },
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn shell_command_starts_a_login_shell_with_terminal_env() {
        let mut command = portable_pty::CommandBuilder::new("/bin/zsh");

        super::apply_terminal_session_env(&mut command);

        let argv = command.get_argv();
        assert_eq!(argv.len(), 2);
        assert_eq!(argv[1].to_str(), Some("-l"));
        assert_eq!(
            command.get_env("TERM").and_then(|value| value.to_str()),
            Some("xterm-256color")
        );
        assert_eq!(
            command
                .get_env("COLORTERM")
                .and_then(|value| value.to_str()),
            Some("truecolor")
        );
        assert_eq!(
            command
                .get_env("TERM_PROGRAM")
                .and_then(|value| value.to_str()),
            Some("yuuzu-ide")
        );
    }

    #[test]
    fn shell_command_fills_lang_when_parent_env_lacks_it() {
        let mut command = portable_pty::CommandBuilder::new("/bin/zsh");
        command.env_remove("LANG");

        super::apply_terminal_session_env(&mut command);

        assert_eq!(
            command.get_env("LANG").and_then(|value| value.to_str()),
            Some("en_US.UTF-8")
        );
    }

    #[test]
    fn shell_command_preserves_existing_lang() {
        let mut command = portable_pty::CommandBuilder::new("/bin/zsh");
        command.env("LANG", "ja_JP.UTF-8");

        super::apply_terminal_session_env(&mut command);

        assert_eq!(
            command.get_env("LANG").and_then(|value| value.to_str()),
            Some("ja_JP.UTF-8")
        );
    }

    #[test]
    fn coalesces_chunks_arriving_within_one_window() {
        let (tx, rx) = mpsc::channel();
        tx.send("one".to_string()).expect("send");
        tx.send("two".to_string()).expect("send");

        let chunk = super::next_coalesced_chunk(&rx, Duration::from_millis(10), 64 * 1024);

        assert_eq!(chunk.as_deref(), Some("onetwo"));
    }

    #[test]
    fn coalescing_returns_none_when_channel_closes_without_output() {
        let (tx, rx) = mpsc::channel::<String>();
        drop(tx);

        assert_eq!(
            super::next_coalesced_chunk(&rx, Duration::from_millis(10), 64 * 1024),
            None
        );
    }

    #[test]
    fn coalescing_flushes_pending_output_when_channel_closes_mid_window() {
        let (tx, rx) = mpsc::channel();
        tx.send("tail".to_string()).expect("send");
        drop(tx);

        let chunk = super::next_coalesced_chunk(&rx, Duration::from_millis(10), 64 * 1024);

        assert_eq!(chunk.as_deref(), Some("tail"));
    }

    #[test]
    fn coalescing_flushes_early_once_max_chunk_bytes_is_reached() {
        let (tx, rx) = mpsc::channel();
        tx.send("aaaa".to_string()).expect("send");
        tx.send("bbbb".to_string()).expect("send");
        tx.send("cccc".to_string()).expect("send");

        let first = super::next_coalesced_chunk(&rx, Duration::from_secs(5), 8);
        let second = super::next_coalesced_chunk(&rx, Duration::from_millis(5), 8);

        assert_eq!(first.as_deref(), Some("aaaabbbb"));
        assert_eq!(second.as_deref(), Some("cccc"));
    }

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
    fn resize_session_updates_kernel_pty_size() {
        let manager = super::TerminalState::new();
        let session = manager
            .register_test_session("workspace-a".to_string(), PathBuf::from("/repo-a"), None)
            .expect("session");
        insert_test_process(&manager, &session.id, Box::new(io::sink()));

        manager
            .resize_session(&session.id, 50, 220)
            .expect("resize");

        let size = {
            let processes = manager.processes.lock().expect("processes");
            let process = processes.get(&session.id).expect("process");
            let master = process.master.lock().expect("master");
            master.get_size().expect("get size")
        };
        assert_eq!(size.rows, 50);
        assert_eq!(size.cols, 220);
    }

    #[test]
    fn resize_session_rejects_missing_sessions() {
        let manager = super::TerminalState::new();

        let result = manager.resize_session("workspace-a:terminal-9", 50, 220);

        assert!(result
            .expect_err("missing session must error")
            .contains("missing terminal session"));
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

    #[test]
    fn write_session_releases_process_registry_before_writing() {
        let manager = Arc::new(super::TerminalState::new());
        let session = manager
            .register_test_session("workspace-a".to_string(), PathBuf::from("/repo-a"), None)
            .expect("session");
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        insert_test_process(
            &manager,
            &session.id,
            Box::new(BlockingWriter {
                entered: Some(entered_tx),
                release: release_rx,
            }),
        );

        let writer_manager = Arc::clone(&manager);
        let session_id = session.id.clone();
        let write_result =
            thread::spawn(move || writer_manager.write_session(&session_id, "input"));

        entered_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("writer entered");
        let registry_available_during_write = manager.processes.try_lock().is_ok();
        release_tx.send(()).expect("release writer");

        assert!(write_result.join().expect("join writer").is_ok());
        assert!(
            registry_available_during_write,
            "write_session should not hold processes mutex during writer IO"
        );
    }

    #[test]
    fn exited_session_is_marked_stopped_and_process_handle_removed() {
        let manager = super::TerminalState::new();
        let session = manager
            .register_test_session("workspace-a".to_string(), PathBuf::from("/repo-a"), None)
            .expect("session");
        insert_test_process(&manager, &session.id, Box::new(io::sink()));
        assert_eq!(manager.processes.lock().expect("processes").len(), 1);

        let stopped = manager
            .mark_session_exited(&session.id)
            .expect("mark exited")
            .expect("session");

        assert!(!stopped.running);
        assert_eq!(manager.processes.lock().expect("processes").len(), 0);
        let listed = manager.list_sessions("workspace-a").expect("list");
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].running);
    }

    #[test]
    fn rollback_child_cleanup_kills_and_waits_for_child() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let mut child = EventChild {
            events: Arc::clone(&events),
        };

        super::kill_and_wait(&mut child);

        assert_eq!(*events.lock().expect("events"), vec!["kill", "wait"]);
    }

    #[test]
    fn session_cwd_is_absolute() {
        let dir = tempdir().expect("tempdir");

        let cwd = super::normalize_session_cwd(dir.path()).expect("normalized cwd");

        assert!(cwd.is_absolute());
    }

    #[cfg(windows)]
    #[test]
    fn session_cwd_strips_windows_verbatim_prefix() {
        let dir = tempdir().expect("tempdir");
        let verbatim = std::fs::canonicalize(dir.path()).expect("verbatim path");
        assert!(
            verbatim.to_string_lossy().starts_with(r"\\?\"),
            "precondition: std canonicalize must produce a verbatim prefix on Windows"
        );

        let cwd = super::normalize_session_cwd(&verbatim).expect("normalized cwd");

        assert!(
            !cwd.to_string_lossy().starts_with(r"\\?\"),
            "terminal cwd must drop the verbatim prefix that CreateProcessW ignores"
        );
    }
}
