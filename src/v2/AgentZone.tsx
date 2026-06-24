// AgentZone — the terminal-cluster canvas. Sessions tile into an equal grid
// whose column count tracks the canvas width (1 / 2 / 3 / 4), each window
// keeping a header with collapse (—), focus (⤢) and close (×) controls.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type UIEvent } from "react"

import { TerminalTab } from "../features/terminal/TerminalTab"

import { agentZoneSplitHandleLeft, resolveAzCols, termSegs } from "./v2-model"
import { useV2Store } from "./v2-store"
import { applyOscTitle, resizeSession, writeToSession } from "./controller"
import { Segs } from "./ContentViews"

export function AgentZone() {
    const projectName = useV2Store((s) => s.meta[s.active]?.name ?? "this project")
    const wins = useV2Store((s) => s.ui[s.active].wins)
    const azActive = useV2Store((s) => s.ui[s.active].azActive)
    const azWidth = useV2Store((s) => s.azWidth)
    const setAzWidth = useV2Store((s) => s.setAzWidth)
    const azColsOverride = useV2Store((s) => s.azColsOverride)
    const setAzColsOverride = useV2Store((s) => s.setAzColsOverride)
    const azSplitRatio = useV2Store((s) => s.azSplitRatio)
    const setAzSplitRatio = useV2Store((s) => s.setAzSplitRatio)
    const persistAzSplitRatio = useV2Store((s) => s.persistAzSplitRatio)
    const azNew = useV2Store((s) => s.azNew)
    const azClose = useV2Store((s) => s.azClose)
    const azCollapse = useV2Store((s) => s.azCollapse)
    const azMax = useV2Store((s) => s.azMax)
    const azFront = useV2Store((s) => s.azFront)
    const openCtx = useV2Store((s) => s.openCtx)
    const renameAgentSession = useV2Store((s) => s.renameAgentSession)

    const canvasRef = useRef<HTMLDivElement | null>(null)
    const [editingWin, setEditingWin] = useState<number | null>(null)
    const [editingTitle, setEditingTitle] = useState("")
    const [isResizing, setIsResizing] = useState(false)
    const renameCommitRef = useRef(true)
    const renameInputRef = useRef<HTMLInputElement | null>(null)

    useEffect(() => {
        const el = canvasRef.current
        if (!el || typeof ResizeObserver === "undefined") return
        const ro = new ResizeObserver((entries) => {
            setAzWidth(entries[0].contentRect.width)
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [setAzWidth])

    useEffect(() => {
        if (editingWin == null) return
        renameInputRef.current?.focus()
    }, [editingWin])

    const cols = resolveAzCols(azColsOverride, azWidth, wins.length)
    const anyMax = wins.some((w) => w.max)
    const activeId = azActive ?? wins[0]?.id ?? null
    const showAzSplitter = cols === 2 && wins.length > 1 && !anyMax

    const startResize = (e: PointerEvent<HTMLDivElement>) => {
        if (!showAzSplitter || !canvasRef.current) return
        e.preventDefault()
        setIsResizing(true)
        e.currentTarget.classList.add("is-dragging")
        e.currentTarget.setPointerCapture?.(e.pointerId)
    }

    const moveResize = (e: PointerEvent<HTMLDivElement>) => {
        if (!isResizing || !canvasRef.current) return
        const canvasRect = canvasRef.current.getBoundingClientRect()
        const usable = Math.max(1, canvasRect.width - 16 - 16 - 14)
        const next = ((e.clientX - canvasRect.left - 16 - 7) / usable) * 100
        setAzSplitRatio(next)
    }

    const stopResize = (e: PointerEvent<HTMLDivElement>) => {
        if (!isResizing) return
        e.preventDefault()
        setIsResizing(false)
        e.currentTarget.classList.remove("is-dragging")
        e.currentTarget.releasePointerCapture?.(e.pointerId)
        persistAzSplitRatio()
    }

    const keyResize = (e: KeyboardEvent<HTMLDivElement>) => {
        let next: number | null = null
        if (e.key === "ArrowLeft") next = azSplitRatio - 2
        if (e.key === "ArrowRight") next = azSplitRatio + 2
        if (e.key === "Home") next = 30
        if (e.key === "End") next = 70
        if (next == null) return
        e.preventDefault()
        setAzSplitRatio(next)
        persistAzSplitRatio()
    }

    const pinHorizontalCanvasScroll = (e: UIEvent<HTMLDivElement>) => {
        if (e.currentTarget.scrollLeft !== 0) e.currentTarget.scrollLeft = 0
    }

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
            <div ref={canvasRef} className="yz2-az-canvas" onScroll={pinHorizontalCanvasScroll}>
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
                <div
                    className="yz2-az-grid"
                    style={{
                        gridTemplateColumns: cols === 2
                            ? `minmax(220px, ${azSplitRatio}fr) minmax(220px, ${100 - azSplitRatio}fr)`
                            : `repeat(${cols}, minmax(0, 1fr))`,
                    }}
                >
                    {wins.map((w) => {
                        const isActive = w.max || w.id === activeId
                        const isEditing = editingWin === w.id
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
                                    {isEditing ? (
                                        <input
                                            ref={renameInputRef}
                                            className="yz2-az-win-title"
                                            type="text"
                                            value={editingTitle}
                                            onChange={(e) => setEditingTitle(e.target.value)}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onClick={(e) => e.stopPropagation()}
                                            onDoubleClick={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                            }}
                                            onContextMenu={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                            }}
                                            onBlur={() => {
                                                if (renameCommitRef.current) renameAgentSession(w.id, editingTitle)
                                                setEditingWin(null)
                                                setEditingTitle("")
                                                renameCommitRef.current = true
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault()
                                                    e.stopPropagation()
                                                    renameCommitRef.current = true
                                                    e.currentTarget.blur()
                                                } else if (e.key === "Escape") {
                                                    e.preventDefault()
                                                    e.stopPropagation()
                                                    renameCommitRef.current = false
                                                    e.currentTarget.blur()
                                                }
                                            }}
                                            autoFocus
                                        />
                                    ) : (
                                        <span
                                            className="tt"
                                            onDoubleClick={(e) => {
                                                e.stopPropagation()
                                                renameCommitRef.current = true
                                                setEditingWin(w.id)
                                                setEditingTitle(w.title)
                                            }}
                                        >
                                            {w.title}
                                        </span>
                                    )}
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
                                        <TerminalTab
                                            sessionId={w.sessionId}
                                            onInput={writeToSession}
                                            onResize={resizeSession}
                                            onTitleChange={applyOscTitle}
                                        />
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
                {showAzSplitter ? (
                    <div
                        role="separator"
                        aria-label="Resize AgentZone columns"
                        aria-orientation="vertical"
                        aria-valuemin={30}
                        aria-valuemax={70}
                        aria-valuenow={azSplitRatio}
                        className="yz2-az-col-resizer"
                        tabIndex={0}
                        style={{ left: `${agentZoneSplitHandleLeft(azWidth, azSplitRatio)}px` }}
                        onKeyDown={keyResize}
                        onPointerDown={startResize}
                        onPointerMove={moveResize}
                        onPointerUp={stopResize}
                        onPointerCancel={stopResize}
                    />
                ) : null}
            </div>
        </div>
    )
}
