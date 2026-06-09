export const MAX_DATABASE_ROWS = 500;

export type DatabaseKind = "SQLite" | "PostgreSQL" | "MsSql";

export type DatabaseConnectionSource =
  | {
      SQLite: {
        path: string;
      };
    }
  | {
      Tcp: {
        host: string;
        port: number;
        database: string;
        username: string | null;
        secret_id: string | null;
      };
    };

export type DatabaseProfile = {
  id: string;
  workspace_root: string;
  name: string;
  kind: DatabaseKind;
  source: DatabaseConnectionSource;
  read_only: boolean;
  production: boolean;
  created_ms: number;
  updated_ms: number;
};

export type DatabaseProfileInput = {
  id?: string;
  workspace_root: string;
  name: string;
  kind: DatabaseKind;
  sqlite_path?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  read_only: boolean;
  production: boolean;
};

export type DatabaseColumn = {
  name: string;
  data_type: string;
  nullable: boolean;
  primary_key: boolean;
};

export type DatabaseTable = {
  schema: string | null;
  name: string;
  row_count: number | null;
  columns: DatabaseColumn[];
};

export type DatabaseSchema = {
  profile_id: string;
  tables: DatabaseTable[];
  refreshed_ms: number;
};

export type QueryKind = "Read" | "Mutation" | "Destructive";

export type QueryClassification = {
  kind: QueryKind;
  requires_confirmation: boolean;
  confirmation_text: string;
  reason: string;
};

export type DatabaseQueryRequest = {
  profile_id: string;
  sql: string;
  limit: number;
  confirmation?: string;
};

export type DatabaseCellKind = "Null" | "Text";

export type DatabaseCell = {
  kind: DatabaseCellKind;
  display: string;
};

export type DatabaseQueryResult = {
  profile_id: string;
  sql: string;
  classification: QueryClassification;
  columns: string[];
  rows: DatabaseQueryResultRow[];
  affected_rows: number | null;
  truncated: boolean;
  executed_ms: number;
  history_id: string;
};

export type DatabaseQueryResultRow = {
  cells: DatabaseCell[];
};

export type DatabaseQueryHistoryEntry = {
  sql: string;
  kind: QueryKind;
  executed_ms: number;
  affected_rows: number | null;
  row_count: number | null;
};

export type DatabaseExport = {
  path: string;
};

export type DatabaseConfirmationState = {
  confirmationText: string;
  reason: string;
  input: string;
};

export type DatabaseViewState = {
  profiles: DatabaseProfile[];
  activeProfileId: string | null;
  activeTable: string | null;
  schemaByProfileId: Record<string, DatabaseSchema>;
  queryDraft: string;
  history: DatabaseQueryHistoryEntry[];
  activeResult: DatabaseQueryResult | null;
  loading: boolean;
  error: string | null;
  confirmation: DatabaseConfirmationState | null;
  export: DatabaseExport | null;
};

export function createDatabaseState(): DatabaseViewState {
  return {
    profiles: [],
    activeProfileId: null,
    activeTable: null,
    schemaByProfileId: {},
    queryDraft: "",
    history: [],
    activeResult: null,
    loading: false,
    error: null,
    confirmation: null,
    export: null,
  };
}

export function replaceDatabaseProfiles(
  state: DatabaseViewState,
  profiles: DatabaseProfile[],
): DatabaseViewState {
  const activeProfileId = chooseActiveProfileId(
    state.activeProfileId,
    profiles,
  );
  const keepTable = activeProfileId === state.activeProfileId ? state.activeTable : null;
  const schemaByProfileId = pruneDatabaseSchemas(
    state.schemaByProfileId,
    profiles,
  );

  return {
    ...state,
    profiles,
    activeProfileId,
    activeTable: activeProfileId ? keepTable : null,
    schemaByProfileId,
    error: state.error,
    activeResult: activeProfileId ? state.activeResult : null,
  };
}

export function selectDatabaseProfile(
  state: DatabaseViewState,
  profileId: string,
): DatabaseViewState {
  if (!state.profiles.some((profile) => profile.id === profileId)) {
    return state;
  }

  return {
    ...state,
    activeProfileId: profileId,
    activeTable: null,
    confirmation: null,
  };
}

export function storeDatabaseSchema(
  state: DatabaseViewState,
  schema: DatabaseSchema,
): DatabaseViewState {
  return {
    ...state,
    schemaByProfileId: {
      ...state.schemaByProfileId,
      [schema.profile_id]: schema,
    },
    error: null,
  };
}

export function updateDatabaseDraft(
  state: DatabaseViewState,
  queryDraft: string,
): DatabaseViewState {
  return {
    ...state,
    queryDraft,
    confirmation: null,
    error: null,
  };
}

export function beginDatabaseQuery(
  state: DatabaseViewState,
): DatabaseViewState {
  return {
    ...state,
    loading: true,
    activeResult: null,
    confirmation: null,
    error: null,
  };
}

export function storeDatabaseQueryResult(
  state: DatabaseViewState,
  result: DatabaseQueryResult,
): DatabaseViewState {
  const boundedRows = result.rows.slice(0, MAX_DATABASE_ROWS);
  const truncated = result.truncated || result.rows.length > MAX_DATABASE_ROWS;

  return {
    ...state,
    loading: false,
    activeResult: {
      ...result,
      rows: boundedRows,
      truncated,
    },
    error: null,
    confirmation: null,
  };
}

export function requireDatabaseConfirmation(
  state: DatabaseViewState,
  classification: QueryClassification,
): DatabaseViewState {
  if (!classification.requires_confirmation) {
    return {
      ...state,
      confirmation: null,
    };
  }

  return {
    ...state,
    confirmation: {
      confirmationText: classification.confirmation_text,
      reason: classification.reason,
      input: "",
    },
  };
}

export function setDatabaseConfirmationInput(
  state: DatabaseViewState,
  input: string,
): DatabaseViewState {
  if (!state.confirmation) {
    return state;
  }

  return {
    ...state,
    confirmation: {
      ...state.confirmation,
      input,
    },
  };
}

export function databaseBadgeCount(
  state: DatabaseViewState,
): string | null {
  const count = state.profiles.length;
  return count > 0 ? String(count) : null;
}

function chooseActiveProfileId(
  requestedProfileId: string | null,
  profiles: DatabaseProfile[],
): string | null {
  if (
    requestedProfileId &&
    profiles.some((profile) => profile.id === requestedProfileId)
  ) {
    return requestedProfileId;
  }

  return profiles.length > 0 ? profiles[0]?.id ?? null : null;
}

function pruneDatabaseSchemas(
  schemaByProfileId: Record<string, DatabaseSchema>,
  profiles: DatabaseProfile[],
): Record<string, DatabaseSchema> {
  const keepByProfileId = new Set(profiles.map((profile) => profile.id));
  const pruned: Record<string, DatabaseSchema> = {};

  for (const profileId of Object.keys(schemaByProfileId)) {
    if (keepByProfileId.has(profileId)) {
      pruned[profileId] = schemaByProfileId[profileId]!;
    }
  }

  return pruned;
}

export type {
  DatabaseCellKind as DatabaseCellType,
  QueryKind as DatabaseQueryKind,
};
