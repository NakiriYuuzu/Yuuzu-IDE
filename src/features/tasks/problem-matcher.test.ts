/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { matchProblems } from "./problem-matcher";

describe("matchProblems", () => {
  test("matches rust compiler file line column errors", () => {
    expect(matchProblems("src/main.rs:12:5: error: expected `;`")).toEqual([
      {
        file: "src/main.rs",
        line: 12,
        column: 5,
        severity: "error",
        message: "expected `;`",
      },
    ]);
  });

  test("matches rust compiler warnings", () => {
    expect(
      matchProblems("src/lib.rs:3:9: warning: unused variable: `state`"),
    ).toEqual([
      {
        file: "src/lib.rs",
        line: 3,
        column: 9,
        severity: "warning",
        message: "unused variable: `state`",
      },
    ]);
  });

  test("matches typescript diagnostics", () => {
    expect(
      matchProblems("src/app.ts(4,7): error TS2322: Type mismatch"),
    ).toEqual([
      {
        file: "src/app.ts",
        line: 4,
        column: 7,
        severity: "error",
        message: "TS2322: Type mismatch",
      },
    ]);
  });

  test("caps matched problems", () => {
    const output = Array.from(
      { length: 120 },
      (_, index) => `src/app.ts(${index + 1},1): error TS2322: boom`,
    ).join("\n");

    expect(matchProblems(output)).toHaveLength(100);
  });
});
