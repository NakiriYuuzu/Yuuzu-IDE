/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test";
import React from "react";

import { ensureTestDom } from "../../app/test-dom";

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

class FakeTerminal {
  static instances: FakeTerminal[] = [];
  options: Record<string, unknown>;
  writes: string[] = [];
  clearCalls = 0;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeTerminal.instances.push(this);
  }

  loadAddon() {}
  open() {}
  write(data: string) {
    this.writes.push(data);
  }
  clear() {
    this.clearCalls += 1;
  }
  dispose() {}
  onData() {
    return { dispose: () => {} };
  }
}

class FakeFitAddon {
  static proposed: { rows: number; cols: number } | undefined = {
    rows: 30,
    cols: 100,
  };

  fit() {}
  proposeDimensions() {
    return FakeFitAddon.proposed;
  }
}

function fakeXterm() {
  return { Terminal: FakeTerminal, FitAddon: FakeFitAddon };
}

async function mountTerminalTab(
  sessionId: string,
  onResize?: (sessionId: string, rows: number, cols: number) => void,
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
        onInput: () => {},
        onResize,
      }),
    );
  });

  return {
    unmount: () => {
      root.unmount();
      container.remove();
    },
  };
}

describe("TerminalTab output pipeline", () => {
  test("replays buffered output once on mount and writes live chunks directly", async () => {
    FakeTerminal.instances = [];
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
    loadXtermMock.mockResolvedValueOnce(fakeXterm());
    clearTerminalReplayOutput("w:tab-4");

    const mounted = await mountTerminalTab("w:tab-4");
    await waitUntil(() => expect(FakeTerminal.instances.length).toBe(1));

    expect(FakeTerminal.instances[0]!.options.convertEol).toBeUndefined();

    mounted.unmount();
    clearTerminalReplayOutput("w:tab-4");
    loadXtermMock.mockReset();
  });

  test("syncs the PTY to the fitted dimensions on mount", async () => {
    FakeTerminal.instances = [];
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

  test("debounces resize notifications after container resizes", async () => {
    FakeTerminal.instances = [];
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
    resizeCalls.length = 0;

    FakeFitAddon.proposed = { rows: 48, cols: 180 };
    observer.trigger();
    observer.trigger();
    expect(resizeCalls).toEqual([]);

    await waitUntil(() =>
      expect(resizeCalls).toEqual([["w:tab-7", 48, 180]]),
    );

    mounted.unmount();
    clearTerminalReplayOutput("w:tab-7");
    loadXtermMock.mockReset();
  });

  test("skips resize notifications when no dimensions can be proposed", async () => {
    FakeTerminal.instances = [];
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

  test("stops writing chunks after unmount", async () => {
    FakeTerminal.instances = [];
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
});
