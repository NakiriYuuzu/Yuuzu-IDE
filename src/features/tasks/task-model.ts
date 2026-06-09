import { matchProblems, type TaskProblem } from "./problem-matcher";

export type WorkspaceTask = {
  id: string;
  label: string;
  command: string;
  cwd: string;
  source: string;
};

export type TaskRunStatus = "Running" | "Exited" | "Stopped";

export type TaskRun = {
  id: string;
  workspace_id: string;
  label: string;
  command: string;
  cwd: string;
  status: TaskRunStatus;
  exit_code: number | null;
};

export type RerunnableTask = {
  label: string;
  command: string;
  cwd: string;
};

type PendingTaskFinish = {
  exitCode: number | null;
};

export type TaskViewState = {
  detectedTasks: WorkspaceTask[];
  runs: TaskRun[];
  activeRunId: string | null;
  outputByRunId: Record<string, string>;
  problemsByRunId: Record<string, TaskProblem[]>;
  pendingOutputByRunId: Record<string, string>;
  pendingFinishByRunId: Record<string, PendingTaskFinish>;
  customCommand: string;
};

const MAX_TASK_OUTPUT_CHARS = 120_000;
const MAX_TASK_RUNS = 40;

function appendBoundedOutput(previous: string, chunk: string): string {
  const output = `${previous}${chunk}`;
  return output.slice(Math.max(0, output.length - MAX_TASK_OUTPUT_CHARS));
}

export function createTaskState(): TaskViewState {
  return {
    detectedTasks: [],
    runs: [],
    activeRunId: null,
    outputByRunId: {},
    problemsByRunId: {},
    pendingOutputByRunId: {},
    pendingFinishByRunId: {},
    customCommand: "",
  };
}

export function replaceDetectedTasks(
  state: TaskViewState,
  detectedTasks: WorkspaceTask[],
): TaskViewState {
  return { ...state, detectedTasks };
}

export function setCustomCommand(
  state: TaskViewState,
  customCommand: string,
): TaskViewState {
  return { ...state, customCommand };
}

export function replaceTaskRuns(
  state: TaskViewState,
  runs: TaskRun[],
): TaskViewState {
  const emptyState: TaskViewState = { ...state, runs: [], activeRunId: null };

  return runs.reduce<TaskViewState>(
    (next, run) => upsertTaskRun(next, run),
    emptyState,
  );
}

export function upsertTaskRun(state: TaskViewState, run: TaskRun): TaskViewState {
  const pendingOutput = state.pendingOutputByRunId[run.id] ?? "";
  const pendingFinish = state.pendingFinishByRunId[run.id];
  const output = appendBoundedOutput(
    state.outputByRunId[run.id] ?? "",
    pendingOutput,
  );
  const nextRun = pendingFinish
    ? { ...run, status: "Exited" as const, exit_code: pendingFinish.exitCode }
    : run;
  const exists = state.runs.some((item) => item.id === run.id);
  const runs = exists
    ? state.runs.map((item) => (item.id === run.id ? nextRun : item))
    : [nextRun, ...state.runs].slice(0, MAX_TASK_RUNS);
  const pendingOutputByRunId = { ...state.pendingOutputByRunId };
  const pendingFinishByRunId = { ...state.pendingFinishByRunId };
  delete pendingOutputByRunId[run.id];
  delete pendingFinishByRunId[run.id];

  return {
    ...state,
    runs,
    activeRunId: state.activeRunId ?? run.id,
    outputByRunId: {
      ...state.outputByRunId,
      [run.id]: output,
    },
    problemsByRunId: {
      ...state.problemsByRunId,
      [run.id]: matchProblems(output),
    },
    pendingOutputByRunId,
    pendingFinishByRunId,
  };
}

export function activateTaskRun(
  state: TaskViewState,
  runId: string,
): TaskViewState {
  return state.runs.some((run) => run.id === runId)
    ? { ...state, activeRunId: runId }
    : state;
}

export function appendTaskOutput(
  state: TaskViewState,
  runId: string,
  chunk: string,
): TaskViewState {
  if (!state.runs.some((run) => run.id === runId)) {
    return {
      ...state,
      pendingOutputByRunId: {
        ...state.pendingOutputByRunId,
        [runId]: appendBoundedOutput(
          state.pendingOutputByRunId[runId] ?? "",
          chunk,
        ),
      },
    };
  }

  const output = appendBoundedOutput(state.outputByRunId[runId] ?? "", chunk);

  return {
    ...state,
    outputByRunId: {
      ...state.outputByRunId,
      [runId]: output,
    },
    problemsByRunId: {
      ...state.problemsByRunId,
      [runId]: matchProblems(output),
    },
  };
}

export function finishTaskRun(
  state: TaskViewState,
  runId: string,
  exitCode: number | null,
): TaskViewState {
  if (!state.runs.some((run) => run.id === runId)) {
    return {
      ...state,
      pendingFinishByRunId: {
        ...state.pendingFinishByRunId,
        [runId]: { exitCode },
      },
    };
  }

  return {
    ...state,
    runs: state.runs.map((run) =>
      run.id === runId
        ? { ...run, status: "Exited", exit_code: exitCode }
        : run,
    ),
  };
}

export function stopTaskRunInState(
  state: TaskViewState,
  runId: string,
): TaskViewState {
  return {
    ...state,
    runs: state.runs.map((run) =>
      run.id === runId ? { ...run, status: "Stopped", exit_code: null } : run,
    ),
  };
}

export function activeTaskRun(state: TaskViewState): TaskRun | null {
  return (
    state.runs.find((run) => run.id === state.activeRunId) ??
    state.runs[0] ??
    null
  );
}

export function runningTaskRunForState(state: TaskViewState): TaskRun | null {
  const activeRun = activeTaskRun(state);

  if (activeRun?.status === "Running") {
    return activeRun;
  }

  return state.runs.find((run) => run.status === "Running") ?? null;
}

export function rerunnableTaskForState(
  state: TaskViewState,
): RerunnableTask | null {
  const run = activeTaskRun(state);

  if (!run) {
    return null;
  }

  return {
    label: run.label,
    command: run.command,
    cwd: run.cwd,
  };
}
