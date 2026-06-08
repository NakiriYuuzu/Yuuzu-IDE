/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { initialEditorText } from "./editor-sample";

describe("initialEditorText", () => {
  test("returns the Node 0 TypeScript editor sample", () => {
    expect(initialEditorText()).toBe(
      [
        "export function hello() {",
        "  return 'Yuuzu-IDE Node 0'",
        "}",
      ].join("\n"),
    );
  });
});
