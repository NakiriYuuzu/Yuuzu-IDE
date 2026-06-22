// Main-group content views: empty state, editor, terminal, browser and the
// split pane. Git graph / DB / SFTP views live in their own files.

import { useRef } from "react"
import { TerminalTab } from "../features/terminal/TerminalTab"

import { ctxPct, estTokens, fmtK, hlCode, hlLine, settingDefault, termSegs } from "./v2-model"
import type { Seg, Tab } from "./v2-model"
import { tokenChipFor, useV2Store } from "./v2-store"
import { applyOscTitle, resizeSession, writeToSession } from "./controller"
import { screenBoundsFromRect } from "./bridge"
import { tabGlyph } from "./TabStrip"
import { highlightContent } from "./hl-cache"
import { EditorHost } from "./editor/EditorHost"
import { cursorFromOffset } from "./editor/editor-surface"

function cursorFromEventTarget(target: EventTarget | null): { ln: number; col: number } | null {
    if (!(target instanceof HTMLElement)) return null
    const area = target.closest(".yz2-ed-area")
    const textarea = area?.querySelector("textarea")
    if (textarea?.tagName !== "TEXTAREA") return null
    const el = textarea as HTMLTextAreaElement
    return cursorFromOffset(el.value, el.selectionStart)
}

export function Segs({ segs }: { segs: Seg[] }) {
    return (
        <>
            {segs.map((sg, i) => (
                <span key={i} style={{ color: sg.c, fontWeight: sg.w }}>
                    {sg.s}
                </span>
            ))}
        </>
    )
}

export function EmptyView() {
    return (
        <div className="yz2-view">
            <div className="yz2-empty">
                <div style={{ textAlign: "center" }}>
                    <div className="big">
                        yuuzu<span style={{ color: "var(--yz-2b3547)" }}>/</span>ide
                    </div>
                    <div className="hints">
                        ⌘K — search or run a command
                        <br />
                        ⌃` — new terminal · ⌘⇧B — new browser tab
                    </div>
                </div>
            </div>
        </div>
    )
}

export function EditorView({ tab }: { tab: Tab }) {
    const projectName = useV2Store((s) => s.meta[s.active]?.name ?? "")
    const openCtx = useV2Store((s) => s.openCtx)
    const showTokenChip = useV2Store((s) => s.stVals.tokenChip !== false)
    const editorEngine = useV2Store((s) => s.stVals.editorEngine ?? settingDefault("editorEngine"))
    const toggleBlame = useV2Store((s) => s.toggleBlame)
    const reloadTab = useV2Store((s) => s.reloadTab)
    const overwriteTab = useV2Store((s) => s.overwriteTab)
    const path = tab.path ?? ""
    const isReal = tab.realPath !== undefined
    const editable = isReal && !tab.loading && !tab.tooLarge && typeof tab.content === "string"

    let body: React.ReactNode
    let meta = ""
    let chip = { tokens: "0", pct: "<0.1" }

    if (isReal) {
        if (tab.loading) {
            body = <div className="yz2-ed-loading">Loading {path}…</div>
        } else if (tab.tooLarge) {
            body = <div className="yz2-ed-loading">File is too large to preview.</div>
        } else if (tab.content == null) {
            body = <div className="yz2-ed-loading">Binary or unreadable file.</div>
        } else {
            const tk = estTokens(tab.content)
            chip = { tokens: fmtK(tk), pct: ctxPct(tk) }
            const bytes = tab.content.length
            const lineCount = tab.content.split("\n").length
            meta = lineCount + " lines · " + (bytes >= 1024 ? (bytes / 1024).toFixed(1) + " KB" : bytes + " B")
            body = <EditorHost tab={tab} />
        }
    } else {
        const lines = hlCode(path)
        chip = tokenChipFor(path)
        const srcLen = lines.reduce((acc, l) => acc + l.segs.reduce((a, sg) => a + sg.s.length, 0) + 1, 0)
        meta = lines.length + " lines · " + (srcLen >= 1024 ? (srcLen / 1024).toFixed(1) + " KB" : srcLen + " B")
        body = lines.map((ln) => (
            <div key={ln.n} className="yz2-ed-line">
                <span className="yz2-ed-ln">{ln.n}</span>
                <span className="yz2-ed-code">
                    <Segs segs={ln.segs} />
                </span>
            </div>
        ))
    }

    return (
        <div className="yz2-view" key={tab.id}>
            <div className="yz2-ed-head">
                <span className="yz2-ellipsis">{projectName + " › " + path.split("/").join(" › ")}</span>
                <span className="yz2-spacer" />
                {editable && tab.externalChange && (tab.dirty || tab.saving) ? (
                    <span className="yz2-ext-chip" title="Unsaved local edits and this file changed on disk">
                        ⚠ changed on disk
                        <button
                            type="button"
                            className="yz2-ext-btn"
                            title="Discard local edits and load the disk version"
                            onClick={() => reloadTab(tab.id)}
                        >
                            Reload
                        </button>
                        <button
                            type="button"
                            className="yz2-ext-btn"
                            title="Overwrite the disk version with your local edits"
                            onClick={() => overwriteTab(tab.id)}
                        >
                            Overwrite
                        </button>
                    </span>
                ) : editable && tab.externalChange ? (
                    <span className="yz2-ext-chip" title="This file changed on disk">⟳ changed on disk</span>
                ) : editable && (tab.dirty || tab.saving) ? (
                    <span className="yz2-dirty-chip">{tab.saving ? "saving…" : "● unsaved · ⌘S"}</span>
                ) : null}
                {meta ? <span style={{ whiteSpace: "nowrap" }}>{meta}</span> : null}
                {path ? (
                    <button
                        type="button"
                        className={"yz2-ed-tool" + (tab.blame || tab.blameLoading ? " is-on" : "")}
                        onClick={() => toggleBlame(tab.id)}
                    >
                        ⎇ Blame
                    </button>
                ) : null}
                {showTokenChip ? (
                    <span className="yz2-token-chip" title="Estimated tokens this file consumes when sent to Claude">
                        Σ ≈ {chip.tokens} tokens · {chip.pct}% of 200K
                    </span>
                ) : null}
            </div>
            <div
                className={"yz2-ed-body" + (editable && editorEngine === "codemirror" ? " is-codemirror" : "")}
                onContextMenu={(e) => {
                    e.preventDefault()
                    openCtx({ kind: "editor", x: e.clientX, y: e.clientY, path, cursor: cursorFromEventTarget(e.target) })
                }}
            >
                {body}
            </div>
        </div>
    )
}

export function TerminalView({ tab }: { tab: Tab }) {
    const openCtx = useV2Store((s) => s.openCtx)

    if (tab.sessionId) {
        return (
            <div className="yz2-view" key={tab.id}>
                <div className="yz2-term">
                    <div className="yz2-xterm">
                        <TerminalTab
                            sessionId={tab.sessionId}
                            onInput={writeToSession}
                            onResize={resizeSession}
                            onTitleChange={applyOscTitle}
                        />
                    </div>
                    <div className="yz2-term-foot">
                        {tab.exited ? "process exited — close this tab or open a new terminal (⌃`)" : "real shell — " + (tab.title ?? "zsh")}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="yz2-view" key={tab.id}>
            <div className="yz2-term">
                <div
                    className="yz2-term-scroll"
                    onContextMenu={(e) => {
                        e.preventDefault()
                        openCtx({ kind: "term", x: e.clientX, y: e.clientY, id: tab.id })
                    }}
                >
                    {(tab.lines ?? []).map((l, i) => (
                        <div key={i} className="yz2-term-line">
                            <Segs segs={termSegs(l)} />
                        </div>
                    ))}
                    <div className="yz2-term-line">
                        <span style={{ color: "var(--yz-a8e23f)", fontWeight: 700 }}>❯ </span>
                        <span style={{ color: "var(--yz-e6edf3)" }}>{tab.buf ?? ""}</span>
                        <span className="yz2-cursor" />
                    </div>
                </div>
                <div className="yz2-term-foot">type here — try ls · git status · npm run dev · claude</div>
            </div>
        </div>
    )
}

function browserJson(sessionCount: number): string {
    return '{\n  "status": "ok",\n  "uptime": 8421.44,\n  "version": "0.4.2",\n  "agent": "claude-code",\n  "sessions": ' + sessionCount + "\n}"
}

function BrowserHero({ compact }: { compact?: boolean }) {
    return (
        <div style={{ textAlign: "center", padding: compact ? 20 : 30 }}>
            {compact ? null : (
                <div className="yz2-pill-ghost">
                    <span className="yz2-dot" />
                    Now in dev preview · no install
                </div>
            )}
            <div
                style={{
                    marginTop: compact ? 0 : 22,
                    fontSize: compact ? 26 : 42,
                    fontWeight: 700,
                    color: "var(--yz-e6edf3)",
                    lineHeight: compact ? 1.3 : 1.25,
                }}
            >
                The CLI-first IDE built
                <br />
                around <span style={{ color: "var(--yz-a8e23f)" }}>Claude Code</span>
            </div>
            <div style={{ marginTop: compact ? 10 : 14, fontSize: compact ? 12 : 14, color: "var(--yz-8b97a7)" }}>
                Editors, databases, SSH and a built-in browser.
            </div>
            {compact ? null : (
                <div style={{ marginTop: 24, display: "inline-flex", gap: 10 }}>
                    <span style={{ padding: "9px 18px", borderRadius: 8, background: "var(--yz-a8e23f)", color: "var(--yz-0a0e15)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>↓ Download</span>
                    <span style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid var(--yz-2b3547)", color: "var(--yz-e6edf3)", fontSize: 12, cursor: "pointer" }}>▷ Live demo</span>
                </div>
            )}
        </div>
    )
}

export function BrowserView({ tab }: { tab: Tab }) {
    const frameRef = useRef<HTMLIFrameElement>(null)
    const isRealMode = useV2Store((s) => s.mode === "real")
    const wins = useV2Store((s) => s.ui[s.active].wins)
    const openCtx = useV2Store((s) => s.openCtx)
    const showToast = useV2Store((s) => s.showToast)
    const setTabUrlInput = useV2Store((s) => s.setTabUrlInput)
    const browserGo = useV2Store((s) => s.browserGo)
    const browserCapture = useV2Store((s) => s.browserCapture)
    const mode = tab.mode ?? "blank"
    const hasPage = isRealMode && !!tab.url && tab.mode === undefined

    return (
        <div
            className="yz2-view"
            key={tab.id}
            onContextMenu={(e) => {
                e.preventDefault()
                openCtx({ kind: "browser", x: e.clientX, y: e.clientY, id: tab.id, url: tab.url })
            }}
        >
            <div className="yz2-browser">
                <div className="yz2-browser-bar">
                    <span className="nav">‹</span>
                    <span className="nav off">›</span>
                    <span
                        className="nav"
                        style={{ fontSize: 13 }}
                        onClick={() => (isRealMode ? browserGo(tab.id) : showToast("Reloaded " + (tab.url ?? "")))}
                    >
                        ⟳
                    </span>
                    {isRealMode ? (
                        <span className="yz2-url-pill" style={{ flex: 1 }}>
                            <span className="yz2-dot" style={hasPage ? undefined : { background: "var(--yz-3d4654)" }} />
                            <input
                                className="yz2-url-input"
                                value={tab.urlInput ?? tab.url ?? ""}
                                placeholder="localhost:3000 — http loopback only"
                                spellCheck={false}
                                onChange={(e) => setTabUrlInput(tab.id, e.target.value)}
                                onKeyDown={(e) => {
                                    e.stopPropagation()
                                    if (e.key === "Enter") browserGo(tab.id)
                                }}
                            />
                        </span>
                    ) : (
                        <span className="yz2-url-pill">
                            <span className="yz2-dot" />
                            {tab.url}
                        </span>
                    )}
                    <button
                        type="button"
                        className={"nav yz2-browser-capture" + (hasPage ? "" : " off")}
                        aria-label="Capture browser screenshot"
                        title="Capture browser screenshot"
                        disabled={!hasPage}
                        onClick={() => {
                            const frame = frameRef.current
                            if (!hasPage || !frame) return
                            const rect = frame.getBoundingClientRect()
                            browserCapture(
                                tab.id,
                                screenBoundsFromRect(
                                    { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                                    window.screenX,
                                    window.screenY,
                                    window.screen,
                                ),
                            )
                        }}
                    >
                        ▣
                    </button>
                </div>
                {isRealMode ? (
                    hasPage ? (
                        <>
                            {tab.screenshot ? (
                                <div className="yz2-browser-shot">
                                    <img src={tab.screenshot.dataUrl} alt="Browser screenshot" />
                                    <span>{tab.screenshot.width}×{tab.screenshot.height}</span>
                                </div>
                            ) : null}
                            <iframe
                                ref={frameRef}
                                key={(tab.url ?? "") + ":" + (tab.reloadN ?? 0)}
                                className="yz2-browser-frame"
                                src={tab.url}
                                title={tab.title ?? tab.url}
                            />
                        </>
                    ) : (
                        <div className="yz2-browser-blank">
                            {tab.urlErr
                                ? "✗ " + tab.urlErr
                                : "Type a localhost URL and press Enter — e.g. localhost:5173"}
                        </div>
                    )
                ) : mode === "api" ? (
                    <div className="yz2-browser-api">
                        {browserJson(wins.length).split("\n").map((l, i) => (
                            <div key={i} className="jl">
                                <Segs segs={hlLine(l, "ts")} />
                            </div>
                        ))}
                    </div>
                ) : mode === "web" ? (
                    <div className="yz2-browser-web">
                        <BrowserHero />
                    </div>
                ) : (
                    <div className="yz2-browser-blank">about:blank</div>
                )}
            </div>
        </div>
    )
}

export function SplitPane() {
    const tabs = useV2Store((s) => s.ui[s.active].tabs)
    const split = useV2Store((s) => s.ui[s.active].split)
    const setSplit = useV2Store((s) => s.setSplit)

    const spTab = tabs.find((t) => t.id === split)
    if (!spTab) return null
    const g = tabGlyph(spTab)

    return (
        <div className="yz2-split">
            <div className="yz2-split-head">
                <span className={g.isChip ? "yz2-chip" : undefined} style={g.style}>{g.glyph}</span>
                <span className="tt">{spTab.type === "file" ? spTab.name : spTab.title}</span>
                <span className="yz2-spacer" />
                <button type="button" className="yz2-split-close" title="Close split" onClick={() => setSplit(null)}>
                    ×
                </button>
            </div>
            {spTab.type === "file" ? (
                <div className="yz2-split-body">
                    {spTab.realPath !== undefined && spTab.loading ? (
                        <div className="yz2-ed-loading">Loading…</div>
                    ) : (
                        (typeof spTab.content === "string"
                            ? highlightContent(spTab.id, spTab.content, spTab.contentLang ?? "md")
                            : hlCode(spTab.path ?? "")
                        ).map((ln) => (
                            <div key={ln.n} className="yz2-ed-line">
                                <span className="ln">{ln.n}</span>
                                <span className="yz2-ed-code">
                                    <Segs segs={ln.segs} />
                                </span>
                            </div>
                        ))
                    )}
                </div>
            ) : spTab.type === "cmd" ? (
                spTab.sessionId ? (
                    <div className="yz2-split-other">Live terminals open in the main group.</div>
                ) : (
                    <div className="yz2-split-term">
                        {(spTab.lines ?? []).map((l, i) => (
                            <div key={i} className="tl">
                                <Segs segs={termSegs(l)} />
                            </div>
                        ))}
                    </div>
                )
            ) : spTab.type === "browser" ? (
                <>
                    <div className="yz2-split-bar">
                        <span className="yz2-split-url">
                            <span className="yz2-dot" />
                            {spTab.url}
                        </span>
                    </div>
                    {spTab.mode === "api" ? (
                        <div className="yz2-split-api">
                            {'{\n  "status": "ok",\n  "uptime": 8421.44,\n  "version": "0.4.2"\n}'.split("\n").map((l, i) => (
                                <div key={i} className="jl">
                                    <Segs segs={hlLine(l, "ts")} />
                                </div>
                            ))}
                        </div>
                    ) : spTab.mode === "web" ? (
                        <div className="yz2-browser-web">
                            <BrowserHero compact />
                        </div>
                    ) : (
                        <div className="yz2-browser-blank">about:blank</div>
                    )}
                </>
            ) : (
                <div className="yz2-split-other">This tab type opens in the main group.</div>
            )}
        </div>
    )
}
