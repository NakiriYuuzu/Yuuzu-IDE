import type { TaskRun, WorkspaceTask } from "../tasks/task-model";

export type BrowserStatus = "idle" | "loading" | "ready" | "error";
export type BrowserConsoleLevel = "error" | "warning" | "info";

export type BrowserUrl = {
  url: string;
  host: string;
  port: number | null;
};

export type BrowserScreenshot = {
  id: string;
  workspace_root: string;
  url: string;
  title: string;
  data_url: string;
  width: number;
  height: number;
  captured_ms: number;
};

export type BrowserConsoleError = {
  message: string;
  level: BrowserConsoleLevel;
  captured_ms: number;
};

export type BrowserPreviewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserViewState = {
  urlInput: string;
  activeUrl: string | null;
  activeTitle: string | null;
  status: BrowserStatus;
  error: string | null;
  reloadVersion: number;
  hardReloadVersion: number;
  bounds: BrowserPreviewBounds | null;
  screenshots: BrowserScreenshot[];
  selectedScreenshotId: string | null;
  consoleErrors: BrowserConsoleError[];
};

export type DevServerDetectionSource = {
  detectedTasks: WorkspaceTask[];
  runs: TaskRun[];
  outputByRunId: Record<string, string>;
};

export type DevServerTarget = {
  id: string;
  label: string;
  url: string;
  source: "running-task-output" | "task-command";
};

export const MAX_SCREENSHOTS = 12;
export const MAX_CONSOLE_ERRORS = 20;

export function createBrowserState(): BrowserViewState {
  return {
    urlInput: "localhost:3000",
    activeUrl: null,
    activeTitle: null,
    status: "idle",
    error: null,
    reloadVersion: 0,
    hardReloadVersion: 0,
    bounds: null,
    screenshots: [],
    selectedScreenshotId: null,
    consoleErrors: [],
  };
}

export function setBrowserUrlInput(
  state: BrowserViewState,
  urlInput: string,
): BrowserViewState {
  return { ...state, urlInput };
}

export function openBrowserUrl(
  state: BrowserViewState,
  url: BrowserUrl,
): BrowserViewState {
  const title = stripProtocol(url.url);
  return {
    ...state,
    urlInput: url.url,
    activeUrl: url.url,
    activeTitle: title,
    status: "ready",
    error: null,
    reloadVersion: 0,
    hardReloadVersion: 0,
  };
}

export function setBrowserError(
  state: BrowserViewState,
  error: string | null,
): BrowserViewState {
  if (error === null) {
    return { ...state, error: null };
  }

  return {
    ...state,
    status: "error",
    error,
  };
}

export function reloadBrowser(state: BrowserViewState): BrowserViewState {
  if (!state.activeUrl) {
    return state;
  }

  return { ...state, status: "loading", error: null, reloadVersion: state.reloadVersion + 1 };
}

export function hardReloadBrowser(state: BrowserViewState): BrowserViewState {
  if (!state.activeUrl) {
    return state;
  }

  return {
    ...state,
    status: "loading",
    error: null,
    hardReloadVersion: state.hardReloadVersion + 1,
  };
}

export function updateBrowserBounds(
  state: BrowserViewState,
  bounds: BrowserPreviewBounds | null,
): BrowserViewState {
  return { ...state, bounds };
}

export function storeBrowserScreenshot(
  state: BrowserViewState,
  screenshot: BrowserScreenshot,
): BrowserViewState {
  const screenshots = [screenshot, ...state.screenshots].slice(0, MAX_SCREENSHOTS);
  return {
    ...state,
    screenshots,
    selectedScreenshotId: screenshot.id,
  };
}

export function addBrowserConsoleError(
  state: BrowserViewState,
  error: BrowserConsoleError,
): BrowserViewState {
  return {
    ...state,
    consoleErrors: [error, ...state.consoleErrors].slice(0, MAX_CONSOLE_ERRORS),
  };
}

export function browserScreenshotToContext(screenshot: BrowserScreenshot) {
  const labelTitle = screenshot.title || stripProtocol(screenshot.url);

  return {
    id: `screenshot:${screenshot.id}`,
    kind: "screenshot" as const,
    label: `Browser screenshot: ${labelTitle}`,
    path: null,
    content:
      `URL: ${screenshot.url}\n` +
      `Size: ${screenshot.width}x${screenshot.height}\n` +
      `Captured: ${screenshot.captured_ms}\n` +
      `Data URL: ${screenshot.data_url}`,
    truncated: false,
  };
}

export function detectDevServerTargets(
  source: DevServerDetectionSource,
): DevServerTarget[] {
  const targets: DevServerTarget[] = [];
  const seen = new Set<string>();

  const pushTarget = (url: string, id: string, label: string, source: "running-task-output" | "task-command") => {
    if (seen.has(url)) {
      return;
    }
    seen.add(url);
    targets.push({ id, label, url, source });
  };

  const runningOutputs = source.runs
    .filter((run) => run.status === "Running")
    .flatMap((run) => {
      const output = source.outputByRunId[run.id] ?? "";
      return output ? parseOutputDevServerUrls(output).map((item) => [item, run] as const) : [];
    });

  runningOutputs.forEach(([item, run], index) => {
    pushTarget(item.url, `task-output:${run.id}:${index}`, run.label, "running-task-output");
  });

  const commandDetections = source.detectedTasks.map((task, index) => ({
    id: task.id,
    label: task.label,
    command: task.command,
    index,
  }));

  for (const item of commandDetections) {
    const parsed = urlFromTaskCommand(item.command);
    if (!parsed) {
      continue;
    }

    pushTarget(
      parsed,
      `task-command:${item.id}:${item.index}`,
      item.label,
      "task-command",
    );
  }

  return targets;
}

export function urlFromTaskCommand(command: string): string | null {
  const parsedPort = parsePortFromCommand(command);
  const lowered = command.toLowerCase();

  if (/\b(?:vite)\b/u.test(lowered)) {
    const port = parsedPort ?? 5173;
    return `http://127.0.0.1:${port}`;
  }

  if (lowered.includes("next dev")) {
    const port = parsedPort ?? 3000;
    return `http://localhost:${port}`;
  }

  if (lowered.includes("astro dev")) {
    const port = parsedPort ?? 4321;
    return `http://localhost:${port}`;
  }

  if (parsedPort) {
    return `http://localhost:${parsedPort}`;
  }

  return null;
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//u, "");
}

function parsePortFromCommand(command: string): number | null {
  const direct = /(?:^|\s)(?:-p|--port)(?:=|\s+)(\d{1,5})(?:\s|$)/iu.exec(command);
  if (!direct) {
    return null;
  }

  const port = Number.parseInt(direct[1], 10);
  return Number.isFinite(port) && port > 0 && port <= 65535 ? port : null;
}

function parseOutputDevServerUrls(
  output: string,
): BrowserUrl[] {
  const matches = output.match(/\bhttps?:\/\/[^\s"'`]+/giu) ?? [];
  const parsed = matches
    .map((match) => trimTrailingPunctuation(match))
    .map(parseOutputUrl)
    .filter((item): item is BrowserUrl => item !== null);
  const deduped: BrowserUrl[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (seen.has(item.url)) {
      continue;
    }
    seen.add(item.url);
    deduped.push(item);
  }
  return deduped;
}

function parseOutputUrl(value: string): BrowserUrl | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:") {
      return null;
    }

    if (!isLocalhostHost(parsed.hostname)) {
      return null;
    }

    const port = parsed.port ? Number.parseInt(parsed.port, 10) : null;
    return { url: normalizeHttpUrl(parsed), host: parsed.hostname, port };
  } catch {
    return null;
  }
}

function isLocalhostHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[)\],.;:!?}]+$/u, "");
}

function normalizeHttpUrl(parsed: URL): string {
  return parsed.toString();
}
