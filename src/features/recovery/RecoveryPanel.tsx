import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";

import type { RecoveryViewState, UnsavedBackupSummary } from "./recovery-model";

type RecoveryPanelProps = {
  state: RecoveryViewState;
  onRefresh: () => void;
  onRestore: (backupId: string) => void;
  onDiscard: (backupId: string) => void;
};

function backupTimeLabel(backup: UnsavedBackupSummary): string {
  if (!Number.isFinite(backup.updated_ms) || backup.updated_ms <= 0) {
    return "pending";
  }

  return new Date(backup.updated_ms).toLocaleString();
}

function backupSizeLabel(backup: UnsavedBackupSummary): string {
  return `${backup.content_length.toLocaleString()} bytes`;
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
                  <span className="recovery-preview mono">
                    {backupSizeLabel(backup)}
                  </span>
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
