// AgentZone — the terminal-cluster canvas. Sessions tile into an equal grid
// whose column count tracks the canvas width (1 / 2 / 3 / 4), each window
// keeping a header with collapse (—), focus (⤢) and close (×) controls.

import { useEffect, useRef } from "react"

import { TerminalTab } from "../features/terminal/TerminalTab"

import { resolveAzCols, termSegs } from "./v2-model"
import { useV2Store } from "./v2-store"
import { resizeSession, writeToSession } from "./controller"
import { Segs } from "./ContentViews"

export function AgentZone() {
    const projectName = useV2Store((s) => s.meta[s.active]?.name ?? "this project")
    const wins = useV2Store((s) => s.ui[s.active].wins)
    const azActive = useV2Store((s) => s.ui[s.active].azActive)
    const azWidth = useV2Store((s) => s.azWidth)
    const setAzWidth = useV2Store((s) => s.setAzWidth)
    const azColsOverride = useV2Store((s) => s.azColsOverride)
    const setAzColsOverride = useV2Store((s) => s.setAzColsOverride)
    const azNew = useV2Store((s) => s.azNew)
    const azClose = useV2Store((s) => s.azClose)
    const azCollapse = useV2Store((s) => s.azCollapse)
    const azMax = useV2Store((s) => s.azMax)
    const azFront = useV2Store((s) => s.azFront)
    const openCtx = useV2Store((s) => s.openCtx)

    const canvasRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const el = canvasRef.current
        if (!el || typeof ResizeObserver === "undefined") return
        const ro = new ResizeObserver((entries) => {
            setAzWidth(entries[0].contentRect.width)
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [setAzWidth])

    const cols = resolveAzCols(azColsOverride, azWidth)
    const anyMax = wins.some((w) => w.max)
    const activeId = azActive ?? wins[0]?.id ?? null

    return (
        <div className="yz2-az">
            <div className="yz2-az-head">
                <span style={{ color: "var(--yz-a8e23f)" }}>✦</span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>AgentZone</span>
                <span className="yz2-az-count">{wins.length} sessions</span>
                <button type="button" className="yz2-az-new" onClick={azNew}>
                    + New session
                </button>
                <div className="yz2-az-cols" role="group" aria-label="AgentZone column layout">
                    <span className="ic">▦</span>
                    <button
                        type="button"
                        className={"seg" + (azColsOverride === null ? " is-on" : "")}
                        onClick={() => setAzColsOverride(null)}
                        title="Auto — columns follow the canvas width"
                    >
                        Auto
                    </button>
                    {[2, 3, 4].map((n) => (
                        <button
                            key={n}
                            type="button"
                            className={
                                "seg" +
                                (azColsOverride === n ? " is-on" : "") +
                                (azColsOverride === null && cols === n ? " is-auto" : "")
                            }
                            onClick={() => setAzColsOverride(n)}
                            title={"Lock AgentZone to " + n + " columns"}
                        >
                            {n}
                        </button>
                    ))}
                </div>
                <span className="yz2-spacer" />
                <span className="yz2-ellipsis" style={{ fontSize: 11, color: "var(--yz-5a6675)", whiteSpace: "nowrap" }}>
                    terminal cluster — click a window and type · ⤢ focus · — collapse
                </span>
            </div>
            <div ref={canvasRef} className="yz2-az-canvas">
                {wins.length === 0 ? (
                    <div className="yz2-az-zero">
                        <div style={{ textAlign: "center" }}>
                            <div className="star">✦</div>
                            <div className="msg">No agent sessions in {projectName} yet.</div>
                            <button type="button" className="start" onClick={azNew}>
                                + Start a session
                            </button>
                        </div>
                    </div>
                ) : null}
                <div className="yz2-az-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                    {wins.map((w) => {
                        const isActive = w.max || w.id === activeId
                        const cls =
                            "yz2-az-win" +
                            (isActive ? " is-active" : "") +
                            (w.min ? " is-min" : "") +
                            (w.max ? " is-max" : "") +
                            (anyMax && !w.max ? " is-dim" : "")
                        return (
                            <div key={w.id} className={cls} onMouseDown={() => azFront(w.id)}>
                                <div
                                    className="yz2-az-win-head"
                                    onDoubleClick={() => azMax(w.id)}
                                    onContextMenu={(e) => {
                                        e.preventDefault()
                                        openCtx({ kind: "session", x: e.clientX, y: e.clientY, winId: w.id })
                                    }}
                                >
                                    <span className="d" style={{ background: w.status === "running" ? "var(--yz-a8e23f)" : "var(--yz-3d4654)" }} />
                                    <span className="tt">{w.title}</span>
                                    <span className="st">{w.status}</span>
                                    <button
                                        type="button"
                                        className="yz2-az-win-btn"
                                        title="Collapse"
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            azCollapse(w.id)
                                        }}
                                    >
                                        {w.min ? "▾" : "—"}
                                    </button>
                                    <button
                                        type="button"
                                        className="yz2-az-win-btn"
                                        title="Focus"
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            azMax(w.id)
                                        }}
                                    >
                                        {w.max ? "⤡" : "⤢"}
                                    </button>
                                    <button
                                        type="button"
                                        className="yz2-az-win-btn close"
                                        title="Close session"
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            azClose(w.id)
                                        }}
                                    >
                                        ×
                                    </button>
                                </div>
                                {w.min ? null : w.sessionId ? (
                                    <div className="yz2-az-win-body real">
                                        <TerminalTab sessionId={w.sessionId} onInput={writeToSession} onResize={resizeSession} />
                                    </div>
                                ) : (
                                    <div className="yz2-az-win-body">
                                        {w.lines.map((l, i) => (
                                            <div key={i} className="tl">
                                                <Segs segs={termSegs(l)} />
                                            </div>
                                        ))}
                                        <div className="tl">
                                            <span style={{ color: "var(--yz-a8e23f)", fontWeight: 700 }}>❯ </span>
                                            <span style={{ color: "var(--yz-e6edf3)" }}>{w.buf}</span>
                                            <span className="yz2-cursor sm" />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
