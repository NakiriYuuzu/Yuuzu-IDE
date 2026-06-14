/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { ensureTestDom } from "../../test/test-dom";
import type { GitBlameFile } from "./git-model";
import { GitBlameGutter } from "./GitBlameGutter";

ensureTestDom();

const { cleanup, fireEvent, render } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
});

const blame: GitBlameFile = {
  path: "src/a.ts",
  segments: [
    {
      hash: "a".repeat(40),
      short_hash: "aaaaaaa",
      author: "mina",
      when_unix: 1_700_000_000,
      line_start: 1,
      line_count: 3,
    },
    {
      hash: "b".repeat(40),
      short_hash: "bbbbbbb",
      author: "rin",
      when_unix: 1_700_050_000,
      line_start: 4,
      line_count: 1,
    },
  ],
  truncated: false,
};

describe("GitBlameGutter", () => {
  test("renders one row per segment sized by line count", () => {
    const onHoverSegment = mock(() => {});
    const onOpenInLog = mock(() => {});
    const result = render(
      <GitBlameGutter
        blame={blame}
        lineHeight={20}
        onHoverSegment={onHoverSegment}
        onOpenInLog={onOpenInLog}
      />,
    );

    const rows = result.container.querySelectorAll(".brow");
    expect(rows.length).toBe(2);
    expect((rows[0] as HTMLElement).style.height).toBe("60px");
    expect((rows[1] as HTMLElement).style.height).toBe("20px");

    fireEvent.mouseEnter(rows[0] as Element);
    expect(onHoverSegment).toHaveBeenCalledWith("a".repeat(40));

    fireEvent.click(rows[1] as Element);
    expect(onOpenInLog).toHaveBeenCalledWith("b".repeat(40));
  });
});
