/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  createAgentState,
  activeAgentSession,
  type AgentSession,
  type AgentViewState,
} from "../features/agents/agent-model";
import { createLanguageState } from "../features/language/language-model";
import { createDocsState } from "../features/docs/docs-model";
import {
  createBrowserState,
  type BrowserUrl,
  type BrowserScreenshot,
} from "../features/browser/browser-model";
import {
  createDatabaseState,
  type DatabaseQueryResult,
  type DatabaseQueryRequest,
  type DatabaseQueryHistoryEntry,
  type DatabaseProfile,
  type DatabaseViewState,
  type DatabaseSchema,
  type DatabaseTable,
} from "../features/database/database-model";
import {
  collectAgentAvailableContext,
  activeLoadedFileForWorkspace,
  PanelBody,
  BrowserPreviewSplitSurface,
  shouldShowBrowserSplitEditor,
  openBrowserPreviewWithValidation,
  startBrowserValidationRequest,
  isLatestBrowserValidationRequest,
  startBrowserCaptureRequest,
  isLatestBrowserCaptureRequest,
  captureBrowserPreviewWithValidation,
  databaseTableSql,
  classifyDatabaseSql,
  executeDatabaseQueryRequest,
  inspectDatabaseProfileRequest,
  refreshDatabaseProfilesRequest,
  exportDatabaseQueryResultRequest,
  type BrowserCaptureRequestState,
  type BrowserValidationRequestState,
  type AgentAvailableContextSource,
} from "./AppShell";
import { ensureTestDom } from "./test-dom";
import { workspaceStore } from "./workspace-store";
import { workspaceViewStore } from "./workspace-view-state";

ensureTestDom();

const { cleanup, fireEvent, render } = await import("@testing-library/react");

function makeSession(id: string, path = "src/app/AppShell.tsx"): AgentSession {
  return {
    id,
    workspace_root: "/repo",
    mode: "plan",
    prompt: "Draft",
    context_items: [
      {
        id: `file:${path}`,
        kind: "file",
        label: path,
        path,
        content: "shell",
        truncated: false,
      },
    ],
    transcript: [],
    created_ms: 1,
    updated_ms: 2,
  };
}

function databaseState(
  overrides: Partial<DatabaseViewState> = {},
): DatabaseViewState {
  return {
    ...createDatabaseState(),
    ...overrides,
  };
}

type WorkspaceContext = {
  workspaceId: string;
  workspaceRoot: string;
  profileId: string;
};

function setupWorkspace(
  overrides: Partial<WorkspaceContext> = {},
): WorkspaceContext {
  const workspaceId = overrides.workspaceId ?? "ws-task5";
  const workspaceRoot = overrides.workspaceRoot ?? "/repo";
  const profileId = overrides.profileId ?? "db-local";

  workspaceStore.getState().setRegistry({
    active_workspace_id: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        path: workspaceRoot,
        name: workspaceId,
        pinned: false,
      },
    ],
  });
  workspaceViewStore.getState().updateDatabase(workspaceId, () => ({
    ...createDatabaseState(),
    activeProfileId: profileId,
    profiles: [
      {
        id: profileId,
        workspace_root: workspaceRoot,
        name: `${profileId}.db`,
        kind: "SQLite",
        source: { SQLite: { path: `${workspaceRoot}/${profileId}.db` } },
        read_only: false,
        production: false,
        created_ms: 1,
        updated_ms: 1,
      },
    ],
  }));

  return { workspaceId, workspaceRoot, profileId };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });

  return { promise, resolve, reject };
}

function setDatabase(
  workspaceId: string,
  update: (state: DatabaseViewState) => DatabaseViewState,
): void {
  workspaceViewStore.getState().updateDatabase(workspaceId, update);
}

afterEach(() => {
  cleanup();
});

describe("AppShell AppShell helpers", () => {
  test("PanelBody renders BrowserPanel for browser activity", () => {
    const onBrowserOpenTarget = mock<(url: string) => void>(() => {});
    const state = {
      ...createBrowserState(),
      activeUrl: "http://localhost:5173",
      urlInput: "http://localhost:5173",
      activeTitle: "localhost:5173",
      status: "ready" as const,
    };

    const renderResult = render(
      <PanelBody
        active="browser"
        refreshKey={0}
        activeFilePath="src/app/AppShell.tsx"
        terminalSessions={[]}
        activeTerminalId={null}
        terminalCwdInput=""
        terminalError={null}
        taskState={{
          detectedTasks: [],
          runs: [],
          activeRunId: null,
          outputByRunId: {},
          problemsByRunId: {},
          pendingOutputByRunId: {},
          pendingFinishByRunId: {},
          contextPackByRunId: {},
          customCommand: "",
        }}
        taskError={null}
        gitState={{
          status: null,
          loading: false,
          error: null,
          commitMessage: "",
          selectedDiff: null,
          diffByKey: {},
          branches: [],
          graph: [],
        }}
        docsState={createDocsState()}
        contextPackNameById={{}}
        gitDecorations={{}}
        agentState={createAgentState()}
        availableAgentContext={[]}
        onAgentModeChange={() => {}}
        onAgentPromptChange={() => {}}
        onAgentToggleContext={() => {}}
        onAgentStartSession={() => {}}
        onAgentSelectSession={() => {}}
        onAgentApprove={() => {}}
        onAgentReject={() => {}}
        onAgentExport={() => {}}
        onOpenFile={() => Promise.resolve()}
        onCreateFile={async () => {}}
        onRenamePath={async () => {}}
        onDeletePath={async () => {}}
        onTerminalCwdInputChange={() => {}}
        onNewTerminal={() => Promise.resolve()}
        onActivateTerminal={() => {}}
        onCloseTerminal={() => Promise.resolve()}
        onRestartTerminal={() => Promise.resolve()}
        onTaskCustomCommandChange={() => {}}
        onRunTask={() => {}}
        onRunCustomTask={() => {}}
        onActivateTaskRun={() => {}}
        onStopTaskRun={() => Promise.resolve()}
        onRerunTaskRun={() => {}}
        onGitRefresh={() => Promise.resolve()}
        onGitCommitMessageChange={() => {}}
        onGitCommit={() => {}}
        onGitStage={() => {}}
        onGitUnstage={() => {}}
        onGitDiscard={() => {}}
        onGitOpenDiff={() => {}}
        onGitStash={() => {}}
        onGitFetch={() => {}}
        onGitPull={() => {}}
        onGitPush={() => {}}
        onGitCheckoutBranch={() => {}}
        onGitCreateBranch={() => {}}
        onGitOpenGraph={() => {}}
        onDocsRefresh={() => Promise.resolve()}
        onDocsSearch={() => {}}
        onDocsOpenPreview={() => Promise.resolve()}
        onDocsToggleSource={() => {}}
        onDocsPackNameChange={() => {}}
        onDocsCreatePack={() => Promise.resolve()}
        onDocsSelectPack={() => {}}
        onDocsDeletePack={() => Promise.resolve()}
        onDocsUsePackForActiveTask={() => Promise.resolve()}
        onDocsLinkPackToAgentSession={() => Promise.resolve()}
        onLanguageOpenDiagnostic={() => {}}
        onLanguageRefresh={() => Promise.resolve()}
        onLanguageRestartServer={() => {}}
        browserState={state}
        browserTargets={[
          {
            id: "t1",
            label: "Frontend",
            url: "http://localhost:5173",
            source: "task-command",
          },
          {
            id: "t2",
            label: "Admin",
            url: "http://localhost:5173/admin",
            source: "running-task-output",
          },
        ]}
        browserCanCapture={true}
        onBrowserUrlInputChange={() => {}}
        onBrowserOpenUrl={() => {}}
        onBrowserOpenTarget={onBrowserOpenTarget}
        onBrowserReload={() => {}}
        onBrowserHardReload={() => {}}
        onBrowserCapture={() => {}}
        onBrowserSelectScreenshot={() => {}}
        databaseState={createDatabaseState()}
        onDatabaseRefreshProfiles={() => {}}
        onDatabaseSelectProfile={() => {}}
        onDatabaseInspectProfile={() => {}}
        onDatabaseOpenTable={() => {}}
        onDatabaseDraftChange={() => {}}
        onDatabaseRunQuery={() => {}}
        onDatabaseConfirmQuery={() => {}}
        onDatabaseCancelConfirmation={() => {}}
        onDatabaseExportResult={() => {}}
        onDatabaseSelectHistory={() => {}}
        languageState={createLanguageState()}
      />,
    );

    expect(
      renderResult.getByRole("button", { name: "Open browser preview" }),
    ).toBeTruthy();
    expect(
      renderResult.getByRole("button", {
        name: "Open Frontend at http://localhost:5173",
      }),
    ).toBeTruthy();
    fireEvent.click(
      renderResult.getByRole("button", {
        name: "Open Frontend at http://localhost:5173",
      }),
    );
    expect(onBrowserOpenTarget).toHaveBeenCalledWith("http://localhost:5173");
  });

  test("PanelBody disables browser capture when capture is unavailable", () => {
    const renderResult = render(
      <PanelBody
        active="browser"
        refreshKey={0}
        activeFilePath="src/app/AppShell.tsx"
        terminalSessions={[]}
        activeTerminalId={null}
        terminalCwdInput=""
        terminalError={null}
        taskState={{
          detectedTasks: [],
          runs: [],
          activeRunId: null,
          outputByRunId: {},
          problemsByRunId: {},
          pendingOutputByRunId: {},
          pendingFinishByRunId: {},
          contextPackByRunId: {},
          customCommand: "",
        }}
        taskError={null}
        gitState={{
          status: null,
          loading: false,
          error: null,
          commitMessage: "",
          selectedDiff: null,
          diffByKey: {},
          branches: [],
          graph: [],
        }}
        docsState={createDocsState()}
        contextPackNameById={{}}
        gitDecorations={{}}
        agentState={createAgentState()}
        availableAgentContext={[]}
        onAgentModeChange={() => {}}
        onAgentPromptChange={() => {}}
        onAgentToggleContext={() => {}}
        onAgentStartSession={() => {}}
        onAgentSelectSession={() => {}}
        onAgentApprove={() => {}}
        onAgentReject={() => {}}
        onAgentExport={() => {}}
        onOpenFile={() => Promise.resolve()}
        onCreateFile={async () => {}}
        onRenamePath={async () => {}}
        onDeletePath={async () => {}}
        onTerminalCwdInputChange={() => {}}
        onNewTerminal={() => Promise.resolve()}
        onActivateTerminal={() => {}}
        onCloseTerminal={() => Promise.resolve()}
        onRestartTerminal={() => Promise.resolve()}
        onTaskCustomCommandChange={() => {}}
        onRunTask={() => {}}
        onRunCustomTask={() => {}}
        onActivateTaskRun={() => {}}
        onStopTaskRun={() => Promise.resolve()}
        onRerunTaskRun={() => {}}
        onGitRefresh={() => Promise.resolve()}
        onGitCommitMessageChange={() => {}}
        onGitCommit={() => {}}
        onGitStage={() => {}}
        onGitUnstage={() => {}}
        onGitDiscard={() => {}}
        onGitOpenDiff={() => {}}
        onGitStash={() => {}}
        onGitFetch={() => {}}
        onGitPull={() => {}}
        onGitPush={() => {}}
        onGitCheckoutBranch={() => {}}
        onGitCreateBranch={() => {}}
        onGitOpenGraph={() => {}}
        onDocsRefresh={() => Promise.resolve()}
        onDocsSearch={() => {}}
        onDocsOpenPreview={() => Promise.resolve()}
        onDocsToggleSource={() => {}}
        onDocsPackNameChange={() => {}}
        onDocsCreatePack={() => Promise.resolve()}
        onDocsSelectPack={() => {}}
        onDocsDeletePack={() => Promise.resolve()}
        onDocsUsePackForActiveTask={() => Promise.resolve()}
        onDocsLinkPackToAgentSession={() => Promise.resolve()}
        onLanguageOpenDiagnostic={() => {}}
        onLanguageRefresh={() => Promise.resolve()}
        onLanguageRestartServer={() => {}}
        browserState={{
          ...createBrowserState(),
          activeUrl: "http://localhost:5173",
          activeTitle: "localhost:5173",
          status: "ready",
        }}
        browserTargets={[]}
        browserCanCapture={false}
        onBrowserUrlInputChange={() => {}}
        onBrowserOpenUrl={() => {}}
        onBrowserOpenTarget={() => {}}
        onBrowserReload={() => {}}
        onBrowserHardReload={() => {}}
        onBrowserCapture={() => {}}
        onBrowserSelectScreenshot={() => {}}
        databaseState={createDatabaseState()}
        onDatabaseRefreshProfiles={() => {}}
        onDatabaseSelectProfile={() => {}}
        onDatabaseInspectProfile={() => {}}
        onDatabaseOpenTable={() => {}}
        onDatabaseDraftChange={() => {}}
        onDatabaseRunQuery={() => {}}
        onDatabaseConfirmQuery={() => {}}
        onDatabaseCancelConfirmation={() => {}}
        onDatabaseExportResult={() => {}}
        onDatabaseSelectHistory={() => {}}
        languageState={createLanguageState()}
      />,
    );

    expect(
      (renderResult.getByRole("button", {
        name: "Capture browser screenshot",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("Browser split editor visibility remains enabled in browser-preview", () => {
    const loadedFile = {
      workspaceId: "workspace-1",
      path: "src/app/AppShell.tsx",
      content: "export const app = true;",
      language: "typescript",
      readOnly: false,
    };

    expect(
      shouldShowBrowserSplitEditor({
        surface: "browser-preview",
        activeWorkspaceId: "workspace-1",
        activePath: "src/app/AppShell.tsx",
        loadedFile,
      }),
    ).toBe(true);
  });

  test("Browser split layout renders editor and preview together", () => {
    const renderResult = render(
      <BrowserPreviewSplitSurface
        showEditor={true}
        editor={<div data-testid="browser-editor-panel">Editor</div>}
        preview={<div data-testid="browser-preview-panel">Preview</div>}
      />,
    );

    expect(renderResult.getByTestId("browser-editor-panel")).toBeTruthy();
    expect(renderResult.getByTestId("browser-preview-panel")).toBeTruthy();
    expect(
      renderResult.container.querySelector(".browser-split.has-editor"),
    ).toBeTruthy();
  });

  test("Browser split layout keeps preview only without editor", () => {
    const renderResult = render(
      <BrowserPreviewSplitSurface
        showEditor={false}
        editor={<div data-testid="browser-editor-panel">Editor</div>}
        preview={<div data-testid="browser-preview-panel">Preview</div>}
      />,
    );

    expect(renderResult.queryByTestId("browser-editor-panel")).toBeNull();
    expect(renderResult.getByTestId("browser-preview-panel")).toBeTruthy();
    expect(
      renderResult.container.querySelector(".browser-split.has-editor"),
    ).toBeNull();
  });

  test("openBrowserPreviewWithValidation does not switch surface on invalid URL", async () => {
    const onOpenPanel = mock(() => {});
    const onSetSurface = mock(() => {});
    const onOpenUrl = mock(() => {});
    const onValidationError = mock(() => {});
    const requestState: BrowserValidationRequestState = {};
    const requestId = startBrowserValidationRequest(requestState, "w:1");

    await openBrowserPreviewWithValidation(
      {
        workspaceId: "w:1",
        value: "not-a-valid-url",
        requestId,
        isLatestRequest: (workspaceId, id) =>
          isLatestBrowserValidationRequest(requestState, workspaceId, id),
        onOpenPanel,
        onSetSurface,
        onOpenUrl,
        onValidationError,
      },
      async () => {
        throw new Error("invalid browser URL");
      },
    );

    expect(onOpenPanel).toHaveBeenCalledTimes(1);
    expect(onSetSurface).not.toHaveBeenCalled();
    expect(onOpenUrl).not.toHaveBeenCalled();
    expect(onValidationError).toHaveBeenCalledTimes(1);
  });

  test("openBrowserPreviewWithValidation sets browser surface only when URL validates", async () => {
    const parsedUrl = {
      url: "http://localhost:5173",
      host: "localhost",
      port: 5173,
    };
    const onOpenPanel = mock(() => {});
    const onSetSurface = mock(() => {});
    const onOpenUrl = mock(() => {});
    const onValidationError = mock(() => {});
    const requestState: BrowserValidationRequestState = {};
    const requestId = startBrowserValidationRequest(requestState, "w:1");

    await openBrowserPreviewWithValidation(
      {
        workspaceId: "w:1",
        value: " http://localhost:5173 ",
        requestId,
        isLatestRequest: (workspaceId, id) =>
          isLatestBrowserValidationRequest(requestState, workspaceId, id),
        onOpenPanel,
        onSetSurface,
        onOpenUrl,
        onValidationError,
      },
      async () => parsedUrl,
    );

    expect(onOpenPanel).toHaveBeenCalledTimes(1);
    expect(onOpenUrl).toHaveBeenCalledWith(parsedUrl);
    expect(onSetSurface).toHaveBeenCalledWith("browser-preview");
    expect(onValidationError).not.toHaveBeenCalled();
  });

  test("openBrowserPreviewWithValidation keeps surface unchanged for empty input", async () => {
    const onOpenPanel = mock(() => {});
    const onSetSurface = mock(() => {});
    const onOpenUrl = mock(() => {});
    const onValidationError = mock(() => {});
    const requestState: BrowserValidationRequestState = {};
    const requestId = startBrowserValidationRequest(requestState, "w:1");

    await openBrowserPreviewWithValidation(
      {
        workspaceId: "w:1",
        value: "   ",
        requestId,
        isLatestRequest: (workspaceId, id) =>
          isLatestBrowserValidationRequest(requestState, workspaceId, id),
        onOpenPanel,
        onSetSurface,
        onOpenUrl,
        onValidationError,
      },
      async () => {
        throw new Error("should not be called");
      },
    );

    expect(onOpenPanel).toHaveBeenCalledTimes(1);
    expect(onSetSurface).not.toHaveBeenCalled();
    expect(onOpenUrl).not.toHaveBeenCalled();
    expect(onValidationError).not.toHaveBeenCalled();
  });

  test("openBrowserPreviewWithValidation applies only latest validation result", async () => {
    const requestState: BrowserValidationRequestState = {};
    const onOpenPanel = mock(() => {});
    const onSetSurface = mock(() => {});
    const onOpenUrl = mock<(url: BrowserUrl) => void>(() => {});
    const onValidationError = mock<(error: unknown) => void>(() => {});

    const parsedFirst = {
      url: "http://localhost:5173",
      host: "localhost",
      port: 5173,
    };
    const parsedSecond = {
      url: "http://localhost:5174",
      host: "localhost",
      port: 5174,
    };
    let resolveFirst: (value: BrowserUrl | PromiseLike<BrowserUrl>) => void = () => {};
    let resolveSecond: (value: BrowserUrl | PromiseLike<BrowserUrl>) => void = () => {};
    const validateFirst = mock(() => {
      return new Promise<BrowserUrl>((resolve) => {
        resolveFirst = resolve;
      });
    });
    const validateSecond = mock(() => {
      return new Promise<BrowserUrl>((resolve) => {
        resolveSecond = resolve;
      });
    });

    const firstRequestId = startBrowserValidationRequest(requestState, "workspace-1");
    const secondRequestId = startBrowserValidationRequest(
      requestState,
      "workspace-1",
    );

    const first = openBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        value: "http://localhost:5173",
        requestId: firstRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserValidationRequest(requestState, workspaceId, requestId),
        onOpenPanel,
        onSetSurface,
        onOpenUrl,
        onValidationError,
      },
      validateFirst,
    );

    const second = openBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        value: "http://localhost:5174",
        requestId: secondRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserValidationRequest(requestState, workspaceId, requestId),
        onOpenPanel,
        onSetSurface,
        onOpenUrl,
        onValidationError,
      },
      validateSecond,
    );

    expect(onOpenPanel).toHaveBeenCalledTimes(2);

    resolveSecond(parsedSecond);
    await second;

    expect(onOpenUrl).toHaveBeenCalledTimes(1);
    expect(onSetSurface).toHaveBeenCalledTimes(1);
    expect(onOpenUrl).toHaveBeenCalledWith(parsedSecond);
    expect(onValidationError).not.toHaveBeenCalled();

    resolveFirst(parsedFirst);
    await first;

    expect(onOpenUrl).toHaveBeenCalledTimes(1);
    expect(onSetSurface).toHaveBeenCalledTimes(1);
    expect(onOpenUrl).toHaveBeenCalledWith(parsedSecond);
    expect(onValidationError).not.toHaveBeenCalled();
  });

  test("openBrowserPreviewWithValidation ignores stale validation failure after newer success", async () => {
    const requestState: BrowserValidationRequestState = {};
    const onOpenPanel = mock(() => {});
    const onSetSurface = mock(() => {});
    const onOpenUrl = mock<(url: BrowserUrl) => void>(() => {});
    const onValidationError = mock<(error: unknown) => void>(() => {});
    const parsed = {
      url: "http://localhost:5174",
      host: "localhost",
      port: 5174,
    };
    let rejectFirst: (reason?: unknown) => void = () => {};
    const validateFirst = mock(() => {
      return new Promise<BrowserUrl>((_resolve, reject) => {
        rejectFirst = reject;
      });
    });
    const validateSecond = mock(async () => parsed);

    const firstRequestId = startBrowserValidationRequest(requestState, "workspace-1");
    const secondRequestId = startBrowserValidationRequest(
      requestState,
      "workspace-1",
    );

    const first = openBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        value: "bad-url",
        requestId: firstRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserValidationRequest(requestState, workspaceId, requestId),
        onOpenPanel,
        onSetSurface,
        onOpenUrl,
        onValidationError,
      },
      validateFirst,
    );

    const second = openBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        value: "http://localhost:5174",
        requestId: secondRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserValidationRequest(requestState, workspaceId, requestId),
        onOpenPanel,
        onSetSurface,
        onOpenUrl,
        onValidationError,
      },
      validateSecond,
    );

    await second;

    rejectFirst(new Error("stale failure"));
    await first;

    expect(onOpenUrl).toHaveBeenCalledTimes(1);
    expect(onOpenUrl).toHaveBeenCalledWith(parsed);
    expect(onSetSurface).toHaveBeenCalledTimes(1);
    expect(onSetSurface).toHaveBeenCalledWith("browser-preview");
    expect(onValidationError).toHaveBeenCalledTimes(0);
  });

  test("captureBrowserPreviewWithValidation ignores stale capture success", async () => {
    const requestState: BrowserCaptureRequestState = {};
    const onSuccess = mock<(screenshot: BrowserScreenshot) => void>(() => {});
    const onFailure = mock<(error: unknown) => void>(() => {});
    let resolveFirst: (
      value: BrowserScreenshot | PromiseLike<BrowserScreenshot>,
    ) => void = () => {};
    let resolveSecond: (
      value: BrowserScreenshot | PromiseLike<BrowserScreenshot>,
    ) => void = () => {};

    const first = {
      id: "s1",
      workspace_root: "/repo",
      url: "http://localhost:5173",
      title: "localhost:5173",
      data_url: "data:image/png;base64,a",
      width: 1200,
      height: 700,
      captured_ms: 1,
    };
    const second = {
      id: "s2",
      workspace_root: "/repo",
      url: "http://localhost:5174",
      title: "localhost:5174",
      data_url: "data:image/png;base64,b",
      width: 1200,
      height: 700,
      captured_ms: 2,
    };

    const request = {
      workspaceRoot: "/repo",
      request: {
        url: "http://localhost:5173",
        title: "localhost:5173",
        bounds: { x: 0, y: 0, width: 1280, height: 720 },
      },
    };
    const requestDifferent = {
      workspaceRoot: "/repo",
      request: {
        url: "http://localhost:5174",
        title: "localhost:5174",
        bounds: { x: 0, y: 0, width: 1280, height: 720 },
      },
    };

    const firstRequestId = startBrowserCaptureRequest(requestState, "workspace-1");
    const secondRequestId = startBrowserCaptureRequest(requestState, "workspace-1");

    captureBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        requestId: firstRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserCaptureRequest(requestState, workspaceId, requestId),
        request,
        onSuccess,
        onFailure,
      },
      () =>
        new Promise<BrowserScreenshot>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    captureBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        requestId: secondRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserCaptureRequest(requestState, workspaceId, requestId),
        request: requestDifferent,
        onSuccess,
        onFailure,
      },
      () =>
        new Promise<BrowserScreenshot>((resolve) => {
          resolveSecond = resolve;
        }),
    );

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();

    resolveSecond(second);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(second);
    expect(onFailure).not.toHaveBeenCalled();

    resolveFirst(first);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  test("captureBrowserPreviewWithValidation ignores stale capture failure after newer success", async () => {
    const requestState: BrowserCaptureRequestState = {};
    const onSuccess = mock<(screenshot: BrowserScreenshot) => void>(() => {});
    const onFailure = mock<(error: unknown) => void>(() => {});
    let rejectFirst: (reason?: unknown) => void = () => {};

    const request = {
      workspaceRoot: "/repo",
      request: {
        url: "http://localhost:5173",
        title: "localhost:5173",
        bounds: { x: 0, y: 0, width: 1280, height: 720 },
      },
    };
    const requestDifferent = {
      workspaceRoot: "/repo",
      request: {
        url: "http://localhost:5174",
        title: "localhost:5174",
        bounds: { x: 0, y: 0, width: 1280, height: 720 },
      },
    };

    const firstRequestId = startBrowserCaptureRequest(requestState, "workspace-1");
    const secondRequestId = startBrowserCaptureRequest(requestState, "workspace-1");

    let secondSuccessComplete = false;

    captureBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        requestId: firstRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserCaptureRequest(requestState, workspaceId, requestId),
        request,
        onSuccess,
        onFailure,
      },
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );

    const screenshot = {
      id: "s2",
      workspace_root: "/repo",
      url: "http://localhost:5174",
      title: "localhost:5174",
      data_url: "data:image/png;base64,b",
      width: 1200,
      height: 700,
      captured_ms: 2,
    };
    captureBrowserPreviewWithValidation(
      {
        workspaceId: "workspace-1",
        requestId: secondRequestId,
        isLatestRequest: (workspaceId, requestId) =>
          isLatestBrowserCaptureRequest(requestState, workspaceId, requestId),
        request: requestDifferent,
        onSuccess: (value) => {
          secondSuccessComplete = true;
          onSuccess(value);
        },
        onFailure,
      },
      async () => screenshot,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(secondSuccessComplete).toBe(true);
    expect(onSuccess).toHaveBeenCalledWith(screenshot);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();

    rejectFirst(new Error("stale failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onFailure).toHaveBeenCalledTimes(0);
  });

  test("collects all bounded agent context pieces", () => {
    const source = {
      workspaceRoot: "/repo",
      activeWorkspaceId: "w:1",
      browserScreenshots: [
        {
          id: "shot-1",
          workspace_root: "/repo",
          url: "http://localhost:5173",
          title: "localhost:5173",
          data_url: "data:image/png;base64,shot",
          width: 1280,
          height: 720,
          captured_ms: 1700000000000,
        },
      ],
      loadedFile: {
        workspaceId: "w:1",
        path: "src/app/AppShell.tsx",
        content: "export const app = true;",
        language: "typescript",
        readOnly: false,
      },
      docsPreviews: [
        {
          path: "docs/guide.md",
          title: "Guide",
          content: "# Guide",
        },
        {
          path: "docs/faq.md",
          title: "FAQ",
          content: "# FAQ",
        },
      ],
      selectedDiff: {
        path: "src/app/AppShell.tsx",
        original_path: null,
        staged: false,
        binary: false,
        truncated: false,
        raw: "diff --git a/src/app/AppShell.tsx b/src/app/AppShell.tsx",
      },
      activeFileDiagnostics: [
        {
          path: "src/app/AppShell.tsx",
          range: {
            start_line: 3,
            start_character: 0,
            end_line: 3,
            end_character: 1,
          },
          severity: "error",
          message: "Unexpected token",
          source: null,
        },
      ],
      terminalSession: {
        id: "w:terminal-1",
        workspace_id: "w:1",
        name: "zsh",
        cwd: "/repo",
        shell: "/bin/zsh",
        running: true,
      },
      terminalOutput: "$ bun test",
    } as AgentAvailableContextSource;

    const contextItems = collectAgentAvailableContext(source);
    const labels = contextItems.map((item) => item.label);
    const contents = contextItems.map((item) => item.content);

    expect(labels).toContain("src/app/AppShell.tsx");
    expect(labels).toContain("Guide");
    expect(labels).toContain("FAQ");
    expect(labels).toContain("unstaged diff: src/app/AppShell.tsx");
    expect(labels).toContain("error: src/app/AppShell.tsx:4");
    expect(labels).toContain("zsh");
    expect(labels).toContain("Browser screenshot: localhost:5173");
    expect(contents).toContain("# Guide");
    expect(contents).toContain("# FAQ");
    expect(contents.some((entry) => entry.includes("URL: http://localhost:5173"))).toBe(
      true,
    );
  });

  test("collects bounded context excluding stale loaded file from inactive workspace", () => {
    const source = {
      workspaceRoot: "/repo",
      activeWorkspaceId: "w:1",
      browserScreenshots: [
        {
          id: "shot-other",
          workspace_root: "/old",
          url: "http://localhost:1234",
          title: "Other workspace",
          data_url: "data:image/png;base64,old",
          width: 640,
          height: 480,
          captured_ms: 1700000000002,
        },
      ],
      loadedFile: {
        workspaceId: "w:old",
        path: "src/legacy/AppShell.tsx",
        content: "export const legacy = false;",
        language: "typescript",
        readOnly: false,
      },
      docsPreviews: [
        {
          path: "docs/guide.md",
          title: "Guide",
          content: "# Guide",
        },
      ],
      selectedDiff: null,
      activeFileDiagnostics: [],
      terminalSession: {
        id: "w:terminal-2",
        workspace_id: "w:1",
        name: "bash",
        cwd: "/repo",
        shell: "/bin/bash",
        running: true,
      },
      terminalOutput: "$ bun test",
    };

    const contextItems = collectAgentAvailableContext(source);
    const labels = contextItems.map((item) => item.label);
    const contents = contextItems.map((item) => item.content);

    expect(labels).not.toContain("src/legacy/AppShell.tsx");
    expect(contents).not.toContain("export const legacy = false;");
    expect(labels).toContain("Guide");
    expect(labels).toContain("bash");
  });

  test("activeLoadedFileForWorkspace filters stale loaded files", () => {
    const staleLoadedFile = {
      workspaceId: "w:old",
      path: "src/legacy/AppShell.tsx",
      content: "export const legacy = false;",
      language: "typescript",
      readOnly: false,
    };

    const matched = activeLoadedFileForWorkspace(staleLoadedFile, "w:1");
    expect(matched).toBeNull();
  });

  test("PanelBody renders AgentPanel and routes callbacks", () => {
    const onAgentModeChange = mock(() => {});
    const onAgentPromptChange = mock(() => {});
    const onAgentToggleContext = mock(() => {});
    const onAgentStartSession = mock(() => {});
    const onAgentSelectSession = mock(() => {});
    const onAgentApprove = mock(() => {});
    const onAgentReject = mock(() => {});
    const onAgentExport = mock(() => {});

    const agentState: AgentViewState = {
      ...createAgentState(),
      sessions: [makeSession("agent-1")],
      activeSessionId: "agent-1",
    };

    const renderResult = render(
      <PanelBody
        active="agents"
        refreshKey={0}
        activeFilePath="src/app/AppShell.tsx"
        terminalSessions={[]}
        activeTerminalId={null}
        terminalCwdInput=""
        terminalError={null}
        taskState={{
          detectedTasks: [],
          runs: [],
          activeRunId: null,
          outputByRunId: {},
          problemsByRunId: {},
          pendingOutputByRunId: {},
          pendingFinishByRunId: {},
          contextPackByRunId: {},
          customCommand: "",
        }}
        taskError={null}
        gitState={{
          status: null,
          loading: false,
          error: null,
          commitMessage: "",
          selectedDiff: null,
          diffByKey: {},
          branches: [],
          graph: [],
        }}
        docsState={createDocsState()}
        contextPackNameById={{}}
        gitDecorations={{}}
        agentState={agentState}
        availableAgentContext={[]}
        onAgentModeChange={onAgentModeChange}
        onAgentPromptChange={onAgentPromptChange}
        onAgentToggleContext={onAgentToggleContext}
        onAgentStartSession={onAgentStartSession}
        onAgentSelectSession={onAgentSelectSession}
        onAgentApprove={onAgentApprove}
        onAgentReject={onAgentReject}
        onAgentExport={onAgentExport}
        onOpenFile={() => Promise.resolve()}
        onCreateFile={async () => {}}
        onRenamePath={async () => {}}
        onDeletePath={async () => {}}
        onTerminalCwdInputChange={() => {}}
        onNewTerminal={() => Promise.resolve()}
        onActivateTerminal={() => {}}
        onCloseTerminal={() => Promise.resolve()}
        onRestartTerminal={() => Promise.resolve()}
        onTaskCustomCommandChange={() => {}}
        onRunTask={() => {}}
        onRunCustomTask={() => {}}
        onActivateTaskRun={() => {}}
        onStopTaskRun={() => Promise.resolve()}
        onRerunTaskRun={() => {}}
        onGitRefresh={() => Promise.resolve()}
        onGitCommitMessageChange={() => {}}
        onGitCommit={() => {}}
        onGitStage={() => {}}
        onGitUnstage={() => {}}
        onGitDiscard={() => {}}
        onGitOpenDiff={() => {}}
        onGitStash={() => {}}
        onGitFetch={() => {}}
        onGitPull={() => {}}
        onGitPush={() => {}}
        onGitCheckoutBranch={() => {}}
        onGitCreateBranch={() => {}}
        onGitOpenGraph={() => {}}
        onDocsRefresh={() => Promise.resolve()}
        onDocsSearch={() => {}}
        onDocsOpenPreview={() => Promise.resolve()}
        onDocsToggleSource={() => {}}
        onDocsPackNameChange={() => {}}
        onDocsCreatePack={() => Promise.resolve()}
        onDocsSelectPack={() => {}}
        onDocsDeletePack={() => Promise.resolve()}
        onDocsUsePackForActiveTask={() => Promise.resolve()}
        onDocsLinkPackToAgentSession={() => Promise.resolve()}
        onLanguageOpenDiagnostic={() => {}}
        onLanguageRefresh={() => Promise.resolve()}
        onLanguageRestartServer={() => {}}
        browserState={createBrowserState()}
        browserTargets={[]}
        browserCanCapture={false}
        onBrowserUrlInputChange={() => {}}
        onBrowserOpenUrl={() => {}}
        onBrowserOpenTarget={() => {}}
        onBrowserReload={() => {}}
        onBrowserHardReload={() => {}}
        onBrowserCapture={() => {}}
        onBrowserSelectScreenshot={() => {}}
        databaseState={createDatabaseState()}
        onDatabaseRefreshProfiles={() => {}}
        onDatabaseSelectProfile={() => {}}
        onDatabaseInspectProfile={() => {}}
        onDatabaseOpenTable={() => {}}
        onDatabaseDraftChange={() => {}}
        onDatabaseRunQuery={() => {}}
        onDatabaseConfirmQuery={() => {}}
        onDatabaseCancelConfirmation={() => {}}
        onDatabaseExportResult={() => {}}
        onDatabaseSelectHistory={() => {}}
        languageState={createLanguageState()}
      />,
    );

    const activeSession = activeAgentSession(agentState);
    expect(activeSession?.id).toBe("agent-1");

    expect(renderResult.getByText("No context available")).toBeTruthy();
    fireEvent.click(renderResult.getByRole("button", { name: "edit" }));
    expect(onAgentModeChange).toHaveBeenCalledWith("edit");
    fireEvent.click(renderResult.getByLabelText("Export prompt"));
    expect(onAgentExport).toHaveBeenCalledTimes(1);
  });

  test("PanelBody renders DatabasePanel and routes database callbacks", () => {
    const onDatabaseRefreshProfiles = mock(() => {});
    const onDatabaseSelectProfile = mock<(profileId: string) => void>(() => {});
    const onDatabaseInspectProfile = mock<(profileId: string) => void>(() => {});
    const onDatabaseOpenTable = mock<(profileId: string, table: DatabaseTable) => void>(() => {});
    const onDatabaseDraftChange = mock<(query: string) => void>(() => {});
    const onDatabaseRunQuery = mock(() => {});
    const onDatabaseConfirmQuery = mock((_input: string) => {});
    const onDatabaseCancelConfirmation = mock(() => {});
    const onDatabaseExportResult = mock(() => {});
    const onDatabaseSelectHistory = mock<(entry: DatabaseQueryHistoryEntry) => void>(() => {});

    const renderResult = render(
      <PanelBody
        active="database"
        refreshKey={0}
        activeFilePath="src/app/AppShell.tsx"
        terminalSessions={[]}
        activeTerminalId={null}
        terminalCwdInput=""
        terminalError={null}
        taskState={{
          detectedTasks: [],
          runs: [],
          activeRunId: null,
          outputByRunId: {},
          problemsByRunId: {},
          pendingOutputByRunId: {},
          pendingFinishByRunId: {},
          contextPackByRunId: {},
          customCommand: "",
        }}
        taskError={null}
        gitState={{
          status: null,
          loading: false,
          error: null,
          commitMessage: "",
          selectedDiff: null,
          diffByKey: {},
          branches: [],
          graph: [],
        }}
        docsState={createDocsState()}
        contextPackNameById={{}}
        gitDecorations={{}}
        agentState={createAgentState()}
        availableAgentContext={[]}
        onAgentModeChange={() => {}}
        onAgentPromptChange={() => {}}
        onAgentToggleContext={() => {}}
        onAgentStartSession={() => {}}
        onAgentSelectSession={() => {}}
        onAgentApprove={() => {}}
        onAgentReject={() => {}}
        onAgentExport={() => {}}
        onOpenFile={() => Promise.resolve()}
        onCreateFile={async () => {}}
        onRenamePath={async () => {}}
        onDeletePath={async () => {}}
        onTerminalCwdInputChange={() => {}}
        onNewTerminal={() => Promise.resolve()}
        onActivateTerminal={() => {}}
        onCloseTerminal={() => Promise.resolve()}
        onRestartTerminal={() => Promise.resolve()}
        onTaskCustomCommandChange={() => {}}
        onRunTask={() => {}}
        onRunCustomTask={() => {}}
        onActivateTaskRun={() => {}}
        onStopTaskRun={() => Promise.resolve()}
        onRerunTaskRun={() => {}}
        onGitRefresh={() => Promise.resolve()}
        onGitCommitMessageChange={() => {}}
        onGitCommit={() => {}}
        onGitStage={() => {}}
        onGitUnstage={() => {}}
        onGitDiscard={() => {}}
        onGitOpenDiff={() => {}}
        onGitStash={() => {}}
        onGitFetch={() => {}}
        onGitPull={() => {}}
        onGitPush={() => {}}
        onGitCheckoutBranch={() => {}}
        onGitCreateBranch={() => {}}
        onGitOpenGraph={() => {}}
        onDocsRefresh={() => Promise.resolve()}
        onDocsSearch={() => {}}
        onDocsOpenPreview={() => Promise.resolve()}
        onDocsToggleSource={() => {}}
        onDocsPackNameChange={() => {}}
        onDocsCreatePack={() => Promise.resolve()}
        onDocsSelectPack={() => {}}
        onDocsDeletePack={() => Promise.resolve()}
        onDocsUsePackForActiveTask={() => Promise.resolve()}
        onDocsLinkPackToAgentSession={() => Promise.resolve()}
        onLanguageOpenDiagnostic={() => {}}
        onLanguageRefresh={() => Promise.resolve()}
        onLanguageRestartServer={() => {}}
        browserState={createBrowserState()}
        browserTargets={[]}
        browserCanCapture={false}
        onBrowserUrlInputChange={() => {}}
        onBrowserOpenUrl={() => {}}
        onBrowserOpenTarget={() => {}}
        onBrowserReload={() => {}}
        onBrowserHardReload={() => {}}
        onBrowserCapture={() => {}}
        onBrowserSelectScreenshot={() => {}}
        databaseState={databaseState({
          profiles: [
            {
              id: "db-local",
              workspace_root: "/repo",
              name: "local",
              kind: "SQLite",
              source: { SQLite: { path: "/repo/local.db" } },
              read_only: false,
              production: false,
              created_ms: 1,
              updated_ms: 1,
            },
          ],
          activeProfileId: "db-local",
          queryDraft: "SELECT 1",
          schemaByProfileId: {
            "db-local": {
              profile_id: "db-local",
              refreshed_ms: 1,
              tables: [
                {
                  schema: "main",
                  name: "users",
                  row_count: 3,
                  columns: [],
                },
              ],
            },
          },
          history: [
            {
              sql: "SELECT 1",
              kind: "Read",
              executed_ms: 5,
              affected_rows: null,
              row_count: 1,
            },
          ],
        })}
        onDatabaseRefreshProfiles={onDatabaseRefreshProfiles}
        onDatabaseSelectProfile={onDatabaseSelectProfile}
        onDatabaseInspectProfile={onDatabaseInspectProfile}
        onDatabaseOpenTable={onDatabaseOpenTable}
        onDatabaseDraftChange={onDatabaseDraftChange}
        onDatabaseRunQuery={onDatabaseRunQuery}
        onDatabaseConfirmQuery={onDatabaseConfirmQuery}
        onDatabaseCancelConfirmation={onDatabaseCancelConfirmation}
        onDatabaseExportResult={onDatabaseExportResult}
        onDatabaseSelectHistory={onDatabaseSelectHistory}
        languageState={createLanguageState()}
      />,
    );

    expect(renderResult.getByText("Databases")).toBeTruthy();
    fireEvent.click(
      renderResult.getByRole("button", {
        name: "Refresh database profiles",
      }),
    );
    expect(onDatabaseRefreshProfiles).toHaveBeenCalledTimes(1);

    fireEvent.click(
      renderResult.getByRole("button", {
        name: "Select local",
      }),
    );
    expect(onDatabaseSelectProfile).toHaveBeenCalledWith("db-local");

    fireEvent.click(
      renderResult.getByRole("button", {
        name: "Inspect schema local",
      }),
    );
    expect(onDatabaseInspectProfile).toHaveBeenCalledWith("db-local");

    fireEvent.click(
      renderResult.getByRole("button", {
        name: "Open table main.users",
      }),
    );
    expect(onDatabaseOpenTable).toHaveBeenCalledTimes(1);

    fireEvent.click(
      renderResult.getByRole("button", {
        name: "Run query",
      }),
    );
    expect(onDatabaseRunQuery).toHaveBeenCalledTimes(1);

    fireEvent.change(renderResult.getByLabelText("Database SQL query"), {
      target: { value: "SELECT * FROM audit_log" },
    });
    expect(onDatabaseDraftChange).toHaveBeenCalledWith("SELECT * FROM audit_log");

    fireEvent.click(
      renderResult.getByRole("button", {
        name: /Read\s+SELECT 1/i,
      }),
    );
    expect(onDatabaseSelectHistory).toHaveBeenCalledWith({
      sql: "SELECT 1",
      kind: "Read",
      executed_ms: 5,
      affected_rows: null,
      row_count: 1,
    });
  });

  test("executeDatabaseQueryRequest forwards exact confirmation text for confirmed SQL", async () => {
    const { workspaceId, workspaceRoot, profileId } = setupWorkspace();
    const calls: DatabaseQueryRequest[] = [];
    const executeDatabaseQuery = mock(async (request: DatabaseQueryRequest) => {
      calls.push(request);
      return {
        profile_id: profileId,
        sql: request.sql,
        classification: classifyDatabaseSql(request.sql),
        columns: [],
        rows: [],
        affected_rows: null,
        truncated: false,
        executed_ms: 11,
        history_id: "history-1",
      };
    });
    const refreshHistory = mock(async () => {});
    const onResultApplied = mock(() => {});
    const hasRegisteredWorkspace = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );
    const getWorkspaceRoot = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
      )?.path ?? null;

    await executeDatabaseQueryRequest({
      workspaceId,
      workspaceRoot,
      profileId,
      sql: "DROP TABLE users",
      requestId: 1,
      confirmation: "RUN DESTRUCTIVE SQL",
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseQuery: () => true,
      updateDatabase: setDatabase,
      executeDatabaseQuery,
      isActiveWorkspace: () => true,
      refreshHistory,
      onResultApplied,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].confirmation).toBe("RUN DESTRUCTIVE SQL");
    expect(refreshHistory).toHaveBeenCalledTimes(1);
    expect(onResultApplied).toHaveBeenCalledTimes(1);
  });

  test("executeDatabaseQueryRequest ignores stale query result when active profile changed", async () => {
    const { workspaceId, workspaceRoot, profileId } = setupWorkspace();
    const deferred = createDeferred<DatabaseQueryResult>();
    const executeDatabaseQuery = mock(() => deferred.promise);
    const refreshHistory = mock(async () => {});
    const onResultApplied = mock(() => {});
    const hasRegisteredWorkspace = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );
    const getWorkspaceRoot = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
      )?.path ?? null;

    const request = executeDatabaseQueryRequest({
      workspaceId,
      workspaceRoot,
      profileId,
      sql: "UPDATE users SET name = 'next'",
      requestId: 1,
      confirmation: null,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseQuery: () => true,
      updateDatabase: setDatabase,
      executeDatabaseQuery,
      isActiveWorkspace: () => true,
      refreshHistory,
      onResultApplied,
    });
    setDatabase(workspaceId, (database) => ({
      ...database,
      activeProfileId: `${profileId}-stale`,
    }));

    deferred.resolve({
      profile_id: profileId,
      sql: "UPDATE users SET name = 'next'",
      classification: classifyDatabaseSql("UPDATE users SET name = 'next'"),
      columns: [],
      rows: [],
      affected_rows: null,
      truncated: false,
      executed_ms: 9,
      history_id: "history-1",
    });

    await request;

    const database = workspaceViewStore.getState().viewFor(workspaceId).database;
    expect(onResultApplied).toHaveBeenCalledTimes(0);
    expect(refreshHistory).toHaveBeenCalledTimes(0);
    expect(database.loading).toBe(false);
    expect(database.activeResult).toBeNull();
    expect(database.error).toBeNull();
  });

  test("executeDatabaseQueryRequest does not write stale errors after profile switch", async () => {
    const { workspaceId, workspaceRoot, profileId } = setupWorkspace();
    const executeDatabaseQuery = mock(async () => {
      throw new Error("permission denied");
    });
    const hasRegisteredWorkspace = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );
    const getWorkspaceRoot = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
      )?.path ?? null;

    const request = executeDatabaseQueryRequest({
      workspaceId,
      workspaceRoot,
      profileId,
      sql: "UPDATE users SET name = 'next'",
      requestId: 1,
      confirmation: null,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseQuery: () => true,
      updateDatabase: setDatabase,
      executeDatabaseQuery,
      isActiveWorkspace: () => true,
      refreshHistory: async () => {},
      onResultApplied: () => {},
    });
    setDatabase(workspaceId, (database) => ({
      ...database,
      activeProfileId: `${profileId}-stale`,
    }));

    await request;

    const database = workspaceViewStore.getState().viewFor(workspaceId).database;
    expect(database.loading).toBe(false);
    expect(database.error).toBeNull();
  });

  test("inspectDatabaseProfileRequest clears loading on stale workspace path change", async () => {
    const { workspaceId, workspaceRoot, profileId } = setupWorkspace();
    const deferred = createDeferred<DatabaseSchema>();
    const inspectDatabaseSchema = mock(async () => deferred.promise);
    const updateDatabase = setDatabase;
    const hasRegisteredWorkspace = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );
    const getWorkspaceRoot = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
      )?.path ?? null;

    const request = inspectDatabaseProfileRequest({
      workspaceId,
      workspaceRoot,
      profileId,
      requestId: 1,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestInspectProfileRequest: () => true,
      updateDatabase,
      inspectDatabaseSchema,
    });

    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: `${workspaceRoot}-switched`,
          name: workspaceId,
          pinned: false,
        },
      ],
    });

    deferred.resolve({
      profile_id: profileId,
      refreshed_ms: 1,
      tables: [],
    });

    await request;

    const database = workspaceViewStore.getState().viewFor(workspaceId).database;
    expect(database.loading).toBe(false);
    expect(database.error).toBeNull();
    expect(database.schemaByProfileId[profileId]).toBeUndefined();
  });

  test("inspectDatabaseProfileRequest clears stale errors on workspace path change when inspect fails", async () => {
    const { workspaceId, workspaceRoot, profileId } = setupWorkspace();
    const deferred = createDeferred<DatabaseSchema>();
    const inspectDatabaseSchema = mock(async () => deferred.promise);
    const updateDatabase = setDatabase;
    const previousSchema: DatabaseSchema = {
      profile_id: profileId,
      refreshed_ms: 1,
      tables: [
        {
          schema: "main",
          name: "users",
          row_count: 5,
          columns: [],
        },
      ],
    };
    const hasRegisteredWorkspace = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );
    const getWorkspaceRoot = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
      )?.path ?? null;

    setDatabase(workspaceId, (database) => ({
      ...database,
      loading: true,
      error: "stale inspect error",
      schemaByProfileId: {
        [profileId]: previousSchema,
      },
    }));

    const request = inspectDatabaseProfileRequest({
      workspaceId,
      workspaceRoot,
      profileId,
      requestId: 1,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestInspectProfileRequest: () => true,
      updateDatabase,
      inspectDatabaseSchema,
    });

    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: `${workspaceRoot}-switched`,
          name: workspaceId,
          pinned: false,
        },
      ],
    });

    deferred.reject(new Error("database inspect failed"));

    await request;

    const database = workspaceViewStore.getState().viewFor(workspaceId).database;
    expect(database.loading).toBe(false);
    expect(database.error).toBeNull();
    expect(database.schemaByProfileId[profileId]).toEqual(previousSchema);
  });

  test("refreshDatabaseProfilesRequest does not write stale load errors after workspace path change", async () => {
    const { workspaceId, workspaceRoot, profileId } = setupWorkspace();
    const deferred = createDeferred<DatabaseProfile[]>();
    const listDatabaseProfiles = mock(async () => deferred.promise);
    const hasRegisteredWorkspace = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );
    const getWorkspaceRoot = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
      )?.path ?? null;

    setDatabase(workspaceId, (database) => ({
      ...database,
      loading: true,
      error: "previous profile load error",
      profiles: [
        {
          id: profileId,
          workspace_root: workspaceRoot,
          name: "local.db",
          kind: "SQLite",
          source: { SQLite: { path: `${workspaceRoot}/${profileId}.db` } },
          read_only: false,
          production: false,
          created_ms: 10,
          updated_ms: 11,
        },
      ],
    }));

    const request = refreshDatabaseProfilesRequest({
      workspaceId,
      workspaceRoot,
      requestId: 1,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseProfilesRequest: () => true,
      isActiveWorkspace: (currentWorkspaceId) =>
        workspaceStore.getState().registry.active_workspace_id === currentWorkspaceId,
      updateDatabase: setDatabase,
      listDatabaseProfiles,
    });

    workspaceStore.getState().setRegistry({
      active_workspace_id: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          path: `${workspaceRoot}-switched`,
          name: workspaceId,
          pinned: false,
        },
      ],
    });

    deferred.reject(new Error("database profile list failed"));

    await request;

    const database = workspaceViewStore.getState().viewFor(workspaceId).database;
    expect(database.loading).toBe(false);
    expect(database.error).toBeNull();
    expect(database.profiles).toEqual([
      {
        id: profileId,
        workspace_root: workspaceRoot,
        name: "local.db",
        kind: "SQLite",
        source: { SQLite: { path: `${workspaceRoot}/${profileId}.db` } },
        read_only: false,
        production: false,
        created_ms: 10,
        updated_ms: 11,
      },
    ]);
  });

  test("exportDatabaseQueryResultRequest does not write export when active result changed", async () => {
    const { workspaceId, workspaceRoot, profileId } = setupWorkspace();
    const initialResult = {
      profile_id: profileId,
      sql: "SELECT 1",
      classification: classifyDatabaseSql("SELECT 1"),
      columns: [],
      rows: [],
      affected_rows: null,
      truncated: false,
      executed_ms: 7,
      history_id: "history-1",
    };
    const replacementResult = {
      ...initialResult,
      executed_ms: 8,
      history_id: "history-2",
    };
    const deferred = createDeferred<{ path: string }>();
    const exportDatabaseQueryResult = mock(async () => deferred.promise);
    const hasRegisteredWorkspace = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );
    const getWorkspaceRoot = (currentWorkspaceId: string) =>
      workspaceStore.getState().registry.workspaces.find(
        (workspace) => workspace.id === currentWorkspaceId,
      )?.path ?? null;
    const isLatestDatabaseExportRequest = () => true;

    setDatabase(workspaceId, (database) => ({
      ...database,
      activeResult: initialResult,
      export: null,
    }));

    const request = exportDatabaseQueryResultRequest({
      workspaceId,
      workspaceRoot,
      requestId: 1,
      resultId: `${profileId}:history-1:7`,
      activeResult: initialResult,
      hasRegisteredWorkspace,
      getWorkspaceRoot,
      isLatestDatabaseExportRequest,
      updateDatabase: setDatabase,
      exportDatabaseQueryResult,
    });

    setDatabase(workspaceId, (database) => ({
      ...database,
      activeResult: replacementResult,
    }));

    deferred.resolve({ path: "/tmp/export.csv" });
    await request;

    expect(workspaceViewStore.getState().viewFor(workspaceId).database.export).toBeNull();
  });

  test("databaseTableSql and classifyDatabaseSql return conservative SQL routing text", () => {
    expect(databaseTableSql("SQLite", { schema: null, name: "users" })).toBe(
      'SELECT * FROM "users" LIMIT 100',
    );
    expect(
      databaseTableSql("SQLite", { schema: "main", name: "users" }),
    ).toBe('SELECT * FROM "main"."users" LIMIT 100');
    expect(
      databaseTableSql("MsSql", { schema: "dbo", name: "audit_log" }),
    ).toBe('SELECT TOP 100 * FROM [dbo].[audit_log]');

    expect(classifyDatabaseSql("SELECT * FROM users").kind).toBe("Read");
    expect(
      classifyDatabaseSql("UPDATE users SET name = 'a'").confirmation_text,
    ).toBe("RUN MUTATION");
    expect(
      classifyDatabaseSql("DROP TABLE users").confirmation_text,
    ).toBe("RUN DESTRUCTIVE SQL");
    expect(
      classifyDatabaseSql("SELECT 1; DROP TABLE users").confirmation_text,
    ).toBe("RUN DESTRUCTIVE SQL");
    expect(classifyDatabaseSql("EXPLAIN ANALYZE DELETE FROM users").kind).toBe(
      "Mutation",
    );
    expect(classifyDatabaseSql("EXPLAIN ANALYZE DELETE FROM users").confirmation_text).toBe(
      "RUN MUTATION",
    );
    expect(classifyDatabaseSql("EXPLAIN SELECT 1").kind).toBe("Read");
    expect(
      classifyDatabaseSql("WITH cte AS (SELECT 1) DELETE FROM users").kind,
    ).toBe("Mutation");
    expect(
      classifyDatabaseSql(
        "WITH deleted AS (DELETE FROM users RETURNING *) SELECT * FROM deleted",
      ).kind,
    ).toBe("Mutation");
    expect(
      classifyDatabaseSql("WITH recent AS (SELECT 1) SELECT * FROM recent").kind,
    ).toBe("Read");
    expect(
      classifyDatabaseSql("PRAGMA journal_mode = WAL").kind,
    ).toBe("Destructive");
    expect(
      classifyDatabaseSql("UNKNOWN COMMAND something").kind,
    ).toBe("Destructive");
    expect(
      classifyDatabaseSql("SELECT '--'; DROP TABLE users").kind,
    ).toBe("Destructive");
    expect(
      classifyDatabaseSql("SELECT 'x -- y'; DROP TABLE users").confirmation_text,
    ).toBe("RUN DESTRUCTIVE SQL");
    expect(
      classifyDatabaseSql("SELECT '/*'; DROP TABLE users; SELECT '*/'").kind,
    ).toBe("Destructive");
    expect(classifyDatabaseSql("").requires_confirmation).toBe(true);
    expect(classifyDatabaseSql("").confirmation_text).toBe(
      "RUN DESTRUCTIVE SQL",
    );
  });
});
