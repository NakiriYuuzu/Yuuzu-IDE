import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { call } from "../../lib/tauri";
import type { TaskRun, WorkspaceTask } from "./task-model";

export type TaskOutputEvent = {
  run_id: string;
  chunk: string;
};

export type TaskFinishedEvent = {
  run_id: string;
  exit_code: number | null;
};

export function listWorkspaceTasks(
  workspaceRoot: string,
): Promise<WorkspaceTask[]> {
  return call<WorkspaceTask[]>("list_workspace_tasks", { workspaceRoot });
}

export function runWorkspaceTask(args: {
  workspaceId: string;
  workspaceRoot: string;
  label: string;
  command: string;
  cwd: string;
}): Promise<TaskRun> {
  return call<TaskRun>("run_workspace_task", args);
}

export function stopTaskRun(runId: string): Promise<TaskRun> {
  return call<TaskRun>("stop_task_run", { runId });
}

export function listTaskRuns(workspaceId: string): Promise<TaskRun[]> {
  return call<TaskRun[]>("list_task_runs", { workspaceId });
}

export function onTaskOutput(
  handler: (event: TaskOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<TaskOutputEvent>("workspace://task-output", (event) =>
    handler(event.payload),
  );
}

export function onTaskFinished(
  handler: (event: TaskFinishedEvent) => void,
): Promise<UnlistenFn> {
  return listen<TaskFinishedEvent>("workspace://task-finished", (event) =>
    handler(event.payload),
  );
}
