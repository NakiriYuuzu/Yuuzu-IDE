import { call } from "../../lib/tauri";
import type {
  ConnectionTestResult,
  DatabaseExport,
  DatabaseProfile,
  DatabaseProfileInput,
  DatabaseQueryHistoryEntry,
  DatabaseQueryRequest,
  DatabaseQueryResult,
  DatabaseSchema,
} from "./database-model";

export function listDatabaseProfiles(
  workspaceRoot: string,
): Promise<DatabaseProfile[]> {
  return call("list_database_profiles", { workspaceRoot });
}

export function saveDatabaseProfile(
  input: DatabaseProfileInput,
): Promise<DatabaseProfile> {
  return call("save_database_profile", { input });
}

export function deleteDatabaseProfile(
  workspaceRoot: string,
  profileId: string,
): Promise<void> {
  return call("delete_database_profile", { workspaceRoot, profileId });
}

export function testDatabaseConnection(
  input: DatabaseProfileInput,
): Promise<ConnectionTestResult> {
  return call("test_database_connection", { input });
}

export function inspectDatabaseSchema(profileId: string): Promise<DatabaseSchema> {
  return call("inspect_database_schema", { profileId });
}

export function executeDatabaseQuery(
  request: DatabaseQueryRequest,
): Promise<DatabaseQueryResult> {
  return call("execute_database_query", { request });
}

export function listDatabaseQueryHistory(
  profileId: string,
): Promise<DatabaseQueryHistoryEntry[]> {
  return call("list_database_query_history", { profileId });
}

export function exportDatabaseQueryResult(
  workspaceRoot: string,
  result: DatabaseQueryResult,
): Promise<DatabaseExport> {
  return call("export_database_query_result", { workspaceRoot, result });
}
