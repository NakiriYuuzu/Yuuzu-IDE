/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { searchSummary } from "./search-model";

describe("searchSummary", () => {
  test("counts filename and text hits", () => {
    expect(
      searchSummary({
        filename_matches: [{ path: "/w/src/main.ts", name: "main.ts" }],
        text_matches: [
          { path: "/w/src/lib.ts", hits: [{ line_number: 4, line: "main()" }] },
        ],
        truncated: false,
      }),
    ).toBe("2 matches in 2 files");
  });
});
