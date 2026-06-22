import { Globe, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import {
  createTauriBrowserPreviewAdapter,
  type BrowserPaneGeometry,
  type BrowserPreviewAdapter,
  browserPaneGeometryFromElement,
} from "./browser-webview";

type BrowserPreviewSurfaceProps = {
  workspaceId: string | null;
  url: string | null;
  title: string | null;
  reloadVersion: number;
  hardReloadVersion: number;
  adapter?: BrowserPreviewAdapter;
  resolveGeometry?: (element: HTMLDivElement) => Promise<BrowserPaneGeometry>;
  onBoundsChange: (bounds: BrowserPaneGeometry["captureBounds"] | null) => void;
  onError: (message: string | null) => void;
};

export function BrowserPreviewSurface({
  workspaceId,
  url,
  title,
  reloadVersion,
  hardReloadVersion,
  adapter: providedAdapter,
  resolveGeometry: providedResolveGeometry,
  onBoundsChange,
  onError,
}: BrowserPreviewSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const adapter = useMemo(
    () => providedAdapter ?? createTauriBrowserPreviewAdapter(),
    [providedAdapter],
  );
  const resolveGeometry = useMemo(
    () => providedResolveGeometry ?? browserPaneGeometryFromElement,
    [providedResolveGeometry],
  );
  const onBoundsChangeRef = useRef(onBoundsChange);
  const onErrorRef = useRef(onError);

  onBoundsChangeRef.current = onBoundsChange;
  onErrorRef.current = onError;

  useEffect(() => {
    const hostElement = hostRef.current;

    if (!workspaceId || !url || !hostElement) {
      onBoundsChangeRef.current(null);
      void adapter.detach();
      return;
    }

    let disposed = false;
    (async () => {
      try {
        const geometry = await resolveGeometry(hostElement);

        if (disposed) {
          return;
        }

        onBoundsChangeRef.current(geometry.captureBounds);
        await adapter.attach({
          workspaceId,
          url,
          webviewBounds: geometry.webviewBounds,
        });

        if (!disposed) {
          onErrorRef.current(null);
        }
      } catch (error) {
        if (!disposed) {
          onErrorRef.current(
            error instanceof Error ? error.message : `${error}`,
          );
        }
      }
    })();

    return () => {
      disposed = true;
      onBoundsChangeRef.current(null);
      void adapter.detach();
    };
  }, [workspaceId, url, adapter, resolveGeometry]);

  useEffect(() => {
    const hostElement = hostRef.current;
    if (!workspaceId || !url || !hostElement) {
      return;
    }

    let disposed = false;
    let frame: number | null = null;
    const scheduleFrame = (callback: FrameRequestCallback) => {
      if (typeof requestAnimationFrame === "function") {
        return requestAnimationFrame(callback);
      }
      return window.setTimeout(() => callback(performance.now()), 0);
    };
    const cancelFrame = (id: number) => {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(id);
      } else {
        window.clearTimeout(id);
      }
    };
    const syncBounds = () => {
      if (frame !== null) {
        cancelFrame(frame);
      }
      frame = scheduleFrame(() => {
        void (async () => {
          try {
            const geometry = await resolveGeometry(hostElement);
            if (disposed) {
              return;
            }
            onBoundsChangeRef.current(geometry.captureBounds);
            await adapter.updateBounds(geometry.webviewBounds);
          } catch (error) {
            if (!disposed) {
              onErrorRef.current(
                error instanceof Error ? error.message : `${error}`,
              );
            }
          }
        })();
      });
    };

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(syncBounds);
    observer?.observe(hostElement);
    window.addEventListener("resize", syncBounds);

    return () => {
      disposed = true;
      if (frame !== null) {
        cancelFrame(frame);
      }
      observer?.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [workspaceId, url, adapter, resolveGeometry]);

  useEffect(() => {
    if (reloadVersion <= 0 || !url) {
      return;
    }

    let disposed = false;
    (async () => {
      try {
        await adapter.reload(url);
      } catch (error) {
        if (!disposed) {
          onErrorRef.current(
            error instanceof Error ? error.message : `${error}`,
          );
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [reloadVersion, url, adapter]);

  useEffect(() => {
    if (hardReloadVersion <= 0 || !url) {
      return;
    }

    let disposed = false;
    (async () => {
      try {
        await adapter.hardReload(url);
      } catch (error) {
        if (!disposed) {
          onErrorRef.current(
            error instanceof Error ? error.message : `${error}`,
          );
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [hardReloadVersion, url, adapter]);

  if (!url) {
    return (
      <div className="browser-preview-surface" ref={hostRef}>
        <div className="browser-empty-state">
          <Globe aria-hidden="true" />
          <div>No browser preview open</div>
        </div>
      </div>
    );
  }

  return (
    <div className="browser-preview-surface" ref={hostRef}>
      <div className="browser-preview-frame" aria-label="Browser preview frame">
        <div className="browser-preview-frame-head">
          <div className="browser-preview-frame-url">
            <Globe aria-hidden="true" />
            <div className="browser-preview-frame-title-row">
              <span className="browser-preview-frame-title">{title ?? url}</span>
              <span className="browser-preview-frame-url-text">{url}</span>
            </div>
          </div>
          <RotateCw aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
