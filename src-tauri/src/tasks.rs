use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter};

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
    let mut task = Command::new(spec.program);
    task.args(spec.args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    task
}

#[derive(Clone, Debug)]
struct TaskProcess {
    pid: u32,
}

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
        let pid = child.id();

        if let Some(stdout) = child.stdout.take() {
            spawn_output_reader(app.clone(), run.id.clone(), stdout);
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_output_reader(app.clone(), run.id.clone(), stderr);
        }

        self.processes
            .lock()
            .map_err(|err| err.to_string())?
            .insert(run.id.clone(), TaskProcess { pid });

        let wait_run_id = run.id.clone();
        let wait_registry = Arc::clone(&self.registry);
        let wait_processes = Arc::clone(&self.processes);
        thread::spawn(move || {
            let exit_code = child.wait().ok().and_then(|status| status.code());
            let _ = mark_run_finished_in_state(
                &wait_registry,
                &wait_processes,
                &wait_run_id,
                exit_code,
            );
            let _ = app.emit(
                "workspace://task-finished",
                TaskFinishedEvent {
                    run_id: wait_run_id,
                    exit_code,
                },
            );
        });

        Ok(run)
    }

    pub fn stop_task(&self, run_id: &str) -> Result<TaskRun, String> {
        let process = self
            .processes
            .lock()
            .map_err(|err| err.to_string())?
            .remove(run_id);
        if let Some(process) = process {
            let _ = kill_process(process.pid);
        }

        self.registry
            .lock()
            .map_err(|err| err.to_string())?
            .stop_run(run_id)
            .ok_or_else(|| format!("missing task run: {run_id}"))
    }

    pub fn list_runs(&self, workspace_id: &str) -> Result<Vec<TaskRun>, String> {
        self.registry
            .lock()
            .map_err(|err| err.to_string())
            .map(|registry| registry.list_runs(workspace_id))
    }

    #[cfg(test)]
    fn register_test_run(
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
    fn insert_test_process(&self, run_id: String, pid: u32) -> Result<(), String> {
        self.processes
            .lock()
            .map_err(|err| err.to_string())?
            .insert(run_id, TaskProcess { pid });
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
    processes
        .lock()
        .map_err(|err| err.to_string())?
        .remove(run_id);

    Ok(registry
        .lock()
        .map_err(|err| err.to_string())?
        .finish_run(run_id, exit_code))
}

#[cfg(unix)]
fn kill_process(pid: u32) -> Result<(), String> {
    let status = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .status()
        .map_err(|err| err.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("failed to stop task process: {pid}"))
    }
}

#[cfg(windows)]
fn kill_process(pid: u32) -> Result<(), String> {
    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .map_err(|err| err.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("failed to stop task process: {pid}"))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    #[cfg(unix)]
    use std::process::Command;
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
        let mut child = Command::new("/bin/sh")
            .args(["-lc", "sleep 60"])
            .spawn()
            .expect("child");
        state
            .insert_test_process(run.id.clone(), child.id())
            .expect("insert child");

        let stopped = state.stop_task(&run.id).expect("stop");

        assert_eq!(stopped.status, super::TaskRunStatus::Stopped);
        assert_eq!(state.child_count(), 0);
        let _ = child.wait();
    }
}
