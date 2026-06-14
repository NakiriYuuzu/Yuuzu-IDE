import type { EditorFileState, FileVersion } from "../files/file-model";
import type { Surface } from "./workspace-view-state";
import type { FileTreeEntry } from "./workspace-api";

export type ExpandedPaths = Record<string, FileTreeEntry[]>;
export type LoadingPaths = Record<string, boolean>;
export type GitDecorationMap = Record<string, "M" | "A" | "D" | "U">;

export type RevealState = {
  workspaceRoot: string;
  activeFilePath: string | null;
  refreshKey: number;
  collapsedByUser: Record<string, true>;
};

export type DirectoryLoadResultCheck = {
  requestGeneration: number;
  currentGeneration: number;
  intendedGeneration: number | undefined;
};

export function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").pop() || path;
}

export function parentNameFromPath(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/");
  return segments.length > 1 ? segments[segments.length - 2] : "workspace";
}

export function fileIconClassFromName(name: string): string {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(".rs")) {
    return "ico-rs";
  }

  if (lowerName.endsWith(".md") || lowerName.endsWith(".mdx")) {
    return "ico-md";
  }

  return lowerName.endsWith(".ts") || lowerName.endsWith(".tsx")
    ? "ico-ts"
    : "";
}

export function gitDecorationForPath(
  decorations: GitDecorationMap,
  path: string,
): GitDecorationMap[string] | null {
  return decorations[path] ?? null;
}

export function normalizeExplorerPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return (trimmed || path).replace(/\\/g, "/");
}

export function isSameOrDescendant(path: string, parent: string): boolean {
  const normalizedPath = normalizeExplorerPath(path);
  const normalizedParent = normalizeExplorerPath(parent);

  return (
    normalizedPath === normalizedParent ||
    normalizedPath.startsWith(`${normalizedParent}/`)
  );
}

export function relativePathFromWorkspace(
  workspaceRoot: string,
  path: string,
): string | null {
  const root = normalizeExplorerPath(workspaceRoot);
  const child = normalizeExplorerPath(path);

  if (child === root) {
    return "";
  }

  const prefix = `${root}/`;
  return child.startsWith(prefix) ? child.slice(prefix.length) : null;
}

export function joinRelativePath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

export function directoryAncestors(
  workspaceRoot: string,
  filePath: string,
): string[] {
  const root = normalizeExplorerPath(workspaceRoot);
  const file = normalizeExplorerPath(filePath);
  const relativePath = relativePathFromWorkspace(root, file);

  if (!relativePath) {
    return [];
  }

  const parts = relativePath.split("/");
  parts.pop();

  const ancestors: string[] = [];
  let current = root;
  for (const part of parts) {
    current = `${current}/${part}`;
    ancestors.push(current);
  }

  return ancestors;
}

export function isExpanded(expandedPaths: ExpandedPaths, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(expandedPaths, path);
}

export function createRevealState(
  workspaceRoot: string,
  activeFilePath: string | null,
  refreshKey: number,
): RevealState {
  return {
    workspaceRoot,
    activeFilePath,
    refreshKey,
    collapsedByUser: {},
  };
}

export function rememberManualCollapse(
  state: RevealState,
  path: string,
): RevealState {
  return {
    ...state,
    collapsedByUser: {
      ...state.collapsedByUser,
      [normalizeExplorerPath(path)]: true,
    },
  };
}

export function forgetManualCollapse(
  state: RevealState,
  path: string,
): RevealState {
  const normalizedPath = normalizeExplorerPath(path);
  const collapsedByUser = Object.fromEntries(
    Object.entries(state.collapsedByUser).filter(
      ([item]) => !isSameOrDescendant(item, normalizedPath),
    ),
  ) as Record<string, true>;

  return { ...state, collapsedByUser };
}

export function hasCollapsedAncestor(
  collapsedByUser: Record<string, true>,
  path: string,
): boolean {
  return Object.keys(collapsedByUser).some((item) =>
    isSameOrDescendant(path, item),
  );
}

export function nextAutoRevealPaths(
  state: RevealState,
  expandedPaths: ExpandedPaths,
  loadingPaths: LoadingPaths,
): string[] {
  if (!state.workspaceRoot || !state.activeFilePath) {
    return [];
  }

  return directoryAncestors(state.workspaceRoot, state.activeFilePath).filter(
    (path) =>
      !hasCollapsedAncestor(state.collapsedByUser, path) &&
      !isExpanded(expandedPaths, path) &&
      !loadingPaths[path],
  );
}

export function shouldApplyDirectoryLoadResult({
  currentGeneration,
  intendedGeneration,
  requestGeneration,
}: DirectoryLoadResultCheck): boolean {
  return (
    intendedGeneration === requestGeneration &&
    currentGeneration === requestGeneration
  );
}

export function removePathAndDescendantsFromRecord<T>(
  record: Record<string, T>,
  path: string,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([item]) => !isSameOrDescendant(item, path)),
  );
}

export function replacePathPrefix(
  path: string,
  oldPath: string,
  newPath: string,
): string {
  const normalizedPath = normalizeExplorerPath(path);
  const normalizedOldPath = normalizeExplorerPath(oldPath);
  const normalizedNewPath = normalizeExplorerPath(newPath);

  if (normalizedPath === normalizedOldPath) {
    return newPath;
  }

  if (normalizedPath.startsWith(`${normalizedOldPath}/`)) {
    return `${normalizedNewPath}${normalizedPath.slice(normalizedOldPath.length)}`;
  }

  return path;
}

export function editorTabForPath(path: string, version: FileVersion | null) {
  return {
    path,
    name: fileNameFromPath(path),
    dirty: false,
    tooLarge: false,
    version,
    externalChange: false,
  };
}

export function renameEditorPath(
  editor: EditorFileState,
  oldPath: string,
  newPath: string,
  version: FileVersion | null,
): EditorFileState {
  return {
    tabs: editor.tabs.map((tab) => {
      if (!isSameOrDescendant(tab.path, oldPath)) {
        return tab;
      }

      const nextPath = replacePathPrefix(tab.path, oldPath, newPath);
      return {
        ...tab,
        path: nextPath,
        name: fileNameFromPath(nextPath),
        version: tab.path === oldPath ? version : tab.version,
      };
    }),
    activePath: editor.activePath
      ? replacePathPrefix(editor.activePath, oldPath, newPath)
      : null,
  };
}

export function removeEditorPath(
  editor: EditorFileState,
  deletedPath: string,
): EditorFileState {
  const removedIndex = editor.tabs.findIndex((tab) =>
    isSameOrDescendant(tab.path, deletedPath),
  );
  if (removedIndex < 0) {
    return editor;
  }

  const tabs = editor.tabs.filter(
    (tab) => !isSameOrDescendant(tab.path, deletedPath),
  );
  const activePath =
    editor.activePath && isSameOrDescendant(editor.activePath, deletedPath)
      ? (tabs[Math.max(0, removedIndex - 1)]?.path ?? null)
      : editor.activePath;

  return { tabs, activePath };
}

export function surfaceAfterEditorRemoval(
  currentSurface: Surface,
  previousEditor: EditorFileState,
  nextEditor: EditorFileState,
): Surface {
  if (
    currentSurface === "editor" &&
    previousEditor.activePath !== null &&
    nextEditor.activePath === null
  ) {
    return "empty";
  }

  return currentSurface;
}
