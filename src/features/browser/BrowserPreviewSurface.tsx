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
