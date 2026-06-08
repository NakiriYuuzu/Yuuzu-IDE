import type { Surface } from "./workspace-view-state";

export type LoadedFile = {
  workspaceId: string;
  path: string;
  content: string;
  language: string;
  readOnly: boolean;
};

type ActiveEditorCheck = {
  surface: Surface;
  activeWorkspaceId: string | null;
  activePath: string | null;
  loadedFile: LoadedFile | null;
};

export function createLoadedFileKey(
  workspaceId: string,
  path: string,
): string {
  return `${workspaceId}:${path}`;
}

export function isLoadedEditorForActiveFile({
  surface,
  activeWorkspaceId,
  activePath,
  loadedFile,
}: ActiveEditorCheck): boolean {
  return (
    surface === "editor" &&
    activeWorkspaceId !== null &&
    activePath !== null &&
    loadedFile?.workspaceId === activeWorkspaceId &&
    loadedFile.path === activePath
  );
}

export function shouldLoadActiveEditor(check: ActiveEditorCheck): boolean {
  return (
    check.surface === "editor" &&
    check.activeWorkspaceId !== null &&
    check.activePath !== null &&
    !isLoadedEditorForActiveFile(check)
  );
}

export function updateLoadedFileContent(
  loadedFile: LoadedFile | null,
  workspaceId: string,
  path: string,
  content: string,
): LoadedFile | null {
  if (
    !loadedFile ||
    loadedFile.workspaceId !== workspaceId ||
    loadedFile.path !== path
  ) {
    return loadedFile;
  }

  return { ...loadedFile, content };
}
