import { useEffect, useRef, useState } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"

import { isLspSupportedDocumentPath } from "../../features/language/language-model"
import type { LanguageCompletionItem, LspDiagnostic } from "../../features/language/language-model"
import { blameLineMap, diagLineSeverity, normSeverity } from "../v2-model"
import type { Seg, Tab } from "../v2-model"
import { useV2Store } from "../v2-store"
import { highlightContent } from "../hl-cache"
import { cursorFromOffset } from "./editor-surface"

const EMPTY_DIAGNOSTICS: LspDiagnostic[] = []

const HOVER_MAX_W = 460
const HOVER_MAX_H = 320
const HOVER_AXIS_GAP = 12
const HOVER_VIEWPORT_GUTTER = 24

function TextSegs({ segs }: { segs: Seg[] }) {
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

function cursorFrom(el: HTMLTextAreaElement): { ln: number; col: number } {
    return cursorFromOffset(el.value, el.selectionStart)
}

function clampNum(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), Math.max(min, max))
}

function focusWithoutScroll(el: HTMLTextAreaElement): void {
    try {
        el.focus({ preventScroll: true })
    } catch {
        el.focus()
    }
}

function scheduleFrame(fn: () => void): void {
    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(fn)
        return
    }
    setTimeout(fn, 0)
}

let cwCache = { key: "", w: 0 }
function measureCharWidth(el: HTMLElement): number {
    const docView = el.ownerDocument?.defaultView
    if (!docView || typeof docView.getComputedStyle !== "function") return 7.8
    const cs = docView.getComputedStyle(el)
    const key = cs.fontSize + "|" + cs.fontFamily
    if (cwCache.key === key && cwCache.w) return cwCache.w

    const doc = el.ownerDocument ?? (typeof document === "undefined" ? null : document)
    const ctx = doc?.createElement?.("canvas")?.getContext?.("2d")
    let w = 7.8
    if (ctx) {
        ctx.font = cs.fontSize + " " + cs.fontFamily
        w = ctx.measureText("M").width || 7.8
    }
    cwCache = { key, w }
    return w
}

function clampRevealIndex(content: string, line: number, col: number): number {
    const lines = content.split("\n")
    const idx = Math.max(1, Math.min(line, Math.max(1, lines.length))) - 1
    const lineText = lines[idx] ?? ""
    const clampedCol = Math.min(Math.max(1, col), Math.max(1, lineText.length + 1))

    let off = 0
    for (let i = 0; i < idx; i++) off += lines[i].length + 1
    off += clampedCol - 1
    return off
}

function clampRevealCol(content: string, line: number, col: number): number {
    const lines = content.split("\n")
    const idx = Math.max(1, Math.min(line, Math.max(1, lines.length))) - 1
    const lineText = lines[idx] ?? ""
    return Math.min(Math.max(1, col), Math.max(1, lineText.length + 1))
}

function wordStartBefore(value: string, offset: number): number {
    let start = Math.max(0, Math.min(offset, value.length))
    while (start > 0 && /[A-Za-z0-9_$]/.test(value[start - 1])) start -= 1
    return start
}

function diagMatchesPosition(d: LspDiagnostic, line: number, col: number): boolean {
    const startLine = d.range.start_line + 1
    const endLine = d.range.end_line + 1
    const startCol = d.range.start_character + 1
    const endCol = d.range.end_character + 1

    if (startLine === endLine) {
        return line === startLine && col >= startCol && col < endCol
    }

    if (line < startLine || line > endLine) return false
    if (line === startLine && col < startCol) return false
    if (line === endLine && col >= endCol) return false
    return true
}

function clampHoverPos(x: number, y: number): { x: number; y: number } {
    const width = window.innerWidth || 0
    const height = window.innerHeight || 0
    const cardW = Math.min(HOVER_MAX_W, Math.max(0, width - HOVER_VIEWPORT_GUTTER))
    const cardH = Math.min(HOVER_MAX_H, Math.max(0, height - HOVER_VIEWPORT_GUTTER))
    const maxX = Math.max(0, width - Math.max(0, cardW) - HOVER_AXIS_GAP)
    const maxY = Math.max(0, height - Math.max(0, cardH) - HOVER_AXIS_GAP)
    const minX = Math.max(0, Math.min(HOVER_AXIS_GAP, maxX))
    const minY = Math.max(0, Math.min(HOVER_AXIS_GAP, maxY))

    return {
        x: clampNum(x, minX, maxX),
        y: clampNum(y, minY, maxY),
    }
}

export function TextareaEditorSurface({ tab }: { tab: Tab }) {
    const setTabContent = useV2Store((s) => s.setTabContent)
    const saveTab = useV2Store((s) => s.saveTab)
    const gotoDefinition = useV2Store((s) => s.gotoDefinition)
    const completeAt = useV2Store((s) => s.completeAt)
    const hoverAt = useV2Store((s) => s.hoverAt)
    const clearReveal = useV2Store((s) => s.clearReveal)
    const setCursor = useV2Store((s) => s.setCursor)
    const tabSize = useV2Store((s) => (s.stVals.tabSize === "4" ? 4 : 2))
    const diagnostics = useV2Store((s) => s.ui[s.active].diagnosticsByPath[tab.path ?? ""] ?? EMPTY_DIAGNOSTICS)
    const content = tab.content ?? ""
    const taRef = useRef<HTMLTextAreaElement>(null)
    const supported = isLspSupportedDocumentPath(tab.path ?? "")
    const [hover, setHover] = useState<{ x: number; y: number; diags: LspDiagnostic[]; doc: string | null } | null>(
        null,
    )
    const [completion, setCompletion] = useState<{ items: LanguageCompletionItem[]; sel: number; x: number; y: number } | null>(null)
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const hoverSeq = useRef(0)
    const completionSeq = useRef(0)
    const lines = highlightContent(tab.id, content, tab.contentLang ?? "md")
    const blameByLine = blameLineMap(tab.blame)
    const sevByLine = diagLineSeverity(diagnostics)

    function clearHover() {
        if (hoverTimer.current) clearTimeout(hoverTimer.current)
        hoverSeq.current += 1
        setHover(null)
    }

    function clearCompletion() {
        completionSeq.current += 1
        setCompletion(null)
    }

    function completionPosition(el: HTMLTextAreaElement, ln: number, col: number): { x: number; y: number } {
        const body = el.closest(".yz2-ed-body") as HTMLElement | null
        const scrollLeft = body?.scrollLeft ?? 0
        const scrollTop = body?.scrollTop ?? 0
        return {
            x: Math.max(0, (col - 1) * measureCharWidth(el) - scrollLeft),
            y: Math.max(0, 10 + (ln - 1) * 21 - scrollTop + 22),
        }
    }

    async function requestCompletion(el: HTMLTextAreaElement) {
        if (!supported) return
        const cur = cursorFrom(el)
        const seq = ++completionSeq.current
        const items = await completeAt(tab.path ?? "", cur.ln, cur.col)
        if (seq !== completionSeq.current) return
        if (!items.length) {
            setCompletion(null)
            return
        }
        setCompletion({ items, sel: 0, ...completionPosition(el, cur.ln, cur.col) })
    }

    function applyCompletionItem(item: LanguageCompletionItem) {
        const el = taRef.current
        if (!el) return
        const start = wordStartBefore(el.value, el.selectionStart)
        const end = el.selectionEnd
        const next = el.value.slice(0, start) + item.insertText + el.value.slice(end)
        const nextOffset = start + item.insertText.length
        setTabContent(tab.id, next)
        setCursor(cursorFromOffset(next, nextOffset))
        clearCompletion()
        scheduleFrame(() => {
            el.selectionStart = el.selectionEnd = nextOffset
            focusWithoutScroll(el)
        })
    }

    function onAreaMouseMove(e: ReactMouseEvent<HTMLTextAreaElement>) {
        const el = taRef.current
        if (!el) return

        const cx = e.clientX
        const cy = e.clientY

        if (hoverTimer.current) clearTimeout(hoverTimer.current)
        hoverTimer.current = setTimeout(() => {
            const area = el.closest(".yz2-ed-area")
            if (!area) return

            const r = area.getBoundingClientRect()
            const line = Math.floor((cy - r.top) / 21) + 1
            const col = Math.floor((cx - r.left) / measureCharWidth(el)) + 1

            if (line < 1 || col < 1) {
                setHover(null)
                return
            }

            const diags = diagnostics.filter((d) => diagMatchesPosition(d, line, col))
            const seq = ++hoverSeq.current
            void Promise.resolve(supported ? hoverAt(tab.path ?? "", line, col) : null).then((h) => {
                if (seq !== hoverSeq.current) return
                const doc = h?.contents?.trim() ? h.contents.trim() : null
                if (!doc && diags.length === 0) {
                    setHover(null)
                    return
                }
                const { x, y } = clampHoverPos(cx + 12, cy + 16)
                setHover({ x, y, diags, doc })
            })
        }, 320)
    }

    useEffect(() => {
        const reveal = tab.reveal
        const el = taRef.current
        if (!reveal || !el || typeof tab.content !== "string") return

        const off = clampRevealIndex(tab.content, reveal.line, reveal.col)
        const col = clampRevealCol(tab.content, reveal.line, reveal.col)

        focusWithoutScroll(el)

        el.selectionStart = el.selectionEnd = off
        const body = el.closest(".yz2-ed-body") as HTMLElement | null
        const targetX = Math.max(0, (col - 1) * measureCharWidth(el) - 12)
        if (body) {
            body.scrollLeft = targetX
            body.scrollTop = Math.max(0, 10 + (reveal.line - 1) * 21 - body.clientHeight / 2)
        }
        clearReveal(tab.id)
    }, [tab.reveal, tab.content, clearReveal, tab.id])

    useEffect(() => {
        setHover(null)
        setCompletion(null)
        hoverSeq.current += 1
        completionSeq.current += 1

        return () => {
            if (hoverTimer.current) clearTimeout(hoverTimer.current)
            hoverSeq.current += 1
            completionSeq.current += 1
        }
    }, [tab.path, diagnostics])

    return (
        <div className="yz2-ed-edit">
            <div className="yz2-ed-gutter">
                {lines.map((ln) => {
                    const sev = sevByLine.get(ln.n)
                    return (
                        <div key={ln.n} className="yz2-ed-ln">
                            {sev ? <span className={"yz2-ed-diagdot is-" + sev} /> : null}
                            {ln.n}
                        </div>
                    )
                })}
            </div>
            {tab.blame || tab.blameLoading ? (
                <div className="yz2-ed-blame" aria-label={"Blame for " + (tab.path ?? "")}>
                    {lines.map((ln) => {
                        const blame = blameByLine[ln.n]
                        return (
                            <div
                                key={ln.n}
                                className="yz2-ed-blame-seg"
                                title={blame ? blame.short + " · " + blame.author : undefined}
                            >
                                {tab.blameLoading && !tab.blame ? "…" : blame ? blame.short + " " + blame.author : ""}
                            </div>
                        )
                    })}
                </div>
            ) : null}
            <div className="yz2-ed-area">
                <div aria-hidden="true">
                    {lines.map((ln) => {
                        const sev = sevByLine.get(ln.n)
                        return (
                            <div key={ln.n} className={"yz2-ed-hlline" + (sev ? " has-" + sev : "")}>
                                <TextSegs segs={ln.segs} />
                            </div>
                        )
                    })}
                </div>
                <textarea
                    ref={taRef}
                    className="yz2-ed-input"
                    value={content}
                    spellCheck={false}
                    wrap="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    onMouseMove={onAreaMouseMove}
                    onMouseLeave={clearHover}
                    onClick={(e) => {
                        if ((e.metaKey || e.ctrlKey) && supported) {
                            e.preventDefault()
                            const { ln, col } = cursorFrom(e.currentTarget)
                            gotoDefinition(tab.path ?? "", ln, col)
                        }
                    }}
                    onChange={(e) => {
                        clearHover()
                        clearCompletion()
                        setTabContent(tab.id, e.target.value)
                        setCursor(cursorFrom(e.target))
                    }}
                    onSelect={(e) => setCursor(cursorFrom(e.currentTarget))}
                    onBlur={() => setCursor(null)}
                    onKeyDown={(e) => {
                        if (completion) {
                            if (e.key === "ArrowDown") {
                                e.preventDefault()
                                setCompletion((current) => current
                                    ? { ...current, sel: Math.min(current.items.length - 1, current.sel + 1) }
                                    : current)
                                return
                            }
                            if (e.key === "ArrowUp") {
                                e.preventDefault()
                                setCompletion((current) => current
                                    ? { ...current, sel: Math.max(0, current.sel - 1) }
                                    : current)
                                return
                            }
                            if (e.key === "Enter") {
                                e.preventDefault()
                                applyCompletionItem(completion.items[completion.sel])
                                return
                            }
                            if (e.key === "Escape") {
                                e.preventDefault()
                                clearCompletion()
                                return
                            }
                        }
                        if ((e.metaKey || e.ctrlKey) && (e.code === "Space" || e.key === " ")) {
                            e.preventDefault()
                            void requestCompletion(e.currentTarget)
                            return
                        }
                        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                            e.preventDefault()
                            saveTab(tab.id)
                            return
                        }
                        if (e.key === "Tab") {
                            e.preventDefault()
                            const el = e.currentTarget
                            const start = el.selectionStart
                            const indent = " ".repeat(tabSize)
                            setTabContent(tab.id, el.value.slice(0, start) + indent + el.value.slice(el.selectionEnd))
                            scheduleFrame(() => {
                                el.selectionStart = el.selectionEnd = start + indent.length
                            })
                        }
                    }}
                />
                {hover ? (
                    <div className="yz2-ed-hover" style={{ left: hover.x, top: hover.y }}>
                        {hover.diags.map((diag, i) => (
                            <div key={i} className={"yz2-ed-hover-diag is-" + normSeverity(diag.severity)}>
                                <span className="sev">{normSeverity(diag.severity)}</span>
                                <span className="msg">{diag.message}</span>
                            </div>
                        ))}
                        {hover.doc ? <pre className="yz2-ed-hover-doc">{hover.doc}</pre> : null}
                    </div>
                ) : null}
                {completion ? (
                    <div className="yz2-ed-complete" style={{ left: completion.x, top: completion.y }}>
                        {completion.items.slice(0, 12).map((item, index) => (
                            <button
                                type="button"
                                key={item.label + ":" + index}
                                className={"yz2-ed-complete-row" + (index === completion.sel ? " is-active" : "")}
                                aria-label={"Insert completion " + item.label}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => applyCompletionItem(item)}
                            >
                                <span className="label">{item.label}</span>
                                {item.detail ? <span className="detail">{item.detail}</span> : null}
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    )
}
