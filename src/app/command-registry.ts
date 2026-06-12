import type { ExtensionCommandContribution } from "../features/extensions/extension-model";
import type { CommandItem } from "./command-palette-model";

export type CommandContribution = ExtensionCommandContribution;

export const coreCommandContributions: CommandContribution[] = [
  {
    id: "open-workspace",
    label: "Open folder as workspace",
    group: "Workspace",
    description: "Open a folder as a workspace",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "switch-workspace",
    label: "Switch workspace",
    group: "Workspace",
    description: "Switch active workspace",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "open-editor",
    label: "Open editor surface",
    group: "Workbench",
    description: "Focus the editor surface",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "open-terminal",
    label: "Open terminal surface",
    group: "Workbench",
    description: "Open the terminal surface",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "toggle-sidebar",
    label: "Toggle side panel",
    group: "Workbench",
    description: "Show or hide the side panel",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "open-settings",
    label: "Open settings shell",
    group: "Settings",
    description: "Open settings",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "new-terminal",
    label: "Terminal: New terminal",
    group: "Terminal",
    description: "Start a terminal",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "run-task",
    label: "Tasks: Run selected task",
    group: "Tasks",
    description: "Run selected task",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "rerun-task",
    label: "Tasks: Rerun last task",
    group: "Tasks",
    description: "Rerun last task",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "stop-task",
    label: "Tasks: Stop running task",
    group: "Tasks",
    description: "Stop active task",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "save-file",
    label: "Save active file",
    group: "File",
    description: "Save active file",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "find-in-file",
    label: "Find in file",
    group: "File",
    description: "Find in the active editor",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "search-workspace",
    label: "Search workspace",
    group: "Search",
    description: "Search current workspace",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "open-docs",
    label: "Docs: Open docs panel",
    group: "Docs",
    description: "Open docs panel",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "refresh-docs-index",
    label: "Docs: Refresh index",
    group: "Docs",
    description: "Refresh docs index",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "create-context-pack",
    label: "Docs: Create context pack",
    group: "Docs",
    description: "Create context pack",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "open-language",
    label: "Language: Open diagnostics",
    group: "Language",
    description: "Open language diagnostics",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "language-refresh",
    label: "Language: Refresh diagnostics",
    group: "Language",
    description: "Refresh language diagnostics",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "language-restart",
    label: "Language: Restart active server",
    group: "Language",
    description: "Restart active language server",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "open-agents",
    label: "Agents: Open workbench",
    group: "Agents",
    description: "Open agent workbench",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "agent-start-session",
    label: "Agents: Start session",
    group: "Agents",
    description: "Start agent session",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "agent-export-prompt",
    label: "Agents: Export prompt",
    group: "Agents",
    description: "Export agent prompt",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "open-browser-preview",
    label: "Browser: Open preview",
    group: "Browser",
    description: "Open browser preview",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "browser-reload",
    label: "Browser: Reload preview",
    group: "Browser",
    description: "Reload browser preview",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "browser-hard-reload",
    label: "Browser: Hard reload preview",
    group: "Browser",
    description: "Hard reload browser preview",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "browser-capture-screenshot",
    label: "Browser: Capture screenshot",
    group: "Browser",
    description: "Capture browser screenshot",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "open-database",
    label: "Database: Open panel",
    group: "Database",
    description: "Open database panel",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "database-refresh",
    label: "Database: Refresh profiles",
    group: "Database",
    description: "Refresh database profiles",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "open-remote",
    label: "Remote: Open panel",
    group: "Remote",
    description: "Open remote panel",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "remote-connect",
    label: "Remote: Connect active host",
    group: "Remote",
    description: "Connect active remote host",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "remote-open-ssh",
    label: "Remote: Open SSH terminal",
    group: "Remote",
    description: "Open SSH terminal",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "remote-open-sftp",
    label: "Remote: Open SFTP browser",
    group: "Remote",
    description: "Open SFTP browser",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "open-debug",
    label: "Debug: Open panel",
    group: "Debug",
    description: "Open debug workbench",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "debug-start-session",
    label: "Debug: Start session",
    group: "Debug",
    description: "Start selected debug configuration",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "debug-continue",
    label: "Debug: Continue",
    group: "Debug",
    description: "Continue active debug session",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "debug-step-over",
    label: "Debug: Step over",
    group: "Debug",
    description: "Step over active debug session",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "debug-pause",
    label: "Debug: Pause",
    group: "Debug",
    description: "Pause active debug session",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "debug-disconnect",
    label: "Debug: Disconnect",
    group: "Debug",
    description: "Disconnect active debug session",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "debug-toggle-breakpoint",
    label: "Debug: Toggle breakpoint",
    group: "Debug",
    description: "Toggle breakpoint in active editor",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "open-extensions",
    label: "Extensions: Open panel",
    group: "Extensions",
    description: "Open extensions panel",
    owner_extension_id: "yuuzu.core",
  },
  {
    id: "extension-refresh",
    label: "Extensions: Refresh",
    group: "Extensions",
    description: "Refresh extension status",
    owner_extension_id: "yuuzu.core",
  },
];

export function registeredCoreCommandIds(): string[] {
  return coreCommandContributions.map((command) => command.id);
}

export function toCommandItem(command: CommandContribution): CommandItem {
  return {
    id: command.id,
    label: command.label,
    group: command.group,
    description: command.description,
  };
}

export function extensionContributionsForPalette(
  commands: ExtensionCommandContribution[],
  disabledExtensionIds: Set<string>,
): CommandItem[] {
  return commands
    .filter((command) => !disabledExtensionIds.has(command.owner_extension_id))
    .map(toCommandItem);
}

export function commandItemsForPalette(
  extensionCommands: ExtensionCommandContribution[],
  disabledExtensionIds: Set<string>,
): CommandItem[] {
  return [
    ...coreCommandContributions.map(toCommandItem),
    ...extensionContributionsForPalette(extensionCommands, disabledExtensionIds),
  ];
}
