import { useEffect, useRef, useState } from "react";

import { call } from "../../lib/tauri";
import { loadXterm } from "./load-xterm";
import {
  terminalLoadFailureCopy,
  type TerminalLoadFailureCopy,
} from "./terminal-error";
import { createTerminalCleanup } from "./terminal-lifecycle";

export function TerminalTab() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [loadFailure, setLoadFailure] =
    useState<TerminalLoadFailureCopy | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    async function startTerminal() {
      try {
        const { Terminal, FitAddon } = await loadXterm();

        if (disposed || !hostRef.current) {
          return;
        }

        const terminal = new Terminal({
          convertEol: true,
          cursorBlink: true,
          fontSize: 13,
          theme: {
            background: "#0a0e15",
            foreground: "#e6edf3",
            cursor: "#a8e23f",
            selectionBackground: "#34421d",
          },
        });
        cleanup = createTerminalCleanup(terminal);
        const fitAddon = new FitAddon();

        terminal.loadAddon(fitAddon);
        terminal.open(hostRef.current);
        fitAddon.fit();

        const resizeObserver = new ResizeObserver(() => fitAddon.fit());
        resizeObserver.observe(hostRef.current);

        cleanup = createTerminalCleanup(terminal, resizeObserver);

        try {
          const shell = await call<string>("terminal_probe");
          if (!disposed) {
            terminal.writeln(`Yuuzu-IDE PTY probe: ${shell}`);
            terminal.writeln("Full terminal streaming is implemented after Node 0.");
          }
        } catch (error) {
          if (!disposed) {
            terminal.writeln(`Yuuzu-IDE PTY probe failed: ${String(error)}`);
          }
        }
      } catch (error) {
        if (!disposed) {
          cleanup?.();
          setLoadFailure(terminalLoadFailureCopy(error));
        }
      }
    }

    void startTerminal();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

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
