// Yuuzu IDE v2 — workbench store.
// One UI slice per project folder; switching projects keeps every other
// project's tabs, function selection and agent sessions intact (design spec).

import { create } from "zustand"
import { confirmationTextForGitAction, type GitBlameFile, type GitBranchFull, type GitConflictFile, type GitStashEntry } from "../features/git/git-model"
import type { GitDiffHunks, HunkSelection } from "../features/git/git-diff-model"
import type { GitExportFormat, GitExportScope, GitResetMode } from "../features/git/git-log-model"
import type { BrowserPreviewBounds } from "../features/browser/browser-model"
import type { FileVersion } from "../features/files/file-model"
import type { ConnectionTestResult, DatabaseProfile, DatabaseProfileInput } from "../features/database/database-model"
import type { LanguageCompletionItem, LanguageHover, LanguageSymbol } from "../features/language/language-model"
import type { RemoteHostProfileInput } from "../features/remote/remote-model"
import { evictHlCache } from "./hl-cache"
import { externallyChangedTabIds } from "./file-watch"
import { dbProfileToDialog, defaultDbDialogState, newDbDialogState } from "./db-dialog"

import {
    ADD_PRESETS,
    PROJECT_PRESETS,
    buildDiff,
    buildSelect,
    codeFor,
    dbsFor,
    demoHtmlPreviewForPath,
    estTokens,
    execOut,
    fmtK,
    ctxPct,
    detectLineEnding,
    emptyGitData,
    gitFor,
    hostsFor,
    isHtmlDocumentPath,
    normalizeEditorContent,
    registerCode,
    sftpFor,
    tabIsDirty,
    treeFor,
    workspaceBrowserUrlForPath,
} from "./v2-model"
import type {
    AzWindow,
    BackupSummary,
    CtxTarget,
    DbHistoryRow,
    DbTable,
    DiffRow,
    DiagEvent,
    FnMode,
    LineEnding,
    MetricSnapshot,
    ProjectMeta,
    ProjectUI,
    SftpPane,
    SshHost,
    Tab,
    TreeNode,
} from "./v2-model"

let demoDbProfileSeq = 0

export type SshHostProfileDraft = Omit<RemoteHostProfileInput, "workspace_root"> & { workspace_root?: string }

function nextDemoDbProfileId(existing: DatabaseProfile[]): string {
    const existingIds = new Set(existing.map((profile) => profile.id))
    let profileId = ""
    do {
        demoDbProfileSeq += 1
        profileId = "demo-db-" + demoDbProfileSeq.toString(36)
    } while (existingIds.has(profileId))
    return profileId
}

// Real-backend delegate — registered by controller.ts when running inside
// Tauri. Actions consult it first so the demo logic stays the browser
// fallback and the store never imports async code.
export type RealDelegate = {
    selectProject: (pid: string) => void
    addProject: () => void
    closeProject: (pid: string) => void
    selectFn: (fn: FnMode) => void
    toggleDir: (displayPath: string) => void
    openFile: (displayPath: string, reveal?: { line: number; col: number }) => void
    openFileInBrowser: (displayPath: string) => void
    newTerm: () => void
    closeTab: (tab: Tab) => void
    azNew: () => void
    azClose: (sessionId: string) => void
    doCommit: (message: string) => void
    openShell: (host: SshHost) => void
    toggleDbConn: (idx: number) => void
    addNode: (dirPath: string, kind: "file" | "dir", name: string) => void
    deleteNode: (displayPath: string) => void
    selectCommit: (hash: string) => void
    saveFile: (tabId: number, force?: boolean) => void
    reloadFile: (tabId: number) => void
    onExternalFileChange: (
        workspaceId: string,
        eventWorkspaceRoot: string,
        eventPath: string,
        eventVersion: FileVersion | null
    ) => void
    dbOpenTable: (tabId: number) => void
    dbRun: (tabId: number, confirmation?: string) => void
    dbExport: (tabId: number) => void
    dbRefresh: (ci: number) => void
    dbHistory: (tabId: number) => void
    dbTestConn: (input: DatabaseProfileInput) => Promise<ConnectionTestResult>
    dbSaveConn: (input: DatabaseProfileInput) => Promise<void>
    dbDeleteConn: (profileId: string) => Promise<void>
    saveSshHost: (input: SshHostProfileDraft) => Promise<void>
    deleteSshHost: (profileId: string) => Promise<void>
    sftpOpen: (host: SshHost) => void
    sftpDisconnect: () => void
    sftpReconnect: () => void
    sftpRunCommand: (command: string) => void
    sftpEnter: (pane: SftpPane, idx: number) => void
    sftpTransfer: (from: SftpPane, idx: number) => void
    sftpDelete: (pane: SftpPane, idx: number) => void
    gitCheckout: (fullHash: string, short: string) => void
    gitCherryPick: (fullHash: string, short: string) => void
    gitRevert: (fullHash: string, short: string) => void
    gitSync: (op: "push" | "pull" | "fetch") => void
    gitStage: (paths: string[]) => void
    gitUnstage: (paths: string[]) => void
    gitDiscard: (paths: string[], token: string) => void
    gitOpenDiff: (path: string, staged: boolean) => void
    gitStageHunks: (path: string, selections: HunkSelection[]) => void
    gitUnstageHunks: (path: string, selections: HunkSelection[]) => void
    gitRevertHunk: (path: string, selections: HunkSelection[], token: string) => void
    gitLoadBranches: () => void
    gitCreateBranch: (name: string) => void
    gitCheckoutBranch: (name: string, token: string) => void
    gitMergeBranch: (name: string) => void
    gitDeleteBranch: (name: string, token: string) => void
    gitRenameBranch: (from: string, to: string) => void
    gitLoadStashes: () => void
    gitStash: (message: string, includeUntracked: boolean) => void
    gitStashApply: (index: number) => void
    gitStashPop: (index: number) => void
    gitStashDrop: (index: number, token: string) => void
    gitStashBranch: (index: number, name: string) => void
    gitResetHard: (token: string) => void
    gitResetTo: (fullHash: string, short: string, mode: GitResetMode, token: string) => void
    gitRebaseOnto: (target: string, token: string) => void
    gitOpenConflict: (path: string) => void
    gitAcceptConflictSide: (path: string, side: "ours" | "theirs", token: string) => void
    gitMarkResolved: (path: string) => void
    gitLoadBlame: (tabId: number, path: string) => void
    gitFileHistory: (path: string) => void
    gitExportCommit: (fullHash: string, short: string, scope: GitExportScope, format: GitExportFormat) => void
    gitOpenCommitFileDiff: (fullHash: string, short: string, path: string) => void
    copyCommitHash: (hash: string) => void
    browserGo: (tabId: number, url: string) => void
    browserCapture: (tabId: number, bounds: BrowserPreviewBounds) => void
    termKill: (sessionId: string) => void
    loadStability: () => void
    refreshMetric: () => void
    restoreBackup: (id: string) => void
    discardBackup: (id: string) => void
    backupTab: (tabId: number, content: string, lineEnding?: LineEnding) => void
    gotoDefinition: (path: string, line: number, col: number) => void
    findReferences: (path: string, line: number, col: number) => void
    renameSymbol: (path: string, line: number, col: number, newName: string) => void
    completeAt: (path: string, line: number, col: number) => Promise<LanguageCompletionItem[]>
    codeActionsAt: (path: string, line: number, col: number) => void
    applyCodeAction: (index: number) => void
    hoverAt: (path: string, line: number, col: number) => Promise<LanguageHover | null>
    workspaceSymbols: (query: string) => Promise<LanguageSymbol[]>
    restartLspServer: (language: string) => void
    reloadLang: () => void
    lspChange: (tabId: number) => void
}

let realDelegate: RealDelegate | null = null

export function registerRealDelegate(delegate: RealDelegate | null): void {
    realDelegate = delegate
}

let idSeq = 100
function nextId(): number {
    return ++idSeq
}

function fileNameForPath(path: string): string {
    return path.split(/[\\/]/).pop() ?? path
}

function demoHtmlBrowserTab(path: string): Omit<Tab, "id"> {
    const name = fileNameForPath(path)
    const url = workspaceBrowserUrlForPath(path)
    return {
        type: "browser",
        title: name,
        path,
        url,
        urlInput: url,
        htmlPreview: demoHtmlPreviewForPath(path),
    }
}

function messageFromError(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === "string") return error
    return String(error)
}

async function writeBrowserClipboardText(text: string): Promise<void> {
    const clipboard = navigator.clipboard
    if (!clipboard?.writeText) throw new Error("clipboard API unavailable")
    await clipboard.writeText(text)
}

function mkWin(title: string, status: string, lines: string[]): AzWindow {
    return { id: nextId(), title, status, lines, buf: "", min: false, max: false }
}

function defaultTabs(pid: string): Tab[] {
    if (pid === "api") {
        return [
            { id: nextId(), type: "file", name: "server.ts", path: "src/server.ts" },
            { id: nextId(), type: "file", name: "users.ts", path: "src/routes/users.ts", dirty: true },
            { id: nextId(), type: "browser", title: "localhost:3000", url: "localhost:3000/health", mode: "api" },
            { id: nextId(), type: "cmd", title: "zsh", buf: "", lines: [
                "❯ yuuzu",
                "◆ workspace ready · 3 projects · postgres + sqlite",
                "❯ npm run dev",
                "● api listening on :3000",
            ] },
        ]
    }
    if (pid === "web") {
        return [
            { id: nextId(), type: "file", name: "index.tsx", path: "src/index.tsx" },
            { id: nextId(), type: "file", name: "hero.css", path: "src/styles/hero.css" },
            { id: nextId(), type: "browser", title: "localhost:5173", url: "localhost:5173", mode: "web" },
        ]
    }
    if (pid === "edge") {
        return [
            { id: nextId(), type: "file", name: "deploy.sh", path: "scripts/deploy.sh" },
            { id: nextId(), type: "cmd", title: "ssh edge-01", buf: "", lines: [
                "❯ ssh deploy@edge-01",
                "● connected — Debian 12 · uptime 41d",
                "deploy@edge-01:~$ systemctl status yuuzu-api",
                "✓ active (running) since 08:44 UTC",
            ] },
        ]
    }
    return [{ id: nextId(), type: "file", name: "README.md", path: "README.md" }]
}

function defaultWins(pid: string): AzWindow[] {
    if (pid === "api") {
        return [
            mkWin("claude · fix pagination", "running", [
                '❯ claude code "add cursor pagination to /users, 50 per page"',
                "● reading src/routes/users.ts …",
                "● reading src/db/pool.ts …",
                "● editing 1 file · running build",
                "$ npm run build",
                "✓ done — GET /api/users now paginates",
            ]),
            mkWin("claude · write tests", "idle", [
                '❯ claude code "cover pagination edge cases with vitest"',
                "● writing tests/users.pagination.test.ts",
                "$ npx vitest run",
                "✓ 12 passed · 0 failed · 1.8s",
            ]),
        ]
    }
    if (pid === "web") {
        return [
            mkWin("claude · hero animation", "running", [
                '❯ claude code "stagger-reveal the hero headline on load"',
                "● reading src/components/Hero.tsx …",
                "● editing 2 files · checking contrast",
                "✓ done — 240ms stagger, prefers-reduced-motion safe",
            ]),
        ]
    }
    return []
}

function defaultOpen(pid: string): Record<string, boolean> {
    if (pid === "api") return { src: true, "src/routes": true, "src/db": true }
    if (pid === "web") return { src: true, "src/components": true }
    if (pid === "edge") return { scripts: true }
    return {}
}

export function defUI(pid: string): ProjectUI {
    return {
        fn: "files",
        open: defaultOpen(pid),
        dbOpen: { 0: true },
        tabs: defaultTabs(pid),
        activeTab: null,
        split: null,
        sftp: sftpFor(pid),
        wins: defaultWins(pid),
        azActive: null,
        treeData: treeFor(pid),
        git: gitFor(pid),
        commitMsg: "",
        gitSel: 0,
        gitFilter: "all",
        branchPopupOpen: false,
        stashPanelOpen: false,
        dbConns: dbsFor(pid).map((c) => ({ ...c, tables: c.tables.map((t) => ({ ...t })) })),
        dbProfiles: [],
        dbDialog: defaultDbDialogState(),
        sshHosts: hostsFor(pid).map((h) => ({ ...h })),
        sshProfiles: [],
        treeLoaded: true,
        gitLoaded: true,
        gitDetail: null,
        diagnosticsByPath: {},
        lspServers: [],
        lspLogs: [],
        lspRefs: null,
        lspActions: null,
        lspLoaded: false,
    }
}

// Empty slice for a real workspace — content arrives from the backend.
export function emptyUI(): ProjectUI {
    return {
        fn: "files",
        open: {},
        dbOpen: { 0: true },
        tabs: [],
        activeTab: null,
        split: null,
        sftp: { localPath: "", remotePath: "/", local: [], remote: [], sel: null, clip: null, focus: "local", localRel: "" },
        wins: [],
        azActive: null,
        treeData: [],
        git: emptyGitData(),
        commitMsg: "",
        gitSel: 0,
        gitFilter: "all",
        branchPopupOpen: false,
        stashPanelOpen: false,
        dbConns: [],
        dbProfiles: [],
        dbDialog: defaultDbDialogState(),
        sshHosts: [],
        sshProfiles: [],
        treeLoaded: false,
        gitLoaded: false,
        gitDetail: null,
        diagnosticsByPath: {},
        lspServers: [],
        lspLogs: [],
        lspRefs: null,
        lspActions: null,
        lspLoaded: false,
    }
}

export type PaletteState = { open: boolean; q: string }

export type ConfirmState = {
    title: string
    body: string
    label: string
    danger?: boolean
    typed?: string
    action: () => void
}

export type NodeNameDialogState = {
    dirPath: string
    kind: "file" | "dir"
    value: string
    error: string | null
}

export type StabilityState = {
    metric: MetricSnapshot | null
    events: DiagEvent[]
    backups: BackupSummary[]
    loading: boolean
}

export type V2State = {
    mode: "demo" | "real"
    order: string[]
    active: string
    meta: Record<string, ProjectMeta>
    ui: Record<string, ProjectUI>
    theme: "dark" | "light"
    panelOpen: boolean
    plusMenu: { x: number; y: number } | null
    ctx: CtxTarget | null
    pal: PaletteState
    stOpen: boolean
    stSec: string
    stVals: Record<string, string | boolean>
    sidePanelWidth: number
    toast: string | null
    azWidth: number
    azColsOverride: number | null
    azSplitRatio: number
    confirm: ConfirmState | null
    nodeNameDialog: NodeNameDialogState | null
    cursor: { ln: number; col: number } | null
    stab: StabilityState

    // helpers
    activeUI: () => ProjectUI
    activeTabObj: () => Tab | null

    // chrome
    selectProject: (pid: string) => void
    addProject: () => void
    closeProject: (pid: string) => void
    toggleTheme: () => void
    setPanelOpen: (open: boolean) => void
    setSidePanelWidth: (width: number) => void
    persistSidePanelWidth: () => void
    setAzWidth: (width: number) => void
    setAzColsOverride: (cols: number | null) => void
    setAzSplitRatio: (ratio: number) => void
    persistAzSplitRatio: () => void
    showToast: (msg: string) => void
    dismissToast: () => void

    // function list / panel
    selectFn: (fn: FnMode) => void
    toggleDir: (path: string) => void
    openFile: (path: string, reveal?: { line: number; col: number }) => void
    openFileInBrowser: (path: string) => void
    openToSide: (path: string) => void
    addNode: (dirPath: string, kind: "file" | "dir") => void
    deleteNode: (path: string) => void
    toggleDbConn: (idx: number) => void
    openDbTable: (connIdx: number, table: DbTable, view?: "data" | "structure" | "sql" | "history") => void
    setDbView: (tabId: number, view: "data" | "structure" | "sql" | "history") => void
    setDbSql: (tabId: number, sql: string) => void
    runDbQuery: (tabId: number) => void
    exportDbResult: (tabId: number) => void
    refreshDbConn: (ci: number) => void
    loadDbHistory: (tabId: number) => void
    openDbConnDialog: (mode?: "new" | "edit", profileId?: string) => void
    closeDbConnDialog: () => void
    patchDbDialog: (patch: Partial<ReturnType<typeof defaultDbDialogState>>) => void
    testDbConn: (input: DatabaseProfileInput) => Promise<ConnectionTestResult | null>
    saveDbConn: (input: DatabaseProfileInput) => Promise<void>
    deleteDbConn: (profileId: string) => Promise<void>
    saveSshHost: (input: SshHostProfileDraft) => Promise<void>
    deleteSshHost: (profileId: string) => Promise<void>
    openSftp: (host: SshHost) => void
    sftpDisconnect: () => void
    sftpReconnect: () => void
    sftpRunCommand: (command: string) => void
    openShell: (host: SshHost) => void

    // editor
    setTabContent: (tabId: number, content: string) => void
    setTabLineEnding: (tabId: number, lineEnding: LineEnding) => void
    markExternalFileChange: (workspaceId: string, eventWorkspaceRoot: string, eventPath: string, eventVersion: FileVersion | null) => void
    saveTab: (tabId: number) => void
    reloadTab: (tabId: number) => void
    overwriteTab: (tabId: number) => void
    setCursor: (cursor: { ln: number; col: number } | null) => void
    clearReveal: (tabId: number) => void
    gotoDefinition: (path: string, line: number, col: number) => void
    findReferences: (path: string, line: number, col: number) => void
    renameSymbol: (path: string, line: number, col: number, newName: string) => void
    completeAt: (path: string, line: number, col: number) => Promise<LanguageCompletionItem[]>
    codeActionsAt: (path: string, line: number, col: number) => void
    applyCodeAction: (index: number) => void
    hoverAt: (path: string, line: number, col: number) => Promise<LanguageHover | null>
    workspaceSymbols: (query: string) => Promise<LanguageSymbol[]>
    restartLspServer: (language: string) => void
    closeRefs: () => void
    closeCodeActions: () => void
    reloadLang: () => void

    // git
    setCommitMsg: (msg: string) => void
    doCommit: () => void
    setGitSel: (idx: number) => void
    setGitFilter: (filter: string) => void
    checkoutCommit: (idx: number) => void
    cherryPickCommit: (idx: number) => void
    revertCommit: (idx: number) => void
    copyCommitHash: (idx: number) => void
    gitSync: (op: "push" | "pull" | "fetch") => void
    openBranchPopup: () => void
    closeBranchPopup: () => void
    createBranch: (name: string) => void
    checkoutBranch: (name: string) => void
    mergeBranch: (name: string) => void
    deleteBranch: (name: string) => void
    renameBranch: (from: string, to: string) => void
    openStashPanel: () => void
    closeStashPanel: () => void
    stashChanges: (message: string, includeUntracked: boolean) => void
    applyStash: (index: number) => void
    popStash: (index: number) => void
    dropStash: (index: number) => void
    stashToBranch: (index: number, name: string) => void
    resetHard: () => void
    resetTo: (idx: number, mode: GitResetMode) => void
    rebaseOnto: (target: string) => void
    openConflict: (path: string) => void
    chooseConflictBlock: (blockIdx: number, side: "ours" | "theirs") => void
    acceptConflictSide: (path: string, side: "ours" | "theirs") => void
    markResolved: (path: string) => void
    toggleBlame: (tabId: number) => void
    openFileHistory: (path: string) => void
    exportCommit: (idx: number, scope: GitExportScope, format: GitExportFormat) => void
    openCommitFileDiff: (idx: number, path: string) => void
    stageFiles: (paths: string[]) => void
    unstageFiles: (paths: string[]) => void
    stageAll: () => void
    unstageAll: () => void
    discardFiles: (paths: string[]) => void
    openWorkingDiff: (path: string, staged: boolean) => void
    stageHunks: (path: string, selections: HunkSelection[]) => void
    unstageHunks: (path: string, selections: HunkSelection[]) => void
    revertHunk: (path: string, selections: HunkSelection[]) => void

    // tabs
    activateTab: (id: number) => void
    closeTab: (id: number) => void
    closeOthers: (id: number) => void
    closeAllTabs: () => void
    newTerm: () => void
    newBrowser: () => void
    newQuery: () => void
    toggleSplit: () => void
    setSplit: (id: number | null) => void
    setPlusMenu: (pos: { x: number; y: number } | null) => void

    // browser
    setTabUrlInput: (tabId: number, url: string) => void
    browserGo: (tabId: number) => void
    browserCapture: (tabId: number, bounds: BrowserPreviewBounds) => void

    // terminal
    setTermBuf: (tabId: number, fn: (buf: string) => string) => void
    runTermCmd: (tabId: number) => void
    clearTerm: (tabId: number) => void
    killTerm: (tabId: number) => void
    applyOscTitle: (sessionId: string, rawTitle: string) => void
    renameTerminalTab: (tabId: number, nextTitle: string) => void

    // sftp
    sftpSelect: (pane: SftpPane, idx: number) => void
    sftpFocus: (pane: SftpPane) => void
    sftpCopy: () => void
    sftpPaste: () => void
    sftpTransfer: (from: SftpPane, idx: number, to: SftpPane) => void
    sftpDelete: (pane: SftpPane, idx: number) => void
    sftpEnter: (pane: SftpPane, idx: number) => void

    // agent zone
    azNew: () => void
    azClose: (id: number) => void
    azCollapse: (id: number) => void
    azMax: (id: number) => void
    azFront: (id: number) => void
    azFocusFromPanel: (id: number) => void
    azExitMax: () => void
    setAzBuf: (id: number, fn: (buf: string) => string) => void
    runAzCmd: (id: number) => void
    renameAgentSession: (winId: number, nextTitle: string) => void

    // overlays
    openCtx: (target: CtxTarget) => void
    closeCtx: () => void
    openPalette: () => void
    closePalette: () => void
    setPaletteQuery: (fn: (q: string) => string) => void
    openSettings: () => void
    closeSettings: () => void
    setSettingsSection: (id: string) => void
    setSetting: (key: string, value: string | boolean) => void
    loadStability: () => void
    refreshMetric: () => void
    restoreBackup: (id: string) => void
    discardBackup: (id: string) => void
    openConfirm: (confirm: ConfirmState) => void
    closeConfirm: () => void
    setNodeNameValue: (value: string) => void
    closeNodeNameDialog: () => void
    submitNodeNameDialog: () => void
}

const THEME_KEY = "yuuzu-ide-theme"
const SETTINGS_KEY = "yuuzu-ide-v2-settings"
const EDITOR_ENGINE_DEFAULT_MIGRATION_KEY = "yuuzu-ide-v2-editor-engine-default-codemirror-v1"

export const SIDE_PANEL_MIN_WIDTH = 220
export const SIDE_PANEL_DEFAULT_WIDTH = 284
export const SIDE_PANEL_MAX_WIDTH = 420

export const AZ_SPLIT_MIN_RATIO = 30
export const AZ_SPLIT_DEFAULT_RATIO = 50
export const AZ_SPLIT_MAX_RATIO = 70

export function clampSidePanelWidth(width: number): number {
    if (!Number.isFinite(width)) return SIDE_PANEL_DEFAULT_WIDTH
    return Math.max(SIDE_PANEL_MIN_WIDTH, Math.min(SIDE_PANEL_MAX_WIDTH, Math.round(width)))
}

export function clampAzSplitRatio(ratio: number): number {
    if (!Number.isFinite(ratio)) return AZ_SPLIT_DEFAULT_RATIO
    const rounded = Math.round(ratio)
    return Math.max(AZ_SPLIT_MIN_RATIO, Math.min(AZ_SPLIT_MAX_RATIO, rounded))
}

function sidePanelWidthFromSettings(vals: Record<string, string | boolean>): number {
    const raw = vals.sidePanelWidth
    if (typeof raw !== "string") return SIDE_PANEL_DEFAULT_WIDTH
    return clampSidePanelWidth(Number(raw))
}

function azSplitRatioFromSettings(vals: Record<string, string | boolean>): number {
    const raw = vals.azSplitRatio
    if (typeof raw !== "string") return AZ_SPLIT_DEFAULT_RATIO
    return clampAzSplitRatio(Number(raw))
}

function loadTheme(): "dark" | "light" {
    try {
        const t = localStorage.getItem(THEME_KEY)
        return t === "light" ? "light" : "dark"
    } catch {
        return "dark"
    }
}

export function loadStoredSettings(): Record<string, string | boolean> {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const out: Record<string, string | boolean> = {}
        for (const k of Object.keys(parsed)) {
            const v = parsed[k]
            if (typeof v === "string" || typeof v === "boolean") out[k] = v
        }
        if (out.editorEngine === "textarea" && localStorage.getItem(EDITOR_ENGINE_DEFAULT_MIGRATION_KEY) !== "1") {
            out.editorEngine = "codemirror"
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(out))
            localStorage.setItem(EDITOR_ENGINE_DEFAULT_MIGRATION_KEY, "1")
        }
        return out
    } catch {
        return {}
    }
}

function persistSettings(vals: Record<string, string | boolean>): void {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(vals))
        if (Object.prototype.hasOwnProperty.call(vals, "editorEngine")) {
            localStorage.setItem(EDITOR_ENGINE_DEFAULT_MIGRATION_KEY, "1")
        }
    } catch {
        // persistence is best-effort
    }
}

export function applyThemeAttr(theme: "dark" | "light"): void {
    if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-yz-theme", theme)
    }
}

// Default LIMIT for real SQL consoles, from the Connections settings section.
export function settingLimit(vals: Record<string, string | boolean>): number {
    const v = vals.rowLimit
    if (v === "100") return 100
    if (v === "1K") return 1000
    return 500
}

export function sanitizeTerminalTitle(rawTitle: string): string {
    return rawTitle.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, 120)
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

function demoStability(): StabilityState {
    const now = Date.now()
    return {
        metric: {
            memoryBytes: 184 * 1024 * 1024,
            uptimeMs: 3_600_000,
            workspaceCount: 3,
            docsIndexEntries: 0,
            fileTreeEntries: 42,
            processId: 0,
        },
        events: [
            { id: "demo-1", level: "info", source: "workspace", message: "Selected yuuzu-api", ts: now - 25_000 },
            { id: "demo-2", level: "warn", source: "recovery", message: "Draft backup available", ts: now - 90_000 },
            { id: "demo-3", level: "info", source: "git", message: "Fetched origin/main", ts: now - 180_000 },
        ],
        backups: [],
        loading: false,
    }
}

function diffRowsFromHunks(diff: GitDiffHunks): DiffRow[] {
    const rows: DiffRow[] = []
    diff.hunks.forEach((hunk, hunkIndex) => {
        rows.push({
            t: "h",
            s: hunk.header,
            oldNo: null,
            newNo: null,
            hunkIndex,
            lineIndex: null,
        })
        hunk.lines.forEach((line, lineIndex) => {
            rows.push({
                t: line.kind === "add" ? "a" : line.kind === "del" ? "d" : "x",
                s: line.text,
                oldNo: line.old_no,
                newNo: line.new_no,
                hunkIndex,
                lineIndex,
            })
        })
    })
    return rows
}

function demoDiffHunks(path: string, staged: boolean): GitDiffHunks {
    return {
        path,
        staged,
        binary: false,
        truncated: false,
        hunks: [{
            header: "@@ -1,3 +1,4 @@",
            old_start: 1,
            old_lines: 3,
            new_start: 1,
            new_lines: 4,
            lines: [
                { kind: "context", old_no: 1, new_no: 1, text: "export function run() {", word_ranges: [] },
                { kind: "del", old_no: 2, new_no: null, text: "  return oldValue", word_ranges: [[9, 17]] },
                { kind: "add", old_no: null, new_no: 2, text: "  // " + path, word_ranges: [] },
                { kind: "add", old_no: null, new_no: 3, text: "  return newValue", word_ranges: [[9, 17]] },
                { kind: "context", old_no: 3, new_no: 4, text: "}", word_ranges: [] },
            ],
        }],
    }
}

function demoDiff(path: string, staged: boolean): DiffRow[] {
    return diffRowsFromHunks(demoDiffHunks(path, staged))
}

function demoConflict(path: string): GitConflictFile {
    return {
        path,
        base: "export const title = \"Yuuzu IDE\";\nexport const mode = \"base\";\n",
        ours: "export const title = \"Yuuzu IDE\";\nexport const mode = \"ours\";\n",
        theirs: "export const title = \"Yuuzu IDE\";\nexport const mode = \"theirs\";\n",
        working: [
            "export const title = \"Yuuzu IDE\";",
            "<<<<<<< HEAD",
            "export const mode = \"ours\";",
            "=======",
            "export const mode = \"theirs\";",
            ">>>>>>> incoming",
            "",
        ].join("\n"),
        blocks: [{
            start_line: 2,
            ours: ["export const mode = \"ours\";"],
            theirs: ["export const mode = \"theirs\";"],
        }],
        truncated: false,
    }
}

function demoBlame(path: string, lineCount: number): GitBlameFile {
    const first = Math.max(1, Math.ceil(lineCount / 2))
    return {
        path,
        truncated: false,
        segments: [
            { hash: "a".repeat(40), short_hash: "a13f09c", author: "yuuzu", when_unix: 1, line_start: 1, line_count: first },
            { hash: "b".repeat(40), short_hash: "b82d44a", author: "claude", when_unix: 2, line_start: first + 1, line_count: Math.max(0, lineCount - first) },
        ].filter((segment) => segment.line_count > 0),
    }
}

function demoBranches(current: string): GitBranchFull[] {
    const active = current || "main"
    const local = Array.from(new Set([active, "main", "feat/pag", "release/next"]))
    return [
        ...local.map((name, index) => ({
            name,
            current: name === active,
            remote: false,
            upstream: name === "main" ? "origin/main" : null,
            ahead: name === current ? 2 : 0,
            behind: index === 0 ? 0 : index,
            head_short: ["f3a91c", "8c12de", "77fe02"][index] ?? "c0ffee",
        })),
        { name: "origin/main", current: false, remote: true, upstream: null, ahead: 0, behind: 0, head_short: "f3a91c" },
    ]
}

function knownDemoBranches(current: string, loaded: GitBranchFull[]): GitBranchFull[] {
    const active = current || "main"
    if (loaded.length && loaded.some((b) => b.current || b.name === active)) return loaded
    const branches = new Map<string, GitBranchFull>()
    demoBranches(active).forEach((b) => branches.set(b.name, b))
    loaded.forEach((b) => branches.set(b.name, b))
    return Array.from(branches.values())
}

function reindexStashes(stashes: GitStashEntry[]): GitStashEntry[] {
    return stashes.map((stash, index) => ({ ...stash, index }))
}

function demoStashes(): GitStashEntry[] {
    const now = Math.floor(Date.now() / 1000)
    return [
        { index: 0, message: "WIP: source control panel", when_unix: now - 1800 },
        { index: 1, message: "try branch popup layout", when_unix: now - 86400 },
    ]
}

function demoDbHistory(): DbHistoryRow[] {
    return [
        { sql: "SELECT * FROM users ORDER BY created_at DESC", kind: "Read", when: "10:44", rows: "8 rows" },
        { sql: "UPDATE users SET active = 0 WHERE last_seen < ?", kind: "Mutation", when: "10:39", rows: "3 affected" },
        { sql: "DELETE FROM sessions WHERE expired_at < now()", kind: "Destructive", when: "10:12", rows: "12 affected" },
    ]
}

export function createV2Store() {
    return create<V2State>((set, get) => {
        const upd = (mut: (p: ProjectUI) => void) => {
            set((s) => {
                const p: ProjectUI = { ...s.ui[s.active] }
                mut(p)
                return { ui: { ...s.ui, [s.active]: p } }
            })
        }

        const ensureTab = (p: ProjectUI, match: (t: Tab) => boolean, make: () => Omit<Tab, "id">): Tab => {
            const found = p.tabs.find(match)
            if (found) {
                p.activeTab = found.id
                return found
            }
            const nt: Tab = { id: nextId(), ...make() } as Tab
            p.tabs = [...p.tabs, nt]
            p.activeTab = nt.id
            return nt
        }

        const completeConflict = (path: string) => {
            upd((p) => {
                const conflicts = p.git.conflicts.filter((file) => file.path !== path)
                const prefix = path + ":"
                p.git = {
                    ...p.git,
                    conflicts,
                    hasConflicts: conflicts.length > 0,
                    conflictChoices: Object.fromEntries(
                        Object.entries(p.git.conflictChoices).filter(([key]) => !key.startsWith(prefix)),
                    ),
                }
            })
        }

        const initialTheme = loadTheme()
        const initialSettings = loadStoredSettings()
        applyThemeAttr(initialTheme)

        return {
            mode: "demo",
            order: PROJECT_PRESETS.map((p) => p.id),
            active: "api",
            meta: Object.fromEntries(PROJECT_PRESETS.map((p) => [p.id, p])),
            ui: Object.fromEntries(PROJECT_PRESETS.map((p) => [p.id, defUI(p.id)])),
            theme: initialTheme,
            panelOpen: true,
            plusMenu: null,
            ctx: null,
            pal: { open: false, q: "" },
            stOpen: false,
            stSec: "general",
            stVals: initialSettings,
            sidePanelWidth: sidePanelWidthFromSettings(initialSettings),
            toast: null,
            azWidth: 0,
            azColsOverride: null,
            azSplitRatio: azSplitRatioFromSettings(initialSettings),
            confirm: null,
            nodeNameDialog: null,
            cursor: null,
            stab: { metric: null, events: [], backups: [], loading: false },

            activeUI: () => get().ui[get().active],
            activeTabObj: () => {
                const p = get().ui[get().active]
                if (!p.tabs.length) return null
                return p.tabs.find((t) => t.id === p.activeTab) ?? p.tabs[0]
            },

            selectProject: (pid) => {
                if (!get().ui[pid]) return
                set({ active: pid, plusMenu: null, ctx: null })
                if (get().mode === "real") realDelegate?.selectProject(pid)
            },

            addProject: () => {
                if (get().mode === "real") {
                    realDelegate?.addProject()
                    return
                }
                const s = get()
                const next = ADD_PRESETS.find((p) => !s.order.includes(p.id))
                if (!next) {
                    get().showToast("All demo folders are already open")
                    return
                }
                set((st) => ({
                    order: [...st.order, next.id],
                    meta: { ...st.meta, [next.id]: next },
                    ui: { ...st.ui, [next.id]: {
                        ...defUI(next.id),
                        tabs: [{ id: nextId(), type: "file", name: "README.md", path: "README.md" }],
                        wins: [],
                        open: {},
                    } },
                    active: next.id,
                }))
                get().showToast("Opened folder ~/dev/" + next.name + " — state of other projects is kept")
            },

            closeProject: (pid) => {
                if (get().mode === "real") {
                    realDelegate?.closeProject(pid)
                    return
                }
                set((s) => {
                    const order = s.order.filter((x) => x !== pid)
                    if (!order.length) return {}
                    return { order, active: s.active === pid ? order[0] : s.active }
                })
                get().showToast("Closed project folder — sessions kept in memory")
            },

            toggleTheme: () => {
                const next = get().theme === "light" ? "dark" : "light"
                set((s) => ({ theme: next, stVals: { ...s.stVals, theme: next } }))
                applyThemeAttr(next)
                persistSettings(get().stVals)
                try {
                    localStorage.setItem(THEME_KEY, next)
                } catch {
                    // persistence is best-effort
                }
                get().showToast("Theme: " + next)
            },

            setPanelOpen: (open) => set({ panelOpen: open }),
            setSidePanelWidth: (width) => set({ sidePanelWidth: clampSidePanelWidth(width) }),
            persistSidePanelWidth: () => {
                const width = String(get().sidePanelWidth)
                set((s) => ({ stVals: { ...s.stVals, sidePanelWidth: width } }))
                persistSettings(get().stVals)
            },
            setAzWidth: (width) => {
                if (Math.abs(width - get().azWidth) > 4) set({ azWidth: width })
            },
            setAzColsOverride: (cols) => set({ azColsOverride: cols }),
            setAzSplitRatio: (ratio) => set({ azSplitRatio: clampAzSplitRatio(ratio) }),
            persistAzSplitRatio: () => {
                const azSplitRatio = String(get().azSplitRatio)
                set((s) => ({ stVals: { ...s.stVals, azSplitRatio } }))
                persistSettings(get().stVals)
            },

            showToast: (msg) => {
                if (toastTimer) clearTimeout(toastTimer)
                set({ toast: msg })
                toastTimer = setTimeout(() => set({ toast: null }), 2400)
            },
            dismissToast: () => set({ toast: null }),

            selectFn: (fn) => {
                upd((p) => {
                    p.fn = fn
                    if (fn === "git") {
                        ensureTab(p, (t) => t.type === "git", () => ({ type: "git", title: "git graph" }))
                    }
                })
                if (get().mode === "real") realDelegate?.selectFn(fn)
            },

            toggleDir: (path) => {
                upd((p) => {
                    p.open = { ...p.open, [path]: !p.open[path] }
                })
                if (get().mode === "real") realDelegate?.toggleDir(path)
            },

            openFile: (path, reveal) => {
                if (get().mode === "real") {
                    realDelegate?.openFile(path, reveal)
                    return
                }
                const name = fileNameForPath(path)
                upd((p) => {
                    const existing = p.tabs.find((t) => t.type === "file" && t.path === path)
                    if (existing) {
                        p.activeTab = existing.id
                        if (reveal) {
                            p.tabs = p.tabs.map((t) => (t.id === existing.id ? { ...t, reveal } : t))
                        }
                        return
                    }
                    const nt: Omit<Tab, "id"> = {
                        type: "file",
                        name,
                        path,
                        ...(reveal ? { reveal } : {}),
                    }
                    const tab: Tab = { id: nextId(), ...nt }
                    p.tabs = [...p.tabs, tab]
                    p.activeTab = tab.id
                })
            },

            openFileInBrowser: (path) => {
                if (!isHtmlDocumentPath(path)) {
                    get().showToast("Browser preview is only available for HTML files")
                    return
                }
                if (get().mode === "real") {
                    realDelegate?.openFileInBrowser(path)
                    return
                }
                upd((p) => {
                    const existing = p.tabs.find((t) => t.type === "browser" && t.path === path)
                    if (existing) {
                        p.activeTab = existing.id
                        return
                    }
                    const tab: Tab = { id: nextId(), ...demoHtmlBrowserTab(path) }
                    p.tabs = [...p.tabs, tab]
                    p.activeTab = tab.id
                })
            },

            openToSide: (path) => {
                if (get().mode === "real") {
                    const prevActive = get().ui[get().active]?.activeTab ?? null
                    realDelegate?.openFile(path)
                    const t = get().ui[get().active]?.tabs.find((x) => x.type === "file" && x.path === path)
                    if (t) {
                        upd((p) => {
                            p.activeTab = prevActive ?? t.id
                            p.split = t.id
                        })
                    }
                    return
                }
                const name = fileNameForPath(path)
                upd((p) => {
                    const prevActive = p.activeTab
                    const t = ensureTab(p, (x) => x.type === "file" && x.path === path, () => ({ type: "file", name, path }))
                    p.activeTab = prevActive ?? t.id
                    p.split = t.id
                })
            },

            addNode: (dirPath, kind) => {
                if (get().mode === "real") {
                    set({
                        nodeNameDialog: {
                            dirPath,
                            kind,
                            value: kind === "file" ? "untitled.ts" : "new-folder",
                            error: null,
                        },
                        ctx: null,
                        plusMenu: null,
                    })
                    return
                }
                let created = ""
                upd((p) => {
                    const treeData: TreeNode[] = JSON.parse(JSON.stringify(p.treeData))
                    let arr = treeData
                    if (dirPath) {
                        for (const seg of dirPath.split("/")) {
                            const node = arr.find((n) => n.n === seg && n.d)
                            if (!node?.d) return
                            arr = node.d
                        }
                    }
                    const base = kind === "file" ? "untitled" : "new-folder"
                    const ext = kind === "file" ? ".ts" : ""
                    let name = base + ext
                    let i = 2
                    while (arr.find((n) => n.n === name)) {
                        name = base + "-" + i++ + ext
                    }
                    arr.push(kind === "file" ? { n: name } : { n: name, d: [] })
                    p.treeData = treeData
                    if (dirPath) {
                        let acc = ""
                        const open = { ...p.open }
                        for (const sg of dirPath.split("/")) {
                            acc = acc ? acc + "/" + sg : sg
                            open[acc] = true
                        }
                        p.open = open
                    }
                    created = dirPath ? dirPath + "/" + name : name
                    if (kind === "file") {
                        registerCode(created, { lang: "ts", src: "// " + name + "\n\nexport {};\n" })
                        ensureTab(p, (t) => t.type === "file" && t.path === created, () => ({ type: "file", name, path: created }))
                    }
                })
                if (created) {
                    get().showToast((kind === "file" ? "Created file " : "Created folder ") + created)
                }
            },

            deleteNode: (path) => {
                if (get().mode === "real") {
                    realDelegate?.deleteNode(path)
                    return
                }
                upd((p) => {
                    const treeData: TreeNode[] = JSON.parse(JSON.stringify(p.treeData))
                    const segs = path.split("/")
                    let arr = treeData
                    for (let i = 0; i < segs.length - 1; i++) {
                        const node = arr.find((n) => n.n === segs[i] && n.d)
                        if (!node?.d) return
                        arr = node.d
                    }
                    const idx = arr.findIndex((n) => n.n === segs[segs.length - 1])
                    if (idx >= 0) arr.splice(idx, 1)
                    p.treeData = treeData
                    const goneIds = p.tabs.filter((t) => t.path && (t.path === path || t.path.startsWith(path + "/"))).map((t) => t.id)
                    p.tabs = p.tabs.filter((t) => !(t.path && (t.path === path || t.path.startsWith(path + "/"))))
                    for (const id of goneIds) evictHlCache(id)
                    if (!p.tabs.find((t) => t.id === p.activeTab)) {
                        p.activeTab = p.tabs[0] ? p.tabs[0].id : null
                    }
                    if (p.split && !p.tabs.find((t) => t.id === p.split)) p.split = null
                })
                get().showToast("Deleted " + path)
            },

            toggleDbConn: (idx) => {
                upd((p) => {
                    p.dbOpen = { ...p.dbOpen, [idx]: !p.dbOpen[idx] }
                })
                if (get().mode === "real") realDelegate?.toggleDbConn(idx)
            },

            openDbTable: (connIdx, table, view) => {
                const conn = get().ui[get().active].dbConns[connIdx]
                if (!conn) return
                const isReal = get().mode === "real" && !!conn.profileId
                let openedId = 0
                let fresh = false
                upd((p) => {
                    const before = p.tabs.length
                    const t = ensureTab(
                        p,
                        (x) => x.type === "db" && x.table === table.n && x.conn === conn.name,
                        () => ({
                            type: "db",
                            title: table.n,
                            table: table.n,
                            conn: conn.name,
                            engine: conn.engine,
                            count: table.c,
                            view: "data",
                            profileId: conn.profileId,
                            sql: buildSelect(table.n, settingLimit(get().stVals)),
                        }),
                    )
                    openedId = t.id
                    fresh = p.tabs.length > before
                    if (view) {
                        p.tabs = p.tabs.map((x) => (x.id === t.id ? { ...x, view } : x))
                    }
                    if (p.fn === "agent") p.fn = "db"
                })
                if (isReal && fresh) realDelegate?.dbOpenTable(openedId)
            },

            setDbView: (tabId, view) => {
                upd((p) => {
                    p.tabs = p.tabs.map((x) => (x.id === tabId ? { ...x, view } : x))
                })
            },

            setDbSql: (tabId, sql) => {
                upd((p) => {
                    p.tabs = p.tabs.map((x) => (x.id === tabId ? { ...x, sql } : x))
                })
            },

            runDbQuery: (tabId) => {
                if (get().mode === "real") {
                    realDelegate?.dbRun(tabId)
                    return
                }
                get().showToast("Query ran — 8 rows · 14 ms")
            },

            exportDbResult: (tabId) => {
                if (get().mode === "real") {
                    realDelegate?.dbExport(tabId)
                    return
                }
                const tab = get().ui[get().active].tabs.find((t) => t.id === tabId)
                get().showToast("Exported result to ~/Downloads/" + (tab?.table ?? "result") + ".csv")
            },

            refreshDbConn: (ci) => {
                if (get().mode === "real") {
                    realDelegate?.dbRefresh(ci)
                    return
                }
                const conn = get().ui[get().active].dbConns[ci]
                get().showToast("Refreshed " + (conn?.name ?? ""))
            },

            loadDbHistory: (tabId) => {
                if (get().mode === "real") {
                    realDelegate?.dbHistory(tabId)
                    return
                }
                upd((p) => {
                    p.tabs = p.tabs.map((t) =>
                        t.id === tabId ? { ...t, history: demoDbHistory(), historyLoading: false } : t,
                    )
                })
            },

            openDbConnDialog: (mode = "new", profileId) => {
                upd((p) => {
                    if (mode === "edit" && profileId) {
                        const profile = p.dbProfiles.find((item) => item.id === profileId)
                        if (profile) {
                            p.dbDialog = dbProfileToDialog(profile)
                            return
                        }
                    }
                    p.dbDialog = newDbDialogState()
                })
            },

            closeDbConnDialog: () => {
                upd((p) => {
                    p.dbDialog = defaultDbDialogState()
                })
            },

            patchDbDialog: (patch) => {
                upd((p) => {
                    p.dbDialog = {
                        ...p.dbDialog,
                        ...patch,
                        error: Object.prototype.hasOwnProperty.call(patch, "error") ? patch.error ?? null : p.dbDialog.error,
                        testResult: Object.prototype.hasOwnProperty.call(patch, "testResult") ? patch.testResult ?? null : p.dbDialog.testResult,
                    }
                })
            },

            testDbConn: async (input) => {
                upd((p) => {
                    p.dbDialog = { ...p.dbDialog, testing: true, error: null, testResult: null }
                })
                try {
                    const result = get().mode === "real" && realDelegate
                        ? await realDelegate.dbTestConn(input)
                        : { ok: true, message: "連線成功", elapsed_ms: 1, server_version: input.kind }
                    upd((p) => {
                        p.dbDialog = { ...p.dbDialog, testing: false, testResult: result, error: null }
                    })
                    return result
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    upd((p) => {
                        p.dbDialog = { ...p.dbDialog, testing: false, error: message }
                    })
                    return null
                }
            },

            saveDbConn: async (input) => {
                upd((p) => {
                    p.dbDialog = { ...p.dbDialog, saving: true, error: null }
                })
                try {
                    if (get().mode === "real" && realDelegate) {
                        await realDelegate.dbSaveConn(input)
                    } else {
                        const profileId = input.id ?? nextDemoDbProfileId(get().ui[get().active].dbProfiles)
                        const now = Date.now()
                        const profile: DatabaseProfile = {
                            id: profileId,
                            workspace_root: input.workspace_root,
                            name: input.name,
                            kind: input.kind,
                            source: input.kind === "SQLite"
                                ? { SQLite: { path: input.sqlite_path ?? "" } }
                                : {
                                    Tcp: {
                                        host: input.host ?? "",
                                        port: input.port ?? (input.kind === "MsSql" ? 1433 : 5432),
                                        database: input.database ?? "",
                                        username: input.username ?? null,
                                        secret_id: input.password ? "demo-secret:" + profileId : null,
                                    },
                                },
                            read_only: input.read_only,
                            production: input.production,
                            created_ms: now,
                            updated_ms: now,
                        }
                        const conn = {
                            name: input.name,
                            engine: input.kind === "MsSql" ? "MS SQL Server" : input.kind,
                            live: true,
                            tables: [],
                            profileId,
                        }
                        upd((p) => {
                            p.dbConns = input.id
                                ? p.dbConns.map((item) => (item.profileId === input.id ? conn : item))
                                : [...p.dbConns, conn]
                            p.dbProfiles = input.id
                                ? p.dbProfiles.map((item) => (item.id === input.id ? profile : item))
                                : [...p.dbProfiles, profile]
                        })
                    }
                    upd((p) => {
                        p.dbDialog = defaultDbDialogState()
                    })
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    upd((p) => {
                        p.dbDialog = { ...p.dbDialog, saving: false, error: message }
                    })
                }
            },

            deleteDbConn: async (profileId) => {
                try {
                    if (get().mode === "real" && realDelegate) {
                        await realDelegate.dbDeleteConn(profileId)
                    } else {
                        upd((p) => {
                            p.dbConns = p.dbConns.filter((conn) => conn.profileId !== profileId)
                            p.dbProfiles = p.dbProfiles.filter((profile) => profile.id !== profileId)
                        })
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    get().showToast("Delete connection: " + message)
                }
            },

            saveSshHost: async (input) => {
                try {
                    if (get().mode === "real" && realDelegate) {
                        await realDelegate.saveSshHost(input)
                        return
                    }
                    get().showToast("SSH host profiles need a real workspace")
                } catch (error) {
                    get().showToast("Save SSH host: " + messageFromError(error))
                }
            },

            deleteSshHost: async (profileId) => {
                try {
                    if (get().mode === "real" && realDelegate) {
                        await realDelegate.deleteSshHost(profileId)
                        return
                    }
                    upd((p) => {
                        p.sshHosts = p.sshHosts.filter((host) => host.hostId !== profileId)
                        p.sshProfiles = p.sshProfiles.filter((profile) => profile.id !== profileId)
                    })
                } catch (error) {
                    get().showToast("Delete SSH host: " + messageFromError(error))
                }
            },

            setTabContent: (tabId, content) => {
                const normalized = normalizeEditorContent(content)
                let semanticContentChanged = false
                upd((p) => {
                    p.tabs = p.tabs.map((t) => {
                        if (t.id !== tabId) return t
                        const previous = typeof t.content === "string" ? normalizeEditorContent(t.content) : t.content
                        semanticContentChanged = previous !== normalized
                        const savedContent = typeof t.savedContent === "string"
                            ? normalizeEditorContent(t.savedContent)
                            : t.savedContent
                        const lineEnding = t.lineEnding ?? detectLineEnding(typeof t.content === "string" ? t.content : savedContent)
                        const savedLineEnding = t.savedLineEnding ?? detectLineEnding(typeof t.savedContent === "string" ? t.savedContent : t.content)
                        const next = { ...t, content: normalized, savedContent, lineEnding, savedLineEnding }
                        return { ...next, dirty: tabIsDirty(next) }
                    })
                })
                if (get().mode === "real" && semanticContentChanged) {
                    const tab = get().ui[get().active]?.tabs.find((t) => t.id === tabId)
                    realDelegate?.backupTab(tabId, normalized, tab?.lineEnding)
                    realDelegate?.lspChange?.(tabId)
                }
            },

            setTabLineEnding: (tabId, lineEnding) => {
                let changed = false
                let backupContent: string | null = null
                upd((p) => {
                    p.tabs = p.tabs.map((t) => {
                        if (t.id !== tabId || t.type !== "file") return t
                        const content = typeof t.content === "string" ? normalizeEditorContent(t.content) : t.content
                        const savedContent = typeof t.savedContent === "string"
                            ? normalizeEditorContent(t.savedContent)
                            : t.savedContent
                        const currentLineEnding = t.lineEnding ?? detectLineEnding(typeof t.content === "string" ? t.content : savedContent)
                        if (currentLineEnding === lineEnding) {
                            const next = {
                                ...t,
                                content,
                                savedContent,
                                lineEnding: currentLineEnding,
                                savedLineEnding: t.savedLineEnding ?? detectLineEnding(typeof t.savedContent === "string" ? t.savedContent : t.content),
                            }
                            return { ...next, dirty: tabIsDirty(next) }
                        }
                        changed = true
                        if (typeof content === "string") backupContent = content
                        const next = {
                            ...t,
                            content,
                            savedContent,
                            lineEnding,
                            savedLineEnding: t.savedLineEnding ?? detectLineEnding(typeof t.savedContent === "string" ? t.savedContent : t.content),
                        }
                        return { ...next, dirty: tabIsDirty(next) }
                    })
                })
                if (get().mode === "real" && changed && backupContent !== null) {
                    realDelegate?.backupTab(tabId, backupContent, lineEnding)
                }
            },

            markExternalFileChange: (workspaceId, eventWorkspaceRoot, eventPath, eventVersion) => {
                if (get().mode === "real") {
                    realDelegate?.onExternalFileChange(workspaceId, eventWorkspaceRoot, eventPath, eventVersion)
                    return
                }
                set((s) => {
                    const ui = s.ui[workspaceId]
                    if (!ui) return {}
                    const ids = externallyChangedTabIds(ui.tabs, eventPath, eventVersion)
                    if (ids.length === 0) return {}
                    const flagged = new Set(ids)
                    const tabs = ui.tabs.map((t) => (flagged.has(t.id) ? { ...t, externalChange: true } : t))
                    return { ui: { ...s.ui, [workspaceId]: { ...ui, tabs } } }
                })
            },

            saveTab: (tabId) => {
                if (get().mode === "real") {
                    realDelegate?.saveFile(tabId)
                    return
                }
                get().showToast("Demo mode — edits are not written to disk")
            },

            reloadTab: (tabId) => {
                if (get().mode === "real") {
                    realDelegate?.reloadFile(tabId)
                    return
                }
                get().showToast("Demo mode — no disk to reload from")
            },

            overwriteTab: (tabId) => {
                if (get().mode === "real") {
                    realDelegate?.saveFile(tabId, true)
                    return
                }
                get().showToast("Demo mode — edits are not written to disk")
            },

            setCursor: (cursor) => {
                const prev = get().cursor
                if (prev?.ln === cursor?.ln && prev?.col === cursor?.col) return
                set({ cursor })
            },

            clearReveal: (tabId) => {
                upd((p) => {
                    const target = p.tabs.find((t) => t.id === tabId)
                    if (!target?.reveal) return
                    p.tabs = p.tabs.map((t) => (t.id === tabId ? { ...t, reveal: undefined } : t))
                })
            },

            gotoDefinition: (path, line, col) => {
                if (get().mode === "real") {
                    realDelegate?.gotoDefinition(path, line, col)
                    return
                }
                get().showToast("Language service needs a real workspace")
            },

            hoverAt: async (path, line, col) => {
                if (get().mode === "real") {
                    return (await realDelegate?.hoverAt(path, line, col)) ?? null
                }
                return null
            },

            completeAt: async (path, line, col) => {
                if (get().mode === "real") {
                    return (await realDelegate?.completeAt(path, line, col)) ?? []
                }
                return []
            },

            findReferences: (path, line, col) => {
                if (get().mode === "real") {
                    realDelegate?.findReferences(path, line, col)
                    return
                }
                get().showToast("Language service needs a real workspace")
            },

            codeActionsAt: (path, line, col) => {
                if (get().mode === "real") {
                    realDelegate?.codeActionsAt(path, line, col)
                    return
                }
                get().showToast("Language service needs a real workspace")
            },

            applyCodeAction: (index) => {
                if (get().mode === "real") {
                    realDelegate?.applyCodeAction(index)
                    return
                }
                get().showToast("Language service needs a real workspace")
            },

            renameSymbol: (path, line, col, newName) => {
                if (get().mode === "real") {
                    realDelegate?.renameSymbol(path, line, col, newName)
                    return
                }
                get().showToast("Language service needs a real workspace")
            },

            restartLspServer: (language) => {
                if (get().mode === "real") {
                    realDelegate?.restartLspServer(language)
                    return
                }
                get().showToast("Language service needs a real workspace")
            },

            closeRefs: () => {
                upd((p) => {
                    p.lspRefs = null
                })
            },

            closeCodeActions: () => {
                upd((p) => {
                    p.lspActions = null
                })
            },

            workspaceSymbols: async (query) => {
                if (get().mode === "real") {
                    return (await realDelegate?.workspaceSymbols(query)) ?? []
                }
                return []
            },

            reloadLang: () => {
                if (get().mode === "real") {
                    realDelegate?.reloadLang()
                    return
                }
                upd((p) => {
                    p.lspLoaded = true
                })
            },

            openSftp: (host) => {
                upd((p) => {
                    ensureTab(p, (t) => t.type === "sftp", () => ({ type: "sftp", title: "sftp · " + host.label.split("@")[1] }))
                    p.sftp = { ...p.sftp, host: host.label }
                    if (p.fn === "agent") p.fn = "ssh"
                })
                if (get().mode === "real") realDelegate?.sftpOpen(host)
            },

            sftpDisconnect: () => {
                if (get().mode === "real") {
                    realDelegate?.sftpDisconnect()
                    return
                }
                get().showToast("SFTP disconnect needs a real workspace")
            },

            sftpReconnect: () => {
                if (get().mode === "real") {
                    realDelegate?.sftpReconnect()
                    return
                }
                get().showToast("SFTP reconnect needs a real workspace")
            },

            sftpRunCommand: (command) => {
                const trimmed = command.trim()
                if (!trimmed) {
                    get().showToast("Type a remote command first")
                    return
                }
                if (get().mode === "real") {
                    realDelegate?.sftpRunCommand(trimmed)
                    return
                }
                get().showToast("SFTP command needs a real workspace")
            },

            openShell: (host) => {
                if (get().mode === "real") {
                    realDelegate?.openShell(host)
                    return
                }
                upd((p) => {
                    ensureTab(p, (t) => t.type === "cmd" && t.title === host.label, () => ({
                        type: "cmd",
                        title: host.label,
                        buf: "",
                        lines: [
                            "❯ ssh " + host.label,
                            "● connected — " + host.sub,
                            host.label.split("@")[0] + "@" + host.label.split("@")[1] + ":~$ ",
                        ],
                    }))
                    if (p.fn === "agent") p.fn = "ssh"
                })
            },

            setCommitMsg: (msg) => {
                upd((p) => {
                    p.commitMsg = msg
                })
            },

            doCommit: () => {
                const s = get()
                const p = s.ui[s.active]
                const msg = p.commitMsg.trim()
                if (!msg) {
                    get().showToast("Type a commit message first")
                    return
                }
                if (s.mode === "real") {
                    realDelegate?.doCommit(msg)
                    return
                }
                const h = Math.random().toString(16).slice(2, 8)
                upd((q) => {
                    q.git = {
                        ...q.git,
                        ahead: q.git.ahead + 1,
                        commits: [
                            { lane: 0, m: msg, a: "yuuzu", h, t: "now", refs: ["main"], par: [1] },
                            ...q.git.commits.map((c) => ({
                                ...c,
                                par: c.par.map((x) => x + 1),
                                refs: c.refs.filter((r) => r !== "main"),
                            })),
                        ],
                    }
                    q.commitMsg = ""
                    q.gitSel = 0
                })
                get().showToast("✓ committed " + h + " — " + msg)
            },

            setGitSel: (idx) => {
                upd((p) => {
                    p.gitSel = idx
                })
                if (get().mode === "real") {
                    const c = get().ui[get().active]?.git.commits[idx]
                    if (c) realDelegate?.selectCommit(c.fullHash ?? c.h)
                }
            },

            setGitFilter: (filter) => {
                upd((p) => {
                    p.gitFilter = filter
                })
            },

            checkoutCommit: (idx) => {
                const c = get().ui[get().active].git.commits[idx]
                if (!c) return
                get().openConfirm({
                    title: "Checkout commit " + c.h,
                    body: "HEAD will move to " + c.h + " — " + c.m + " (detached HEAD).",
                    label: "Checkout",
                    action: () => {
                        if (get().mode === "real") realDelegate?.gitCheckout(c.fullHash ?? c.h, c.h)
                        else get().showToast("Checked out " + c.h + " (detached HEAD)")
                    },
                })
            },

            cherryPickCommit: (idx) => {
                const c = get().ui[get().active].git.commits[idx]
                if (!c) return
                if (get().mode === "real") {
                    realDelegate?.gitCherryPick(c.fullHash ?? c.h, c.h)
                    return
                }
                get().showToast("Cherry-picked " + c.h + " onto " + get().meta[get().active].branch)
            },

            revertCommit: (idx) => {
                const c = get().ui[get().active].git.commits[idx]
                if (!c) return
                get().openConfirm({
                    title: "Revert commit " + c.h,
                    body: "A new commit will be created that undoes " + c.h + " — " + c.m + ".",
                    label: "Revert",
                    danger: true,
                    action: () => {
                        if (get().mode === "real") realDelegate?.gitRevert(c.fullHash ?? c.h, c.h)
                        else get().showToast("Created revert of " + c.h)
                    },
                })
            },

            resetHard: () => {
                const token = confirmationTextForGitAction({ kind: "reset-hard" })
                get().openConfirm({
                    title: "Reset working tree",
                    body: "Discard all staged and unstaged changes.",
                    label: "Reset",
                    danger: true,
                    typed: token,
                    action: () => {
                        if (get().mode === "real") {
                            realDelegate?.gitResetHard(token)
                            return
                        }
                        upd((p) => {
                            p.git = { ...p.git, staged: [], unstaged: [], conflicts: [], hasConflicts: false, conflictChoices: {} }
                        })
                        get().showToast("Reset working tree")
                    },
                })
            },

            resetTo: (idx, mode) => {
                const c = get().ui[get().active].git.commits[idx]
                if (!c) return
                const branch = get().ui[get().active].git.branch || get().meta[get().active].branch
                const token = confirmationTextForGitAction({ kind: "reset-to", short: c.h, mode })
                get().openConfirm({
                    title: "Reset " + branch + " to " + c.h,
                    body: "Move " + branch + " to " + c.h + " using --" + mode + ".",
                    label: "Reset",
                    danger: true,
                    typed: token,
                    action: () => {
                        if (get().mode === "real") {
                            realDelegate?.gitResetTo(c.fullHash ?? c.h, c.h, mode, token)
                            return
                        }
                        upd((p) => {
                            p.git = {
                                ...p.git,
                                branch,
                                commits: p.git.commits.map((commit, i) => ({
                                    ...commit,
                                    refs: i === idx
                                        ? Array.from(new Set([...commit.refs, branch]))
                                        : commit.refs.filter((ref) => ref !== branch),
                                })),
                                staged: mode === "soft" ? p.git.staged : [],
                                unstaged: mode === "hard" ? [] : p.git.unstaged,
                                conflicts: mode === "hard" ? [] : p.git.conflicts,
                                hasConflicts: mode === "hard" ? false : p.git.hasConflicts,
                                conflictChoices: mode === "hard" ? {} : p.git.conflictChoices,
                            }
                            p.gitSel = idx
                        })
                        get().showToast("Reset " + branch + " to " + c.h + " (" + mode + ")")
                    },
                })
            },

            rebaseOnto: (target) => {
                const base = target.trim()
                if (!base) return
                const branch = get().ui[get().active].git.branch || get().meta[get().active].branch
                const token = confirmationTextForGitAction({ kind: "rebase", target: base })
                get().openConfirm({
                    title: "Rebase " + branch,
                    body: "Replay " + branch + " onto " + base + ".",
                    label: "Rebase",
                    danger: true,
                    typed: token,
                    action: () => {
                        if (get().mode === "real") {
                            realDelegate?.gitRebaseOnto(base, token)
                            return
                        }
                        upd((p) => {
                            p.git = { ...p.git, behind: 0 }
                        })
                        get().showToast("Rebased " + branch + " onto " + base)
                    },
                })
            },

            openConflict: (path) => {
                if (get().mode === "real") {
                    realDelegate?.gitOpenConflict(path)
                    return
                }
                const conflict = demoConflict(path)
                upd((p) => {
                    ensureTab(
                        p,
                        (t) => t.type === "conflict" && t.path === path,
                        () => ({
                            type: "conflict",
                            title: "conflict · " + path.split("/").pop(),
                            path,
                            conflict,
                        }),
                    )
                    const prefix = path + ":"
                    p.git = {
                        ...p.git,
                        conflictChoices: Object.fromEntries(
                            Object.entries(p.git.conflictChoices).filter(([key]) => !key.startsWith(prefix)),
                        ),
                    }
                })
            },

            chooseConflictBlock: (blockIdx, side) => {
                upd((p) => {
                    const tab = p.tabs.find((t) => t.id === p.activeTab && t.type === "conflict")
                    const key = tab?.path ? tab.path + ":" + blockIdx : String(blockIdx)
                    p.git = {
                        ...p.git,
                        conflictChoices: { ...p.git.conflictChoices, [key]: side },
                    }
                })
            },

            acceptConflictSide: (path, side) => {
                const token = confirmationTextForGitAction({ kind: "accept-side", side })
                const label = side === "ours" ? "Accept ours" : "Accept theirs"
                get().openConfirm({
                    title: label + " for " + path,
                    body: "Replace the conflicted file with " + side + " and mark it resolved.",
                    label,
                    danger: true,
                    typed: token,
                    action: () => {
                        if (get().mode === "real") {
                            realDelegate?.gitAcceptConflictSide(path, side, token)
                            return
                        }
                        completeConflict(path)
                        get().showToast(label + " · " + path)
                    },
                })
            },

            markResolved: (path) => {
                if (get().mode === "real") {
                    realDelegate?.gitMarkResolved(path)
                    return
                }
                completeConflict(path)
                get().showToast("Marked resolved · " + path)
            },

            toggleBlame: (tabId) => {
                const tab = get().ui[get().active].tabs.find((t) => t.id === tabId)
                if (!tab || tab.type !== "file" || !tab.path) return
                if (tab.blame || tab.blameLoading) {
                    upd((p) => {
                        p.tabs = p.tabs.map((t) => (t.id === tabId ? { ...t, blame: undefined, blameLoading: false } : t))
                    })
                    return
                }
                if (get().mode === "real") {
                    upd((p) => {
                        p.tabs = p.tabs.map((t) => (t.id === tabId ? { ...t, blameLoading: true } : t))
                    })
                    realDelegate?.gitLoadBlame(tabId, tab.path)
                    return
                }
                const content = typeof tab.content === "string" ? tab.content : codeFor(tab.path).src
                upd((p) => {
                    p.tabs = p.tabs.map((t) => (t.id === tabId ? { ...t, blame: demoBlame(tab.path!, content.split("\n").length), blameLoading: false } : t))
                })
            },

            openFileHistory: (path) => {
                if (!path) return
                if (get().mode === "real") {
                    realDelegate?.gitFileHistory(path)
                    return
                }
                get().selectFn("git")
                get().showToast("History for " + path)
            },

            exportCommit: (idx, scope, format) => {
                const c = get().ui[get().active].git.commits[idx]
                if (!c) return
                if (get().mode === "real") {
                    realDelegate?.gitExportCommit(c.fullHash ?? c.h, c.h, scope, format)
                    return
                }
                get().showToast("Export " + c.h + " as " + format)
            },

            openCommitFileDiff: (idx, path) => {
                const c = get().ui[get().active].git.commits[idx]
                if (!c || !path) return
                const hash = c.fullHash ?? c.h
                if (get().mode === "real") {
                    realDelegate?.gitOpenCommitFileDiff(hash, c.h, path)
                    return
                }
                const title = "compare · " + (path.split("/").pop() ?? path)
                upd((p) => {
                    ensureTab(
                        p,
                        (t) => t.type === "diff" && t.path === path && t.diffCommit === hash && t.diffCompare === "worktree",
                        () => ({
                            type: "diff",
                            title,
                            path,
                            diffCommit: hash,
                            diffCompare: "worktree",
                            diff: buildDiff(c).map((line, lineIndex) => ({
                                ...line,
                                oldNo: null,
                                newNo: null,
                                hunkIndex: 0,
                                lineIndex: line.t === "h" ? null : lineIndex - 1,
                            })),
                        }),
                    )
                })
            },

            copyCommitHash: (idx) => {
                const c = get().ui[get().active].git.commits[idx]
                if (!c) return
                const hash = c.fullHash ?? c.h
                if (get().mode === "real") {
                    realDelegate?.copyCommitHash(hash)
                    return
                }
                void writeBrowserClipboardText(hash)
                    .then(() => get().showToast("Copied " + hash))
                    .catch((error) => get().showToast("Copy hash failed: " + messageFromError(error)))
            },

            gitSync: (op) => {
                if (get().mode === "real") {
                    realDelegate?.gitSync(op)
                    return
                }
                const labels = { push: "Pushed to origin", pull: "Pulled from origin", fetch: "Fetched origin — up to date" }
                get().showToast(labels[op])
            },

            openBranchPopup: () => {
                const pid = get().active
                if (!get().ui[pid]) return
                if (get().mode === "real") realDelegate?.gitLoadBranches()
                set((s) => {
                    const p = { ...s.ui[pid] }
                    const current = p.git.branch || s.meta[pid]?.branch || "main"
                    const git = p.git.branchesFull.length || s.mode === "real"
                        ? p.git
                        : { ...p.git, branchesFull: demoBranches(current) }
                    p.git = git
                    p.branchPopupOpen = true
                    return { ui: { ...s.ui, [pid]: p } }
                })
            },

            closeBranchPopup: () => {
                upd((p) => {
                    p.branchPopupOpen = false
                })
            },

            createBranch: (name) => {
                const branch = name.trim()
                if (!branch) return
                if (get().mode === "real") {
                    realDelegate?.gitCreateBranch(branch)
                    return
                }
                upd((p) => {
                    if (!p.git.branchesFull.some((b) => b.name === branch)) {
                        p.git = {
                            ...p.git,
                            branchesFull: [
                                ...p.git.branchesFull,
                                { name: branch, current: false, remote: false, upstream: null, ahead: 0, behind: 0, head_short: p.git.commits[0]?.h ?? "" },
                            ],
                        }
                    }
                })
                get().showToast("Created branch " + branch)
            },

            checkoutBranch: (name) => {
                const branch = name.trim()
                if (!branch) return
                const token = confirmationTextForGitAction({ kind: "checkout", branch })
                get().openConfirm({
                    title: "Checkout branch " + branch,
                    body: "Switch the working tree to " + branch + ".",
                    label: "Checkout",
                    typed: token,
                    action: () => {
                        if (get().mode === "real") {
                            realDelegate?.gitCheckoutBranch(branch, token)
                            return
                        }
                        set((s) => {
                            const pid = s.active
                            const p = { ...s.ui[pid] }
                            const existing = p.git.branchesFull.length ? p.git.branchesFull : demoBranches(p.git.branch || s.meta[pid]?.branch || "main")
                            p.git = {
                                ...p.git,
                                branch,
                                branchesFull: existing.map((b) => ({ ...b, current: b.name === branch })),
                            }
                            p.branchPopupOpen = false
                            return {
                                meta: { ...s.meta, [pid]: { ...s.meta[pid], branch } },
                                ui: { ...s.ui, [pid]: p },
                            }
                        })
                        get().showToast("Checked out " + branch)
                    },
                })
            },

            mergeBranch: (name) => {
                const branch = name.trim()
                if (!branch) return
                if (get().mode === "real") {
                    realDelegate?.gitMergeBranch(branch)
                    return
                }
                get().showToast("Merged " + branch + " into " + (get().ui[get().active].git.branch || get().meta[get().active].branch))
            },

            deleteBranch: (name) => {
                const branch = name.trim()
                if (!branch) return
                const current = get().ui[get().active].git.branch || get().meta[get().active].branch
                if (branch === current) {
                    get().showToast("Cannot delete the current branch")
                    return
                }
                const token = confirmationTextForGitAction({ kind: "delete-branch", branch })
                get().openConfirm({
                    title: "Delete branch " + branch,
                    body: "Delete local branch " + branch + ".",
                    label: "Delete",
                    danger: true,
                    typed: token,
                    action: () => {
                        if (get().mode === "real") {
                            realDelegate?.gitDeleteBranch(branch, token)
                            return
                        }
                        upd((p) => {
                            p.git = { ...p.git, branchesFull: p.git.branchesFull.filter((b) => b.name !== branch) }
                        })
                    },
                })
            },

            renameBranch: (from, to) => {
                const source = from.trim()
                const target = to.trim()
                if (!source || !target || source === target) return
                if (get().mode === "real") {
                    realDelegate?.gitRenameBranch(source, target)
                    return
                }
                set((s) => {
                    const pid = s.active
                    const p = { ...s.ui[pid] }
                    const current = p.git.branch || s.meta[pid]?.branch || "main"
                    p.git = {
                        ...p.git,
                        branch: current === source ? target : p.git.branch,
                        branchesFull: p.git.branchesFull.map((b) => (b.name === source ? { ...b, name: target } : b)),
                    }
                    return {
                        meta: current === source ? { ...s.meta, [pid]: { ...s.meta[pid], branch: target } } : s.meta,
                        ui: { ...s.ui, [pid]: p },
                    }
                })
                get().showToast("Renamed branch " + source + " → " + target)
            },

            openStashPanel: () => {
                const pid = get().active
                if (!get().ui[pid]) return
                if (get().mode === "real") realDelegate?.gitLoadStashes()
                set((s) => {
                    const p = { ...s.ui[pid] }
                    p.git = p.git.stashes.length || s.mode === "real"
                        ? p.git
                        : { ...p.git, stashes: demoStashes() }
                    p.stashPanelOpen = true
                    return { ui: { ...s.ui, [pid]: p } }
                })
            },

            closeStashPanel: () => {
                upd((p) => {
                    p.stashPanelOpen = false
                })
            },

            stashChanges: (message, includeUntracked) => {
                const trimmed = message.trim() || "WIP"
                if (get().mode === "real") {
                    realDelegate?.gitStash(trimmed, includeUntracked)
                    return
                }
                upd((p) => {
                    p.git = {
                        ...p.git,
                        stashes: reindexStashes([
                            { index: 0, message: trimmed + (includeUntracked ? " + untracked" : ""), when_unix: Math.floor(Date.now() / 1000) },
                            ...p.git.stashes,
                        ]),
                    }
                })
                get().showToast("Stashed changes")
            },

            applyStash: (index) => {
                if (get().mode === "real") {
                    realDelegate?.gitStashApply(index)
                    return
                }
                get().showToast("Applied stash@{" + index + "}")
            },

            popStash: (index) => {
                if (get().mode === "real") {
                    realDelegate?.gitStashPop(index)
                    return
                }
                upd((p) => {
                    p.git = { ...p.git, stashes: reindexStashes(p.git.stashes.filter((stash) => stash.index !== index)) }
                })
                get().showToast("Popped stash@{" + index + "}")
            },

            dropStash: (index) => {
                const token = confirmationTextForGitAction({ kind: "drop-stash", index })
                get().openConfirm({
                    title: "Drop stash@{" + index + "}",
                    body: "Delete stash@{" + index + "} permanently.",
                    label: "Drop",
                    danger: true,
                    typed: token,
                    action: () => {
                        if (get().mode === "real") {
                            realDelegate?.gitStashDrop(index, token)
                            return
                        }
                        upd((p) => {
                            p.git = { ...p.git, stashes: reindexStashes(p.git.stashes.filter((stash) => stash.index !== index)) }
                        })
                    },
                })
            },

            stashToBranch: (index, name) => {
                const branch = name.trim()
                if (!branch) return
                if (get().mode === "real") {
                    realDelegate?.gitStashBranch(index, branch)
                    return
                }
                const state = get()
                const currentBranch = state.ui[state.active].git.branch || state.meta[state.active]?.branch
                const knownBranches = knownDemoBranches(currentBranch || "main", state.ui[state.active].git.branchesFull)
                if (knownBranches.some((b) => b.name === branch)) {
                    get().showToast("Branch already exists: " + branch)
                    return
                }
                upd((p) => {
                    p.git = {
                        ...p.git,
                        branchesFull: [
                            ...knownBranches,
                            { name: branch, current: false, remote: false, upstream: null, ahead: 0, behind: 0, head_short: p.git.commits[0]?.h ?? "" },
                        ],
                        stashes: reindexStashes(p.git.stashes.filter((stash) => stash.index !== index)),
                    }
                })
                get().showToast("Created branch " + branch + " from stash@{" + index + "}")
            },

            stageFiles: (paths) => {
                if (!paths.length) return
                if (get().mode === "real") {
                    realDelegate?.gitStage(paths)
                    return
                }
                const selected = new Set(paths)
                upd((p) => {
                    const moving = p.git.unstaged.filter((file) => selected.has(file.path))
                    p.git = {
                        ...p.git,
                        unstaged: p.git.unstaged.filter((file) => !selected.has(file.path)),
                        staged: [
                            ...p.git.staged.filter((file) => !selected.has(file.path)),
                            ...moving.map((file) => ({ ...file, staged: true as const })),
                        ],
                    }
                })
                get().showToast("Staged " + paths.length + " file" + (paths.length === 1 ? "" : "s"))
            },

            unstageFiles: (paths) => {
                if (!paths.length) return
                if (get().mode === "real") {
                    realDelegate?.gitUnstage(paths)
                    return
                }
                const selected = new Set(paths)
                upd((p) => {
                    const moving = p.git.staged.filter((file) => selected.has(file.path))
                    p.git = {
                        ...p.git,
                        staged: p.git.staged.filter((file) => !selected.has(file.path)),
                        unstaged: [
                            ...p.git.unstaged.filter((file) => !selected.has(file.path)),
                            ...moving.map((file) => ({ ...file, staged: false as const })),
                        ],
                    }
                })
                get().showToast("Unstaged " + paths.length + " file" + (paths.length === 1 ? "" : "s"))
            },

            stageAll: () => {
                const paths = get().ui[get().active].git.unstaged.map((file) => file.path)
                get().stageFiles(paths)
            },

            unstageAll: () => {
                const paths = get().ui[get().active].git.staged.map((file) => file.path)
                get().unstageFiles(paths)
            },

            discardFiles: (paths) => {
                if (!paths.length) return
                const token = confirmationTextForGitAction({ kind: "discard", paths })
                get().openConfirm({
                    title: "Discard changes",
                    body: "Discard local changes in " + paths.length + " path" + (paths.length === 1 ? "" : "s") + ".",
                    label: "Discard",
                    danger: true,
                    typed: token,
                    action: () => {
                        if (get().mode === "real") {
                            realDelegate?.gitDiscard(paths, token)
                            return
                        }
                        const selected = new Set(paths)
                        upd((p) => {
                            const conflicts = p.git.conflicts.filter((file) => !selected.has(file.path))
                            p.git = {
                                ...p.git,
                                staged: p.git.staged.filter((file) => !selected.has(file.path)),
                                unstaged: p.git.unstaged.filter((file) => !selected.has(file.path)),
                                conflicts,
                                hasConflicts: conflicts.length > 0,
                            }
                        })
                    },
                })
            },

            openWorkingDiff: (path, staged) => {
                if (get().mode === "real") {
                    realDelegate?.gitOpenDiff(path, staged)
                    return
                }
                const title = (staged ? "staged · " : "diff · ") + path.split("/").pop()
                const diffHunks = demoDiffHunks(path, staged)
                upd((p) => {
                    ensureTab(
                        p,
                        (t) => t.type === "diff" && t.path === path && t.diffStaged === staged,
                        () => ({
                            type: "diff",
                            title,
                            path,
                            diffStaged: staged,
                            diff: demoDiff(path, staged),
                            diffHunks,
                        }),
                    )
                })
            },

            stageHunks: (path, selections) => {
                if (!path || !selections.length) return
                if (get().mode === "real") {
                    realDelegate?.gitStageHunks(path, selections)
                    return
                }
                get().stageFiles([path])
            },

            unstageHunks: (path, selections) => {
                if (!path || !selections.length) return
                if (get().mode === "real") {
                    realDelegate?.gitUnstageHunks(path, selections)
                    return
                }
                get().unstageFiles([path])
            },

            revertHunk: (path, selections) => {
                if (!path || !selections.length) return
                const token = confirmationTextForGitAction({ kind: "discard", paths: [path] })
                get().openConfirm({
                    title: "Revert selected changes",
                    body: "Discard selected local hunks in " + path + ".",
                    label: "Revert",
                    danger: true,
                    typed: token,
                    action: () => {
                        if (get().mode === "real") {
                            realDelegate?.gitRevertHunk(path, selections, token)
                            return
                        }
                        get().showToast("Reverted selected changes in " + path)
                    },
                })
            },

            activateTab: (id) => {
                upd((p) => {
                    p.activeTab = id
                })
            },

            closeTab: (id) => {
                const closing = get().ui[get().active].tabs.find((t) => t.id === id)
                upd((p) => {
                    const idx = p.tabs.findIndex((t) => t.id === id)
                    p.tabs = p.tabs.filter((t) => t.id !== id)
                    if (p.activeTab === id) {
                        const nb = p.tabs[Math.min(idx, p.tabs.length - 1)]
                        p.activeTab = nb ? nb.id : null
                    }
                    if (p.split === id) p.split = null
                })
                evictHlCache(id)
                if (closing && get().mode === "real") realDelegate?.closeTab(closing)
            },

            closeOthers: (id) => {
                const removed = get().ui[get().active].tabs.filter((t) => t.id !== id)
                upd((p) => {
                    p.tabs = p.tabs.filter((t) => t.id === id)
                    p.activeTab = id
                    if (p.split && p.split !== id) p.split = null
                })
                for (const t of removed) evictHlCache(t.id)
                if (get().mode === "real") {
                    for (const t of removed) realDelegate?.closeTab(t)
                }
            },

            closeAllTabs: () => {
                const removed = get().ui[get().active].tabs
                upd((p) => {
                    p.tabs = []
                    p.activeTab = null
                    p.split = null
                })
                for (const t of removed) evictHlCache(t.id)
                if (get().mode === "real") {
                    for (const t of removed) realDelegate?.closeTab(t)
                }
            },

            newTerm: () => {
                if (get().mode === "real") {
                    set({ plusMenu: null })
                    realDelegate?.newTerm()
                    return
                }
                upd((p) => {
                    const n = p.tabs.filter((t) => t.type === "cmd").length + 1
                    const nt: Tab = {
                        id: nextId(),
                        type: "cmd",
                        title: "zsh · " + n,
                        buf: "",
                        lines: ["❯ yuuzu", "◆ workspace ready — type a command"],
                    }
                    p.tabs = [...p.tabs, nt]
                    p.activeTab = nt.id
                    if (p.fn === "agent") p.fn = "files"
                })
                set({ plusMenu: null })
            },

            newBrowser: () => {
                if (get().mode === "real") {
                    upd((p) => {
                        const nt: Tab = { id: nextId(), type: "browser", title: "browser", urlInput: "" }
                        p.tabs = [...p.tabs, nt]
                        p.activeTab = nt.id
                        if (p.fn === "agent") p.fn = "files"
                    })
                    set({ plusMenu: null })
                    return
                }
                const urls: Record<string, [string, "api" | "web"]> = {
                    api: ["localhost:3000/health", "api"],
                    web: ["localhost:5173", "web"],
                }
                const [url, mode] = urls[get().active] ?? ["about:blank", "blank" as const]
                upd((p) => {
                    const nt: Tab = { id: nextId(), type: "browser", title: url.split("/")[0], url, mode: mode as Tab["mode"] }
                    p.tabs = [...p.tabs, nt]
                    p.activeTab = nt.id
                    if (p.fn === "agent") p.fn = "files"
                })
                set({ plusMenu: null })
            },

            newQuery: () => {
                const dbs = get().ui[get().active].dbConns
                set({ plusMenu: null })
                if (!dbs.length || !dbs[0].tables.length) {
                    get().showToast("No database connections in this project")
                    return
                }
                get().openDbTable(0, dbs[0].tables[0])
            },

            toggleSplit: () => {
                upd((p) => {
                    const at = p.tabs.find((t) => t.id === p.activeTab) ?? p.tabs[0] ?? null
                    p.split = p.split ? null : at ? at.id : null
                })
            },

            setSplit: (id) => {
                upd((p) => {
                    p.split = id
                })
            },

            setPlusMenu: (pos) => set({ plusMenu: pos }),

            setTabUrlInput: (tabId, url) => {
                upd((p) => {
                    p.tabs = p.tabs.map((t) => (t.id === tabId ? { ...t, urlInput: url } : t))
                })
            },

            browserGo: (tabId) => {
                const tab = get().ui[get().active].tabs.find((t) => t.id === tabId)
                const url = (tab?.urlInput ?? tab?.url ?? "").trim()
                if (!url) {
                    get().showToast("Type a URL first")
                    return
                }
                if (get().mode === "real") {
                    realDelegate?.browserGo(tabId, url)
                    return
                }
                upd((p) => {
                    p.tabs = p.tabs.map((t) => (t.id === tabId ? { ...t, url, title: url.split("/")[0] } : t))
                })
                get().showToast("Loaded " + url)
            },

            browserCapture: (tabId, bounds) => {
                const tab = get().ui[get().active].tabs.find((t) => t.id === tabId)
                if (!tab?.url) {
                    get().showToast("Type a URL first")
                    return
                }
                if (get().mode === "real") {
                    realDelegate?.browserCapture(tabId, bounds)
                    return
                }
                get().showToast("Browser screenshot needs a real workspace")
            },

            setTermBuf: (tabId, fn) => {
                upd((p) => {
                    p.tabs = p.tabs.map((t) => (t.id === tabId ? { ...t, buf: fn(t.buf ?? "") } : t))
                })
            },

            runTermCmd: (tabId) => {
                const branch = get().meta[get().active].branch
                upd((p) => {
                    p.tabs = p.tabs.map((t) => {
                        if (t.id !== tabId) return t
                        const cmd = (t.buf ?? "").trim()
                        if (cmd === "clear") return { ...t, lines: [], buf: "" }
                        return { ...t, lines: [...(t.lines ?? []), "❯ " + cmd, ...execOut(cmd, branch)], buf: "" }
                    })
                })
            },

            applyOscTitle: (sessionId, rawTitle) => {
                const title = sanitizeTerminalTitle(rawTitle)
                if (!title) return
                set((s) => {
                    const nextUI = { ...s.ui }
                    let changed = false

                    for (const pid of Object.keys(nextUI)) {
                        const p = nextUI[pid]
                        const tabs = p.tabs.map((t) =>
                            t.sessionId === sessionId && !t.titleLocked && t.title !== title ? { ...t, title } : t,
                        )
                        const wins = p.wins.map((w) =>
                            w.sessionId === sessionId && !w.titleLocked && w.title !== title ? { ...w, title } : w,
                        )
                        const tabChanged = tabs.some((tab, idx) => tab !== p.tabs[idx])
                        const winChanged = wins.some((win, idx) => win !== p.wins[idx])

                        if (tabChanged || winChanged) {
                            changed = true
                            nextUI[pid] = { ...p, tabs, wins }
                        }
                    }

                    return changed ? { ui: nextUI } : {}
                })
            },

            renameTerminalTab: (tabId, nextTitle) => {
                const title = nextTitle.trim()
                upd((p) => {
                    p.tabs = p.tabs.map((tab) =>
                        tab.id === tabId
                            ? title
                                ? { ...tab, title, titleLocked: true }
                                : { ...tab, titleLocked: false }
                            : tab,
                    )
                })
            },

            clearTerm: (tabId) => {
                upd((p) => {
                    p.tabs = p.tabs.map((t) => (t.id === tabId ? { ...t, lines: [] } : t))
                })
            },

            killTerm: (tabId) => {
                const tab = get().ui[get().active].tabs.find((t) => t.id === tabId)
                if (get().mode === "real" && tab?.sessionId && !tab.exited) {
                    realDelegate?.termKill(tab.sessionId)
                    get().showToast("SIGTERM sent to " + (tab.title ?? "session"))
                    return
                }
                get().showToast("SIGTERM sent")
            },

            sftpSelect: (pane, idx) => {
                upd((p) => {
                    p.sftp = { ...p.sftp, sel: { pane, idx }, focus: pane }
                })
            },

            sftpFocus: (pane) => {
                upd((p) => {
                    p.sftp = { ...p.sftp, focus: pane }
                })
            },

            sftpCopy: () => {
                const p = get().ui[get().active]
                const sf = p.sftp
                if (!sf.sel) return
                const file = sf[sf.sel.pane][sf.sel.idx]
                if (!file) return
                upd((q) => {
                    q.sftp = { ...q.sftp, clip: { ...file, from: sf.sel!.pane, idx: sf.sel!.idx } }
                })
                get().showToast("Copied " + file.name + " — click the other pane, then ⌘/Ctrl V")
            },

            sftpPaste: () => {
                const p = get().ui[get().active]
                const sf = p.sftp
                if (!sf.clip) return
                const target = sf.focus
                const clip = sf.clip
                if (clip.from === target) {
                    get().showToast("Click the other pane first, then paste")
                    return
                }
                if (get().mode === "real") {
                    upd((q) => {
                        q.sftp = { ...q.sftp, clip: null }
                    })
                    realDelegate?.sftpTransfer(clip.from, clip.idx)
                    return
                }
                upd((q) => {
                    const list = [...q.sftp[target]]
                    if (!list.find((f) => f.name === clip.name)) {
                        list.push({ chip: clip.chip, name: clip.name, size: clip.size, isNew: true })
                    }
                    q.sftp = { ...q.sftp, [target]: list, clip: null }
                })
                get().showToast(
                    clip.name + " → " + (target === "remote" ? sf.remotePath : sf.localPath) + " · transferred via SFTP ✓",
                )
            },

            sftpTransfer: (from, idx, to) => {
                if (from === to) return
                if (get().mode === "real") {
                    realDelegate?.sftpTransfer(from, idx)
                    return
                }
                let moved = ""
                upd((q) => {
                    const file = q.sftp[from][idx]
                    if (!file) return
                    moved = file.name
                    const list = [...q.sftp[to]]
                    if (!list.find((f) => f.name === file.name)) {
                        list.push({ ...file, isNew: true })
                    }
                    q.sftp = { ...q.sftp, [to]: list, focus: to }
                })
                if (moved) {
                    get().showToast(moved + " → " + (to === "remote" ? "remote" : "local") + " · transferred via SFTP ✓")
                }
            },

            sftpDelete: (pane, idx) => {
                const file = get().ui[get().active].sftp[pane][idx]
                if (!file) return
                if (get().mode === "real") {
                    get().openConfirm({
                        title: "Delete " + file.name,
                        body: pane === "local"
                            ? "The local file will be deleted from disk."
                            : "Remote delete is not supported yet.",
                        label: "Delete",
                        danger: true,
                        action: () => realDelegate?.sftpDelete(pane, idx),
                    })
                    return
                }
                upd((q) => {
                    q.sftp = { ...q.sftp, [pane]: q.sftp[pane].filter((_, xi) => xi !== idx), sel: null }
                })
                get().showToast("Deleted " + file.name + " from " + pane)
            },

            sftpEnter: (pane, idx) => {
                if (get().mode === "real") {
                    realDelegate?.sftpEnter(pane, idx)
                    return
                }
                const file = idx >= 0 ? get().ui[get().active].sftp[pane][idx] : null
                if (file?.chip === "dir") get().showToast("Demo mode — directory browsing needs a real host")
            },

            azNew: () => {
                if (get().mode === "real") {
                    realDelegate?.azNew()
                    return
                }
                const meta = get().meta[get().active]
                upd((p) => {
                    const win = mkWin("zsh · session " + (p.wins.length + 1), "shell", [
                        "❯ yuuzu",
                        "◆ terminal session in ~/dev/" + meta.name + " — run anything; try claude",
                    ])
                    p.wins = [...p.wins, win]
                    p.fn = "agent"
                    p.azActive = win.id
                })
            },

            azClose: (id) => {
                const win = get().ui[get().active].wins.find((w) => w.id === id)
                upd((p) => {
                    p.wins = p.wins.filter((w) => w.id !== id)
                    if (p.azActive === id) p.azActive = p.wins[0]?.id ?? null
                })
                if (win?.sessionId && get().mode === "real") realDelegate?.azClose(win.sessionId)
            },

            azCollapse: (id) => {
                upd((p) => {
                    p.wins = p.wins.map((w) => (w.id === id ? { ...w, min: !w.min, max: false } : w))
                })
            },

            azMax: (id) => {
                upd((p) => {
                    p.wins = p.wins.map((w) => (w.id === id ? { ...w, max: !w.max, min: false } : { ...w, max: false }))
                })
            },

            azFront: (id) => {
                upd((p) => {
                    p.azActive = id
                })
            },

            azFocusFromPanel: (id) => {
                upd((p) => {
                    p.fn = "agent"
                    p.azActive = id
                    p.wins = p.wins.map((w) => (w.id === id ? { ...w, max: true, min: false } : { ...w, max: false }))
                })
            },

            azExitMax: () => {
                upd((p) => {
                    p.wins = p.wins.map((w) => ({ ...w, max: false }))
                })
            },

            setAzBuf: (id, fn) => {
                upd((p) => {
                    p.wins = p.wins.map((w) => (w.id === id ? { ...w, buf: fn(w.buf) } : w))
                })
            },

            runAzCmd: (id) => {
                const branch = get().meta[get().active].branch
                upd((p) => {
                    p.wins = p.wins.map((w) => {
                        if (w.id !== id) return w
                        const cmd = w.buf.trim()
                        if (cmd === "clear") return { ...w, lines: [], buf: "" }
                        return { ...w, lines: [...w.lines, "❯ " + cmd, ...execOut(cmd, branch)], buf: "" }
                    })
                })
            },

            renameAgentSession: (winId, nextTitle) => {
                const title = nextTitle.trim()
                upd((p) => {
                    p.wins = p.wins.map((win) =>
                        win.id === winId
                            ? title
                                ? { ...win, title, titleLocked: true }
                                : { ...win, titleLocked: false }
                            : win,
                    )
                })
            },

            openCtx: (target) => set({ ctx: target, plusMenu: null }),
            closeCtx: () => set({ ctx: null }),

            openPalette: () => set({ pal: { open: true, q: "" }, ctx: null, plusMenu: null }),
            closePalette: () => set({ pal: { open: false, q: "" } }),
            setPaletteQuery: (fn) => set((s) => ({ pal: { open: true, q: fn(s.pal.q) } })),

            openSettings: () => set({ stOpen: true, ctx: null, plusMenu: null }),
            closeSettings: () => set({ stOpen: false }),
            setSettingsSection: (id) => {
                set({ stSec: id })
                if (id === "performance" || id === "diagnostics" || id === "recovery") get().loadStability()
            },
            setSetting: (key, value) => {
                set((s) => ({ stVals: { ...s.stVals, [key]: value } }))
                persistSettings(get().stVals)
                if (key === "theme" && typeof value === "string" && value !== get().theme) {
                    get().toggleTheme()
                }
            },

            loadStability: () => {
                if (get().mode === "real") {
                    realDelegate?.loadStability()
                    return
                }
                set({ stab: demoStability() })
            },

            refreshMetric: () => {
                if (get().mode === "real") {
                    realDelegate?.refreshMetric()
                    return
                }
                set((s) => ({
                    stab: {
                        ...s.stab,
                        metric: {
                            memoryBytes: 180 * 1024 * 1024 + Math.round(Math.random() * 8 * 1024 * 1024),
                            uptimeMs: 3_600_000,
                            workspaceCount: s.order.length,
                            docsIndexEntries: 0,
                            fileTreeEntries: 42,
                            processId: 0,
                        },
                    },
                }))
            },

            restoreBackup: (id) => {
                if (get().mode === "real") {
                    realDelegate?.restoreBackup(id)
                    return
                }
                get().showToast("Demo mode — no backups to restore")
            },

            discardBackup: (id) => {
                get().openConfirm({
                    title: "Discard backup",
                    body: "This backup will be permanently deleted.",
                    label: "Discard",
                    danger: true,
                    action: () => {
                        if (get().mode === "real") {
                            realDelegate?.discardBackup(id)
                            return
                        }
                        set((s) => ({ stab: { ...s.stab, backups: s.stab.backups.filter((backup) => backup.id !== id) } }))
                    },
                })
            },

            openConfirm: (confirm) => set({ confirm, ctx: null, plusMenu: null }),
            closeConfirm: () => set({ confirm: null }),
            setNodeNameValue: (value) => set((s) => s.nodeNameDialog
                ? { nodeNameDialog: { ...s.nodeNameDialog, value, error: null } }
                : {}),
            closeNodeNameDialog: () => set({ nodeNameDialog: null }),
            submitNodeNameDialog: () => {
                const dialog = get().nodeNameDialog
                if (!dialog) return
                const name = dialog.value.trim()
                if (!name) {
                    set({ nodeNameDialog: { ...dialog, error: "Name is required" } })
                    return
                }
                if (name.includes("/") || name.includes("\\")) {
                    set({ nodeNameDialog: { ...dialog, error: "Name must be a single path segment" } })
                    return
                }
                set({ nodeNameDialog: null })
                if (get().mode === "real") realDelegate?.addNode(dialog.dirPath, dialog.kind, name)
            },
        }
    })
}

export const v2Store = createV2Store()
export const useV2Store = v2Store

// Token chip helper for the editor header.
export function tokenChipFor(path: string): { tokens: string; pct: string } {
    const src = codeFor(path).src
    const tk = estTokens(src)
    return { tokens: fmtK(tk), pct: ctxPct(tk) }
}
