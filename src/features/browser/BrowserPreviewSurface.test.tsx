/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { BrowserPreviewSurface } from "./BrowserPreviewSurface";
import {
  browserPaneGeometryFromNumbers,
  createTauriBrowserPreviewAdapterWithDependencies,
  hardReloadUrl,
  type BrowserPaneGeometry,
} from "./browser-webview";
import { ensureTestDom } from "../../app/test-dom";

ensureTestDom();

const { cleanup, render, screen, waitFor } = await import(
  "@testing-library/react"
);

afterEach(() => {
  cleanup();
});

const fixedGeometry: BrowserPaneGeometry = {
  webviewBounds: {
    x: 0,
    y: 0,
    width: 640,
    height: 360,
  },
  captureBounds: {
    x: 10,
    y: 20,
    width: 640,
    height: 360,
  },
};

const stableResolveGeometry = async () => fixedGeometry;

function fakeAdapter() {
  return {
    attach: mock(async () => {}),
    detach: mock(async () => {}),
    reload: mock(async () => {}),
    hardReload: mock(async () => {}),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });

  return { promise, resolve };
}

type BrowserAdapterWindow = Parameters<
  typeof createTauriBrowserPreviewAdapterWithDependencies
>[0]["getCurrentWindow"] extends () => infer WindowType
  ? WindowType
  : never;

describe("BrowserPreviewSurface", () => {
  test("renders empty state and does not attach without active URL", () => {
    const adapter = fakeAdapter();
    const onBoundsChange = mock<(bounds: unknown) => void>(() => {});

    render(
      <BrowserPreviewSurface
        workspaceId="workspace-1"
        url={null}
        title={null}
        reloadVersion={0}
        hardReloadVersion={0}
        adapter={adapter}
        onBoundsChange={onBoundsChange}
        onError={mock(() => {})}
      />,
    );

    expect(screen.getByText("No browser preview open")).toBeTruthy();
    expect(screen.queryByLabelText("Browser preview frame")).toBeNull();
    expect(adapter.attach).toHaveBeenCalledTimes(0);
  });

  test("attaches adapter when URL is active and resolves pane geometry", async () => {
    const adapter = fakeAdapter();
    const onBoundsChange = mock<(bounds: unknown) => void>(() => {});

    render(
      <BrowserPreviewSurface
        workspaceId="workspace-1"
        url="http://localhost:5173"
        title="localhost:5173"
        reloadVersion={0}
        hardReloadVersion={0}
        adapter={adapter}
        resolveGeometry={stableResolveGeometry}
        onBoundsChange={onBoundsChange}
        onError={mock(() => {})}
      />,
    );

    expect(screen.getByLabelText("Browser preview frame")).toBeTruthy();
    expect(screen.getByText("localhost:5173")).toBeTruthy();
    expect(screen.getByText("http://localhost:5173")).toBeTruthy();

    await waitFor(() => {
      expect(adapter.attach).toHaveBeenCalledTimes(1);
    });

    expect(adapter.attach).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      url: "http://localhost:5173",
      webviewBounds: fixedGeometry.webviewBounds,
    });

    await waitFor(() => {
      expect(onBoundsChange).toHaveBeenCalledWith(fixedGeometry.captureBounds);
    });
  });

  test("calls adapter.reload when reloadVersion increases", async () => {
    const adapter = fakeAdapter();
    const onBoundsChange = mock<(bounds: unknown) => void>(() => {});
    const onError = mock<(message: string | null) => void>(() => {});
    const surface = render(
      <BrowserPreviewSurface
        workspaceId="workspace-1"
        url="http://localhost:5173"
        title="localhost:5173"
        reloadVersion={0}
        hardReloadVersion={0}
        adapter={adapter}
        resolveGeometry={stableResolveGeometry}
        onBoundsChange={onBoundsChange}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(adapter.attach).toHaveBeenCalledTimes(1);
    });

    surface.rerender(
      <BrowserPreviewSurface
        workspaceId="workspace-1"
        url="http://localhost:5173"
        title="localhost:5173"
        reloadVersion={1}
        hardReloadVersion={0}
        adapter={adapter}
        resolveGeometry={stableResolveGeometry}
        onBoundsChange={onBoundsChange}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(adapter.reload).toHaveBeenCalledTimes(1);
    });

    expect(adapter.attach).toHaveBeenCalledTimes(1);
    expect(adapter.reload).toHaveBeenCalledWith("http://localhost:5173");
  });

  test("calls adapter.hardReload when hardReloadVersion increases", async () => {
    const adapter = fakeAdapter();
    const onBoundsChange = mock<(bounds: unknown) => void>(() => {});
    const onError = mock<(message: string | null) => void>(() => {});

    const surface = render(
      <BrowserPreviewSurface
        workspaceId="workspace-1"
        url="http://localhost:5173"
        title="localhost:5173"
        reloadVersion={0}
        hardReloadVersion={0}
        adapter={adapter}
        resolveGeometry={stableResolveGeometry}
        onBoundsChange={onBoundsChange}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(adapter.attach).toHaveBeenCalledTimes(1);
    });

    surface.rerender(
      <BrowserPreviewSurface
        workspaceId="workspace-1"
        url="http://localhost:5173"
        title="localhost:5173"
        reloadVersion={0}
        hardReloadVersion={1}
        adapter={adapter}
        resolveGeometry={stableResolveGeometry}
        onBoundsChange={onBoundsChange}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(adapter.hardReload).toHaveBeenCalledTimes(1);
    });

    expect(adapter.attach).toHaveBeenCalledTimes(1);
    expect(adapter.hardReload).toHaveBeenCalledWith("http://localhost:5173");
  });

  test("does not reattach when only callback identities change", async () => {
    const adapter = fakeAdapter();
    const firstOnBoundsChange = mock<(bounds: unknown) => void>(() => {});
    const firstOnError = mock<(message: string | null) => void>(() => {});

    const surface = render(
      <BrowserPreviewSurface
        workspaceId="workspace-1"
        url="http://localhost:5173"
        title="localhost:5173"
        reloadVersion={0}
        hardReloadVersion={0}
        adapter={adapter}
        resolveGeometry={stableResolveGeometry}
        onBoundsChange={firstOnBoundsChange}
        onError={firstOnError}
      />,
    );

    await waitFor(() => {
      expect(adapter.attach).toHaveBeenCalledTimes(1);
    });

    const secondOnBoundsChange = mock<(bounds: unknown) => void>(() => {});
    const secondOnError = mock<(message: string | null) => void>(() => {});

    surface.rerender(
      <BrowserPreviewSurface
        workspaceId="workspace-1"
        url="http://localhost:5173"
        title="localhost:5173"
        reloadVersion={0}
        hardReloadVersion={0}
        adapter={adapter}
        resolveGeometry={stableResolveGeometry}
        onBoundsChange={secondOnBoundsChange}
        onError={secondOnError}
      />,
    );

    expect(adapter.detach).toHaveBeenCalledTimes(0);
    expect(adapter.attach).toHaveBeenCalledTimes(1);
    expect(firstOnBoundsChange).toHaveBeenCalledTimes(1);
    expect(firstOnError).toHaveBeenCalledTimes(1);
    expect(secondOnBoundsChange).toHaveBeenCalledTimes(0);
    expect(secondOnError).toHaveBeenCalledTimes(0);
    surface.unmount();
  });
});

describe("browser webview adapter geometry", () => {
  test("rounds webview and capture geometry to integers", () => {
    const geometry = browserPaneGeometryFromNumbers({
      rect: {
        x: 10.4,
        y: 20.6,
        width: 640.5,
        height: 360.4,
      },
      windowPosition: {
        x: 15.6,
        y: 7.2,
      },
      scaleFactor: 1.2,
    });

    expect(geometry).toEqual({
      webviewBounds: {
        x: 10,
        y: 21,
        width: 641,
        height: 360,
      },
      captureBounds: {
        x: 28,
        y: 32,
        width: 769,
        height: 432,
      },
    });
  });

  test("does not increment hard reload version when request is missing", async () => {
    const openedUrls: string[] = [];
    const fakeWindow = {} as BrowserAdapterWindow;

    const adapter = createTauriBrowserPreviewAdapterWithDependencies({
      getCurrentWindow: () => fakeWindow,
      createWebview: (_window, _label, options) => {
        openedUrls.push(options.url);
        return {
          close: mock(async () => {}),
        };
      },
    });

    await adapter.hardReload("http://localhost:5173");
    expect(openedUrls).toEqual([]);

    await adapter.attach({
      workspaceId: "workspace-1",
      url: "http://localhost:5173",
      webviewBounds: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
      },
    });

    await adapter.hardReload("http://localhost:5173");
    expect(openedUrls).toHaveLength(2);
    expect(hardReloadUrl("http://localhost:5173", 1)).toBe(openedUrls[1]);

    await adapter.hardReload("http://localhost:5173");
    expect(openedUrls).toHaveLength(3);
    expect(hardReloadUrl("http://localhost:5173", 2)).toBe(openedUrls[2]);
  });

  test("waits for prior close before creating replacement webview", async () => {
    const closeGate = deferred<void>();
    const events: string[] = [];
    const fakeWindow = {} as BrowserAdapterWindow;

    const adapter = createTauriBrowserPreviewAdapterWithDependencies({
      getCurrentWindow: () => fakeWindow,
      createWebview: (_window, _label, options) => {
        events.push(`create:${options.url}`);
        return {
          close: mock(async () => {
            events.push(`close:${options.url}:start`);
            await closeGate.promise;
            events.push(`close:${options.url}:end`);
          }),
          once: (event, listener) => {
            if (event === "tauri://created") {
              listener(undefined);
            }
          },
        };
      },
    });

    await adapter.attach({
      workspaceId: "workspace-1",
      url: "http://localhost:5173",
      webviewBounds: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
      },
    });

    const detachPromise = adapter.detach();
    const attachPromise = adapter.attach({
      workspaceId: "workspace-1",
      url: "http://localhost:5173/home",
      webviewBounds: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
      },
    });

    await Promise.resolve();
    closeGate.resolve();
    await Promise.all([detachPromise, attachPromise]);

    expect(events).toEqual([
      "create:http://localhost:5173",
      "close:http://localhost:5173:start",
      "close:http://localhost:5173:end",
      "create:http://localhost:5173/home",
    ]);
  });

  test("does not update request state when webview creation fails", async () => {
    const openedUrls: string[] = [];
    const fakeWindow = {} as BrowserAdapterWindow;
    let triggerError: ((event: unknown) => void) | null = null;

    const adapter = createTauriBrowserPreviewAdapterWithDependencies({
      getCurrentWindow: () => fakeWindow,
      createWebview: (_window, _label, options) => {
        openedUrls.push(options.url);
        return {
          close: mock(async () => {}),
          once: (event, listener) => {
            if (event === "tauri://error") {
              triggerError = listener;
            }
          },
        };
      },
    });

    const attachPromise = adapter.attach({
      workspaceId: "workspace-1",
      url: "http://localhost:5173",
      webviewBounds: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!triggerError) {
      throw new Error("No webview error handler registered");
    }
    (triggerError as (event: unknown) => void)({ payload: "creation failed" });

    await expect(attachPromise).rejects.toThrow("creation failed");

    await adapter.reload("http://localhost:5173");
    expect(openedUrls).toHaveLength(1);
  });
});
