import { buildDiff, commitFiles, LANE_COLORS, refChipStyle } from "./v2-model"
import type { GitCommit } from "./v2-model"
import { useV2Store } from "./v2-store"

function GitDagSvg({ commits }: { commits: GitCommit[] }) {
    const lx = (l: number) => 12 + l * 17
    const ry = (i: number) => 19 + i * 38
    const paths: React.ReactNode[] = []
    commits.forEach((c, i) => {
        c.par.forEach((j) => {
            const pc = commits[j]
            if (!pc) return
            const col = c.lane === pc.lane ? LANE_COLORS[c.lane] : LANE_COLORS[Math.max(c.lane, pc.lane)]
            const d =
                c.lane === pc.lane
                    ? `M ${lx(c.lane)} ${ry(i)} L ${lx(pc.lane)} ${ry(j)}`
                    : `M ${lx(c.lane)} ${ry(i)} C ${lx(c.lane)} ${ry(i) + 22} ${lx(pc.lane)} ${ry(j) - 22} ${lx(pc.lane)} ${ry(j)}`
            paths.push(<path key={`p${i}-${j}`} d={d} style={{ stroke: col, fill: "none" }} strokeWidth={2} opacity={0.75} />)
        })
    })
    return (
        <svg width={70} height={commits.length * 38} style={{ display: "block", overflow: "visible" }}>
            {paths}
            {commits.map((c, i) => (
                <circle
                    key={`c${i}`}
                    cx={lx(c.lane)}
                    cy={ry(i)}
                    r={4.5}
                    style={{ fill: "var(--yz-0a0e15)", stroke: LANE_COLORS[c.lane] }}
                    strokeWidth={2}
                />
            ))}
        </svg>
    )
}

const ST_COLOR: Record<string, string> = {
    M: "var(--yz-ffcb6b)",
    A: "var(--yz-9ccc65)",
    D: "var(--yz-f07178)",
}

const DIFF_COLOR: Record<string, string> = {
    h: "var(--yz-82aaff)",
    x: "var(--yz-8b97a7)",
    a: "var(--yz-9ccc65)",
    d: "var(--yz-f07178)",
}

const DIFF_MARK: Record<string, string> = { h: "@@", x: "", a: "+", d: "−" }

export function GitGraphView() {
    const mode = useV2Store((s) => s.mode)
    const active = useV2Store((s) => s.active)
    const meta = useV2Store((s) => s.meta[s.active])
    const git = useV2Store((s) => s.ui[s.active].git)
    const gitDetail = useV2Store((s) => s.ui[s.active].gitDetail)
    const gitLoaded = useV2Store((s) => s.ui[s.active].gitLoaded)
    const gitSel = useV2Store((s) => s.ui[s.active].gitSel)
    const gitFilter = useV2Store((s) => s.ui[s.active].gitFilter)
    const setGitSel = useV2Store((s) => s.setGitSel)
    const setGitFilter = useV2Store((s) => s.setGitFilter)
    const openCtx = useV2Store((s) => s.openCtx)
    const checkoutCommit = useV2Store((s) => s.checkoutCommit)
    const cherryPickCommit = useV2Store((s) => s.cherryPickCommit)
    const revertCommit = useV2Store((s) => s.revertCommit)
    const copyCommitHash = useV2Store((s) => s.copyCommitHash)
    const gitSync = useV2Store((s) => s.gitSync)
    const openBranchPopup = useV2Store((s) => s.openBranchPopup)
    const openCommitFileDiff = useV2Store((s) => s.openCommitFileDiff)

    const selIdx = gitSel < git.commits.length ? gitSel : 0
    const selC = git.commits[selIdx]
    const isReal = mode === "real"
    const detailMatches = !!selC && !!gitDetail && gitDetail.hash === (selC.fullHash ?? selC.h)
    const files = selC
        ? isReal
            ? (detailMatches ? gitDetail.files : [])
            : commitFiles(active, selC)
        : []
    const diff = selC && !isReal ? buildDiff(selC) : []
    const realBody = isReal && detailMatches ? gitDetail.body.trim() : ""
    const branchLabel = git.branch || meta.branch

    if (isReal && !gitLoaded) {
        return (
            <div className="yz2-view">
                <div className="yz2-ed-loading" style={{ flex: 1 }}>Loading git history…</div>
            </div>
        )
    }

    const filters: [string, string][] = [
        ["all", "All"],
        ["yuuzu", "◉ yuuzu"],
        ["claude", "✻ claude"],
    ]

    return (
        <div className="yz2-view">
            <div className="yz2-git-head">
                <div className="yz2-git-head-row">
                    <button type="button" className="yz2-branch-chip" onClick={openBranchPopup}>Branch {branchLabel}</button>
                    <span className="yz2-git-counts">{git.ahead}↑ {git.behind}↓</span>
                    <span className="yz2-spacer" />
                    <span className="yz2-git-hint">{git.commits.length} commits · right-click a row for actions</span>
                </div>
                <div className="yz2-git-head-row sub">
                    <div className="yz2-git-head-group">
                        {filters.map(([id, label]) => (
                            <button
                                type="button"
                                key={id}
                                className={"yz2-gg-filter" + (gitFilter === id ? " is-on" : "")}
                                onClick={() => setGitFilter(id)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <span className="yz2-spacer" />
                    <div className="yz2-git-head-group sync">
                        <button type="button" className="yz2-gg-filter" title="git fetch" onClick={() => gitSync("fetch")}>⟳ Fetch</button>
                        <button type="button" className="yz2-gg-filter" title="git pull" onClick={() => gitSync("pull")}>↓ Pull</button>
                        <button type="button" className="yz2-gg-filter" title="git push" onClick={() => gitSync("push")}>↑ Push</button>
                    </div>
                </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "6px 16px 30px 6px" }}>
                    <div style={{ display: "flex" }}>
                        <div style={{ flex: "0 0 76px", paddingLeft: 12 }}>
                            <GitDagSvg commits={git.commits} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            {git.commits.map((c, i) => {
                                const match = gitFilter === "all" || c.a === gitFilter
                                return (
                                    <button
                                        type="button"
                                        key={c.h + i}
                                        className={
                                            "yz2-gg-row" + (i === selIdx ? " is-sel" : "") + (match ? "" : " is-dim")
                                        }
                                        onClick={() => setGitSel(i)}
                                        onContextMenu={(e) => {
                                            e.preventDefault()
                                            openCtx({ kind: "commit", x: e.clientX, y: e.clientY, commitIdx: i, hash: c.h, name: c.m })
                                        }}
                                    >
                                        {c.refs.map((r) => (
                                            <span key={r} className="yz2-ref-chip" style={refChipStyle(r)}>
                                                {r}
                                            </span>
                                        ))}
                                        <span className="m">{c.m}</span>
                                        <span className="a">{c.a}</span>
                                        <span className="h">{c.h}</span>
                                        <span className="t">{c.t}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                </div>

                <div className="yz2-gd">
                    <div className="yz2-gd-head">
                        <div className="yz2-gd-msg">{selC?.m}</div>
                        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                            <span
                                className="yz2-gd-av"
                                style={{ background: selC?.a === "claude" ? "var(--yz-c792ea)" : "var(--yz-a8e23f)" }}
                            >
                                {selC?.a.slice(0, 2).toUpperCase()}
                            </span>
                            <span style={{ fontSize: 11, color: "var(--yz-8b97a7)" }}>
                                {selC?.a} · {selC?.t} ago
                            </span>
                            <span className="yz2-spacer" />
                            <button
                                type="button"
                                className="yz2-gd-hash"
                                title="Copy hash"
                                onClick={() => copyCommitHash(selIdx)}
                            >
                                {selC?.h} ⧉
                            </button>
                        </div>
                        <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
                            <button type="button" className="yz2-btn-accent" onClick={() => checkoutCommit(selIdx)}>
                                Checkout
                            </button>
                            <button type="button" className="yz2-btn-ghost" onClick={() => cherryPickCommit(selIdx)}>
                                Cherry-pick
                            </button>
                            <button type="button" className="yz2-btn-ghost" onClick={() => revertCommit(selIdx)}>
                                Revert
                            </button>
                        </div>
                    </div>
                    <div className="yz2-sec-label" style={{ padding: "11px 16px 5px" }}>
                        CHANGED FILES · {files.length}
                    </div>
                    <div style={{ padding: "0 8px", flex: "0 0 auto", overflow: "auto", maxHeight: "38%" }}>
                        {isReal && !detailMatches ? (
                            <div className="yz2-panel-note" style={{ margin: "4px 8px" }}>Loading commit detail…</div>
                        ) : null}
                        {files.map((f) => (
                            <button
                                type="button"
                                key={f.path}
                                className="yz2-gd-file"
                                onClick={() => openCommitFileDiff(selIdx, f.path)}
                            >
                                <span className="st" style={{ color: ST_COLOR[f.st] ?? "var(--yz-8b97a7)" }}>{f.st}</span>
                                <span className="p">{f.path}</span>
                                <span className="add">+{f.add}</span>
                                <span className="del">−{f.del}</span>
                            </button>
                        ))}
                    </div>
                    <div
                        className="yz2-sec-label"
                        style={{ marginTop: 8, padding: "9px 16px 5px", borderTop: "1px solid var(--yz-1c2433)" }}
                    >
                        {isReal ? "MESSAGE" : "DIFF · " + (files[0] ? files[0].path.split("/").pop() : "")}
                    </div>
                    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0 16px" }}>
                        {isReal ? (
                            <div style={{ padding: "4px 16px", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--yz-8b97a7)" }}>
                                {realBody || selC?.m || ""}
                            </div>
                        ) : (
                            diff.map((d, i) => (
                                <div key={i} className={"yz2-diff-line" + (d.t === "a" ? " add" : d.t === "d" ? " del" : "")}>
                                    <span className="mk" style={{ color: DIFF_COLOR[d.t] }}>{DIFF_MARK[d.t]}</span>
                                    <span className="tx" style={{ color: DIFF_COLOR[d.t] }}>{d.s}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
