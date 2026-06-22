// v2 real-backend controller. Runs only inside Tauri: bootstraps the
// workspace registry into the project rail, lazily loads file trees, file
// contents, git history, database profiles and SSH hosts per project, and
// owns real PTY sessions for terminal tabs and AgentZone windows.

import {
    listWorkspaces,
    openWorkspacePath,
    pickWorkspaceFolder,
    removeWorkspace,
    scanDirectory,
    scanWorkspace,
    switchWorkspace,
} from "../features/workspace/workspace-api"
import { createDirectory, createTextFile, deletePath, readTextFile, writeTextFile } from "../features/files/file-api"
import { writeClipboardText } from "../features/clipboard/clipboard-api"
import { evictHlCache } from "./hl-cache"
import { externallyChangedTabIds, normalizeFsPath, treeRefreshTarget, mergeTreeChildren } from "./file-watch"
import type { FileVersion } from "../features/files/file-model"
import { getGitCommitDetail } from "../features/git/git-api"
import {
    closeTerminalSession,
    onTerminalExit,
    onTerminalOutput,
    resizeTerminalSession,
    spawnTerminalSession,
    writeTerminalSession,
} from "../features/terminal/terminal-api"
import { appendTerminalReplayOutput } from "../features/terminal/terminal-replay-buffer"
import {
    checkoutGitBranch,
    cherryPickGit,
    commitGit,
    acceptGitConflictSide,
    applyGitStash,
    branchFromGitStash,
    createGitBranch,
    deleteGitBranch,
    discardGitPaths,
    dropGitStash,
    exportGitCommit,
    fetchGit,
    getGitBranchesFull,
    getGitBlameFile,
    getGitCommitFileWorktreeDiff,
    getGitConflictFile,
    getGitDiffHunks,
    getGitFileHistory,
    getGitLogPage,
    getGitStatus,
    getGitStashList,
    mergeGitBranch,
    markGitResolved,
    popGitStash,
    pullGit,
    pushGit,
    renameGitBranch,
    rebaseGitOnto,
    resetGitHard,
    resetGitTo,
    revertGitCommit,
    revertGitHunk,
    stageGitPaths,
    stageGitHunks,
    stashGit,
    unstageGitPaths,
    unstageGitHunks,
} from "../features/git/git-api"
import { shouldRefreshGitAfterFileEvent } from "../features/git/git-model"
import type { HunkSelection } from "../features/git/git-diff-model"
import type { GitExportFormat, GitExportScope, GitResetMode } from "../features/git/git-log-model"
import {
    executeDatabaseQuery,
    deleteDatabaseProfile,
    exportDatabaseQueryResult,
    inspectDatabaseSchema,
    listDatabaseQueryHistory,
    listDatabaseProfiles,
    saveDatabaseProfile,
    testDatabaseConnection,
} from "../features/database/database-api"
import type { ConnectionTestResult, DatabaseProfile, DatabaseProfileInput, DatabaseQueryResult } from "../features/database/database-model"
import {
    connectRemoteHost,
    disconnectRemoteHost,
    downloadSftpFile,
    listRemoteHosts,
    listSftpDirectory,
    runRemoteCommand,
    uploadSftpFile,
} from "../features/remote/remote-api"
import { captureBrowserPreview, validateBrowserUrl } from "../features/browser/browser-api"
import type { BrowserPreviewBounds } from "../features/browser/browser-model"
import { appendDiagnosticEvent, listDiagnosticEvents, metricSnapshot } from "../features/diagnostics/diagnostics-api"
import { discardUnsavedBackup, listUnsavedBackups, saveUnsavedBackup } from "../features/recovery/recovery-api"
import {
    closeLanguageDocument,
    getDocumentDiagnostics,
    getLanguageServerLogs,
    getLanguageServerStatus,
    getWorkspaceDiagnostics,
    openLanguageDocument,
    requestLanguageCodeActions,
    requestLanguageCompletion,
    requestLanguageDefinition,
    requestLanguageHover,
    requestLanguageReferences,
    requestLanguageRename,
    requestLanguageSymbols,
    restartLanguageServer,
} from "../features/language/language-api"
import { isLspSupportedDocumentPath, lspDocumentPathForWorkspace, normalizeLanguageCodeActions, normalizeLanguageCompletionItems } from "../features/language/language-model"
import type { LanguageHover, LanguageServerStatus } from "../features/language/language-model"

import {
    confirmationFromError,
    applyTextEdits,
    cursorToLsp,
    flattenWorkspaceEdit,
    findNode,
    isTauri,
    langForPath,
    mapBackups,
    mapDbProfiles,
    mapDbProfilesPreservingState,
    mapDbTables,
    mapDiagnosticEvents,
    mapDiffHunks,
    mapEntriesToNodes,
    mapGitLog,
    mapGitStatusGroups,
    mapMetric,
    mapLspDiagnostics,
    mapLspLocations,
    mapLspSymbols,
    mapLocalEntries,
    mapDbHistory,
    mapQueryResult,
    mapRemoteEntries,
    mapRemoteHosts,
    mapWorkspaceToMeta,
    parentPath,
    remapDbOpenByProfileId,
    setNodeChildren,
} from "./bridge"
import { detectLineEnding, flattenTree, normalizeEditorContent, serializeEditorContent, tabIsDirty } from "./v2-model"
import type { FnMode, LineEnding, ProjectUI, SftpPane, SshHost, Tab } from "./v2-model"
import { registerRealDelegate, settingLimit, v2Store, emptyUI } from "./v2-store"

let bootstrapped = false

function store() {
    return v2Store.getState()
}

function patchProject(pid: string, mut: (p: ProjectUI) => void): void {
    v2Store.setState((s) => {
        const slice = s.ui[pid]
        if (!slice) return {}
        const p = { ...slice }
        mut(p)
        return { ui: { ...s.ui, [pid]: p } }
    })
}

function rootOf(pid: string): string | null {
    return store().meta[pid]?.root ?? null
}

function errMsg(error: unknown): string {
    if (typeof error === "string") return error
    if (error instanceof Error) return error.message
    return String(error)
}

function editorContentFromDisk(content: string | null): { content: string | null; lineEnding: LineEnding } {
    return {
        content: typeof content === "string" ? normalizeEditorContent(content) : content,
        lineEnding: detectLineEnding(content),
    }
}

function lineEndingForTab(tab: Pick<Tab, "content" | "savedContent" | "lineEnding" | "savedLineEnding">): LineEnding {
    return tab.lineEnding ?? tab.savedLineEnding ?? detectLineEnding(typeof tab.savedContent === "string" ? tab.savedContent : tab.content)
}

function savedLineEndingForBackup(value: unknown): LineEnding | null {
    return value === "lf" || value === "crlf" ? value : null
}

function promptForNodeName(kind: "file" | "dir"): string | null {
    const label = kind === "file" ? "New file name:" : "New folder name:"
    const fallback = kind === "file" ? "untitled.ts" : "new-folder"
    const value = window.prompt(label, fallback)
    if (value === null) return null
    const trimmed = value.trim()
    if (!trimmed) {
        store().showToast("Name is required")
        return null
    }
    if (trimmed.includes("/") || trimmed.includes("\\")) {
        store().showToast("Name must be a single path segment")
        return null
    }
    return trimmed
}

function remoteCommandToast(command: string, exitCode: number | null, stdout: string, stderr: string): string {
    const output = (stdout.trim() || stderr.trim() || "(no output)").replace(/\s+/g, " ")
    const preview = output.length > 120 ? output.slice(0, 117) + "..." : output
    return "Remote command exit " + (exitCode ?? "unknown") + " · " + command + " · " + preview
}

function removeConflictChoicesForPath(choices: Record<string, "ours" | "theirs">, path: string): Record<string, "ours" | "theirs"> {
    const prefix = path + ":"
    return Object.fromEntries(Object.entries(choices).filter(([key]) => !key.startsWith(prefix)))
}

function patchTab(pid: string, tabId: number, mut: (t: Tab) => Tab): void {
    patchProject(pid, (p) => {
        p.tabs = p.tabs.map((t) => (t.id === tabId ? mut(t) : t))
    })
}

function tabIn(pid: string, tabId: number): Tab | null {
    return store().ui[pid]?.tabs.find((t) => t.id === tabId) ?? null
}

// Re-read a file tab from disk and apply it. force=true (manual Reload) discards
// local edits; force=false (auto-reload) bails if the tab is no longer clean or
// its version drifted since the read started (the user typed meanwhile).
async function readAndApply(pid: string, tabId: number, force: boolean): Promise<void> {
    const root = rootOf(pid)
    const tab = tabIn(pid, tabId)
    if (!root || !tab || tab.type !== "file" || !tab.realPath) return
    const before = tab.version
    try {
        const read = await readTextFile(root, tab.realPath)
        const editor = editorContentFromDisk(read.content)
        const cur = tabIn(pid, tabId)
        if (!cur || cur.type !== "file" || cur.realPath !== tab.realPath) return
        if (!force) {
            if (cur.dirty || cur.saving) {
                patchTab(pid, tabId, (t) => ({ ...t, externalChange: true }))
                return
            }
            const bv = before
            const cv = cur.version
            if (!bv || !cv || bv.modified_ms !== cv.modified_ms || bv.len !== cv.len) {
                patchTab(pid, tabId, (t) => ({ ...t, externalChange: true }))
                return
            }
        }
        evictHlCache(tabId)
        patchTab(pid, tabId, (t) => ({
            ...t,
            loading: false,
            content: editor.content,
            tooLarge: read.too_large,
            version: read.version,
            savedContent: editor.content ?? t.savedContent,
            lineEnding: editor.content === null ? t.lineEnding : editor.lineEnding,
            savedLineEnding: editor.content === null ? t.savedLineEnding : editor.lineEnding,
            dirty: false,
            saving: false,
            externalChange: false
        }))
        if (typeof editor.content === "string" && cur.path && isLspSupportedDocumentPath(cur.path)) {
            void openLspDocument(pid, cur.path, editor.content).catch(() => {})
        }
    } catch (error) {
        if (force) {
            store().showToast("Reload: " + errMsg(error))
        } else {
            // auto-reload failed (file deleted/unreadable in the race) — surface
            // it as a conflict instead of silently keeping stale content
            patchTab(pid, tabId, (t) => ({ ...t, externalChange: true }))
        }
    }
}

// Raw query results per db tab, kept outside the store for CSV export.
const lastDbResults = new Map<number, DatabaseQueryResult>()
const backupTimers = new Map<number, ReturnType<typeof setTimeout>>()

// Coalesced tree refreshes, keyed per project. Absorbs multi-event saves and
// bulk git operations so the explorer re-scans each affected dir at most once.
const treeSyncPending = new Map<string, Set<string>>()
const treeSyncTimers = new Map<string, ReturnType<typeof setTimeout>>()
const gitReloadTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function syncTreeDir(pid: string, displayDir: string): Promise<void> {
    const root = rootOf(pid)
    if (!root) return
    try {
        if (!displayDir) {
            const entries = await scanWorkspace(root)
            const fresh = mapEntriesToNodes(entries)
            patchProject(pid, (p) => {
                p.treeData = mergeTreeChildren(p.treeData, fresh)
                p.treeLoaded = true
            })
            return
        }
        const node = findNode(store().ui[pid]?.treeData ?? [], displayDir)
        if (!node?.p) return
        const entries = await scanDirectory(root, node.p)
        const fresh = mapEntriesToNodes(entries)
        patchProject(pid, (p) => {
            const target = findNode(p.treeData, displayDir)
            const merged = mergeTreeChildren(target?.d ?? [], fresh)
            p.treeData = setNodeChildren(p.treeData, displayDir, merged)
        })
    } catch {
        // best-effort: a transient scan failure just leaves the tree as-is
    }
}

function scheduleTreeSync(pid: string, displayDir: string): void {
    let pending = treeSyncPending.get(pid)
    if (!pending) {
        pending = new Set()
        treeSyncPending.set(pid, pending)
    }
    pending.add(displayDir)
    const existing = treeSyncTimers.get(pid)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
        treeSyncTimers.delete(pid)
        const dirs = treeSyncPending.get(pid)
        treeSyncPending.delete(pid)
        if (!dirs) return
        for (const dir of dirs) void syncTreeDir(pid, dir)
    }, 120)
    treeSyncTimers.set(pid, timer)
}

function scheduleGitReload(pid: string): void {
    if (!rootOf(pid)) return
    const existing = gitReloadTimers.get(pid)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
        gitReloadTimers.delete(pid)
        void reloadGit(pid)
    }, 160)
    gitReloadTimers.set(pid, timer)
}

function relativeWatchPath(workspaceRoot: string, eventPath: string): string {
    const root = normalizeFsPath(workspaceRoot)
    const path = normalizeFsPath(eventPath)
    return path.startsWith(root + "/") ? path.slice(root.length + 1) : path
}

const lspChangeTimers = new Map<number, ReturnType<typeof setTimeout>>()
const lspDiagTimers = new Map<number, ReturnType<typeof setTimeout>>()
const closedLspPathsByPid = new Map<string, Set<string>>()

function logDiag(level: "debug" | "info" | "warn" | "error", source: string, message: string): void {
    if (!isTauri()) return
    void appendDiagnosticEvent({ level, source, message }).catch(() => {})
}

function fileTreeEntries(pid: string): number {
    return flattenTree(store().ui[pid]?.treeData ?? []).length
}

function lspPath(root: string, displayPath: string): string {
    return lspDocumentPathForWorkspace(root, displayPath)
}

function patchLspServer(pid: string, status: LanguageServerStatus): void {
    patchProject(pid, (p) => {
        const sameServer = (server: LanguageServerStatus) =>
            server.workspace_id === status.workspace_id &&
            server.workspace_root === status.workspace_root &&
            server.language === status.language
        const found = p.lspServers.some(sameServer)
        p.lspServers = found
            ? p.lspServers.map((server) => (sameServer(server) ? status : server))
            : [...p.lspServers, status]
    })
}

async function pollDocDiag(pid: string, displayPath: string): Promise<void> {
    const root = rootOf(pid)
    if (!root || !isLspSupportedDocumentPath(displayPath)) return
    const path = lspPath(root, displayPath)
    const diags = await getDocumentDiagnostics({ workspaceId: pid, workspaceRoot: root, path })
    const grouped = mapLspDiagnostics(diags)
    patchProject(pid, (p) => {
        p.diagnosticsByPath = {
            ...p.diagnosticsByPath,
            [displayPath]: grouped[path] ?? grouped[displayPath] ?? diags,
        }
    })
}

async function pollWorkspaceDiag(pid: string): Promise<void> {
    const root = rootOf(pid)
    if (!root) return
    const diags = await getWorkspaceDiagnostics({ workspaceId: pid, workspaceRoot: root })
    const closed = closedLspPathsByPid.get(pid)
    const visible = closed ? diags.filter((diag) => !closed.has(diag.path)) : diags
    patchProject(pid, (p) => {
        p.diagnosticsByPath = mapLspDiagnostics(visible)
    })
}

async function ensureLang(pid: string, force = false): Promise<void> {
    const root = rootOf(pid)
    const slice = store().ui[pid]
    if (!root || (!force && slice?.lspLoaded)) return
    try {
        const [servers, logs] = await Promise.all([
            getLanguageServerStatus(root),
            getLanguageServerLogs({ workspaceId: pid, workspaceRoot: root }),
        ])
        patchProject(pid, (p) => {
            p.lspServers = servers
            p.lspLogs = logs
            p.lspLoaded = true
        })
        await pollWorkspaceDiag(pid)
    } catch (error) {
        store().showToast("Language: " + errMsg(error))
    }
}

async function openLspDocument(pid: string, displayPath: string, content: string): Promise<void> {
    const root = rootOf(pid)
    if (!root || !isLspSupportedDocumentPath(displayPath)) return
    closedLspPathsByPid.get(pid)?.delete(displayPath)
    const status = await openLanguageDocument({
        workspaceId: pid,
        workspaceRoot: root,
        path: lspPath(root, displayPath),
        content,
    })
    patchLspServer(pid, status)
    await pollDocDiag(pid, displayPath)
}

function scheduleLspChange(pid: string, tabId: number): void {
    const pending = lspChangeTimers.get(tabId)
    if (pending) clearTimeout(pending)
    const timer = setTimeout(() => {
        lspChangeTimers.delete(tabId)
        const tab = tabIn(pid, tabId)
        if (!tab || tab.type !== "file" || !tab.path || typeof tab.content !== "string") return
        void openLspDocument(pid, tab.path, tab.content).catch(() => {})
    }, 400)
    lspChangeTimers.set(tabId, timer)
}

function scheduleDocDiagPoll(pid: string, tabId: number, displayPath: string, delayMs: number): void {
    const pending = lspDiagTimers.get(tabId)
    if (pending) clearTimeout(pending)
    const timer = setTimeout(() => {
        lspDiagTimers.delete(tabId)
        const tab = tabIn(pid, tabId)
        if (!tab || tab.type !== "file" || tab.path !== displayPath) return
        void pollDocDiag(pid, displayPath).catch(() => {})
    }, delayMs)
    lspDiagTimers.set(tabId, timer)
}

function closeLspDocument(pid: string, tab: Tab): void {
    const pending = lspChangeTimers.get(tab.id)
    if (pending) {
        clearTimeout(pending)
        lspChangeTimers.delete(tab.id)
    }
    const diagPending = lspDiagTimers.get(tab.id)
    if (diagPending) {
        clearTimeout(diagPending)
        lspDiagTimers.delete(tab.id)
    }
    if (tab.type !== "file" || !tab.path) return
    const closed = closedLspPathsByPid.get(pid) ?? new Set<string>()
    closed.add(tab.path)
    closedLspPathsByPid.set(pid, closed)
    patchProject(pid, (p) => {
        const next = { ...p.diagnosticsByPath }
        delete next[tab.path as string]
        p.diagnosticsByPath = next
    })
    const root = rootOf(pid)
    if (!root || !isLspSupportedDocumentPath(tab.path)) return
    void closeLanguageDocument({
        workspaceId: pid,
        workspaceRoot: root,
        path: lspPath(root, tab.path),
    }).then((status) => patchLspServer(pid, status)).catch(() => {})
}

async function applyWorkspaceEditGroups(pid: string, groups: ReturnType<typeof flattenWorkspaceEdit>, label: string): Promise<void> {
    const root = rootOf(pid)
    if (!root) return
    const failed: string[] = []
    for (const group of groups) {
        try {
            const currentTab = store().ui[pid]?.tabs.find((t) => t.type === "file" && t.path === group.path)
            const node = findNode(store().ui[pid]?.treeData ?? [], group.path)
            const realPath = currentTab?.realPath ?? node?.p ?? group.path
            const disk = typeof currentTab?.content === "string"
                ? null
                : await readTextFile(root, realPath)
            const content = normalizeEditorContent(typeof currentTab?.content === "string" ? currentTab.content : disk?.content ?? "")
            const version = currentTab?.version ?? disk?.version ?? null
            const lineEnding = currentTab ? lineEndingForTab(currentTab) : detectLineEnding(disk?.content)
            const nextContent = normalizeEditorContent(applyTextEdits(content, group.edits))
            const result = await writeTextFile(root, realPath, serializeEditorContent(nextContent, lineEnding), version)
            if (currentTab) {
                patchTab(pid, currentTab.id, (t) => ({
                    ...t,
                    content: nextContent,
                    savedContent: nextContent,
                    lineEnding,
                    savedLineEnding: lineEnding,
                    version: result.version,
                    dirty: false,
                    saving: false,
                    externalChange: false,
                }))
                if (isLspSupportedDocumentPath(group.path)) {
                    await openLspDocument(pid, group.path, nextContent)
                }
            }
        } catch {
            failed.push(group.path)
        }
    }
    await pollWorkspaceDiag(pid).catch(() => {})
    if (failed.length) {
        store().showToast(label + " applied with " + failed.length + " failed file" + (failed.length === 1 ? "" : "s"))
        return
    }
    store().showToast(label + " · " + groups.length + " file" + (groups.length === 1 ? "" : "s"))
}

// ---------------------------------------------------------------- loading

async function loadRegistry(selectFirst = false): Promise<void> {
    const registry = await listWorkspaces()
    v2Store.setState((s) => {
        const meta = { ...s.meta }
        const ui = { ...s.ui }
        const order: string[] = []
        registry.workspaces.forEach((ws, i) => {
            order.push(ws.id)
            const existing = meta[ws.id]
            meta[ws.id] = existing
                ? { ...existing, name: ws.name, root: ws.path }
                : mapWorkspaceToMeta(ws, i)
            if (!ui[ws.id]) ui[ws.id] = emptyUI()
        })
        let active = s.active
        if (!order.includes(active)) {
            active = registry.active_workspace_id && order.includes(registry.active_workspace_id)
                ? registry.active_workspace_id
                : order[0] ?? ""
        }
        if (selectFirst && registry.active_workspace_id && order.includes(registry.active_workspace_id)) {
            active = registry.active_workspace_id
        }
        return { meta, ui, order, active }
    })
}

async function ensureTree(pid: string): Promise<void> {
    const root = rootOf(pid)
    if (!root || store().ui[pid]?.treeLoaded) return
    try {
        const entries = await scanWorkspace(root)
        patchProject(pid, (p) => {
            p.treeData = mapEntriesToNodes(entries)
            p.treeLoaded = true
        })
    } catch (error) {
        store().showToast("Explorer: " + errMsg(error))
    }
}

async function refreshDir(pid: string, displayDir: string): Promise<void> {
    const root = rootOf(pid)
    if (!root) return
    if (!displayDir) {
        const entries = await scanWorkspace(root)
        patchProject(pid, (p) => {
            p.treeData = mapEntriesToNodes(entries)
            p.treeLoaded = true
            p.open = {}
        })
        return
    }
    const node = findNode(store().ui[pid].treeData, displayDir)
    if (!node?.p) return
    const entries = await scanDirectory(root, node.p)
    patchProject(pid, (p) => {
        p.treeData = setNodeChildren(p.treeData, displayDir, mapEntriesToNodes(entries))
        const open: Record<string, boolean> = {}
        for (const key of Object.keys(p.open)) {
            if (!key.startsWith(displayDir + "/")) open[key] = p.open[key]
        }
        open[displayDir] = true
        p.open = open
    })
}

async function ensureGit(pid: string): Promise<void> {
    const root = rootOf(pid)
    if (!root || store().ui[pid]?.gitLoaded) return
    await reloadGit(pid)
}

async function reloadGit(pid: string): Promise<void> {
    const root = rootOf(pid)
    if (!root) return
    try {
        const [status, page] = await Promise.all([
            getGitStatus(root).catch(() => null),
            getGitLogPage(root, {}, 120),
        ])
        const now = Math.floor(Date.now() / 1000)
        patchProject(pid, (p) => {
            const keep = p.git
            const statusGroups = mapGitStatusGroups(status)
            const conflictPrefixes = new Set(statusGroups.conflicts.map((file) => file.path + ":"))
            p.git = {
                ...mapGitLog(page.rows, status, now),
                ...statusGroups,
                branchesFull: keep.branchesFull,
                stashes: keep.stashes,
                conflictChoices: Object.fromEntries(
                    Object.entries(keep.conflictChoices).filter(([key]) =>
                        Array.from(conflictPrefixes).some((prefix) => key.startsWith(prefix)),
                    ),
                ),
            }
            p.gitLoaded = true
            p.gitSel = 0
            p.gitDetail = null
        })
        const first = store().ui[pid]?.git.commits[0]
        if (first) void selectCommitInProject(pid, first.fullHash ?? first.h)
        if (status?.branch) {
            v2Store.setState((s) => ({
                meta: { ...s.meta, [pid]: { ...s.meta[pid], branch: status.branch ?? "" } },
            }))
        }
    } catch (error) {
        store().showToast("Git: " + errMsg(error))
    }
}

async function selectCommitInProject(pid: string, hash: string): Promise<void> {
    const root = rootOf(pid)
    if (!root) return
    const cached = store().ui[pid]?.gitDetail
    if (cached?.hash === hash) return
    try {
        const detail = await getGitCommitDetail(root, hash)
        patchProject(pid, (q) => {
            q.gitDetail = {
                hash,
                body: detail.body,
                files: detail.files.map((f) => ({
                    path: f.path,
                    st: f.status.slice(0, 1).toUpperCase(),
                    add: f.additions,
                    del: f.deletions,
                })),
            }
        })
    } catch {
        patchProject(pid, (q) => {
            q.gitDetail = { hash, body: "", files: [] }
        })
    }
}

async function ensureConnections(pid: string): Promise<void> {
    const root = rootOf(pid)
    if (!root) return
    try {
        const [profiles, hosts] = await Promise.all([
            listDatabaseProfiles(root).catch(() => []),
            listRemoteHosts(root).catch(() => []),
        ])
        patchProject(pid, (p) => {
            p.dbProfiles = profiles
            if (!p.dbConns.length) p.dbConns = mapDbProfiles(profiles)
            if (!p.sshHosts.length) p.sshHosts = mapRemoteHosts(hosts)
        })
        // Connections rendered expanded should show their schema right away.
        inspectExpandedDbConns(pid)
    } catch (error) {
        store().showToast("Connections: " + errMsg(error))
    }
}

function inspectExpandedDbConns(pid: string): void {
    const p = store().ui[pid]
    p?.dbConns.forEach((conn, idx) => {
        if (p.dbOpen[idx] && conn.profileId && !conn.inspected) void inspectDb(pid, idx)
    })
}

async function reloadDatabaseProfiles(pid: string): Promise<DatabaseProfile[]> {
    const root = rootOf(pid)
    if (!root) return []
    const profiles = await listDatabaseProfiles(root)
    patchProject(pid, (p) => {
        const dbConns = mapDbProfilesPreservingState(profiles, p.dbConns)
        p.dbOpen = remapDbOpenByProfileId(dbConns, p.dbConns, p.dbOpen)
        p.dbProfiles = profiles
        p.dbConns = dbConns
    })
    inspectExpandedDbConns(pid)
    return profiles
}

async function ensureActiveProjectData(pid: string): Promise<void> {
    await Promise.all([ensureTree(pid), ensureGit(pid), ensureConnections(pid)])
}

// ---------------------------------------------------------------- terminals

const terminalOscTitleTails = new Map<string, string>()
const terminalOscTitleMaxTail = 4096
const terminalOscTitleSequence = /\x1b\](?:0|2);([\s\S]*?)(?:\x07|\x1b\\)/g
const terminalOscTitleComplete = /^\x1b\](?:0|2);[\s\S]*(?:\x07|\x1b\\)$/

export function extractTerminalOscTitles(sessionId: string, chunk: string): string[] {
    const combined = (terminalOscTitleTails.get(sessionId) ?? "") + chunk
    const titles: string[] = []
    terminalOscTitleSequence.lastIndex = 0
    let match: RegExpExecArray | null
    let lastMatchEnd = 0

    while ((match = terminalOscTitleSequence.exec(combined)) != null) {
        titles.push(match[1] ?? "")
        lastMatchEnd = terminalOscTitleSequence.lastIndex
    }

    const suffix = combined.slice(lastMatchEnd)
    const lastOscStart = suffix.lastIndexOf("\x1b]")
    let tail = ""
    if (lastOscStart >= 0) {
        const candidate = suffix.slice(lastOscStart)
        if (candidate.startsWith("\x1b]0;") || candidate.startsWith("\x1b]2;")) {
            if (!terminalOscTitleComplete.test(candidate)) tail = candidate
        }
    }

    if (tail.length > terminalOscTitleMaxTail) tail = tail.slice(-terminalOscTitleMaxTail)
    if (tail) terminalOscTitleTails.set(sessionId, tail)
    else terminalOscTitleTails.delete(sessionId)

    return titles
}

export function resetTerminalOscTitleParserForTests(): void {
    terminalOscTitleTails.clear()
}

async function spawnSession(pid: string, name: string): Promise<{ sessionId: string } | null> {
    const root = rootOf(pid)
    if (!root) return null
    try {
        const info = await spawnTerminalSession({
            workspaceId: pid,
            workspaceRoot: root,
            cwd: root,
            name,
            rows: 24,
            cols: 80,
        })
        return { sessionId: info.id }
    } catch (error) {
        store().showToast("Terminal: " + errMsg(error))
        return null
    }
}

export function writeToSession(sessionId: string, data: string): void {
    void writeTerminalSession(sessionId, data).catch(() => {})
}

export function resizeSession(sessionId: string, rows: number, cols: number): void {
    void resizeTerminalSession(sessionId, rows, cols).catch(() => {})
}

export function applyOscTitle(sessionId: string, title: string): void {
    store().applyOscTitle(sessionId, title)
}

function markSessionExited(sessionId: string): void {
    v2Store.setState((s) => {
        const ui = { ...s.ui }
        let changed = false
        for (const pid of Object.keys(ui)) {
            const p = ui[pid]
            const tabHit = p.tabs.some((t) => t.sessionId === sessionId)
            const winHit = p.wins.some((w) => w.sessionId === sessionId)
            if (!tabHit && !winHit) continue
            changed = true
            ui[pid] = {
                ...p,
                tabs: tabHit ? p.tabs.map((t) => (t.sessionId === sessionId ? { ...t, exited: true } : t)) : p.tabs,
                wins: winHit ? p.wins.map((w) => (w.sessionId === sessionId ? { ...w, status: "exited" } : w)) : p.wins,
            }
        }
        return changed ? { ui } : {}
    })
}

async function connectAndListSftp(pid: string, hostId: string, remoteDir: string): Promise<boolean> {
    const root = rootOf(pid)
    if (!root) return false
    const snapshot = await connectRemoteHost(hostId)
    if (snapshot.status !== "Connected") {
        throw new Error(snapshot.message ?? "connection " + snapshot.status.toLowerCase())
    }
    if (store().ui[pid]?.sftp.hostId !== hostId) return false
    patchProject(pid, (p) => {
        if (p.sftp.hostId !== hostId) return
        p.sshHosts = p.sshHosts.map((h) => (h.hostId === hostId ? { ...h, live: true } : h))
    })
    const [localEntries, remoteEntries] = await Promise.all([
        scanWorkspace(root),
        listSftpDirectory(hostId, remoteDir),
    ])
    let applied = false
    patchProject(pid, (p) => {
        if (p.sftp.hostId !== hostId) return
        p.sftp = {
            ...p.sftp,
            localPath: root,
            localRel: "",
            local: mapLocalEntries(localEntries),
            remotePath: remoteDir,
            remote: mapRemoteEntries(remoteEntries),
            connected: true,
            loading: false,
        }
        applied = true
    })
    return applied
}

// ---------------------------------------------------------------- delegate

let nextTabId = 5000
function tabId(): number {
    return ++nextTabId
}

async function loadDiffTab(pid: string, root: string, id: number, path: string, staged: boolean): Promise<void> {
    try {
        const diff = await getGitDiffHunks(root, path, staged)
        patchTab(pid, id, (t) => ({
            ...t,
            loading: false,
            diff: mapDiffHunks(diff),
            diffHunks: diff,
            diffStaged: staged,
        }))
    } catch (error) {
        patchTab(pid, id, (t) => ({ ...t, loading: false, diff: [], diffHunks: undefined }))
        store().showToast("Diff: " + errMsg(error))
    }
}

async function loadCommitFileDiffTab(pid: string, root: string, id: number, hash: string, path: string): Promise<void> {
    try {
        const diff = await getGitCommitFileWorktreeDiff(root, hash, path)
        patchTab(pid, id, (t) => ({
            ...t,
            loading: false,
            diff: mapDiffHunks(diff),
            diffHunks: diff,
            diffCommit: hash,
            diffCompare: "worktree",
        }))
    } catch (error) {
        patchTab(pid, id, (t) => ({ ...t, loading: false, diff: [], diffHunks: undefined }))
        store().showToast("Commit diff: " + errMsg(error))
    }
}

function openDiffTabs(pid: string, path: string, stages: boolean[]): Tab[] {
    const wanted = new Set(stages)
    return store().ui[pid]?.tabs.filter((t) =>
        t.type === "diff" &&
        t.path === path &&
        t.diffCommit === undefined &&
        t.diffStaged !== undefined &&
        wanted.has(t.diffStaged),
    ) ?? []
}

function setOpenDiffTabsLoading(pid: string, path: string, stages: boolean[], loading: boolean): void {
    const ids = new Set(openDiffTabs(pid, path, stages).map((t) => t.id))
    if (!ids.size) return
    patchProject(pid, (p) => {
        p.tabs = p.tabs.map((t) => (ids.has(t.id) ? { ...t, loading } : t))
    })
}

async function refreshOpenDiffTabs(pid: string, root: string, path: string, stages: boolean[]): Promise<void> {
    const tabs = openDiffTabs(pid, path, stages)
    if (!tabs.length) return
    setOpenDiffTabsLoading(pid, path, stages, true)
    await Promise.all(tabs.map((tab) => loadDiffTab(pid, root, tab.id, path, tab.diffStaged === true)))
}

async function refreshBranches(pid: string, root: string): Promise<void> {
    const branches = await getGitBranchesFull(root)
    patchProject(pid, (q) => {
        q.git = { ...q.git, branchesFull: branches }
    })
}

async function refreshStashes(pid: string, root: string): Promise<void> {
    const stashes = await getGitStashList(root)
    patchProject(pid, (q) => {
        q.git = { ...q.git, stashes }
    })
}

const delegate = {
    selectProject(pid: string) {
        void switchWorkspace(pid).catch(() => {})
        void ensureActiveProjectData(pid)
        logDiag("info", "workspace", "selected " + pid)
    },

    addProject() {
        void (async () => {
            try {
                const picked = await pickWorkspaceFolder()
                if (!picked) return
                await openWorkspacePath(picked)
                await loadRegistry(true)
                const pid = store().active
                void ensureActiveProjectData(pid)
                store().showToast("Opened folder " + picked + " — state of other projects is kept")
            } catch (error) {
                store().showToast("Open folder: " + errMsg(error))
            }
        })()
    },

    closeProject(pid: string) {
        void (async () => {
            try {
                await removeWorkspace(pid)
                v2Store.setState((s) => {
                    const order = s.order.filter((x) => x !== pid)
                    return { order, active: s.active === pid ? order[0] ?? "" : s.active }
                })
                store().showToast("Closed project folder")
                logDiag("info", "workspace", "closed " + pid)
            } catch (error) {
                store().showToast("Close folder: " + errMsg(error))
            }
        })()
    },

    selectFn(fn: FnMode) {
        const pid = store().active
        if (fn === "git") void ensureGit(pid)
        if (fn === "db" || fn === "ssh") void ensureConnections(pid)
        if (fn === "files") void ensureTree(pid)
        if (fn === "lang") void ensureLang(pid)
    },

    toggleDir(displayPath: string) {
        const pid = store().active
        const root = rootOf(pid)
        const p = store().ui[pid]
        if (!root || !p?.open[displayPath]) return
        const node = findNode(p.treeData, displayPath)
        if (!node?.d || node.loaded || !node.p) return
        void (async () => {
            try {
                const entries = await scanDirectory(root, node.p as string)
                patchProject(pid, (q) => {
                    q.treeData = setNodeChildren(q.treeData, displayPath, mapEntriesToNodes(entries))
                })
            } catch (error) {
                store().showToast("Explorer: " + errMsg(error))
            }
        })()
    },

    openFile(displayPath: string, reveal?: { line: number; col: number }) {
        const pid = store().active
        const root = rootOf(pid)
        const p = store().ui[pid]
        if (!root || !p) return
        const existing = p.tabs.find((t) => t.type === "file" && t.path === displayPath)
        if (existing) {
            patchProject(pid, (q) => {
                q.activeTab = existing.id
                if (reveal) {
                    q.tabs = q.tabs.map((t) => (t.id === existing.id ? { ...t, reveal } : t))
                }
            })
            return
        }
        const node = findNode(p.treeData, displayPath)
        const realPath = node?.p ?? displayPath
        const name = displayPath.split("/").pop() ?? displayPath
        const id = tabId()
        patchProject(pid, (q) => {
            q.tabs = [
                ...q.tabs,
                {
                    id,
                    type: "file",
                    name,
                    path: displayPath,
                    realPath,
                    loading: true,
                    contentLang: langForPath(name),
                    ...(reveal ? { reveal } : {}),
                },
            ]
            q.activeTab = id
        })
        void (async () => {
            try {
                const read = await readTextFile(root, realPath)
                const editor = editorContentFromDisk(read.content)
                patchProject(pid, (q) => {
                    q.tabs = q.tabs.map((t) =>
                        t.id === id
                            ? {
                                  ...t,
                                  loading: false,
                                  content: editor.content,
                                  tooLarge: read.too_large,
                                  version: read.version,
                                  savedContent: editor.content,
                                  lineEnding: editor.lineEnding,
                                  savedLineEnding: editor.lineEnding,
                              }
                            : t,
                    )
                })
                if (typeof editor.content === "string" && isLspSupportedDocumentPath(displayPath)) {
                    void openLspDocument(pid, displayPath, editor.content).catch(() => {})
                }
                logDiag("info", "editor", "opened " + displayPath)
            } catch (error) {
                patchProject(pid, (q) => {
                    q.tabs = q.tabs.map((t) => (t.id === id ? { ...t, loading: false, content: null } : t))
                })
                store().showToast("Open file: " + errMsg(error))
                logDiag("error", "editor", "open failed " + errMsg(error))
            }
        })()
    },

    newTerm() {
        const pid = store().active
        void (async () => {
            const n = (store().ui[pid]?.tabs.filter((t) => t.type === "cmd").length ?? 0) + 1
            const spawned = await spawnSession(pid, "zsh · " + n)
            if (!spawned) return
            patchProject(pid, (q) => {
                const nt: Tab = { id: tabId(), type: "cmd", title: "zsh · " + n, sessionId: spawned.sessionId }
                q.tabs = [...q.tabs, nt]
                q.activeTab = nt.id
                if (q.fn === "agent") q.fn = "files"
            })
        })()
    },

    closeTab(tab: Tab) {
        const pid = store().active
        const pending = backupTimers.get(tab.id)
        if (pending) {
            clearTimeout(pending)
            backupTimers.delete(tab.id)
        }
        if (tab.type === "file" && tab.dirty && typeof tab.content === "string" && tab.path) {
            const pid = store().active
            const root = rootOf(pid)
            if (root) {
                void saveUnsavedBackup({
                    workspaceRoot: root,
                    workspaceId: pid,
                    path: tab.path,
                    content: normalizeEditorContent(tab.content),
                    lineEnding: lineEndingForTab(tab),
                    version: tab.version ?? null,
                }).catch(() => {})
            }
        }
        if (tab.type === "cmd" && tab.sessionId && !tab.exited) {
            void closeTerminalSession(tab.sessionId).catch(() => {})
        }
        if (tab.type === "db") lastDbResults.delete(tab.id)
        closeLspDocument(pid, tab)
    },

    azNew() {
        const pid = store().active
        void (async () => {
            const n = (store().ui[pid]?.wins.length ?? 0) + 1
            const spawned = await spawnSession(pid, "agent session " + n)
            if (!spawned) return
            patchProject(pid, (q) => {
                const win = {
                    id: tabId(),
                    title: "zsh · session " + n,
                    status: "shell",
                    lines: [],
                    buf: "",
                    min: false,
                    max: false,
                    sessionId: spawned.sessionId,
                }
                q.wins = [...q.wins, win]
                q.fn = "agent"
                q.azActive = win.id
            })
        })()
    },

    azClose(sessionId: string) {
        void closeTerminalSession(sessionId).catch(() => {})
        logDiag("info", "terminal", "killed session")
    },

    doCommit(message: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await commitGit(root, message, false, false)
                patchProject(pid, (q) => {
                    q.commitMsg = ""
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                store().showToast("✓ committed — " + message)
                logDiag("info", "git", "commit " + message)
            } catch (error) {
                store().showToast("Commit: " + errMsg(error))
            }
        })()
    },

    openShell(host: SshHost) {
        const pid = store().active
        void (async () => {
            const spawned = await spawnSession(pid, host.label)
            if (!spawned) return
            patchProject(pid, (q) => {
                const nt: Tab = { id: tabId(), type: "cmd", title: host.label, sessionId: spawned.sessionId }
                q.tabs = [...q.tabs, nt]
                q.activeTab = nt.id
                if (q.fn === "agent") q.fn = "ssh"
            })
            writeToSession(spawned.sessionId, "ssh " + host.label + "\r")
        })()
    },

    addNode(dirPath: string, kind: "file" | "dir") {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        const name = promptForNodeName(kind)
        if (name === null) return
        const siblings = dirPath
            ? findNode(store().ui[pid].treeData, dirPath)?.d ?? []
            : store().ui[pid].treeData
        if (siblings.find((n) => n.n === name)) {
            store().showToast("Name already exists: " + name)
            return
        }
        const rel = dirPath ? dirPath + "/" + name : name
        void (async () => {
            try {
                if (kind === "dir") await createDirectory(root, rel)
                else await createTextFile(root, rel)
                await refreshDir(pid, dirPath)
                scheduleGitReload(pid)
                store().showToast("Created " + (kind === "dir" ? "folder " : "file ") + rel)
                if (kind === "file") delegate.openFile(rel)
            } catch (error) {
                store().showToast("New " + (kind === "dir" ? "folder" : "file") + ": " + errMsg(error))
            }
        })()
    },

    deleteNode(displayPath: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        const node = findNode(store().ui[pid].treeData, displayPath)
        const target = node?.p ?? displayPath
        store().openConfirm({
            title: "Delete " + displayPath,
            body: "Delete " + displayPath + " from this workspace? This cannot be undone from Yuuzu-IDE.",
            label: "Delete",
            danger: true,
            action: () => {
                void (async () => {
                    try {
                        await deletePath(root, target)
                        const parent = displayPath.includes("/")
                            ? displayPath.slice(0, displayPath.lastIndexOf("/"))
                            : ""
                        await refreshDir(pid, parent)
                        scheduleGitReload(pid)
                        const goneIds = (store().ui[pid]?.tabs ?? [])
                            .filter((t) => t.path && (t.path === displayPath || t.path.startsWith(displayPath + "/")))
                            .map((t) => t.id)
                        patchProject(pid, (q) => {
                            q.tabs = q.tabs.filter(
                                (t) => !(t.path && (t.path === displayPath || t.path.startsWith(displayPath + "/"))),
                            )
                            if (!q.tabs.find((t) => t.id === q.activeTab)) q.activeTab = q.tabs[0]?.id ?? null
                            if (q.split && !q.tabs.find((t) => t.id === q.split)) q.split = null
                        })
                        for (const id of goneIds) evictHlCache(id)
                        store().showToast("Deleted " + displayPath)
                    } catch (error) {
                        store().showToast("Delete: " + errMsg(error))
                    }
                })()
            },
        })
    },

    selectCommit(hash: string) {
        const pid = store().active
        void selectCommitInProject(pid, hash)
    },

    copyCommitHash(hash: string) {
        void writeClipboardText(hash)
            .then(() => store().showToast("Copied " + hash))
            .catch((error) => store().showToast("Copy hash failed: " + errMsg(error)))
    },

    toggleDbConn(idx: number) {
        const pid = store().active
        const p = store().ui[pid]
        const conn = p?.dbConns[idx]
        if (!p?.dbOpen[idx] || !conn || conn.inspected || !conn.profileId) return
        void inspectDb(pid, idx)
    },

    dbRefresh(idx: number) {
        const pid = store().active
        const conn = store().ui[pid]?.dbConns[idx]
        if (!conn?.profileId) return
        store().showToast("Refreshing " + conn.name + "…")
        void inspectDb(pid, idx)
    },

    async dbTestConn(input: DatabaseProfileInput): Promise<ConnectionTestResult> {
        return testDatabaseConnection(input)
    },

    async dbSaveConn(input: DatabaseProfileInput): Promise<void> {
        const pid = store().active
        await saveDatabaseProfile(input)
        await reloadDatabaseProfiles(pid)
        store().showToast("Saved " + input.name)
    },

    async dbDeleteConn(profileId: string): Promise<void> {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        await deleteDatabaseProfile(root, profileId)
        await reloadDatabaseProfiles(pid)
        store().showToast("Deleted database connection")
    },

    // ------------------------------------------------------------ editor

    saveFile(tabId: number, force = false) {
        const pid = store().active
        const root = rootOf(pid)
        const tab = tabIn(pid, tabId)
        if (!root || !tab || tab.type !== "file" || typeof tab.content !== "string" || !tab.realPath) return
        if (tab.saving) return
        const content = normalizeEditorContent(tab.content)
        const lineEnding = lineEndingForTab(tab)
        patchTab(pid, tabId, (t) => ({ ...t, saving: true }))
        void (async () => {
            try {
                const result = await writeTextFile(root, tab.realPath as string, serializeEditorContent(content, lineEnding), force ? null : (tab.version ?? null))
                const afterWrite = tabIn(pid, tabId)
                if (afterWrite && afterWrite.type === "file" && typeof afterWrite.content === "string" && normalizeEditorContent(afterWrite.content) === content) {
                    const pending = backupTimers.get(tabId)
                    if (pending) {
                        clearTimeout(pending)
                        backupTimers.delete(tabId)
                    }
                }
                patchTab(pid, tabId, (t) => {
                    const currentContent = typeof t.content === "string" ? normalizeEditorContent(t.content) : t.content
                    const next = {
                        ...t,
                        content: currentContent,
                        saving: false,
                        version: result.version,
                        savedContent: content,
                        savedLineEnding: lineEnding,
                        externalChange: false,
                    }
                    return { ...next, dirty: tabIsDirty(next) }
                })
                const current = tabIn(pid, tabId)
                if (
                    current &&
                    current.type === "file" &&
                    current.path === tab.path &&
                    typeof current.content === "string" &&
                    normalizeEditorContent(current.content) === content &&
                    current.path &&
                    isLspSupportedDocumentPath(current.path)
                ) {
                    void openLspDocument(pid, current.path, content).then(() => {
                        scheduleDocDiagPoll(pid, tabId, current.path as string, 200)
                    }).catch(() => {})
                }
                store().showToast("✓ saved " + (tab.path ?? tab.realPath))
                scheduleGitReload(pid)
                logDiag("info", "editor", "saved " + (tab.path ?? tab.realPath))
            } catch (error) {
                patchTab(pid, tabId, (t) => ({ ...t, saving: false }))
                store().showToast("Save: " + errMsg(error))
                logDiag("error", "editor", "save failed " + errMsg(error))
            }
        })()
    },

    reloadFile(tabId: number) {
        void readAndApply(store().active, tabId, true)
    },

    onExternalFileChange(workspaceId: string, eventWorkspaceRoot: string, eventPath: string, eventVersion: FileVersion | null) {
        const p = store().ui[workspaceId]
        if (!p) return
        const ids = externallyChangedTabIds(p.tabs, eventPath, eventVersion)
        for (const id of ids) {
            const tab = p.tabs.find((t) => t.id === id)
            if (!tab) continue
            if (eventVersion != null && !tab.dirty && !tab.saving) {
                void readAndApply(workspaceId, id, false)
            } else {
                patchTab(workspaceId, id, (t) => ({ ...t, externalChange: true }))
            }
        }
        const target = treeRefreshTarget(
            p.treeData,
            normalizeFsPath(eventWorkspaceRoot),
            normalizeFsPath(eventPath),
            eventVersion != null
        )
        if (target !== null) scheduleTreeSync(workspaceId, target)
        if (shouldRefreshGitAfterFileEvent({
            activeWorkspaceId: store().active,
            eventWorkspaceId: workspaceId,
            path: relativeWatchPath(eventWorkspaceRoot, eventPath),
        })) {
            scheduleGitReload(workspaceId)
        }
    },

    // ------------------------------------------------------------ database

    dbOpenTable(tabId: number) {
        delegate.dbRun(tabId)
    },

    dbRun(tabId: number, confirmation?: string) {
        const pid = store().active
        const tab = tabIn(pid, tabId)
        if (!tab?.profileId || !tab.sql?.trim()) return
        const sql = tab.sql
        patchTab(pid, tabId, (t) => ({
            ...t,
            grid: { cols: t.grid?.cols ?? [], rows: t.grid?.rows ?? [], ms: 0, truncated: false, affected: null, running: true, kind: t.grid?.kind },
        }))
        void (async () => {
            try {
                const result = await executeDatabaseQuery({
                    profile_id: tab.profileId as string,
                    sql,
                    limit: settingLimit(store().stVals),
                    confirmation,
                })
                lastDbResults.set(tabId, result)
                patchTab(pid, tabId, (t) => ({ ...t, grid: mapQueryResult(result) }))
            } catch (error) {
                const message = errMsg(error)
                const needed = confirmationFromError(message)
                if (needed) {
                    patchTab(pid, tabId, (t) => ({ ...t, grid: t.grid ? { ...t.grid, running: false } : undefined }))
                    store().openConfirm({
                        title: "Confirm SQL — " + needed,
                        body: "The backend classified this statement as " +
                            (needed.includes("DESTRUCTIVE") ? "destructive" : "mutating") +
                            ". Run it against " + (tab.conn ?? "this database") + "?",
                        label: "Run " + needed,
                        danger: true,
                        action: () => delegate.dbRun(tabId, needed),
                    })
                    return
                }
                patchTab(pid, tabId, (t) => ({
                    ...t,
                    grid: { cols: [], rows: [], ms: 0, truncated: false, affected: null, error: message },
                }))
            }
        })()
    },

    dbExport(tabId: number) {
        const pid = store().active
        const root = rootOf(pid)
        const result = lastDbResults.get(tabId)
        if (!root) return
        if (!result) {
            store().showToast("Run a query first, then export its result")
            return
        }
        void (async () => {
            try {
                const exported = await exportDatabaseQueryResult(root, result)
                store().showToast("Exported result to " + exported.path)
            } catch (error) {
                store().showToast("Export: " + errMsg(error))
            }
        })()
    },

    dbHistory(tabId: number) {
        const pid = store().active
        const tab = tabIn(pid, tabId)
        if (!tab?.profileId) return
        patchTab(pid, tabId, (t) => ({ ...t, historyLoading: true }))
        void (async () => {
            try {
                const history = await listDatabaseQueryHistory(tab.profileId as string)
                patchTab(pid, tabId, (t) => ({
                    ...t,
                    history: mapDbHistory(history),
                    historyLoading: false,
                }))
            } catch (error) {
                patchTab(pid, tabId, (t) => ({ ...t, historyLoading: false }))
                store().showToast("History: " + errMsg(error))
            }
        })()
    },

    // ------------------------------------------------------------ sftp

    sftpOpen(host: SshHost) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root || !host.hostId) {
            store().showToast("SFTP needs a saved SSH host profile")
            return
        }
        const hostId = host.hostId
        const remoteDir = host.remotePath || "/"
        patchProject(pid, (p) => {
            p.sftp = {
                host: host.label,
                hostId,
                localPath: root,
                localRel: "",
                remotePath: remoteDir,
                local: [],
                remote: [],
                sel: null,
                clip: null,
                focus: "local",
                connected: false,
                loading: true,
            }
        })
        void (async () => {
            try {
                await connectAndListSftp(pid, hostId, remoteDir)
            } catch (error) {
                patchProject(pid, (p) => {
                    if (p.sftp.hostId !== hostId) return
                    p.sftp = { ...p.sftp, loading: false, connected: false }
                })
                if (store().ui[pid]?.sftp.hostId === hostId) {
                    store().showToast("SFTP: " + errMsg(error))
                }
            }
        })()
    },

    sftpDisconnect() {
        const pid = store().active
        const sf = store().ui[pid]?.sftp
        if (!sf?.hostId) return
        const hostId = sf.hostId
        patchProject(pid, (p) => {
            p.sftp = { ...p.sftp, loading: true }
        })
        void (async () => {
            try {
                const snapshot = await disconnectRemoteHost(hostId)
                if (snapshot.status !== "Disconnected") {
                    throw new Error(snapshot.message ?? "connection " + snapshot.status.toLowerCase())
                }
                patchProject(pid, (p) => {
                    if (p.sftp.hostId !== hostId) return
                    p.sftp = { ...p.sftp, connected: false, loading: false }
                    p.sshHosts = p.sshHosts.map((h) => (h.hostId === hostId ? { ...h, live: false } : h))
                })
                if (store().ui[pid]?.sftp.hostId === hostId) {
                    store().showToast("Disconnected " + (sf.host ?? "SFTP"))
                }
            } catch (error) {
                patchProject(pid, (p) => {
                    if (p.sftp.hostId !== hostId) return
                    p.sftp = { ...p.sftp, loading: false }
                })
                if (store().ui[pid]?.sftp.hostId === hostId) {
                    store().showToast("Disconnect: " + errMsg(error))
                }
            }
        })()
    },

    sftpReconnect() {
        const pid = store().active
        const sf = store().ui[pid]?.sftp
        if (!sf?.hostId) return
        const hostId = sf.hostId
        const remoteDir = sf.remotePath || "/"
        patchProject(pid, (p) => {
            p.sftp = { ...p.sftp, loading: true }
        })
        void (async () => {
            try {
                const applied = await connectAndListSftp(pid, hostId, remoteDir)
                if (applied) store().showToast("Reconnected " + (sf.host ?? "SFTP"))
            } catch (error) {
                patchProject(pid, (p) => {
                    if (p.sftp.hostId !== hostId) return
                    p.sftp = { ...p.sftp, loading: false, connected: false }
                })
                if (store().ui[pid]?.sftp.hostId === hostId) {
                    store().showToast("Reconnect: " + errMsg(error))
                }
            }
        })()
    },

    sftpRunCommand(command: string) {
        const pid = store().active
        const sf = store().ui[pid]?.sftp
        const trimmed = command.trim()
        if (!sf?.hostId || !trimmed) return
        const hostId = sf.hostId
        void (async () => {
            try {
                const result = await runRemoteCommand(hostId, trimmed)
                if (store().ui[pid]?.sftp.hostId === hostId) {
                    store().showToast(remoteCommandToast(result.command, result.exit_code, result.stdout, result.stderr))
                }
            } catch (error) {
                if (store().ui[pid]?.sftp.hostId === hostId) {
                    store().showToast("Remote command: " + errMsg(error))
                }
            }
        })()
    },

    sftpEnter(pane: SftpPane, idx: number) {
        const pid = store().active
        const root = rootOf(pid)
        const sf = store().ui[pid]?.sftp
        if (!root || !sf) return
        const hostId = sf.hostId
        void (async () => {
            try {
                if (pane === "remote") {
                    if (!hostId) return
                    const target = idx < 0
                        ? parentPath(sf.remotePath)
                        : sf.remote[idx]?.kind === "dir" ? sf.remote[idx].p : null
                    if (!target) return
                    const entries = await listSftpDirectory(hostId, target)
                    patchProject(pid, (p) => {
                        if (p.sftp.hostId !== hostId) return
                        p.sftp = { ...p.sftp, remotePath: target, remote: mapRemoteEntries(entries), sel: null }
                    })
                    return
                }
                let target: string | null = null
                let rel = sf.localRel ?? ""
                if (idx < 0) {
                    if (!rel) return
                    rel = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ""
                    target = rel ? root + "/" + rel : root
                } else {
                    const entry = sf.local[idx]
                    if (entry?.kind !== "dir" || !entry.p) return
                    target = entry.p
                    const dirName = entry.name.replace(/\/$/, "")
                    rel = rel ? rel + "/" + dirName : dirName
                }
                const entries = await scanDirectory(root, target)
                patchProject(pid, (p) => {
                    if (hostId && p.sftp.hostId !== hostId) return
                    p.sftp = { ...p.sftp, localPath: target as string, localRel: rel, local: mapLocalEntries(entries), sel: null }
                })
            } catch (error) {
                if (!hostId || store().ui[pid]?.sftp.hostId === hostId) {
                    store().showToast("SFTP: " + errMsg(error))
                }
            }
        })()
    },

    sftpTransfer(from: SftpPane, idx: number) {
        const pid = store().active
        const root = rootOf(pid)
        const sf = store().ui[pid]?.sftp
        const file = sf?.[from]?.[idx]
        if (!root || !sf?.hostId || !sf.connected || !file) {
            store().showToast("Connect SFTP first — open a host from the SSH panel")
            return
        }
        if (file.kind !== "file") {
            store().showToast("Only files can be transferred for now")
            return
        }
        const hostId = sf.hostId
        void (async () => {
            try {
                if (from === "local") {
                    const rel = (file.p as string).startsWith(root + "/")
                        ? (file.p as string).slice(root.length + 1)
                        : file.name
                    const remoteTarget = (sf.remotePath === "/" ? "" : sf.remotePath) + "/" + file.name
                    await uploadSftpFile({
                        workspaceRoot: root,
                        profileId: hostId,
                        localRelativePath: rel,
                        remotePath: remoteTarget,
                    })
                    const entries = await listSftpDirectory(hostId, sf.remotePath)
                    let applied = false
                    patchProject(pid, (p) => {
                        if (p.sftp.hostId !== hostId) return
                        applied = true
                        p.sftp = {
                            ...p.sftp,
                            remote: mapRemoteEntries(entries).map((f) =>
                                f.name === file.name ? { ...f, isNew: true } : f,
                            ),
                            focus: "remote",
                        }
                    })
                    if (applied) store().showToast(file.name + " → " + sf.remotePath + " · uploaded via SFTP ✓")
                    return
                }
                const localRel = (sf.localRel ? sf.localRel + "/" : "") + file.name
                await downloadSftpFile({
                    workspaceRoot: root,
                    profileId: hostId,
                    remotePath: file.p as string,
                    localRelativePath: localRel,
                })
                const entries = await scanDirectory(root, sf.localPath)
                let applied = false
                patchProject(pid, (p) => {
                    if (p.sftp.hostId !== hostId) return
                    applied = true
                    p.sftp = {
                        ...p.sftp,
                        local: mapLocalEntries(entries).map((f) =>
                            f.name === file.name ? { ...f, isNew: true } : f,
                        ),
                        focus: "local",
                    }
                })
                if (applied) store().showToast(file.name + " → " + (sf.localRel || "workspace root") + " · downloaded via SFTP ✓")
            } catch (error) {
                if (store().ui[pid]?.sftp.hostId === hostId) {
                    store().showToast("SFTP transfer: " + errMsg(error))
                }
            }
        })()
    },

    sftpDelete(pane: SftpPane, idx: number) {
        const pid = store().active
        const root = rootOf(pid)
        const sf = store().ui[pid]?.sftp
        const file = sf?.[pane]?.[idx]
        if (!root || !sf || !file) return
        if (pane === "remote") {
            store().showToast("Remote delete is not supported yet")
            return
        }
        void (async () => {
            try {
                const rel = (file.p as string).startsWith(root + "/")
                    ? (file.p as string).slice(root.length + 1)
                    : file.name
                await deletePath(root, rel)
                const entries = await scanDirectory(root, sf.localPath)
                patchProject(pid, (p) => {
                    p.sftp = { ...p.sftp, local: mapLocalEntries(entries), sel: null }
                })
                store().showToast("Deleted " + file.name)
            } catch (error) {
                store().showToast("Delete: " + errMsg(error))
            }
        })()
    },

    // ------------------------------------------------------------ git ops

    gitCheckout(fullHash: string, short: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await checkoutGitBranch(root, fullHash, "CHECKOUT " + fullHash)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                store().showToast("Checked out " + short + " (detached HEAD)")
            } catch (error) {
                store().showToast("Checkout: " + errMsg(error))
            }
        })()
    },

    gitCherryPick(fullHash: string, short: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await cherryPickGit(root, fullHash)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                store().showToast("✓ cherry-picked " + short)
            } catch (error) {
                store().showToast("Cherry-pick: " + errMsg(error))
            }
        })()
    },

    gitRevert(fullHash: string, short: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await revertGitCommit(root, fullHash, "REVERT " + short)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                store().showToast("✓ created revert of " + short)
            } catch (error) {
                store().showToast("Revert: " + errMsg(error))
            }
        })()
    },

    gitResetHard(token: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await resetGitHard(root, token)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                store().showToast("Reset working tree")
                logDiag("warn", "git", "reset hard")
            } catch (error) {
                store().showToast("Reset hard: " + errMsg(error))
            }
        })()
    },

    gitResetTo(fullHash: string, short: string, mode: GitResetMode, token: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await resetGitTo(root, fullHash, mode, token)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                store().showToast("Reset to " + short + " (" + mode + ")")
                logDiag("warn", "git", "reset " + mode + " " + short)
            } catch (error) {
                store().showToast("Reset: " + errMsg(error))
            }
        })()
    },

    gitRebaseOnto(target: string, token: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await rebaseGitOnto(root, target, token)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                store().showToast("Rebased onto " + target)
                logDiag("warn", "git", "rebase " + target)
            } catch (error) {
                store().showToast("Rebase: " + errMsg(error))
            }
        })()
    },

    gitOpenConflict(path: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        let id = 0
        patchProject(pid, (q) => {
            const found = q.tabs.find((t) => t.type === "conflict" && t.path === path)
            if (found) {
                id = found.id
                q.tabs = q.tabs.map((t) => (t.id === found.id ? { ...t, loading: true, conflict: undefined } : t))
                q.activeTab = found.id
                return
            }
            id = tabId()
            q.tabs = [...q.tabs, { id, type: "conflict", title: "conflict · " + path.split("/").pop(), path, loading: true }]
            q.activeTab = id
        })
        void (async () => {
            try {
                const conflict = await getGitConflictFile(root, path)
                patchTab(pid, id, (t) => ({ ...t, loading: false, conflict }))
            } catch (error) {
                patchTab(pid, id, (t) => ({ ...t, loading: false }))
                store().showToast("Conflict: " + errMsg(error))
            }
        })()
    },

    gitAcceptConflictSide(path: string, side: "ours" | "theirs", token: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await acceptGitConflictSide(root, path, side, token)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                    q.tabs = q.tabs.filter((t) => !(t.type === "conflict" && t.path === path))
                    if (q.activeTab && !q.tabs.some((t) => t.id === q.activeTab)) q.activeTab = q.tabs[0]?.id ?? null
                })
                await reloadGit(pid)
                patchProject(pid, (q) => {
                    q.git = { ...q.git, conflictChoices: removeConflictChoicesForPath(q.git.conflictChoices, path) }
                })
                store().showToast("Accepted " + side + " · " + path)
                logDiag("warn", "git", "accept " + side + " " + path)
            } catch (error) {
                store().showToast("Accept conflict: " + errMsg(error))
            }
        })()
    },

    gitMarkResolved(path: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await markGitResolved(root, path)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                    q.tabs = q.tabs.filter((t) => !(t.type === "conflict" && t.path === path))
                    if (q.activeTab && !q.tabs.some((t) => t.id === q.activeTab)) q.activeTab = q.tabs[0]?.id ?? null
                })
                await reloadGit(pid)
                patchProject(pid, (q) => {
                    q.git = { ...q.git, conflictChoices: removeConflictChoicesForPath(q.git.conflictChoices, path) }
                })
                store().showToast("Marked resolved · " + path)
                logDiag("info", "git", "resolved " + path)
            } catch (error) {
                store().showToast("Mark resolved: " + errMsg(error))
            }
        })()
    },

    gitLoadBlame(tabId: number, path: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                const blame = await getGitBlameFile(root, path)
                patchTab(pid, tabId, (t) =>
                    t.path === path && t.blameLoading ? { ...t, blame, blameLoading: false } : t,
                )
            } catch (error) {
                patchTab(pid, tabId, (t) =>
                    t.path === path && t.blameLoading ? { ...t, blameLoading: false } : t,
                )
                store().showToast("Blame: " + errMsg(error))
            }
        })()
    },

    gitFileHistory(path: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                const [status, page] = await Promise.all([
                    getGitStatus(root).catch(() => null),
                    getGitFileHistory(root, path, 120),
                ])
                const now = Math.floor(Date.now() / 1000)
                const history = mapGitLog(page.rows, status, now)
                patchProject(pid, (q) => {
                    const found = q.tabs.find((t) => t.type === "git")
                    if (found) q.activeTab = found.id
                    else {
                        const id = tabId()
                        q.tabs = [...q.tabs, { id, type: "git", title: "git graph" }]
                        q.activeTab = id
                    }
                    q.fn = "git"
                    q.git = {
                        ...q.git,
                        branch: history.branch,
                        upstream: history.upstream,
                        ahead: history.ahead,
                        behind: history.behind,
                        commits: history.commits,
                    }
                    q.gitFilter = "all"
                    q.gitSel = 0
                    q.gitDetail = null
                    q.gitLoaded = true
                })
                store().showToast("History for " + path)
            } catch (error) {
                store().showToast("File history: " + errMsg(error))
            }
        })()
    },

    gitExportCommit(fullHash: string, short: string, scope: GitExportScope, format: GitExportFormat) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                const dest = await pickWorkspaceFolder()
                if (!dest) return
                const report = await exportGitCommit(root, fullHash, scope, format, dest, false)
                store().showToast("Exported " + short + " · " + report.written_files + " files")
            } catch (error) {
                store().showToast("Export commit: " + errMsg(error))
            }
        })()
    },

    gitSync(op: "push" | "pull" | "fetch") {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                const run = op === "push" ? pushGit : op === "pull" ? pullGit : fetchGit
                const status = await run(root)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                const verb = op === "push" ? "Pushed" : op === "pull" ? "Pulled" : "Fetched"
                store().showToast("✓ " + verb + " — " + status.ahead + "↑ " + status.behind + "↓")
                logDiag("info", "git", op + " ok")
            } catch (error) {
                store().showToast(op + ": " + errMsg(error))
            }
        })()
    },

    gitLoadBranches() {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await refreshBranches(pid, root)
            } catch (error) {
                store().showToast("Branches: " + errMsg(error))
            }
        })()
    },

    gitCreateBranch(name: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await createGitBranch(root, name)
                await refreshBranches(pid, root)
                store().showToast("Created branch " + name)
            } catch (error) {
                store().showToast("Create branch: " + errMsg(error))
            }
        })()
    },

    gitCheckoutBranch(name: string, token: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await checkoutGitBranch(root, name, token)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                    q.branchPopupOpen = false
                })
                await reloadGit(pid)
                await refreshBranches(pid, root)
                store().showToast("Checked out " + name)
            } catch (error) {
                store().showToast("Checkout branch: " + errMsg(error))
            }
        })()
    },

    gitMergeBranch(name: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await mergeGitBranch(root, name)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                await refreshBranches(pid, root)
                store().showToast("Merged " + name)
            } catch (error) {
                store().showToast("Merge branch: " + errMsg(error))
            }
        })()
    },

    gitDeleteBranch(name: string, token: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                const branches = await deleteGitBranch(root, name, token)
                patchProject(pid, (q) => {
                    q.git = { ...q.git, branchesFull: branches }
                })
                store().showToast("Deleted branch " + name)
            } catch (error) {
                store().showToast("Delete branch: " + errMsg(error))
            }
        })()
    },

    gitRenameBranch(from: string, to: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                const branches = await renameGitBranch(root, from, to)
                patchProject(pid, (q) => {
                    q.git = { ...q.git, branchesFull: branches }
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                store().showToast("Renamed branch " + from + " → " + to)
            } catch (error) {
                store().showToast("Rename branch: " + errMsg(error))
            }
        })()
    },

    gitLoadStashes() {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await refreshStashes(pid, root)
            } catch (error) {
                store().showToast("Stashes: " + errMsg(error))
            }
        })()
    },

    gitStash(message: string, includeUntracked: boolean) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await stashGit(root, message, includeUntracked)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                await refreshStashes(pid, root)
                store().showToast("Stashed changes")
            } catch (error) {
                store().showToast("Stash: " + errMsg(error))
            }
        })()
    },

    gitStashApply(index: number) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await applyGitStash(root, index)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                store().showToast("Applied stash@{" + index + "}")
            } catch (error) {
                store().showToast("Apply stash: " + errMsg(error))
            }
        })()
    },

    gitStashPop(index: number) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await popGitStash(root, index)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                await refreshStashes(pid, root)
                store().showToast("Popped stash@{" + index + "}")
            } catch (error) {
                store().showToast("Pop stash: " + errMsg(error))
            }
        })()
    },

    gitStashDrop(index: number, token: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await dropGitStash(root, index, token)
                await refreshStashes(pid, root)
                store().showToast("Dropped stash@{" + index + "}")
            } catch (error) {
                store().showToast("Drop stash: " + errMsg(error))
            }
        })()
    },

    gitStashBranch(index: number, name: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await branchFromGitStash(root, index, name)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                    q.stashPanelOpen = false
                })
                await reloadGit(pid)
                await Promise.all([refreshBranches(pid, root), refreshStashes(pid, root)])
                store().showToast("Created branch " + name + " from stash@{" + index + "}")
            } catch (error) {
                store().showToast("Stash branch: " + errMsg(error))
            }
        })()
    },

    gitStage(paths: string[]) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root || !paths.length) return
        void (async () => {
            try {
                await stageGitPaths(root, paths)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                store().showToast("✓ staged " + paths.length + " file" + (paths.length === 1 ? "" : "s"))
            } catch (error) {
                store().showToast("Stage: " + errMsg(error))
            }
        })()
    },

    gitUnstage(paths: string[]) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root || !paths.length) return
        void (async () => {
            try {
                await unstageGitPaths(root, paths)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                store().showToast("✓ unstaged " + paths.length + " file" + (paths.length === 1 ? "" : "s"))
            } catch (error) {
                store().showToast("Unstage: " + errMsg(error))
            }
        })()
    },

    gitDiscard(paths: string[], token: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root || !paths.length) return
        void (async () => {
            try {
                await discardGitPaths(root, paths, token)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                store().showToast("Discarded " + paths.length + " file" + (paths.length === 1 ? "" : "s"))
            } catch (error) {
                store().showToast("Discard: " + errMsg(error))
            }
        })()
    },

    gitStageHunks(path: string, selections: HunkSelection[]) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root || !path || !selections.length) return
        void (async () => {
            setOpenDiffTabsLoading(pid, path, [false, true], true)
            try {
                await stageGitHunks(root, path, selections)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                await refreshOpenDiffTabs(pid, root, path, [false, true])
                store().showToast("✓ staged selected changes")
            } catch (error) {
                setOpenDiffTabsLoading(pid, path, [false, true], false)
                store().showToast("Stage hunk: " + errMsg(error))
            }
        })()
    },

    gitUnstageHunks(path: string, selections: HunkSelection[]) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root || !path || !selections.length) return
        void (async () => {
            setOpenDiffTabsLoading(pid, path, [false, true], true)
            try {
                await unstageGitHunks(root, path, selections)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                await refreshOpenDiffTabs(pid, root, path, [false, true])
                store().showToast("✓ unstaged selected changes")
            } catch (error) {
                setOpenDiffTabsLoading(pid, path, [false, true], false)
                store().showToast("Unstage hunk: " + errMsg(error))
            }
        })()
    },

    gitRevertHunk(path: string, selections: HunkSelection[], token: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root || !path || !selections.length) return
        void (async () => {
            setOpenDiffTabsLoading(pid, path, [false], true)
            try {
                await revertGitHunk(root, path, selections, token)
                patchProject(pid, (q) => {
                    q.gitLoaded = false
                })
                await reloadGit(pid)
                await refreshOpenDiffTabs(pid, root, path, [false])
                store().showToast("Reverted selected changes")
            } catch (error) {
                setOpenDiffTabsLoading(pid, path, [false], false)
                store().showToast("Revert hunk: " + errMsg(error))
            }
        })()
    },

    gitOpenDiff(path: string, staged: boolean) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        const name = path.split("/").pop() ?? path
        const title = (staged ? "staged · " : "diff · ") + name
        const id = tabId()
        let targetId = id
        patchProject(pid, (q) => {
            const existing = q.tabs.find((t) => t.type === "diff" && t.path === path && t.diffStaged === staged)
            if (existing) {
                q.activeTab = existing.id
                targetId = existing.id
                q.tabs = q.tabs.map((t) => (t.id === existing.id ? { ...t, loading: true } : t))
                return
            }
            q.tabs = [...q.tabs, { id, type: "diff", title, path, diffStaged: staged, loading: true }]
            q.activeTab = id
        })
        void loadDiffTab(pid, root, targetId, path, staged)
    },

    gitOpenCommitFileDiff(fullHash: string, _short: string, path: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root || !path) return
        const name = path.split("/").pop() ?? path
        const title = "compare · " + name
        const id = tabId()
        let targetId = id
        patchProject(pid, (q) => {
            const existing = q.tabs.find((t) => t.type === "diff" && t.path === path && t.diffCommit === fullHash && t.diffCompare === "worktree")
            if (existing) {
                q.activeTab = existing.id
                targetId = existing.id
                q.tabs = q.tabs.map((t) => (t.id === existing.id ? { ...t, loading: true } : t))
                return
            }
            q.tabs = [...q.tabs, { id, type: "diff", title, path, diffCommit: fullHash, diffCompare: "worktree", loading: true }]
            q.activeTab = id
        })
        void loadCommitFileDiffTab(pid, root, targetId, fullHash, path)
    },

    // ------------------------------------------------------------ stability

    loadStability() {
        const pid = store().active
        const root = rootOf(pid)
        v2Store.setState((s) => ({ stab: { ...s.stab, loading: true } }))
        void (async () => {
            try {
                const [snap, events, backups] = await Promise.all([
                    metricSnapshot({
                        workspaceCount: store().order.length,
                        activeWorkspaceId: pid || null,
                        docsIndexEntries: 0,
                        fileTreeEntries: fileTreeEntries(pid),
                    }),
                    listDiagnosticEvents({ limit: 50 }),
                    root ? listUnsavedBackups({ workspaceRoot: root, workspaceId: pid }).catch(() => []) : [],
                ])
                v2Store.setState({
                    stab: {
                        metric: mapMetric(snap),
                        events: mapDiagnosticEvents(events),
                        backups: mapBackups(backups),
                        loading: false,
                    },
                })
            } catch (error) {
                v2Store.setState((s) => ({ stab: { ...s.stab, loading: false } }))
                store().showToast("Diagnostics: " + errMsg(error))
            }
        })()
    },

    refreshMetric() {
        const pid = store().active
        void (async () => {
            try {
                const snap = await metricSnapshot({
                    workspaceCount: store().order.length,
                    activeWorkspaceId: pid || null,
                    docsIndexEntries: 0,
                    fileTreeEntries: fileTreeEntries(pid),
                })
                v2Store.setState((s) => ({ stab: { ...s.stab, metric: mapMetric(snap) } }))
            } catch (error) {
                store().showToast("Metrics: " + errMsg(error))
            }
        })()
    },

    restoreBackup(id: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                const backups = await listUnsavedBackups({ workspaceRoot: root, workspaceId: pid })
                const backup = backups.find((item) => item.id === id)
                if (!backup) {
                    store().showToast("Backup not found")
                    return
                }
                const displayPath = backup.path
                const node = findNode(store().ui[pid]?.treeData ?? [], displayPath)
                const realPath = node?.p ?? displayPath
                const name = displayPath.split("/").pop() ?? displayPath
                const existing = store().ui[pid]?.tabs.find((t) => t.type === "file" && t.path === displayPath)
                const disk = await readTextFile(root, realPath).catch(() => null)
                const backupContent = normalizeEditorContent(backup.content)
                const backupLineEnding = savedLineEndingForBackup(backup.line_ending) ?? detectLineEnding(backup.content)
                const savedContent = normalizeEditorContent(disk?.content ?? backup.content)
                const savedLineEnding = disk?.content === undefined || disk?.content === null ? backupLineEnding : detectLineEnding(disk.content)
                patchProject(pid, (q) => {
                    if (existing) {
                        q.tabs = q.tabs.map((t) =>
                            t.id === existing.id
                                ? {
                                      ...t,
                                      content: backupContent,
                                      realPath: t.realPath ?? realPath,
                                      version: backup.version ?? t.version ?? null,
                                      savedContent: typeof t.savedContent === "string" ? normalizeEditorContent(t.savedContent) : savedContent,
                                      lineEnding: backupLineEnding,
                                      savedLineEnding: t.savedLineEnding ?? savedLineEnding,
                                      dirty: true,
                                      loading: false,
                                  }
                                : t,
                        )
                        q.activeTab = existing.id
                        return
                    }
                    const newId = tabId()
                    q.tabs = [
                        ...q.tabs,
                        {
                            id: newId,
                            type: "file",
                            name,
                            path: displayPath,
                            realPath,
                            content: backupContent,
                            version: backup.version ?? null,
                            savedContent,
                            lineEnding: backupLineEnding,
                            savedLineEnding,
                            dirty: true,
                            contentLang: langForPath(name),
                        },
                    ]
                    q.activeTab = newId
                })
                store().showToast("Restored " + displayPath)
                logDiag("info", "recovery", "restored " + displayPath)
            } catch (error) {
                store().showToast("Restore: " + errMsg(error))
            }
        })()
    },

    discardBackup(id: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                await discardUnsavedBackup({ workspaceRoot: root, workspaceId: pid, backupId: id })
                const backups = await listUnsavedBackups({ workspaceRoot: root, workspaceId: pid }).catch(() => [])
                v2Store.setState((s) => ({ stab: { ...s.stab, backups: mapBackups(backups) } }))
                store().showToast("Discarded backup")
                logDiag("info", "recovery", "discarded " + id)
            } catch (error) {
                store().showToast("Discard: " + errMsg(error))
            }
        })()
    },

    backupTab(tabId: number, content: string, lineEnding?: LineEnding) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        const backupContent = normalizeEditorContent(content)
        const pending = backupTimers.get(tabId)
        if (pending) clearTimeout(pending)
        const timer = setTimeout(() => {
            backupTimers.delete(tabId)
            const tab = tabIn(pid, tabId)
            if (!tab || tab.type !== "file" || !tab.path || !tab.dirty) return
            void saveUnsavedBackup({
                workspaceRoot: root,
                workspaceId: pid,
                path: tab.path,
                content: backupContent,
                lineEnding: lineEnding ?? lineEndingForTab(tab),
                version: tab.version ?? null,
            }).catch(() => {})
        }, 600)
        backupTimers.set(tabId, timer)
    },

    gotoDefinition(path: string, line: number, col: number) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                const pos = cursorToLsp({ ln: line, col })
                const res = await requestLanguageDefinition({
                    workspaceId: pid,
                    workspaceRoot: root,
                    path: lspPath(root, path),
                    line: pos.line,
                    character: pos.character,
                })
                const locs = mapLspLocations(res, root)
                if (!locs.length) {
                    store().showToast("No definition found")
                    return
                }
                store().openFile(locs[0].path, { line: locs[0].line, col: locs[0].col })
                store().showToast("Definition → " + locs[0].path + ":" + locs[0].line)
                logDiag("info", "language", "definition " + path)
            } catch (error) {
                store().showToast("Definition: " + errMsg(error))
            }
        })()
    },

    async hoverAt(path: string, line: number, col: number): Promise<LanguageHover | null> {
        const pid = store().active
        const root = rootOf(pid)
        if (!root || !isLspSupportedDocumentPath(path)) return null
        try {
            const pos = cursorToLsp({ ln: line, col })
            return await requestLanguageHover({
                workspaceId: pid,
                workspaceRoot: root,
                path: lspPath(root, path),
                line: pos.line,
                character: pos.character,
            })
        } catch {
            return null
        }
    },

    async completeAt(path: string, line: number, col: number) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root || !isLspSupportedDocumentPath(path)) return []
        try {
            const pos = cursorToLsp({ ln: line, col })
            const res = await requestLanguageCompletion({
                workspaceId: pid,
                workspaceRoot: root,
                path: lspPath(root, path),
                line: pos.line,
                character: pos.character,
            })
            return normalizeLanguageCompletionItems(res)
        } catch (error) {
            store().showToast("Completion: " + errMsg(error))
            return []
        }
    },

    findReferences(path: string, line: number, col: number) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                const pos = cursorToLsp({ ln: line, col })
                const res = await requestLanguageReferences({
                    workspaceId: pid,
                    workspaceRoot: root,
                    path: lspPath(root, path),
                    line: pos.line,
                    character: pos.character,
                })
                const locs = mapLspLocations(res, root)
                if (!locs.length) {
                    store().showToast("No references found")
                    return
                }
                patchProject(pid, (p) => {
                    p.lspRefs = locs.map((loc) => ({
                        path: loc.path,
                        line: loc.line,
                        col: loc.col,
                        preview: loc.path + ":" + loc.line,
                    }))
                })
                logDiag("info", "language", "references " + path)
            } catch (error) {
                store().showToast("References: " + errMsg(error))
            }
        })()
    },

    codeActionsAt(path: string, line: number, col: number) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root || !isLspSupportedDocumentPath(path)) return
        void (async () => {
            try {
                const pos = cursorToLsp({ ln: line, col })
                const res = await requestLanguageCodeActions({
                    workspaceId: pid,
                    workspaceRoot: root,
                    path: lspPath(root, path),
                    line: pos.line,
                    character: pos.character,
                })
                const actions = normalizeLanguageCodeActions(res)
                if (!actions.length) {
                    store().showToast("No code actions found")
                    return
                }
                patchProject(pid, (p) => {
                    p.lspActions = actions
                })
                logDiag("info", "language", "code actions " + path)
            } catch (error) {
                store().showToast("Code actions: " + errMsg(error))
            }
        })()
    },

    applyCodeAction(index: number) {
        const pid = store().active
        const root = rootOf(pid)
        const action = store().ui[pid]?.lspActions?.[index]
        if (!root || !action) return
        patchProject(pid, (p) => {
            p.lspActions = null
        })
        if (!action.edit) {
            store().showToast("Code action has no workspace edit")
            return
        }
        const groups = flattenWorkspaceEdit(action.edit, root)
        if (!groups.length) {
            store().showToast("Code action produced no changes")
            return
        }
        store().openConfirm({
            title: "Code Action",
            body: "Apply \"" + action.title + "\" to " + groups.length + " file" + (groups.length === 1 ? "" : "s") + ".",
            label: "Apply",
            action: () => {
                void applyWorkspaceEditGroups(pid, groups, "Applied code action")
            },
        })
    },

    renameSymbol(path: string, line: number, col: number, newName: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root || !newName.trim()) return
        void (async () => {
            try {
                const pos = cursorToLsp({ ln: line, col })
                const res = await requestLanguageRename({
                    workspaceId: pid,
                    workspaceRoot: root,
                    path: lspPath(root, path),
                    line: pos.line,
                    character: pos.character,
                    newName,
                })
                const groups = flattenWorkspaceEdit(res, root)
                if (!groups.length) {
                    store().showToast("Rename produced no changes")
                    return
                }
                store().openConfirm({
                    title: "Rename Symbol",
                    body: "Apply rename to " + groups.length + " file" + (groups.length === 1 ? "" : "s") + ".",
                    label: "Rename",
                    action: () => {
                        void applyWorkspaceEditGroups(pid, groups, "Renamed symbol to " + newName)
                    },
                })
                logDiag("info", "language", "rename requested " + path)
            } catch (error) {
                store().showToast("Rename: " + errMsg(error))
            }
        })()
    },

    restartLspServer(language: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return
        void (async () => {
            try {
                const status = await restartLanguageServer({
                    workspaceId: pid,
                    workspaceRoot: root,
                    language,
                })
                patchLspServer(pid, status)
                await ensureLang(pid, true)
                store().showToast("Restarted " + status.display_name)
                logDiag("info", "language", "restarted " + language)
            } catch (error) {
                store().showToast("Restart language server: " + errMsg(error))
            }
        })()
    },

    reloadLang() {
        const pid = store().active
        patchProject(pid, (p) => {
            p.lspLoaded = false
        })
        void ensureLang(pid, true)
    },

    async workspaceSymbols(query: string) {
        const pid = store().active
        const root = rootOf(pid)
        if (!root) return []
        try {
            const res = await requestLanguageSymbols({
                workspaceId: pid,
                workspaceRoot: root,
                query,
            })
            const symbols = mapLspSymbols(res, root)
            const needle = query.trim().toLowerCase()
            if (!needle) return symbols.slice(0, 80)
            return symbols
                .filter((symbol) =>
                    symbol.name.toLowerCase().includes(needle) ||
                    symbol.path.toLowerCase().includes(needle) ||
                    (symbol.containerName ?? "").toLowerCase().includes(needle)
                )
                .slice(0, 80)
        } catch (error) {
            store().showToast("Workspace symbols: " + errMsg(error))
            return []
        }
    },

    lspChange(tabId: number) {
        scheduleLspChange(store().active, tabId)
    },

    // ------------------------------------------------------------ browser / term

    browserGo(tabId: number, url: string) {
        const pid = store().active
        void (async () => {
            try {
                const valid = await validateBrowserUrl(url)
                patchTab(pid, tabId, (t) => ({
                    ...t,
                    url: valid.url,
                    urlInput: valid.url,
                    urlErr: undefined,
                    title: valid.host + (valid.port ? ":" + valid.port : ""),
                    mode: undefined,
                    reloadN: (t.reloadN ?? 0) + 1,
                }))
            } catch (error) {
                patchTab(pid, tabId, (t) => ({ ...t, urlErr: errMsg(error) }))
            }
        })()
    },

    browserCapture(tabId: number, bounds: BrowserPreviewBounds) {
        const pid = store().active
        const root = rootOf(pid)
        const tab = tabIn(pid, tabId)
        if (!root || !tab?.url) return
        const title = tab.title ?? tab.url
        void (async () => {
            try {
                const screenshot = await captureBrowserPreview({
                    workspaceRoot: root,
                    request: {
                        url: tab.url as string,
                        title,
                        bounds,
                    },
                })
                let applied = false
                patchTab(pid, tabId, (t) => {
                    if (t.type !== "browser" || t.url !== tab.url) return t
                    applied = true
                    return {
                        ...t,
                        screenshot: {
                            dataUrl: screenshot.data_url,
                            width: screenshot.width,
                            height: screenshot.height,
                        },
                    }
                })
                if (applied) store().showToast("✓ screenshot " + screenshot.width + "×" + screenshot.height)
            } catch (error) {
                store().showToast("Screenshot: " + errMsg(error))
            }
        })()
    },

    termKill(sessionId: string) {
        void closeTerminalSession(sessionId).catch(() => {})
        logDiag("info", "terminal", "killed session")
    },
}

async function inspectDb(pid: string, idx: number): Promise<void> {
    const conn = store().ui[pid]?.dbConns[idx]
    if (!conn?.profileId) return
    try {
        const schema = await inspectDatabaseSchema(conn.profileId)
        patchProject(pid, (q) => {
            q.dbConns = q.dbConns.map((c, i) =>
                i === idx ? { ...c, tables: mapDbTables(schema.tables), inspected: true, live: true } : c,
            )
        })
    } catch (error) {
        patchProject(pid, (q) => {
            q.dbConns = q.dbConns.map((c, i) => (i === idx ? { ...c, inspected: true } : c))
        })
        store().showToast("Database: " + errMsg(error))
    }
}

// ---------------------------------------------------------------- bootstrap

export async function bootstrapV2(): Promise<void> {
    if (bootstrapped) {
        if (isTauri()) registerRealDelegate(delegate)
        return
    }
    bootstrapped = true
    if (!isTauri()) return

    registerRealDelegate(delegate)
    v2Store.setState({ mode: "real", order: [], active: "", meta: {}, ui: {} })

    void onTerminalOutput((event) => {
        for (const title of extractTerminalOscTitles(event.session_id, event.chunk)) {
            applyOscTitle(event.session_id, title)
        }
        appendTerminalReplayOutput(event.session_id, event.chunk)
    })
    void onTerminalExit((event) => {
        markSessionExited(event.session_id)
    })

    try {
        await loadRegistry(true)
    } catch (error) {
        store().showToast("Workspaces: " + errMsg(error))
        return
    }
    const pid = store().active
    if (pid) void ensureActiveProjectData(pid)
}
