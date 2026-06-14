import { useV2Store } from "./v2-store"

export function ProjectRail() {
    const order = useV2Store((s) => s.order)
    const meta = useV2Store((s) => s.meta)
    const ui = useV2Store((s) => s.ui)
    const active = useV2Store((s) => s.active)
    const selectProject = useV2Store((s) => s.selectProject)
    const addProject = useV2Store((s) => s.addProject)
    const openCtx = useV2Store((s) => s.openCtx)
    const openSettings = useV2Store((s) => s.openSettings)

    return (
        <div className="yz2-prail">
            {order.map((id) => {
                const m = meta[id]
                const u = ui[id]
                const isActive = id === active
                const sessions = u.wins.length
                return (
                    <button
                        type="button"
                        key={id}
                        className="yz2-prail-item"
                        title={m.name + " — " + (sessions ? sessions + " agent sessions" : "no sessions")}
                        style={{
                            background: m.bg,
                            color: m.fg,
                            border: "1px solid " + (isActive ? m.fg : m.bd),
                            boxShadow: isActive ? "0 0 0 1px " + m.fg : undefined,
                            opacity: isActive ? 1 : 0.82,
                        }}
                        onClick={() => selectProject(id)}
                        onContextMenu={(e) => {
                            e.preventDefault()
                            openCtx({ kind: "project", x: e.clientX, y: e.clientY, projectId: id, name: m.name })
                        }}
                    >
                        <span>{m.glyph}</span>
                        {sessions > 0 ? <span className="yz2-prail-badge">{sessions}</span> : null}
                        {isActive ? <span className="yz2-prail-active-bar" /> : null}
                    </button>
                )
            })}
            <button type="button" className="yz2-prail-add" title="Add project folder" onClick={addProject}>
                +
            </button>
            <div className="yz2-spacer" />
            <button type="button" className="yz2-prail-settings" title="Settings" onClick={openSettings}>
                ⚙
            </button>
        </div>
    )
}
