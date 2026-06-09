/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AgentPanel } from "./AgentPanel";
import { createAgentState, type AgentMode, type AgentSession, type AgentViewState } from "./agent-model";
import { ensureTestDom } from "../../app/test-dom";

ensureTestDom();

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
        title: "Run test command",
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
    const toggled: Array<{ id: string; selected: boolean }> = [];
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
        {
          id: "terminal:build",
          kind: "terminal",
          label: "Build output",
          path: "Build output",
          content: "npm run build output ...",
          truncated: true,
        },
      ],
      onStartSession: (prompt) => started.push(prompt),
      onToggleContext: (id, selected) => {
        toggled.push({ id, selected });
      },
    });

    expect(screen.getByText("src/app/AppShell.tsx")).toBeTruthy();
    expect(screen.getByText("file")).toBeTruthy();
    expect(screen.getByText(/terminal/iu)).toBeTruthy();
    expect(screen.getByText(/truncated/iu)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    expect(started).toEqual(["Plan Node 7"]);

    fireEvent.click(screen.getByLabelText("Use Build output context"));
    expect(toggled).toEqual([{ id: "terminal:build", selected: true }]);
  });

  test("keeps mode buttons reflecting controlled mode state", () => {
    const modes: AgentMode[] = ["plan", "edit", "verify", "review", "report"];
    modes.forEach((mode) => {
      renderAgentPanel({
        state: {
          ...createAgentState(),
          mode,
        },
      });

      modes.forEach((buttonMode) => {
        const expected = buttonMode === mode ? "true" : "false";
        expect(screen.getByRole("button", { name: buttonMode }).getAttribute("aria-pressed")).toBe(expected);
      });

      cleanup();
    });
  });

  test("switches all modes and toggles context selection", () => {
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

    ["plan", "edit", "verify", "review", "report"].forEach((mode) => {
      fireEvent.click(screen.getByRole("button", { name: mode }));
    });
    fireEvent.click(screen.getByLabelText("Use src/app/AppShell.tsx context"));
    expect(modes).toEqual(["plan", "edit", "verify", "review", "report"]);
    expect(toggles).toEqual([
      { id: "file:src/app/AppShell.tsx", selected: true },
    ]);
  });

  test("renders sessions and selects one to show context summary", () => {
    const onSelectSession = mock(() => {});
    const active = session();
    const second: AgentSession = {
      ...session(),
      id: "agent-2",
      context_items: [
        active.context_items[0],
        {
          id: "doc:docs/architecture/tech-stack.md",
          kind: "doc",
          label: "Tech Stack",
          path: "docs/architecture/tech-stack.md",
          content: "stack",
          truncated: false,
        },
      ],
      transcript: [
        {
          id: "diff-2",
          session_id: "agent-2",
          kind: "diff",
          title: "Generated diff two",
          content: "diff --git a/readme.md b/readme.md",
          status: "pending",
          approval_status: null,
          metadata: {},
          created_ms: 4,
        },
      ],
    };

    renderAgentPanel({
      state: {
        ...createAgentState(),
        sessions: [active, second],
        activeSessionId: active.id,
      },
      onSelectSession,
    });

    const secondRow = screen.getByRole("button", {
      name: "agent-2 plan 1 file | 1 doc",
    });
    const firstRow = screen.getByRole("button", {
      name: "agent-1 plan 1 file",
    });
    fireEvent.click(secondRow);

    expect(firstRow.getAttribute("aria-pressed")).toBe("true");
    expect(secondRow.getAttribute("aria-pressed")).toBe("false");
    expect(onSelectSession).toHaveBeenCalledTimes(1);
    expect(onSelectSession).toHaveBeenCalledWith("agent-2");
    expect(screen.getByText("1 file | 1 doc")).toBeTruthy();
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
    expect(screen.getByText("Run test command")).toBeTruthy();
    expect(screen.getByText("command: bun test")).toBeTruthy();
    expect(screen.getByText("145 pass")).toBeTruthy();
    expect(screen.getByText("diff --git a/src/app/AppShell.tsx b/src/app/AppShell.tsx")).toBeTruthy();
    expect(screen.getByText("passed")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Approve Apply edit"));
    fireEvent.click(screen.getByLabelText("Reject Apply edit"));
    fireEvent.click(screen.getByLabelText("Export prompt"));

    expect(approved).toEqual(["approval-1"]);
    expect(rejected).toEqual(["approval-1"]);
    expect(screen.getByRole("status").textContent).toBe("1 pending");
    expect(exported).toBe(1);
  });

  test("keeps non-pending approval actions disabled and inert", () => {
    const approved: string[] = [];
    const rejected: string[] = [];
    const pending: AgentSession = {
      id: "agent-2",
      workspace_root: "/repo",
      mode: "edit",
      prompt: "Patch",
      context_items: [],
      transcript: [
        {
          id: "approval-pending",
          session_id: "agent-2",
          kind: "approval_request",
          title: "Pending change",
          content: "Needs attention",
          status: "pending",
          approval_status: "pending",
          metadata: {},
          created_ms: 1,
        },
        {
          id: "approval-approved",
          session_id: "agent-2",
          kind: "approval_request",
          title: "Approved change",
          content: "No action needed",
          status: "passed",
          approval_status: "approved",
          metadata: {},
          created_ms: 2,
        },
        {
          id: "approval-rejected",
          session_id: "agent-2",
          kind: "approval_request",
          title: "Rejected change",
          content: "Need review later",
          status: "failed",
          approval_status: "rejected",
          metadata: {},
          created_ms: 3,
        },
      ],
      created_ms: 1,
      updated_ms: 3,
    };

    renderAgentPanel({
      state: {
        ...createAgentState(),
        sessions: [pending],
        activeSessionId: pending.id,
      },
      onApprove: (id) => approved.push(id),
      onReject: (id) => rejected.push(id),
    });

    const nonPendingApprove = screen.getByRole("button", {
      name: "Approve Approved change",
    });
    const nonPendingReject = screen.getByRole("button", {
      name: "Reject Rejected change",
    });
    const pendingApprove = screen.getByRole("button", {
      name: "Approve Pending change",
    });
    const pendingReject = screen.getByRole("button", {
      name: "Reject Pending change",
    });

    expect(nonPendingApprove.hasAttribute("disabled")).toBe(true);
    expect(nonPendingReject.hasAttribute("disabled")).toBe(true);

    fireEvent.click(nonPendingApprove);
    fireEvent.click(nonPendingReject);
    fireEvent.click(pendingApprove);
    fireEvent.click(pendingReject);

    expect(nonPendingApprove.hasAttribute("disabled")).toBe(true);
    expect(nonPendingReject.hasAttribute("disabled")).toBe(true);
    expect(approved).toEqual(["approval-pending"]);
    expect(rejected).toEqual(["approval-pending"]);
  });
});

describe("AgentPanel session validation", () => {
  test("notifies prompt changes from the composer", () => {
    const prompts: string[] = [];
    const { rerender } = renderAgentPanel({
      state: {
        ...createAgentState(),
        promptDraft: "",
      },
      onPromptChange: (prompt) => prompts.push(prompt),
    });

    const promptInput = screen.getByLabelText("Agent prompt");
    expect((promptInput as HTMLTextAreaElement).value).toBe("");

    fireEvent.change(promptInput, { target: { value: "Plan Node 7" } });

    expect(prompts).toEqual(["Plan Node 7"]);

    rerender(
      <AgentPanel
        state={{
          ...createAgentState(),
          promptDraft: "Plan Node 7",
        }}
        availableContext={[]}
        onModeChange={() => {}}
        onPromptChange={() => {}}
        onToggleContext={() => {}}
        onStartSession={() => {}}
        onSelectSession={() => {}}
        onApprove={() => {}}
        onReject={() => {}}
        onExport={() => {}}
      />,
    );

    expect((promptInput as HTMLTextAreaElement).value).toBe("Plan Node 7");
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

describe("AgentPanel css contract", () => {
  function extractMediaBlock(source: string): string {
    const mediaQueryStart = source.indexOf("@media (max-width: 760px)");
    expect(mediaQueryStart).toBeGreaterThan(-1);

    const blockStart = source.indexOf("{", mediaQueryStart);
    let depth = 0;
    let blockEnd = -1;
    for (let i = blockStart; i < source.length; i++) {
      const char = source[i];
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          blockEnd = i;
          break;
        }
      }
    }

    expect(blockEnd).toBeGreaterThan(-1);
    return source.slice(blockStart + 1, blockEnd);
  }

  function extractRuleBody(mediaBlock: string, selector: string): string | null {
    let offset = 0;
    const trimmedSelector = selector.trim();

    while (offset < mediaBlock.length) {
      const open = mediaBlock.indexOf("{", offset);
      if (open === -1) {
        break;
      }

      const selectorText = mediaBlock.slice(offset, open).trim();
      const selectors = selectorText
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      if (selectors.includes(trimmedSelector)) {
        let depth = 1;
        let close = open;
        for (let i = open + 1; i < mediaBlock.length; i++) {
          if (mediaBlock[i] === "{") {
            depth += 1;
          }
          if (mediaBlock[i] === "}") {
            depth -= 1;
            if (depth === 0) {
              close = i;
              break;
            }
          }
        }
        return mediaBlock.slice(open + 1, close).trim();
      }

      let depth = 1;
      for (let i = open + 1; i < mediaBlock.length; i++) {
        if (mediaBlock[i] === "{") {
          depth += 1;
        }
        if (mediaBlock[i] === "}") {
          depth -= 1;
          if (depth === 0) {
            offset = i + 1;
            break;
          }
        }
      }
    }

    return null;
  }

  test("defines compact-safe agent mode buttons and keeps badges visible on mobile", () => {
    const cssPath = resolve(
      process.cwd(),
      "src/index.css",
    );
    const source = readFileSync(cssPath, "utf8");

    expect(source.includes(".btn.sm")).toBe(true);
    expect(source.includes(".btn.ghost")).toBe(true);
    expect(source.includes(".agent-panel .agent-session-toolbar .badge2")).toBe(true);
    expect(source.includes(".agent-panel .agent-status")).toBe(true);
    expect(source.includes(".agent-panel .agent-transcript-head .badge2")).toBe(true);
    expect(source.includes(".agent-modes .btn.sm")).toBe(true);
  });

  test("keeps badge hide override scoped correctly in compact media query", () => {
    const cssPath = resolve(
      process.cwd(),
      "src/index.css",
    );
    const source = readFileSync(cssPath, "utf8");

    const mediaBlock = extractMediaBlock(source);

    const globalBadgeRule = extractRuleBody(mediaBlock, ".badge2");
    const toolbarBadgeRule = extractRuleBody(
      mediaBlock,
      ".agent-panel .agent-session-toolbar .badge2",
    );
    const statusRule = extractRuleBody(mediaBlock, ".agent-panel .agent-status");
    const transcriptBadgeRule = extractRuleBody(
      mediaBlock,
      ".agent-panel .agent-transcript-head .badge2",
    );
    const modeGridRule = extractRuleBody(mediaBlock, ".agent-panel .agent-modes");
    const compactModeButtonRule = extractRuleBody(
      mediaBlock,
      ".agent-panel .agent-modes .btn.sm",
    );

    expect(globalBadgeRule).toContain("display: none");
    expect(toolbarBadgeRule).toContain("display: inline-flex");
    expect(statusRule).toContain("display: inline-flex");
    expect(transcriptBadgeRule).toContain("display: inline-flex");
    expect(modeGridRule).toContain("grid-template-columns");
    expect(modeGridRule).not.toContain("repeat(5");
    expect(compactModeButtonRule).toContain("overflow");
  });

  test("uses runtime-defined tokens for passed status", () => {
    const cssPath = resolve(
      process.cwd(),
      "src/index.css",
    );
    const source = readFileSync(cssPath, "utf8");

    const statusRule = source.match(/\.agent-status\.passed\s*\{[\s\S]*?\}/);
    expect(statusRule).not.toBeNull();
    const rule = statusRule?.[0] ?? "";

    expect(rule.includes("var(--c-str)")).toBe(false);
    expect(rule.includes("var(--yuzu)")).toBe(true);
    expect(rule.includes("var(--yuzu-edge)")).toBe(true);
    expect(rule.includes("var(--yuzu-wash)")).toBe(true);
  });
});
