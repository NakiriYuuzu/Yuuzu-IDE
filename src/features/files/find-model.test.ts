/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { findInText } from "./find-model";

describe("findInText", () => {
  test("returns line and column matches", () => {
    expect(findInText("alpha\nbeta alpha\n", "alpha")).toEqual([
      { lineNumber: 1, column: 1, preview: "alpha" },
      { lineNumber: 2, column: 6, preview: "beta alpha" },
    ]);
  });

  test("returns no matches for empty query", () => {
    expect(findInText("alpha", "")).toEqual([]);
  });
});
