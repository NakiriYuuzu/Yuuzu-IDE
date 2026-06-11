export type CommandItem = {
  id: string;
  label: string;
  group: string;
  description?: string;
};

export const node1Commands: CommandItem[] = [
  { id: "open-workspace", label: "Open folder as workspace", group: "Workspace" },
  { id: "switch-workspace", label: "Switch workspace", group: "Workspace" },
  { id: "open-editor", label: "Open editor surface", group: "Workbench" },
  { id: "open-terminal", label: "Open terminal surface", group: "Workbench" },
  { id: "toggle-sidebar", label: "Toggle side panel", group: "Workbench" },
  { id: "open-settings", label: "Open settings shell", group: "Settings" },
  { id: "new-terminal", label: "Terminal: New terminal", group: "Terminal" },
  { id: "run-task", label: "Tasks: Run selected task", group: "Tasks" },
  { id: "rerun-task", label: "Tasks: Rerun last task", group: "Tasks" },
  { id: "stop-task", label: "Tasks: Stop running task", group: "Tasks" },
  { id: "save-file", label: "Save active file", group: "File" },
  { id: "find-in-file", label: "Find in file", group: "File" },
  { id: "search-workspace", label: "Search workspace", group: "Search" },
];

export const node5Commands: CommandItem[] = [
  { id: "open-docs", label: "Docs: Open docs panel", group: "Docs" },
  { id: "refresh-docs-index", label: "Docs: Refresh index", group: "Docs" },
  {
    id: "create-context-pack",
    label: "Docs: Create context pack",
    group: "Docs",
  },
];

export const node6Commands: CommandItem[] = [
  {
    id: "open-language",
    label: "Language: Open diagnostics",
    group: "Language",
  },
  {
    id: "language-refresh",
    label: "Language: Refresh diagnostics",
    group: "Language",
  },
  {
    id: "language-restart",
    label: "Language: Restart active server",
    group: "Language",
  },
];

export const node7Commands: CommandItem[] = [
  {
    id: "open-agents",
    label: "Agents: Open workbench",
    group: "Agents",
  },
  {
    id: "agent-start-session",
    label: "Agents: Start session",
    group: "Agents",
  },
  {
    id: "agent-export-prompt",
    label: "Agents: Export prompt",
    group: "Agents",
  },
];

export const node8Commands: CommandItem[] = [
  {
    id: "open-browser-preview",
    label: "Browser: Open preview",
    group: "Browser",
  },
  {
    id: "browser-reload",
    label: "Browser: Reload preview",
    group: "Browser",
  },
  {
    id: "browser-hard-reload",
    label: "Browser: Hard reload preview",
    group: "Browser",
  },
  {
    id: "browser-capture-screenshot",
    label: "Browser: Capture screenshot",
    group: "Browser",
  },
];

export const node9Commands: CommandItem[] = [
  {
    id: "open-database",
    label: "Database: Open panel",
    group: "Database",
  },
  {
    id: "database-refresh",
    label: "Database: Refresh profiles",
    group: "Database",
  },
];

export const node10Commands: CommandItem[] = [
  { id: "open-remote", label: "Remote: Open panel", group: "Remote" },
  { id: "remote-connect", label: "Remote: Connect active host", group: "Remote" },
  { id: "remote-open-ssh", label: "Remote: Open SSH terminal", group: "Remote" },
  { id: "remote-open-sftp", label: "Remote: Open SFTP browser", group: "Remote" },
];

export const node11Commands: CommandItem[] = [
  {
    id: "open-debug",
    label: "Debug: Open panel",
    group: "Debug",
    description: "Open the debug workbench panel",
  },
  {
    id: "debug-start-session",
    label: "Debug: Start session",
    group: "Debug",
    description: "Start the selected launch configuration",
  },
  {
    id: "debug-continue",
    label: "Debug: Continue",
    group: "Debug",
    description: "Continue the active debug session",
  },
  {
    id: "debug-step-over",
    label: "Debug: Step over",
    group: "Debug",
    description: "Step over in the active debug session",
  },
  {
    id: "debug-pause",
    label: "Debug: Pause",
    group: "Debug",
    description: "Pause the active debug session",
  },
  {
    id: "debug-disconnect",
    label: "Debug: Disconnect",
    group: "Debug",
    description: "Disconnect the active debug session",
  },
  {
    id: "debug-toggle-breakpoint",
    label: "Debug: Toggle breakpoint",
    group: "Debug",
    description: "Toggle a breakpoint in the active editor",
  },
];

export const allCommands: CommandItem[] = [
  ...node1Commands,
  ...node5Commands,
  ...node6Commands,
  ...node7Commands,
  ...node8Commands,
  ...node9Commands,
  ...node10Commands,
  ...node11Commands,
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
