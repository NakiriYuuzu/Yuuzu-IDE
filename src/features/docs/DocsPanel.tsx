import {
  Eye,
  ExternalLink,
  FileText,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import {
  contextPackSummary,
  docsSearchSummary,
  selectedDocPaths,
  type ContextPack,
  type DocIndexEntry,
  type DocSearchMatch,
  type DocsViewState,
} from "./docs-model";

type DocsPanelProps = {
  state: DocsViewState;
  onRefresh: () => void;
  onSearch: (query: string) => void;
  onOpenPreview: (path: string) => void;
  onToggleSource: (path: string, selected: boolean) => void;
  onPackNameChange: (name: string) => void;
  onCreatePack: () => void;
  onSelectPack: (id: string) => void;
  onDeletePack: (id: string) => void;
  activeTaskRunId: string | null;
  onUsePackForActiveTask: (id: string) => void;
  onLinkPackToAgentSession: (id: string, agentSessionId: string) => void;
};

function DocsIndexRow({
  entry,
  selected,
  onOpenPreview,
  onToggleSource,
}: {
  entry: DocIndexEntry;
  selected: boolean;
  onOpenPreview: (path: string) => void;
  onToggleSource: (path: string, selected: boolean) => void;
}) {
  return (
    <div className={`docs-row row${selected ? " sel" : ""}`}>
      <FileText aria-hidden="true" />
      <div className="docs-row-main">
        <span className="docs-row-title">{entry.title}</span>
        <span className="docs-row-path mono">{entry.path}</span>
      </div>
      <span className="badge2">{entry.section}</span>
      {entry.stale ? <span className="badge2 warn">stale</span> : null}
      <button
        type="button"
        className="iconbtn docs-row-action"
        title={`Open ${entry.title}`}
        aria-label={`Open ${entry.title}`}
        onClick={() => onOpenPreview(entry.path)}
      >
        <ExternalLink aria-hidden="true" />
      </button>
      <input
        type="checkbox"
        aria-label={`Use ${entry.title} as context source`}
        checked={selected}
        onChange={(event) => onToggleSource(entry.path, event.target.checked)}
      />
    </div>
  );
}

function SearchMatchRow({
  match,
  onOpenPreview,
}: {
  match: DocSearchMatch;
  onOpenPreview: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className="docs-row docs-search-match row"
      title={match.path}
      onClick={() => onOpenPreview(match.path)}
    >
      <FileText aria-hidden="true" />
      <div className="docs-row-main">
        <span className="docs-row-title">{match.title}</span>
        <span className="docs-row-path mono">
          {match.path}:{match.line_number}
        </span>
        <span className="docs-match-line">{match.line}</span>
      </div>
    </button>
  );
}

function ContextPackRow({
  pack,
  active,
  agentSessionId,
  activeTaskRunId,
  onSelectPack,
  onDeletePack,
  onAgentSessionIdChange,
  onUsePackForActiveTask,
  onLinkPackToAgentSession,
}: {
  pack: ContextPack;
  active: boolean;
  agentSessionId: string;
  activeTaskRunId: string | null;
  onSelectPack: (id: string) => void;
  onDeletePack: (id: string) => void;
  onAgentSessionIdChange: (id: string, value: string) => void;
  onUsePackForActiveTask: (id: string) => void;
  onLinkPackToAgentSession: (id: string, agentSessionId: string) => void;
}) {
  const trimmedAgentSessionId = agentSessionId.trim();

  return (
    <div className={`docs-row docs-pack-row row${active ? " sel" : ""}`}>
      <div className="docs-row-main">
        <span className="docs-row-title">{pack.name}</span>
        <span className="docs-row-path mono">{contextPackSummary(pack)}</span>
      </div>
      <div className="docs-pack-actions">
        {activeTaskRunId ? (
          <button
            type="button"
            className="btn sm docs-pack-use"
            title={`Use ${pack.name} for active task`}
            onClick={() => onUsePackForActiveTask(pack.id)}
          >
            <Link2 aria-hidden="true" />
            Use for active task
          </button>
        ) : null}
        <input
          className="input2 mono docs-agent-input"
          value={agentSessionId}
          placeholder="agent session"
          aria-label={`Agent session id for ${pack.name}`}
          onChange={(event) =>
            onAgentSessionIdChange(pack.id, event.target.value)
          }
        />
        <button
          type="button"
          className="iconbtn docs-row-action docs-pack-action"
          title={`Link ${pack.name} to agent session`}
          aria-label={`Link ${pack.name} to agent session`}
          disabled={!trimmedAgentSessionId}
          onClick={() =>
            onLinkPackToAgentSession(pack.id, trimmedAgentSessionId)
          }
        >
          <Link2 aria-hidden="true" />
        </button>
        <button
          type="button"
          className="iconbtn docs-row-action docs-pack-action"
          title={`Inspect ${pack.name}`}
          aria-label={`Inspect ${pack.name}`}
          onClick={() => onSelectPack(pack.id)}
        >
          <Eye aria-hidden="true" />
        </button>
        <button
          type="button"
          className="iconbtn docs-row-action docs-pack-action"
          title={`Delete ${pack.name}`}
          aria-label={`Delete ${pack.name}`}
          onClick={() => onDeletePack(pack.id)}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function DocsPanel({
  state,
  onRefresh,
  onSearch,
  onOpenPreview,
  onToggleSource,
  onPackNameChange,
  onCreatePack,
  onSelectPack,
  onDeletePack,
  activeTaskRunId,
  onUsePackForActiveTask,
  onLinkPackToAgentSession,
}: DocsPanelProps) {
  const [agentSessionByPackId, setAgentSessionByPackId] = useState<
    Record<string, string>
  >({});
  const sourcePaths = selectedDocPaths(state);
  const canCreatePack = state.packDraftName.trim().length > 0 && sourcePaths.length > 0;

  return (
    <div className="docs-panel">
      <div className="panel-head">
        <span className="panel-title">Docs</span>
        <div className="panel-acts">
          <button
            type="button"
            className="iconbtn"
            title="Refresh docs index"
            aria-label="Refresh docs index"
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="panel-body">
        <div className="docs-search">
          <input
            className="input2"
            type="search"
            value={state.searchQuery}
            placeholder="Search docs"
            aria-label="Search docs"
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>

        {state.error ? (
          <div className="panel-error-inline" role="alert">
            {state.error}
          </div>
        ) : null}

        {state.loading ? <div className="panel-empty">Loading docs</div> : null}

        {state.searchResult ? (
          <section>
            <div className="section-label">
              <span>{docsSearchSummary(state.searchResult)}</span>
              {state.searchResult.truncated ? <span>truncated</span> : null}
            </div>
            {state.searchResult.matches.length > 0 ? (
              state.searchResult.matches.map((match) => (
                <SearchMatchRow
                  key={`${match.path}:${match.line_number}:${match.line}`}
                  match={match}
                  onOpenPreview={onOpenPreview}
                />
              ))
            ) : (
              <div className="panel-empty">No matches</div>
            )}
          </section>
        ) : null}

        <section>
          <div className="section-label">
            <span>Docs Index</span>
            <span>{state.index.length}</span>
          </div>
          {state.index.length > 0 ? (
            state.index.map((entry) => (
              <DocsIndexRow
                key={entry.path}
                entry={entry}
                selected={state.selectedDocPaths[entry.path] === true}
                onOpenPreview={onOpenPreview}
                onToggleSource={onToggleSource}
              />
            ))
          ) : (
            <div className="panel-empty">No docs indexed</div>
          )}
        </section>

        <section>
          <div className="section-label">
            <span>Context Sources</span>
            <span>{sourcePaths.length}</span>
          </div>
          <div className="docs-source-list">
            {sourcePaths.length > 0 ? (
              sourcePaths.map((path) => (
                <div className="row" key={path}>
                  <span className="nm mono">{path}</span>
                </div>
              ))
            ) : (
              <div className="panel-empty">No sources selected</div>
            )}
          </div>
        </section>

        <section>
          <div className="section-label">
            <span>Context Packs</span>
            <span>{state.contextPacks.length}</span>
          </div>
          <div className="docs-pack-create">
            <input
              className="input2"
              value={state.packDraftName}
              placeholder="Context pack name"
              aria-label="Context pack name"
              onChange={(event) => onPackNameChange(event.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={!canCreatePack}
              onClick={onCreatePack}
            >
              <Plus aria-hidden="true" />
              Create
            </button>
          </div>
          {state.contextPacks.length > 0 ? (
            state.contextPacks.map((pack) => (
              <ContextPackRow
                key={pack.id}
                pack={pack}
                active={state.activePackId === pack.id}
                agentSessionId={agentSessionByPackId[pack.id] ?? ""}
                activeTaskRunId={activeTaskRunId}
                onSelectPack={onSelectPack}
                onDeletePack={onDeletePack}
                onAgentSessionIdChange={(id, value) =>
                  setAgentSessionByPackId((current) => ({
                    ...current,
                    [id]: value,
                  }))
                }
                onUsePackForActiveTask={onUsePackForActiveTask}
                onLinkPackToAgentSession={(id, agentSessionId) => {
                  onLinkPackToAgentSession(id, agentSessionId);
                  setAgentSessionByPackId((current) => ({
                    ...current,
                    [id]: "",
                  }));
                }}
              />
            ))
          ) : (
            <div className="panel-empty">No context packs</div>
          )}
        </section>
      </div>
    </div>
  );
}
