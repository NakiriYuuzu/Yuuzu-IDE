import {
  Database,
  ChevronDown,
  ChevronRight,
  Download,
  History,
  Plug,
  Play,
  RefreshCw,
  ShieldAlert,
  Table2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  type DatabaseProfile,
  type DatabaseQueryHistoryEntry,
  type DatabaseSchema,
  type DatabaseViewState,
} from "./database-model";

type DatabasePanelProps = {
  state: DatabaseViewState;
  onRefreshProfiles: () => void;
  onSelectProfile: (profileId: string) => void;
  onInspectSchema: (profileId: string) => void;
  onOpenTable: (profileId: string, tableName: string) => void;
  onQueryDraftChange: (sql: string) => void;
  onRunQuery: () => void;
  onConfirmQuery: (confirmationInput: string) => void;
  onCancelConfirmation: () => void;
  onExportResult: () => void;
  onSelectHistory: (entry: DatabaseQueryHistoryEntry) => void;
};

type DatabasePanelProfileRowProps = {
  profile: DatabaseProfile;
  active: boolean;
  schema: DatabaseSchema | undefined;
  expanded: boolean;
  onToggle: () => void;
  onSelectProfile: () => void;
  onInspectSchema: () => void;
  onOpenTable: (tableName: string) => void;
};

function DatabasePanelProfileRow({
  profile,
  active,
  schema,
  expanded,
  onToggle,
  onSelectProfile,
  onInspectSchema,
  onOpenTable,
}: DatabasePanelProfileRowProps) {
  const tableCount = schema?.tables.length ?? 0;

  return (
    <div key={profile.id}>
      <div
        className={`row ${active ? "sel" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={`Select ${profile.name}`}
        onClick={onSelectProfile}
      >
        <span className="tw">
          {expanded ? (
            <ChevronDown aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
        </span>
        <Database aria-hidden="true" />
        <div className="database-row-main">
          <span className="nm" style={{ fontWeight: 600, fontSize: "12px" }}>
            {profile.name}
          </span>
          <span className="mono database-row-meta">
            {profile.kind}
            {profile.production ? " · production" : " · local"}
          </span>
        </div>
        <span
          className="database-status-dot"
          style={{
            background: active ? "var(--yuzu)" : "var(--txt-faint)",
          }}
        />
        <button
          type="button"
          className="iconbtn database-row-action"
          title={`Inspect schema ${profile.name}`}
          aria-label={`Inspect schema ${profile.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onInspectSchema();
          }}
        >
          <Table2 aria-hidden="true" />
        </button>
      </div>
      {expanded ? (
        <div className="database-tables" aria-label={`Tables for ${profile.name}`}>
          <button
            type="button"
            className="row database-tables-label"
            onClick={onToggle}
          >
            <span className="tw" aria-hidden="true">
              <ChevronDown aria-hidden="true" />
            </span>
            <Table2 aria-hidden="true" />
            <span className="nm" style={{ fontWeight: 600, fontSize: "12px" }}>
              Tables
            </span>
            <span className="meta">{tableCount}</span>
          </button>
          {schema?.tables.map((table) => (
            <button
              type="button"
              className="row database-table-row"
              key={`${profile.id}:${table.name}`}
              aria-label={`Open table ${table.name}`}
              onClick={() => onOpenTable(table.name)}
            >
              <span className="tw" aria-hidden="true">
                <Table2 aria-hidden="true" />
              </span>
              <span className="nm mono database-table-name">{table.name}</span>
              <span className="meta">
                {table.row_count === null
                  ? "unknown"
                  : table.row_count.toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function profileSourceLabel(profile: DatabaseProfile): string {
  const source = profile.source;

  if ("SQLite" in source) {
    return source.SQLite.path;
  }

  return `${source.Tcp.host}:${source.Tcp.port} / ${source.Tcp.database}`;
}

export function DatabasePanel({
  state,
  onRefreshProfiles,
  onSelectProfile,
  onInspectSchema,
  onOpenTable,
  onQueryDraftChange,
  onRunQuery,
  onConfirmQuery,
  onCancelConfirmation,
  onExportResult,
  onSelectHistory,
}: DatabasePanelProps) {
  const [expandedByProfileId, setExpandedByProfileId] = useState<
    Record<string, boolean>
  >({});
  const [confirmationInput, setConfirmationInput] = useState("");
  const activeProfile = state.profiles.find(
    (profile) => profile.id === state.activeProfileId,
  );
  const activeSchema = state.activeProfileId
    ? state.schemaByProfileId[state.activeProfileId]
    : undefined;

  useEffect(() => {
    if (state.confirmation) {
      setConfirmationInput(state.confirmation.input);
    } else {
      setConfirmationInput("");
    }
  }, [state.confirmation]);

  useEffect(() => {
    if (!state.activeProfileId) {
      return;
    }

    const activeProfileId = state.activeProfileId;
    setExpandedByProfileId((current) => ({
      ...current,
      [activeProfileId]: current[activeProfileId] ?? true,
    }));
  }, [state.activeProfileId]);

  const tablesAvailable = useMemo(
    () => Boolean(
      activeProfile && activeSchema && activeSchema.tables.length > 0,
    ),
    [activeProfile, activeSchema],
  );

  const requireConfirmation = state.confirmation !== null;
  const canRunConfirmed =
    requireConfirmation &&
    confirmationInput.trim() === state.confirmation?.confirmationText;
  const canRunQuery =
    !state.loading && state.activeProfileId !== null && state.queryDraft.trim() !== "";

  function toggleProfile(profileId: string): void {
    setExpandedByProfileId((current) => ({
      ...current,
      [profileId]: !current[profileId],
    }));
  }

  return (
    <div className="database-panel">
      <div className="panel-head">
        <span className="panel-title">Databases</span>
        <div className="panel-acts">
          <button
            type="button"
            className="iconbtn"
            title="New database connection"
            aria-label="New database connection"
            onClick={() => {}}
          >
            <Plug aria-hidden="true" />
          </button>
          <button
            type="button"
            className="iconbtn"
            title="Refresh database profiles"
            aria-label="Refresh database profiles"
            onClick={onRefreshProfiles}
          >
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="panel-body">
        {state.error ? (
          <div className="panel-error-inline" role="alert">
            {state.error}
          </div>
        ) : null}

        <section>
          <div className="section-label">
            <span>Profiles</span>
            <span>{state.profiles.length}</span>
          </div>
          {state.profiles.length > 0 ? (
            state.profiles.map((profile) => {
              const expanded = expandedByProfileId[profile.id] ?? false;
              const schema = state.schemaByProfileId[profile.id];

              return (
                <DatabasePanelProfileRow
                  key={profile.id}
                  profile={profile}
                  active={state.activeProfileId === profile.id}
                  schema={schema}
                  expanded={expanded}
                  onToggle={() => toggleProfile(profile.id)}
                  onSelectProfile={() => onSelectProfile(profile.id)}
                  onInspectSchema={() => onInspectSchema(profile.id)}
                  onOpenTable={(tableName) => onOpenTable(profile.id, tableName)}
                />
              );
            })
          ) : (
            <div className="panel-empty">No configured database profiles</div>
          )}
        </section>

        <section>
          <div className="section-label">
            <span>Connection</span>
            <span>{activeProfile ? profileSourceLabel(activeProfile) : "none"}</span>
          </div>
          <textarea
            className="input2 database-query-editor"
            rows={4}
            placeholder="Run SQL..."
            value={state.queryDraft}
            onChange={(event) => onQueryDraftChange(event.currentTarget.value)}
            aria-label="Database SQL query"
          />
          <div className="database-query-actions">
            {requireConfirmation ? (
              <>
                <div className="database-confirmation">
                  <div className="database-confirmation-title">
                    <ShieldAlert aria-hidden="true" />
                    <span>{state.confirmation?.confirmationText}</span>
                  </div>
                  <small>{state.confirmation?.reason}</small>
                  <input
                    className="input2 database-confirmation-input"
                    aria-label="Confirmation text"
                    value={confirmationInput}
                    onChange={(event) => setConfirmationInput(event.currentTarget.value)}
                  />
                  <div className="database-query-row-actions">
                    <button
                      type="button"
                      className="btn"
                      title="Run confirmed SQL"
                      aria-label="Run confirmed SQL"
                      disabled={!canRunConfirmed}
                      onClick={() => onConfirmQuery(confirmationInput)}
                    >
                      <Play aria-hidden="true" />
                      <span>Run confirmed SQL</span>
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      title="Cancel"
                      aria-label="Cancel confirmation"
                      onClick={onCancelConfirmation}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="database-query-row-actions">
                <button
                  type="button"
                  className="btn primary"
                  title="Run query"
                  aria-label="Run query"
                  disabled={!canRunQuery}
                  onClick={() => onRunQuery()}
                >
                  <Play aria-hidden="true" />
                  Run query
                </button>
                <button
                  type="button"
                  className="btn"
                  title={tablesAvailable ? "Run quick sample query" : "Run query"}
                  disabled={!canRunQuery}
                  onClick={() => onRunQuery()}
                >
                  <RefreshCw aria-hidden="true" />
                  Execute
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  title="Export query result"
                  aria-label="Export query result"
                  disabled={!state.activeResult}
                  onClick={onExportResult}
                >
                  <Download aria-hidden="true" />
                  Export result
                </button>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="section-label">
            <span>
              <History aria-hidden="true" />
              <span>History</span>
            </span>
            <span>{state.history.length}</span>
          </div>
          {state.history.length > 0 ? (
            <div className="database-history">
              {state.history.map((entry, index) => (
                <button
                  type="button"
                  className="row"
                  key={`${entry.sql}-${index}`}
                  title={entry.sql}
                  onClick={() => onSelectHistory(entry)}
                >
                  <span className="tw" aria-hidden="true">
                    <History aria-hidden="true" />
                  </span>
                  <span className="nm mono">{entry.kind}</span>
                  <span className="nm mono" title={entry.sql}>
                    {entry.sql}
                  </span>
                  <span className="meta">
                    {entry.executed_ms}ms
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="panel-empty">No recent queries</div>
          )}
        </section>
      </div>
    </div>
  );
}
