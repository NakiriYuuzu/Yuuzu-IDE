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

export type TaskErrorByWorkspace = Record<string, string>;

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
  contextPackByRunId: Record<string, string>;
  customCommand: string;
};

const MAX_TASK_OUTPUT_CHARS = 120_000;
const MAX_TASK_RUNS = 40;

function appendBoundedOutput(previous: string, chunk: string): string {
  const output = `${previous}${chunk}`;
  return output.slice(Math.max(0, output.length - MAX_TASK_OUTPUT_CHARS));
}

function taskRunNumber(run: TaskRun): number | null {
  const match = /:task-(\d+)$/.exec(run.id);
  return match ? Number(match[1]) : null;
}

function compareRestoredTaskRuns(left: TaskRun, right: TaskRun): number {
  if (left.status !== right.status) {
    if (left.status === "Running") {
      return -1;
    }

    if (right.status === "Running") {
      return 1;
    }
  }

  const leftNumber = taskRunNumber(left);
  const rightNumber = taskRunNumber(right);
  if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
    return rightNumber - leftNumber;
  }

  return right.id.localeCompare(left.id);
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
    contextPackByRunId: {},
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

export function taskErrorForWorkspace(
  errors: TaskErrorByWorkspace,
  workspaceId: string | null,
): string | null {
  if (!workspaceId) {
    return null;
  }

  return errors[workspaceId] ?? null;
}

export function setTaskErrorForWorkspace(
  errors: TaskErrorByWorkspace,
  workspaceId: string | null,
  error: string | null,
): TaskErrorByWorkspace {
  if (!workspaceId) {
    return errors;
  }

  if (error === null) {
    const next = { ...errors };
    delete next[workspaceId];
    return next;
  }

  return { ...errors, [workspaceId]: error };
}

export function replaceTaskRuns(
  state: TaskViewState,
  runs: TaskRun[],
  contextPackByRunId: Record<string, string> = state.contextPackByRunId,
): TaskViewState {
  const restoredRuns = [...runs]
    .sort(compareRestoredTaskRuns)
    .slice(0, MAX_TASK_RUNS);
  const emptyState: TaskViewState = {
    ...state,
    runs: [],
    activeRunId: null,
    contextPackByRunId: contextPackLinksForRuns(contextPackByRunId, restoredRuns),
  };
  const restoredState = [...restoredRuns]
    .reverse()
    .reduce<TaskViewState>(
      (next, run) => upsertTaskRun(next, run),
      emptyState,
    );

  return { ...restoredState, activeRunId: restoredRuns[0]?.id ?? null };
}

function contextPackLinksForRuns(
  contextPackByRunId: Record<string, string>,
  runs: TaskRun[],
): Record<string, string> {
  const runIds = new Set(runs.map((run) => run.id));

  return Object.fromEntries(
    Object.entries(contextPackByRunId).filter(([runId]) => runIds.has(runId)),
  );
}

export function hydrateTaskRunContextPacks(
  state: TaskViewState,
  contextPackByRunId: Record<string, string>,
): TaskViewState {
  return {
    ...state,
    contextPackByRunId: contextPackLinksForRuns(
      {
        ...state.contextPackByRunId,
        ...contextPackByRunId,
      },
      state.runs,
    ),
  };
}

export function replaceTaskRunContextPacks(
  state: TaskViewState,
  contextPackByRunId: Record<string, string>,
): TaskViewState {
  return {
    ...state,
    contextPackByRunId: contextPackLinksForRuns(contextPackByRunId, state.runs),
  };
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

export function linkTaskRunContextPack(
  state: TaskViewState,
  runId: string,
  contextPackId: string,
): TaskViewState {
  if (!state.runs.some((run) => run.id === runId)) {
    return state;
  }

  return {
    ...state,
    contextPackByRunId: {
      ...state.contextPackByRunId,
      [runId]: contextPackId,
    },
  };
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
