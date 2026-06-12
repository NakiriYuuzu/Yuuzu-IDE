/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { ensureTestDom } from "../../app/test-dom";
import type { GitConflictFile } from "./git-model";
import { GitConflictView } from "./GitConflictView";

ensureTestDom();

const { cleanup, fireEvent, render } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
});

const conflict: GitConflictFile = {
  path: "src/f.ts",
  base: "base\n",
  ours: "ours\n",
  theirs: "theirs\n",
  working:
    "<<<<<<< HEAD\nours line\n=======\ntheirs line\n>>>>>>> feat\nplain\n<<<<<<< HEAD\nours two\n=======\ntheirs two\n>>>>>>> feat\n",
  blocks: [
    { start_line: 1, ours: ["ours line"], theirs: ["theirs line"] },
    { start_line: 6, ours: ["ours two"], theirs: ["theirs two"] },
  ],
  truncated: false,
};

function renderView(overrides: Record<string, unknown> = {}) {
  const handlers = {
    onAcceptOurs: mock(() => {}),
    onAcceptTheirs: mock(() => {}),
    onResolveBlock: mock(() => {}),
    onAcceptAllOurs: mock(() => {}),
    onAcceptAllTheirs: mock(() => {}),
    onMarkResolved: mock(() => {}),
    ...overrides,
  };
  const result = render(
    <GitConflictView conflict={conflict} resolvedBlocks={[]} {...handlers} />,
  );
  return { result, handlers };
}

describe("GitConflictView", () => {
  test("renders three columns and one card per conflict block", () => {
    const { result } = renderView();
    const columns = result.container.querySelectorAll(".ccol");
    expect(columns.length).toBe(3);
    expect(result.getByText("Ours")).toBeTruthy();
    expect(result.getByText("Result")).toBeTruthy();
    expect(result.getByText("Theirs")).toBeTruthy();
    const blocks = result.container.querySelectorAll(".cblock");
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });

  test("per-block accept buttons report the block index", () => {
    const { result, handlers } = renderView();
    const acceptOurs = result.getAllByText("Accept Ours");
    fireEvent.click(acceptOurs[1] as Element);
    expect(handlers.onAcceptOurs).toHaveBeenCalledWith(1);

    const acceptTheirs = result.getAllByText("Accept Theirs");
    fireEvent.click(acceptTheirs[0] as Element);
    expect(handlers.onAcceptTheirs).toHaveBeenCalledWith(0);
  });

  test("toolbar counts remaining blocks and gates Mark Resolved", () => {
    const { result } = renderView();
    expect(result.getByText("2 of 2 remaining")).toBeTruthy();
    const markResolved = result.getByText("Mark Resolved") as HTMLButtonElement;
    expect(markResolved.disabled).toBe(true);

    cleanup();

    const handlers = {
      onAcceptOurs: mock(() => {}),
      onAcceptTheirs: mock(() => {}),
      onResolveBlock: mock(() => {}),
      onAcceptAllOurs: mock(() => {}),
      onAcceptAllTheirs: mock(() => {}),
      onMarkResolved: mock(() => {}),
    };
    const done = render(
      <GitConflictView
        conflict={conflict}
        resolvedBlocks={[0, 1]}
        {...handlers}
      />,
    );
    expect(done.getByText("0 of 2 remaining")).toBeTruthy();
    const ready = done.getByText("Mark Resolved") as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    fireEvent.click(ready);
    expect(handlers.onMarkResolved).toHaveBeenCalled();
  });

  test("accept all ours flows through its callback", () => {
    const { result, handlers } = renderView();
    fireEvent.click(result.getByText("Accept All Ours"));
    expect(handlers.onAcceptAllOurs).toHaveBeenCalled();
  });
});
