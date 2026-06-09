/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  filterCommands,
  node1Commands,
  node5Commands,
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
});
