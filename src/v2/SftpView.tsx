import { useRef, useState } from "react"

import type { SftpPane, Tab } from "./v2-model"
import { useV2Store } from "./v2-store"

export function SftpView({ tab }: { tab: Tab }) {
    const isReal = useV2Store((s) => s.mode === "real")
    const sftp = useV2Store((s) => s.ui[s.active].sftp)
    const sftpSelect = useV2Store((s) => s.sftpSelect)
    const sftpFocus = useV2Store((s) => s.sftpFocus)
    const sftpTransfer = useV2Store((s) => s.sftpTransfer)
    const sftpEnter = useV2Store((s) => s.sftpEnter)
    const sftpDisconnect = useV2Store((s) => s.sftpDisconnect)
    const sftpReconnect = useV2Store((s) => s.sftpReconnect)
    const sftpRunCommand = useV2Store((s) => s.sftpRunCommand)
    const openCtx = useV2Store((s) => s.openCtx)
    const dragRef = useRef<{ pane: SftpPane; idx: number } | null>(null)
    const [commandOpen, setCommandOpen] = useState(false)
    const [command, setCommand] = useState("")

    const canGoUp = (pane: SftpPane) =>
        isReal && sftp.connected && (pane === "remote" ? sftp.remotePath !== "/" : !!sftp.localRel)

    const renderPane = (pane: SftpPane) => {
        const files = sftp[pane]
        const isFocus = sftp.focus === pane
        return (
            <div
                className={"yz2-sftp-pane " + pane}
                onClick={() => sftpFocus(pane)}
            >
                <div className={"yz2-sftp-pane-head" + (isFocus ? " is-focus" : "")}>
                    <span className="zone">{pane === "local" ? "LOCAL" : "REMOTE"}</span>
                    <span className="path">{pane === "local" ? sftp.localPath : sftp.remotePath}</span>
                </div>
                <div
                    className="yz2-sftp-list"
                    onDragOver={(e) => {
                        e.preventDefault()
                        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
                    }}
                    onDrop={(e) => {
                        e.preventDefault()
                        const d = dragRef.current
                        dragRef.current = null
                        if (d) sftpTransfer(d.pane, d.idx, pane)
                    }}
                >
                    {canGoUp(pane) ? (
                        <div
                            className="yz2-sftp-row"
                            onClick={(e) => {
                                e.stopPropagation()
                                sftpEnter(pane, -1)
                            }}
                        >
                            <span className="yz2-chip" style={{ background: "var(--yz-1b2410)", color: "var(--yz-a8e23f)" }}>
                                ↩
                            </span>
                            <span className="nm" style={{ color: "var(--yz-8b97a7)" }}>..</span>
                            <span className="sz">up</span>
                        </div>
                    ) : null}
                    {sftp.loading && isReal ? (
                        <div className="yz2-panel-note" style={{ margin: 10 }}>Connecting to {sftp.host ?? "host"}…</div>
                    ) : null}
                    {!files.length && !sftp.loading ? (
                        <div className="yz2-panel-note" style={{ margin: 10 }}>(empty directory)</div>
                    ) : null}
                    {files.map((f, i) => {
                        const isSel = sftp.sel?.pane === pane && sftp.sel.idx === i
                        const isDir = f.kind === "dir" || f.chip === "dir"
                        return (
                            <div
                                key={f.name}
                                className={"yz2-sftp-row" + (isSel ? " is-sel" : "")}
                                draggable={!isDir}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    sftpSelect(pane, i)
                                }}
                                onDoubleClick={(e) => {
                                    e.stopPropagation()
                                    if (isDir) sftpEnter(pane, i)
                                }}
                                onDragStart={(e) => {
                                    dragRef.current = { pane, idx: i }
                                    if (e.dataTransfer) {
                                        e.dataTransfer.effectAllowed = "copy"
                                        e.dataTransfer.setData("text/plain", f.name)
                                    }
                                }}
                                onContextMenu={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    openCtx({ kind: "sftp", x: e.clientX, y: e.clientY, pane, idx: i, name: f.name, isDir })
                                }}
                            >
                                <span className="yz2-chip" style={{ background: "var(--yz-1a2230)", color: "var(--yz-8b97a7)" }}>
                                    {f.chip}
                                </span>
                                <span className="nm">{f.name}</span>
                                {f.isNew ? <span className="sent">✓ sent</span> : null}
                                <span className="sz">{f.size}</span>
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }

    const statusChip = !isReal
        ? "SSH · connected"
        : sftp.connected
            ? "SSH · connected"
            : sftp.loading
                ? "connecting…"
                : "offline"

    return (
        <div className="yz2-view" key={tab.id}>
            <div className="yz2-sftp-head">
                <span style={{ color: "var(--yz-a8e23f)" }}>⇅</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{sftp.host ?? "no host"}</span>
                <span
                    className="yz2-engine-chip"
                    style={isReal && !sftp.connected ? { color: "var(--yz-f07178)" } : undefined}
                >
                    {statusChip}
                </span>
                <span className="yz2-spacer" />
                {isReal && sftp.connected ? (
                    <button type="button" className="yz2-btn-ghost yz2-sftp-action" aria-label="Disconnect SFTP" onClick={sftpDisconnect}>
                        Disconnect
                    </button>
                ) : null}
                {isReal && sftp.connected && sftp.hostId ? (
                    <button
                        type="button"
                        className="yz2-btn-ghost yz2-sftp-action"
                        aria-label="Open remote command prompt"
                        onClick={() => setCommandOpen((open) => !open)}
                    >
                        Run…
                    </button>
                ) : null}
                {isReal && !sftp.connected && !sftp.loading && sftp.hostId ? (
                    <button type="button" className="yz2-btn-accent yz2-sftp-action" aria-label="Reconnect SFTP" onClick={sftpReconnect}>
                        Reconnect
                    </button>
                ) : null}
                {sftp.clip ? <span className="yz2-clip-chip">⧉ {sftp.clip.name} — ⌘V to paste</span> : null}
            </div>
            {commandOpen ? (
                <form
                    className="yz2-sftp-command"
                    onSubmit={(e) => {
                        e.preventDefault()
                        const trimmed = command.trim()
                        if (!trimmed) return
                        sftpRunCommand(trimmed)
                        setCommand("")
                        setCommandOpen(false)
                    }}
                >
                    <input
                        aria-label="Remote command"
                        value={command}
                        onChange={(e) => setCommand(e.currentTarget.value)}
                        placeholder="uptime"
                    />
                    <button type="submit" className="yz2-btn-accent yz2-sftp-action" aria-label="Run remote command">
                        Run
                    </button>
                </form>
            ) : null}
            <div className="yz2-sftp-panes">
                {renderPane("local")}
                {renderPane("remote")}
            </div>
            <div className="yz2-sftp-foot">
                <span className="yz2-ellipsis">
                    Select a file → <span className="hot">Ctrl/⌘ C</span> → click the other pane → <span className="hot">Ctrl/⌘ V</span> · or just drag the file across · double-click a folder to enter it
                </span>
            </div>
        </div>
    )
}
