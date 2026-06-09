import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

describe("git responsive CSS", () => {
  test("keeps Git diff and graph surfaces bounded on narrow screens", () => {
    const mobileToolbarRule = css.match(
      /\.git-diff-toolbar,[^{]*\.git-graph-toolbar[^{]*\{(?<body>[\s\S]*?)\n  \}/,
    )?.groups?.body;

    expect(css).toContain("@media (max-width: 760px)");
    expect(mobileToolbarRule).toContain("flex: 0 1 auto;");
    expect(mobileToolbarRule).toContain("flex-wrap: wrap;");
    expect(css).toContain(".git-graph-table-wrap");
    expect(css).toContain("max-width: 100%;");
  });
});
