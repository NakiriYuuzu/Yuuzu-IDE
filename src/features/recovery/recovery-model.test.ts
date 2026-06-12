/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  createRecoveryState,
  discardRecoveryBackup,
  restoreRecoveryBackup,
  storeRecoveryBackups,
  type UnsavedBackup,
} from "./recovery-model";

function backup(overrides: Partial<UnsavedBackup> = {}): UnsavedBackup {
  return {
    id: overrides.id ?? "b1",
    workspace_id: overrides.workspace_id ?? "workspace-a",
    workspace_root: overrides.workspace_root ?? "/repo-a",
    path: overrides.path ?? "src/main.ts",
    content: overrides.content ?? "dirty text",
    version: overrides.version ?? null,
    updated_ms: overrides.updated_ms ?? 10,
  };
}

describe("recovery model", () => {
  test("stores backups newest first and selects the first backup", () => {
    const state = storeRecoveryBackups(createRecoveryState(), [
      backup({ id: "old", updated_ms: 1 }),
      backup({ id: "new", updated_ms: 2 }),
    ]);

    expect(state.backups.map((item) => item.id)).toEqual(["new", "old"]);
    expect(state.selectedBackupId).toBe("new");
  });

  test("stores backup summaries without content in recovery state", () => {
    const state = storeRecoveryBackups(createRecoveryState(), [
      backup({ id: "b1", content: "dirty text" }),
    ]);

    expect(state.backups[0]).toMatchObject({
      id: "b1",
      content_length: "dirty text".length,
    });
    expect(
      Object.prototype.hasOwnProperty.call(state.backups[0], "content"),
    ).toBe(false);
  });

  test("restoreRecoveryBackup marks the restored backup for opening", () => {
    const state = restoreRecoveryBackup(
      storeRecoveryBackups(createRecoveryState(), [backup({ id: "b1" })]),
      "b1",
    );

    expect(state.restoringBackupId).toBe("b1");
  });

  test("discardRecoveryBackup removes selection and stale restore marker", () => {
    const state = discardRecoveryBackup(
      {
        ...storeRecoveryBackups(createRecoveryState(), [backup({ id: "b1" })]),
        restoringBackupId: "b1",
      },
      "b1",
    );

    expect(state.backups).toEqual([]);
    expect(state.selectedBackupId).toBeNull();
    expect(state.restoringBackupId).toBeNull();
  });
});
