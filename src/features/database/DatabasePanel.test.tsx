/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { ensureTestDom } from "../../app/test-dom";
import {
  createDatabaseState,
  type DatabaseProfile,
  type DatabaseSchema,
  storeDatabaseSchema,
  replaceDatabaseProfiles,
} from "./database-model";
import { DatabasePanel } from "./DatabasePanel";

ensureTestDom();

const { cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);

afterEach(() => {
  cleanup();
});

describe("DatabasePanel", () => {
  test("renders profile rows, table list, and query controls", () => {
    const onRunQuery = mock(() => {});
    const state = storeDatabaseSchema(
      replaceDatabaseProfiles(createDatabaseState(), [profile("local")]),
      {
        profile_id: "local",
        refreshed_ms: 1,
        tables: [{ schema: null, name: "users", row_count: 2, columns: [] }],
      } as DatabaseSchema,
    );

    const view = render(
      <DatabasePanel
        state={{ ...state, queryDraft: "SELECT * FROM users" }}
        onRefreshProfiles={() => {}}
        onSelectProfile={() => {}}
        onInspectSchema={() => {}}
        onOpenTable={() => {}}
        onQueryDraftChange={() => {}}
        onRunQuery={onRunQuery}
        onConfirmQuery={() => {}}
        onCancelConfirmation={() => {}}
        onExportResult={() => {}}
        onSelectHistory={() => {}}
      />,
    );

    expect(view.getByText("local.db")).toBeTruthy();
    expect(view.getByRole("button", { name: "Open table users" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Run query" }));
    expect(onRunQuery).toHaveBeenCalled();
  });

  test("shows explicit confirmation text for mutating SQL", () => {
    const view = render(
      <DatabasePanel
        state={{
          ...createDatabaseState(),
          queryDraft: "DROP TABLE users",
          confirmation: {
            confirmationText: "RUN DESTRUCTIVE SQL",
            reason: "destructive or unknown SQL requires explicit confirmation",
            input: "",
          },
        }}
        onRefreshProfiles={() => {}}
        onSelectProfile={() => {}}
        onInspectSchema={() => {}}
        onOpenTable={() => {}}
        onQueryDraftChange={() => {}}
        onRunQuery={() => {}}
        onConfirmQuery={() => {}}
        onCancelConfirmation={() => {}}
        onExportResult={() => {}}
        onSelectHistory={() => {}}
      />,
    );

    expect(view.getByText("RUN DESTRUCTIVE SQL")).toBeTruthy();
    expect(
      (view.getByRole("button", { name: "Run confirmed SQL" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

function profile(id: string): DatabaseProfile {
  return {
    id,
    workspace_root: "/repo",
    name: `${id}.db`,
    kind: "SQLite",
    source: { SQLite: { path: "/repo/local.db" } },
    read_only: false,
    production: false,
    created_ms: 1,
    updated_ms: 1,
  };
}
