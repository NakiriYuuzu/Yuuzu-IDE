/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  addBrowserConsoleError,
  browserScreenshotToContext,
  createBrowserState,
  detectDevServerTargets,
  MAX_CONSOLE_ERRORS,
  MAX_SCREENSHOTS,
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
    expect(state.status).toBe("loading");
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
      content: "data:image/png;base64,iVBORw0KGgo=",
      truncated: false,
    });
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
});
