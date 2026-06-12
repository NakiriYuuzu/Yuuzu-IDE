import { useEffect, useRef, useState } from "react";

import { loadXterm } from "./load-xterm";
import {
  terminalLoadFailureCopy,
  type TerminalLoadFailureCopy,
} from "./terminal-error";
import {
  createTerminalCleanup,
  createTerminalInputCleanup,
} from "./terminal-lifecycle";
import {
  replayTerminalOutput,
  subscribeTerminalChunks,
} from "./terminal-replay-buffer";

const RESIZE_NOTIFY_DEBOUNCE_MS = 100;

type TerminalTabProps = {
  sessionId: string;
  onInput: (sessionId: string, data: string) => void;
  onResize?: (sessionId: string, rows: number, cols: number) => void;
};

export function TerminalTab({ sessionId, onInput, onResize }: TerminalTabProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const [loadFailure, setLoadFailure] =
    useState<TerminalLoadFailureCopy | null>(null);

  onInputRef.current = onInput;
  onResizeRef.current = onResize;

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    let inputCleanup: (() => void) | undefined;
    let unsubscribeChunks: (() => void) | undefined;
    let resizeNotifyTimer: ReturnType<typeof setTimeout> | undefined;

    setLoadFailure(null);

    async function startTerminal() {
      try {
        const { Terminal, FitAddon } = await loadXterm();

        if (disposed || !hostRef.current) {
          return;
        }

        const terminal = new Terminal({
          cursorBlink: true,
          fontSize: 13,
          theme: {
            background: "#0a0e15",
            foreground: "#e6edf3",
            cursor: "#a8e23f",
            selectionBackground: "#34421d",
          },
        });
        const fitAddon = new FitAddon();

        terminal.loadAddon(fitAddon);
        terminal.open(hostRef.current);
        fitAddon.fit();

        cleanup = createTerminalCleanup(terminal);

        const replay = replayTerminalOutput(sessionId);
        if (replay) {
          terminal.write(replay);
        }
        unsubscribeChunks = subscribeTerminalChunks(sessionId, (chunk) => {
          terminal.write(chunk);
        });

        const dataDisposable = terminal.onData((data) => {
          onInputRef.current(sessionId, data);
        });
        inputCleanup = createTerminalInputCleanup(dataDisposable);

        const notifyPtySize = () => {
          const dimensions = fitAddon.proposeDimensions();
          if (dimensions) {
            onResizeRef.current?.(sessionId, dimensions.rows, dimensions.cols);
          }
        };
        notifyPtySize();

        const resizeObserver = new ResizeObserver(() => {
          fitAddon.fit();
          if (resizeNotifyTimer !== undefined) {
            clearTimeout(resizeNotifyTimer);
          }
          resizeNotifyTimer = setTimeout(notifyPtySize, RESIZE_NOTIFY_DEBOUNCE_MS);
        });
        resizeObserver.observe(hostRef.current);
        cleanup = createTerminalCleanup(terminal, resizeObserver);
      } catch (error) {
        if (!disposed) {
          unsubscribeChunks?.();
          inputCleanup?.();
          cleanup?.();
          setLoadFailure(terminalLoadFailureCopy(error));
        }
      }
    }

    void startTerminal();

    return () => {
      disposed = true;
      if (resizeNotifyTimer !== undefined) {
        clearTimeout(resizeNotifyTimer);
      }
      unsubscribeChunks?.();
      inputCleanup?.();
      cleanup?.();
    };
  }, [sessionId]);

  if (loadFailure) {
    return (
      <div className="terminal-failure" role="alert">
        <span>{loadFailure.title}</span>
        <p>{loadFailure.detail}</p>
      </div>
    );
  }

  return <div ref={hostRef} className="terminal-host" />;
}
