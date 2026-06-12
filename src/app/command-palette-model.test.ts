/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  filterCommands,
  node1Commands,
  allCommands,
  node8Commands,
  node5Commands,
  node6Commands,
  node7Commands,
  node9Commands,
  node10Commands,
  node11Commands,
  node12Commands,
  node13Commands,
} from "./command-palette-model";

describe("filterCommands", () => {
  test("filters commands by label and group", () => {
    expect(filterCommands(node1Commands, "work").map((item) => item.id)).toEqual([
      "open-workspace",
      "switch-workspace",
      "search-workspace",
    ]);
  });

  test("returns all commands for empty query", () => {
    expect(filterCommands(node1Commands, "")).toHaveLength(node1Commands.length);
  });

  test("includes node 2 file commands", () => {
    expect(node1Commands.map((item) => item.id)).toContain("save-file");
    expect(node1Commands.map((item) => item.id)).toContain("find-in-file");
    expect(node1Commands.map((item) => item.id)).toContain("search-workspace");
  });

  test("includes node 3 terminal and task commands", () => {
    expect(node1Commands.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "new-terminal",
        "run-task",
        "rerun-task",
        "stop-task",
      ]),
    );
  });

  test("includes node 5 docs commands", () => {
    expect(node5Commands).toEqual([
      { id: "open-docs", label: "Docs: Open docs panel", group: "Docs" },
      { id: "refresh-docs-index", label: "Docs: Refresh index", group: "Docs" },
      {
        id: "create-context-pack",
        label: "Docs: Create context pack",
        group: "Docs",
      },
    ]);
  });

  test("includes node 7 agent commands", () => {
    expect(node7Commands).toEqual([
      {
        id: "open-agents",
        label: "Agents: Open workbench",
        group: "Agents",
      },
      {
        id: "agent-start-session",
        label: "Agents: Start session",
        group: "Agents",
      },
      {
        id: "agent-export-prompt",
        label: "Agents: Export prompt",
        group: "Agents",
      },
    ]);
    expect(allCommands).toContainEqual({
      id: "open-agents",
      label: "Agents: Open workbench",
      group: "Agents",
    });
    expect(allCommands).toContainEqual({
      id: "agent-start-session",
      label: "Agents: Start session",
      group: "Agents",
    });
    expect(allCommands).toContainEqual({
      id: "agent-export-prompt",
      label: "Agents: Export prompt",
      group: "Agents",
    });
  });

  test("filters agent commands", () => {
    const filtered = filterCommands(allCommands, "agent");
    const ids = filtered.map((command) => command.id);

    expect(ids).toContain("open-agents");
    expect(ids).toContain("agent-start-session");
    expect(ids).toContain("agent-export-prompt");
  });

  test("includes language commands in palette", () => {
    expect(node6Commands).toEqual([
      { id: "open-language", label: "Language: Open diagnostics", group: "Language" },
      {
        id: "language-refresh",
        label: "Language: Refresh diagnostics",
        group: "Language",
      },
      {
        id: "language-restart",
        label: "Language: Restart active server",
        group: "Language",
      },
    ]);
    expect(allCommands.map((command) => command.id)).toContain("open-language");
    expect(allCommands.map((command) => command.id)).toContain(
      "language-refresh",
    );
    expect(allCommands.map((command) => command.id)).toContain(
      "language-restart",
    );
  });

  test("includes browser commands in palette", () => {
    expect(node8Commands).toEqual([
      { id: "open-browser-preview", label: "Browser: Open preview", group: "Browser" },
      {
        id: "browser-reload",
        label: "Browser: Reload preview",
        group: "Browser",
      },
      {
        id: "browser-hard-reload",
        label: "Browser: Hard reload preview",
        group: "Browser",
      },
      {
        id: "browser-capture-screenshot",
        label: "Browser: Capture screenshot",
        group: "Browser",
      },
    ]);
    expect(allCommands).toContainEqual({
      id: "open-browser-preview",
      label: "Browser: Open preview",
      group: "Browser",
    });
    expect(allCommands).toContainEqual({
      id: "browser-reload",
      label: "Browser: Reload preview",
      group: "Browser",
    });
  });

  test("searches browser commands", () => {
    const filtered = filterCommands(allCommands, "browser");
    const ids = filtered.map((command) => command.id);

    expect(ids).toContain("open-browser-preview");
    expect(ids).toContain("browser-reload");
    expect(ids).toContain("browser-hard-reload");
    expect(ids).toContain("browser-capture-screenshot");
  });

  test("includes database commands in palette", () => {
    expect(node9Commands).toEqual([
      {
        id: "open-database",
        label: "Database: Open panel",
        group: "Database",
      },
      {
        id: "database-refresh",
        label: "Database: Refresh profiles",
        group: "Database",
      },
    ]);
    expect(allCommands).toContainEqual({
      id: "open-database",
      label: "Database: Open panel",
      group: "Database",
    });
    expect(allCommands).toContainEqual({
      id: "database-refresh",
      label: "Database: Refresh profiles",
      group: "Database",
    });
  });

  test("searches database commands", () => {
    const filtered = filterCommands(allCommands, "database");
    const ids = filtered.map((command) => command.id);

    expect(ids).toContain("open-database");
    expect(ids).toContain("database-refresh");
  });

  test("includes remote commands in palette", () => {
    expect(node10Commands).toEqual([
      { id: "open-remote", label: "Remote: Open panel", group: "Remote" },
      { id: "remote-connect", label: "Remote: Connect active host", group: "Remote" },
      { id: "remote-open-ssh", label: "Remote: Open SSH terminal", group: "Remote" },
      { id: "remote-open-sftp", label: "Remote: Open SFTP browser", group: "Remote" },
    ]);
    expect(allCommands.map((command) => command.id)).toEqual(
      expect.arrayContaining([
        "open-remote",
        "remote-connect",
        "remote-open-ssh",
        "remote-open-sftp",
      ]),
    );
  });

  test("includes node 11 debug commands in palette", () => {
    expect(node11Commands).toEqual([
      {
        id: "open-debug",
        label: "Debug: Open panel",
        group: "Debug",
        description: "Open the debug workbench panel",
      },
      {
        id: "debug-start-session",
        label: "Debug: Start session",
        group: "Debug",
        description: "Start the selected launch configuration",
      },
      {
        id: "debug-continue",
        label: "Debug: Continue",
        group: "Debug",
        description: "Continue the active debug session",
      },
      {
        id: "debug-step-over",
        label: "Debug: Step over",
        group: "Debug",
        description: "Step over in the active debug session",
      },
      {
        id: "debug-pause",
        label: "Debug: Pause",
        group: "Debug",
        description: "Pause the active debug session",
      },
      {
        id: "debug-disconnect",
        label: "Debug: Disconnect",
        group: "Debug",
        description: "Disconnect the active debug session",
      },
      {
        id: "debug-toggle-breakpoint",
        label: "Debug: Toggle breakpoint",
        group: "Debug",
        description: "Toggle a breakpoint in the active editor",
      },
    ]);
    expect(allCommands.map((command) => command.id)).toEqual(
      expect.arrayContaining([
        "open-debug",
        "debug-start-session",
        "debug-continue",
        "debug-step-over",
        "debug-pause",
        "debug-disconnect",
        "debug-toggle-breakpoint",
      ]),
    );
  });

  test("searches debug commands by group, label, and description", () => {
    const byGroup = filterCommands(allCommands, "debug").map(
      (command) => command.id,
    );
    const byLabel = filterCommands(allCommands, "step").map(
      (command) => command.id,
    );
    const byDescription = filterCommands(allCommands, "launch configuration").map(
      (command) => command.id,
    );

    expect(byGroup).toContain("debug-start-session");
    expect(byLabel).toContain("debug-step-over");
    expect(byDescription).toContain("debug-start-session");
  });

  test("includes node 12 extension commands in palette", () => {
    expect(node12Commands).toEqual([
      {
        id: "open-extensions",
        label: "Extensions: Open panel",
        group: "Extensions",
        description: "Open the extension registry panel",
      },
      {
        id: "extension-refresh",
        label: "Extensions: Refresh",
        group: "Extensions",
        description: "Refresh workspace extension status",
      },
    ]);
    expect(allCommands.map((command) => command.id)).toEqual(
      expect.arrayContaining(["open-extensions", "extension-refresh"]),
    );
  });

  test("searches extension commands", () => {
    const filtered = filterCommands(allCommands, "extensions");
    const ids = filtered.map((command) => command.id);

    expect(ids).toContain("open-extensions");
    expect(ids).toContain("extension-refresh");
  });

  test("includes node 13 diagnostics and settings commands in palette", () => {
    expect(node13Commands).toEqual([
      {
        id: "open-diagnostics",
        label: "Diagnostics: Open panel",
        group: "Settings",
        description: "Open Settings diagnostics",
      },
      {
        id: "refresh-diagnostics",
        label: "Diagnostics: Refresh metrics",
        group: "Settings",
        description: "Refresh diagnostics metrics and logs",
      },
      {
        id: "open-recovery",
        label: "Recovery: Open backups",
        group: "Settings",
        description: "Open Settings recovery backups",
      },
      {
        id: "import-keybindings",
        label: "Keybindings: Import",
        group: "Settings",
        description: "Open keybinding import settings",
      },
    ]);
    expect(allCommands.map((command) => command.id)).toEqual(
      expect.arrayContaining([
        "open-diagnostics",
        "refresh-diagnostics",
        "open-recovery",
        "import-keybindings",
      ]),
    );
  });

  test("searches node 13 commands by settings group and diagnostics label", () => {
    const byGroup = filterCommands(allCommands, "settings").map(
      (command) => command.id,
    );
    const byLabel = filterCommands(allCommands, "diagnostics").map(
      (command) => command.id,
    );

    expect(byGroup).toEqual(
      expect.arrayContaining([
        "open-diagnostics",
        "refresh-diagnostics",
        "open-recovery",
        "import-keybindings",
      ]),
    );
    expect(byLabel).toEqual(
      expect.arrayContaining(["open-diagnostics", "refresh-diagnostics"]),
    );
  });
});
