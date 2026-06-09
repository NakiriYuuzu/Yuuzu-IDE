/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { Window as HappyWindow } from "happy-dom";

import { createDocsState, type ContextPack } from "./docs-model";
import { DocsPanel } from "./DocsPanel";

const testWindow = new HappyWindow({ url: "http://localhost/" });
globalThis.window = testWindow as unknown as Window & typeof globalThis;
globalThis.document = testWindow.document as unknown as Document;
globalThis.HTMLElement = testWindow.HTMLElement as unknown as typeof HTMLElement;
globalThis.HTMLInputElement =
  testWindow.HTMLInputElement as unknown as typeof HTMLInputElement;
globalThis.Event = testWindow.Event as unknown as typeof Event;
globalThis.MouseEvent = testWindow.MouseEvent as unknown as typeof MouseEvent;
Object.defineProperty(globalThis, "navigator", {
  value: testWindow.navigator,
  configurable: true,
});

const { cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);

function pack(overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    id: "pack-1",
    workspace_root: "/workspace",
    name: "Architecture pack",
    doc_paths: ["README.md"],
    linked_task_run_ids: [],
    linked_agent_session_ids: [],
    created_ms: 1,
    updated_ms: 1,
    ...overrides,
  };
}

function renderDocsPanel({
  onLinkPackToAgentSession = async () => {},
}: {
  onLinkPackToAgentSession?: (
    id: string,
    agentSessionId: string,
  ) => Promise<void>;
} = {}) {
  return render(
    <DocsPanel
      state={{ ...createDocsState(), contextPacks: [pack()] }}
      onRefresh={() => {}}
      onSearch={() => {}}
      onOpenPreview={() => {}}
      onToggleSource={() => {}}
      onPackNameChange={() => {}}
      onCreatePack={() => {}}
      onSelectPack={() => {}}
      onDeletePack={() => {}}
      activeTaskRunId="workspace:task-1"
      onUsePackForActiveTask={() => {}}
      onLinkPackToAgentSession={onLinkPackToAgentSession}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("DocsPanel", () => {
  test("keeps an agent session draft when linking fails", async () => {
    const rejected = Promise.reject(new Error("link failed"));
    rejected.catch(() => {});
    const onLinkPackToAgentSession = mock(() => rejected);

    const view = renderDocsPanel({ onLinkPackToAgentSession });
    const input = view.getByLabelText(
      "Agent session id for Architecture pack",
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "agent-session-42" } });
    fireEvent.click(
      view.getByLabelText("Link Architecture pack to agent session"),
    );

    await waitFor(() => expect(onLinkPackToAgentSession).toHaveBeenCalledTimes(1));
    expect(input.value).toBe("agent-session-42");
  });
});
