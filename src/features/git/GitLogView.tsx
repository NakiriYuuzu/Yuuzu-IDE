import { useState } from "react";

import {
  edgePath,
  formatWhen,
  laneX,
  type GitExportDialog,
  type GitLogFilter,
  type GitLogRow,
  type GitLogState,
} from "./git-log-model";

type GitLogViewProps = {
  state: GitLogState;
  nowUnix: number;
  onSelectCommit: (hash: string) => void;
  onOpenContextMenu: (hash: string, x: number, y: number) => void;
  onLoadMore: () => void;
  onSetFilter: (filter: GitLogFilter) => void;
  onOpenFileDiff: (hash: string, path: string) => void;
  onOpenExport: (hash: string) => void;
  onExportFieldChange: <K extends keyof GitExportDialog>(
    field: K,
    value: GitExportDialog[K],
  ) => void;
  onCloseExport: () => void;
  onConfirmExport: () => void;
  onBrowseDestination: () => void;
};

const FILTER_FIELDS: {
  key: keyof GitLogFilter;
  label: string;
  placeholder: string;
}[] = [
  { key: "branch", label: "Branch", placeholder: "HEAD" },
  { key: "author", label: "Author", placeholder: "any" },
  { key: "since", label: "Date", placeholder: "any" },
  { key: "path", label: "Path", placeholder: "any" },
];

function refChipClass(kind: "head" | "branch" | "tag"): string {
  if (kind === "head") {
    return "badge2 refchip head";
  }
  if (kind === "tag") {
    return "badge2 refchip tag";
  }
  return "badge2 refchip branch";
}

function GraphCell({ row }: { row: GitLogRow }) {
  return (
    <svg width="92" height="36" aria-hidden="true">
      {row.edges.map((edge, index) => (
        <path
          key={`${edge.kind}-${edge.from_lane}-${edge.to_lane}-${index}`}
          d={edgePath(edge)}
          className={`lane-${edge.from_lane % 6}`}
          fill="none"
        />
      ))}
      <circle
        cx={laneX(row.lane)}
        cy="18"
        r="5"
        className={`lane-${row.lane % 6}${row.merge ? " merge" : ""}`}
      />
    </svg>
  );
}

function FilterBar({
  filter,
  totalLoaded,
  truncated,
  onSetFilter,
}: {
  filter: GitLogFilter;
  totalLoaded: number;
  truncated: boolean;
  onSetFilter: (filter: GitLogFilter) => void;
}) {
  const [draftGrep, setDraftGrep] = useState(filter.grep ?? "");

  const commitField = (key: keyof GitLogFilter, raw: string) => {
    const value = raw.trim();
    const next: GitLogFilter = { ...filter };
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
    onSetFilter(next);
  };

  return (
    <div className="log-filters">
      {FILTER_FIELDS.map((field) => (
        <label
          key={field.key}
          className={`fsel${filter[field.key] ? " active" : ""}`}
        >
          <b>{field.label}:</b>
          <input
            defaultValue={filter[field.key] ?? ""}
            placeholder={field.placeholder}
            aria-label={`Filter by ${field.label.toLowerCase()}`}
            onBlur={(event) => commitField(field.key, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitField(field.key, event.currentTarget.value);
              }
            }}
          />
        </label>
      ))}
      <input
        className="input2 mono log-search"
        placeholder="Search subject / message…"
        value={draftGrep}
        onChange={(event) => setDraftGrep(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commitField("grep", event.currentTarget.value);
          }
        }}
      />
      <span className="badge2">
        {totalLoaded} commits{truncated ? " · capped, refine filters" : ""}
      </span>
    </div>
  );
}

function CommitDetailPane({
  state,
  onOpenFileDiff,
  onOpenExport,
}: {
  state: GitLogState;
  onOpenFileDiff: (hash: string, path: string) => void;
  onOpenExport: (hash: string) => void;
}) {
  const detail = state.selectedHash
    ? state.detailByHash[state.selectedHash]
    : undefined;
  if (!state.selectedHash) {
    return (
      <div className="commit-detail">
        <p className="commit-detail-empty">Select a commit to inspect it.</p>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="commit-detail">
        <p className="commit-detail-empty">Loading commit…</p>
      </div>
    );
  }
  return (
    <div className="commit-detail">
      <div className="cd-head">
        <div className="cd-subject">{detail.subject}</div>
        <div className="cd-meta">
          <span className="cdm">
            {detail.author} &lt;{detail.author_email}&gt;
          </span>
          <span className="cdm mono">{detail.short_hash}</span>
          {detail.parents.length > 1 && (
            <span className="cdm">merge · {detail.parents.length} parents</span>
          )}
        </div>
      </div>
      {detail.body && <pre className="cd-body">{detail.body}</pre>}
      <div className="cd-files">
        {detail.files.map((file) => (
          <button
            key={file.path}
            type="button"
            className={`cd-file git-${file.status}`}
            onClick={() => onOpenFileDiff(detail.hash, file.path)}
          >
            <span className="cd-file-status">{file.status}</span>
            <span className="cd-file-path">{file.path}</span>
            <span className="stat-add">+{file.additions}</span>
            <span className="stat-del">-{file.deletions}</span>
          </button>
        ))}
        {detail.files_truncated && (
          <p className="commit-detail-empty">File list truncated at 500.</p>
        )}
      </div>
      <div className="cd-actions">
        <button
          type="button"
          className="btn sm"
          onClick={() => onOpenExport(detail.hash)}
        >
          Export…
        </button>
      </div>
    </div>
  );
}

function GitExportDialogView({
  dialog,
  state,
  onExportFieldChange,
  onCloseExport,
  onConfirmExport,
  onBrowseDestination,
}: {
  dialog: GitExportDialog;
  state: GitLogState;
  onExportFieldChange: GitLogViewProps["onExportFieldChange"];
  onCloseExport: () => void;
  onConfirmExport: () => void;
  onBrowseDestination: () => void;
}) {
  const detail = state.detailByHash[dialog.hash];
  const files = detail?.files ?? [];
  return (
    <div className="git-confirm-backdrop" role="dialog" aria-modal="true">
      <div className="git-confirm-dialog git-export-dialog">
        <h2>Export Commit {dialog.hash.slice(0, 7)}</h2>
        <div className="git-export-section">
          <span className="git-export-label">Scope</span>
          <div className="segmented" role="group" aria-label="Export scope">
            <button
              type="button"
              className={dialog.scope === "changed_files" ? "on" : ""}
              onClick={() => onExportFieldChange("scope", "changed_files")}
            >
              Changed files
            </button>
            <button
              type="button"
              className={dialog.scope === "snapshot" ? "on" : ""}
              onClick={() => onExportFieldChange("scope", "snapshot")}
            >
              Snapshot
            </button>
          </div>
        </div>
        <div className="git-export-section">
          <span className="git-export-label">Format</span>
          <div className="segmented" role="group" aria-label="Export format">
            <button
              type="button"
              className={dialog.format === "folder" ? "on" : ""}
              onClick={() => onExportFieldChange("format", "folder")}
            >
              Folder
            </button>
            <button
              type="button"
              className={dialog.format === "zip" ? "on" : ""}
              onClick={() => onExportFieldChange("format", "zip")}
            >
              Zip
            </button>
          </div>
        </div>
        <div className="git-export-section">
          <span className="git-export-label">Destination</span>
          <div className="git-export-destination">
            <input
              className="input2 mono"
              value={dialog.destination}
              placeholder="/path/to/folder"
              aria-label="Export destination"
              onChange={(event) =>
                onExportFieldChange("destination", event.target.value)
              }
            />
            <button type="button" className="btn sm" onClick={onBrowseDestination}>
              Browse…
            </button>
          </div>
        </div>
        <label className="git-export-overwrite">
          <input
            type="checkbox"
            checked={dialog.overwrite}
            onChange={(event) =>
              onExportFieldChange("overwrite", event.target.checked)
            }
          />
          Overwrite existing files
        </label>
        {dialog.scope === "changed_files" && files.length > 0 && (
          <div className="git-export-preview">
            {files.slice(0, 12).map((file) => (
              <span key={file.path} className="git-export-preview-file mono">
                {file.path}
              </span>
            ))}
            {files.length > 12 && (
              <span className="git-export-preview-file">
                … {files.length - 12} more
              </span>
            )}
          </div>
        )}
        <div className="git-confirm-actions">
          <button type="button" className="btn sm" onClick={onCloseExport}>
            Cancel
          </button>
          <button
            type="button"
            className="btn sm primary"
            disabled={!dialog.destination.trim()}
            onClick={onConfirmExport}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}

export function GitLogView({
  state,
  nowUnix,
  onSelectCommit,
  onOpenContextMenu,
  onLoadMore,
  onSetFilter,
  onOpenFileDiff,
  onOpenExport,
  onExportFieldChange,
  onCloseExport,
  onConfirmExport,
  onBrowseDestination,
}: GitLogViewProps) {
  return (
    <div className="git-log-view">
      <FilterBar
        filter={state.filter}
        totalLoaded={state.rows.length}
        truncated={state.truncated}
        onSetFilter={onSetFilter}
      />
      {state.error && <p className="git-log-error">{state.error}</p>}
      <div className="git-log-split">
        <div className="git-log-table-wrap">
          <table className="dbgrid gitlog">
            <thead>
              <tr>
                <th>Graph</th>
                <th>Description</th>
                <th className="gitlog-author">Author</th>
                <th className="gitlog-when">When</th>
                <th className="gitlog-hash">Commit</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => (
                <tr
                  key={row.hash}
                  className={row.hash === state.selectedHash ? "sel" : ""}
                  onClick={() => onSelectCommit(row.hash)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onOpenContextMenu(row.hash, event.clientX, event.clientY);
                  }}
                >
                  <td className="gitlog-graph">
                    <GraphCell row={row} />
                  </td>
                  <td>
                    <span className="gitlog-desc">
                      {row.refs.map((ref) => (
                        <span
                          key={`${ref.kind}-${ref.name}`}
                          className={refChipClass(ref.kind)}
                        >
                          {ref.name}
                        </span>
                      ))}
                      <span className="gitlog-subject">{row.subject}</span>
                    </span>
                  </td>
                  <td className="gitlog-author">{row.author}</td>
                  <td className="gitlog-when">
                    {formatWhen(row.when_unix, nowUnix)}
                  </td>
                  <td className="gitlog-hash mono">{row.short_hash}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.rows.length === 0 && !state.loading && (
            <p className="commit-detail-empty">No commits match the filters.</p>
          )}
          {state.hasMore && (
            <button type="button" className="btn sm git-log-more" onClick={onLoadMore}>
              Load more
            </button>
          )}
        </div>
        <CommitDetailPane
          state={state}
          onOpenFileDiff={onOpenFileDiff}
          onOpenExport={onOpenExport}
        />
      </div>
      {state.exportDialog && (
        <GitExportDialogView
          dialog={state.exportDialog}
          state={state}
          onExportFieldChange={onExportFieldChange}
          onCloseExport={onCloseExport}
          onConfirmExport={onConfirmExport}
          onBrowseDestination={onBrowseDestination}
        />
      )}
    </div>
  );
}
