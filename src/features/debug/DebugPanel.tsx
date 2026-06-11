import { type FormEvent, type ReactNode, useState } from "react";
import {
  Bug,
  CircleDot,
  ListTree,
  Pause,
  Play,
  Plus,
  Square,
  StepForward,
  Terminal,
  Trash2,
  Variable,
} from "lucide-react";

import type {
  DebugLaunchConfig,
  DebugSessionInfo,
  DebugSourceBreakpoint,
  DebugStackFrame,
  DebugViewState,
  DebugWatchExpression,
} from "./debug-model";

type DebugMode = DebugViewState["mode"];

type DebugPanelProps = {
  state: DebugViewState;
  onModeChange: (mode: DebugMode) => void;
  onSelectConfig: (configId: string) => void;
  onStartSession: () => void;
  onContinue: (sessionId: string) => void;
  onStepOver: (sessionId: string) => void;
  onPause: (sessionId: string) => void;
  onDisconnect: (sessionId: string) => void;
  onOpenFrame: (frame: DebugStackFrame) => void;
  onAddWatch: (expression: string) => void;
  onRemoveWatch: (watch: number | string) => void;
  onEvaluate: (expression: string) => void;
};

const debugModes: Array<{ mode: DebugMode; label: string }> = [
  { mode: "sessions", label: "Sessions" },
  { mode: "breakpoints", label: "Breakpoints" },
  { mode: "variables", label: "Variables" },
  { mode: "console", label: "Console" },
];

export function DebugPanel({
  state,
  onModeChange,
  onSelectConfig,
  onStartSession,
  onContinue,
  onStepOver,
  onPause,
  onDisconnect,
  onOpenFrame,
  onAddWatch,
  onRemoveWatch,
  onEvaluate,
}: DebugPanelProps) {
  const [watchExpression, setWatchExpression] = useState("");
  const [evalExpression, setEvalExpression] = useState("");
  const activeSession = activeDebugSession(state);
  const sessionId = activeSession?.id ?? null;
  const canStartSession = state.launchConfigs.some(
    (config) => config.id === state.activeConfigId,
  );
  const stack = sessionId ? (state.stackBySessionId[sessionId] ?? []) : [];
  const variables = debugVariablesForSession(state, sessionId);
  const consoleText = sessionId ? (state.consoleBySessionId[sessionId] ?? "") : "";

  function submitWatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const expression = watchExpression.trim();
    if (!expression) {
      return;
    }
    onAddWatch(expression);
    setWatchExpression("");
  }

  function submitEval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const expression = evalExpression.trim();
    if (!expression) {
      return;
    }
    onEvaluate(expression);
    setEvalExpression("");
  }

  return (
    <section className="debug-panel">
      <div className="panel-head">
        <span className="panel-title">Debug</span>
        <div className="panel-acts">
          <button
            className="iconbtn"
            type="button"
            aria-label="Start debug session"
            disabled={!canStartSession}
            onClick={() => canStartSession && onStartSession()}
          >
            <Play aria-hidden="true" />
          </button>
          <button
            className="iconbtn"
            type="button"
            aria-label="Continue debug session"
            disabled={!sessionId}
            onClick={() => sessionId && onContinue(sessionId)}
          >
            <Play aria-hidden="true" />
          </button>
          <button
            className="iconbtn"
            type="button"
            aria-label="Step over debug session"
            disabled={!sessionId}
            onClick={() => sessionId && onStepOver(sessionId)}
          >
            <StepForward aria-hidden="true" />
          </button>
          <button
            className="iconbtn"
            type="button"
            aria-label="Pause debug session"
            disabled={!sessionId}
            onClick={() => sessionId && onPause(sessionId)}
          >
            <Pause aria-hidden="true" />
          </button>
          <button
            className="iconbtn"
            type="button"
            aria-label="Disconnect debug session"
            disabled={!sessionId}
            onClick={() => sessionId && onDisconnect(sessionId)}
          >
            <Square aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="debug-mode-tabs" role="group" aria-label="Debug mode">
        {debugModes.map((item) => (
          <button
            key={item.mode}
            className={state.mode === item.mode ? "active" : undefined}
            type="button"
            onClick={() => onModeChange(item.mode)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="panel-body debug-panel-body">
        <DebugSection title="Configurations" count={state.launchConfigs.length}>
          {state.launchConfigs.map((config) => (
            <ConfigRow
              key={config.id}
              config={config}
              selected={state.activeConfigId === config.id}
              onSelectConfig={onSelectConfig}
            />
          ))}
        </DebugSection>

        <DebugSection title="Sessions" count={state.sessions.length}>
          {state.sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              selected={session.id === state.activeSessionId}
            />
          ))}
        </DebugSection>

        <DebugSection title="Call Stack" count={stack.length}>
          {stack.map((frame) => (
            <button
              key={frame.id}
              className="row debug-row"
              type="button"
              onClick={() => onOpenFrame(frame)}
            >
              <ListTree aria-hidden="true" />
              <span className="nm mono">{frame.name}</span>
              <span className="meta">{frame.source_path}:{frame.line}</span>
            </button>
          ))}
        </DebugSection>

        <DebugSection title="Variables" count={variables.length}>
          {variables.map((variable) => (
            <div key={`${variable.name}:${variable.value}`} className="row debug-row">
              <Variable aria-hidden="true" />
              <span className="nm mono">{variable.name}</span>
              <span className="debug-value mono">{variable.value}</span>
            </div>
          ))}
        </DebugSection>

        <DebugSection title="Watch" count={state.watches.length}>
          <form className="debug-inline-form" onSubmit={submitWatch}>
            <input
              className="input2 mono"
              aria-label="Watch expression"
              value={watchExpression}
              placeholder="expression"
              onChange={(event) => setWatchExpression(event.target.value)}
            />
            <button className="iconbtn" type="submit" aria-label="Add watch">
              <Plus aria-hidden="true" />
            </button>
          </form>
          {state.watches.map((watch, index) => (
            <WatchRow
              key={`${watch.expression}:${index}`}
              index={index}
              watch={watch}
              onRemoveWatch={onRemoveWatch}
            />
          ))}
        </DebugSection>

        <DebugSection title="Breakpoints" count={debugBreakpointCount(state)}>
          {Object.entries(state.breakpointsByPath).map(([sourcePath, breakpoints]) => (
            <BreakpointGroup
              key={sourcePath}
              sourcePath={sourcePath}
              breakpoints={breakpoints}
            />
          ))}
        </DebugSection>

        <DebugSection title="Console" count={consoleText ? 1 : 0}>
          <pre className="debug-console-preview mono">{consoleText || "console idle"}</pre>
          <form className="debug-inline-form" onSubmit={submitEval}>
            <input
              className="input2 mono"
              aria-label="Evaluate expression"
              value={evalExpression}
              placeholder="evaluate"
              onChange={(event) => setEvalExpression(event.target.value)}
            />
            <button className="iconbtn" type="submit" aria-label="Evaluate">
              <Terminal aria-hidden="true" />
            </button>
          </form>
        </DebugSection>
      </div>
    </section>
  );
}

function activeDebugSession(state: DebugViewState): DebugSessionInfo | null {
  return state.sessions.find((session) => session.id === state.activeSessionId) ?? null;
}

function debugVariablesForSession(
  state: DebugViewState,
  sessionId: string | null,
) {
  if (!sessionId) {
    return [];
  }

  return Object.entries(state.variablesByReference)
    .filter(([key]) => key.startsWith(`${sessionId}:`))
    .flatMap(([, variables]) => variables);
}

function debugBreakpointCount(state: DebugViewState): number {
  return Object.values(state.breakpointsByPath).reduce(
    (count, breakpoints) => count + breakpoints.length,
    0,
  );
}

function DebugSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="debug-section">
      <div className="section-label">
        <span>{title}</span>
        <span className="meta">{count}</span>
      </div>
      <div className="debug-section-body">{children}</div>
    </section>
  );
}

function ConfigRow({
  config,
  selected,
  onSelectConfig,
}: {
  config: DebugLaunchConfig;
  selected: boolean;
  onSelectConfig: (configId: string) => void;
}) {
  return (
    <button
      className={`row debug-row${selected ? " sel" : ""}`}
      type="button"
      onClick={() => onSelectConfig(config.id)}
    >
      <Bug aria-hidden="true" />
      <span className="nm mono">{config.name}</span>
      <span className="meta">{config.adapter}</span>
    </button>
  );
}

function SessionRow({
  session,
  selected,
}: {
  session: DebugSessionInfo;
  selected: boolean;
}) {
  return (
    <div className={`row debug-row${selected ? " sel" : ""}`}>
      <CircleDot aria-hidden="true" />
      <span className="nm mono">{session.name}</span>
      <span className={debugStatusClass(session.status)}>
        <span className="d" />
        {session.status}
      </span>
    </div>
  );
}

function WatchRow({
  index,
  watch,
  onRemoveWatch,
}: {
  index: number;
  watch: DebugWatchExpression;
  onRemoveWatch: (watch: number | string) => void;
}) {
  return (
    <div className="row debug-row">
      <Variable aria-hidden="true" />
      <span className="nm mono">{watch.expression}</span>
      <span className="debug-value mono">{watch.error ?? watch.value ?? "-"}</span>
      <button
        className="iconbtn debug-row-action"
        type="button"
        aria-label={`Remove watch ${watch.expression}`}
        onClick={() => onRemoveWatch(watch.expression || index)}
      >
        <Trash2 aria-hidden="true" />
      </button>
    </div>
  );
}

function BreakpointGroup({
  sourcePath,
  breakpoints,
}: {
  sourcePath: string;
  breakpoints: DebugSourceBreakpoint[];
}) {
  return (
    <div className="debug-breakpoint-group">
      <div className="row debug-row debug-source-row">
        <CircleDot aria-hidden="true" />
        <span className="nm mono">{sourcePath}</span>
        <span className="meta">{breakpoints.length}</span>
      </div>
      {breakpoints.map((breakpoint) => (
        <div key={`${sourcePath}:${breakpoint.line}`} className="row debug-row debug-child-row">
          <span
            className={`debug-breakpoint ${breakpoint.verified ? "verified" : "pending"}`}
          />
          <span className="nm mono">line {breakpoint.line}</span>
          <span className="meta">{breakpoint.verified ? "verified" : "pending"}</span>
        </div>
      ))}
    </div>
  );
}

function debugStatusClass(status: string): string {
  return status === "Running" || status === "Stopped"
    ? "badge2 green mono"
    : "badge2 mono";
}
