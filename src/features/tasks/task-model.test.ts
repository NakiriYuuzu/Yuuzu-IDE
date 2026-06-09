/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  activateTaskRun,
  appendTaskOutput,
  createTaskState,
  finishTaskRun,
  hydrateTaskRunContextPacks,
  linkTaskRunContextPack,
  replaceTaskRunContextPacks,
  replaceDetectedTasks,
  replaceTaskRuns,
  rerunnableTaskForState,
  setCustomCommand,
  setTaskErrorForWorkspace,
  stopTaskRunInState,
  taskErrorForWorkspace,
  upsertTaskRun,
} from "./task-model";
import type { TaskRun } from "./task-model";
import { createWorkspaceViewStore } from "../../app/workspace-view-state";

function runningRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: "w:task-1",
    workspace_id: "w",
    label: "bun test",
    command: "bun test",
    cwd: "/repo",
    status: "Running",
    exit_code: null,
    ...overrides,
  };
}

describe("task model", () => {
  test("stores detected tasks and custom command", () => {
    const state = setCustomCommand(
      replaceDetectedTasks(createTaskState(), [
        {
          id: "package:test",
          label: "bun run test",
          command: "bun run test",
          cwd: "/repo",
          source: "package.json",
        },
      ]),
      "bun test",
    );

    expect(state.detectedTasks).toHaveLength(1);
    expect(state.customCommand).toBe("bun test");
  });

  test("upserts task runs and marks the first run active", () => {
    const state = upsertTaskRun(createTaskState(), runningRun());

    expect(state.activeRunId).toBe("w:task-1");
    expect(state.runs).toHaveLength(1);
  });

  test("activates an existing run", () => {
    const state = activateTaskRun(
      upsertTaskRun(
        upsertTaskRun(createTaskState(), runningRun()),
        runningRun({ id: "w:task-2", label: "bun build" }),
      ),
      "w:task-2",
    );

    expect(state.activeRunId).toBe("w:task-2");
  });

  test("appends bounded output and parses problems", () => {
    const run = runningRun();
    const chunk = `${"x".repeat(125_000)}\nsrc/main.rs:1:2: error: boom\n`;
    const state = appendTaskOutput(
      upsertTaskRun(createTaskState(), run),
      run.id,
      chunk,
    );

    expect(state.outputByRunId[run.id].length).toBeLessThanOrEqual(120_000);
    expect(state.problemsByRunId[run.id]).toEqual([
      {
        file: "src/main.rs",
        line: 1,
        column: 2,
        severity: "error",
        message: "boom",
      },
    ]);
  });

  test("finishes and stops task runs", () => {
    const run = runningRun();
    const finished = finishTaskRun(
      upsertTaskRun(createTaskState(), run),
      run.id,
      101,
    );
    const stopped = stopTaskRunInState(
      upsertTaskRun(createTaskState(), run),
      run.id,
    );

    expect(finished.runs[0]).toMatchObject({
      status: "Exited",
      exit_code: 101,
    });
    expect(stopped.runs[0]).toMatchObject({
      status: "Stopped",
      exit_code: null,
    });
  });

  test("selects the active run for rerun before falling back to last run", () => {
    const first = runningRun({ id: "w:task-1", label: "bun test" });
    const second = runningRun({ id: "w:task-2", label: "bun build" });

    const state = activateTaskRun(
      upsertTaskRun(upsertTaskRun(createTaskState(), first), second),
      first.id,
    );

    expect(rerunnableTaskForState(state)).toMatchObject({
      label: "bun test",
      command: "bun test",
    });
  });

  test("restored history orders newest first and reruns the latest run", () => {
    const state = replaceTaskRuns(createTaskState(), [
      runningRun({
        id: "w:task-1",
        label: "old",
        command: "bun old",
        status: "Exited",
      }),
      runningRun({
        id: "w:task-2",
        label: "latest",
        command: "bun latest",
        status: "Exited",
      }),
    ]);

    expect(state.runs.map((run) => run.id)).toEqual(["w:task-2", "w:task-1"]);
    expect(state.activeRunId).toBe("w:task-2");
    expect(rerunnableTaskForState(state)).toMatchObject({
      label: "latest",
      command: "bun latest",
    });
  });

  test("restored history sorts numeric suffixes and running runs first", () => {
    const state = replaceTaskRuns(createTaskState(), [
      runningRun({
        id: "w:task-9",
        label: "running older",
        command: "bun dev",
        status: "Running",
      }),
      runningRun({
        id: "w:task-10",
        label: "exited latest",
        command: "bun build",
        status: "Exited",
      }),
    ]);

    expect(state.runs.map((run) => run.id)).toEqual(["w:task-9", "w:task-10"]);
    expect(state.activeRunId).toBe("w:task-9");
    expect(rerunnableTaskForState(state)).toMatchObject({
      label: "running older",
      command: "bun dev",
    });
  });

  test("task errors are scoped by workspace", () => {
    const errors = setTaskErrorForWorkspace(
      setTaskErrorForWorkspace({}, "workspace-a", "Run failed"),
      "workspace-b",
      "History failed",
    );
    const cleared = setTaskErrorForWorkspace(errors, "workspace-b", null);

    expect(taskErrorForWorkspace(errors, "workspace-a")).toBe("Run failed");
    expect(taskErrorForWorkspace(errors, "workspace-b")).toBe("History failed");
    expect(taskErrorForWorkspace(errors, null)).toBeNull();
    expect(taskErrorForWorkspace(cleared, "workspace-a")).toBe("Run failed");
    expect(taskErrorForWorkspace(cleared, "workspace-b")).toBeNull();
  });

  test("tracks selected context pack for an active task run", () => {
    const run = runningRun({
      id: "workspace:task-1",
      workspace_id: "workspace",
      label: "build",
      command: "bun run build",
      cwd: "/workspace",
    });
    const state = upsertTaskRun(createTaskState(), run);

    const linked = linkTaskRunContextPack(state, run.id, "pack-1");
    const missing = linkTaskRunContextPack(linked, "missing:task-1", "pack-2");

    expect(linked.contextPackByRunId[run.id]).toBe("pack-1");
    expect(missing.contextPackByRunId).toEqual(linked.contextPackByRunId);
  });

  test("restored task history preserves context pack links for restored runs", () => {
    const first = runningRun({
      id: "workspace:task-1",
      workspace_id: "workspace",
    });
    const second = runningRun({
      id: "workspace:task-2",
      workspace_id: "workspace",
    });
    const linked = linkTaskRunContextPack(
      upsertTaskRun(upsertTaskRun(createTaskState(), first), second),
      first.id,
      "pack-1",
    );

    const restored = replaceTaskRuns(linked, [first]);

    expect(restored.contextPackByRunId).toEqual({
      [first.id]: "pack-1",
    });
  });

  test("hydrates restored task context pack links from persisted metadata", () => {
    const restored = replaceTaskRuns(createTaskState(), [
      runningRun({
        id: "workspace:task-1",
        workspace_id: "workspace",
      }),
      runningRun({
        id: "workspace:task-2",
        workspace_id: "workspace",
      }),
    ]);

    const hydrated = hydrateTaskRunContextPacks(restored, {
      "workspace:task-1": "pack-1",
      "workspace:task-missing": "pack-missing",
    });

    expect(hydrated.contextPackByRunId).toEqual({
      "workspace:task-1": "pack-1",
    });
  });

  test("hydrated context pack links preserve local links for restored runs", () => {
    const restored = replaceTaskRuns(createTaskState(), [
      runningRun({
        id: "workspace:task-1",
        workspace_id: "workspace",
      }),
      runningRun({
        id: "workspace:task-2",
        workspace_id: "workspace",
      }),
    ]);
    const locallyLinked = linkTaskRunContextPack(
      restored,
      "workspace:task-2",
      "local-pack",
    );

    const hydrated = hydrateTaskRunContextPacks(locallyLinked, {
      "workspace:task-1": "persisted-pack",
    });

    expect(hydrated.contextPackByRunId).toEqual({
      "workspace:task-1": "persisted-pack",
      "workspace:task-2": "local-pack",
    });
  });

  test("replaces task context pack links from persisted metadata", () => {
    const restored = replaceTaskRuns(createTaskState(), [
      runningRun({
        id: "workspace:task-1",
        workspace_id: "workspace",
      }),
      runningRun({
        id: "workspace:task-2",
        workspace_id: "workspace",
      }),
    ]);
    const locallyLinked = linkTaskRunContextPack(
      linkTaskRunContextPack(restored, "workspace:task-1", "deleted-pack"),
      "workspace:task-2",
      "kept-pack",
    );

    const replaced = replaceTaskRunContextPacks(locallyLinked, {
      "workspace:task-2": "kept-pack",
    });

    expect(replaced.contextPackByRunId).toEqual({
      "workspace:task-2": "kept-pack",
    });
  });

  test("workspace task defaults freeze context pack metadata", () => {
    const store = createWorkspaceViewStore();
    const unknownView = store.getState().viewFor("unknown");

    expect(() => {
      unknownView.task.contextPackByRunId["unknown:task-1"] = "pack-1";
    }).toThrow(TypeError);

    expect(store.getState().viewFor("other-unknown").task).toMatchObject({
      contextPackByRunId: {},
    });
  });
});
