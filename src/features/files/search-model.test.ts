/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  createSearchRequestIdentity,
  searchSummary,
  shouldApplySearchResult,
} from "./search-model";

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

describe("shouldApplySearchResult", () => {
  test("rejects results from an older query", () => {
    const request = createSearchRequestIdentity({
      requestId: 1,
      workspaceId: "workspace-a",
      workspacePath: "/work/a",
      query: "foo",
    });
    const current = createSearchRequestIdentity({
      requestId: 1,
      workspaceId: "workspace-a",
      workspacePath: "/work/a",
      query: "bar",
    });

    expect(shouldApplySearchResult(request, current)).toBe(false);
  });

  test("rejects results from an older workspace", () => {
    const request = createSearchRequestIdentity({
      requestId: 2,
      workspaceId: "workspace-a",
      workspacePath: "/work/a",
      query: "foo",
    });
    const current = createSearchRequestIdentity({
      requestId: 2,
      workspaceId: "workspace-b",
      workspacePath: "/work/b",
      query: "foo",
    });

    expect(shouldApplySearchResult(request, current)).toBe(false);
  });

  test("accepts results for the current query and workspace", () => {
    const request = createSearchRequestIdentity({
      requestId: 3,
      workspaceId: "workspace-a",
      workspacePath: "/work/a",
      query: " foo ",
    });
    const current = createSearchRequestIdentity({
      requestId: 3,
      workspaceId: "workspace-a",
      workspacePath: "/work/a",
      query: "foo",
    });

    expect(shouldApplySearchResult(request, current)).toBe(true);
  });
});
