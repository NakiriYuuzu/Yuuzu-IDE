import type { Terminal as XtermTerminal } from "@xterm/xterm";
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

type TerminalTabProps = {
  sessionId: string;
  output: string;
  onInput: (sessionId: string, data: string) => void;
};

export function TerminalTab({ sessionId, output, onInput }: TerminalTabProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const writtenRef = useRef("");
  const latestOutputRef = useRef(output);
  const onInputRef = useRef(onInput);
  const [loadFailure, setLoadFailure] =
    useState<TerminalLoadFailureCopy | null>(null);

  latestOutputRef.current = output;
  onInputRef.current = onInput;

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    let inputCleanup: (() => void) | undefined;

    setLoadFailure(null);

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
        const fitAddon = new FitAddon();

        terminal.loadAddon(fitAddon);
        terminal.open(hostRef.current);
        fitAddon.fit();

        terminalRef.current = terminal;
        cleanup = createTerminalCleanup(terminal);
        terminal.write(latestOutputRef.current);
        writtenRef.current = latestOutputRef.current;

        const dataDisposable = terminal.onData((data) => {
          onInputRef.current(sessionId, data);
        });
        inputCleanup = createTerminalInputCleanup(dataDisposable);

        const resizeObserver = new ResizeObserver(() => fitAddon.fit());
        resizeObserver.observe(hostRef.current);
        cleanup = createTerminalCleanup(terminal, resizeObserver);
      } catch (error) {
        if (!disposed) {
          inputCleanup?.();
          cleanup?.();
          setLoadFailure(terminalLoadFailureCopy(error));
        }
      }
    }

    void startTerminal();

    return () => {
      disposed = true;
      inputCleanup?.();
      cleanup?.();
      terminalRef.current = null;
      writtenRef.current = "";
    };
  }, [sessionId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const previous = writtenRef.current;
    if (output.startsWith(previous)) {
      terminal.write(output.slice(previous.length));
    } else {
      terminal.clear();
      terminal.write(output);
    }
    writtenRef.current = output;
  }, [output]);

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
