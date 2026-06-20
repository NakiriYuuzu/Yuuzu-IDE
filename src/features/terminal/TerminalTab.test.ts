/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test";
import React from "react";

import { ensureTestDom } from "../../test/test-dom";

const loadXtermMock = mock<() => Promise<unknown>>();

mock.module("./load-xterm", () => ({
  loadXterm: loadXtermMock,
}));

ensureTestDom();

class ControlledResizeObserver {
  static instances: ControlledResizeObserver[] = [];
  callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
    ControlledResizeObserver.instances.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {}
  trigger() {
    this.callback();
  }
}

globalThis.ResizeObserver =
  ControlledResizeObserver as unknown as typeof ResizeObserver;

const { TerminalTab } = await import("./TerminalTab");
const { appendTerminalReplayOutput, clearTerminalReplayOutput } = await import(
  "./terminal-replay-buffer"
);

async function waitUntil(assertion: () => void) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
}

const terminalThemeVars: Record<string, string> = {
  "--yz-090c12": "#101820",
  "--yz-e6edf3": "#e6edf3",
  "--yz-a8e23f": "#a8e23f",
  "--yz-34421d": "#34421d",
  "--yz-0a0e15": "#0a0e15",
  "--yz-f07178": "#f07178",
  "--yz-9ccc65": "#9ccc65",
  "--yz-ffcb6b": "#ffcb6b",
  "--yz-82aaff": "#82aaff",
  "--yz-c792ea": "#c792ea",
  "--yz-6fd6c3": "#6fd6c3",
  "--yz-dbe4ec": "#dbe4ec",
  "--yz-5a6675": "#5a6675",
  "--yz-f78c6c": "#f78c6c",
  "--yz-bdf04f": "#bdf04f",
  "--yz-f6a960": "#f6a960",
  "--yz-ce93d8": "#ce93d8",
};

function setTerminalThemeVars(overrides: Record<string, string> = {}) {
  for (const [name, value] of Object.entries({
    ...terminalThemeVars,
    ...overrides,
  })) {
    document.documentElement.style.setProperty(name, value);
  }
}

function clearTerminalThemeVars() {
  for (const name of Object.keys(terminalThemeVars)) {
    document.documentElement.style.removeProperty(name);
  }
}

function installAnimationFrameMock() {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  let nextFrameId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const frameId = nextFrameId;
    nextFrameId += 1;
    callbacks.set(frameId, callback);
    return frameId;
  }) as typeof requestAnimationFrame;

  globalThis.cancelAnimationFrame = ((frameId: number) => {
    callbacks.delete(frameId);
  }) as typeof cancelAnimationFrame;

  return {
    pendingCount: () => callbacks.size,
    flush: () => {
      const queuedCallbacks = [...callbacks.values()];
      callbacks.clear();
      queuedCallbacks.forEach((callback) => callback(0));
    },
    restore: () => {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    },
  };
}

class FakeTerminal {
  static instances: FakeTerminal[] = [];
  options: Record<string, unknown>;
  addons: unknown[] = [];
  writes: string[] = [];
  dataHandlers: Array<(data: string) => void> = [];
  clearCalls = 0;
  keyHandler: ((event: KeyboardEvent) => boolean) | undefined;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeTerminal.instances.push(this);
  }

  loadAddon(addon: unknown) {
    this.addons.push(addon);
  }
  open() {}
  write(data: string) {
    this.writes.push(data);
    if (data === "\x1b[c") {
      this.emitData("\x1b[?62;4;9;22c");
    }
  }
  clear() {
    this.clearCalls += 1;
  }
  dispose() {}
  onData(handler: (data: string) => void) {
    this.dataHandlers.push(handler);
    return {
      dispose: () => {
        this.dataHandlers = this.dataHandlers.filter((item) => item !== handler);
      },
    };
  }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
    this.keyHandler = handler;
  }
  emitData(data: string) {
    this.dataHandlers.forEach((handler) => handler(data));
  }
}

class FakeFitAddon {
  static instances: FakeFitAddon[] = [];
  static proposed: { rows: number; cols: number } | undefined = {
    rows: 30,
    cols: 100,
  };
  fitCalls = 0;

  constructor() {
    FakeFitAddon.instances.push(this);
  }

  fit() {
    this.fitCalls += 1;
  }
  proposeDimensions() {
    return FakeFitAddon.proposed;
  }
}

class FakeImageAddon {
  static instances: FakeImageAddon[] = [];
  options: Record<string, unknown>;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeImageAddon.instances.push(this);
  }
}

function fakeXterm() {
  return {
    Terminal: FakeTerminal,
    FitAddon: FakeFitAddon,
    ImageAddon: FakeImageAddon,
  };
}

async function mountTerminalTab(
  sessionId: string,
  onResize?: (sessionId: string, rows: number, cols: number) => void,
  onInput?: (sessionId: string, data: string) => void,
) {
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  flushSync(() => {
    root.render(
      React.createElement(TerminalTab, {
        sessionId,
        onInput: onInput ?? (() => {}),
        onResize,
      }),
    );
  });

  return {
    container,
    unmount: () => {
      root.unmount();
      container.remove();
    },
  };
}

describe("TerminalTab output pipeline", () => {
  test("replays buffered output once on mount and writes live chunks directly", async () => {
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-1");
    appendTerminalReplayOutput("w:tab-1", "boot\n");

    const mounted = await mountTerminalTab("w:tab-1");
    await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));
    const terminal = FakeTerminal.instances[0]!;
    await waitUntil(() => expect(terminal.writes).toEqual(["boot\n"]));

    appendTerminalReplayOutput("w:tab-1", "live-1");
    appendTerminalReplayOutput("w:tab-1", "live-2");

    expect(terminal.writes).toEqual(["boot\n", "live-1", "live-2"]);
    expect(terminal.clearCalls).toBe(0);

    mounted.unmount();
    clearTerminalReplayOutput("w:tab-1");
    loadXtermMock.mockReset();
  });

  test("chunks arriving while xterm is still loading are replayed exactly once", async () => {
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    let resolveLoad!: (value: unknown) => void;
    loadXtermMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    clearTerminalReplayOutput("w:tab-2");

    const mounted = await mountTerminalTab("w:tab-2");
    appendTerminalReplayOutput("w:tab-2", "early\n");
    resolveLoad(fakeXterm());

    await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));
    const terminal = FakeTerminal.instances[0]!;
    await waitUntil(() => expect(terminal.writes).toEqual(["early\n"]));

    appendTerminalReplayOutput("w:tab-2", "late\n");
    expect(terminal.writes).toEqual(["early\n", "late\n"]);
    expect(terminal.clearCalls).toBe(0);

    mounted.unmount();
    clearTerminalReplayOutput("w:tab-2");
    loadXtermMock.mockReset();
  });

  test("output beyond the 120k replay bound keeps streaming without clear", async () => {
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-3");
    appendTerminalReplayOutput("w:tab-3", "x".repeat(120_000));

    const mounted = await mountTerminalTab("w:tab-3");
    await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));
    const terminal = FakeTerminal.instances[0]!;
    await waitUntil(() => expect(terminal.writes.length).toBe(1));

    appendTerminalReplayOutput("w:tab-3", "overflow-chunk");

    expect(terminal.writes[1]).toBe("overflow-chunk");
    expect(terminal.clearCalls).toBe(0);

    mounted.unmount();
    clearTerminalReplayOutput("w:tab-3");
    loadXtermMock.mockReset();
  });

  test("does not opt into convertEol for real PTY output", async () => {
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-4");

    const mounted = await mountTerminalTab("w:tab-4");
    await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));

    expect(FakeTerminal.instances[0]!.options.convertEol).toBeUndefined();

    mounted.unmount();
    clearTerminalReplayOutput("w:tab-4");
    loadXtermMock.mockReset();
  });

  test("uses Yuuzu CSS tokens for the xterm color palette", async () => {
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    setTerminalThemeVars();
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-theme");

    const mounted = await mountTerminalTab("w:tab-theme");
    await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));

    expect(FakeTerminal.instances[0]!.options.theme).toMatchObject({
      background: "#101820",
      foreground: "#e6edf3",
      cursor: "#a8e23f",
      selectionBackground: "#34421d",
      red: "#f07178",
      green: "#9ccc65",
      yellow: "#ffcb6b",
      blue: "#82aaff",
      magenta: "#c792ea",
      cyan: "#6fd6c3",
      brightBlack: "#5a6675",
      brightGreen: "#bdf04f",
    });

    mounted.unmount();
    clearTerminalThemeVars();
    clearTerminalReplayOutput("w:tab-theme");
    loadXtermMock.mockReset();
  });

  test("updates the xterm theme when the app theme attribute changes", async () => {
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    const previousTheme = document.documentElement.getAttribute("data-yz-theme");
    document.documentElement.setAttribute("data-yz-theme", "dark");
    setTerminalThemeVars();
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-theme-change");

    const mounted = await mountTerminalTab("w:tab-theme-change");
    await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));
    const terminal = FakeTerminal.instances[0]!;
    expect((terminal.options.theme as Record<string, string>).background).toBe(
      "#101820",
    );

    setTerminalThemeVars({
      "--yz-090c12": "#f7f9fc",
      "--yz-e6edf3": "#1b2430",
      "--yz-a8e23f": "#5e8c14",
      "--yz-34421d": "#d8eab8",
      "--yz-82aaff": "#2a6fdb",
    });
    document.documentElement.setAttribute("data-yz-theme", "light");

    await waitUntil(() =>
      expect(terminal.options.theme).toMatchObject({
        background: "#f7f9fc",
        foreground: "#1b2430",
        cursor: "#5e8c14",
        selectionBackground: "#d8eab8",
        blue: "#2a6fdb",
      }),
    );

    mounted.unmount();
    if (previousTheme) {
      document.documentElement.setAttribute("data-yz-theme", previousTheme);
    } else {
      document.documentElement.removeAttribute("data-yz-theme");
    }
    clearTerminalThemeVars();
    clearTerminalReplayOutput("w:tab-theme-change");
    loadXtermMock.mockReset();
  });

  test("tints terminal image layers from the active theme accent", async () => {
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    const previousTheme = document.documentElement.getAttribute("data-yz-theme");
    document.documentElement.setAttribute("data-yz-theme", "dark");
    setTerminalThemeVars();
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-image-theme");

    const mounted = await mountTerminalTab("w:tab-image-theme");
    await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));
    const host = mounted.container.querySelector(".terminal-host") as HTMLElement;

    expect(host.style.getPropertyValue("--terminal-image-filter")).toBe(
      "hue-rotate(216deg) saturate(1.15) brightness(1.02)",
    );

    setTerminalThemeVars({
      "--yz-a8e23f": "#5e8c14",
    });
    document.documentElement.setAttribute("data-yz-theme", "light");

    await waitUntil(() =>
      expect(host.style.getPropertyValue("--terminal-image-filter")).toBe(
        "hue-rotate(218deg) saturate(1.15) brightness(1.02)",
      ),
    );

    mounted.unmount();
    if (previousTheme) {
      document.documentElement.setAttribute("data-yz-theme", previousTheme);
    } else {
      document.documentElement.removeAttribute("data-yz-theme");
    }
    clearTerminalThemeVars();
    clearTerminalReplayOutput("w:tab-image-theme");
    loadXtermMock.mockReset();
  });

  test("syncs the PTY to the fitted dimensions on mount", async () => {
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    FakeFitAddon.proposed = { rows: 30, cols: 100 };
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-6");
    const resizeCalls: Array<[string, number, number]> = [];

    const mounted = await mountTerminalTab("w:tab-6", (sessionId, rows, cols) =>
      resizeCalls.push([sessionId, rows, cols]),
    );
    await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));

    expect(resizeCalls).toEqual([["w:tab-6", 30, 100]]);

    mounted.unmount();
    clearTerminalReplayOutput("w:tab-6");
    loadXtermMock.mockReset();
  });

  test("coalesces resize observer ticks and syncs the PTY in the animation frame", async () => {
    const raf = installAnimationFrameMock();
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    ControlledResizeObserver.instances = [];
    FakeFitAddon.proposed = { rows: 30, cols: 100 };
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-7");
    const resizeCalls: Array<[string, number, number]> = [];

    const mounted = await mountTerminalTab("w:tab-7", (sessionId, rows, cols) =>
      resizeCalls.push([sessionId, rows, cols]),
    );
    await waitUntil(() =>
      expect(ControlledResizeObserver.instances.length).toBe(1),
    );
    const observer = ControlledResizeObserver.instances[0]!;
    const fitAddon = FakeFitAddon.instances[0]!;
    resizeCalls.length = 0;

    FakeFitAddon.proposed = { rows: 48, cols: 180 };
    observer.trigger();
    observer.trigger();

    expect(resizeCalls).toEqual([]);
    expect(raf.pendingCount()).toBe(1);

    raf.flush();

    expect(resizeCalls).toEqual([["w:tab-7", 48, 180]]);
    expect(fitAddon.fitCalls).toBe(2);

    mounted.unmount();
    raf.restore();
    clearTerminalReplayOutput("w:tab-7");
    loadXtermMock.mockReset();
  });

  test("does not notify the PTY again when fitted dimensions are unchanged", async () => {
    const raf = installAnimationFrameMock();
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    ControlledResizeObserver.instances = [];
    FakeFitAddon.proposed = { rows: 30, cols: 100 };
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-10");
    const resizeCalls: Array<[string, number, number]> = [];

    const mounted = await mountTerminalTab("w:tab-10", (sessionId, rows, cols) =>
      resizeCalls.push([sessionId, rows, cols]),
    );
    await waitUntil(() =>
      expect(ControlledResizeObserver.instances.length).toBe(1),
    );
    const observer = ControlledResizeObserver.instances[0]!;
    resizeCalls.length = 0;

    observer.trigger();
    raf.flush();

    expect(resizeCalls).toEqual([]);

    mounted.unmount();
    raf.restore();
    clearTerminalReplayOutput("w:tab-10");
    loadXtermMock.mockReset();
  });

  test("cancels pending terminal resize frames on unmount", async () => {
    const raf = installAnimationFrameMock();
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    ControlledResizeObserver.instances = [];
    FakeFitAddon.proposed = { rows: 30, cols: 100 };
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-11");
    const resizeCalls: Array<[string, number, number]> = [];

    const mounted = await mountTerminalTab("w:tab-11", (sessionId, rows, cols) =>
      resizeCalls.push([sessionId, rows, cols]),
    );
    await waitUntil(() =>
      expect(ControlledResizeObserver.instances.length).toBe(1),
    );
    const observer = ControlledResizeObserver.instances[0]!;
    resizeCalls.length = 0;

    FakeFitAddon.proposed = { rows: 50, cols: 200 };
    observer.trigger();
    expect(raf.pendingCount()).toBe(1);

    mounted.unmount();
    raf.flush();

    expect(resizeCalls).toEqual([]);

    raf.restore();
    clearTerminalReplayOutput("w:tab-11");
    loadXtermMock.mockReset();
  });

  test("skips resize notifications when no dimensions can be proposed", async () => {
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    FakeFitAddon.proposed = undefined;
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-8");
    const resizeCalls: Array<[string, number, number]> = [];

    const mounted = await mountTerminalTab("w:tab-8", (sessionId, rows, cols) =>
      resizeCalls.push([sessionId, rows, cols]),
    );
    await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));

    expect(resizeCalls).toEqual([]);

    mounted.unmount();
    clearTerminalReplayOutput("w:tab-8");
    FakeFitAddon.proposed = { rows: 30, cols: 100 };
    loadXtermMock.mockReset();
  });

  test("loads image support before opening the terminal", async () => {
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-12");

    const mounted = await mountTerminalTab("w:tab-12");
    await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));

    const terminal = FakeTerminal.instances[0]!;
    expect(terminal.options.allowProposedApi).toBe(true);
    expect(FakeImageAddon.instances).toHaveLength(1);
    expect(FakeImageAddon.instances[0]!.options).toEqual({
      enableSizeReports: true,
      pixelLimit: 16_777_216,
      sixelSupport: true,
      sixelScrolling: true,
      sixelPaletteLimit: 256,
      storageLimit: 128,
    });
    expect(terminal.addons[0]).toBe(FakeImageAddon.instances[0]);
    expect(terminal.addons).toContain(FakeFitAddon.instances[0]);

    mounted.unmount();
    clearTerminalReplayOutput("w:tab-12");
    loadXtermMock.mockReset();
  });

  test("forwards image capability replies generated while replaying buffered output", async () => {
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-13");
    appendTerminalReplayOutput("w:tab-13", "\x1b[c");
    const inputs: Array<[string, string]> = [];

    const mounted = await mountTerminalTab(
      "w:tab-13",
      undefined,
      (sessionId, data) => inputs.push([sessionId, data]),
    );
    await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));

    expect(FakeTerminal.instances[0]!.writes).toEqual(["\x1b[c"]);
    expect(inputs).toEqual([["w:tab-13", "\x1b[?62;4;9;22c"]]);

    mounted.unmount();
    clearTerminalReplayOutput("w:tab-13");
    loadXtermMock.mockReset();
  });

  test("stops writing chunks after unmount", async () => {
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-5");

    const mounted = await mountTerminalTab("w:tab-5");
    await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));
    const terminal = FakeTerminal.instances[0]!;

    mounted.unmount();
    appendTerminalReplayOutput("w:tab-5", "after-unmount");

    expect(terminal.writes).toEqual([]);

    clearTerminalReplayOutput("w:tab-5");
    loadXtermMock.mockReset();
  });

  test("sends a newline on shift+enter instead of submitting", async () => {
    FakeTerminal.instances = [];
    FakeFitAddon.instances = [];
    FakeImageAddon.instances = [];
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-9");
    const inputs: Array<[string, string]> = [];

    const mounted = await mountTerminalTab(
      "w:tab-9",
      undefined,
      (sessionId, data) => inputs.push([sessionId, data]),
    );
    await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));
    const terminal = FakeTerminal.instances[0]!;
    await waitUntil(() => expect(terminal.keyHandler).toBeDefined());

    const shiftEnter = terminal.keyHandler!({
      type: "keydown",
      key: "Enter",
      shiftKey: true,
    } as KeyboardEvent);

    expect(shiftEnter).toBe(false);
    expect(inputs).toEqual([["w:tab-9", "\n"]]);

    const plainEnter = terminal.keyHandler!({
      type: "keydown",
      key: "Enter",
      shiftKey: false,
    } as KeyboardEvent);

    expect(plainEnter).toBe(true);
    expect(inputs).toEqual([["w:tab-9", "\n"]]);

    mounted.unmount();
    clearTerminalReplayOutput("w:tab-9");
    loadXtermMock.mockReset();
  });
});
