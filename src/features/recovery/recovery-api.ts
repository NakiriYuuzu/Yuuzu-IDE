import { call } from "../../lib/tauri";
import type { FileVersion } from "../files/file-model";
import type { BackupLineEnding, UnsavedBackup } from "./recovery-model";

export function saveUnsavedBackup(args: {
  workspaceRoot: string;
  workspaceId: string;
  path: string;
  content: string;
  lineEnding?: BackupLineEnding;
  version: FileVersion | null;
}): Promise<UnsavedBackup> {
  return call<UnsavedBackup>("save_unsaved_backup", args);
}

export function listUnsavedBackups(args: {
  workspaceRoot: string;
  workspaceId: string;
}): Promise<UnsavedBackup[]> {
  return call<UnsavedBackup[]>("list_unsaved_backups", args);
}

export function discardUnsavedBackup(args: {
  workspaceRoot: string;
  workspaceId: string;
  backupId: string;
}): Promise<void> {
  return call<void>("discard_unsaved_backup", args);
}
