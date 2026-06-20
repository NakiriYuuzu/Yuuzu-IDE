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

type TerminalDimensions = {
  rows: number;
  cols: number;
};

function normalizeTerminalDimensions(
  dimensions: TerminalDimensions | undefined,
): TerminalDimensions | null {
  if (!dimensions) return null;
  const rows = Math.floor(dimensions.rows);
  const cols = Math.floor(dimensions.cols);
  if (!Number.isFinite(rows) || !Number.isFinite(cols)) return null;
  return {
    rows: Math.max(1, rows),
    cols: Math.max(1, cols),
  };
}

function sameTerminalDimensions(
  left: TerminalDimensions | null,
  right: TerminalDimensions,
): boolean {
  return left?.rows === right.rows && left.cols === right.cols;
}

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
    let lastSentDimensions: TerminalDimensions | null = null;
    let resizeFrame: number | undefined;

    setLoadFailure(null);

    async function startTerminal() {
      try {
        const { Terminal, FitAddon, ImageAddon } = await loadXterm();

        if (disposed || !hostRef.current) {
          return;
        }

        const terminal = new Terminal({
          allowProposedApi: true,
          cursorBlink: true,
          fontSize: 13,
          theme: {
            background: "#0a0e15",
            foreground: "#e6edf3",
            cursor: "#a8e23f",
            selectionBackground: "#34421d",
          },
        });
        const imageAddon = new ImageAddon({
          enableSizeReports: true,
          pixelLimit: 16_777_216,
          sixelSupport: true,
          sixelScrolling: true,
          sixelPaletteLimit: 256,
          storageLimit: 128,
        });
        const fitAddon = new FitAddon();

        terminal.loadAddon(imageAddon);
        terminal.loadAddon(fitAddon);
        terminal.open(hostRef.current);

        cleanup = createTerminalCleanup(terminal);

        const dataDisposable = terminal.onData((data) => {
          onInputRef.current(sessionId, data);
        });
        inputCleanup = createTerminalInputCleanup(dataDisposable);

        const replay = replayTerminalOutput(sessionId);
        if (replay) {
          terminal.write(replay);
        }
        unsubscribeChunks = subscribeTerminalChunks(sessionId, (chunk) => {
          terminal.write(chunk);
        });

        // 終端機無法區分 shift+enter 與 enter(兩者都送 CR),攔截後改送 LF
        // 讓 Claude Code 之類的 TUI 視為換行(等同預設的 ctrl+j),而非送出。
        terminal.attachCustomKeyEventHandler((event) => {
          if (
            event.type === "keydown" &&
            event.key === "Enter" &&
            event.shiftKey
          ) {
            onInputRef.current(sessionId, "\n");
            return false;
          }
          return true;
        });

        const syncTerminalSize = () => {
          const dimensions = normalizeTerminalDimensions(fitAddon.proposeDimensions());
          if (!dimensions) return;

          fitAddon.fit();

          if (sameTerminalDimensions(lastSentDimensions, dimensions)) return;
          lastSentDimensions = dimensions;
          onResizeRef.current?.(sessionId, dimensions.rows, dimensions.cols);
        };

        const scheduleTerminalSizeSync = () => {
          if (resizeFrame !== undefined) return;
          const requestFrame =
            typeof globalThis.requestAnimationFrame === "function"
              ? globalThis.requestAnimationFrame.bind(globalThis)
              : (callback: FrameRequestCallback) =>
                  Number(setTimeout(() => callback(Date.now()), 0));
          resizeFrame = requestFrame(() => {
            resizeFrame = undefined;
            syncTerminalSize();
          });
        };

        syncTerminalSize();

        const resizeObserver = new ResizeObserver(() => {
          scheduleTerminalSizeSync();
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
      if (resizeFrame !== undefined) {
        if (typeof globalThis.cancelAnimationFrame === "function") {
          globalThis.cancelAnimationFrame(resizeFrame);
        } else {
          clearTimeout(resizeFrame);
        }
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
