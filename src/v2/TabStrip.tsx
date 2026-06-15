import { chipFor } from "./v2-model"
import type { Tab } from "./v2-model"
import { useV2Store } from "./v2-store"

export function tabGlyph(t: Tab): { glyph: string; style: React.CSSProperties; isChip: boolean } {
    if (t.type === "file") {
        const [chip, bg, fg] = chipFor(t.name ?? "")
        return { glyph: chip, style: { background: bg, color: fg }, isChip: true }
    }
    if (t.type === "cmd") return { glyph: "❯_", style: { color: "var(--yz-a8e23f)", fontWeight: 700, fontSize: 11 }, isChip: false }
    if (t.type === "browser") return { glyph: "◉", style: { color: "var(--yz-82aaff)", fontSize: 11 }, isChip: false }
    if (t.type === "git") return { glyph: "⎇", style: { color: "var(--yz-f6a960)", fontSize: 12 }, isChip: false }
    if (t.type === "diff") return { glyph: "±", style: { color: "var(--yz-82aaff)", fontSize: 12 }, isChip: false }
    if (t.type === "conflict") return { glyph: "!", style: { color: "var(--yz-f07178)", fontWeight: 700, fontSize: 12 }, isChip: false }
    if (t.type === "db") return { glyph: "⛁", style: { color: "var(--yz-9ccc65)", fontSize: 11 }, isChip: false }
    if (t.type === "sftp") return { glyph: "⇅", style: { color: "var(--yz-a8e23f)", fontSize: 11 }, isChip: false }
    return { glyph: "·", style: { color: "var(--yz-5a6675)" }, isChip: false }
}

export function TabStrip() {
    const tabs = useV2Store((s) => s.ui[s.active].tabs)
    const activeTab = useV2Store((s) => s.ui[s.active].activeTab)
    const split = useV2Store((s) => s.ui[s.active].split)
    const plusMenu = useV2Store((s) => s.plusMenu)
    const activateTab = useV2Store((s) => s.activateTab)
    const closeTab = useV2Store((s) => s.closeTab)
    const openCtx = useV2Store((s) => s.openCtx)
    const setPlusMenu = useV2Store((s) => s.setPlusMenu)
    const newTerm = useV2Store((s) => s.newTerm)
    const newBrowser = useV2Store((s) => s.newBrowser)
    const newQuery = useV2Store((s) => s.newQuery)
    const toggleSplit = useV2Store((s) => s.toggleSplit)

    const at = tabs.find((t) => t.id === activeTab) ?? tabs[0] ?? null

    return (
        <div className="yz2-tabs">
            <div className="yz2-tabs-scroll">
                {tabs.map((t) => {
                    const g = tabGlyph(t)
                    const isActive = !!at && t.id === at.id
                    return (
                        <div
                            key={t.id}
                            className={"yz2-tab" + (isActive ? " is-active" : "")}
                            onClick={() => activateTab(t.id)}
                            onContextMenu={(e) => {
                                e.preventDefault()
                                openCtx({ kind: "tab", x: e.clientX, y: e.clientY, id: t.id, type: t.type, path: t.path })
                            }}
                        >
                            <span className={g.isChip ? "yz2-chip" : undefined} style={g.style}>{g.glyph}</span>
                            <span className="title">{t.type === "file" ? t.name : t.title}</span>
                            {t.externalChange ? (
                                <span className="external" title="Changed on disk" />
                            ) : t.dirty ? (
                                <span className="dirty" />
                            ) : null}
                            <button
                                type="button"
                                className="yz2-tab-close"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    closeTab(t.id)
                                }}
                            >
                                ×
                            </button>
                        </div>
                    )
                })}
                <button
                    type="button"
                    className="yz2-tab-plus"
                    title="New tab"
                    onClick={(e) => {
                        if (plusMenu) {
                            setPlusMenu(null)
                            return
                        }
                        const r = e.currentTarget.getBoundingClientRect()
                        setPlusMenu({ x: Math.min(r.left, window.innerWidth - 236), y: r.bottom + 2 })
                    }}
                >
                    +
                </button>
            </div>
            <button
                type="button"
                className={"yz2-split-btn" + (split ? " is-on" : "")}
                title="Split editor right"
                onClick={toggleSplit}
            >
                ◫
            </button>
            {plusMenu ? (
                <>
                    <div className="yz2-backdrop" style={{ zIndex: 50 }} onClick={() => setPlusMenu(null)} />
                    <div className="yz2-menu plus" style={{ left: plusMenu.x, top: plusMenu.y, zIndex: 60 }}>
                        <button type="button" className="yz2-menu-item" onClick={newTerm}>
                            <span style={{ color: "var(--yz-a8e23f)", fontWeight: 700 }}>❯_</span>
                            <span className="lbl">New terminal</span>
                            <span className="kbd">⌃`</span>
                        </button>
                        <button type="button" className="yz2-menu-item" onClick={newBrowser}>
                            <span style={{ color: "var(--yz-82aaff)" }}>◉</span>
                            <span className="lbl">New browser tab</span>
                            <span className="kbd">⌘⇧B</span>
                        </button>
                        <button type="button" className="yz2-menu-item" onClick={newQuery}>
                            <span style={{ color: "var(--yz-9ccc65)" }}>⛁</span>
                            <span className="lbl">New SQL query</span>
                            <span className="kbd">⌘Q</span>
                        </button>
                    </div>
                </>
            ) : null}
        </div>
    )
}
