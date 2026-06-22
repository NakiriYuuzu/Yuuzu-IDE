use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};

use crate::background_process::background_command;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WorkspaceTask {
    pub id: String,
    pub label: String,
    pub command: String,
    pub cwd: PathBuf,
    pub source: String,
}

#[derive(Deserialize)]
struct PackageJson {
    scripts: Option<HashMap<String, String>>,
}

pub fn detect_tasks(workspace_root: &Path) -> Result<Vec<WorkspaceTask>, String> {
    let root = workspace_root
        .canonicalize()
        .map_err(|err| err.to_string())?;
    let mut tasks = Vec::new();

    let package_path = root.join("package.json");
    if package_path.is_file() {
        let package = fs::read_to_string(&package_path).map_err(|err| err.to_string())?;
        if let Ok(package) = serde_json::from_str::<PackageJson>(&package) {
            if let Some(scripts) = package.scripts {
                let mut scripts = scripts.into_iter().collect::<Vec<_>>();
                scripts.sort_by(|left, right| left.0.cmp(&right.0));
                tasks.extend(scripts.into_iter().map(|(name, _script)| {
                    let command = format!("bun run {name}");
                    WorkspaceTask {
                        id: format!("package:{name}"),
                        label: command.clone(),
                        command,
                        cwd: root.clone(),
                        source: "package.json".to_string(),
                    }
                }));
            }
        }
    }

    if root.join("Cargo.toml").is_file() {
        tasks.push(WorkspaceTask {
            id: "cargo:test".to_string(),
            label: "cargo test".to_string(),
            command: "cargo test".to_string(),
            cwd: root.clone(),
            source: "Cargo.toml".to_string(),
        });
        tasks.push(WorkspaceTask {
            id: "cargo:build".to_string(),
            label: "cargo build".to_string(),
            command: "cargo build".to_string(),
            cwd: root.clone(),
            source: "Cargo.toml".to_string(),
        });
    }

    if root.join("pyproject.toml").is_file() {
        tasks.push(WorkspaceTask {
            id: "uv:run-python".to_string(),
            label: "uv run python".to_string(),
            command: "uv run python".to_string(),
            cwd: root,
            source: "pyproject.toml".to_string(),
        });
    }

    Ok(tasks)
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub enum TaskRunStatus {
    Running,
    Exited,
    Stopped,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct TaskRun {
    pub id: String,
    pub workspace_id: String,
    pub label: String,
    pub command: String,
    pub cwd: PathBuf,
    pub status: TaskRunStatus,
    pub exit_code: Option<i32>,
}

#[derive(Default)]
pub struct TaskRunRegistry {
    next_by_workspace: HashMap<String, usize>,
    runs: HashMap<String, TaskRun>,
}

impl TaskRunRegistry {
    pub fn reserve_run(
        &mut self,
        workspace_id: String,
        label: String,
        command: String,
        cwd: PathBuf,
    ) -> TaskRun {
        let next = self
            .next_by_workspace
            .entry(workspace_id.clone())
            .or_insert(1);
        let id = format!("{workspace_id}:task-{next}");
        *next += 1;

        let run = TaskRun {
            id: id.clone(),
            workspace_id,
            label,
            command,
            cwd,
            status: TaskRunStatus::Running,
            exit_code: None,
        };
        self.runs.insert(id, run.clone());
        run
    }

    pub fn finish_run(&mut self, run_id: &str, exit_code: Option<i32>) -> Option<TaskRun> {
        let run = self.runs.get_mut(run_id)?;
        if run.status == TaskRunStatus::Running {
            run.status = TaskRunStatus::Exited;
            run.exit_code = exit_code;
        }
        Some(run.clone())
    }

    pub fn stop_run(&mut self, run_id: &str) -> Option<TaskRun> {
        let run = self.runs.get_mut(run_id)?;
        if run.status == TaskRunStatus::Running {
            run.status = TaskRunStatus::Stopped;
            run.exit_code = None;
        }
        Some(run.clone())
    }

    pub fn list_runs(&self, workspace_id: &str) -> Vec<TaskRun> {
        let mut runs = self
            .runs
            .values()
            .filter(|run| run.workspace_id == workspace_id)
            .cloned()
            .collect::<Vec<_>>();
        runs.sort_by(|left, right| left.id.cmp(&right.id));
        runs
    }

    pub fn get_run(&self, run_id: &str) -> Option<TaskRun> {
        self.runs.get(run_id).cloned()
    }

    fn remove_run(&mut self, run_id: &str) -> Option<TaskRun> {
        self.runs.remove(run_id)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct TaskOutputEvent {
    pub run_id: String,
    pub chunk: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct TaskFinishedEvent {
    pub run_id: String,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ShellCommandSpec {
    program: &'static str,
    args: Vec<String>,
}

#[cfg(unix)]
fn shell_command_spec(command: &str) -> ShellCommandSpec {
    ShellCommandSpec {
        program: "/bin/sh",
        args: vec!["-lc".to_string(), command.to_string()],
    }
}

#[cfg(windows)]
fn shell_command_spec(command: &str) -> ShellCommandSpec {
    ShellCommandSpec {
        program: "cmd",
        args: vec!["/C".to_string(), command.to_string()],
    }
}

fn task_command(command: &str, cwd: &Path) -> Command {
    let spec = shell_command_spec(command);
    let mut task = background_command(spec.program);
    task.args(spec.args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut task);
    task
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);
}

#[cfg(windows)]
fn configure_process_group(_command: &mut Command) {}

#[derive(Clone)]
struct TaskProcess {
    child: Arc<Mutex<Child>>,
    stop_started: Arc<AtomicBool>,
    #[cfg(unix)]
    process_group_id: u32,
    #[cfg(windows)]
    pid: u32,
}

impl TaskProcess {
    fn new(child: Child) -> Self {
        let pid = child.id();
        Self {
            child: Arc::new(Mutex::new(child)),
            stop_started: Arc::new(AtomicBool::new(false)),
            #[cfg(unix)]
            process_group_id: pid,
            #[cfg(windows)]
            pid,
        }
    }
}

#[derive(Clone)]
pub struct TaskState {
    registry: Arc<Mutex<TaskRunRegistry>>,
    processes: Arc<Mutex<HashMap<String, TaskProcess>>>,
}

impl TaskState {
    pub fn new() -> Self {
        Self {
            registry: Arc::new(Mutex::new(TaskRunRegistry::default())),
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn run_task(
        &self,
        app: AppHandle,
        workspace_id: String,
        label: String,
        command: String,
        cwd: PathBuf,
    ) -> Result<TaskRun, String> {
        let cwd = cwd.canonicalize().map_err(|err| err.to_string())?;
        let run = {
            let mut registry = self.registry.lock().map_err(|err| err.to_string())?;
            registry.reserve_run(workspace_id, label, command, cwd.clone())
        };

        let mut child = match task_command(&run.command, &cwd).spawn() {
            Ok(child) => child,
            Err(err) => {
                let _ = self
                    .registry
                    .lock()
                    .map(|mut registry| registry.remove_run(&run.id));
                return Err(err.to_string());
            }
        };

        if let Some(stdout) = child.stdout.take() {
            spawn_output_reader(app.clone(), run.id.clone(), stdout);
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_output_reader(app.clone(), run.id.clone(), stderr);
        }
        let process = TaskProcess::new(child);

        self.processes
            .lock()
            .map_err(|err| err.to_string())?
            .insert(run.id.clone(), process.clone());

        let wait_run_id = run.id.clone();
        let wait_registry = Arc::clone(&self.registry);
        let wait_processes = Arc::clone(&self.processes);
        thread::spawn(move || loop {
            match try_child_exit_code(&process) {
                Ok(Some(exit_code)) => {
                    let event = finish_wait_observed_exit(
                        &wait_registry,
                        &wait_processes,
                        &process,
                        &wait_run_id,
                        exit_code,
                    )
                    .ok()
                    .flatten();
                    if let Some(event) = event {
                        let _ = app.emit("workspace://task-finished", event);
                    }
                    break;
                }
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => break,
            }
        });

        Ok(run)
    }

    pub fn stop_task(&self, run_id: &str) -> Result<TaskRun, String> {
        let process = self
            .processes
            .lock()
            .map_err(|err| err.to_string())?
            .get(run_id)
            .cloned();
        let Some(process) = process else {
            return self
                .registry
                .lock()
                .map_err(|err| err.to_string())?
                .get_run(run_id)
                .ok_or_else(|| format!("missing task run: {run_id}"));
        };

        match begin_stop_or_observe_exit(&process)? {
            StopStart::AlreadyExited(exit_code) => {
                return mark_run_finished_in_state(
                    &self.registry,
                    &self.processes,
                    run_id,
                    exit_code,
                )?
                .ok_or_else(|| format!("missing task run: {run_id}"));
            }
            StopStart::Started => {}
        }

        if let Err(err) = kill_process(&process) {
            match cancel_stop_if_still_running(&process)? {
                StopCancel::AlreadyExited(_) => {
                    return mark_run_stopped_in_state(&self.registry, &self.processes, run_id);
                }
                StopCancel::StillRunning => return Err(err),
            }
        }

        mark_run_stopped_in_state(&self.registry, &self.processes, run_id)
    }

    pub fn list_runs(&self, workspace_id: &str) -> Result<Vec<TaskRun>, String> {
        self.registry
            .lock()
            .map_err(|err| err.to_string())
            .map(|registry| registry.list_runs(workspace_id))
    }

    pub fn get_run(&self, run_id: &str) -> Result<TaskRun, String> {
        self.registry
            .lock()
            .map_err(|err| err.to_string())?
            .get_run(run_id)
            .ok_or_else(|| format!("missing task run: {run_id}"))
    }

    #[cfg(test)]
    pub(crate) fn register_test_run(
        &self,
        workspace_id: String,
        label: String,
        command: String,
        cwd: PathBuf,
    ) -> Result<TaskRun, String> {
        let mut registry = self.registry.lock().map_err(|err| err.to_string())?;
        Ok(registry.reserve_run(workspace_id, label, command, cwd))
    }

    #[cfg(test)]
    fn insert_test_process(&self, run_id: String, child: Child) -> Result<(), String> {
        self.processes
            .lock()
            .map_err(|err| err.to_string())?
            .insert(run_id, TaskProcess::new(child));
        Ok(())
    }

    #[cfg(test)]
    fn child_count(&self) -> usize {
        self.processes.lock().expect("processes").len()
    }
}

fn spawn_output_reader(app: AppHandle, run_id: String, stream: impl Read + Send + 'static) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let _ = app.emit(
                        "workspace://task-output",
                        TaskOutputEvent {
                            run_id: run_id.clone(),
                            chunk: line.clone(),
                        },
                    );
                }
            }
        }
    });
}

fn mark_run_finished_in_state(
    registry: &Mutex<TaskRunRegistry>,
    processes: &Mutex<HashMap<String, TaskProcess>>,
    run_id: &str,
    exit_code: Option<i32>,
) -> Result<Option<TaskRun>, String> {
    let run = registry
        .lock()
        .map_err(|err| err.to_string())?
        .finish_run(run_id, exit_code);

    if run.is_some() {
        processes
            .lock()
            .map_err(|err| err.to_string())?
            .remove(run_id);
    }

    Ok(run)
}

#[derive(Debug, PartialEq, Eq)]
enum StopStart {
    AlreadyExited(Option<i32>),
    Started,
}

#[derive(Debug, PartialEq, Eq)]
enum StopCancel {
    AlreadyExited(Option<i32>),
    StillRunning,
}

fn begin_stop_or_observe_exit(process: &TaskProcess) -> Result<StopStart, String> {
    let mut child = process.child.lock().map_err(|err| err.to_string())?;
    if let Some(status) = child.try_wait().map_err(|err| err.to_string())? {
        return Ok(StopStart::AlreadyExited(status.code()));
    }

    process.stop_started.store(true, Ordering::SeqCst);
    Ok(StopStart::Started)
}

fn cancel_stop_if_still_running(process: &TaskProcess) -> Result<StopCancel, String> {
    let mut child = process.child.lock().map_err(|err| err.to_string())?;
    if let Some(status) = child.try_wait().map_err(|err| err.to_string())? {
        return Ok(StopCancel::AlreadyExited(status.code()));
    }

    process.stop_started.store(false, Ordering::SeqCst);
    Ok(StopCancel::StillRunning)
}

fn mark_run_stopped_in_state(
    registry: &Mutex<TaskRunRegistry>,
    processes: &Mutex<HashMap<String, TaskProcess>>,
    run_id: &str,
) -> Result<TaskRun, String> {
    let run = registry
        .lock()
        .map_err(|err| err.to_string())?
        .stop_run(run_id)
        .ok_or_else(|| format!("missing task run: {run_id}"))?;
    processes
        .lock()
        .map_err(|err| err.to_string())?
        .remove(run_id);

    Ok(run)
}

fn finish_wait_observed_exit(
    registry: &Mutex<TaskRunRegistry>,
    processes: &Mutex<HashMap<String, TaskProcess>>,
    process: &TaskProcess,
    run_id: &str,
    exit_code: Option<i32>,
) -> Result<Option<TaskFinishedEvent>, String> {
    if process.stop_started.load(Ordering::SeqCst) {
        processes
            .lock()
            .map_err(|err| err.to_string())?
            .remove(run_id);
        return Ok(None);
    }

    Ok(
        mark_run_finished_in_state(registry, processes, run_id, exit_code)?
            .as_ref()
            .and_then(task_finished_event),
    )
}

fn try_child_exit_code(process: &TaskProcess) -> Result<Option<Option<i32>>, String> {
    process
        .child
        .lock()
        .map_err(|err| err.to_string())?
        .try_wait()
        .map(|status| status.map(|status| status.code()))
        .map_err(|err| err.to_string())
}

fn task_finished_event(run: &TaskRun) -> Option<TaskFinishedEvent> {
    if run.status == TaskRunStatus::Exited {
        Some(TaskFinishedEvent {
            run_id: run.id.clone(),
            exit_code: run.exit_code,
        })
    } else {
        None
    }
}

#[cfg(unix)]
fn kill_process(process: &TaskProcess) -> Result<(), String> {
    let status = Command::new("kill")
        .arg("-TERM")
        .arg(unix_process_group_signal_target(process.process_group_id))
        .status()
        .map_err(|err| err.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "failed to stop task process group: {}",
            process.process_group_id
        ))
    }
}

#[cfg(unix)]
fn unix_process_group_signal_target(process_group_id: u32) -> String {
    format!("-{process_group_id}")
}

#[cfg(windows)]
fn kill_process(process: &TaskProcess) -> Result<(), String> {
    let status = background_command("taskkill")
        .args(["/PID", &process.pid.to_string(), "/T", "/F"])
        .status()
        .map_err(|err| err.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("failed to stop task process: {}", process.pid))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    #[cfg(unix)]
    use std::process::Command;
    use std::{thread, time::Duration};
    use tempfile::tempdir;

    #[test]
    fn detects_package_cargo_and_uv_tasks() {
        let root = tempdir().expect("tempdir");
        fs::write(
            root.path().join("package.json"),
            r#"{"scripts":{"dev":"vite","test":"bun test","build":"tsc && vite build"}}"#,
        )
        .expect("package");
        fs::write(
            root.path().join("Cargo.toml"),
            "[package]\nname = \"demo\"\n",
        )
        .expect("cargo");
        fs::write(
            root.path().join("pyproject.toml"),
            "[project]\nname = \"demo\"\n",
        )
        .expect("py");

        let tasks = super::detect_tasks(root.path()).expect("tasks");
        let canonical_root = root.path().canonicalize().expect("canonical root");
        let ids = tasks
            .iter()
            .map(|task| task.id.as_str())
            .collect::<Vec<_>>();
        let labels = tasks
            .iter()
            .map(|task| (task.id.as_str(), task.command.as_str()))
            .collect::<Vec<_>>();

        assert_eq!(&ids[..3], &["package:build", "package:dev", "package:test"]);
        assert!(labels.contains(&("package:dev", "bun run dev")));
        assert!(labels.contains(&("package:test", "bun run test")));
        assert!(labels.contains(&("package:build", "bun run build")));
        assert!(labels.contains(&("cargo:test", "cargo test")));
        assert!(labels.contains(&("cargo:build", "cargo build")));
        assert!(labels.contains(&("uv:run-python", "uv run python")));
        assert!(tasks.iter().all(|task| task.cwd == canonical_root));
        assert!(tasks
            .iter()
            .any(|task| task.id == "package:dev" && task.source == "package.json"));
    }

    #[test]
    fn task_runs_are_workspace_scoped_and_status_updates() {
        let mut registry = super::TaskRunRegistry::default();
        let run = registry.reserve_run(
            "workspace-a".to_string(),
            "custom".to_string(),
            "echo ok".to_string(),
            "/repo".into(),
        );

        assert_eq!(run.id, "workspace-a:task-1");
        assert_eq!(run.status, super::TaskRunStatus::Running);

        registry.finish_run(&run.id, Some(0));
        let runs = registry.list_runs("workspace-a");
        assert_eq!(runs[0].status, super::TaskRunStatus::Exited);
        assert_eq!(runs[0].exit_code, Some(0));
    }

    #[test]
    fn stopped_runs_are_not_overwritten_by_late_finish() {
        let mut registry = super::TaskRunRegistry::default();
        let run = registry.reserve_run(
            "workspace-a".to_string(),
            "custom".to_string(),
            "echo ok".to_string(),
            "/repo".into(),
        );

        let stopped = registry.stop_run(&run.id).expect("stop");
        registry.finish_run(&run.id, Some(1));
        let runs = registry.list_runs("workspace-a");

        assert_eq!(stopped.status, super::TaskRunStatus::Stopped);
        assert_eq!(runs[0].status, super::TaskRunStatus::Stopped);
        assert_eq!(runs[0].exit_code, None);
    }

    #[cfg(unix)]
    #[test]
    fn shell_command_uses_sh_lc_for_compound_scripts() {
        let spec = super::shell_command_spec("echo one && echo two");

        assert_eq!(spec.program, "/bin/sh");
        assert_eq!(spec.args, vec!["-lc", "echo one && echo two"]);
    }

    #[cfg(unix)]
    #[test]
    fn task_command_starts_a_new_process_group() {
        let temp = tempdir().expect("tempdir");
        let mut child = super::task_command("sleep 1", temp.path())
            .spawn()
            .expect("child");
        let pid = child.id();
        let pgid = process_group_id(pid).expect("pgid");
        let _ = child.kill();
        let _ = child.wait();

        assert_eq!(pgid, pid);
    }

    #[cfg(unix)]
    #[test]
    fn unix_stop_signal_targets_process_group() {
        assert_eq!(super::unix_process_group_signal_target(123), "-123");
    }

    #[cfg(unix)]
    #[test]
    fn stop_task_marks_run_stopped_and_removes_child_handle() {
        let state = super::TaskState::new();
        let run = state
            .register_test_run(
                "workspace-a".to_string(),
                "custom".to_string(),
                "sleep 60".to_string(),
                "/repo".into(),
            )
            .expect("run");
        let child = super::task_command("sleep 60", &std::env::temp_dir())
            .spawn()
            .expect("child");
        state
            .insert_test_process(run.id.clone(), child)
            .expect("insert child");

        let stopped = state.stop_task(&run.id).expect("stop");

        assert_eq!(stopped.status, super::TaskRunStatus::Stopped);
        assert_eq!(state.child_count(), 0);
    }

    #[test]
    fn stop_task_returns_exited_when_child_already_exited() {
        let temp = tempdir().expect("tempdir");
        let state = super::TaskState::new();
        let run = state
            .register_test_run(
                "workspace-a".to_string(),
                "custom".to_string(),
                "exit 7".to_string(),
                temp.path().into(),
            )
            .expect("run");
        let mut child = super::task_command("exit 7", temp.path())
            .spawn()
            .expect("child");
        wait_until_exited(&mut child);
        state
            .insert_test_process(run.id.clone(), child)
            .expect("insert child");

        let stopped = state.stop_task(&run.id).expect("stop");

        assert_eq!(stopped.status, super::TaskRunStatus::Exited);
        assert_eq!(stopped.exit_code, Some(7));
        assert_eq!(state.child_count(), 0);
    }

    #[test]
    fn stopped_final_runs_do_not_emit_finished_events() {
        let mut registry = super::TaskRunRegistry::default();
        let run = registry.reserve_run(
            "workspace-a".to_string(),
            "custom".to_string(),
            "echo ok".to_string(),
            "/repo".into(),
        );

        registry.stop_run(&run.id).expect("stop");
        let final_run = registry.finish_run(&run.id, Some(143)).expect("finish");

        assert_eq!(final_run.status, super::TaskRunStatus::Stopped);
        assert!(super::task_finished_event(&final_run).is_none());
    }

    #[test]
    fn wait_thread_finalization_after_stop_intent_does_not_emit_or_mark_exited() {
        let temp = tempdir().expect("tempdir");
        let state = super::TaskState::new();
        let run = state
            .register_test_run(
                "workspace-a".to_string(),
                "custom".to_string(),
                "sleep 60".to_string(),
                temp.path().into(),
            )
            .expect("run");
        let child = super::task_command("sleep 60", temp.path())
            .spawn()
            .expect("child");
        state
            .insert_test_process(run.id.clone(), child)
            .expect("insert child");
        let process = state
            .processes
            .lock()
            .expect("processes")
            .get(&run.id)
            .expect("process")
            .clone();

        assert_eq!(
            super::begin_stop_or_observe_exit(&process).expect("begin stop"),
            super::StopStart::Started
        );
        super::kill_process(&process).expect("kill");
        let exit_code = wait_until_process_exited(&process);
        let event = super::finish_wait_observed_exit(
            &state.registry,
            &state.processes,
            &process,
            &run.id,
            exit_code,
        )
        .expect("finish wait");
        let run_after_wait = state
            .list_runs("workspace-a")
            .expect("runs")
            .into_iter()
            .next()
            .expect("run");
        let stopped = state
            .registry
            .lock()
            .expect("registry")
            .stop_run(&run.id)
            .expect("stop");

        assert!(event.is_none());
        assert_eq!(run_after_wait.status, super::TaskRunStatus::Running);
        assert_eq!(stopped.status, super::TaskRunStatus::Stopped);
    }

    #[test]
    fn canceling_failed_stop_intent_allows_later_exit_event() {
        let temp = tempdir().expect("tempdir");
        let state = super::TaskState::new();
        let run = state
            .register_test_run(
                "workspace-a".to_string(),
                "custom".to_string(),
                "sleep 0.1; exit 9".to_string(),
                temp.path().into(),
            )
            .expect("run");
        let child = super::task_command("sleep 0.1; exit 9", temp.path())
            .spawn()
            .expect("child");
        state
            .insert_test_process(run.id.clone(), child)
            .expect("insert child");
        let process = state
            .processes
            .lock()
            .expect("processes")
            .get(&run.id)
            .expect("process")
            .clone();

        assert_eq!(
            super::begin_stop_or_observe_exit(&process).expect("begin stop"),
            super::StopStart::Started
        );
        assert_eq!(
            super::cancel_stop_if_still_running(&process).expect("cancel stop"),
            super::StopCancel::StillRunning
        );
        let exit_code = wait_until_process_exited(&process);
        let event = super::finish_wait_observed_exit(
            &state.registry,
            &state.processes,
            &process,
            &run.id,
            exit_code,
        )
        .expect("finish wait")
        .expect("event");
        let exited = state
            .list_runs("workspace-a")
            .expect("runs")
            .into_iter()
            .next()
            .expect("run");

        assert_eq!(event.run_id, run.id);
        assert_eq!(event.exit_code, Some(9));
        assert_eq!(exited.status, super::TaskRunStatus::Exited);
        assert_eq!(exited.exit_code, Some(9));
        assert_eq!(state.child_count(), 0);
    }

    #[cfg(unix)]
    fn process_group_id(pid: u32) -> Result<u32, String> {
        let output = Command::new("ps")
            .args(["-o", "pgid=", "-p", &pid.to_string()])
            .output()
            .map_err(|err| err.to_string())?;
        if !output.status.success() {
            return Err(format!("ps failed for pid {pid}"));
        }

        String::from_utf8(output.stdout)
            .map_err(|err| err.to_string())?
            .trim()
            .parse::<u32>()
            .map_err(|err| err.to_string())
    }

    fn wait_until_exited(child: &mut std::process::Child) {
        for _ in 0..100 {
            if child.try_wait().expect("try wait").is_some() {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }

        panic!("child did not exit");
    }

    fn wait_until_process_exited(process: &super::TaskProcess) -> Option<i32> {
        for _ in 0..100 {
            if let Some(status) = process
                .child
                .lock()
                .expect("child")
                .try_wait()
                .expect("try wait")
            {
                return status.code();
            }
            thread::sleep(Duration::from_millis(10));
        }

        panic!("process did not exit");
    }
}
