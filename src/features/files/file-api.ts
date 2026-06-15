import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "../../lib/tauri";
import type { FileVersion } from "./file-model";
import type { WorkspaceSearchResult } from "./search-model";

export type TextFileRead = {
  path: string;
  content: string | null;
  version: FileVersion;
  too_large: boolean;
};

export type FileOperationResult = {
  path: string;
  version: FileVersion | null;
};

export function readTextFile(
  workspaceRoot: string,
  path: string,
): Promise<TextFileRead> {
  return call<TextFileRead>("read_text_file", { workspaceRoot, path });
}

export function writeTextFile(
  workspaceRoot: string,
  path: string,
  content: string,
  expectedVersion: FileVersion | null,
): Promise<FileOperationResult> {
  return call<FileOperationResult>("write_text_file", {
    workspaceRoot,
    path,
    content,
    expectedVersion,
  });
}

export function createTextFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<FileOperationResult> {
  return call<FileOperationResult>("create_text_file", {
    workspaceRoot,
    relativePath,
  });
}

export function renamePath(
  workspaceRoot: string,
  path: string,
  newName: string,
): Promise<FileOperationResult> {
  return call<FileOperationResult>("rename_path", {
    workspaceRoot,
    path,
    newName,
  });
}

export function deletePath(
  workspaceRoot: string,
  path: string,
): Promise<void> {
  return call<void>("delete_path", { workspaceRoot, path });
}

export function searchWorkspace(
  workspaceRoot: string,
  query: string,
): Promise<WorkspaceSearchResult> {
  return call<WorkspaceSearchResult>("search_workspace", {
    workspaceRoot,
    query,
  });
}

export type WatchWorkspaceHandle = {
  workspace_root: string;
  watch_id: string;
};

export function watchWorkspace(
  workspaceRoot: string,
): Promise<WatchWorkspaceHandle> {
  return call<WatchWorkspaceHandle>("watch_workspace", { workspaceRoot });
}

export function unwatchWorkspace(
  handle: WatchWorkspaceHandle,
): Promise<void> {
  return call<void>("unwatch_workspace", { handle });
}

export type WorkspaceFileChangedEvent = {
  workspace_root: string;
  path: string;
  version: FileVersion | null;
};

export function onWorkspaceFileChanged(
  handler: (event: WorkspaceFileChangedEvent) => void,
): Promise<UnlistenFn> {
  return listen<WorkspaceFileChangedEvent>("workspace://file-changed", (event) =>
    handler(event.payload),
  );
}
