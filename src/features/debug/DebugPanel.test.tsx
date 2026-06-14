/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { ensureTestDom } from "../../test/test-dom";
import { createDebugState, replaceDebugLaunchConfigs } from "./debug-model";

ensureTestDom();
const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { DebugPanel } = await import("./DebugPanel");

afterEach(() => cleanup());

type DebugPanelProps = Parameters<typeof DebugPanel>[0];

function renderDebugPanel(
  state: DebugPanelProps["state"],
  handlers: Partial<Omit<DebugPanelProps, "state">> = {},
) {
  return render(
    <DebugPanel
      state={state}
      onModeChange={() => {}}
      onSelectConfig={() => {}}
      onStartSession={() => {}}
      onContinue={() => {}}
      onStepOver={() => {}}
      onPause={() => {}}
      onDisconnect={() => {}}
      onOpenFrame={() => {}}
      onAddWatch={() => {}}
      onRemoveWatch={() => {}}
      onEvaluate={() => {}}
      {...handlers}
    />,
  );
}

describe("DebugPanel", () => {
  test("renders debug state and dispatches toolbar and mode actions", () => {
    const onModeChange = mock((mode: string) => mode);
    const onStartSession = mock(() => {});
    const state = {
      ...replaceDebugLaunchConfigs(createDebugState(), [
        {
          id: "cfg-python",
          workspace_root: "/repo",
          name: "Python file",
          adapter: "Python" as const,
          request: "Launch" as const,
          program: "app.py",
          cwd: ".",
          args: [],
          env: [],
          stop_on_entry: true,
          attach: null,
          created_ms: 1,
          updated_ms: 1,
        },
      ]),
      sessions: [
        {
          id: "session-1",
          workspace_id: "workspace",
          workspace_root: "/repo",
          config_id: "cfg-python",
          name: "Python file",
          adapter: "Python" as const,
          status: "Stopped" as const,
          active_thread_id: 1,
          stopped_reason: "breakpoint",
          last_error: null,
          sequence: 1,
        },
      ],
      activeSessionId: "session-1",
      breakpointsByPath: {
        "app.py": [
          {
            line: 8,
            condition: null,
            log_message: null,
            verified: true,
          },
        ],
      },
      stackBySessionId: {
        "session-1": [
          { id: 1, name: "main", source_path: "app.py", line: 8, column: 1 },
        ],
      },
      scopesByFrameId: {
        "session-1:1": [
          { name: "Locals", variables_reference: 100, expensive: false },
        ],
      },
      variablesByReference: {
        "session-1:100": [
          {
            name: "counter",
            value: "8",
            type: "int",
            variables_reference: 0,
          },
        ],
      },
      watches: [
        {
          expression: "counter",
          value: "8",
          type: "int",
          variables_reference: 0,
          error: null,
        },
      ],
      consoleBySessionId: { "session-1": "stopped at breakpoint" },
    };

    const result = render(
      <DebugPanel
        state={state}
        onModeChange={onModeChange}
        onSelectConfig={() => {}}
        onStartSession={onStartSession}
        onContinue={() => {}}
        onStepOver={() => {}}
        onPause={() => {}}
        onDisconnect={() => {}}
        onOpenFrame={() => {}}
        onAddWatch={() => {}}
        onRemoveWatch={() => {}}
        onEvaluate={() => {}}
      />,
    );

    expect(result.getByText("Debug")).toBeTruthy();
    expect(result.getAllByText("Python file").length).toBeGreaterThan(0);
    expect(result.getByText("main")).toBeTruthy();
    expect(result.getAllByText("counter").length).toBeGreaterThan(0);
    expect(result.getByText("stopped at breakpoint")).toBeTruthy();

    fireEvent.click(result.getByLabelText("Start debug session"));
    expect(onStartSession).toHaveBeenCalled();

    fireEvent.click(result.getByRole("button", { name: "Breakpoints" }));
    fireEvent.click(result.getByRole("button", { name: "Variables" }));
    fireEvent.click(result.getByRole("button", { name: "Console" }));
    expect(onModeChange.mock.calls.map((call) => call[0])).toEqual([
      "breakpoints",
      "variables",
      "console",
    ]);
  });

  test("disables start when no active launch config is selected", () => {
    const onStartSession = mock(() => {});
    const result = renderDebugPanel(createDebugState(), { onStartSession });
    const startButton = result.getByLabelText(
      "Start debug session",
    ) as HTMLButtonElement;

    expect(startButton.disabled).toBe(true);
    fireEvent.click(startButton);
    expect(onStartSession).not.toHaveBeenCalled();
  });

  test("disables session controls when active session is missing", () => {
    for (const activeSessionId of [null, "missing-session"]) {
      cleanup();
      const onContinue = mock(() => {});
      const onStepOver = mock(() => {});
      const onPause = mock(() => {});
      const onDisconnect = mock(() => {});
      const state = {
        ...createDebugState(),
        activeSessionId,
        sessions: [
          {
            id: "session-1",
            workspace_id: "workspace",
            workspace_root: "/repo",
            config_id: "cfg-python",
            name: "Python file",
            adapter: "Python" as const,
            status: "Stopped" as const,
            active_thread_id: 1,
            stopped_reason: "breakpoint",
            last_error: null,
            sequence: 1,
          },
        ],
      };

      const result = renderDebugPanel(state, {
        onContinue,
        onStepOver,
        onPause,
        onDisconnect,
      });
      const controls = [
        result.getByLabelText("Continue debug session") as HTMLButtonElement,
        result.getByLabelText("Step over debug session") as HTMLButtonElement,
        result.getByLabelText("Pause debug session") as HTMLButtonElement,
        result.getByLabelText("Disconnect debug session") as HTMLButtonElement,
      ];

      for (const control of controls) {
        expect(control.disabled).toBe(true);
        fireEvent.click(control);
      }
      expect(onContinue).not.toHaveBeenCalled();
      expect(onStepOver).not.toHaveBeenCalled();
      expect(onPause).not.toHaveBeenCalled();
      expect(onDisconnect).not.toHaveBeenCalled();
    }
  });
});
