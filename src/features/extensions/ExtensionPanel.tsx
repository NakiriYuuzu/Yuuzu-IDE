import {
  FileCode2,
  Gauge,
  Keyboard,
  Palette,
  Power,
  Puzzle,
  RefreshCw,
  Workflow,
  Zap,
} from "lucide-react";

import {
  activeExtensionStatus,
  type ExtensionCommandContribution,
  type ExtensionKeybindingContribution,
  type ExtensionSnippetContribution,
  type ExtensionThemeContribution,
  type ExtensionViewState,
  type ExtensionWorkspaceHookContribution,
  type ExtensionWorkspaceStatus,
} from "./extension-model";

type ExtensionPanelProps = {
  state: ExtensionViewState;
  onRefresh: () => void;
  onSelectExtension: (extensionId: string) => void;
  onToggleExtension: (extensionId: string, enabled: boolean) => void;
};

function ExtensionRow({
  status,
  active,
  onSelect,
  onToggle,
}: {
  status: ExtensionWorkspaceStatus;
  active: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const toggleLabel = status.enabled
    ? `Disable ${status.manifest.name}`
    : `Enable ${status.manifest.name}`;
  const performanceClass = status.performance.class;

  return (
    <div
      className={`row extension-row${active ? " sel" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`Select ${status.manifest.name}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <Puzzle aria-hidden="true" />
      <div className="extension-row-main">
        <span className="extension-row-title">{status.manifest.name}</span>
        <span className="extension-row-sub mono">
          {status.manifest.id} / v{status.manifest.version}
        </span>
      </div>
      <span className={`badge2${status.enabled ? " green" : ""}`}>
        {status.enabled ? "Enabled" : "Disabled"}
      </span>
      <span
        className={`badge2${performanceClass === "Slow" ? " extension-slow" : ""}`}
        title={`${status.performance.slow_operation_count} slow operations`}
      >
        {performanceClass}
      </span>
      <button
        type="button"
        className={`iconbtn${status.enabled ? " on" : ""}`}
        title={toggleLabel}
        aria-label={toggleLabel}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(!status.enabled);
        }}
      >
        <Power aria-hidden="true" />
      </button>
    </div>
  );
}

function CommandsSection({
  commands,
}: {
  commands: ExtensionCommandContribution[];
}) {
  return (
    <section>
      <div className="section-label">
        <span>Commands</span>
        <span>{commands.length}</span>
      </div>
      {commands.map((command) => (
        <div className="row extension-contribution-row" key={command.id}>
          <Zap aria-hidden="true" />
          <div className="extension-contribution-main">
            <span className="extension-contribution-title">{command.label}</span>
            <span className="extension-contribution-sub mono">
              {command.id} / {command.group}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}

function ThemesSection({
  themes,
}: {
  themes: ExtensionThemeContribution[];
}) {
  return (
    <section>
      <div className="section-label">
        <span>Themes</span>
        <span>{themes.length}</span>
      </div>
      {themes.map((theme) => (
        <div className="row extension-contribution-row" key={theme.id}>
          <Palette aria-hidden="true" />
          <div className="extension-contribution-main">
            <span className="extension-contribution-title">{theme.label}</span>
            <span className="extension-contribution-sub mono">
              {theme.mode} / {theme.accent}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}

function KeybindingsSection({
  keybindings,
}: {
  keybindings: ExtensionKeybindingContribution[];
}) {
  return (
    <section>
      <div className="section-label">
        <span>Keybindings</span>
        <span>{keybindings.length}</span>
      </div>
      {keybindings.map((keybinding) => (
        <div
          className="row extension-contribution-row"
          key={`${keybinding.command}:${keybinding.key}:${keybinding.when}`}
        >
          <Keyboard aria-hidden="true" />
          <div className="extension-contribution-main">
            <span className="extension-contribution-title">{keybinding.key}</span>
            <span className="extension-contribution-sub mono">
              {keybinding.command} / {keybinding.when}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}

function SnippetsSection({
  snippets,
}: {
  snippets: ExtensionSnippetContribution[];
}) {
  return (
    <section>
      <div className="section-label">
        <span>Snippets</span>
        <span>{snippets.length}</span>
      </div>
      {snippets.map((snippet) => (
        <div className="row extension-contribution-row" key={snippet.id}>
          <FileCode2 aria-hidden="true" />
          <div className="extension-contribution-main">
            <span className="extension-contribution-title">{snippet.prefix}</span>
            <span className="extension-contribution-sub mono">
              {snippet.language} / {snippet.description}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}

function WorkspaceHooksSection({
  hooks,
}: {
  hooks: ExtensionWorkspaceHookContribution[];
}) {
  return (
    <section>
      <div className="section-label">
        <span>Workspace hooks</span>
        <span>{hooks.length}</span>
      </div>
      {hooks.map((hook) => (
        <div className="row extension-contribution-row" key={hook.id}>
          <Workflow aria-hidden="true" />
          <div className="extension-contribution-main">
            <span className="extension-contribution-title">{hook.event}</span>
            <span className="extension-contribution-sub mono">
              {hook.command} / budget {hook.budget_ms}ms
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}

function PerformanceSection({ status }: { status: ExtensionWorkspaceStatus }) {
  const lastDuration = status.performance.last_duration_ms;

  return (
    <section>
      <div className="section-label">
        <span>Performance</span>
        <span>{status.performance.sample_count}</span>
      </div>
      <div className="row extension-contribution-row">
        <Gauge aria-hidden="true" />
        <div className="extension-contribution-main">
          <span className="extension-contribution-title">
            {status.performance.class}
          </span>
          <span className="extension-contribution-sub mono">
            last {lastDuration === null ? "n/a" : `${lastDuration}ms`} / slow{" "}
            {status.performance.slow_operation_count}
          </span>
        </div>
      </div>
    </section>
  );
}

export function ExtensionPanel({
  state,
  onRefresh,
  onSelectExtension,
  onToggleExtension,
}: ExtensionPanelProps) {
  const activeStatus = activeExtensionStatus(state);

  return (
    <div>
      <div className="panel-head">
        <span className="panel-title">Extensions</span>
        <div className="panel-acts">
          <button
            type="button"
            className="iconbtn"
            title="Refresh extensions"
            aria-label="Refresh extensions"
            onClick={onRefresh}
            disabled={state.loading}
          >
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="panel-body extension-panel">
        {state.error ? (
          <div className="panel-error-inline" role="alert">
            {state.error}
          </div>
        ) : null}

        <section>
          <div className="section-label">
            <span>Installed</span>
            <span>{state.statuses.length}</span>
          </div>
          {state.statuses.length > 0 ? (
            state.statuses.map((status) => (
              <ExtensionRow
                key={status.manifest.id}
                status={status}
                active={status.manifest.id === state.activeExtensionId}
                onSelect={() => onSelectExtension(status.manifest.id)}
                onToggle={(enabled) =>
                  onToggleExtension(status.manifest.id, enabled)
                }
              />
            ))
          ) : (
            <div className="panel-empty">No extensions installed</div>
          )}
        </section>

        {activeStatus ? (
          <section className="extension-detail">
            <div className="section-label">
              <span>Details</span>
              <span>{activeStatus.manifest.id}</span>
            </div>
            <PerformanceSection status={activeStatus} />
            <CommandsSection commands={activeStatus.manifest.contributes.commands} />
            <ThemesSection themes={activeStatus.manifest.contributes.themes} />
            <KeybindingsSection
              keybindings={activeStatus.manifest.contributes.keybindings}
            />
            <SnippetsSection snippets={activeStatus.manifest.contributes.snippets} />
            <WorkspaceHooksSection
              hooks={activeStatus.manifest.contributes.workspace_hooks}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
