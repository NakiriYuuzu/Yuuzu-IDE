type Disposable = {
  dispose: () => void;
};

type DisposableTerminal = Disposable;

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

export function createTerminalInputCleanup(disposable?: Disposable) {
  return () => {
    disposable?.dispose();
  };
}
