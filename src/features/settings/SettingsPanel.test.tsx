/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { ensureTestDom } from "../../app/test-dom";
import {
  createDiagnosticsState,
  storeMetricSnapshot,
} from "../diagnostics/diagnostics-model";
import { createRecoveryState } from "../recovery/recovery-model";
import { SettingsPanel } from "./SettingsPanel";
import {
  createSettingsState,
  selectSettingsCategory,
  storeSettings,
} from "./settings-model";

ensureTestDom();

afterEach(() => {
  cleanup();
});

function loadedSettingsState() {
  return storeSettings(createSettingsState(), {
    schema_version: 2,
    density: "compact",
    color_theme: "dark",
    accent_color: "yuzu",
    update_channel: "manual",
    keybindings: [],
  });
}

describe("SettingsPanel", () => {
  test("renders compact categories and selects keybindings", () => {
    const onSelectCategory = mock(() => {});
    const result = render(
      <SettingsPanel
        state={loadedSettingsState()}
        recoveryState={createRecoveryState()}
        diagnosticsState={createDiagnosticsState()}
        onSelectCategory={onSelectCategory}
        onRecoveryRefresh={() => {}}
        onRecoveryRestore={() => {}}
        onRecoveryDiscard={() => {}}
        onDiagnosticsRefresh={() => {}}
        onKeybindingImportDraftChange={() => {}}
        onImportKeybindings={() => {}}
      />,
    );

    for (const label of [
      "Recovery",
      "Performance",
      "Diagnostics",
      "Keybindings",
      "Updates",
      "Personal Setup",
    ]) {
      expect(result.getByRole("button", { name: label })).toBeTruthy();
    }

    fireEvent.click(result.getByRole("button", { name: "Keybindings" }));

    expect(onSelectCategory).toHaveBeenCalledWith("keybindings");
  });

  test("composes diagnostics panel for diagnostics category", () => {
    const diagnosticsState = storeMetricSnapshot(createDiagnosticsState(), {
      timestamp_ms: 1_700_000_000_000,
      process_id: 42,
      memory_bytes: 104_857_600,
      uptime_ms: 120_000,
      workspace_count: 2,
      active_workspace_id: "workspace-a",
      docs_index_entries: 17,
      file_tree_entries: 240,
    });
    const result = render(
      <SettingsPanel
        state={selectSettingsCategory(loadedSettingsState(), "diagnostics")}
        recoveryState={createRecoveryState()}
        diagnosticsState={diagnosticsState}
        onSelectCategory={() => {}}
        onRecoveryRefresh={() => {}}
        onRecoveryRestore={() => {}}
        onRecoveryDiscard={() => {}}
        onDiagnosticsRefresh={() => {}}
        onKeybindingImportDraftChange={() => {}}
        onImportKeybindings={() => {}}
      />,
    );

    expect(result.getAllByText("Performance").length).toBeGreaterThanOrEqual(1);
    expect(result.getByText("Logs")).toBeTruthy();
    expect(result.getByText("100.0 MB")).toBeTruthy();
  });

  test("composes recovery panel for recovery category", () => {
    const onRecoveryRestore = mock(() => {});
    const result = render(
      <SettingsPanel
        state={loadedSettingsState()}
        recoveryState={{
          ...createRecoveryState(),
          backups: [
            {
              id: "b1",
              workspace_id: "workspace-a",
              workspace_root: "/repo-a",
              path: "src/main.ts",
              version: null,
              updated_ms: 10,
              content_length: 10,
            },
          ],
          selectedBackupId: "b1",
        }}
        diagnosticsState={createDiagnosticsState()}
        onSelectCategory={() => {}}
        onRecoveryRefresh={() => {}}
        onRecoveryRestore={onRecoveryRestore}
        onRecoveryDiscard={() => {}}
        onDiagnosticsRefresh={() => {}}
        onKeybindingImportDraftChange={() => {}}
        onImportKeybindings={() => {}}
      />,
    );

    fireEvent.click(result.getByRole("button", { name: "Restore src/main.ts" }));

    expect(onRecoveryRestore).toHaveBeenCalledWith("b1");
  });

  test("keybindings category enables import when draft has content", () => {
    const onDraftChange = mock(() => {});
    const onImportKeybindings = mock(() => {});
    const result = render(
      <SettingsPanel
        state={{
          ...selectSettingsCategory(loadedSettingsState(), "keybindings"),
          keybindingImportDraft: "[{}]",
        }}
        recoveryState={createRecoveryState()}
        diagnosticsState={createDiagnosticsState()}
        onSelectCategory={() => {}}
        onRecoveryRefresh={() => {}}
        onRecoveryRestore={() => {}}
        onRecoveryDiscard={() => {}}
        onDiagnosticsRefresh={() => {}}
        onKeybindingImportDraftChange={onDraftChange}
        onImportKeybindings={onImportKeybindings}
      />,
    );

    fireEvent.input(result.getByLabelText("Paste keybindings JSON"), {
      target: { value: "[{\"key\":\"cmd+p\"}]" },
    });

    expect(onDraftChange).toHaveBeenCalledWith("[{\"key\":\"cmd+p\"}]");
    expect(
      (result.getByRole("button", {
        name: "Import keybindings",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(result.getByRole("button", { name: "Import keybindings" }));

    expect(onImportKeybindings).toHaveBeenCalledTimes(1);
  });

  test("keybindings category renders scoped import error", () => {
    const result = render(
      <SettingsPanel
        state={{
          ...selectSettingsCategory(loadedSettingsState(), "keybindings"),
          keybindingImportError: "Invalid VS Code keybindings JSON",
        }}
        recoveryState={createRecoveryState()}
        diagnosticsState={createDiagnosticsState()}
        onSelectCategory={() => {}}
        onRecoveryRefresh={() => {}}
        onRecoveryRestore={() => {}}
        onRecoveryDiscard={() => {}}
        onDiagnosticsRefresh={() => {}}
        onKeybindingImportDraftChange={() => {}}
        onImportKeybindings={() => {}}
      />,
    );

    expect(result.getByText("Invalid VS Code keybindings JSON")).toBeTruthy();
  });
});
