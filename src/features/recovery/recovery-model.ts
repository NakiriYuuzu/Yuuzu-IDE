import type { FileVersion } from "../files/file-model";

export type UnsavedBackup = {
  id: string;
  workspace_id: string;
  workspace_root: string;
  path: string;
  content: string;
  version: FileVersion | null;
  updated_ms: number;
};

export type UnsavedBackupSummary = Omit<UnsavedBackup, "content"> & {
  content_length: number;
};

export type RecoveryViewState = {
  backups: UnsavedBackupSummary[];
  selectedBackupId: string | null;
  restoringBackupId: string | null;
  loading: boolean;
  error: string | null;
};

export function createRecoveryState(): RecoveryViewState {
  return {
    backups: [],
    selectedBackupId: null,
    restoringBackupId: null,
    loading: false,
    error: null,
  };
}

export function toRecoverySummary(
  backup: UnsavedBackup | UnsavedBackupSummary,
): UnsavedBackupSummary {
  return {
    id: backup.id,
    workspace_id: backup.workspace_id,
    workspace_root: backup.workspace_root,
    path: backup.path,
    version: backup.version,
    updated_ms: backup.updated_ms,
    content_length:
      "content_length" in backup ? backup.content_length : backup.content.length,
  };
}

export function storeRecoveryBackups(
  state: RecoveryViewState,
  backups: Array<UnsavedBackup | UnsavedBackupSummary>,
): RecoveryViewState {
  const sortedBackups = backups
    .map(toRecoverySummary)
    .sort((a, b) =>
      b.updated_ms === a.updated_ms
        ? a.path.localeCompare(b.path)
        : b.updated_ms - a.updated_ms,
    );

  return {
    ...state,
    backups: sortedBackups,
    selectedBackupId: sortedBackups[0]?.id ?? null,
    restoringBackupId: sortedBackups.some(
      (backup) => backup.id === state.restoringBackupId,
    )
      ? state.restoringBackupId
      : null,
    loading: false,
    error: null,
  };
}

export function restoreRecoveryBackup(
  state: RecoveryViewState,
  backupId: string,
): RecoveryViewState {
  return state.backups.some((backup) => backup.id === backupId)
    ? { ...state, selectedBackupId: backupId, restoringBackupId: backupId }
    : state;
}

export function discardRecoveryBackup(
  state: RecoveryViewState,
  backupId: string,
): RecoveryViewState {
  const backups = state.backups.filter((backup) => backup.id !== backupId);

  return {
    ...state,
    backups,
    selectedBackupId:
      state.selectedBackupId === backupId ? null : state.selectedBackupId,
    restoringBackupId:
      state.restoringBackupId === backupId ? null : state.restoringBackupId,
  };
}
