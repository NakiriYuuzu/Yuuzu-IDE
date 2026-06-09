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

  useEffect(() => {
    const hostElement = hostRef.current;

    if (!workspaceId || !url || !hostElement) {
      onBoundsChange(null);
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

        onBoundsChange(geometry.captureBounds);
        await adapter.attach({
          workspaceId,
          url,
          webviewBounds: geometry.webviewBounds,
        });

        if (!disposed) {
          onError(null);
        }
      } catch (error) {
        if (!disposed) {
          onError(error instanceof Error ? error.message : `${error}`);
        }
      }
    })();

    return () => {
      disposed = true;
      onBoundsChange(null);
      void adapter.detach();
    };
  }, [workspaceId, url, adapter, resolveGeometry, onBoundsChange, onError]);

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
          onError(error instanceof Error ? error.message : `${error}`);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [reloadVersion, url, adapter, onError]);

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
          onError(error instanceof Error ? error.message : `${error}`);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [hardReloadVersion, url, adapter, onError]);

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
