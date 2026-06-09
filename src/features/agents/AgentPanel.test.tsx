/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { Window as HappyWindow } from "happy-dom";

import { AgentPanel } from "./AgentPanel";
import { createAgentState, type AgentMode, type AgentSession, type AgentViewState } from "./agent-model";

const testWindow = new HappyWindow({ url: "http://localhost/" });
globalThis.window = testWindow as unknown as Window & typeof globalThis;
globalThis.document = testWindow.document as unknown as Document;
globalThis.HTMLElement = testWindow.HTMLElement as unknown as typeof HTMLElement;
globalThis.HTMLInputElement =
  testWindow.HTMLInputElement as unknown as typeof HTMLInputElement;
globalThis.Event = testWindow.Event as unknown as typeof Event;
globalThis.MouseEvent = testWindow.MouseEvent as unknown as typeof MouseEvent;

const { cleanup, fireEvent, render, screen } = await import(
  "@testing-library/react"
);

afterEach(() => {
  cleanup();
});

function session(): AgentSession {
  return {
    id: "agent-1",
    workspace_root: "/repo",
    mode: "plan",
    prompt: "Plan Node 7",
    context_items: [
      {
        id: "file:src/app/AppShell.tsx",
        kind: "file",
        label: "src/app/AppShell.tsx",
        path: "src/app/AppShell.tsx",
        content: "shell",
        truncated: false,
      },
    ],
    transcript: [
      {
        id: "diff-1",
        session_id: "agent-1",
        kind: "diff",
        title: "Generated diff",
        content: "diff --git a/src/app/AppShell.tsx b/src/app/AppShell.tsx",
        status: "pending",
        approval_status: null,
        metadata: {},
        created_ms: 1,
      },
      {
        id: "verify-1",
        session_id: "agent-1",
        kind: "verification",
        title: "bun test",
        content: "145 pass",
        status: "passed",
        approval_status: null,
        metadata: { command: "bun test" },
        created_ms: 2,
      },
      {
        id: "approval-1",
        session_id: "agent-1",
        kind: "approval_request",
        title: "Apply edit",
        content: "Review required",
        status: "pending",
        approval_status: "pending",
        metadata: {},
        created_ms: 3,
      },
    ],
    created_ms: 1,
    updated_ms: 3,
  };
}

function renderAgentPanel({
  state = createAgentState(),
  availableContext = [],
  onModeChange = () => {},
  onPromptChange = () => {},
  onToggleContext = () => {},
  onStartSession = () => {},
  onSelectSession = () => {},
  onApprove = () => {},
  onReject = () => {},
  onExport = () => {},
}: Partial<
  {
    state: AgentViewState;
    availableContext: Parameters<typeof AgentPanel>[0]["availableContext"];
    onModeChange: (mode: AgentMode) => void;
    onPromptChange: (prompt: string) => void;
    onToggleContext: (id: string, selected: boolean) => void;
    onStartSession: (prompt: string) => void;
    onSelectSession: (sessionId: string) => void;
    onApprove: (approvalId: string) => void;
    onReject: (approvalId: string) => void;
    onExport: () => void;
  }
> = {}) {
  return render(
    <AgentPanel
      state={state}
      availableContext={availableContext}
      onModeChange={onModeChange}
      onPromptChange={onPromptChange}
      onToggleContext={onToggleContext}
      onStartSession={onStartSession}
      onSelectSession={onSelectSession}
      onApprove={onApprove}
      onReject={onReject}
      onExport={onExport}
    />,
  );
}

describe("AgentPanel", () => {
  test("starts an agent session with draft prompt and selected context", () => {
    const started: string[] = [];
    renderAgentPanel({
      state: {
        ...createAgentState(),
        promptDraft: "Plan Node 7",
        selectedContextIds: { "file:src/app/AppShell.tsx": true },
      },
      availableContext: [
        {
          id: "file:src/app/AppShell.tsx",
          kind: "file",
          label: "src/app/AppShell.tsx",
          path: "src/app/AppShell.tsx",
          content: "shell",
          truncated: false,
        },
      ],
      onStartSession: (prompt) => started.push(prompt),
    });

    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    expect(started).toEqual(["Plan Node 7"]);
  });

  test("switches mode and toggles context selection", () => {
    const modes: AgentMode[] = [];
    const toggles: Array<{ id: string; selected: boolean }> = [];
    renderAgentPanel({
      state: {
        ...createAgentState(),
        mode: "plan",
        selectedContextIds: {},
        promptDraft: "Any prompt",
      },
      availableContext: [
        {
          id: "file:src/app/AppShell.tsx",
          kind: "file",
          label: "src/app/AppShell.tsx",
          path: "src/app/AppShell.tsx",
          content: "shell",
          truncated: false,
        },
      ],
      onModeChange: (mode) => modes.push(mode),
      onToggleContext: (id, selected) => toggles.push({ id, selected }),
    });

    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    fireEvent.click(screen.getByLabelText("Use src/app/AppShell.tsx context"));
    expect(modes).toEqual(["edit"]);
    expect(toggles).toEqual([
      { id: "file:src/app/AppShell.tsx", selected: true },
    ]);
  });

  test("renders diffs, verification, approvals and export action", () => {
    const approved: string[] = [];
    const rejected: string[] = [];
    let exported = 0;
    const active = session();
    renderAgentPanel({
      state: {
        ...createAgentState(),
        sessions: [active],
        activeSessionId: active.id,
      },
      onApprove: (id) => approved.push(id),
      onReject: (id) => rejected.push(id),
      onExport: () => {
        exported += 1;
      },
    });

    expect(screen.getByText("Generated diff")).toBeTruthy();
    expect(screen.getByText("bun test")).toBeTruthy();
    expect(screen.getByText("145 pass")).toBeTruthy();
    expect(screen.getByText("passed")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Approve Apply edit"));
    fireEvent.click(screen.getByLabelText("Reject Apply edit"));
    fireEvent.click(screen.getByLabelText("Export prompt"));

    expect(approved).toEqual(["approval-1"]);
    expect(rejected).toEqual(["approval-1"]);
    expect(exported).toBe(1);
  });
});

describe("AgentPanel session validation", () => {
  test("notifies prompt changes from the composer", () => {
    const prompts: string[] = [];
    renderAgentPanel({
      state: {
        ...createAgentState(),
        promptDraft: "",
      },
      onPromptChange: (prompt) => prompts.push(prompt),
    });

    const promptInput = screen.getByLabelText("Agent prompt");
    fireEvent.change(promptInput, { target: { value: "Plan Node 7" } });

    expect(prompts).toEqual(["Plan Node 7"]);
  });

  test("keeps start session disabled for empty prompt", () => {
    const onStartSession = mock(() => {});
    renderAgentPanel({
      state: {
        ...createAgentState(),
        promptDraft: "   ",
      },
      onStartSession,
    });

    const startButton = screen.getByRole("button", { name: "Start session" });
    expect(startButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(startButton);
    expect(onStartSession).not.toHaveBeenCalled();
  });
});
