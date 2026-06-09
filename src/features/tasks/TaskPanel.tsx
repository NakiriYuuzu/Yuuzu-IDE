import {
  AlertTriangle,
  ClipboardList,
  Play,
  RotateCw,
  Square,
} from "lucide-react";

import type { TaskProblem } from "./problem-matcher";
import type { TaskRun, WorkspaceTask } from "./task-model";

type TaskPanelProps = {
  detectedTasks: WorkspaceTask[];
  runs: TaskRun[];
  activeRunId: string | null;
  outputByRunId: Record<string, string>;
  problemsByRunId: Record<string, TaskProblem[]>;
  contextPackNameById: Record<string, string>;
  contextPackByRunId: Record<string, string>;
  customCommand: string;
  error: string | null;
  onCustomCommandChange: (value: string) => void;
  onRunTask: (task: WorkspaceTask) => void;
  onRunCustomTask: (command: string) => void;
  onActivateRun: (runId: string) => void;
  onStopRun: (runId: string) => void;
  onRerunRun: (run: TaskRun) => void;
};

function statusClass(status: TaskRun["status"]): string {
  if (status === "Running") {
    return " green";
  }

  if (status === "Stopped") {
    return " warn";
  }

  return "";
}

export function TaskPanel({
  detectedTasks,
  runs,
  activeRunId,
  outputByRunId,
  problemsByRunId,
  contextPackNameById,
  contextPackByRunId,
  customCommand,
  error,
  onCustomCommandChange,
  onRunTask,
  onRunCustomTask,
  onActivateRun,
  onStopRun,
  onRerunRun,
}: TaskPanelProps) {
  const activeRun =
    runs.find((run) => run.id === activeRunId) ?? runs[0] ?? null;
  const activeOutput = activeRun ? (outputByRunId[activeRun.id] ?? "") : "";
  const activeProblems = activeRun
    ? (problemsByRunId[activeRun.id] ?? [])
    : [];
  const activeContextPackId = activeRun
    ? (contextPackByRunId[activeRun.id] ?? null)
    : null;
  const activeContextPackName = activeContextPackId
    ? (contextPackNameById[activeContextPackId] ?? activeContextPackId)
    : null;
  const trimmedCustomCommand = customCommand.trim();

  return (
    <div className="panel-body task-panel">
      <div className="task-custom">
        <input
          className="input2 mono"
          value={customCommand}
          aria-label="Custom task command"
          placeholder="Custom command"
          onChange={(event) => onCustomCommandChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && trimmedCustomCommand) {
              onRunCustomTask(trimmedCustomCommand);
            }
          }}
        />
        <button
          type="button"
          className="btn primary"
          disabled={!trimmedCustomCommand}
          onClick={() => onRunCustomTask(trimmedCustomCommand)}
        >
          <Play aria-hidden="true" />
          Run
        </button>
      </div>

      {error ? (
        <div className="terminal-inline-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="section-label">
        <span>Detected</span>
        <span>{detectedTasks.length}</span>
      </div>

      {detectedTasks.map((task) => (
        <div className="task-row" key={task.id}>
          <button
            type="button"
            className="row tree-row task-list-row"
            title={task.command}
            onClick={() => onRunTask(task)}
          >
            <ClipboardList aria-hidden="true" />
            <span className="task-row-main">
              <span className="nm mono">{task.label}</span>
              <span className="task-row-sub mono">{task.cwd}</span>
            </span>
            <span className="badge2">{task.source}</span>
          </button>
          <div className="task-row-actions">
            <button
              type="button"
              className="iconbtn"
              title={`Run ${task.label}`}
              aria-label={`Run ${task.label}`}
              onClick={() => onRunTask(task)}
            >
              <Play aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}

      {detectedTasks.length === 0 ? (
        <div className="panel-empty task-empty">
          <span>No detected tasks</span>
        </div>
      ) : null}

      <div className="section-label">
        <span>History</span>
        <span>{runs.length}</span>
      </div>

      {runs.map((run) => {
        const active = run.id === activeRun?.id;
        const problems = problemsByRunId[run.id] ?? [];

        return (
          <div className={`task-row${active ? " active" : ""}`} key={run.id}>
            <button
              type="button"
              className={`row tree-row task-list-row${active ? " sel" : ""}`}
              title={run.command}
              onClick={() => onActivateRun(run.id)}
            >
              <ClipboardList aria-hidden="true" />
              <span className="task-row-main">
                <span className="nm mono">{run.label}</span>
                <span className="task-row-sub mono">{run.cwd}</span>
              </span>
              {problems.length > 0 ? (
                <span className="badge2 danger">
                  <AlertTriangle aria-hidden="true" />
                  {problems.length}
                </span>
              ) : null}
              <span className={`badge2${statusClass(run.status)}`}>
                <span className="d" />
                {run.status.toLowerCase()}
              </span>
            </button>
            <div className="task-row-actions">
              {run.status === "Running" ? (
                <button
                  type="button"
                  className="iconbtn"
                  title={`Stop ${run.label}`}
                  aria-label={`Stop ${run.label}`}
                  onClick={() => onStopRun(run.id)}
                >
                  <Square aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  className="iconbtn"
                  title={`Rerun ${run.label}`}
                  aria-label={`Rerun ${run.label}`}
                  onClick={() => onRerunRun(run)}
                >
                  <RotateCw aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {runs.length === 0 ? (
        <div className="panel-empty task-empty">
          <span>No task runs</span>
        </div>
      ) : null}

      <div className="task-output-wrap">
        <div className="section-label">
          <span>Output</span>
          <span>{activeProblems.length} problems</span>
        </div>
        {activeContextPackName ? (
          <div className="task-context-strip">
            <span className="badge2">Context</span>
            <span className="docs-context-badge mono" title={activeContextPackName}>
              {activeContextPackName}
            </span>
          </div>
        ) : null}
        {activeRun ? (
          <pre className="task-output mono">{activeOutput}</pre>
        ) : (
          <div className="panel-empty task-empty">
            <span>No output</span>
          </div>
        )}
      </div>
    </div>
  );
}
