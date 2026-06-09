import { getCurrentWindow } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";
import type { Window as TauriWindow } from "@tauri-apps/api/window";

type BrowserWebviewHandle = {
  close: () => Promise<void>;
};

export type BrowserWebviewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserPaneGeometry = {
  webviewBounds: BrowserWebviewBounds;
  captureBounds: BrowserWebviewBounds;
};

export type BrowserAttachRequest = {
  workspaceId: string;
  url: string;
  webviewBounds: BrowserWebviewBounds;
};

export type BrowserPreviewAdapter = {
  attach: (request: BrowserAttachRequest) => Promise<void>;
  detach: () => Promise<void>;
  reload: (url: string) => Promise<void>;
  hardReload: (url: string) => Promise<void>;
};

type BrowserGeometryInput = {
  rect: Pick<DOMRect, "x" | "y" | "width" | "height">;
  windowPosition: { x: number; y: number };
  scaleFactor: number;
};

type BrowserTauriAdapterDependencies = {
  getCurrentWindow: () => TauriWindow;
  createWebview: (
    window: TauriWindow,
    label: string,
    options: {
      url: string;
      x: number;
      y: number;
      width: number;
      height: number;
      devtools: boolean;
    },
  ) => BrowserWebviewHandle;
};

function roundGeometry(value: number): number {
  return Math.round(value);
}

export function browserPaneGeometryFromNumbers(args: BrowserGeometryInput): BrowserPaneGeometry {
  return {
    webviewBounds: {
      x: roundGeometry(args.rect.x),
      y: roundGeometry(args.rect.y),
      width: roundGeometry(args.rect.width),
      height: roundGeometry(args.rect.height),
    },
    captureBounds: {
      x: roundGeometry(args.windowPosition.x + args.rect.x * args.scaleFactor),
      y: roundGeometry(args.windowPosition.y + args.rect.y * args.scaleFactor),
      width: roundGeometry(args.rect.width * args.scaleFactor),
      height: roundGeometry(args.rect.height * args.scaleFactor),
    },
  };
}

export function hardReloadUrl(url: string, version: number): string {
  const parsed = new URL(url, "http://localhost/");
  parsed.searchParams.set("_yuuzu_hard_reload", String(version));
  return parsed.toString();
}

export async function browserPaneGeometryFromElement(
  element: Element,
): Promise<BrowserPaneGeometry> {
  const appWindow = getCurrentWindow();
  const [windowPosition, factor] = await Promise.all([
    appWindow.innerPosition(),
    appWindow.scaleFactor(),
  ]);
  const rect = element.getBoundingClientRect();

  return browserPaneGeometryFromNumbers({
    rect,
    windowPosition,
    scaleFactor: factor,
  });
}

function sanitizeWorkspaceId(workspaceId: string): string {
  return workspaceId.replace(/[^a-zA-Z0-9_\-:/]/g, "-");
}

export function createTauriBrowserPreviewAdapter(): BrowserPreviewAdapter {
  const dependencies: BrowserTauriAdapterDependencies = {
    getCurrentWindow,
    createWebview: (window, label, options) => new Webview(window, label, options),
  };

  return createTauriBrowserPreviewAdapterWithDependencies(dependencies);
}

export function createTauriBrowserPreviewAdapterWithDependencies(
  dependencies: BrowserTauriAdapterDependencies,
): BrowserPreviewAdapter {
  let webview: BrowserWebviewHandle | null = null;
  let lastRequest: BrowserAttachRequest | null = null;
  let hardReloadVersion = 0;

  const closeCurrent = async (): Promise<void> => {
    if (!webview) {
      return;
    }

    const currentWebview = webview;
    webview = null;
    await currentWebview.close();
  };

  return {
    attach: async (request) => {
      await closeCurrent();
      const appWindow = dependencies.getCurrentWindow();
      const view = dependencies.createWebview(
        appWindow,
        `browser-preview-${sanitizeWorkspaceId(request.workspaceId)}`,
        {
          url: request.url,
          x: request.webviewBounds.x,
          y: request.webviewBounds.y,
          width: request.webviewBounds.width,
          height: request.webviewBounds.height,
          devtools: true,
        },
      );

      webview = view;
      lastRequest = request;
    },
    detach: async () => {
      await closeCurrent();
      lastRequest = null;
    },
    reload: async (url) => {
      if (!lastRequest) {
        return;
      }

      await closeCurrent();
      await thisAttach({
        ...lastRequest,
        url,
      });
    },
    hardReload: async (url) => {
      if (!lastRequest) {
        return;
      }

      hardReloadVersion += 1;
      await closeCurrent();
      await thisAttach({
        ...lastRequest,
        url: hardReloadUrl(url, hardReloadVersion),
      });
    },
  };

  async function thisAttach(request: BrowserAttachRequest): Promise<void> {
    const appWindow = dependencies.getCurrentWindow();
    const view = dependencies.createWebview(
      appWindow,
      `browser-preview-${sanitizeWorkspaceId(request.workspaceId)}`,
      {
        url: request.url,
        x: request.webviewBounds.x,
        y: request.webviewBounds.y,
        width: request.webviewBounds.width,
        height: request.webviewBounds.height,
        devtools: true,
      },
    );

    webview = view;
    lastRequest = request;
  }
}
