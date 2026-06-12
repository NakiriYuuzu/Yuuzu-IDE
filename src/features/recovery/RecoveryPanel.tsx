import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";

import type { RecoveryViewState, UnsavedBackup } from "./recovery-model";

type RecoveryPanelProps = {
  state: RecoveryViewState;
  onRefresh: () => void;
  onRestore: (backupId: string) => void;
  onDiscard: (backupId: string) => void;
};

function previewContent(content: string): string {
  const firstLine = content.replace(/\s+/g, " ").trim();
  return firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine;
}

function backupTimeLabel(backup: UnsavedBackup): string {
  if (!Number.isFinite(backup.updated_ms) || backup.updated_ms <= 0) {
    return "pending";
  }

  return new Date(backup.updated_ms).toLocaleString();
}

export function RecoveryPanel({
  state,
  onRefresh,
  onRestore,
  onDiscard,
}: RecoveryPanelProps) {
  return (
    <>
      <div className="panel-head">
        <span className="panel-title">Recovery</span>
        <div className="panel-acts">
          <button
            type="button"
            className="iconbtn"
            title="Refresh recovery backups"
            aria-label="Refresh recovery backups"
            disabled={state.loading}
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="panel-body recovery-panel">
        <div className="section-label">
          <span>Unsaved Backups</span>
          <span className="meta">{state.backups.length}</span>
        </div>
        {state.error ? <div className="panel-note">{state.error}</div> : null}
        {state.backups.length === 0 ? (
          <div className="panel-empty">
            <small>No unsaved backups</small>
          </div>
        ) : (
          state.backups.map((backup) => {
            const selected = state.selectedBackupId === backup.id;
            const restoring = state.restoringBackupId === backup.id;

            return (
              <div
                className={`row recovery-row${selected ? " sel" : ""}`}
                key={backup.id}
              >
                <div className="recovery-row-main">
                  <span className="nm mono">{backup.path}</span>
                  <span className="recovery-meta mono">
                    {restoring ? "restoring" : backupTimeLabel(backup)}
                  </span>
                  {backup.content ? (
                    <span className="recovery-preview mono">
                      {previewContent(backup.content)}
                    </span>
                  ) : null}
                </div>
                <div className="recovery-row-actions">
                  <button
                    type="button"
                    className="iconbtn"
                    title={`Restore ${backup.path}`}
                    aria-label={`Restore ${backup.path}`}
                    disabled={restoring}
                    onClick={() => onRestore(backup.id)}
                  >
                    <RotateCcw aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="iconbtn"
                    title={`Discard ${backup.path} backup`}
                    aria-label={`Discard ${backup.path} backup`}
                    onClick={() => onDiscard(backup.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
