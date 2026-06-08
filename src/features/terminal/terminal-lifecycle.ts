type DisposableTerminal = {
  dispose: () => void;
};

type DisposableResizeObserver = {
  disconnect: () => void;
};

export function createTerminalCleanup(
  terminal: DisposableTerminal,
  resizeObserver?: DisposableResizeObserver,
) {
  return () => {
    resizeObserver?.disconnect();
    terminal.dispose();
  };
}
