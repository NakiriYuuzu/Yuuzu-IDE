import { useEffect, useState, type ReactNode } from "react"

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
    type GitHunkLine,
    type HunkSelection,
} from "../features/git/git-diff-model"

import type { DiffRow, Tab } from "./v2-model"
import { useV2Store } from "./v2-store"

const DIFF_COLOR: Record<DiffRow["t"], string> = {
    h: "var(--yz-82aaff)",
    x: "var(--yz-8b97a7)",
    a: "var(--yz-9ccc65)",
    d: "var(--yz-f07178)",
}

const DIFF_MARK: Record<DiffRow["t"], string> = { h: "@@", x: "", a: "+", d: "-" }

function lineKind(kind: GitHunkLine["kind"]): DiffRow["t"] {
    if (kind === "add") return "a"
    if (kind === "del") return "d"
    return "x"
}

function lineText(line: GitHunkLine) {
    if (!line.word_ranges.length) return line.text.length ? line.text : " "
    const [start, end] = line.word_ranges[0]
    return (
        <>
            {line.text.slice(0, start)}
            <mark>{line.text.slice(start, end)}</mark>
            {line.text.slice(end)}
        </>
    )
}

type CompareCell = {
    kind: "x" | "a" | "d"
    lineNo: number | null
    text: ReactNode
}

type CompareRow = {
    header?: string
    left?: CompareCell | null
    right?: CompareCell | null
}

function wholeHunk(hunkIndex: number): HunkSelection[] {
    return [{ hunk_index: hunkIndex, line_indices: null }]
}

function compareCellFromHunk(line: GitHunkLine | null, side: "current" | "selected"): CompareCell | null {
    if (!line) return null
    return {
        kind: line.kind === "add" ? "a" : line.kind === "del" ? "d" : "x",
        lineNo: side === "current" ? line.new_no : line.old_no,
        text: lineText(line),
    }
}

function compareRowsFromHunks(hunks: NonNullable<Tab["diffHunks"]>["hunks"]): CompareRow[] {
    const rows: CompareRow[] = []
    hunks.forEach((hunk) => {
        rows.push({ header: hunk.header })
        alignSideBySide([hunk]).forEach((row) => {
            rows.push({
                left: compareCellFromHunk(row.right, "current"),
                right: compareCellFromHunk(row.left, "selected"),
            })
        })
    })
    return rows
}

function compareCellFromRow(row: DiffRow | null, side: "current" | "selected"): CompareCell | null {
    if (!row) return null
    return {
        kind: row.t === "a" || row.t === "d" ? row.t : "x",
        lineNo: side === "current" ? row.newNo : row.oldNo,
        text: row.s,
    }
}

function compareRowsFromFlatRows(rows: DiffRow[]): CompareRow[] {
    const out: CompareRow[] = []
    for (let i = 0; i < rows.length;) {
        const row = rows[i]
        if (row.t === "h") {
            out.push({ header: row.s })
            i += 1
            continue
        }
        if (row.t === "x") {
            out.push({
                left: compareCellFromRow(row, "current"),
                right: compareCellFromRow(row, "selected"),
            })
            i += 1
            continue
        }

        const dels: DiffRow[] = []
        while (rows[i]?.t === "d") {
            dels.push(rows[i])
            i += 1
        }
        const adds: DiffRow[] = []
        while (rows[i]?.t === "a") {
            adds.push(rows[i])
            i += 1
        }
        const count = Math.max(dels.length, adds.length)
        for (let n = 0; n < count; n += 1) {
            out.push({
                left: compareCellFromRow(adds[n] ?? null, "current"),
                right: compareCellFromRow(dels[n] ?? null, "selected"),
            })
        }
    }
    return out
}

function CompareColumns({ rows }: { rows: CompareRow[] }) {
    const left = rows.map((row, index) => row.header ? (
        <div key={index} className="yz2-diff-compare-cell hunk">{row.header}</div>
    ) : (
        <CompareCellView key={index} cell={row.left ?? null} />
    ))
    const right = rows.map((row, index) => row.header ? (
        <div key={index} className="yz2-diff-compare-cell hunk">{row.header}</div>
    ) : (
        <CompareCellView key={index} cell={row.right ?? null} />
    ))

    return (
        <div className="yz2-diff-compare">
            <div className="yz2-diff-compare-title">
                <span>Current</span>
                <span>Selected</span>
            </div>
            <div className="yz2-diff-compare-grid">
                <div className="yz2-diff-compare-col" aria-label="Current version">{left}</div>
                <div className="yz2-diff-compare-col" aria-label="Selected version">{right}</div>
            </div>
        </div>
    )
}

function CompareCellView({ cell }: { cell: CompareCell | null }) {
    const kind = cell?.kind ?? "x"
    return (
        <div className={"yz2-diff-compare-cell" + (cell ? (kind === "a" ? " add" : kind === "d" ? " del" : "") : " fill")}>
            <span className="ln">{cell?.lineNo ?? ""}</span>
            <span className="tx" style={{ color: cell ? DIFF_COLOR[kind] : undefined }}>{cell?.text ?? " "}</span>
        </div>
    )
}

export function DiffView({ tab }: { tab: Tab }) {
    const stageHunks = useV2Store((s) => s.stageHunks)
    const unstageHunks = useV2Store((s) => s.unstageHunks)
    const revertHunk = useV2Store((s) => s.revertHunk)
    const isRealMode = useV2Store((s) => s.mode === "real")
    const [selection, setSelection] = useState<DiffSelection>(createDiffSelection)
    const [pending, setPending] = useState(false)

    useEffect(() => {
        setSelection(createDiffSelection())
        setPending(false)
    }, [tab.id, tab.diffHunks])

    useEffect(() => {
        if (!tab.loading) setPending(false)
    }, [tab.loading])

    const rows = tab.diff ?? []
    const hunks = tab.diffHunks
    const isCompareToCurrent = tab.diffCompare === "worktree" || !!tab.diffCommit
    const mode = isCompareToCurrent ? "Current" : tab.diffCommit ? "Commit" : tab.diffStaged ? "Staged" : "Unstaged"
    const path = tab.path ?? hunks?.path ?? tab.title ?? ""
    const isWorkingDiff = !tab.diffCommit && !!hunks && tab.diffStaged !== undefined
    const selected = selectionsForApi(selection)
    const stageVerb = tab.diffStaged ? "Unstage" : "Stage"
    const canUseSelection = !pending && hasSelection(selection)
    const applySelected = () => {
        if (!path || pending || !selected.length) return
        setSelection(createDiffSelection())
        if (isRealMode) setPending(true)
        if (tab.diffStaged) unstageHunks(path, selected)
        else stageHunks(path, selected)
    }
    const revertSelected = () => {
        if (!path || pending || !selected.length || tab.diffStaged) return
        setSelection(createDiffSelection())
        revertHunk(path, selected)
    }
    const applyWholeHunk = (hunkIndex: number) => {
        if (!path || pending) return
        setSelection(createDiffSelection())
        if (isRealMode) setPending(true)
        if (tab.diffStaged) unstageHunks(path, wholeHunk(hunkIndex))
        else stageHunks(path, wholeHunk(hunkIndex))
    }
    const revertWholeHunk = (hunkIndex: number) => {
        if (!path || pending || tab.diffStaged) return
        setSelection(createDiffSelection())
        revertHunk(path, wholeHunk(hunkIndex))
    }

    return (
        <div className="yz2-view">
            <div className="yz2-diff-head">
                <span className="glyph">±</span>
                <span className="title">Diff</span>
                <span className="path" title={path}>{path}</span>
                <span className="badge">{mode}</span>
                {isWorkingDiff && hunks && !hunks.binary && hunks.hunks.length ? (
                    <span className="yz2-diff-actions">
                        <button type="button" disabled={!canUseSelection} onClick={applySelected}>
                            {stageVerb} selected
                        </button>
                        {!tab.diffStaged ? (
                            <button type="button" className="danger" disabled={!canUseSelection} onClick={revertSelected}>
                                Revert selected
                            </button>
                        ) : null}
                    </span>
                ) : null}
            </div>
            {tab.loading ? (
                <div className="yz2-ed-loading" style={{ flex: 1 }}>Loading diff…</div>
            ) : hunks ? (
                <>
                    {hunks.binary ? (
                        <div className="yz2-empty">
                            <div style={{ textAlign: "center" }}>
                                <div className="big">±</div>
                                <div className="hints">Binary file diff is not displayed</div>
                            </div>
                        </div>
                    ) : hunks.hunks.length ? (
                        <div className="yz2-diff-body">
                            {hunks.truncated ? (
                                <div className="yz2-diff-note">Diff output was truncated by the Git backend.</div>
                            ) : null}
                            {isCompareToCurrent ? (
                                <CompareColumns rows={compareRowsFromHunks(hunks.hunks)} />
                            ) : hunks.hunks.map((hunk, hunkIndex) => (
                                <div key={hunk.header + hunkIndex} className="yz2-diff-hunk">
                                    <div className="yz2-diff-hunkbar">
                                        {isWorkingDiff ? (
                                            <label className="yz2-diff-check">
                                                <input
                                                    type="checkbox"
                                                    aria-label={"Select hunk " + (hunkIndex + 1)}
                                                    disabled={pending}
                                                    checked={isHunkSelected(selection, hunkIndex)}
                                                    onChange={() => setSelection((current) => toggleHunk(current, hunkIndex, hunk))}
                                                />
                                            </label>
                                        ) : (
                                            <span className="yz2-diff-check spacer" />
                                        )}
                                        <span className="h">{hunk.header}</span>
                                        {isWorkingDiff ? (
                                            <span className="acts">
                                                <button
                                                    type="button"
                                                    className="yz2-diff-hunkbtn"
                                                    disabled={pending}
                                                    onClick={() => applyWholeHunk(hunkIndex)}
                                                >
                                                    {stageVerb} hunk
                                                </button>
                                                {!tab.diffStaged ? (
                                                    <button
                                                        type="button"
                                                        className="yz2-diff-hunkbtn danger"
                                                        disabled={pending}
                                                        onClick={() => revertWholeHunk(hunkIndex)}
                                                    >
                                                        Revert hunk
                                                    </button>
                                                ) : null}
                                            </span>
                                        ) : null}
                                    </div>
                                    {hunk.lines.map((line, lineIndex) => {
                                        const rowKind = lineKind(line.kind)
                                        const selectedLine = isLineSelected(selection, hunkIndex, lineIndex)
                                        return (
                                            <div
                                                key={lineIndex}
                                                className={
                                                    "yz2-diff-line" +
                                                    (rowKind === "a" ? " add" : rowKind === "d" ? " del" : "") +
                                                    (selectedLine ? " is-sel" : "")
                                                }
                                            >
                                                {isWorkingDiff && line.kind !== "context" ? (
                                                    <label className="yz2-diff-check">
                                                        <input
                                                            type="checkbox"
                                                            aria-label={"Select line " + (lineIndex + 1) + " of hunk " + (hunkIndex + 1)}
                                                            disabled={pending}
                                                            checked={selectedLine}
                                                            onChange={() => setSelection((current) => toggleLine(current, hunkIndex, lineIndex, hunk))}
                                                        />
                                                    </label>
                                                ) : (
                                                    <span className="yz2-diff-check spacer" />
                                                )}
                                                <span className="ln">{line.old_no ?? ""}</span>
                                                <span className="ln">{line.new_no ?? ""}</span>
                                                <span className="mk" style={{ color: DIFF_COLOR[rowKind] }}>{DIFF_MARK[rowKind]}</span>
                                                <span className="tx" style={{ color: DIFF_COLOR[rowKind] }}>{lineText(line)}</span>
                                            </div>
                                        )
                                    })}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="yz2-empty">
                            <div style={{ textAlign: "center" }}>
                                <div className="big">±</div>
                                <div className="hints">No textual diff output</div>
                            </div>
                        </div>
                    )}
                </>
            ) : rows.length ? (
                <div className="yz2-diff-body">
                    {isCompareToCurrent ? (
                        <CompareColumns rows={compareRowsFromFlatRows(rows)} />
                    ) : rows.map((row, index) => (
                        <div
                            key={index}
                            className={
                                "yz2-diff-line" +
                                (row.t === "a" ? " add" : row.t === "d" ? " del" : row.t === "h" ? " hunk" : "")
                            }
                        >
                            <span className="ln">{row.oldNo ?? ""}</span>
                            <span className="ln">{row.newNo ?? ""}</span>
                            <span className="mk" style={{ color: DIFF_COLOR[row.t] }}>{DIFF_MARK[row.t]}</span>
                            <span className="tx" style={{ color: DIFF_COLOR[row.t] }}>{row.s}</span>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="yz2-empty">
                    <div style={{ textAlign: "center" }}>
                        <div className="big">±</div>
                        <div className="hints">No textual diff output</div>
                    </div>
                </div>
            )}
        </div>
    )
}
