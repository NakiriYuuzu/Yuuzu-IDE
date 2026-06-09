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

function fakeAdapter() {
  return {
    attach: mock(async () => {}),
    detach: mock(async () => {}),
    reload: mock(async () => {}),
    hardReload: mock(async () => {}),
  };
}

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
        resolveGeometry={async () => fixedGeometry}
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
        resolveGeometry={async () => fixedGeometry}
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
        resolveGeometry={async () => fixedGeometry}
        onBoundsChange={onBoundsChange}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(adapter.reload).toHaveBeenCalledTimes(1);
    });

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
        resolveGeometry={async () => fixedGeometry}
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
        resolveGeometry={async () => fixedGeometry}
        onBoundsChange={onBoundsChange}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(adapter.hardReload).toHaveBeenCalledTimes(1);
    });

    expect(adapter.hardReload).toHaveBeenCalledWith("http://localhost:5173");
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
    const fakeWindow = {} as unknown as Parameters<typeof createTauriBrowserPreviewAdapterWithDependencies>[0]["getCurrentWindow"] extends () => infer T
      ? T
      : never;

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
});
