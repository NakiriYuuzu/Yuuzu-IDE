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

export const allCommands: CommandItem[] = [...node1Commands, ...node5Commands];

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
