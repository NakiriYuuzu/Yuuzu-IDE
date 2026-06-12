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

export type RecoveryViewState = {
  backups: UnsavedBackup[];
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

export function storeRecoveryBackups(
  state: RecoveryViewState,
  backups: UnsavedBackup[],
): RecoveryViewState {
  const sortedBackups = [...backups].sort((a, b) =>
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
