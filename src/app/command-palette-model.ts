export type CommandItem = {
  id: string;
  label: string;
  group: string;
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

export const allCommands: CommandItem[] = [
  ...node1Commands,
  ...node5Commands,
  ...node6Commands,
  ...node7Commands,
  ...node8Commands,
  ...node9Commands,
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

    return group === needle || label.includes(needle);
  });
}
