/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { BrowserPanel } from "./BrowserPanel";
import { addBrowserConsoleError, createBrowserState } from "./browser-model";
import { ensureTestDom } from "../../app/test-dom";

ensureTestDom();

const { cleanup, fireEvent, render, screen } = await import(
  "@testing-library/react"
);

afterEach(() => {
  cleanup();
});

describe("BrowserPanel", () => {
  test("renders URL input and opens URL on Enter", () => {
    const onUrlInputChange = mock<(value: string) => void>(() => {});
    const onOpenUrl = mock<(value: string) => void>(() => {});
    const state = createBrowserState();

    render(
      <BrowserPanel
        state={state}
        devServerTargets={[]}
        canCapture={false}
        onUrlInputChange={onUrlInputChange}
        onOpenUrl={onOpenUrl}
        onOpenTarget={() => {}}
        onReload={() => {}}
        onHardReload={() => {}}
        onCapture={() => {}}
        onSelectScreenshot={() => {}}
      />,
    );

    const input = screen.getByLabelText("Browser URL") as HTMLInputElement;
    expect(input.value).toBe(state.urlInput);

    fireEvent.change(input, { target: { value: "http://localhost:5174" } });
    expect(onUrlInputChange).toHaveBeenCalledWith("http://localhost:5174");
    input.value = "http://localhost:5174";

    fireEvent.keyDown(input, {
      key: "Enter",
      target: { value: "http://localhost:5174" },
    });
    expect(onOpenUrl).toHaveBeenCalledWith("http://localhost:5174");
  });

  test("opens URL via open button", () => {
    const onOpenUrl = mock<(value: string) => void>(() => {});
    const state = createBrowserState();

    render(
      <BrowserPanel
        state={state}
        devServerTargets={[]}
        canCapture={false}
        onUrlInputChange={() => {}}
        onOpenUrl={onOpenUrl}
        onOpenTarget={() => {}}
        onReload={() => {}}
        onHardReload={() => {}}
        onCapture={() => {}}
        onSelectScreenshot={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("Open browser preview"));
    expect(onOpenUrl).toHaveBeenCalledWith(state.urlInput);
  });

  test("calls browser actions and disables capture when blocked", () => {
    const onReload = mock<() => void>(() => {});
    const onHardReload = mock<() => void>(() => {});
    const onCapture = mock<() => void>(() => {});
    const noCaptureState = createBrowserState();

    const result = render(
      <BrowserPanel
        state={noCaptureState}
        devServerTargets={[]}
        canCapture={true}
        onUrlInputChange={() => {}}
        onOpenUrl={() => {}}
        onOpenTarget={() => {}}
        onReload={onReload}
        onHardReload={onHardReload}
        onCapture={onCapture}
        onSelectScreenshot={() => {}}
      />,
    );

    expect(
      (result.getByRole("button", { name: "Capture browser screenshot" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    const stateWithUrl = {
      ...noCaptureState,
      activeUrl: "http://localhost:5173",
    };

    cleanup();

    const withPermission = render(
      <BrowserPanel
        state={stateWithUrl}
        devServerTargets={[]}
        canCapture={false}
        onUrlInputChange={() => {}}
        onOpenUrl={() => {}}
        onOpenTarget={() => {}}
        onReload={onReload}
        onHardReload={onHardReload}
        onCapture={onCapture}
        onSelectScreenshot={() => {}}
      />,
    );

    const captureButton = withPermission.getByRole("button", {
      name: "Capture browser screenshot",
    }) as HTMLButtonElement;
    expect(captureButton.disabled).toBe(true);
  });

  test("renders and triggers action buttons", () => {
    const onReload = mock<() => void>(() => {});
    const onHardReload = mock<() => void>(() => {});
    const onCapture = mock<() => void>(() => {});
    const state = {
      ...createBrowserState(),
      activeUrl: "http://localhost:5173",
    };

    render(
      <BrowserPanel
        state={state}
        devServerTargets={[]}
        canCapture={true}
        onUrlInputChange={() => {}}
        onOpenUrl={() => {}}
        onOpenTarget={() => {}}
        onReload={onReload}
        onHardReload={onHardReload}
        onCapture={onCapture}
        onSelectScreenshot={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reload preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Hard reload preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Capture browser screenshot" }));

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onHardReload).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledTimes(1);
  });

  test("renders error alert when state has error", () => {
    const state = {
      ...createBrowserState(),
      error: "preview failed",
      activeUrl: "http://localhost:5173",
    };

    render(
      <BrowserPanel
        state={state}
        devServerTargets={[]}
        canCapture={true}
        onUrlInputChange={() => {}}
        onOpenUrl={() => {}}
        onOpenTarget={() => {}}
        onReload={() => {}}
        onHardReload={() => {}}
        onCapture={() => {}}
        onSelectScreenshot={() => {}}
      />,
    );

    expect(screen.getByText("preview failed")).toBeTruthy();
  });

  test("renders dev server targets and opens one", () => {
    const onOpenTarget = mock<(url: string) => void>(() => {});
    const targets = [
      { id: "t1", label: "Frontend", url: "http://localhost:5173", source: "task-command" as const },
      { id: "t2", label: "Admin", url: "http://localhost:5174", source: "running-task-output" as const },
    ];

    render(
      <BrowserPanel
        state={createBrowserState()}
        devServerTargets={targets}
        canCapture={true}
        onUrlInputChange={() => {}}
        onOpenUrl={() => {}}
        onOpenTarget={onOpenTarget}
        onReload={() => {}}
        onHardReload={() => {}}
        onCapture={() => {}}
        onSelectScreenshot={() => {}}
      />,
    );

    const frontButton = screen.getByLabelText("Open Frontend at http://localhost:5173");
    expect(frontButton).toBeTruthy();
    fireEvent.click(frontButton);

    expect(onOpenTarget).toHaveBeenCalledWith("http://localhost:5173");
  });

  test("renders screenshot rows and selects screenshot", () => {
    const onSelectScreenshot = mock<(id: string) => void>(() => {});
    const state = {
      ...createBrowserState(),
      screenshots: [
        {
          id: "shot-1",
          workspace_root: "/repo",
          url: "http://localhost:5173",
          title: "localhost:5173",
          data_url: "data:image/png;base64,one",
          width: 1200,
          height: 720,
          captured_ms: 1_700_000_000_001,
        },
        {
          id: "shot-2",
          workspace_root: "/repo",
          url: "http://localhost:5174",
          title: "localhost:5174",
          data_url: "data:image/png;base64,two",
          width: 1200,
          height: 720,
          captured_ms: 1_700_000_000_002,
        },
      ],
      selectedScreenshotId: "shot-2",
    };

    const result = render(
      <BrowserPanel
        state={state}
        devServerTargets={[]}
        canCapture={true}
        onUrlInputChange={() => {}}
        onOpenUrl={() => {}}
        onOpenTarget={() => {}}
        onReload={() => {}}
        onHardReload={() => {}}
        onCapture={() => {}}
        onSelectScreenshot={onSelectScreenshot}
      />,
    );

    const rows = result.container.querySelectorAll(".browser-shot-row");
    expect(rows).toHaveLength(2);
    expect((rows[1] as Element).className.includes("sel")).toBe(true);

    fireEvent.click(rows[0]);
    expect(onSelectScreenshot).toHaveBeenCalledWith("shot-1");
  });

  test("renders console rows with level badges", () => {
    const state = {
      ...createBrowserState(),
      consoleErrors: [
        {
          message: "Error failed",
          level: "error" as const,
          captured_ms: 1,
        },
        {
          message: "Warning slow",
          level: "warning" as const,
          captured_ms: 2,
        },
        {
          message: "Info ok",
          level: "info" as const,
          captured_ms: 3,
        },
      ],
    };

    const result = render(
      <BrowserPanel
        state={state}
        devServerTargets={[]}
        canCapture={true}
        onUrlInputChange={() => {}}
        onOpenUrl={() => {}}
        onOpenTarget={() => {}}
        onReload={() => {}}
        onHardReload={() => {}}
        onCapture={() => {}}
        onSelectScreenshot={() => {}}
      />,
    );

    expect(result.container.querySelectorAll(".browser-console-row")).toHaveLength(3);
    expect(screen.getByText("error")).toBeTruthy();
    expect(screen.getByText("warning")).toBeTruthy();
    expect(screen.getByText("info")).toBeTruthy();
  });

  test("uses stable deduplicated console row keys", () => {
    const originalError = console.error;
    const consoleError = mock<(message?: string, ..._rest: any[]) => void>(
      () => {},
    );
    console.error = consoleError;

    try {
      const state = addBrowserConsoleError(
        addBrowserConsoleError(createBrowserState(), {
          message: "Error failed",
          level: "error",
          captured_ms: 4,
        }),
        {
          message: "Error failed",
          level: "error",
          captured_ms: 4,
        },
      );

      render(
        <BrowserPanel
          state={state}
          devServerTargets={[]}
          canCapture={true}
          onUrlInputChange={() => {}}
          onOpenUrl={() => {}}
          onOpenTarget={() => {}}
          onReload={() => {}}
          onHardReload={() => {}}
          onCapture={() => {}}
          onSelectScreenshot={() => {}}
        />,
      );

      expect(state.consoleErrors[0].id).toBeDefined();
      expect(state.consoleErrors[1].id).toBeDefined();
      expect(state.consoleErrors[0].id).not.toBe(state.consoleErrors[1].id);

      const duplicateKeyWarningCalls = consoleError.mock.calls.filter((call) =>
        typeof call[0] === "string" &&
        call[0].includes("Encountered two children with the same key"),
      );

      expect(duplicateKeyWarningCalls).toHaveLength(0);
      expect(screen.getAllByText("Error failed")).toHaveLength(2);
    } finally {
      console.error = originalError;
    }
  });
});
