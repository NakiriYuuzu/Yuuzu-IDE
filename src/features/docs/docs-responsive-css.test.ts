import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

describe("docs responsive CSS", () => {
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
