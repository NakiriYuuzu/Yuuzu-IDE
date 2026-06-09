/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  addBrowserConsoleError,
  setBrowserError,
  browserScreenshotToContext,
  createBrowserState,
  detectDevServerTargets,
  MAX_CONSOLE_ERRORS,
  MAX_SCREENSHOTS,
  updateBrowserBounds,
  openBrowserUrl,
  reloadBrowser,
  hardReloadBrowser,
  setBrowserUrlInput,
  storeBrowserScreenshot,
  type BrowserScreenshot,
} from "./browser-model";

function withScreenshot(index: number, capturedMs = index): BrowserScreenshot {
  return {
    id: `shot-${index}`,
    workspace_root: "/repo",
    url: "http://localhost:5173",
    title: "localhost:5173",
    data_url: "data:image/png;base64,iVBORw0KGgo=",
    width: 1920,
    height: 1080,
    captured_ms: capturedMs,
  };
}

describe("browser model", () => {
  test("opens URL and sets input, active URL and status", () => {
    const state = openBrowserUrl(createBrowserState(), {
      url: "http://localhost:5173/app",
      host: "localhost",
      port: 5173,
    });

    expect(state.urlInput).toBe("http://localhost:5173/app");
    expect(state.activeUrl).toBe("http://localhost:5173/app");
    expect(state.status).toBe("ready");
    expect(state.activeTitle).toBe("localhost:5173/app");
    expect(state.error).toBeNull();
  });

  test("openBrowserUrl strips protocol for title and preserves path", () => {
    const state = openBrowserUrl(createBrowserState(), {
      url: "http://localhost:5173/app?tab=preview#top",
      host: "localhost",
      port: 5173,
    });

    expect(state.activeTitle).toBe("localhost:5173/app?tab=preview#top");
  });

  test("updates URL input independently from active URL", () => {
    const typed = setBrowserUrlInput(createBrowserState(), "http://localhost:5173");
    expect(typed.urlInput).toBe("http://localhost:5173");
    expect(typed.activeUrl).toBe(null);
    expect(typed.activeTitle).toBe(null);
    expect(typed.status).toBe("idle");
  });

  test("tracks normal and hard reload counters separately", () => {
    const opened = openBrowserUrl(createBrowserState(), {
      url: "http://localhost:5173",
      host: "localhost",
      port: 5173,
    });

    const reloaded = reloadBrowser(opened);
    expect(reloaded.reloadVersion).toBe(1);
    expect(reloaded.hardReloadVersion).toBe(0);

    const hardReloaded = hardReloadBrowser(reloaded);
    expect(hardReloaded.reloadVersion).toBe(1);
    expect(hardReloaded.hardReloadVersion).toBe(1);
  });

  test("does not increment reload counters while idle", () => {
    const idle = createBrowserState();
    expect(reloadBrowser(idle)).toEqual(idle);
    expect(hardReloadBrowser(idle)).toEqual(idle);
  });

  test("does not reload when there is no active URL even with error state", () => {
    const withError = setBrowserError(createBrowserState(), "network issue");
    expect(reloadBrowser(withError)).toEqual(withError);
    expect(hardReloadBrowser(withError)).toEqual(withError);
  });

  test("setBrowserError accepts null to clear the current error", () => {
    const opened = openBrowserUrl(createBrowserState(), {
      url: "http://localhost:5173",
      host: "localhost",
      port: 5173,
    });
    const withError = setBrowserError(opened, "network issue");

    expect(withError.error).toBe("network issue");

    const cleared = setBrowserError(withError, null);
    expect(cleared.error).toBeNull();
    expect(cleared.status).toBe(withError.status);
  });

  test("detects dev server targets from running output first then command fallbacks", () => {
    const state = {
      detectedTasks: [
        {
          id: "detected:vite",
          label: "Frontend",
          command: "vite",
          cwd: "/repo",
          source: "npm",
        },
        {
          id: "detected:next",
          label: "Next",
          command: "next dev -p 3010",
          cwd: "/repo",
          source: "npm",
        },
        {
          id: "detected:astro",
          label: "Docs",
          command: "astro dev",
          cwd: "/repo",
          source: "npm",
        },
      ],
      runs: [
        {
          id: "run-1",
          workspace_id: "workspace-1",
          label: "Docs",
          command: "astro dev",
          cwd: "/repo",
          status: "Running" as const,
          exit_code: null,
        },
      ],
      outputByRunId: {
        "run-1": "ready at http://localhost:4321/docs",
      },
    };

    const targets = detectDevServerTargets(state);
    expect(targets.map((item) => item.url)).toEqual([
      "http://localhost:4321/docs",
      "http://127.0.0.1:5173",
      "http://localhost:3010",
      "http://localhost:4321",
    ]);
  });

  test("ignores https output URLs and accepts IPv6 loopback output URLs", () => {
    const targets = detectDevServerTargets({
      detectedTasks: [],
      runs: [
        {
          id: "run-https",
          workspace_id: "workspace-1",
          label: "Server",
          command: "vite",
          cwd: "/repo",
          status: "Running" as const,
          exit_code: null,
        },
        {
          id: "run-ipv6",
          workspace_id: "workspace-1",
          label: "IPv6",
          command: "vite",
          cwd: "/repo",
          status: "Running" as const,
          exit_code: null,
        },
      ],
      outputByRunId: {
        "run-https": "running at https://localhost:5173",
        "run-ipv6": "ready at http://[::1]:8080/",
      },
    });

    expect(targets).toEqual([
      {
        id: "task-output:run-ipv6:0",
        label: "IPv6",
        url: "http://[::1]:8080/",
        source: "running-task-output",
      },
    ]);
  });

  test("keeps newest screenshot first and drops oldest over limit", () => {
    const withScreenshots = Array.from({ length: MAX_SCREENSHOTS }, (_, index) =>
      withScreenshot(index + 1, index + 1),
    ).reduce(storeBrowserScreenshot, createBrowserState());

    const next = storeBrowserScreenshot(
      { ...withScreenshots },
      withScreenshot(MAX_SCREENSHOTS + 1, MAX_SCREENSHOTS + 1),
    );

    expect(next.screenshots).toHaveLength(MAX_SCREENSHOTS);
    expect(next.screenshots[0].id).toBe(`shot-${MAX_SCREENSHOTS + 1}`);
    expect(next.screenshots[MAX_SCREENSHOTS - 1].id).toBe("shot-2");
    expect(next.screenshots.some((item) => item.id === "shot-1")).toBe(false);
  });

  test("browserScreenshotToContext converts latest screenshot for agent context", () => {
    const context = browserScreenshotToContext(withScreenshot(3));

    expect(context).toEqual({
      id: "screenshot:shot-3",
      kind: "screenshot",
      label: "Browser screenshot: localhost:5173",
      path: null,
      content:
        "URL: http://localhost:5173\n" +
        "Size: 1920x1080\n" +
        "Captured: 3\n" +
        "Data URL: data:image/png;base64,iVBORw0KGgo=",
      truncated: false,
    });
  });

  test("adds screenshot metadata to agent context content", () => {
    const context = browserScreenshotToContext({
      ...withScreenshot(11, 1234),
      width: 123,
      height: 77,
    });

    expect(context.content).toContain("URL: http://localhost:5173");
    expect(context.content).toContain("Size: 123x77");
    expect(context.content).toContain("Captured: 1234");
    expect(context.content).toContain("Data URL: data:image/png;base64,iVBORw0KGgo=");
  });

  test("falls back screenshot label title from URL when screenshot title is empty", () => {
    const context = browserScreenshotToContext({
      ...withScreenshot(22, 5678),
      title: "",
      url: "http://localhost:5173/path?x=1",
    });

    expect(context.label).toBe("Browser screenshot: localhost:5173/path?x=1");
  });

  test("addBrowserConsoleError bounds console errors without clearing screenshots", () => {
    const screenshotState = storeBrowserScreenshot(createBrowserState(), withScreenshot(1));
    const withErrors = Array.from({ length: MAX_CONSOLE_ERRORS + 5 }, (_, index) => ({
      message: `Error ${index + 1}`,
      level: index % 2 === 0 ? ("error" as const) : ("warning" as const),
      captured_ms: 1000 + index,
    })).reduce<ReturnType<typeof createBrowserState>>(
      (nextState, error) => addBrowserConsoleError(nextState, error),
      screenshotState,
    );

    expect(withErrors.consoleErrors).toHaveLength(MAX_CONSOLE_ERRORS);
    expect(withErrors.consoleErrors[0].message).toBe("Error 25");
    expect(withErrors.screenshots).toHaveLength(1);
  });

  test("adds unique ids to duplicate console errors captured at the same time", () => {
    const baseState = createBrowserState();
    const first = addBrowserConsoleError(baseState, {
      message: "Same message",
      level: "error",
      captured_ms: 1700000000000,
    });
    const second = addBrowserConsoleError(first, {
      message: "Same message",
      level: "error",
      captured_ms: 1700000000000,
    });

    expect(first.consoleErrors[0].id).toBeDefined();
    expect(second.consoleErrors[0].id).toBeDefined();
    expect(first.consoleErrors[0].id).not.toBe(second.consoleErrors[0].id);
    expect(second.consoleErrors[0].id).not.toBe(first.consoleErrors[0].id);
    expect(second.consoleErrors[0].message).toBe("Same message");
    expect(first.consoleErrors[0].level).toBe("error");
  });

  test("preserves provided browser console error ids", () => {
    const state = addBrowserConsoleError(createBrowserState(), {
      id: "manual-console-id",
      message: "Manual id",
      level: "warning",
      captured_ms: 1700000000001,
    });

    expect(state.consoleErrors[0].id).toBe("manual-console-id");
  });

  test("updateBrowserBounds accepts null", () => {
    const bounds = { x: 1, y: 2, width: 100, height: 200 };
    const updated = updateBrowserBounds(createBrowserState(), bounds);
    expect(updated.bounds).toEqual(bounds);

    const cleared = updateBrowserBounds(updated, null);
    expect(cleared.bounds).toBeNull();
  });

  test("infers localhost URL from generic command with explicit port", () => {
    const targets = detectDevServerTargets({
      detectedTasks: [
        {
          id: "serve",
          label: "Serve",
          command: "serve --port 4444",
          cwd: "/repo",
          source: "npm",
        },
      ],
      runs: [],
      outputByRunId: {},
    } satisfies {
      detectedTasks: Array<{
        id: string;
        label: string;
        command: string;
        cwd: string;
        source: string;
      }>;
      runs: [];
      outputByRunId: Record<string, string>;
    });

    expect(targets).toEqual([
      {
        id: "task-command:serve:0",
        label: "Serve",
        url: "http://localhost:4444",
        source: "task-command",
      },
    ]);
  });

  test("does not classify vitest command as vite dev server", () => {
    const targets = detectDevServerTargets({
      detectedTasks: [
        {
          id: "run-vitest",
          label: "Test",
          command: "vitest --run",
          cwd: "/repo",
          source: "npm",
        },
        {
          id: "run-vite",
          label: "Vite",
          command: "vite --host 127.0.0.1",
          cwd: "/repo",
          source: "npm",
        },
      ],
      runs: [],
      outputByRunId: {},
    } satisfies {
      detectedTasks: Array<{
        id: string;
        label: string;
        command: string;
        cwd: string;
        source: string;
      }>;
      runs: [];
      outputByRunId: Record<string, string>;
    });

    expect(targets).toEqual([
      {
        id: "task-command:run-vite:1",
        label: "Vite",
        url: "http://127.0.0.1:5173",
        source: "task-command",
      },
    ]);
  });
});
