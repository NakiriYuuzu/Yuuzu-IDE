/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  activeAgentSession,
  agentBadgeCount,
  agentContextSummary,
  approvalEntries,
  type AgentMode,
  type AgentViewState,
  createAgentState,
  replaceAgentSessions,
  selectAgentSession,
  storeAgentSession,
  transcriptByKind,
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

  test("ignores missing selected sessions", () => {
    const state = replaceAgentSessions(createAgentState(), [session("one")]);

    expect(selectAgentSession(state, "missing").activeSessionId).toBe("one");
  });
});
