/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { ensureTestDom } from "../../app/test-dom";
import {
  createDatabaseState,
  type DatabaseProfile,
  type DatabaseSchema,
  type DatabaseTable,
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

  test("preserves table schema identity and sends schema with table callback", () => {
    const onOpenTable = mock(() => {});
    const state = storeDatabaseSchema(
      replaceDatabaseProfiles(createDatabaseState(), [profile("local")]),
      {
        profile_id: "local",
        refreshed_ms: 1,
        tables: [
          { schema: "public", name: "users", row_count: 2, columns: [] },
          { schema: "audit", name: "users", row_count: 3, columns: [] },
        ],
      } as DatabaseSchema,
    );

    const view = render(
      <DatabasePanel
        state={{ ...state, queryDraft: "SELECT * FROM users" }}
        onRefreshProfiles={() => {}}
        onSelectProfile={() => {}}
        onInspectSchema={() => {}}
        onOpenTable={onOpenTable}
        onQueryDraftChange={() => {}}
        onRunQuery={() => {}}
        onConfirmQuery={() => {}}
        onCancelConfirmation={() => {}}
        onExportResult={() => {}}
        onSelectHistory={() => {}}
      />,
    );

    const publicUsers = view.getByRole("button", {
      name: "Open table public.users",
    });
    const auditUsers = view.getByRole("button", {
      name: "Open table audit.users",
    });

    expect(publicUsers).toBeTruthy();
    expect(auditUsers).toBeTruthy();
    expect(view.getByText("public.users")).toBeTruthy();
    expect(view.getByText("audit.users")).toBeTruthy();

    fireEvent.click(publicUsers);
    fireEvent.click(auditUsers);

    expect(onOpenTable).toHaveBeenCalledWith("local", {
      schema: "public",
      name: "users",
      row_count: 2,
      columns: [],
    } as DatabaseTable);
    expect(onOpenTable).toHaveBeenCalledWith("local", {
      schema: "audit",
      name: "users",
      row_count: 3,
      columns: [],
    } as DatabaseTable);
  });

  test("selecting a profile is keyboard-activatable", () => {
    const onSelectProfile = mock(() => {});
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
        onSelectProfile={onSelectProfile}
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

    const profileRow = view.getByRole("button", { name: "Select local.db" });
    fireEvent.keyDown(profileRow, { key: "Enter", code: "Enter" });

    expect(onSelectProfile).toHaveBeenCalledWith("local");
    expect(onSelectProfile).toHaveBeenCalledTimes(1);
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

  test("query action does not duplicate execute and render", () => {
    const onRunQuery = mock(() => {});
    const view = render(
      <DatabasePanel
        state={{
          ...createDatabaseState(),
          queryDraft: "SELECT * FROM users",
          profiles: [profile("local")],
          activeProfileId: "local",
        }}
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

    expect(view.getByRole("button", { name: "Run query" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Execute" })).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Run query" }));
    expect(onRunQuery).toHaveBeenCalledTimes(1);
  });

  test("database connection action is disabled until supported", () => {
    const view = render(
      <DatabasePanel
        state={{
          ...createDatabaseState(),
          profiles: [profile("local")],
          activeProfileId: "local",
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

    const newConnButton = view.getByRole("button", {
      name: "Create database connection (not available yet)",
    }) as HTMLButtonElement;
    expect(newConnButton.disabled).toBe(true);
  });

  test("does not enable run with surrounding whitespace in confirmation input", () => {
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

    const confirmationInput = view.getByRole("textbox", {
      name: "Confirmation text",
    }) as HTMLInputElement;
    fireEvent.change(confirmationInput, { target: { value: " RUN DESTRUCTIVE SQL " } });

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
