/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  activeAgentSession,
  agentBadgeCount,
  agentContextSummary,
  agentContextFromDiagnostic,
  agentContextFromDiff,
  agentContextFromDoc,
  agentContextFromFile,
  agentContextFromTerminal,
  approvalEntries,
  verificationSummary,
  type AgentMode,
  type AgentViewState,
  createAgentState,
  replaceAgentSessions,
  selectAgentSession,
  storeAgentSession,
  transcriptByKind,
  type AgentTranscriptEntry,
  type AgentSession,
} from "./agent-model";

function session(id: string, mode: AgentMode = "plan"): AgentSession {
  return {
    id,
    workspace_root: "/repo",
    mode,
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
        id: "prompt-1",
        session_id: id,
        kind: "user_prompt",
        title: "Prompt",
        content: "Plan Node 7",
        status: null,
        approval_status: null,
        metadata: {},
        created_ms: 1,
      },
      {
        id: "approval-1",
        session_id: id,
        kind: "approval_request",
        title: "Edit src/app/AppShell.tsx",
        content: "Requires review",
        status: "pending",
        approval_status: "pending",
        metadata: { path: "src/app/AppShell.tsx" },
        created_ms: 2,
      },
    ],
    created_ms: 1,
    updated_ms: 2,
  };
}

describe("agent model", () => {
  test("stores sessions and selects the newest active session", () => {
    const state = replaceAgentSessions(createAgentState(), [
      session("old"),
      { ...session("new"), updated_ms: 5 },
    ]);

    expect(state.activeSessionId).toBe("new");
    expect(activeAgentSession(state)?.id).toBe("new");
  });

  test("preserves draft and active session when updating existing non-active sessions", () => {
    const state: AgentViewState = {
      ...replaceAgentSessions(createAgentState(), [
        session("one"),
        session("two"),
      ]),
      activeSessionId: "two",
      promptDraft: "In progress",
      selectedContextIds: { "file:src/app/AppShell.tsx": true } satisfies Record<string, true>,
    };

    const updated = storeAgentSession(state, {
      ...session("one"),
      prompt: "Updated",
      updated_ms: 10,
    });

    expect(updated.sessions.map((item) => item.id)).toEqual(["one", "two"]);
    expect(updated.sessions[0].prompt).toBe("Updated");
    expect(updated.activeSessionId).toBe("two");
    expect(updated.promptDraft).toBe("In progress");
    expect(updated.selectedContextIds).toEqual({
      "file:src/app/AppShell.tsx": true,
    });
  });

  test("clears draft and selects newly inserted sessions", () => {
    const state: AgentViewState = {
      ...replaceAgentSessions(createAgentState(), [session("one"), session("two")]),
      activeSessionId: "two",
      promptDraft: "In progress",
      selectedContextIds: { "file:src/app/AppShell.tsx": true } satisfies Record<string, true>,
    };

    const updated = storeAgentSession(state, {
      ...session("three"),
      prompt: "New plan",
      updated_ms: 10,
    });

    expect(updated.sessions[0].id).toBe("three");
    expect(updated.activeSessionId).toBe("three");
    expect(updated.promptDraft).toBe("");
    expect(updated.selectedContextIds).toEqual({});
  });

  test("summarizes context and approvals", () => {
    const state = replaceAgentSessions(createAgentState(), [session("one")]);

    expect(agentContextSummary(state.sessions[0])).toBe("1 file");
    expect(approvalEntries(state.sessions[0])).toHaveLength(1);
    expect(transcriptByKind(state.sessions[0], "approval_request")).toHaveLength(1);
    expect(agentBadgeCount(state)).toBe("1");
  });

  test("summarizes verification outcomes with passed and failed", () => {
    const withVerificationTranscript: AgentTranscriptEntry[] = [
      {
        id: "verification-passed",
        session_id: "with-verification",
        kind: "verification",
        title: "Run tests",
        content: "all pass",
        status: "passed",
        approval_status: null,
        metadata: { command: "bun test" },
        created_ms: 4,
      },
      {
        id: "verification-failed",
        session_id: "with-verification",
        kind: "verification",
        title: "Run lint",
        content: "lint failed",
        status: "failed",
        approval_status: null,
        metadata: { command: "bun lint" },
        created_ms: 5,
      },
      {
        id: "verification-skipped",
        session_id: "with-verification",
        kind: "verification",
        title: "Run format",
        content: "skipped",
        status: "skipped",
        approval_status: null,
        metadata: {},
        created_ms: 6,
      },
    ];

    const noVerification = {
      ...session("no-verification"),
      transcript: [],
    };
    expect(verificationSummary(noVerification)).toBe("0 passed | 0 failed");

    const withVerification: AgentSession = {
      ...session("with-verification"),
      transcript: withVerificationTranscript,
    };
    expect(verificationSummary(withVerification)).toBe("1 passed | 1 failed");
  });

  test("builds bounded agent context items from selected sources", () => {
    expect(
      agentContextFromFile({
        path: "/repo/src/app.ts",
        workspaceRoot: "/repo",
        content: "export const app = true;",
      }),
    ).toMatchObject({
      id: "file:src/app.ts",
      kind: "file",
      label: "src/app.ts",
      path: "src/app.ts",
      truncated: false,
    });

    expect(
      agentContextFromDoc({
        path: "docs/architecture/tech-stack.md",
        title: "Tech Stack",
        content: "# Tech Stack",
      }),
    ).toMatchObject({
      id: "doc:docs/architecture/tech-stack.md",
      kind: "doc",
      label: "Tech Stack",
    });

    expect(
      agentContextFromDiff({
        path: "src/app/AppShell.tsx",
        staged: false,
        raw: "diff --git a/src/app/AppShell.tsx b/src/app/AppShell.tsx",
      }),
    ).toMatchObject({
      id: "diff:unstaged:src/app/AppShell.tsx",
      kind: "diff",
    });
  });

  test("bounds long terminal context", () => {
    const item = agentContextFromTerminal({
      sessionId: "w:terminal-1",
      name: "zsh",
      output: "x".repeat(130_000),
    });

    expect(item.content).toHaveLength(120_000);
    expect(item.truncated).toBe(true);
  });

  test("bounds diagnostic context and keeps ids compact", () => {
    const longMessage = "y".repeat(130_000);
    const first = agentContextFromDiagnostic({
      path: "src/app.ts",
      message: longMessage,
      severity: "error",
      line: 42,
    });
    const second = agentContextFromDiagnostic({
      path: "src/app.ts",
      message: longMessage,
      severity: "error",
      line: 42,
    });

    expect(first.content).toHaveLength(120_000);
    expect(first.truncated).toBe(true);
    expect(first.id.length).toBeLessThan(300);
    expect(first.id).not.toContain(longMessage);
    expect(first.id).toBe(second.id);
    expect(first.kind).toBe("diagnostic");
    expect(first.label).toBe("error: src/app.ts:42");
  });

  test("uses wider deterministic diagnostic id and avoids collisions", () => {
    const messageA = "diag-1ajz-5q2yv3";
    const messageB = "diag-2rsa-rsfrbe";

    const itemA1 = agentContextFromDiagnostic({
      path: "src/app.ts",
      message: messageA,
      severity: "error",
      line: 42,
    });
    const itemA2 = agentContextFromDiagnostic({
      path: "src/app.ts",
      message: messageA,
      severity: "error",
      line: 42,
    });
    const itemB = agentContextFromDiagnostic({
      path: "src/app.ts",
      message: messageB,
      severity: "error",
      line: 42,
    });

    expect(itemA1.id).toMatch(/^diagnostic:src\/app\.ts:42:error:[0-9a-f]{16}$/);
    expect(itemA1.id).not.toContain(messageA);
    expect(itemB.id).not.toContain(messageB);
    expect(itemA1.id).toHaveLength(16 + "diagnostic:src/app.ts:42:error:".length);
    expect(itemA1.id.length).toBeLessThan(300);
    expect(itemB.id.length).toBeLessThan(300);
    expect(itemA1.id).toBe(itemA2.id);
    expect(itemA1.id).not.toBe(itemB.id);
  });

  test("normalizes file context paths across fallback and windows forms", () => {
    expect(
      agentContextFromFile({
        workspaceRoot: "/repo",
        path: "src\\app.ts",
        content: "file",
      }),
    ).toMatchObject({
      id: "file:src/app.ts",
      path: "src/app.ts",
      label: "src/app.ts",
    });

    expect(
      agentContextFromFile({
        workspaceRoot: "C:\\Repo",
        path: "c:\\Repo\\src\\app.ts",
        content: "file",
      }),
    ).toMatchObject({
      id: "file:src/app.ts",
      path: "src/app.ts",
      label: "src/app.ts",
    });

    expect(
      agentContextFromFile({
        workspaceRoot: "/repo",
        path: "/repo-old/src/app.ts",
        content: "file",
      }),
    ).toMatchObject({
      id: "file:/repo-old/src/app.ts",
      path: "/repo-old/src/app.ts",
      label: "/repo-old/src/app.ts",
    });

    expect(
      agentContextFromFile({
        workspaceRoot: "/repo",
        path: "/repo/src/app.ts",
        content: "file",
      }),
    ).toMatchObject({
      id: "file:src/app.ts",
      path: "src/app.ts",
      label: "src/app.ts",
    });
  });

  test("builds bounded diagnostic context with ids and labels", () => {
    expect(
      agentContextFromDiagnostic({
        path: "src/app.ts",
        message: "Unused variable",
        severity: "error",
        line: 42,
      }),
    ).toMatchObject({
      kind: "diagnostic",
      label: "error: src/app.ts:42",
      path: "src/app.ts",
      content: "Unused variable",
      truncated: false,
    });
  });

  test("summarizes screenshot context items", () => {
    const summary = agentContextSummary({
      id: "agent-1",
      workspace_root: "/repo",
      mode: "verify",
      prompt: "Check preview",
      context_items: [
        {
          id: "screenshot:shot-1",
          kind: "screenshot",
          label: "Browser screenshot: localhost:5173",
          path: null,
          content: "data:image/png;base64,iVBORw0KGgo=",
          truncated: false,
        },
      ],
      transcript: [],
      created_ms: 1,
      updated_ms: 2,
    });

    expect(summary).toBe("1 screenshot");
  });

  test("ignores missing selected sessions", () => {
    const state = replaceAgentSessions(createAgentState(), [session("one")]);

    expect(selectAgentSession(state, "missing").activeSessionId).toBe("one");
  });
});
