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
import { createBrowserState } from "../features/browser/browser-model";
import {
  collectAgentAvailableContext,
  activeLoadedFileForWorkspace,
  PanelBody,
  shouldShowBrowserSplitEditor,
  openBrowserPreviewWithValidation,
  type AgentAvailableContextSource,
} from "./AppShell";
import { ensureTestDom } from "./test-dom";

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

  test("openBrowserPreviewWithValidation does not switch surface on invalid URL", async () => {
    const onOpenPanel = mock(() => {});
    const onSetSurface = mock(() => {});
    const onOpenUrl = mock(() => {});
    const onValidationError = mock(() => {});

    await openBrowserPreviewWithValidation(
      {
        value: "not-a-valid-url",
        hasWorkspace: true,
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

    await openBrowserPreviewWithValidation(
      {
        value: " http://localhost:5173 ",
        hasWorkspace: true,
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

    await openBrowserPreviewWithValidation(
      {
        value: "   ",
        hasWorkspace: true,
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
});
