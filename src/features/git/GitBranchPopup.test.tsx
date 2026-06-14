/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { ensureTestDom } from "../../test/test-dom";
import type { GitBranchFull, GitStashEntry } from "./git-model";
import { GitBranchPopup } from "./GitBranchPopup";

ensureTestDom();

const { cleanup, fireEvent, render } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
});

const branches: GitBranchFull[] = [
  {
    name: "main",
    current: true,
    remote: false,
    upstream: "origin/main",
    ahead: 2,
    behind: 0,
    head_short: "abc1111",
  },
  {
    name: "feat/log",
    current: false,
    remote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    head_short: "abc2222",
  },
  {
    name: "origin/main",
    current: false,
    remote: true,
    upstream: null,
    ahead: 0,
    behind: 0,
    head_short: "abc1111",
  },
];

const stashes: GitStashEntry[] = [
  { index: 0, message: "On main: wip-1", when_unix: 1_700_000_000 },
];

function renderPopup(overrides: Record<string, unknown> = {}) {
  const handlers = {
    onClose: mock(() => {}),
    onCheckoutBranch: mock(() => {}),
    onNewBranch: mock(() => {}),
    onMergeBranch: mock(() => {}),
    onRenameBranch: mock(() => {}),
    onDeleteBranch: mock(() => {}),
    onToggleFavorite: mock(() => {}),
    onStashApply: mock(() => {}),
    onStashPop: mock(() => {}),
    onStashBranch: mock(() => {}),
    onStashDrop: mock(() => {}),
    ...overrides,
  };
  const result = render(
    <GitBranchPopup
      branches={branches}
      stashes={stashes}
      favoriteBranches={["feat/log"]}
      {...handlers}
    />,
  );
  return { result, handlers };
}

describe("GitBranchPopup", () => {
  test("renders local and remote groups with current branch highlighted", () => {
    const { result } = renderPopup();
    expect(result.getByText("Local")).toBeTruthy();
    expect(result.getByText("Remote")).toBeTruthy();
    const current = result.container.querySelector(".branch-row.current");
    expect(current?.textContent).toContain("main");
  });

  test("search input filters branch rows", () => {
    const { result } = renderPopup();
    const search = result.getByPlaceholderText(/search branches/i);
    fireEvent.change(search, { target: { value: "feat" } });
    expect(result.queryByText("origin/main")).toBeNull();
    expect(result.getByText("feat/log")).toBeTruthy();
  });

  test("clicking a branch row reveals actions and delete reports the name", () => {
    const { result, handlers } = renderPopup();
    fireEvent.click(result.getByText("feat/log"));
    fireEvent.click(result.getByText("Delete…"));
    expect(handlers.onDeleteBranch).toHaveBeenCalledWith("feat/log");

    fireEvent.click(result.getByText("Merge into current"));
    expect(handlers.onMergeBranch).toHaveBeenCalledWith("feat/log");
  });

  test("favorite star toggles by branch name", () => {
    const { result, handlers } = renderPopup();
    const stars = result.container.querySelectorAll(".branch-fav");
    fireEvent.click(stars[0] as Element);
    expect(handlers.onToggleFavorite).toHaveBeenCalled();
  });

  test("stash section lists entries with actions", () => {
    const { result, handlers } = renderPopup();
    expect(result.getByText("On main: wip-1")).toBeTruthy();

    fireEvent.click(result.getByText("Apply"));
    expect(handlers.onStashApply).toHaveBeenCalledWith(0);

    fireEvent.click(result.getByText("Pop"));
    expect(handlers.onStashPop).toHaveBeenCalledWith(0);

    fireEvent.click(result.getByText("Branch…"));
    expect(handlers.onStashBranch).toHaveBeenCalledWith(0);

    fireEvent.click(result.getByText("Drop…"));
    expect(handlers.onStashDrop).toHaveBeenCalledWith(0);
  });
});
