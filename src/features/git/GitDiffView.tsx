import { useEffect, useState } from "react";
import { FileCode2, RefreshCw } from "lucide-react";

import {
  alignSideBySide,
  createDiffSelection,
  hasSelection,
  isHunkSelected,
  isLineSelected,
  selectionsForApi,
  toggleHunk,
  toggleLine,
  type DiffSelection,
  type GitDiffHunks,
  type GitHunk,
  type GitHunkLine,
  type HunkSelection,
} from "./git-diff-model";

export type GitDiffViewProps = {
  hunks: GitDiffHunks | null;
  selectedPath: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onStageSelections: (selections: HunkSelection[]) => void;
  onUnstageSelections: (selections: HunkSelection[]) => void;
  onRevertSelections: (selections: HunkSelection[]) => void;
};

type DiffMode = "unified" | "side-by-side";

function lineText(text: string, ranges: [number, number][]) {
  if (!ranges.length) {
    return text.length > 0 ? text : " ";
  }
  const [start, end] = ranges[0];
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

function lineClass(kind: GitHunkLine["kind"]): string {
  if (kind === "add") {
    return "dline add";
  }
  if (kind === "del") {
    return "dline del";
  }
  return "dline ctx";
}

export function GitDiffView({
  hunks,
  selectedPath,
  loading,
  error,
  onRefresh,
  onStageSelections,
  onUnstageSelections,
  onRevertSelections,
}: GitDiffViewProps) {
  const [mode, setMode] = useState<DiffMode>("unified");
  const [selection, setSelection] = useState<DiffSelection>(createDiffSelection);

  useEffect(() => {
    setSelection(createDiffSelection());
  }, [hunks]);

  const pathLabel = selectedPath ?? hunks?.path ?? "No file selected";
  const diffMode = hunks ? (hunks.staged ? "Staged" : "Unstaged") : null;
  const stageVerb = hunks?.staged ? "Unstage" : "Stage";
  const applySelections = hunks?.staged ? onUnstageSelections : onStageSelections;

  const wholeHunk = (hunkIndex: number): HunkSelection[] => [
    { hunk_index: hunkIndex, line_indices: null },
  ];

  return (
    <div className="git-diff-view">
      <div className="git-diff-toolbar">
        <FileCode2 aria-hidden="true" />
        <span className="git-diff-title">Diff</span>
        <span className="mono git-diff-path" title={pathLabel}>
          {pathLabel}
        </span>
        {diffMode ? <span className="badge2">{diffMode}</span> : null}
        <div className="segmented" role="group" aria-label="Diff mode">
          <button
            type="button"
            className={mode === "unified" ? "on" : ""}
            onClick={() => setMode("unified")}
          >
            Unified
          </button>
          <button
            type="button"
            className={mode === "side-by-side" ? "on" : ""}
            onClick={() => setMode("side-by-side")}
          >
            Side by side
          </button>
        </div>
        {hunks && !hunks.binary && hunks.hunks.length > 0 ? (
          <button
            type="button"
            className="btn sm"
            disabled={!hasSelection(selection)}
            onClick={() => applySelections(selectionsForApi(selection))}
          >
            {stageVerb} Selected Lines
          </button>
        ) : null}
        <button
          type="button"
          className="btn sm"
          disabled={loading || !selectedPath}
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="git-diff-alert" role="alert">
          {error}
        </div>
      ) : null}

      {!hunks && !loading ? (
        <div className="git-diff-empty">Select a changed file to inspect diff</div>
      ) : null}

      {loading && !hunks ? (
        <div className="git-diff-empty">Loading diff</div>
      ) : null}

      {hunks?.binary ? (
        <div className="git-diff-empty">Binary file diff is not displayed</div>
      ) : null}

      {hunks?.truncated ? (
        <div className="git-diff-truncated">
          Diff output was truncated by the Git backend.
        </div>
      ) : null}

      {hunks && !hunks.binary && hunks.hunks.length === 0 && !loading ? (
        <div className="git-diff-empty">No textual diff output</div>
      ) : null}

      {hunks && !hunks.binary && hunks.hunks.length > 0 ? (
        <div className="diffwrap">
          {hunks.hunks.map((hunk, hunkIndex) => (
            <div key={`${hunk.header}-${hunkIndex}`} className="git-diff-hunk">
              <HunkBar
                hunk={hunk}
                hunkIndex={hunkIndex}
                selection={selection}
                stageVerb={stageVerb}
                onToggle={() =>
                  setSelection((current) => toggleHunk(current, hunkIndex, hunk))
                }
                onApply={() => applySelections(wholeHunk(hunkIndex))}
                onRevert={() => onRevertSelections(wholeHunk(hunkIndex))}
              />
              {mode === "unified" ? (
                <UnifiedHunk
                  hunk={hunk}
                  hunkIndex={hunkIndex}
                  selection={selection}
                  onToggleLine={(lineIndex) =>
                    setSelection((current) =>
                      toggleLine(current, hunkIndex, lineIndex, hunk),
                    )
                  }
                />
              ) : (
                <SideBySideHunk hunk={hunk} hunkIndex={hunkIndex} />
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HunkBar({
  hunk,
  hunkIndex,
  selection,
  stageVerb,
  onToggle,
  onApply,
  onRevert,
}: {
  hunk: GitHunk;
  hunkIndex: number;
  selection: DiffSelection;
  stageVerb: string;
  onToggle: () => void;
  onApply: () => void;
  onRevert: () => void;
}) {
  return (
    <div className="hunkbar">
      <label className="git-diff-hunkcheck">
        <input
          type="checkbox"
          aria-label={`Select hunk ${hunkIndex + 1}`}
          checked={isHunkSelected(selection, hunkIndex)}
          onChange={onToggle}
        />
      </label>
      <span className="hunkbar-header">{hunk.header}</span>
      <span className="hb-act">
        <button type="button" onClick={onApply}>
          {stageVerb} Hunk
        </button>
        <button type="button" onClick={onRevert}>
          Revert…
        </button>
      </span>
    </div>
  );
}

function UnifiedHunk({
  hunk,
  hunkIndex,
  selection,
  onToggleLine,
}: {
  hunk: GitHunk;
  hunkIndex: number;
  selection: DiffSelection;
  onToggleLine: (lineIndex: number) => void;
}) {
  return (
    <div role="group" aria-label={`Hunk ${hunkIndex + 1} unified`}>
      {hunk.lines.map((line, lineIndex) => (
        <div key={lineIndex} className={lineClass(line.kind)}>
          {line.kind === "context" ? (
            <span className="git-diff-linecheck spacer" />
          ) : (
            <label className="git-diff-linecheck">
              <input
                type="checkbox"
                aria-label={`Select line ${lineIndex + 1} of hunk ${hunkIndex + 1}`}
                checked={isLineSelected(selection, hunkIndex, lineIndex)}
                onChange={() => onToggleLine(lineIndex)}
              />
            </label>
          )}
          <span className="lno">{line.old_no ?? ""}</span>
          <span className="lno">{line.new_no ?? ""}</span>
          <span className="dtext">{lineText(line.text, line.word_ranges)}</span>
        </div>
      ))}
    </div>
  );
}

function SideBySideHunk({
  hunk,
  hunkIndex,
}: {
  hunk: GitHunk;
  hunkIndex: number;
}) {
  const rows = alignSideBySide([hunk]);
  return (
    <div className="sbs" role="group" aria-label={`Hunk ${hunkIndex + 1} side by side`}>
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="sbs-row">
          <div
            className={
              row.left
                ? row.kind === "context"
                  ? "dline ctx"
                  : "dline del"
                : "dline fill"
            }
          >
            <span className="lno">{row.left?.old_no ?? ""}</span>
            <span className="dtext">
              {row.left ? lineText(row.left.text, row.left.word_ranges) : " "}
            </span>
          </div>
          <div
            className={
              row.right
                ? row.kind === "context"
                  ? "dline ctx"
                  : "dline add"
                : "dline fill"
            }
          >
            <span className="lno">{row.right?.new_no ?? ""}</span>
            <span className="dtext">
              {row.right ? lineText(row.right.text, row.right.word_ranges) : " "}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
