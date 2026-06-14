/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test";

import { ensureTestDom } from "../../test/test-dom";
import { DatabaseResultView } from "./DatabaseResultView";
import type { DatabaseQueryResult } from "./database-model";

ensureTestDom();

const { cleanup, render } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
});

describe("DatabaseResultView", () => {
  test("renders query result columns, rows, and kind badge", () => {
    const result: DatabaseQueryResult = {
      profile_id: "local",
      sql: "SELECT id, email FROM users",
      classification: {
        kind: "Read",
        requires_confirmation: false,
        confirmation_text: "",
        reason: "read-only statement",
      },
      columns: ["id", "email"],
      rows: [
        {
          cells: [
            { kind: "Text", display: "1" },
            { kind: "Text", display: "a@example.test" },
          ],
        },
      ],
      affected_rows: null,
      truncated: false,
      executed_ms: 8,
      history_id: "history-1",
    };

    const view = render(
      <DatabaseResultView result={result} loading={false} error={null} />,
    );

    expect(view.getByRole("columnheader", { name: "id" })).toBeTruthy();
    expect(view.getByText("a@example.test")).toBeTruthy();
    expect(view.getByText("Read")).toBeTruthy();
    expect(view.getByText("8ms")).toBeTruthy();
  });

  test("virtualizes a large result set in a stable scrolling container", () => {
    const result: DatabaseQueryResult = {
      profile_id: "local",
      sql: "SELECT id FROM users",
      classification: {
        kind: "Read",
        requires_confirmation: false,
        confirmation_text: "",
        reason: "read-only statement",
      },
      columns: ["id"],
      rows: Array.from({ length: 1000 }, (_, index) => ({
        cells: [{ kind: "Text", display: `id-${index}` }],
      })),
      affected_rows: null,
      truncated: false,
      executed_ms: 14,
      history_id: "history-1",
    };

    const view = render(
      <DatabaseResultView result={result} loading={false} error={null} />,
    );

    const table = view.getByRole("table");
    expect(table).toBeTruthy();
    expect(view.getByRole("columnheader", { name: "id" })).toBeTruthy();
    expect(view.getByText("id-0")).toBeTruthy();

    const scrollViewport = view.container.querySelector(".database-result-table-wrap");
    expect(scrollViewport).toBeTruthy();
    expect(scrollViewport?.getAttribute("style")).toContain("height: 220px");
  });
});
