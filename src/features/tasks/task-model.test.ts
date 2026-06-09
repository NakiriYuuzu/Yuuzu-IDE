/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  activateTaskRun,
  appendTaskOutput,
  createTaskState,
  finishTaskRun,
  replaceDetectedTasks,
  rerunnableTaskForState,
  setCustomCommand,
  stopTaskRunInState,
  upsertTaskRun,
} from "./task-model";
import type { TaskRun } from "./task-model";

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
});
