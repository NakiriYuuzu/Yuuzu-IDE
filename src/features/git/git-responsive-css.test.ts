import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

describe("git responsive CSS", () => {
  test("keeps Git diff and graph surfaces bounded on narrow screens", () => {
    const mobileCssStart = css.indexOf("@media (max-width: 760px)");
    const mobileCss = css.slice(mobileCssStart);
    const mobileToolbarRule = mobileCss.match(
      /\n  \.git-diff-toolbar,\n  \.git-graph-toolbar,\n  \.markdown-toolbar \{(?<body>[\s\S]*?)\n  \}/,
    )?.groups?.body;

    expect(mobileCssStart).toBeGreaterThanOrEqual(0);
    expect(mobileToolbarRule).toContain("flex: 0 1 auto;");
    expect(mobileToolbarRule).toContain("flex-wrap: wrap;");
    expect(css).toContain(".git-graph-table-wrap");
    expect(css).toContain("max-width: 100%;");
  });
});
