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
  collectAgentAvailableContext,
  PanelBody,
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
  test("collects all bounded agent context pieces", () => {
    const source = {
      workspaceRoot: "/repo",
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
    expect(contents).toContain("# Guide");
    expect(contents).toContain("# FAQ");
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
