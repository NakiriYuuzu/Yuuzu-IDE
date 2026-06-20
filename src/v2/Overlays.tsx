// Workbench overlays: context menu, command palette, settings modal, toast.

import { Fragment, useEffect, useState } from "react"

import {
    SETTINGS_CONFIG,
    chipFor,
    codeFor,
    ctxPct,
    diagLevelStyle,
    estTokens,
    filterPaletteCommands,
    filterPaletteFiles,
    fmtBackupSize,
    fmtBytes,
    fmtK,
    fmtUptime,
    settingDefault,
    tsLabel,
} from "./v2-model"
import type { CtxTarget } from "./v2-model"
import { useV2Store } from "./v2-store"
import type { V2State } from "./v2-store"
import { writeToSession } from "./controller"

// Clear a live PTY without killing it: form feed redraws the prompt.
function sendTermClear(sessionId: string): void {
    writeToSession(sessionId, "\u000c")
}

type MenuEntry =
    | { divider: true }
    | { divider?: false; glyph: string; label: string; danger?: boolean; disabled?: boolean; run: () => void }

function buildCtxItems(ctx: CtxTarget, store: V2State): MenuEntry[] {
    const toast = store.showToast
    const meta = store.meta[store.active]
    const p = store.ui[store.active]

    switch (ctx.kind) {
        case "file": {
            const path = ctx.path ?? ""
            const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
            return [
                { glyph: "▸", label: "Open", run: () => store.openFile(path) },
                { glyph: "◫", label: "Open to the side", run: () => store.openToSide(path) },
                { glyph: "⎇", label: "Git history", run: () => store.openFileHistory(path) },
                { glyph: "Σ", label: "Count tokens (Claude)", run: () => {
                    const tab = p.tabs.find((t) => t.type === "file" && t.path === path)
                    if (store.mode === "real" && typeof tab?.content !== "string") {
                        toast("Open the file first to count its tokens")
                        return
                    }
                    const src = typeof tab?.content === "string" ? tab.content : codeFor(path).src
                    const tk = estTokens(src)
                    toast(path + " ≈ " + fmtK(tk) + " tokens · " + ctxPct(tk) + "% of 200K context")
                } },
                { divider: true },
                { glyph: "+", label: "New file", run: () => store.addNode(parent, "file") },
                { glyph: "/", label: "New folder", run: () => store.addNode(parent, "dir") },
                { divider: true },
                { glyph: "×", label: "Delete", danger: true, run: () => store.deleteNode(path) },
            ]
        }
        case "dir":
            return [
                { glyph: "+", label: "New file", run: () => store.addNode(ctx.path ?? "", "file") },
                { glyph: "/", label: "New folder", run: () => store.addNode(ctx.path ?? "", "dir") },
                { divider: true },
                { glyph: "×", label: "Delete", danger: true, run: () => store.deleteNode(ctx.path ?? "") },
            ]
        case "root":
            return [
                { glyph: "+", label: "New file", run: () => store.addNode("", "file") },
                { glyph: "/", label: "New folder", run: () => store.addNode("", "dir") },
            ]
        case "tab": {
            const id = ctx.id ?? 0
            const isFile = ctx.type === "file"
            return [
                { glyph: "×", label: "Close tab", run: () => store.closeTab(id) },
                { glyph: "⊟", label: "Close others", run: () => store.closeOthers(id) },
                { glyph: "⊠", label: "Close all tabs", run: () => store.closeAllTabs() },
                { divider: true },
                { glyph: "◫", label: isFile ? "Open to the side" : "Show in split", run: () =>
                    isFile && ctx.path ? store.openToSide(ctx.path) : store.setSplit(id) },
            ]
        }
        case "project": {
            const pid = ctx.projectId ?? ""
            return [
                { glyph: "✦", label: "New agent session", run: () => { store.selectProject(pid); store.azNew() } },
                { glyph: "❯", label: "New terminal here", run: () => { store.selectProject(pid); store.newTerm() } },
                { glyph: "⧉", label: "Copy path", run: () => toast("Copied ~/dev/" + (ctx.name ?? "")) },
                { divider: true },
                { glyph: "×", label: "Close project folder", danger: true, run: () => store.closeProject(pid) },
            ]
        }
        case "editor": {
            const cursor = ctx.cursor ?? null
            const symbolAction = (run: (path: string, ln: number, col: number) => void) => {
                if (!cursor) {
                    toast("Place cursor on a symbol first")
                    return
                }
                run(ctx.path ?? "", cursor.ln, cursor.col)
            }
            const countTokens = () => {
                const path = ctx.path ?? ""
                const tab = p.tabs.find((t) => t.type === "file" && t.path === path)
                const src = typeof tab?.content === "string" ? tab.content : codeFor(path).src
                const tk = estTokens(src)
                toast(path + " ≈ " + fmtK(tk) + " tokens · " + ctxPct(tk) + "% of 200K context")
            }
            return [
                { glyph: "⧉", label: "Copy", run: () => toast("Copied selection") },
                { glyph: "≡", label: "Format document", run: () => toast("✓ formatted " + (ctx.path ?? "")) },
                { glyph: "✻", label: "Ask Claude about this file", run: () => {
                    store.azNew()
                    toast("New session opened on " + (ctx.path ?? "file"))
                } },
                { divider: true },
                { glyph: "⇲", label: "Go to Definition", disabled: !cursor, run: () =>
                    symbolAction((path, ln, col) => store.gotoDefinition(path, ln, col)) },
                { glyph: "⌕", label: "Find References", disabled: !cursor, run: () =>
                    symbolAction((path, ln, col) => store.findReferences(path, ln, col)) },
                { glyph: "✎", label: "Rename Symbol", disabled: !cursor, run: () =>
                    symbolAction((path, ln, col) => {
                        const next = prompt("Rename symbol to:")
                        if (next?.trim()) store.renameSymbol(path, ln, col, next.trim())
                    }) },
                { divider: true },
                { glyph: "Σ", label: "Count tokens (Claude)", run: countTokens },
            ]
        }
        case "term": {
            const termTab = p.tabs.find((t) => t.id === ctx.id)
            return [
                { glyph: "⌫", label: "Clear terminal", run: () => {
                    if (termTab?.sessionId) sendTermClear(termTab.sessionId)
                    else store.clearTerm(ctx.id ?? 0)
                } },
                { glyph: "⧉", label: "Copy last output", run: () => toast("Copied last output") },
                { glyph: "✻", label: "Explain last error with Claude", run: () => toast("Claude: no recent error found in scrollback") },
                { divider: true },
                { glyph: "×", label: "Kill process", danger: true, run: () => store.killTerm(ctx.id ?? 0) },
            ]
        }
        case "browser":
            return [
                { glyph: "⟳", label: "Reload", run: () => toast("Reloaded " + (ctx.url ?? "")) },
                { glyph: "⧉", label: "Copy URL", run: () => toast("Copied " + (ctx.url ?? "")) },
                { glyph: "◫", label: "Open in split", run: () => store.setSplit(ctx.id ?? null) },
            ]
        case "dbconn": {
            const ci = ctx.ci ?? 0
            const conn = p.dbConns[ci]
            const profileId = conn?.profileId
            return [
                { glyph: "✎", label: "編輯連線", disabled: !profileId, run: () => {
                    if (profileId) store.openDbConnDialog("edit", profileId)
                } },
                { glyph: "⟳", label: "Refresh schemas", run: () => store.refreshDbConn(ci) },
                { glyph: "⛁", label: "New query console", run: () => {
                    if (conn?.tables[0]) store.openDbTable(ci, conn.tables[0], "sql")
                } },
                { glyph: "⧉", label: "Copy connection string", run: () => toast("Copied " + (ctx.name ?? "") + " connection string") },
                { divider: true },
                { glyph: "×", label: "刪除連線", danger: true, disabled: !profileId, run: () => {
                    if (!profileId) return
                    store.openConfirm({
                        title: "刪除連線",
                        body: "確定要刪除「" + (conn?.name ?? ctx.name ?? "") + "」這個連線設定嗎?此操作無法復原。",
                        label: "刪除",
                        danger: true,
                        action: () => {
                            void store.deleteDbConn(profileId)
                        },
                    })
                } },
                { glyph: "○", label: ctx.live ? "Disconnect" : "Connect", run: () =>
                    toast((ctx.live ? "Disconnected from " : "Connected to ") + (ctx.name ?? "")) },
            ]
        }
        case "dbtable": {
            const ci = ctx.ci ?? 0
            const tb = ctx.table
            if (!tb) return []
            return [
                { glyph: "▦", label: "Open table", run: () => store.openDbTable(ci, tb, "data") },
                { glyph: "⛁", label: "New query console", run: () => store.openDbTable(ci, tb, "sql") },
                { glyph: "☷", label: "View structure", run: () => store.openDbTable(ci, tb, "structure") },
                { glyph: "⧉", label: "Copy table name", run: () => toast("Copied " + tb.n) },
                { divider: true },
                { glyph: "↻", label: "Truncate…", danger: true, run: () => toast("TRUNCATE " + tb.n + " — requires confirmation") },
                { glyph: "×", label: "Drop…", danger: true, run: () => toast("DROP TABLE " + tb.n + " — requires confirmation") },
            ]
        }
        case "host": {
            const host = ctx.host
            if (!host) return []
            return [
                { glyph: "❯", label: "Open shell", run: () => store.openShell(host) },
                { glyph: "⇅", label: "Open SFTP", run: () => store.openSftp(host) },
                { glyph: "⧉", label: "Copy address", run: () => toast("Copied " + host.label) },
                { divider: true },
                { glyph: "×", label: "Forget host…", danger: true, run: () => toast("Removed " + host.label + " from known hosts") },
            ]
        }
        case "sftp": {
            const pane = ctx.pane ?? "local"
            const idx = ctx.idx ?? 0
            const other = pane === "local" ? "remote" : "local"
            const otherLabel = other === "remote" ? p.sftp.remotePath + " (remote)" : p.sftp.localPath + " (local)"
            return [
                { glyph: "⇅", label: "Transfer to " + otherLabel, run: () => store.sftpTransfer(pane, idx, other) },
                { glyph: "⧉", label: "Copy (⌘C)", run: () => {
                    store.sftpSelect(pane, idx)
                    store.sftpCopy()
                } },
                { glyph: "✎", label: "Rename…", run: () => toast("Rename " + (ctx.name ?? "") + " — pending backend") },
                { divider: true },
                { glyph: "↓", label: pane === "remote"
                    ? (store.mode === "real" ? "Download to local pane" : "Download to ~/Downloads")
                    : "Reveal in Finder", run: () => {
                    if (pane === "remote" && store.mode === "real") {
                        store.sftpTransfer(pane, idx, "local")
                        return
                    }
                    toast((pane === "remote" ? "Downloading " : "Revealed ") + (ctx.name ?? ""))
                } },
                { glyph: "☷", label: "Properties", run: () =>
                    toast((ctx.name ?? "") + " · " + (ctx.isDir ? "directory" : "file") + " · rw-r--r-- · yuuzu:staff") },
                { divider: true },
                { glyph: "×", label: "Delete…", danger: true, run: () => store.sftpDelete(pane, idx) },
            ]
        }
        case "commit": {
            const ci = ctx.commitIdx ?? 0
            const commit = p.git.commits[ci]
            const short = commit?.h ?? ctx.hash ?? ""
            return [
                { glyph: "⎇", label: "Checkout this commit", run: () => store.checkoutCommit(ci) },
                { glyph: "+", label: "New branch from here…", run: () => toast("Branch from commit — pending backend support") },
                { divider: true },
                { glyph: "↷", label: "Cherry-pick onto " + meta.branch, run: () => store.cherryPickCommit(ci) },
                { glyph: "↩", label: "Revert commit", run: () => store.revertCommit(ci) },
                { divider: true },
                { glyph: "⤺", label: "Reset to here (soft)", run: () => store.resetTo(ci, "soft") },
                { glyph: "⤺", label: "Reset to here (mixed)", run: () => store.resetTo(ci, "mixed") },
                { glyph: "⤺", label: "Reset to here (hard)", danger: true, run: () => store.resetTo(ci, "hard") },
                { glyph: "↯", label: "Reset working tree (hard)", danger: true, run: () => store.resetHard() },
                { glyph: "↥", label: "Rebase " + meta.branch + " onto " + short, danger: true, run: () => store.rebaseOnto(short) },
                { divider: true },
                { glyph: "⇩", label: "Export changed files (folder)", run: () => store.exportCommit(ci, "changed_files", "folder") },
                { glyph: "⇩", label: "Export changed files (zip)", run: () => store.exportCommit(ci, "changed_files", "zip") },
                { glyph: "⇩", label: "Export snapshot (folder)", run: () => store.exportCommit(ci, "snapshot", "folder") },
                { glyph: "⇩", label: "Export snapshot (zip)", run: () => store.exportCommit(ci, "snapshot", "zip") },
                { divider: true },
                { glyph: "⧉", label: "Copy hash", run: () => store.copyCommitHash(ci) },
                { glyph: "◫", label: "Compare with working tree", run: () => {
                    store.setGitSel(ci)
                    toast("Comparing " + (ctx.hash ?? "") + " with working tree")
                } },
            ]
        }
        case "session": {
            const winId = ctx.winId ?? 0
            const win = p.wins.find((w) => w.id === winId)
            return [
                { glyph: "⤢", label: "Focus session", run: () => store.azFocusFromPanel(winId) },
                { glyph: "—", label: win?.min ? "Expand session" : "Collapse session", run: () => store.azCollapse(winId) },
                { glyph: "+", label: "New session", run: () => store.azNew() },
                { divider: true },
                { glyph: "×", label: "Close session", danger: true, run: () => store.azClose(winId) },
            ]
        }
        default:
            return []
    }
}

export function ContextMenu() {
    const store = useV2Store()
    const ctx = store.ctx
    if (!ctx) return null
    const items = buildCtxItems(ctx, store)
    if (!items.length) return null
    const x = Math.min(ctx.x, window.innerWidth - 220)
    const y = Math.min(ctx.y, window.innerHeight - 240)

    return (
        <>
            <div
                className="yz2-backdrop"
                onClick={store.closeCtx}
                onContextMenu={(e) => {
                    e.preventDefault()
                    store.closeCtx()
                }}
            />
            <div className="yz2-menu ctx" style={{ left: x, top: y }}>
                {items.map((item, i) =>
                    item.divider ? (
                        <div key={"dv" + i} className="yz2-menu-div" />
                    ) : (
                        <button
                            type="button"
                            key={item.label}
                            className={"yz2-menu-item" + (item.danger ? " danger" : "")}
                            aria-label={item.label}
                            disabled={item.disabled}
                            onClick={() => {
                                if (item.disabled) return
                                store.closeCtx()
                                item.run()
                            }}
                        >
                            <span className="glyph">{item.glyph}</span>
                            <span className="lbl">{item.label}</span>
                        </button>
                    ),
                )}
            </div>
        </>
    )
}

export function ReferencesOverlay() {
    const refs = useV2Store((s) => s.ui[s.active]?.lspRefs ?? null)
    const openFile = useV2Store((s) => s.openFile)
    const closeRefs = useV2Store((s) => s.closeRefs)

    if (!refs) return null

    return (
        <>
            <div className="yz2-modal-backdrop" style={{ zIndex: 390 }} onClick={closeRefs} />
            <div className="yz2-refs" role="dialog" aria-label="Language references">
                <div className="yz2-refs-head">
                    <span>REFERENCES</span>
                    <span className="yz2-spacer" />
                    <span>{refs.length}</span>
                    <button type="button" className="yz2-modal-close" onClick={closeRefs}>
                        ×
                    </button>
                </div>
                <div className="yz2-refs-list">
                    {refs.length ? refs.map((ref, index) => (
                        <button
                            type="button"
                            key={ref.path + ":" + ref.line + ":" + ref.col + ":" + index}
                            className="yz2-refs-row"
                            aria-label={"Open " + ref.path + ":" + ref.line}
                            onClick={() => {
                                openFile(ref.path)
                                closeRefs()
                            }}
                        >
                            <span className="loc">{ref.path}:{ref.line}</span>
                            <span className="preview">{ref.preview}</span>
                        </button>
                    )) : <div className="yz2-refs-empty">No references</div>}
                </div>
            </div>
        </>
    )
}

export function runPaletteAction(action: string, store: V2State): void {
    if (action === "split") store.toggleSplit()
    else if (action === "git") store.selectFn("git")
    else if (action === "query") store.newQuery()
    else if (action === "term") store.newTerm()
    else if (action === "browser") store.newBrowser()
    else if (action === "agent") store.azNew()
}

export function CommandPalette() {
    const store = useV2Store()
    const pal = store.pal
    if (!pal.open) return null

    const files = filterPaletteFiles(store.ui[store.active].treeData, pal.q)
    const cmds = filterPaletteCommands(pal.q)

    return (
        <>
            <div className="yz2-pal-backdrop" onClick={store.closePalette} />
            <div className="yz2-pal">
                <div className="yz2-pal-head">
                    <span style={{ color: "var(--yz-5a6675)" }}>⌕</span>
                    <span className="yz2-pal-q">
                        {pal.q}
                        <span className="yz2-cursor" />
                        {pal.q ? null : <span className="hint"> Search files or run a command…</span>}
                    </span>
                    <span className="yz2-pal-esc">esc</span>
                </div>
                <div className="yz2-pal-list">
                    {files.length ? (
                        <>
                            <div className="yz2-pal-label">FILES</div>
                            {files.map((f, i) => {
                                const [chip, bg, fg] = chipFor(f.name)
                                return (
                                    <button
                                        type="button"
                                        key={f.path}
                                        className={"yz2-pal-row" + (i === 0 ? " is-first" : "")}
                                        onClick={() => {
                                            store.closePalette()
                                            store.openFile(f.path)
                                        }}
                                    >
                                        <span className="yz2-chip" style={{ background: bg, color: fg }}>{chip}</span>
                                        <span className="nm">{f.name}</span>
                                        <span className="yz2-spacer" />
                                        <span className="pth">{f.path}</span>
                                    </button>
                                )
                            })}
                        </>
                    ) : null}
                    {cmds.length ? (
                        <>
                            <div className="yz2-pal-label" style={{ paddingTop: 8 }}>COMMANDS</div>
                            {cmds.map((c) => (
                                <button
                                    type="button"
                                    key={c.label}
                                    className="yz2-pal-row"
                                    onClick={() => {
                                        store.closePalette()
                                        runPaletteAction(c.action, store)
                                    }}
                                >
                                    <span className="glyph">{c.glyph}</span>
                                    <span className="nm">{c.label}</span>
                                    <span className="yz2-spacer" />
                                    <span className="kbd">{c.kbd}</span>
                                </button>
                            ))}
                        </>
                    ) : null}
                    {!files.length && !cmds.length ? <div className="yz2-pal-empty">No matches</div> : null}
                </div>
            </div>
        </>
    )
}

function PerformanceSection() {
    const store = useV2Store()
    const metric = store.stab.metric
    return (
        <div className="yz2-stab">
            <div className="yz2-stab-refresh">
                <button type="button" className="yz2-btn-ghost" onClick={store.refreshMetric}>
                    ⟳ Refresh
                </button>
            </div>
            {metric ? (
                <div className="yz2-stab-metrics">
                    <div className="yz2-stab-card">
                        <span className="lbl">Memory</span>
                        <span className="val">{fmtBytes(metric.memoryBytes)}</span>
                    </div>
                    <div className="yz2-stab-card">
                        <span className="lbl">Uptime</span>
                        <span className="val">{fmtUptime(metric.uptimeMs)}</span>
                    </div>
                    <div className="yz2-stab-card">
                        <span className="lbl">Files</span>
                        <span className="val">{metric.fileTreeEntries.toLocaleString()}</span>
                    </div>
                    <div className="yz2-stab-card">
                        <span className="lbl">Docs index</span>
                        <span className="val">{metric.docsIndexEntries.toLocaleString()}</span>
                    </div>
                    <div className="yz2-stab-card">
                        <span className="lbl">Workspaces</span>
                        <span className="val">{metric.workspaceCount.toLocaleString()}</span>
                    </div>
                    <div className="yz2-stab-card">
                        <span className="lbl">PID</span>
                        <span className="val">{metric.processId || "—"}</span>
                    </div>
                </div>
            ) : (
                <div className="yz2-stab-empty">No snapshot</div>
            )}
        </div>
    )
}

function DiagnosticsSection() {
    const store = useV2Store()
    const events = store.stab.events
    if (!events.length) return <div className="yz2-stab-empty">No diagnostic events</div>
    return (
        <div className="yz2-stab-list">
            {events.map((event) => {
                const style = diagLevelStyle(event.level)
                return (
                    <div key={event.id} className="yz2-stab-log-row">
                        <span className="yz2-stab-badge" style={{ color: style.color, background: style.bg }}>
                            {event.level}
                        </span>
                        <span className="msg">{event.message}</span>
                        <span className="meta">{event.source}</span>
                        <span className="meta">{tsLabel(event.ts)}</span>
                    </div>
                )
            })}
        </div>
    )
}

function RecoverySection() {
    const store = useV2Store()
    const backups = store.stab.backups
    if (!backups.length) return <div className="yz2-stab-empty">No unsaved backups</div>
    return (
        <div className="yz2-stab-list">
            {backups.map((backup) => (
                <div key={backup.id} className="yz2-stab-backup-row">
                    <div className="yz2-stab-backup-main">
                        <span className="path">{backup.path}</span>
                        <span className="meta">
                            {fmtBackupSize(backup.contentLength)} · {tsLabel(backup.updatedMs)}
                        </span>
                    </div>
                    <div className="yz2-stab-backup-acts">
                        <button type="button" className="yz2-stab-iconbtn" title="Restore" onClick={() => store.restoreBackup(backup.id)}>
                            ↺
                        </button>
                        <button type="button" className="yz2-stab-iconbtn danger" title="Discard" onClick={() => store.discardBackup(backup.id)}>
                            ×
                        </button>
                    </div>
                </div>
            ))}
        </div>
    )
}

export function SettingsModal() {
    const store = useV2Store()
    if (!store.stOpen) return null
    const cur = SETTINGS_CONFIG.find((c) => c.id === store.stSec) ?? SETTINGS_CONFIG[0]

    const valueOf = (key: string | undefined): string | boolean | null => {
        if (!key) return null
        if (key in store.stVals) return store.stVals[key]
        if (key === "theme") return store.theme
        return settingDefault(key)
    }

    return (
        <>
            <div className="yz2-modal-backdrop" onClick={store.closeSettings} />
            <div className="yz2-settings">
                <div className="yz2-settings-head">
                    <span style={{ color: "var(--yz-5a6675)" }}>⚙</span>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>Settings</span>
                    <span className="yz2-scope-chip">applies to all projects</span>
                    <span className="yz2-spacer" />
                    <button type="button" className="yz2-modal-close" onClick={store.closeSettings}>
                        ×
                    </button>
                </div>
                <div className="yz2-settings-body">
                    <div className="yz2-settings-nav">
                        {SETTINGS_CONFIG.map((sec) => (
                            <button
                                type="button"
                                key={sec.id}
                                className={"yz2-settings-nav-item" + (sec.id === cur.id ? " is-active" : "")}
                                onClick={() => store.setSettingsSection(sec.id)}
                            >
                                <span className="glyph">{sec.glyph}</span>
                                <span>{sec.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className="yz2-settings-sec">
                        <div className="sec-title">{cur.label}</div>
                        <div className="sec-desc">{cur.desc}</div>
                        {cur.custom === "performance" ? (
                            <PerformanceSection />
                        ) : cur.custom === "diagnostics" ? (
                            <DiagnosticsSection />
                        ) : cur.custom === "recovery" ? (
                            <RecoverySection />
                        ) : (
                            cur.rows.map((row, i) => (
                                <div key={cur.id + i} className="yz2-setting-row">
                                    <div className="info-col">
                                        <span className="lbl">{row.label}</span>
                                        <span className="dsc">{row.desc}</span>
                                    </div>
                                    {row.toggle ? (
                                        <div
                                            className={"yz2-toggle" + (valueOf(row.k) ? " is-on" : "")}
                                            onClick={() => row.k && store.setSetting(row.k, !valueOf(row.k))}
                                        >
                                            <span className="knob" />
                                        </div>
                                    ) : row.choice ? (
                                        <div className="yz2-choice-group">
                                            {row.choice.map((op) => (
                                                <Fragment key={op}>
                                                    <button
                                                        type="button"
                                                        className={"yz2-choice" + (valueOf(row.k) === op ? " is-on" : "")}
                                                        onClick={() => row.k && store.setSetting(row.k, op)}
                                                    >
                                                        {op}
                                                    </button>
                                                </Fragment>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="yz2-info-chip">{row.info}</span>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </>
    )
}

export function Toast() {
    const toast = useV2Store((s) => s.toast)
    if (!toast) return null
    return <div className="yz2-toast">{toast}</div>
}

export function ConfirmModal() {
    const confirm = useV2Store((s) => s.confirm)
    const closeConfirm = useV2Store((s) => s.closeConfirm)
    const [typedValue, setTypedValue] = useState("")
    useEffect(() => {
        setTypedValue("")
    }, [confirm?.typed, confirm?.title])
    if (!confirm) return null
    const blocked = !!confirm.typed && typedValue !== confirm.typed
    return (
        <>
            <div className="yz2-modal-backdrop" style={{ zIndex: 410 }} onClick={closeConfirm} />
            <div className="yz2-confirm">
                <div className="yz2-confirm-title">{confirm.title}</div>
                <div className="yz2-confirm-body">{confirm.body}</div>
                {confirm.typed ? (
                    <label className="yz2-confirm-typed">
                        <span>Type <strong>{confirm.typed}</strong> to confirm</span>
                        <input
                            aria-label="Confirmation text"
                            value={typedValue}
                            onChange={(event) => setTypedValue(event.currentTarget.value)}
                        />
                    </label>
                ) : null}
                <div className="yz2-confirm-acts">
                    <button type="button" className="yz2-btn-ghost" onClick={closeConfirm}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className={confirm.danger ? "yz2-btn-danger" : "yz2-btn-accent"}
                        disabled={blocked}
                        onClick={() => {
                            if (blocked) return
                            closeConfirm()
                            confirm.action()
                        }}
                    >
                        {confirm.label}
                    </button>
                </div>
            </div>
        </>
    )
}
