/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { ensureTestDom } from "../../test/test-dom";
import {
  createExtensionState,
  replaceExtensionStatuses,
  type ExtensionWorkspaceStatus,
} from "./extension-model";
import { ExtensionPanel } from "./ExtensionPanel";

ensureTestDom();

const { cleanup, fireEvent, render } = await import("@testing-library/react");

afterEach(() => cleanup());

function status(
  id: string,
  enabled: boolean,
  slow = false,
): ExtensionWorkspaceStatus {
  return {
    manifest: {
      id,
      name: id === "yuuzu.core" ? "Yuuzu Core" : "Debug Tools",
      version: "0.1.0",
      api_version: "0.1",
      description: "test extension",
      builtin: true,
      contributes: {
        commands: [{
          id: `${id}.command`,
          label: `${id} command`,
          group: "Extensions",
          description: "test command",
          owner_extension_id: id,
        }],
        themes: [{ id: "yuuzu-dark", label: "Yuzu Dark", mode: "dark", accent: "#a8e23f" }],
        keybindings: [{ command: `${id}.command`, key: "cmd+shift+x", when: "workspace" }],
        snippets: [{ id: "snippet", language: "typescript", prefix: "dbg", body: ["console.log($1);"], description: "Debug log" }],
        workspace_hooks: [{ id: "hook", event: "WorkspaceOpened", command: `${id}.command`, budget_ms: 75 }],
      },
    },
    enabled,
    disabled_by_workspace: !enabled,
    performance: {
      last_duration_ms: slow ? 92 : 12,
      slow_operation_count: slow ? 2 : 0,
      sample_count: slow ? 4 : 1,
      class: slow ? "Slow" : "Ok",
    },
  };
}

function pressEnterToActivateButton(button: HTMLElement): void {
  button.focus();
  const defaultAllowed = fireEvent.keyDown(button, {
    key: "Enter",
    code: "Enter",
    cancelable: true,
  });

  if (defaultAllowed) {
    fireEvent.click(button);
  }
}

describe("ExtensionPanel", () => {
  test("renders extension status, contributions, and slow budget", () => {
    const state = replaceExtensionStatuses(createExtensionState(), [
      status("yuuzu.core", true),
      status("yuuzu.debug-tools", true, true),
    ]);

    const result = render(
      <ExtensionPanel
        state={state}
        onRefresh={() => {}}
        onSelectExtension={() => {}}
        onToggleExtension={() => {}}
      />,
    );

    expect(result.getByText("Yuuzu Core")).toBeTruthy();
    expect(result.getByText("Debug Tools")).toBeTruthy();
    expect(result.getByText("Slow")).toBeTruthy();
    expect(result.getByText("Commands")).toBeTruthy();
    expect(result.getByText("Snippets")).toBeTruthy();
    expect(result.getByText("Workspace hooks")).toBeTruthy();
  });

  test("toggles extension enablement", () => {
    const onToggleExtension = mock(() => {});
    const state = replaceExtensionStatuses(createExtensionState(), [
      status("yuuzu.debug-tools", true),
    ]);

    const result = render(
      <ExtensionPanel
        state={state}
        onRefresh={() => {}}
        onSelectExtension={() => {}}
        onToggleExtension={onToggleExtension}
      />,
    );

    fireEvent.click(result.getByLabelText("Disable Debug Tools"));

    expect(onToggleExtension).toHaveBeenCalledWith("yuuzu.debug-tools", false);
  });

  test("keyboard activation toggles extension without selecting the row", () => {
    const onSelectExtension = mock(() => {});
    const onToggleExtension = mock(() => {});
    const state = replaceExtensionStatuses(createExtensionState(), [
      status("yuuzu.debug-tools", true),
    ]);

    const result = render(
      <ExtensionPanel
        state={state}
        onRefresh={() => {}}
        onSelectExtension={onSelectExtension}
        onToggleExtension={onToggleExtension}
      />,
    );

    pressEnterToActivateButton(result.getByLabelText("Disable Debug Tools"));

    expect(onToggleExtension).toHaveBeenCalledWith("yuuzu.debug-tools", false);
    expect(onSelectExtension).not.toHaveBeenCalled();
  });

  test("keyboard activation on the extension row selects the extension", () => {
    const onSelectExtension = mock(() => {});
    const state = replaceExtensionStatuses(createExtensionState(), [
      status("yuuzu.debug-tools", true),
    ]);

    const result = render(
      <ExtensionPanel
        state={state}
        onRefresh={() => {}}
        onSelectExtension={onSelectExtension}
        onToggleExtension={() => {}}
      />,
    );

    const row = result.getByLabelText("Select Debug Tools");
    row.focus();
    fireEvent.keyDown(row, {
      key: "Enter",
      code: "Enter",
    });

    expect(onSelectExtension).toHaveBeenCalledWith("yuuzu.debug-tools");
  });

  test("shows disabled workspace state", () => {
    const state = replaceExtensionStatuses(createExtensionState(), [
      status("yuuzu.debug-tools", false),
    ]);

    const result = render(
      <ExtensionPanel
        state={state}
        onRefresh={() => {}}
        onSelectExtension={() => {}}
        onToggleExtension={() => {}}
      />,
    );

    expect(result.getByText("Disabled")).toBeTruthy();
    expect(result.getByLabelText("Enable Debug Tools")).toBeTruthy();
  });
});
