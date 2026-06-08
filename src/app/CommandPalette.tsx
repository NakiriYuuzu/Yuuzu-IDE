import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { filterCommands, node1Commands } from "./command-palette-model";

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  onRun: (id: string) => void;
};

export function CommandPalette({ open, onClose, onRun }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const commands = useMemo(() => filterCommands(node1Commands, query), [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  function closePalette() {
    setQuery("");
    onClose();
  }

  if (!open) {
    return null;
  }

  return (
    <div className="palette-backdrop" onMouseDown={closePalette}>
      <div
        className="palette"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="Search or run a command"
            aria-label="Search commands"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="iconbtn palette-close"
            title="Close command palette"
            aria-label="Close command palette"
            onClick={closePalette}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="palette-list">
          {commands.map((command) => (
            <button
              type="button"
              className="palette-item"
              key={command.id}
              onClick={() => onRun(command.id)}
            >
              <span>{command.label}</span>
              <small>{command.group}</small>
            </button>
          ))}
          {commands.length === 0 ? (
            <div className="palette-empty">No matching commands</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
