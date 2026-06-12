/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  commandItemsForPalette,
  coreCommandContributions,
  extensionContributionsForPalette,
  registeredCoreCommandIds,
} from "./command-registry";
import type { ExtensionCommandContribution } from "../features/extensions/extension-model";

describe("command registry", () => {
  test("registers existing internal commands as core contributions", () => {
    expect(registeredCoreCommandIds()).toEqual(
      expect.arrayContaining([
        "open-editor",
        "open-terminal",
        "open-debug",
        "open-database",
        "open-remote",
        "open-extensions",
      ]),
    );
    expect(
      coreCommandContributions.every(
        (command) => command.owner_extension_id === "yuuzu.core",
      ),
    ).toBe(true);
  });

  test("maps enabled extension command contributions into palette items", () => {
    const extensionCommand: ExtensionCommandContribution = {
      id: "yuuzu.debug-tools.inspect-session",
      label: "Debug Tools: Inspect session",
      group: "Extensions",
      description: "Inspect the active debug session",
      owner_extension_id: "yuuzu.debug-tools",
    };

    expect(
      extensionContributionsForPalette([extensionCommand], new Set()).map(
        (item) => item.id,
      ),
    ).toEqual(["yuuzu.debug-tools.inspect-session"]);
    expect(
      extensionContributionsForPalette(
        [extensionCommand],
        new Set(["yuuzu.debug-tools"]),
      ),
    ).toEqual([]);
  });

  test("builds palette command list from core and extension contributions", () => {
    const extensionCommand: ExtensionCommandContribution = {
      id: "yuuzu.theme-yuzu.apply-dark",
      label: "Theme: Apply Yuzu Dark",
      group: "Theme",
      description: "Apply Yuzu Dark",
      owner_extension_id: "yuuzu.theme-yuzu",
    };

    const commands = commandItemsForPalette([extensionCommand], new Set());

    expect(commands.map((command) => command.id)).toContain("open-editor");
    expect(commands.map((command) => command.id)).toContain(
      "yuuzu.theme-yuzu.apply-dark",
    );
  });
});
