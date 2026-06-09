/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  MAX_DATABASE_ROWS,
  createDatabaseState,
  databaseBadgeCount,
  beginDatabaseQuery,
  type DatabaseQueryHistoryEntry,
  replaceDatabaseProfiles,
  requireDatabaseConfirmation,
  selectDatabaseProfile,
  storeDatabaseQueryResult,
  storeDatabaseSchema,
  updateDatabaseDraft,
  type DatabaseProfile,
  type DatabaseQueryResult,
} from "./database-model";

describe("database model", () => {
  test("stores profiles and selects the first profile", () => {
    const state = replaceDatabaseProfiles(createDatabaseState(), [
      profile("local", "SQLite"),
      profile("prod", "PostgreSQL"),
    ]);

    expect(state.activeProfileId).toBe("local");
    expect(state.profiles).toHaveLength(2);
    expect(databaseBadgeCount(state)).toBe("2");
  });

  test("keeps existing active profile when still present", () => {
    const base = selectDatabaseProfile(
      replaceDatabaseProfiles(createDatabaseState(), [
        profile("local", "SQLite"),
        profile("prod", "PostgreSQL"),
      ]),
      "prod",
    );

    const next = replaceDatabaseProfiles(base, [profile("prod", "PostgreSQL")]);

    expect(next.activeProfileId).toBe("prod");
  });

  test("schema is scoped by profile id", () => {
    const state = storeDatabaseSchema(createDatabaseState(), {
      profile_id: "local",
      refreshed_ms: 1,
      tables: [{ schema: null, name: "users", row_count: 2, columns: [] }],
    });

    expect(state.schemaByProfileId.local.tables[0].name).toBe("users");
  });

  test("stores only bounded profile table schema by latest profile id", () => {
    const state = storeDatabaseSchema(createDatabaseState(), {
      profile_id: "local",
      refreshed_ms: 1,
      tables: Array.from({ length: 3 }, (_, index) => ({
        schema: null,
        name: `table_${index}`,
        row_count: 1,
        columns: [],
      })),
    });

    expect(state.schemaByProfileId.local.tables).toHaveLength(3);
    expect(state.schemaByProfileId.local.tables[1].name).toBe("table_1");
  });

  test("mutating SQL stores confirmation requirement before running", () => {
    const state = requireDatabaseConfirmation(
      updateDatabaseDraft(createDatabaseState(), "DELETE FROM users"),
      {
        kind: "Destructive",
        requires_confirmation: true,
        confirmation_text: "RUN DESTRUCTIVE SQL",
        reason: "destructive or unknown SQL requires explicit confirmation",
      },
    );

    expect(state.confirmation?.confirmationText).toBe("RUN DESTRUCTIVE SQL");
    expect(state.confirmation?.reason).toBe(
      "destructive or unknown SQL requires explicit confirmation",
    );
    expect(state.confirmation?.input).toBe("");
  });

  test("query draft update clears prior confirmation", () => {
    const withConfirmation = requireDatabaseConfirmation(
      createDatabaseState(),
      {
        kind: "Mutation",
        requires_confirmation: true,
        confirmation_text: "RUN MUTATION",
        reason: "mutation statement",
      },
    );
    const next = updateDatabaseDraft(withConfirmation, "SELECT * FROM users");

    expect(next.confirmation).toBeNull();
    expect(next.queryDraft).toBe("SELECT * FROM users");
  });

  test("query result replaces loading state and enforces row cap", () => {
    const loading = beginDatabaseQuery(
      replaceDatabaseProfiles(createDatabaseState(), [profile("local", "SQLite")]),
    );
    const state = storeDatabaseQueryResult(loading, result("local", 600));

    expect(state.loading).toBe(false);
    expect(state.activeResult?.rows).toHaveLength(MAX_DATABASE_ROWS);
    expect(state.activeResult?.truncated).toBe(true);
    expect(state.confirmation).toBeNull();
  });

  test("selecting active profile resets active table", () => {
    const state = selectDatabaseProfile(
      {
        ...createDatabaseState(),
        profiles: [profile("prod", "PostgreSQL")],
        activeProfileId: "local",
        activeTable: "users",
      },
      "prod",
    );

    expect(state.activeProfileId).toBe("prod");
    expect(state.activeTable).toBeNull();
  });

  test("selecting active profile clears profile-scoped async state", () => {
    const base = selectDatabaseProfile(
      replaceDatabaseProfiles(
        {
          ...createDatabaseState(),
          queryDraft: "SELECT * FROM local.users",
          activeResult: result("local", 2),
          history: [
            {
              executed_ms: 11,
              kind: "Read",
              sql: "SELECT 1",
              affected_rows: null,
              row_count: 1,
            },
          ],
          export: { path: "/tmp/result.csv" },
          loading: true,
          error: "stale error",
          confirmation: {
            confirmationText: "RUN DESTRUCTIVE SQL",
            reason: "mutation",
            input: "",
          },
          profiles: [profile("local", "SQLite"), profile("prod", "PostgreSQL")],
          activeProfileId: "local",
        },
        [profile("local", "SQLite"), profile("prod", "PostgreSQL")],
      ),
      "prod",
    );

    expect(base.activeProfileId).toBe("prod");
    expect(base.activeTable).toBeNull();
    expect(base.activeResult).toBeNull();
    expect(base.history).toEqual([]);
    expect(base.export).toBeNull();
    expect(base.loading).toBe(false);
    expect(base.error).toBeNull();
    expect(base.confirmation).toBeNull();
  });

  test("replacing profiles clears profile-scoped state when active profile changes", () => {
    const history: DatabaseQueryHistoryEntry = {
      executed_ms: 11,
      kind: "Mutation",
      sql: "DELETE FROM users",
      affected_rows: 1,
      row_count: 1,
    };

    const base = {
      ...replaceDatabaseProfiles(createDatabaseState(), [
        profile("local", "SQLite"),
        profile("prod", "PostgreSQL"),
      ]),
      activeResult: result("prod", 2),
      history: [history],
      export: { path: "/tmp/query.csv" },
      loading: true,
      error: "old error",
      confirmation: {
        confirmationText: "RUN DESTRUCTIVE SQL",
        reason: "mutation",
        input: "",
      },
    };
    const next = replaceDatabaseProfiles(base, [profile("prod", "PostgreSQL")]);

    expect(next.activeProfileId).toBe("prod");
    expect(next.activeResult).toBeNull();
    expect(next.history).toEqual([]);
    expect(next.export).toBeNull();
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
    expect(next.confirmation).toBeNull();
  });

  test("does not overwrite active result when query result profile mismatches active profile", () => {
    const base = selectDatabaseProfile(
      {
        ...createDatabaseState(),
        activeProfileId: "local",
      },
      "local",
    );
    const staleResult = result("other", 3);
    const next = storeDatabaseQueryResult(base, staleResult);

    expect(next).toEqual(base);
  });

  function profile(id: string, kind: DatabaseProfile["kind"]): DatabaseProfile {
    return {
      id,
      workspace_root: "/repo",
      name: id,
      kind,
      source: { SQLite: { path: "/repo/local.db" } },
      read_only: kind !== "SQLite",
      production: kind !== "SQLite",
      created_ms: 1,
      updated_ms: 1,
    };
  }

  function result(profileId: string, rows: number): DatabaseQueryResult {
    return {
      profile_id: profileId,
      sql: "SELECT id FROM users",
      classification: {
        kind: "Read",
        requires_confirmation: false,
        confirmation_text: "",
        reason: "read-only statement",
      },
      columns: ["id"],
      rows: Array.from({ length: rows }, (_, index) => ({
        cells: [{ kind: "Text", display: String(index) }],
      })),
      affected_rows: null,
      truncated: rows > MAX_DATABASE_ROWS,
      executed_ms: 10,
      history_id: "history-1",
    };
  }
});
