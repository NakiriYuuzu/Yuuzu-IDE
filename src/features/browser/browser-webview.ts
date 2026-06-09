import { getCurrentWindow } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";

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

export function hardReloadUrl(url: string, version: number): string {
  const parsed = new URL(url, "http://localhost/");
  parsed.searchParams.set("_yuuzu_hard_reload", String(version));
  return parsed.toString();
}

export async function browserPaneGeometryFromElement(
  element: Element,
): Promise<BrowserPaneGeometry> {
  const appWindow = getCurrentWindow();
  const [windowPosition, factor, rect] = await Promise.all([
    appWindow.innerPosition(),
    appWindow.scaleFactor(),
    Promise.resolve(element.getBoundingClientRect()),
  ]);

  return {
    webviewBounds: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    captureBounds: {
      x: windowPosition.x + rect.x * factor,
      y: windowPosition.y + rect.y * factor,
      width: rect.width * factor,
      height: rect.height * factor,
    },
  };
}

function sanitizeWorkspaceId(workspaceId: string): string {
  return workspaceId.replace(/[^a-zA-Z0-9_\-:/]/g, "-");
}

export function createTauriBrowserPreviewAdapter(): BrowserPreviewAdapter {
  let webview: Webview | null = null;
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
      const appWindow = getCurrentWindow();
      const view = new Webview(appWindow, `browser-preview-${sanitizeWorkspaceId(request.workspaceId)}`, {
        url: request.url,
        x: request.webviewBounds.x,
        y: request.webviewBounds.y,
        width: request.webviewBounds.width,
        height: request.webviewBounds.height,
        devtools: true,
      });

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
      hardReloadVersion += 1;
      if (!lastRequest) {
        return;
      }

      await closeCurrent();
      await thisAttach({
        ...lastRequest,
        url: hardReloadUrl(url, hardReloadVersion),
      });
    },
  };

  async function thisAttach(request: BrowserAttachRequest): Promise<void> {
    const appWindow = getCurrentWindow();
    const view = new Webview(appWindow, `browser-preview-${sanitizeWorkspaceId(request.workspaceId)}`, {
      url: request.url,
      x: request.webviewBounds.x,
      y: request.webviewBounds.y,
      width: request.webviewBounds.width,
      height: request.webviewBounds.height,
      devtools: true,
    });

    webview = view;
    lastRequest = request;
  }
}
