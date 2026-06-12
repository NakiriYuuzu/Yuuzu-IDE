export type ExtensionPerformanceClass = "Ok" | "Slow";
export type ExtensionHookEvent = "WorkspaceOpened" | "WorkspaceClosed" | "FileSaved";

export type ExtensionCommandContribution = {
  id: string;
  label: string;
  group: string;
  description: string;
  owner_extension_id: string;
};

export type ExtensionThemeContribution = {
  id: string;
  label: string;
  mode: string;
  accent: string;
};

export type ExtensionKeybindingContribution = {
  command: string;
  key: string;
  when: string;
};

export type ExtensionSnippetContribution = {
  id: string;
  language: string;
  prefix: string;
  body: string[];
  description: string;
};

export type ExtensionWorkspaceHookContribution = {
  id: string;
  event: ExtensionHookEvent;
  command: string;
  budget_ms: number;
};

export type ExtensionContributions = {
  commands: ExtensionCommandContribution[];
  themes: ExtensionThemeContribution[];
  keybindings: ExtensionKeybindingContribution[];
  snippets: ExtensionSnippetContribution[];
  workspace_hooks: ExtensionWorkspaceHookContribution[];
};

export type ExtensionManifest = {
  id: string;
  name: string;
  version: string;
  api_version: string;
  description: string;
  builtin: boolean;
  contributes: ExtensionContributions;
};

export type ExtensionPerformanceSummary = {
  last_duration_ms: number | null;
  slow_operation_count: number;
  sample_count: number;
  class: ExtensionPerformanceClass;
};

export type ExtensionPerformanceSample = {
  extension_id: string;
  workspace_root: string;
  operation: string;
  duration_ms: number;
  budget_ms: number;
  recorded_ms: number;
};

export type ExtensionWorkspaceStatus = {
  manifest: ExtensionManifest;
  enabled: boolean;
  disabled_by_workspace: boolean;
  performance: ExtensionPerformanceSummary;
};

export type ExtensionViewState = {
  statuses: ExtensionWorkspaceStatus[];
  activeExtensionId: string | null;
  loading: boolean;
  error: string | null;
};

export function createExtensionState(): ExtensionViewState {
  return {
    statuses: [],
    activeExtensionId: null,
    loading: false,
    error: null,
  };
}

export function replaceExtensionStatuses(
  state: ExtensionViewState,
  statuses: ExtensionWorkspaceStatus[],
): ExtensionViewState {
  const nextStatuses = statuses.map(cloneExtensionStatus);
  const activeExtensionId =
    nextStatuses.find((item) => item.manifest.id === state.activeExtensionId)
      ?.manifest.id ??
    nextStatuses[0]?.manifest.id ??
    null;

  return {
    ...state,
    statuses: nextStatuses,
    activeExtensionId,
    loading: false,
    error: null,
  };
}

export function toggleExtensionStatus(
  state: ExtensionViewState,
  extensionId: string,
  enabled: boolean,
): ExtensionViewState {
  return {
    ...state,
    statuses: state.statuses.map((status) => {
      const next = cloneExtensionStatus(status);
      if (next.manifest.id !== extensionId) {
        return next;
      }

      return {
        ...next,
        enabled,
        disabled_by_workspace: !enabled,
      };
    }),
  };
}

export function setExtensionLoading(
  state: ExtensionViewState,
): ExtensionViewState {
  return {
    ...state,
    loading: true,
    error: null,
  };
}

export function setExtensionError(
  state: ExtensionViewState,
  error: string,
): ExtensionViewState {
  return {
    ...state,
    loading: false,
    error,
  };
}

export function activeExtensionStatus(
  state: ExtensionViewState,
): ExtensionWorkspaceStatus | null {
  return (
    state.statuses.find((status) => status.manifest.id === state.activeExtensionId) ??
    null
  );
}

export function extensionCommands(
  state: ExtensionViewState,
): ExtensionCommandContribution[] {
  return state.statuses
    .filter((status) => status.enabled)
    .flatMap((status) =>
      status.manifest.contributes.commands.map(cloneCommandContribution),
    );
}

export function slowExtensionStatuses(
  state: ExtensionViewState,
): ExtensionWorkspaceStatus[] {
  return state.statuses
    .filter(
      (status) =>
        status.performance.class === "Slow" ||
        status.performance.slow_operation_count > 0,
    )
    .map(cloneExtensionStatus);
}

export function extensionBadgeCount(state: ExtensionViewState): string | null {
  const slowCount = slowExtensionStatuses(state).length;
  return slowCount > 0 ? String(slowCount) : null;
}

function cloneExtensionStatus(
  status: ExtensionWorkspaceStatus,
): ExtensionWorkspaceStatus {
  return {
    manifest: cloneExtensionManifest(status.manifest),
    enabled: status.enabled,
    disabled_by_workspace: status.disabled_by_workspace,
    performance: { ...status.performance },
  };
}

function cloneExtensionManifest(manifest: ExtensionManifest): ExtensionManifest {
  return {
    ...manifest,
    contributes: {
      commands: manifest.contributes.commands.map(cloneCommandContribution),
      themes: manifest.contributes.themes.map((theme) => ({ ...theme })),
      keybindings: manifest.contributes.keybindings.map((keybinding) => ({
        ...keybinding,
      })),
      snippets: manifest.contributes.snippets.map((snippet) => ({
        ...snippet,
        body: [...snippet.body],
      })),
      workspace_hooks: manifest.contributes.workspace_hooks.map((hook) => ({
        ...hook,
      })),
    },
  };
}

function cloneCommandContribution(
  command: ExtensionCommandContribution,
): ExtensionCommandContribution {
  return { ...command };
}
