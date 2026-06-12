import { coreCommandContributions } from "./command-registry";

export type CommandItem = {
  id: string;
  label: string;
  group: string;
  description?: string;
};

const commandContributionById = new Map(
  coreCommandContributions.map((command) => [command.id, command]),
);

function coreCommandsById(
  ids: string[],
  descriptions: Record<string, string> = {},
): CommandItem[] {
  return ids.map((id) => {
    const command = commandContributionById.get(id);

    if (!command) {
      throw new Error(`Missing core command contribution: ${id}`);
    }

    const item: CommandItem = {
      id: command.id,
      label: command.label,
      group: command.group,
    };
    const description = descriptions[id];

    return description === undefined ? item : { ...item, description };
  });
}

export const node1Commands: CommandItem[] = coreCommandsById([
  "open-workspace",
  "switch-workspace",
  "open-editor",
  "open-terminal",
  "toggle-sidebar",
  "open-settings",
  "new-terminal",
  "run-task",
  "rerun-task",
  "stop-task",
  "save-file",
  "find-in-file",
  "search-workspace",
]);

export const node5Commands: CommandItem[] = coreCommandsById([
  "open-docs",
  "refresh-docs-index",
  "create-context-pack",
]);

export const node6Commands: CommandItem[] = coreCommandsById([
  "open-language",
  "language-refresh",
  "language-restart",
]);

export const node7Commands: CommandItem[] = coreCommandsById([
  "open-agents",
  "agent-start-session",
  "agent-export-prompt",
]);

export const node8Commands: CommandItem[] = coreCommandsById([
  "open-browser-preview",
  "browser-reload",
  "browser-hard-reload",
  "browser-capture-screenshot",
]);

export const node9Commands: CommandItem[] = coreCommandsById([
  "open-database",
  "database-refresh",
]);

export const node10Commands: CommandItem[] = coreCommandsById([
  "open-remote",
  "remote-connect",
  "remote-open-ssh",
  "remote-open-sftp",
]);

export const node11Commands: CommandItem[] = coreCommandsById(
  [
    "open-debug",
    "debug-start-session",
    "debug-continue",
    "debug-step-over",
    "debug-pause",
    "debug-disconnect",
    "debug-toggle-breakpoint",
  ],
  {
    "open-debug": "Open the debug workbench panel",
    "debug-start-session": "Start the selected launch configuration",
    "debug-continue": "Continue the active debug session",
    "debug-step-over": "Step over in the active debug session",
    "debug-pause": "Pause the active debug session",
    "debug-disconnect": "Disconnect the active debug session",
    "debug-toggle-breakpoint": "Toggle a breakpoint in the active editor",
  },
);

export const node12Commands: CommandItem[] = coreCommandsById(
  ["open-extensions", "extension-refresh"],
  {
    "open-extensions": "Open the extension registry panel",
    "extension-refresh": "Refresh workspace extension status",
  },
);

export const node13Commands: CommandItem[] = coreCommandsById(
  [
    "open-diagnostics",
    "refresh-diagnostics",
    "open-recovery",
    "import-keybindings",
  ],
  {
    "open-diagnostics": "Open Settings diagnostics",
    "refresh-diagnostics": "Refresh diagnostics metrics and logs",
    "open-recovery": "Open Settings recovery backups",
    "import-keybindings": "Open keybinding import settings",
  },
);

export const allCommands: CommandItem[] = [
  ...node1Commands,
  ...node5Commands,
  ...node6Commands,
  ...node7Commands,
  ...node8Commands,
  ...node9Commands,
  ...node10Commands,
  ...node11Commands,
  ...node12Commands,
  ...node13Commands,
];

export function filterCommands(
  commands: CommandItem[],
  query: string,
): CommandItem[] {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return commands;
  }

  return commands.filter((command) => {
    const group = command.group.toLowerCase();
    const label = command.label.toLowerCase();
    const description = command.description?.toLowerCase() ?? "";

    return (
      group === needle ||
      label.includes(needle) ||
      description.includes(needle)
    );
  });
}
