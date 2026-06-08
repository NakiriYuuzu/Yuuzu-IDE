/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { terminalLoadFailureCopy } from "./terminal-error";

describe("terminalLoadFailureCopy", () => {
  test("normalizes xterm load errors into compact terminal copy", () => {
    expect(terminalLoadFailureCopy(new Error("chunk unavailable"))).toEqual({
      title: "Terminal failed to load",
      detail: "chunk unavailable",
    });
  });
});
