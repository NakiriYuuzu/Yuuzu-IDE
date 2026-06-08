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
