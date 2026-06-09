/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  createTerminalCleanup,
  createTerminalInputCleanup,
} from "./terminal-lifecycle";

describe("createTerminalCleanup", () => {
  test("disposes terminal when no resize observer exists", () => {
    let disposed = false;
    const cleanup = createTerminalCleanup({
      dispose: () => {
        disposed = true;
      },
    });

    cleanup();

    expect(disposed).toBe(true);
  });

  test("disconnects resize observer before disposing terminal", () => {
    const calls: string[] = [];
    const cleanup = createTerminalCleanup(
      {
        dispose: () => {
          calls.push("dispose");
        },
      },
      {
        disconnect: () => {
          calls.push("disconnect");
        },
      },
    );

    cleanup();

    expect(calls).toEqual(["disconnect", "dispose"]);
  });
});

describe("createTerminalInputCleanup", () => {
  test("disposes the data listener", () => {
    let disposed = false;
    const cleanup = createTerminalInputCleanup({
      dispose: () => {
        disposed = true;
      },
    });

    cleanup();

    expect(disposed).toBe(true);
  });
});
