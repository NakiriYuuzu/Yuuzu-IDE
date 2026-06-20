import type { ReactNode } from "react"

import { DIR_CHIP, chipFor, diagBadge, LANE_COLORS, normSeverity } from "./v2-model"
import type { FnMode, GitFile, TreeNode } from "./v2-model"
import { useV2Store } from "./v2-store"

function memoryLabel(bytes: number | null): string {
    if (bytes == null) return "not running"
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB"
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB"
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB"
    return bytes + " B"
}

function FnIcon({ children }: { children: ReactNode }) {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            {children}
        </svg>
    )
}

function FunctionList() {
    const mode = useV2Store((s) => s.mode)
    const fn = useV2Store((s) => s.ui[s.active].fn)
    const wins = useV2Store((s) => s.ui[s.active].wins)
    const git = useV2Store((s) => s.ui[s.active].git)
    const dbs = useV2Store((s) => s.ui[s.active].dbConns)
    const hosts = useV2Store((s) => s.ui[s.active].sshHosts)
    const diagnosticsByPath = useV2Store((s) => s.ui[s.active].diagnosticsByPath)
    const selectFn = useV2Store((s) => s.selectFn)

    const gitBadge = mode === "real" ? git.ahead + git.behind : git.ahead + git.behind + 2
    const langBadge = diagBadge(diagnosticsByPath ?? {})
    const rows: { id: FnMode; label: string; icon: ReactNode; badge?: string }[] = [
        { id: "files", label: "Files", icon: <path d="M2 4.5C2 3.7 2.7 3 3.5 3h2.8l1.8 2h4.4c.8 0 1.5.7 1.5 1.5v5c0 .8-.7 1.5-1.5 1.5h-9C2.7 13 2 12.3 2 11.5V4.5z" /> },
        { id: "git", label: "Git", badge: gitBadge > 0 ? String(gitBadge) : undefined, icon: <><circle cx="4.5" cy="4.2" r="1.7" /><circle cx="4.5" cy="11.8" r="1.7" /><circle cx="11.5" cy="5.8" r="1.7" /><path d="M4.5 5.9v4.2 M11.5 7.5c0 2.6-3.2 2-7 3.2" /></> },
        { id: "db", label: "Database", badge: String(dbs.length), icon: <><ellipse cx="8" cy="3.8" rx="5" ry="1.9" /><path d="M3 3.8v8.4c0 1 2.2 1.9 5 1.9s5-.9 5-1.9V3.8 M3 8c0 1 2.2 1.9 5 1.9S13 9 13 8" /></> },
        { id: "ssh", label: "SSH · SFTP", badge: String(hosts.length), icon: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M4.5 6.2l2 1.8-2 1.8 M8.5 10h3" /></> },
        { id: "lang", label: "Language", badge: langBadge ?? undefined, icon: <><path d="M3 3.5h6.5L13 7v5.5H3z" /><path d="M9.5 3.5V7H13 M5 9h6 M5 11h4" /></> },
        { id: "agent", label: "AgentZone", icon: <path d="M8 1.8l1.3 4 4 1.3-4 1.3-1.3 4-1.3-4-4-1.3 4-1.3z" /> },
    ]

    return (
        <div className="yz2-fnlist">
            {rows.map((row) => (
                <button
                    type="button"
                    key={row.id}
                    className={"yz2-fnrow" + (fn === row.id ? " is-active" : "")}
                    onClick={() => selectFn(row.id)}
                >
                    <FnIcon>{row.icon}</FnIcon>
                    <span className="label">{row.label}</span>
                    {row.id === "agent" ? (
                        wins.length > 0 ? (
                            <span className="yz2-fnbadge-live">
                                <span className="d" />
                                <span>{wins.length}</span>
                            </span>
                        ) : null
                    ) : row.badge ? (
                        <span className="yz2-fnbadge">{row.badge}</span>
                    ) : null}
                </button>
            ))}
        </div>
    )
}

function ExplorerBody() {
    const mode = useV2Store((s) => s.mode)
    const treeLoaded = useV2Store((s) => s.ui[s.active].treeLoaded)
    const treeData = useV2Store((s) => s.ui[s.active].treeData)
    const open = useV2Store((s) => s.ui[s.active].open)
    const tabs = useV2Store((s) => s.ui[s.active].tabs)
    const activeTab = useV2Store((s) => s.ui[s.active].activeTab)
    const toggleDir = useV2Store((s) => s.toggleDir)
    const openFile = useV2Store((s) => s.openFile)
    const openCtx = useV2Store((s) => s.openCtx)

    const at = tabs.find((t) => t.id === activeTab) ?? tabs[0] ?? null
    const rows: ReactNode[] = []

    const walk = (nodes: TreeNode[], base: string, depth: number) => {
        for (const node of nodes) {
            const path = base ? base + "/" + node.n : node.n
            const isDir = !!node.d
            const isOpen = !!open[path]
            const isActiveFile = !!at && at.type === "file" && at.path === path
            const [chip, cbg, cfg] = isDir ? DIR_CHIP : chipFor(node.n)
            rows.push(
                <button
                    type="button"
                    key={path}
                    className={"yz2-tree-row" + (isActiveFile ? " is-active" : "")}
                    style={{ paddingLeft: 8 + depth * 14 }}
                    onClick={() => (isDir ? toggleDir(path) : openFile(path))}
                    onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        openCtx({ kind: isDir ? "dir" : "file", x: e.clientX, y: e.clientY, path })
                    }}
                >
                    <span className="chev">{isDir ? (isOpen ? "▾" : "▸") : ""}</span>
                    <span className="yz2-chip" style={{ background: cbg, color: cfg }}>{chip}</span>
                    <span
                        className="name"
                        style={
                            isDir
                                ? { color: "var(--yz-dbe4ec)", fontWeight: 600 }
                                : { color: isActiveFile ? "var(--yz-a8e23f)" : "var(--yz-8b97a7)" }
                        }
                    >
                        {node.n}
                    </span>
                    {node.mod ? <span className="mod">M</span> : null}
                </button>,
            )
            if (isDir && isOpen && node.d) walk(node.d, path, depth + 1)
        }
    }
    walk(treeData, "", 0)

    return (
        <>
            <div className="yz2-sec-label">EXPLORER</div>
            {mode === "real" && !treeLoaded ? (
                <div className="yz2-panel-note">Loading workspace…</div>
            ) : null}
            {rows}
        </>
    )
}

const GIT_ST_COLOR: Record<GitFile["st"], string> = {
    A: "var(--yz-9ccc65)",
    M: "var(--yz-ffcb6b)",
    D: "var(--yz-f07178)",
    U: "var(--yz-82aaff)",
}

function GitFileSection({
    title,
    files,
    empty,
    allLabel,
    onAll,
    onOpen,
    renderActs,
}: {
    title: string
    files: GitFile[]
    empty: string
    allLabel?: string
    onAll?: () => void
    onOpen?: (file: GitFile) => void
    renderActs: (file: GitFile) => ReactNode
}) {
    return (
        <div className="yz2-sc-section">
            <div className="yz2-sc-section-head">
                <span>{title} · {files.length}</span>
                {files.length && allLabel && onAll ? (
                    <button type="button" className="yz2-sc-allbtn" onClick={onAll}>
                        {allLabel}
                    </button>
                ) : null}
            </div>
            {files.length ? (
                files.map((file) => (
                    <div key={title + file.path} className="yz2-sc-file">
                        <button type="button" className="main" onClick={() => onOpen?.(file)}>
                            <span className="st" style={{ color: GIT_ST_COLOR[file.st] }}>{file.st}</span>
                            <span className="nm" title={file.path}>{file.path}</span>
                        </button>
                        <span className="acts">{renderActs(file)}</span>
                    </div>
                ))
            ) : (
                <div className="yz2-sc-empty">{empty}</div>
            )}
        </div>
    )
}

function GitBody() {
    const meta = useV2Store((s) => s.meta[s.active])
    const git = useV2Store((s) => s.ui[s.active].git)
    const commitMsg = useV2Store((s) => s.ui[s.active].commitMsg)
    const setCommitMsg = useV2Store((s) => s.setCommitMsg)
    const doCommit = useV2Store((s) => s.doCommit)
    const selectFn = useV2Store((s) => s.selectFn)
    const gitSync = useV2Store((s) => s.gitSync)
    const stageFiles = useV2Store((s) => s.stageFiles)
    const unstageFiles = useV2Store((s) => s.unstageFiles)
    const stageAll = useV2Store((s) => s.stageAll)
    const unstageAll = useV2Store((s) => s.unstageAll)
    const discardFiles = useV2Store((s) => s.discardFiles)
    const openWorkingDiff = useV2Store((s) => s.openWorkingDiff)
    const openConflict = useV2Store((s) => s.openConflict)
    const openBranchPopup = useV2Store((s) => s.openBranchPopup)
    const openStashPanel = useV2Store((s) => s.openStashPanel)
    const branchLabel = git.branch || meta.branch

    return (
        <>
            <div className="yz2-sec-label">SOURCE CONTROL</div>
            <div className="yz2-sc-card">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button type="button" className="yz2-branch-chip" onClick={openBranchPopup}>Branch {branchLabel}</button>
                    <span className="yz2-spacer" />
                    <span style={{ fontSize: 11, color: "var(--yz-8b97a7)" }}>{git.ahead}↑ {git.behind}↓</span>
                </div>
                <input
                    value={commitMsg}
                    placeholder="Commit message — Enter to commit"
                    onChange={(e) => setCommitMsg(e.target.value)}
                    onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === "Enter") doCommit()
                    }}
                />
                <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                    <button type="button" className="yz2-btn-accent" onClick={doCommit}>Commit</button>
                    <button type="button" className="yz2-btn-ghost" onClick={() => gitSync("fetch")}>Fetch</button>
                    <button type="button" className="yz2-btn-ghost" onClick={openStashPanel}>Stash</button>
                </div>
            </div>
            <GitFileSection
                title="CONFLICTS"
                files={git.conflicts}
                empty="No conflicts"
                onOpen={(file) => openConflict(file.path)}
                renderActs={(file) => (
                    <button type="button" className="yz2-sc-fileact danger" title="Discard" onClick={() => discardFiles([file.path])}>
                        ↺
                    </button>
                )}
            />
            <GitFileSection
                title="STAGED"
                files={git.staged}
                empty="No staged files"
                allLabel="Unstage all"
                onAll={unstageAll}
                onOpen={(file) => openWorkingDiff(file.path, true)}
                renderActs={(file) => (
                    <button type="button" className="yz2-sc-fileact" title="Unstage" onClick={() => unstageFiles([file.path])}>
                        −
                    </button>
                )}
            />
            <GitFileSection
                title="CHANGES"
                files={git.unstaged}
                empty="No changes"
                allLabel="Stage all"
                onAll={stageAll}
                onOpen={(file) => openWorkingDiff(file.path, false)}
                renderActs={(file) => (
                    <>
                        <button type="button" className="yz2-sc-fileact" title="Stage" onClick={() => stageFiles([file.path])}>
                            +
                        </button>
                        <button type="button" className="yz2-sc-fileact danger" title="Discard" onClick={() => discardFiles([file.path])}>
                            ↺
                        </button>
                    </>
                )}
            />
            <div className="yz2-sec-label" style={{ paddingTop: 6 }}>RECENT COMMITS</div>
            {git.commits.slice(0, 5).map((c, i) => (
                <button type="button" key={c.h + i} className="yz2-recent-row">
                    <span className="d" style={{ background: LANE_COLORS[c.lane] ?? LANE_COLORS[0] }} />
                    <span className="m">{c.m}</span>
                    <span className="t">{c.t}</span>
                </button>
            ))}
            <button type="button" className="yz2-link" onClick={() => selectFn("git")}>
                Open commit graph →
            </button>
        </>
    )
}

function DbBody() {
    const dbOpen = useV2Store((s) => s.ui[s.active].dbOpen)
    const dbs = useV2Store((s) => s.ui[s.active].dbConns)
    const toggleDbConn = useV2Store((s) => s.toggleDbConn)
    const openDbTable = useV2Store((s) => s.openDbTable)
    const openDbConnDialog = useV2Store((s) => s.openDbConnDialog)
    const openCtx = useV2Store((s) => s.openCtx)

    if (!dbs.length) {
        return (
            <>
                <div className="yz2-sec-label">DATABASES</div>
                <div className="yz2-panel-note">
                    No connections in this project.
                    <button type="button" className="yz2-db-add-empty" onClick={() => openDbConnDialog()}>
                        + 新增連線
                    </button>
                </div>
            </>
        )
    }
    return (
        <>
            <div className="yz2-sec-head">
                <span className="yz2-sec-label">DATABASES</span>
                <button type="button" className="yz2-db-add-mini" onClick={() => openDbConnDialog()} title="新增連線">
                    +
                </button>
            </div>
            {dbs.map((conn, ci) => {
                const isOpen = !!dbOpen[ci]
                return (
                    <div key={conn.name}>
                        <button
                            type="button"
                            className="yz2-db-conn"
                            onClick={() => toggleDbConn(ci)}
                            onContextMenu={(e) => {
                                e.preventDefault()
                                openCtx({ kind: "dbconn", x: e.clientX, y: e.clientY, ci, name: conn.name, live: conn.live })
                            }}
                        >
                            <span className="chev" style={{ width: 13, textAlign: "center", color: "var(--yz-5a6675)", fontSize: 10 }}>
                                {isOpen ? "▾" : "▸"}
                            </span>
                            <span className="meta">
                                <span className="nm">{conn.name}</span>
                                <span className="en">{conn.engine}</span>
                            </span>
                            <span className="d" style={{ background: conn.live ? "var(--yz-a8e23f)" : "var(--yz-3d4654)" }} />
                        </button>
                        {isOpen
                            ? conn.tables.map((tb) => (
                                  <button
                                      type="button"
                                      key={tb.n}
                                      className="yz2-db-table"
                                      onClick={() => openDbTable(ci, tb)}
                                      onContextMenu={(e) => {
                                          e.preventDefault()
                                          openCtx({ kind: "dbtable", x: e.clientX, y: e.clientY, ci, table: tb })
                                      }}
                                  >
                                      <span className="ic">▦</span>
                                      <span className="nm">{tb.n}</span>
                                      <span className="ct">{tb.c}</span>
                                  </button>
                              ))
                            : null}
                    </div>
                )
            })}
        </>
    )
}

function SshBody() {
    const hosts = useV2Store((s) => s.ui[s.active].sshHosts)
    const openSftp = useV2Store((s) => s.openSftp)
    const openShell = useV2Store((s) => s.openShell)
    const openCtx = useV2Store((s) => s.openCtx)

    if (!hosts.length) {
        return (
            <>
                <div className="yz2-sec-label">SSH HOSTS</div>
                <div className="yz2-panel-note">No SSH hosts saved for this project.</div>
            </>
        )
    }
    return (
        <>
            <div className="yz2-sec-label">SSH HOSTS</div>
            {hosts.map((h) => (
                <div
                    key={h.label}
                    className="yz2-host-card"
                    onContextMenu={(e) => {
                        e.preventDefault()
                        openCtx({ kind: "host", x: e.clientX, y: e.clientY, host: h })
                    }}
                >
                    <div className="row1">
                        <span className="d" style={{ background: h.live ? "var(--yz-a8e23f)" : "var(--yz-3d4654)" }} />
                        <span className="lbl">{h.label}</span>
                    </div>
                    <div className="sub">{h.sub}</div>
                    <div className="acts">
                        <button type="button" className="yz2-btn-accent" onClick={() => openSftp(h)}>⇅ SFTP</button>
                        <button type="button" className="yz2-btn-ghost" onClick={() => openShell(h)}>❯ Shell</button>
                    </div>
                </div>
            ))}
            <div style={{ margin: "8px 8px 0", fontSize: 11, color: "var(--yz-5a6675)" }}>
                Transfer files between panes with Ctrl/⌘ C and Ctrl/⌘ V.
            </div>
        </>
    )
}

function AgentBody() {
    const wins = useV2Store((s) => s.ui[s.active].wins)
    const azFocusFromPanel = useV2Store((s) => s.azFocusFromPanel)
    const azNew = useV2Store((s) => s.azNew)
    const openCtx = useV2Store((s) => s.openCtx)

    return (
        <>
            <div className="yz2-sec-label">AGENT SESSIONS</div>
            {wins.map((w) => (
                <button
                    type="button"
                    key={w.id}
                    className="yz2-agent-row"
                    onClick={() => azFocusFromPanel(w.id)}
                    onContextMenu={(e) => {
                        e.preventDefault()
                        openCtx({ kind: "session", x: e.clientX, y: e.clientY, winId: w.id })
                    }}
                >
                    <span className="d" style={{ background: w.status === "running" ? "var(--yz-a8e23f)" : "var(--yz-3d4654)" }} />
                    <span className="tt">{w.title}</span>
                    <span className="st">{w.status}</span>
                </button>
            ))}
            <button type="button" className="yz2-new-session" onClick={azNew}>+ New session</button>
            <div style={{ margin: "10px 8px 0", fontSize: 11, color: "var(--yz-5a6675)", lineHeight: 1.7 }}>
                A cluster of terminals — every session is a real shell; click a window and type (try claude).
            </div>
        </>
    )
}

function LanguageBody() {
    const mode = useV2Store((s) => s.mode)
    const project = useV2Store((s) => s.ui[s.active])
    const reloadLang = useV2Store((s) => s.reloadLang)
    const restartLspServer = useV2Store((s) => s.restartLspServer)
    const openFile = useV2Store((s) => s.openFile)
    const diagnostics = Object.entries(project.diagnosticsByPath).flatMap(([path, byPath]) =>
        byPath.map((diagnostic, index) => ({ ...diagnostic, path, index })),
    )

    return (
        <>
            <div className="yz2-sec-label yz2-lang-title">
                <span>LANGUAGE</span>
                <button type="button" className="yz2-lang-iconbtn" aria-label="Refresh language data" onClick={reloadLang}>⟳</button>
            </div>
            {mode === "real" && !project.lspLoaded ? (
                <div className="yz2-panel-note">Loading language servers...</div>
            ) : null}
            {mode !== "real" && !project.lspServers.length && !diagnostics.length ? (
                <div className="yz2-panel-note">Language services are not connected in demo mode.</div>
            ) : null}
            <div className="yz2-lang-section">
                <div className="yz2-lang-section-head">
                    <span>LANGUAGE SERVERS</span>
                    <span>{project.lspServers.length}</span>
                </div>
                {project.lspServers.length ? (
                    project.lspServers.map((server) => (
                        <div className="yz2-lang-server" key={`${server.workspace_id}:${server.workspace_root}:${server.language}`}>
                            <span className="ic">◇</span>
                            <div className="main">
                                <span className="name">{server.display_name}</span>
                                <span className="meta">{server.state} · pid {server.pid ?? "n/a"}</span>
                                <span className="meta">open {server.open_documents} · mem {memoryLabel(server.memory_bytes)}</span>
                            </div>
                            <span className={"yz2-lang-state is-" + String(server.state).toLowerCase()}>{server.state}</span>
                            <button
                                type="button"
                                className="yz2-lang-iconbtn"
                                aria-label={`Restart ${server.display_name}`}
                                onClick={() => restartLspServer(server.language)}
                            >
                                ↻
                            </button>
                        </div>
                    ))
                ) : (
                    <div className="yz2-sc-empty">No language servers detected</div>
                )}
            </div>
            <div className="yz2-lang-section">
                <div className="yz2-lang-section-head">
                    <span>DIAGNOSTICS</span>
                    <span>{diagnostics.length}</span>
                </div>
                {diagnostics.length ? (
                    diagnostics.map((diagnostic) => {
                        const sev = normSeverity(diagnostic.severity)
                        const line = diagnostic.range.start_line + 1
                        return (
                            <button
                                type="button"
                                key={`${diagnostic.path}:${line}:${diagnostic.index}`}
                                className="yz2-lang-diag"
                                aria-label={`Open ${diagnostic.path}`}
                                title={`Open ${diagnostic.path}`}
                                onClick={() => openFile(diagnostic.path)}
                            >
                                <span className={"yz2-lang-sev is-" + sev}>{sev}</span>
                                <span className="main">
                                    <span className="name">{diagnostic.path}:{line}</span>
                                    <span className="meta">{diagnostic.source ?? "unknown"}</span>
                                    <span className="meta">{diagnostic.message}</span>
                                </span>
                            </button>
                        )
                    })
                ) : (
                    <div className="yz2-sc-empty">No diagnostics</div>
                )}
            </div>
            <div className="yz2-lang-section">
                <div className="yz2-lang-section-head">
                    <span>SERVER LOGS</span>
                    <span>{project.lspLogs.length}</span>
                </div>
                <pre className="yz2-lang-log">{project.lspLogs.length ? project.lspLogs.join("\n") : "none"}</pre>
            </div>
        </>
    )
}

export function SidePanel() {
    const meta = useV2Store((s) => s.meta[s.active])
    const fn = useV2Store((s) => s.ui[s.active].fn)
    const openCtx = useV2Store((s) => s.openCtx)

    return (
        <div className="yz2-side">
            <div className="yz2-side-head">
                <span style={{ fontWeight: 700, fontSize: 12 }}>{meta.name}</span>
                <span style={{ fontSize: 11, color: "var(--yz-5a6675)" }}>⎇ {meta.branch}</span>
                <span className="yz2-spacer" />
                <span className="yz2-side-refresh">⟳</span>
            </div>
            <FunctionList />
            <div
                className="yz2-panel-body"
                onContextMenu={(e) => {
                    if (fn !== "files") return
                    e.preventDefault()
                    openCtx({ kind: "root", x: e.clientX, y: e.clientY })
                }}
            >
                {fn === "files" ? <ExplorerBody /> : null}
                {fn === "git" ? <GitBody /> : null}
                {fn === "db" ? <DbBody /> : null}
                {fn === "ssh" ? <SshBody /> : null}
                {fn === "lang" ? <LanguageBody /> : null}
                {fn === "agent" ? <AgentBody /> : null}
            </div>
        </div>
    )
}
