// Yuuzu IDE v2 workbench — root shell per the Claude Design handoff.
// Layout: title bar / project rail / side panel / content column / status bar,
// plus the global overlays and the design's keyboard model.

import { useEffect } from "react"
import { type UnlistenFn } from "@tauri-apps/api/event"

import "./yuzu.css"
import { filterPaletteCommands, filterPaletteFiles, fmtBytes, langLabel } from "./v2-model"
import { useV2Store, v2Store } from "./v2-store"
import { bootstrapV2 } from "./controller"
import { onWorkspaceFileChanged, unwatchWorkspace, watchWorkspace, type WatchWorkspaceHandle } from "../features/files/file-api"
import { normalizeFsPath } from "./file-watch"
import { isTauri, langForPath } from "./bridge"
import { ProjectRail } from "./ProjectRail"
import { SidePanel } from "./SidePanel"
import { TabStrip } from "./TabStrip"
import { BrowserView, EditorView, EmptyView, SplitPane, TerminalView } from "./ContentViews"
import { GitGraphView } from "./GitGraphView"
import { DiffView } from "./DiffView"
import { ConflictView } from "./ConflictView"
import { BranchPopup } from "./BranchPopup"
import { StashPanel } from "./StashPanel"
import { DbTableView } from "./DbTableView"
import { DbConnDialog } from "./DbConnDialog"
import { SftpView } from "./SftpView"
import { AgentZone } from "./AgentZone"
import { CodeActionsOverlay, CommandPalette, ConfirmModal, ContextMenu, ReferencesOverlay, SettingsModal, Toast, runPaletteAction } from "./Overlays"

function TitleBar() {
    const meta = useV2Store((s) => s.meta[s.active] as typeof s.meta[string] | undefined)
    const panelOpen = useV2Store((s) => s.panelOpen)
    const setPanelOpen = useV2Store((s) => s.setPanelOpen)
    const toggleTheme = useV2Store((s) => s.toggleTheme)
    const openPalette = useV2Store((s) => s.openPalette)

    return (
        <div className="yz2-titlebar" data-tauri-drag-region>
            {isTauri() ? (
                // Native macOS traffic lights overlay this strip (titleBarStyle:
                // Overlay + trafficLightPosition in tauri.conf.json).
                <div style={{ width: 56, flex: "0 0 56px" }} aria-hidden="true" />
            ) : (
                <div className="yz2-traffic" aria-hidden="true">
                    <span style={{ background: "#ff5f57" }} />
                    <span style={{ background: "#febc2e" }} />
                    <span style={{ background: "#28c840" }} />
                </div>
            )}
            <button
                type="button"
                className={"yz2-iconbtn yz2-panel-toggle" + (panelOpen ? "" : " is-on")}
                title="Toggle side panel"
                aria-label="Toggle side panel"
                aria-expanded={panelOpen}
                onClick={() => setPanelOpen(!panelOpen)}
            >
                ▦
            </button>
            <div className="yz2-brand">
                <span className="yz2-logo">ゆ</span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>yuuzu</span>
                <span style={{ color: "var(--yz-a8e23f)", fontWeight: 700 }}>/</span>
                <span style={{ fontSize: 13, color: "var(--yz-8b97a7)" }}>ide</span>
            </div>
            <div className="yz2-vsep" />
            {meta ? (
                <div className="yz2-proj-chip">
                    <span style={{ fontWeight: 600 }}>{meta.name}</span>
                    {meta.branch ? <span style={{ fontSize: 11, color: "var(--yz-8b97a7)" }}>⎇ {meta.branch}</span> : null}
                </div>
            ) : null}
            <div className="yz2-spacer" />
            <button type="button" className="yz2-search" onClick={openPalette}>
                <span>⌕</span>
                <span style={{ flex: 1 }}>Search or run a command</span>
                <span className="kbd">⌘K</span>
            </button>
            {isTauri() ? null : (
                <span className="yz2-dev-badge">
                    <span className="yz2-dot" />
                    <span>dev :3000</span>
                </span>
            )}
            <button type="button" className="yz2-iconbtn" title="Theme — dark / light" onClick={toggleTheme}>
                ◐
            </button>
        </div>
    )
}

function StatusBar() {
    const mode = useV2Store((s) => s.mode)
    const active = useV2Store((s) => s.active)
    const meta = useV2Store((s) => s.meta[s.active] as typeof s.meta[string] | undefined)
    const order = useV2Store((s) => s.order)
    const ui = useV2Store((s) => s.ui)
    const cursor = useV2Store((s) => s.cursor)
    const memoryBytes = useV2Store((s) => s.stab.metric?.memoryBytes ?? null)
    const tabSize = useV2Store((s) => (s.stVals.tabSize === "4" ? "4" : "2"))
    const azTotal = order.reduce((n, id) => n + (ui[id]?.wins.length ?? 0), 0)

    const p = ui[active]
    const git = p?.git
    const at = p ? p.tabs.find((t) => t.id === p.activeTab) ?? p.tabs[0] ?? null : null
    const isReal = mode === "real"
    const lang = at?.type === "file"
        ? langLabel(at.contentLang ?? langForPath(at.name ?? ""))
        : null
    const lnCol = cursor
        ? "Ln " + cursor.ln + ", Col " + cursor.col
        : isReal ? null : "Ln 9, Col 24"

    return (
        <div className="yz2-status">
            <span className="branch">⎇ {meta?.branch || "—"}</span>
            <span style={{ padding: "0 10px" }} title="behind ↓ / ahead ↑ of upstream">
                ⟳ {git?.behind ?? 0}↓ {git?.ahead ?? 0}↑
            </span>
            <span style={{ padding: "0 9px" }} title="Performance memory">
                Memory {fmtBytes(memoryBytes)}
            </span>
            {isReal ? null : (
                <>
                    <span style={{ padding: "0 4px" }}>✗ 0</span>
                    <span style={{ padding: "0 6px", color: "var(--yz-ffcb6b)" }}>⚠ 3</span>
                </>
            )}
            <span className="yz2-spacer" />
            <span style={{ padding: "0 9px", color: "var(--yz-a8e23f)" }}>✦ {azTotal} agent sessions</span>
            {isReal ? null : (
                <span style={{ padding: "0 9px" }}>
                    <span style={{ color: "var(--yz-a8e23f)" }}>●</span> dev server
                </span>
            )}
            {lnCol ? <span style={{ padding: "0 9px" }}>{lnCol}</span> : null}
            <span style={{ padding: "0 9px" }}>Spaces: {tabSize}</span>
            <span style={{ padding: "0 9px" }}>UTF-8</span>
            {lang ? <span style={{ padding: "0 12px 0 9px" }}>{lang}</span> : <span style={{ padding: "0 3px" }} />}
        </div>
    )
}

function OpenFolderHero() {
    const addProject = useV2Store((s) => s.addProject)
    return (
        <div className="yz2-content">
            <div className="yz2-view">
                <div className="yz2-empty">
                    <div style={{ textAlign: "center" }}>
                        <div className="big">
                            yuuzu<span style={{ color: "var(--yz-2b3547)" }}>/</span>ide
                        </div>
                        <div className="hints">No project folders yet.</div>
                        <button
                            type="button"
                            style={{
                                marginTop: 16,
                                display: "inline-block",
                                padding: "9px 18px",
                                borderRadius: 8,
                                background: "var(--yz-a8e23f)",
                                color: "var(--yz-0a0e15)",
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                            }}
                            onClick={addProject}
                        >
                            + Open a folder
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

function MainContent() {
    const fn = useV2Store((s) => s.ui[s.active].fn)
    const tabs = useV2Store((s) => s.ui[s.active].tabs)
    const activeTab = useV2Store((s) => s.ui[s.active].activeTab)
    const split = useV2Store((s) => s.ui[s.active].split)

    if (fn === "agent") {
        return (
            <div className="yz2-content">
                <AgentZone />
            </div>
        )
    }

    const at = tabs.find((t) => t.id === activeTab) ?? tabs[0] ?? null

    return (
        <div className="yz2-content">
            <TabStrip />
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    {!at ? (
                        <EmptyView />
                    ) : at.type === "file" ? (
                        <EditorView tab={at} />
                    ) : at.type === "cmd" ? (
                        <TerminalView tab={at} />
                    ) : at.type === "browser" ? (
                        <BrowserView tab={at} />
                    ) : at.type === "git" ? (
                        <GitGraphView />
                    ) : at.type === "diff" ? (
                        <DiffView tab={at} />
                    ) : at.type === "conflict" ? (
                        <ConflictView tab={at} />
                    ) : at.type === "db" ? (
                        <DbTableView tab={at} />
                    ) : at.type === "sftp" ? (
                        <SftpView tab={at} />
                    ) : (
                        <EmptyView />
                    )}
                </div>
                {split ? <SplitPane /> : null}
            </div>
        </div>
    )
}

function useWorkspaceFileWatcher() {
    const mode = useV2Store((s) => s.mode)
    const activeId = useV2Store((s) => s.active)
    const root = useV2Store((s) => s.meta[s.active]?.root)
    useEffect(() => {
        if (!isTauri() || mode !== "real" || !activeId || !root) return
        let handle: WatchWorkspaceHandle | null = null
        let unlisten: UnlistenFn | null = null
        let disposed = false
        const dispose = () => {
            if (unlisten) {
                unlisten()
                unlisten = null
            }
            if (handle) {
                void unwatchWorkspace(handle).catch(() => undefined)
                handle = null
            }
        }
        void (async () => {
            try {
                handle = await watchWorkspace(root)
                if (disposed) {
                    dispose()
                    return
                }
                const watchedRoot = handle.workspace_root
                unlisten = await onWorkspaceFileChanged((ev) => {
                    if (normalizeFsPath(ev.workspace_root) !== normalizeFsPath(watchedRoot)) return
                    useV2Store.getState().markExternalFileChange(activeId, ev.workspace_root, ev.path, ev.version)
                })
                if (disposed) dispose()
            } catch {
                // watcher is best-effort; release anything already acquired
                dispose()
            }
        })()
        return () => {
            disposed = true
            dispose()
        }
    }, [mode, activeId, root])
}

function useGlobalKeys() {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return
            const store = v2Store.getState()
            const p = store.ui[store.active]
            if (!p) return

            if (e.ctrlKey && e.key === "`") {
                e.preventDefault()
                store.newTerm()
                return
            }
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "b") {
                e.preventDefault()
                store.newBrowser()
                return
            }
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault()
                if (store.pal.open) store.closePalette()
                else store.openPalette()
                return
            }
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                const at = p.tabs.find((t) => t.id === p.activeTab) ?? p.tabs[0] ?? null
                if (at?.type === "file" && at.realPath !== undefined) {
                    e.preventDefault()
                    store.saveTab(at.id)
                    return
                }
            }

            if (store.pal.open) {
                if (e.key === "Escape") {
                    store.closePalette()
                    return
                }
                if (e.key === "Enter") {
                    e.preventDefault()
                    const files = filterPaletteFiles(p.treeData, store.pal.q)
                    const cmds = filterPaletteCommands(store.pal.q)
                    store.closePalette()
                    if (files[0]) store.openFile(files[0].path)
                    else if (cmds[0]) runPaletteAction(cmds[0].action, store)
                    return
                }
                if (e.key === "Backspace") {
                    e.preventDefault()
                    store.setPaletteQuery((q) => q.slice(0, -1))
                    return
                }
                if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
                    e.preventDefault()
                    store.setPaletteQuery((q) => q + e.key)
                }
                return
            }

            if (e.key === "Escape") {
                if (store.confirm) {
                    store.closeConfirm()
                    return
                }
                if (store.ctx) {
                    store.closeCtx()
                    return
                }
                if (store.plusMenu) {
                    store.setPlusMenu(null)
                    return
                }
                if (store.stOpen) {
                    store.closeSettings()
                    return
                }
                if (p.fn === "agent" && p.wins.some((w) => w.max)) {
                    store.azExitMax()
                    return
                }
            }

            if (p.fn === "agent" && store.mode === "demo") {
                if (e.metaKey || e.ctrlKey || e.altKey) return
                const actId = p.azActive ?? p.wins[0]?.id ?? null
                const aw = p.wins.find((w) => w.id === actId && !w.min)
                if (!aw) return
                if (e.key === "Enter") {
                    e.preventDefault()
                    store.runAzCmd(aw.id)
                    return
                }
                if (e.key === "Backspace") {
                    e.preventDefault()
                    store.setAzBuf(aw.id, (b) => b.slice(0, -1))
                    return
                }
                if (e.key.length === 1) store.setAzBuf(aw.id, (b) => b + e.key)
                return
            }

            const at = p.tabs.find((t) => t.id === p.activeTab) ?? p.tabs[0] ?? null
            if (!at) return

            if (at.type === "cmd" && store.mode === "demo") {
                if (e.metaKey || e.ctrlKey || e.altKey) return
                if (e.key === "Enter") {
                    e.preventDefault()
                    store.runTermCmd(at.id)
                    return
                }
                if (e.key === "Backspace") {
                    e.preventDefault()
                    store.setTermBuf(at.id, (b) => b.slice(0, -1))
                    return
                }
                if (e.key.length === 1) store.setTermBuf(at.id, (b) => b + e.key)
                return
            }

            if (at.type === "sftp" && (e.metaKey || e.ctrlKey)) {
                const k = e.key.toLowerCase()
                if (k === "c" && p.sftp.sel) {
                    e.preventDefault()
                    store.sftpCopy()
                }
                if (k === "v" && p.sftp.clip) {
                    e.preventDefault()
                    store.sftpPaste()
                }
            }
        }

        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [])
}

export function WorkbenchV2() {
    const panelOpen = useV2Store((s) => s.panelOpen)
    const hasProject = useV2Store((s) => s.order.length > 0 && !!s.ui[s.active])
    const fontSize = useV2Store((s) => (typeof s.stVals.fontSize === "string" ? s.stVals.fontSize : "13"))
    const blink = useV2Store((s) => s.stVals.blink !== false)
    useGlobalKeys()
    useWorkspaceFileWatcher()

    useEffect(() => {
        let disposed = false
        void bootstrapV2().then(() => {
            if (disposed) return
            const store = v2Store.getState()
            if (!store.stab.metric) store.refreshMetric()
        })
        return () => {
            disposed = true
        }
    }, [])

    return (
        <div
            className={"yz2" + (blink ? "" : " yz2-no-blink")}
            style={{ "--yz2-ed-fs": fontSize + "px" } as React.CSSProperties}
        >
            <TitleBar />
            <div className="yz2-main">
                <ProjectRail />
                {hasProject && panelOpen ? <SidePanel /> : null}
                {hasProject ? <MainContent /> : <OpenFolderHero />}
            </div>
            <StatusBar />
            <BranchPopup />
            <StashPanel />
            <ContextMenu />
            <DbConnDialog />
            <ReferencesOverlay />
            <CodeActionsOverlay />
            <CommandPalette />
            <SettingsModal />
            <ConfirmModal />
            <Toast />
        </div>
    )
}
