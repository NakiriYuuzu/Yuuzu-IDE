/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { ensureTestDom } from "../../test/test-dom";
import { RecoveryPanel } from "./RecoveryPanel";
import {
  createRecoveryState,
  type UnsavedBackupSummary,
} from "./recovery-model";

ensureTestDom();

afterEach(() => {
  cleanup();
});

function backup(
  overrides: Partial<UnsavedBackupSummary> = {},
): UnsavedBackupSummary {
  return {
    id: overrides.id ?? "b1",
    workspace_id: overrides.workspace_id ?? "workspace-a",
    workspace_root: overrides.workspace_root ?? "/repo-a",
    path: overrides.path ?? "src/main.ts",
    version: overrides.version ?? null,
    updated_ms: overrides.updated_ms ?? 10,
    content_length: overrides.content_length ?? "dirty text".length,
  };
}

describe("RecoveryPanel", () => {
  test("renders backup rows", () => {
    const result = render(
      <RecoveryPanel
        state={{
          ...createRecoveryState(),
          backups: [backup({ path: "src/main.ts" })],
          selectedBackupId: "b1",
        }}
        onRefresh={() => {}}
        onRestore={() => {}}
        onDiscard={() => {}}
      />,
    );

    expect(result.getByText("src/main.ts")).toBeTruthy();
  });

  test("Restore button aria-label calls onRestore with backup id", () => {
    const onRestore = mock<(id: string) => void>(() => {});
    const result = render(
      <RecoveryPanel
        state={{
          ...createRecoveryState(),
          backups: [backup({ id: "b1", path: "src/main.ts" })],
          selectedBackupId: "b1",
        }}
        onRefresh={() => {}}
        onRestore={onRestore}
        onDiscard={() => {}}
      />,
    );

    fireEvent.click(result.getByRole("button", { name: "Restore src/main.ts" }));

    expect(onRestore).toHaveBeenCalledWith("b1");
  });

  test("Discard button aria-label calls onDiscard with backup id", () => {
    const onDiscard = mock<(id: string) => void>(() => {});
    const result = render(
      <RecoveryPanel
        state={{
          ...createRecoveryState(),
          backups: [backup({ id: "b1", path: "src/main.ts" })],
          selectedBackupId: "b1",
        }}
        onRefresh={() => {}}
        onRestore={() => {}}
        onDiscard={onDiscard}
      />,
    );

    fireEvent.click(
      result.getByRole("button", { name: "Discard src/main.ts backup" }),
    );

    expect(onDiscard).toHaveBeenCalledWith("b1");
  });
});
