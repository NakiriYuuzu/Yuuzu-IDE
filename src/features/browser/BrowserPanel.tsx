import {
  AlertCircle,
  AlertTriangle,
  Camera,
  Globe,
  RotateCw,
  RotateCcw,
  Search,
} from "lucide-react";

import { BrowserPreviewSurface } from "./BrowserPreviewSurface";
import {
  type BrowserConsoleError,
  type BrowserViewState,
  type DevServerTarget,
  type BrowserUrl,
} from "./browser-model";

type BrowserPanelProps = {
  state: BrowserViewState;
  devServerTargets: DevServerTarget[];
  canCapture: boolean;
  onUrlInputChange: (value: string) => void;
  onOpenUrl: (value: string) => void;
  onOpenTarget: (url: string) => void;
  onReload: () => void;
  onHardReload: () => void;
  onCapture: () => void;
  onSelectScreenshot: (id: string) => void;
};

function consoleBadgeLevel(error: BrowserConsoleError): string {
  if (error.level === "error") {
    return "danger";
  }

  if (error.level === "warning") {
    return "warn";
  }

  return "";
}

function consoleBadgeIcon(error: BrowserConsoleError) {
  if (error.level === "error") {
    return <AlertCircle aria-hidden="true" />;
  }

  if (error.level === "warning") {
    return <AlertTriangle aria-hidden="true" />;
  }

  return <Search aria-hidden="true" />;
}

export function BrowserPanel({
  state,
  devServerTargets,
  canCapture,
  onUrlInputChange,
  onOpenUrl,
  onOpenTarget,
  onReload,
  onHardReload,
  onCapture,
  onSelectScreenshot,
}: BrowserPanelProps) {
  const canCaptureNow = Boolean(state.activeUrl) && canCapture;
  const activeUrl = state.activeUrl as BrowserUrl["url"] | null;

  return (
    <div className="panel-body browser-panel">
      <div className="browser-preview-surface-wrap">
        <BrowserPreviewSurface
          workspaceId={null}
          url={activeUrl}
          title={state.activeTitle}
          reloadVersion={state.reloadVersion}
          hardReloadVersion={state.hardReloadVersion}
          onBoundsChange={() => {}}
          onError={() => {}}
        />
      </div>

      <div className="browser-url-row">
        <input
          type="text"
          className="input2 mono browser-url-input"
          aria-label="Browser URL"
          value={state.urlInput}
          onChange={(event) => onUrlInputChange(event.currentTarget.value)}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
              onOpenUrl(event.currentTarget.value);
            }
          }}
        />
        <button
          type="button"
          className="btn"
          title="Open browser preview"
          aria-label="Open browser preview"
          onClick={() => onOpenUrl(state.urlInput)}
        >
          <Globe aria-hidden="true" />
          Open
        </button>
      </div>

      <div className="browser-panel-actions">
        <button
          type="button"
          className="btn"
          title="Reload preview"
          aria-label="Reload preview"
          onClick={onReload}
        >
          <RotateCw aria-hidden="true" />
          Reload
        </button>
        <button
          type="button"
          className="btn"
          title="Hard reload preview"
          aria-label="Hard reload preview"
          onClick={onHardReload}
        >
          <RotateCcw aria-hidden="true" />
          Hard reload
        </button>
        <button
          type="button"
          className="btn"
          title="Capture browser screenshot"
          aria-label="Capture browser screenshot"
          disabled={!canCaptureNow}
          onClick={onCapture}
        >
          <Camera aria-hidden="true" />
          Capture
        </button>
      </div>

      {state.error ? (
        <div className="panel-error-inline browser-error">{state.error}</div>
      ) : null}

      <section>
        <div className="section-label">
          <span>Dev servers</span>
          <span>{devServerTargets.length}</span>
        </div>
        {devServerTargets.length > 0 ? (
          devServerTargets.map((target) => (
            <button
              type="button"
              className="row browser-target-row"
              key={target.id}
              aria-label={`Open ${target.label} at ${target.url}`}
              onClick={() => onOpenTarget(target.url)}
            >
              <Globe aria-hidden="true" />
              <span className="nm mono">{target.label}</span>
              <span className="meta">{target.url}</span>
            </button>
          ))
        ) : (
          <div className="panel-empty">No dev servers detected</div>
        )}
      </section>

      <section>
        <div className="section-label">
          <span>Screenshots</span>
          <span>{state.screenshots.length}</span>
        </div>
        {state.screenshots.length > 0 ? (
          state.screenshots.map((screenshot) => (
            <button
              type="button"
              className={`row browser-shot-row${
                state.selectedScreenshotId === screenshot.id ? " sel" : ""
              }`}
              key={screenshot.id}
              onClick={() => onSelectScreenshot(screenshot.id)}
            >
              <span className="browser-shot-title">{screenshot.title}</span>
              <span className="browser-shot-meta">
                {screenshot.width}x{screenshot.height}
              </span>
            </button>
          ))
        ) : (
          <div className="panel-empty">No screenshots</div>
        )}
      </section>

      <section>
        <div className="section-label">
          <span>Console</span>
          <span>{state.consoleErrors.length}</span>
        </div>
        {state.consoleErrors.length > 0 ? (
          state.consoleErrors.map((entry) => (
            <div
              className="row browser-console-row"
              key={`${entry.captured_ms}:${entry.level}:${entry.message}`}
            >
              <span
                className={`badge2${consoleBadgeLevel(entry) ? ` ${consoleBadgeLevel(entry)}` : ""}`}
              >
                {consoleBadgeIcon(entry)}
                <span>{entry.level}</span>
              </span>
              <span className="browser-console-message">{entry.message}</span>
            </div>
          ))
        ) : (
          <div className="panel-empty">No console messages</div>
        )}
      </section>
    </div>
  );
}
