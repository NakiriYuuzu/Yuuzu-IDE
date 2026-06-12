import {
  Activity,
  Download,
  Gauge,
  Keyboard,
  RotateCcw,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

import { DiagnosticsPanel } from "../diagnostics/DiagnosticsPanel";
import type { DiagnosticsViewState } from "../diagnostics/diagnostics-model";
import { RecoveryPanel } from "../recovery/RecoveryPanel";
import type { RecoveryViewState } from "../recovery/recovery-model";
import type { SettingsCategory, SettingsViewState } from "./settings-model";

type SettingsPanelProps = {
  state: SettingsViewState;
  recoveryState: RecoveryViewState;
  diagnosticsState: DiagnosticsViewState;
  onSelectCategory: (category: SettingsCategory) => void;
  onRecoveryRefresh: () => void;
  onRecoveryRestore: (backupId: string) => void;
  onRecoveryDiscard: (backupId: string) => void;
  onDiagnosticsRefresh: () => void;
  onKeybindingImportDraftChange: (draft: string) => void;
  onImportKeybindings: () => void;
};

const categories: Array<{
  id: SettingsCategory;
  label: string;
  icon: typeof RotateCcw;
}> = [
  { id: "recovery", label: "Recovery", icon: RotateCcw },
  { id: "performance", label: "Performance", icon: Gauge },
  { id: "diagnostics", label: "Diagnostics", icon: Activity },
  { id: "keybindings", label: "Keybindings", icon: Keyboard },
  { id: "updates", label: "Updates", icon: Download },
  { id: "personal-setup", label: "Personal Setup", icon: ShieldCheck },
];

function SettingsSummary({
  state,
  title,
  children,
}: {
  state: SettingsViewState;
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className="panel-head settings-detail-head">
        <span className="panel-title">{title}</span>
      </div>
      <div className="settings-detail-body">
        {state.error ? <div className="panel-note">{state.error}</div> : null}
        {children}
      </div>
    </>
  );
}

function SettingsMetricSummary({ state }: { state: SettingsViewState }) {
  const settings = state.settings;

  return (
    <SettingsSummary state={state} title="Updates">
      <div className="section-label">
        <span>Policy</span>
      </div>
      <div className="row settings-static-row">
        <Settings2 aria-hidden="true" />
        <span className="nm">Update channel</span>
        <span className="meta mono">{settings?.update_channel ?? "manual"}</span>
      </div>
      <div className="row settings-static-row">
        <Gauge aria-hidden="true" />
        <span className="nm">Density</span>
        <span className="meta mono">{settings?.density ?? "compact"}</span>
      </div>
    </SettingsSummary>
  );
}

function KeybindingsSettings({
  state,
  onKeybindingImportDraftChange,
  onImportKeybindings,
}: {
  state: SettingsViewState;
  onKeybindingImportDraftChange: (draft: string) => void;
  onImportKeybindings: () => void;
}) {
  const canImport = state.keybindingImportDraft.trim().length > 0;

  return (
    <SettingsSummary state={state} title="Keybindings">
      <div className="section-label">
        <span>Import</span>
        <span className="meta">VS Code JSON</span>
      </div>
      {state.keybindingImportError ? (
        <div className="panel-note">{state.keybindingImportError}</div>
      ) : null}
      <div className="settings-keybinding-import">
        <textarea
          aria-label="Paste keybindings JSON"
          className="input2 mono"
          rows={5}
          value={state.keybindingImportDraft}
          onInput={(event) =>
            onKeybindingImportDraftChange(
              (event.target as HTMLTextAreaElement).value,
            )
          }
        />
        <button
          type="button"
          className="btn primary"
          disabled={!canImport}
          aria-label="Import keybindings"
          onClick={onImportKeybindings}
        >
          <Keyboard aria-hidden="true" />
          Import keybindings
        </button>
      </div>
    </SettingsSummary>
  );
}

export function SettingsPanel({
  state,
  recoveryState,
  diagnosticsState,
  onSelectCategory,
  onRecoveryRefresh,
  onRecoveryRestore,
  onRecoveryDiscard,
  onDiagnosticsRefresh,
  onKeybindingImportDraftChange,
  onImportKeybindings,
}: SettingsPanelProps) {
  return (
    <>
      <div className="panel-head">
        <span className="panel-title">Settings</span>
      </div>
      <div className="panel-body settings-panel">
        <div className="settings-category-list">
          {categories.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              className={`row settings-category-row${
                state.activeCategory === id ? " sel" : ""
              }`}
              key={id}
              onClick={() => onSelectCategory(id)}
            >
              <Icon aria-hidden="true" />
              <span className="nm">{label}</span>
            </button>
          ))}
        </div>
        <div className="settings-detail">
          {state.activeCategory === "recovery" ? (
            <RecoveryPanel
              state={recoveryState}
              onRefresh={onRecoveryRefresh}
              onRestore={onRecoveryRestore}
              onDiscard={onRecoveryDiscard}
            />
          ) : null}
          {state.activeCategory === "performance" ||
          state.activeCategory === "diagnostics" ? (
            <DiagnosticsPanel
              state={diagnosticsState}
              onRefresh={onDiagnosticsRefresh}
            />
          ) : null}
          {state.activeCategory === "keybindings" ? (
            <KeybindingsSettings
              state={state}
              onKeybindingImportDraftChange={onKeybindingImportDraftChange}
              onImportKeybindings={onImportKeybindings}
            />
          ) : null}
          {state.activeCategory === "updates" ? (
            <SettingsMetricSummary state={state} />
          ) : null}
          {state.activeCategory === "personal-setup" ? (
            <SettingsSummary state={state} title="Personal Setup">
              <div className="section-label">
                <span>Local defaults</span>
              </div>
              <div className="row settings-static-row">
                <ShieldCheck aria-hidden="true" />
                <span className="nm">Accent</span>
                <span className="meta mono">
                  {state.settings?.accent_color ?? "yuzu"}
                </span>
              </div>
            </SettingsSummary>
          ) : null}
        </div>
      </div>
    </>
  );
}
