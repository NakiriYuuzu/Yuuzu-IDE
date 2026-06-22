import { getCurrentWindow } from "@tauri-apps/api/window";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { Webview } from "@tauri-apps/api/webview";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import type { Window as TauriWindow } from "@tauri-apps/api/window";

type BrowserWebviewHandle = {
  close: () => Promise<void>;
  setPosition?: (position: LogicalPosition) => Promise<void>;
  setSize?: (size: LogicalSize) => Promise<void>;
  once?: (
    event: "tauri://created" | "tauri://error",
    listener: (event: unknown) => void,
  ) => Promise<UnlistenFn>;
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
  updateBounds: (bounds: BrowserWebviewBounds) => Promise<void>;
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

function eventPayloadToMessage(event: unknown): string {
  if (event instanceof Error) {
    return event.message;
  }

  if (typeof event === "string") {
    return event;
  }

  const payload =
    typeof event === "object" &&
    event !== null &&
    "payload" in event
      ? (event as { payload?: unknown }).payload
      : undefined;

  if (payload instanceof Error) {
    return payload.message;
  }

  if (typeof payload === "string") {
    return payload;
  }

  return `${event}`;
}

function createWebviewLabel(workspaceId: string): string {
  return `browser-preview-${sanitizeWorkspaceId(workspaceId)}`;
}

function ensureCreateCompletes(
  view: BrowserWebviewHandle,
): Promise<void> {
  if (!view.once) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    if (!view.once) {
      return;
    }

    let finalized = false;
    const finish = (fn: () => void) => {
      if (finalized) {
        return;
      }
      finalized = true;
      fn();
    };

    const onCreated = () => {
      finish(resolve);
    };
    const onError = (event: unknown) => {
      finish(() => reject(new Error(eventPayloadToMessage(event))));
    };

    void view.once("tauri://created", onCreated);
    void view.once("tauri://error", onError);
  });
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
  let pendingOperation: Promise<unknown> = Promise.resolve();

  const queueOperation = <T,>(operation: () => Promise<T>): Promise<T> => {
    const next = pendingOperation.then(operation, operation);
    pendingOperation = next.then(() => undefined, () => undefined);
    return next;
  };

  const closeCurrent = async (): Promise<void> => {
    if (!webview) {
      return;
    }

    const currentWebview = webview;
    await currentWebview.close();
    if (webview === currentWebview) {
      webview = null;
    }
  };

  const createAndAwait = async (
    request: BrowserAttachRequest,
  ): Promise<void> => {
    const appWindow = dependencies.getCurrentWindow();
    const view = dependencies.createWebview(
      appWindow,
      createWebviewLabel(request.workspaceId),
      {
        url: request.url,
        x: request.webviewBounds.x,
        y: request.webviewBounds.y,
        width: request.webviewBounds.width,
        height: request.webviewBounds.height,
        devtools: true,
      },
    );

    await ensureCreateCompletes(view);

    webview = view;
    lastRequest = request;
  };

  return {
    attach: async (request) => {
      await queueOperation(async () => {
        await closeCurrent();
        await createAndAwait(request);
      });
    },
    detach: async () => {
      await queueOperation(async () => {
        await closeCurrent();
        lastRequest = null;
      });
    },
    reload: async (url) => {
      await queueOperation(async () => {
        if (!lastRequest) {
          return;
        }

        await closeCurrent();
        await createAndAwait({
          ...lastRequest,
          url,
        });
      });
    },
    hardReload: async (url) => {
      await queueOperation(async () => {
        if (!lastRequest) {
          return;
        }

        hardReloadVersion += 1;
        await closeCurrent();
        await createAndAwait({
          ...lastRequest,
          url: hardReloadUrl(url, hardReloadVersion),
        });
      });
    },
    updateBounds: async (bounds) => {
      await queueOperation(async () => {
        if (!webview || !lastRequest) {
          return;
        }

        if (!webview.setPosition || !webview.setSize) {
          return;
        }

        await webview.setPosition(new LogicalPosition(bounds.x, bounds.y));
        await webview.setSize(new LogicalSize(bounds.width, bounds.height));
        lastRequest = { ...lastRequest, webviewBounds: bounds };
      });
    },
  };
}
