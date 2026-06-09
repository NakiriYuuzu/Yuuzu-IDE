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
});
