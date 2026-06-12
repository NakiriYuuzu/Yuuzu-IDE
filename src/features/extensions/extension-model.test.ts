/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  createExtensionState,
  extensionBadgeCount,
  extensionCommands,
  replaceExtensionStatuses,
  setExtensionLoading,
  slowExtensionStatuses,
  toggleExtensionStatus,
  type ExtensionWorkspaceStatus,
} from "./extension-model";

function status(
  id: string,
  enabled: boolean,
  slowOperationCount = 0,
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
        themes: [],
        keybindings: [],
        snippets: [],
        workspace_hooks: [],
      },
    },
    enabled,
    disabled_by_workspace: !enabled,
    performance: {
      last_duration_ms: slowOperationCount > 0 ? 90 : 10,
      slow_operation_count: slowOperationCount,
      sample_count: slowOperationCount > 0 ? 3 : 1,
      class: slowOperationCount > 0 ? "Slow" : "Ok",
    },
  };
}

describe("extension model", () => {
  test("stores statuses and active extension without mutating caller data", () => {
    const statuses = [status("yuuzu.core", true), status("yuuzu.debug-tools", false)];
    const state = replaceExtensionStatuses(createExtensionState(), statuses);
    statuses[0].manifest.name = "mutated";

    expect(state.statuses[0].manifest.name).toBe("Yuuzu Core");
    expect(state.activeExtensionId).toBe("yuuzu.core");
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  test("filters command contributions for enabled extensions only", () => {
    const state = replaceExtensionStatuses(createExtensionState(), [
      status("yuuzu.core", true),
      status("yuuzu.debug-tools", false),
    ]);

    expect(extensionCommands(state).map((command) => command.id)).toEqual([
      "yuuzu.core.command",
    ]);
  });

  test("reports slow extension badge count", () => {
    const state = replaceExtensionStatuses(createExtensionState(), [
      status("yuuzu.core", true),
      status("yuuzu.debug-tools", true, 2),
    ]);

    expect(slowExtensionStatuses(state).map((item) => item.manifest.id)).toEqual([
      "yuuzu.debug-tools",
    ]);
    expect(extensionBadgeCount(state)).toBe("1");
  });

  test("toggle status updates only the matching extension", () => {
    const state = replaceExtensionStatuses(createExtensionState(), [
      status("yuuzu.core", true),
      status("yuuzu.debug-tools", true),
    ]);

    const next = toggleExtensionStatus(state, "yuuzu.debug-tools", false);

    expect(next.statuses.find((item) => item.manifest.id === "yuuzu.core")?.enabled).toBe(true);
    expect(next.statuses.find((item) => item.manifest.id === "yuuzu.debug-tools")?.enabled).toBe(false);
  });

  test("loading state clears previous errors", () => {
    const errored = { ...createExtensionState(), error: "failed" };

    expect(setExtensionLoading(errored)).toMatchObject({
      loading: true,
      error: null,
    });
  });
});
