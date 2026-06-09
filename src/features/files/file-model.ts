export type FileVersion = {
  modified_ms: number;
  len: number;
};

export type EditorFileTab = {
  path: string;
  name: string;
  dirty: boolean;
  tooLarge: boolean;
  version: FileVersion | null;
  externalChange: boolean;
};

export type EditorFileState = {
  tabs: EditorFileTab[];
  activePath: string | null;
};

export function openFileTab(
  state: EditorFileState,
  tab: EditorFileTab,
): EditorFileState {
  const exists = state.tabs.some((item) => item.path === tab.path);
  return {
    tabs: exists ? state.tabs : [...state.tabs, tab],
    activePath: tab.path,
  };
}

export function activateFileTab(
  state: EditorFileState,
  path: string,
): EditorFileState {
  return state.tabs.some((item) => item.path === path)
    ? { ...state, activePath: path }
    : state;
}

export function closeFileTab(
  state: EditorFileState,
  path: string,
): EditorFileState {
  const index = state.tabs.findIndex((item) => item.path === path);
  if (index < 0) {
    return state;
  }

  const tabs = state.tabs.filter((item) => item.path !== path);
  const activePath =
    state.activePath === path
      ? (tabs[Math.max(0, index - 1)]?.path ?? null)
      : state.activePath;
  return { tabs, activePath };
}

export function markFileDirty(
  state: EditorFileState,
  path: string,
  dirty: boolean,
): EditorFileState {
  return {
    ...state,
    tabs: state.tabs.map((item) =>
      item.path === path ? { ...item, dirty } : item,
    ),
  };
}

export function markExternalChange(
  state: EditorFileState,
  path: string,
): EditorFileState {
  return {
    ...state,
    tabs: state.tabs.map((item) =>
      item.path === path ? { ...item, externalChange: true } : item,
    ),
  };
}

export function applySavedVersion(
  state: EditorFileState,
  path: string,
  version: FileVersion,
): EditorFileState {
  return {
    ...state,
    tabs: state.tabs.map((item) =>
      item.path === path
        ? { ...item, dirty: false, externalChange: false, version }
        : item,
    ),
  };
}
