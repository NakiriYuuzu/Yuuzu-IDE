import { useEffect, useRef, useState } from "react";
import type { ITheme } from "@xterm/xterm";

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

const terminalThemeTokens = {
  background: ["--yz-090c12", "#090c12"],
  foreground: ["--yz-e6edf3", "#e6edf3"],
  cursor: ["--yz-a8e23f", "#a8e23f"],
  cursorAccent: ["--yz-0a0e15", "#0a0e15"],
  selectionBackground: ["--yz-34421d", "#34421d"],
  black: ["--yz-0a0e15", "#0a0e15"],
  red: ["--yz-f07178", "#f07178"],
  green: ["--yz-9ccc65", "#9ccc65"],
  yellow: ["--yz-ffcb6b", "#ffcb6b"],
  blue: ["--yz-82aaff", "#82aaff"],
  magenta: ["--yz-c792ea", "#c792ea"],
  cyan: ["--yz-6fd6c3", "#6fd6c3"],
  white: ["--yz-dbe4ec", "#dbe4ec"],
  brightBlack: ["--yz-5a6675", "#5a6675"],
  brightRed: ["--yz-f78c6c", "#f78c6c"],
  brightGreen: ["--yz-bdf04f", "#bdf04f"],
  brightYellow: ["--yz-f6a960", "#f6a960"],
  brightBlue: ["--yz-82aaff", "#82aaff"],
  brightMagenta: ["--yz-ce93d8", "#ce93d8"],
  brightCyan: ["--yz-6fd6c3", "#6fd6c3"],
  brightWhite: ["--yz-e6edf3", "#e6edf3"],
} as const satisfies Partial<Record<keyof ITheme, readonly [string, string]>>;

const codexPetSourceHue = 225;

function terminalThemeColor(tokenName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const style = document.defaultView?.getComputedStyle(document.documentElement);
  const token = style?.getPropertyValue(tokenName).trim();
  return token || fallback;
}

function parseCssRgb(color: string): [number, number, number] | null {
  const hex = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const value =
      hex.length === 3
        ? hex
            .split("")
            .map((part) => part + part)
            .join("")
        : hex;
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ];
  }

  const rgb = color
    .trim()
    .match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
  if (!rgb) return null;
  return [rgb[1], rgb[2], rgb[3]].map((part) =>
    Math.max(0, Math.min(255, Number(part))),
  ) as [number, number, number];
}

function rgbHue([red, green, blue]: [number, number, number]): number {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) return 0;
  if (max === r) return ((g - b) / delta + (g < b ? 6 : 0)) * 60;
  if (max === g) return ((b - r) / delta + 2) * 60;
  return ((r - g) / delta + 4) * 60;
}

function terminalImageFilterFromCss(): string {
  const accent = parseCssRgb(terminalThemeColor("--yz-a8e23f", "#a8e23f"));
  if (!accent) return "none";
  const hueRotation = Math.round((rgbHue(accent) - codexPetSourceHue + 360) % 360);
  return `hue-rotate(${hueRotation}deg) saturate(1.15) brightness(1.02)`;
}

function terminalThemeFromCss(): ITheme {
  return Object.fromEntries(
    Object.entries(terminalThemeTokens).map(([themeKey, [tokenName, fallback]]) => [
      themeKey,
      terminalThemeColor(tokenName, fallback),
    ]),
  ) as ITheme;
}

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
  onTitleChange?: (sessionId: string, title: string) => void;
};

export function TerminalTab({
  sessionId,
  onInput,
  onResize,
  onTitleChange,
}: TerminalTabProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const onTitleChangeRef = useRef(onTitleChange);
  const [loadFailure, setLoadFailure] =
    useState<TerminalLoadFailureCopy | null>(null);

  onInputRef.current = onInput;
  onResizeRef.current = onResize;
  onTitleChangeRef.current = onTitleChange;

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    let inputCleanup: (() => void) | undefined;
    let titleCleanup: (() => void) | undefined;
    let unsubscribeChunks: (() => void) | undefined;
    let themeObserver: MutationObserver | undefined;
    let lastSentDimensions: TerminalDimensions | null = null;
    let resizeFrame: number | undefined;

    setLoadFailure(null);

    async function startTerminal() {
      try {
        const { Terminal, FitAddon, ImageAddon } = await loadXterm();

        if (disposed || !hostRef.current) {
          return;
        }
        const host = hostRef.current;

        const terminal = new Terminal({
          allowProposedApi: true,
          cursorBlink: true,
          fontSize: 13,
          theme: terminalThemeFromCss(),
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
        terminal.open(host);

        const applyTerminalTheme = () => {
          terminal.options.theme = terminalThemeFromCss();
          host.style.setProperty(
            "--terminal-image-filter",
            terminalImageFilterFromCss(),
          );
        };
        applyTerminalTheme();
        const DocumentMutationObserver = document.defaultView?.MutationObserver;
        if (DocumentMutationObserver) {
          themeObserver = new DocumentMutationObserver(applyTerminalTheme);
          themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-yz-theme", "style", "class"],
          });
        }

        cleanup = createTerminalCleanup(terminal);

        const dataDisposable = terminal.onData((data) => {
          onInputRef.current(sessionId, data);
        });
        inputCleanup = createTerminalInputCleanup(dataDisposable);
        const titleDisposable = terminal.onTitleChange((title) => {
          onTitleChangeRef.current?.(sessionId, title);
        });
        titleCleanup = () => titleDisposable.dispose();

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
          const isShiftEnter =
            event.shiftKey &&
            (event.key === "Enter" ||
              event.keyCode === 13 ||
              event.which === 13 ||
              event.charCode === 13);

          if (
            isShiftEnter &&
            (event.type === "keydown" || event.type === "keypress")
          ) {
            event.preventDefault?.();
            event.stopPropagation?.();
            if (event.type === "keydown") {
              onInputRef.current(sessionId, "\n");
            }
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
          themeObserver?.disconnect();
          unsubscribeChunks?.();
          inputCleanup?.();
          titleCleanup?.();
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
      themeObserver?.disconnect();
      unsubscribeChunks?.();
      inputCleanup?.();
      titleCleanup?.();
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
