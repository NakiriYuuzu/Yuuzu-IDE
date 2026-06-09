import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

describe("docs responsive CSS", () => {
  test("lets context pack rows wrap actions without hiding names", () => {
    const packRowRule = css.match(
      /\.docs-pack-row \{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body;
    const packActionsRule = css.match(
      /\.docs-pack-actions \{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body;

    expect(packRowRule).toContain("flex-wrap: wrap;");
    expect(packRowRule).toContain("white-space: normal;");
    expect(packActionsRule).toContain("flex: 1 1 100%;");
  });

  test("keeps markdown reference badges visible on narrow screens", () => {
    const mobileCssStart = css.indexOf("@media (max-width: 760px)");
    const mobileCss = css.slice(mobileCssStart);
    const markdownBadgeRule = mobileCss.match(
      /\n  \.markdown-preview \.badge2 \{(?<body>[\s\S]*?)\n  \}/,
    )?.groups?.body;

    expect(mobileCssStart).toBeGreaterThanOrEqual(0);
    expect(markdownBadgeRule).toContain("display: inline-flex;");
  });
});
