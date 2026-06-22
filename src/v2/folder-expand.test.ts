/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"

import { ensureTestDom } from "../test/test-dom"

ensureTestDom()

const ROOT = "/ws/demo"
const VERSION = { modified_ms: 10, len: 4 }
let blockWrite = false
const writeResolvers: Array<() => void> = []
let blockSftpList = false
const sftpListResolvers: Array<() => void> = []
const savedBackups: Array<{ path: string; content: string }> = []
const writeFileCalls: any[] = []
let pickedFolder: string | null = "/tmp/export-target"
let exportFailure: unknown = null
const exportCalls: any[] = []
const compareCommitFileCalls: any[] = []
const hunkStageCalls: any[] = []
const lspCalls: Array<{ cmd: string; args: any }> = []
const dbHistoryCalls: any[] = []
const remoteConnectCalls: any[] = []
const remoteDisconnectCalls: any[] = []
const remoteCommandCalls: any[] = []
const saveRemoteHostCalls: any[] = []
const deleteRemoteHostCalls: any[] = []
const terminalSpawnCalls: any[] = []
const terminalWriteCalls: any[] = []
const sshSpawnCalls: any[] = []
const sshWriteCalls: any[] = []
const sshResizeCalls: any[] = []
const browserCaptureCalls: any[] = []
const createTextFileCalls: any[] = []
const createDirectoryCalls: any[] = []
const deletePathCalls: any[] = []
const gitStatusCalls: any[] = []
const eventHandlers: Record<string, Array<(payload: any) => void>> = {}
let remoteHosts: any[] = []
let sshTerminalSessions: any[] = []
let workspaceDiagnostics: any[] = []
let renameEdit: unknown = null
let ensureReadiness: "Ready" | "MissingCommand" | "Error" = "Ready"
let blockEnsure = false
const ensureResolvers: Array<() => void> = []
let sshSpawnSeq = 0

function mockDiff(path: string, staged: boolean) {
    return {
        path,
        staged,
        binary: false,
        truncated: false,
        hunks: [{
            header: "@@ -1,1 +1,1 @@",
            old_start: 1,
            old_lines: 1,
            new_start: 1,
            new_lines: 1,
            lines: [
                { kind: "del", old_no: 1, new_no: null, text: "old", word_ranges: [] },
                { kind: "add", old_no: null, new_no: 1, text: staged ? "staged" : "working", word_ranges: [] },
            ],
        }],
    }
}

async function waitFor(fn: () => boolean): Promise<void> {
    for (let i = 0; i < 100; i += 1) {
        if (fn()) return
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error("condition timed out")
}

mock.module("@tauri-apps/api/core", () => ({
    invoke: async (cmd: string, args: any) => {
        if (cmd === "list_workspaces") {
            return { active_workspace_id: "demo", workspaces: [{ id: "demo", name: "demo", path: ROOT, pinned: false }] }
        }
        if (cmd === "scan_workspace") {
            if (args.path !== ROOT) throw "workspace not registered: " + args.path
            return [{ name: "src", path: ROOT + "/src", is_dir: true }]
        }
        if (cmd === "scan_directory") {
            if (args.workspaceRoot !== ROOT) throw "workspace not registered: " + args.workspaceRoot
            if (!String(args.path).startsWith(ROOT)) throw "path outside workspace: " + args.path
            return [
                { name: "v2", path: ROOT + "/src/v2", is_dir: true },
                { name: "App.tsx", path: ROOT + "/src/App.tsx", is_dir: false },
            ]
        }
        if (cmd === "read_text_file") {
            return { path: args.path, content: "disk", version: VERSION, too_large: false }
        }
        if (cmd === "create_text_file") {
            createTextFileCalls.push(args)
            return { path: args.relativePath, version: VERSION }
        }
        if (cmd === "create_directory") {
            createDirectoryCalls.push(args)
            return { path: args.relativePath, version: null }
        }
        if (cmd === "delete_path") {
            deletePathCalls.push(args)
            return null
        }
        if (cmd === "write_text_file") {
            writeFileCalls.push(args)
            if (blockWrite) {
                await new Promise<void>((resolve) => writeResolvers.push(resolve))
            }
            return { path: args.path, version: { modified_ms: 20, len: String(args.content).length } }
        }
        if (cmd === "spawn_terminal_session") {
            terminalSpawnCalls.push(args)
            return { id: "term-local-1", workspace_id: args.workspaceId, name: args.name, running: true }
        }
        if (cmd === "write_terminal_session") {
            terminalWriteCalls.push(args)
            return null
        }
        if (cmd === "spawn_ssh_terminal") {
            sshSpawnCalls.push(args)
            sshSpawnSeq += 1
            return {
                id: "ssh-" + sshSpawnSeq,
                host_id: args.profileId,
                workspace_id: args.workspaceId,
                name: "deploy@example.com",
                running: true,
            }
        }
        if (cmd === "write_ssh_terminal") {
            sshWriteCalls.push(args)
            return null
        }
        if (cmd === "resize_ssh_terminal") {
            sshResizeCalls.push(args)
            return null
        }
        if (cmd === "save_unsaved_backup") {
            savedBackups.push({ path: args.path, content: args.content })
            return {
                id: "b1",
                workspace_id: "demo",
                workspace_root: ROOT,
                path: args.path,
                content: args.content,
                version: args.version,
                updated_ms: 1,
            }
        }
        if (cmd === "list_unsaved_backups") {
            return [{
                id: "b1",
                workspace_id: "demo",
                workspace_root: ROOT,
                path: "src/App.tsx",
                content: "draft",
                version: VERSION,
                updated_ms: 1,
            }]
        }
        if (cmd === "discard_unsaved_backup") return null
        if (cmd === "metric_snapshot") {
            return {
                timestamp_ms: 1,
                process_id: 1,
                memory_bytes: null,
                uptime_ms: 1000,
                workspace_count: 1,
                active_workspace_id: "demo",
                docs_index_entries: args.docsIndexEntries,
                file_tree_entries: args.fileTreeEntries,
            }
        }
        if (cmd === "list_diagnostic_events") return []
        if (cmd === "append_diagnostic_event") return {
            id: "e1",
            timestamp_ms: 1,
            level: args.event.level,
            source: args.event.source,
            message: args.event.message,
        }
        if (cmd === "lsp_server_status") {
            lspCalls.push({ cmd, args })
            return []
        }
        if (cmd === "lsp_server_logs") {
            lspCalls.push({ cmd, args })
            return []
        }
        if (cmd === "lsp_workspace_diagnostics") {
            lspCalls.push({ cmd, args })
            return workspaceDiagnostics
        }
        if (cmd === "lsp_ensure_document") {
            lspCalls.push({ cmd, args })
            if (blockEnsure) {
                await new Promise<void>((resolve) => ensureResolvers.push(resolve))
            }
            const state = ensureReadiness === "Ready" ? "Running" : ensureReadiness
            const lastError = ensureReadiness === "Ready" ? null : "command not found"
            return {
                workspace_id: args.workspaceId,
                workspace_root: args.workspaceRoot,
                path: args.path,
                language: "TypeScript",
                readiness: ensureReadiness,
                command: "typescript-language-server",
                last_error: lastError,
                server: {
                    workspace_id: args.workspaceId,
                    workspace_root: args.workspaceRoot,
                    language: "TypeScript",
                    display_name: "TypeScript",
                    command: "typescript-language-server",
                    state,
                    pid: ensureReadiness === "Ready" ? 123 : null,
                    memory_bytes: null,
                    open_documents: ensureReadiness === "Ready" ? 1 : 0,
                    last_error: lastError,
                },
            }
        }
        if (cmd === "lsp_open_document") {
            lspCalls.push({ cmd, args })
            return {
                workspace_id: args.workspaceId,
                workspace_root: args.workspaceRoot,
                language: "TypeScript",
                display_name: "TypeScript",
                command: "typescript-language-server",
                state: "Running",
                pid: 123,
                memory_bytes: null,
                open_documents: 1,
                last_error: null,
            }
        }
        if (cmd === "lsp_document_diagnostics") {
            lspCalls.push({ cmd, args })
            return [{
                path: args.path,
                range: { start_line: 0, start_character: 0, end_line: 0, end_character: 4 },
                severity: "Error",
                message: "mock diagnostic",
                source: "mock-lsp",
            }]
        }
        if (cmd === "lsp_close_document") {
            lspCalls.push({ cmd, args })
            return {
                workspace_id: args.workspaceId,
                workspace_root: args.workspaceRoot,
                language: "TypeScript",
                display_name: "TypeScript",
                command: "typescript-language-server",
                state: "Running",
                pid: 123,
                memory_bytes: null,
                open_documents: 0,
                last_error: null,
            }
        }
        if (cmd === "lsp_definition") {
            lspCalls.push({ cmd, args })
            return []
        }
        if (cmd === "lsp_references") {
            lspCalls.push({ cmd, args })
            return []
        }
        if (cmd === "lsp_code_actions") {
            lspCalls.push({ cmd, args })
            return []
        }
        if (cmd === "lsp_rename") {
            lspCalls.push({ cmd, args })
            return renameEdit
        }
        if (cmd === "lsp_restart_server") {
            lspCalls.push({ cmd, args })
            return {
                workspace_id: args.workspaceId,
                workspace_root: args.workspaceRoot,
                language: "TypeScript",
                display_name: "TypeScript",
                state: "Running",
                pid: 123,
                memory_bytes: null,
                open_documents: 1,
                last_error: null,
            }
        }
        if (cmd === "git_export_commit") {
            exportCalls.push(args)
            if (exportFailure) throw exportFailure
            return { written_files: 2 }
        }
        if (cmd === "git_commit_file_diff") return mockDiff(args.path, false)
        if (cmd === "git_commit_file_worktree_diff") {
            compareCommitFileCalls.push(args)
            return mockDiff(args.path, false)
        }
        if (cmd === "git_diff_hunks") return mockDiff(args.path, args.staged)
        if (cmd === "git_stage_hunks") {
            hunkStageCalls.push(args)
            return null
        }
        if (cmd === "git_status") {
            gitStatusCalls.push(args)
            return {
                workspace_root: ROOT,
                repository_root: ROOT,
                branch: "main",
                upstream: null,
                ahead: 0,
                behind: 0,
                clean: true,
                has_conflicts: false,
                changes: [],
            }
        }
        if (cmd === "git_log_page") return { rows: [], has_more: false, total_loaded: 0, truncated: false }
        if (cmd === "list_database_profiles") return []
        if (cmd === "list_database_query_history") {
            dbHistoryCalls.push(args)
            return [{
                sql: "UPDATE users SET active = 0 WHERE last_seen < ?",
                kind: "Mutation",
                executed_ms: 1_700_000_000_000,
                affected_rows: 3,
                row_count: null,
            }]
        }
        if (cmd === "list_remote_hosts") return remoteHosts
        if (cmd === "save_remote_host") {
            saveRemoteHostCalls.push(args)
            const input = args.input
            const profile = {
                id: input.id ?? "host-" + (remoteHosts.length + 1),
                workspace_root: input.workspace_root,
                name: input.name,
                host: input.host,
                port: input.port,
                username: input.username,
                auth: input.auth_kind === "Agent" ? "Agent" : { Password: { secret_id: "secret" } },
                default_remote_path: input.default_remote_path,
                keepalive_seconds: input.keepalive_seconds,
                connect_timeout_seconds: input.connect_timeout_seconds,
                created_ms: 1,
                updated_ms: 2,
            }
            remoteHosts = [...remoteHosts.filter((host) => host.id !== profile.id), profile]
            return profile
        }
        if (cmd === "delete_remote_host") {
            deleteRemoteHostCalls.push(args)
            remoteHosts = remoteHosts.filter((host) => host.id !== args.profileId)
            return null
        }
        if (cmd === "list_ssh_terminal_sessions") return sshTerminalSessions
        if (cmd === "connect_remote_host") {
            remoteConnectCalls.push(args)
            return { host_id: args.profileId, status: "Connected", message: null, checked_ms: 10 }
        }
        if (cmd === "disconnect_remote_host") {
            remoteDisconnectCalls.push(args)
            return { host_id: args.profileId, status: "Disconnected", message: null, checked_ms: 11 }
        }
        if (cmd === "run_remote_command") {
            remoteCommandCalls.push(args)
            return {
                host_id: args.profileId,
                command: args.command,
                stdout: "ok from " + args.command,
                stderr: "",
                exit_code: 0,
                duration_ms: 32,
            }
        }
        if (cmd === "list_sftp_directory") {
            if (blockSftpList) {
                await new Promise<void>((resolve) => sftpListResolvers.push(resolve))
            }
            return [{
                host_id: args.profileId,
                path: String(args.path).replace(/\/$/, "") + "/app.log",
                name: "app.log",
                kind: "File",
                size: 128,
                modified_ms: null,
                link_target: null,
            }]
        }
        if (cmd === "browser_capture_preview") {
            browserCaptureCalls.push(args)
            return {
                id: "shot-1",
                workspace_root: args.workspaceRoot,
                url: args.request.url,
                title: args.request.title,
                data_url: "data:image/png;base64,ZmFrZQ==",
                width: args.request.bounds.width,
                height: args.request.bounds.height,
                captured_ms: 12,
            }
        }
        if (cmd === "switch_workspace") {
            return { active_workspace_id: "demo", workspaces: [{ id: "demo", name: "demo", path: ROOT, pinned: false }] }
        }
        return null
    },
    transformCallback: () => 0,
    Channel: class { onmessage: any = null },
}))

mock.module("@tauri-apps/plugin-dialog", () => ({
    open: async () => pickedFolder,
}))

mock.module("@tauri-apps/api/event", () => ({
    listen: async (event: string, handler: (event: { payload: any }) => void) => {
        const handlers = eventHandlers[event] ?? []
        const wrapped = (payload: any) => handler({ payload })
        handlers.push(wrapped)
        eventHandlers[event] = handlers
        return () => {
            eventHandlers[event] = (eventHandlers[event] ?? []).filter((item) => item !== wrapped)
        }
    },
}))

;(window as any).__TAURI_INTERNALS__ = {}

const { bootstrapV2, handleSshTerminalExit, handleSshTerminalOutput, resizeSession, restoreSshTerminalSessions, writeToSession } = await import("./controller")
const { emptyUI, v2Store } = await import("./v2-store")
const { findNode } = await import("./bridge")
const { replayTerminalOutput } = await import("../features/terminal/terminal-replay-buffer")

async function ensureMockWorkspace(): Promise<void> {
    await bootstrapV2()
    blockWrite = false
    blockSftpList = false
    writeResolvers.length = 0
    sftpListResolvers.length = 0
    savedBackups.length = 0
    writeFileCalls.length = 0
    workspaceDiagnostics = []
    renameEdit = null
    ensureReadiness = "Ready"
    blockEnsure = false
    for (const resolve of ensureResolvers.splice(0)) resolve()
    lspCalls.length = 0
    dbHistoryCalls.length = 0
    remoteConnectCalls.length = 0
    remoteDisconnectCalls.length = 0
    remoteCommandCalls.length = 0
    saveRemoteHostCalls.length = 0
    deleteRemoteHostCalls.length = 0
    terminalSpawnCalls.length = 0
    terminalWriteCalls.length = 0
    sshSpawnCalls.length = 0
    sshWriteCalls.length = 0
    sshResizeCalls.length = 0
    sshSpawnSeq = 0
    remoteHosts = []
    sshTerminalSessions = []
    browserCaptureCalls.length = 0
    createTextFileCalls.length = 0
    createDirectoryCalls.length = 0
    deletePathCalls.length = 0
    gitStatusCalls.length = 0
    await waitFor(() => Boolean(v2Store.getState().mode))
    v2Store.setState((s) => {
        const base = emptyUI()
        const existing = s.ui.demo ?? base
        return {
            mode: "real",
            active: "demo",
            order: ["demo"],
            nodeNameDialog: null,
            meta: {
                ...s.meta,
                demo: {
                    id: "demo",
                    name: "demo",
                    glyph: "DE",
                    branch: "main",
                    bg: "var(--yz-1b2410)",
                    fg: "var(--yz-a8e23f)",
                    bd: "var(--yz-45611a)",
                    root: ROOT,
                },
            },
            ui: {
                ...s.ui,
                demo: {
                    ...base,
                    ...existing,
                    fn: "files",
                    open: {},
                    tabs: [],
                    activeTab: null,
                    split: null,
                    sftp: base.sftp,
                    sshHosts: [],
                    sshProfiles: [],
                    treeData: [{ n: "src", d: [], p: ROOT + "/src", loaded: false }],
                    treeLoaded: true,
                    diagnosticsByPath: {},
                    lspServers: [],
                    lspLogs: [],
                    lspRefs: null,
                    lspLoaded: false,
                },
            },
            ctx: null,
            confirm: null,
            toast: null,
        }
    })
}

function patchDemoProject(mut: (project: ReturnType<typeof emptyUI>) => void): void {
    v2Store.setState((s) => {
        const project = { ...s.ui.demo }
        mut(project)
        return { ui: { ...s.ui, demo: project } }
    })
}

async function seedExportCommit(): Promise<void> {
    await ensureMockWorkspace()
    pickedFolder = "/tmp/export-target"
    exportFailure = null
    exportCalls.length = 0
    compareCommitFileCalls.length = 0
    hunkStageCalls.length = 0
    v2Store.setState((s) => {
        const demoMeta = s.meta.demo ?? {
                id: "demo",
                name: "demo",
                glyph: "DE",
                branch: "main",
                bg: "var(--yz-1b2410)",
                fg: "var(--yz-a8e23f)",
                bd: "var(--yz-45611a)",
        }
        return {
            active: "demo",
            meta: {
                ...s.meta,
                demo: { ...demoMeta, root: ROOT },
            },
            ui: {
                ...s.ui,
                demo: {
                    ...s.ui.demo,
                    git: {
                        ...s.ui.demo.git,
                        commits: [{
                            lane: 0,
                            m: "Exportable commit",
                            a: "Ada",
                            h: "abc123",
                            t: "now",
                            refs: [],
                            par: [],
                            fullHash: "abcdef1234567890",
                        }],
                    },
                    gitLoaded: true,
                },
            },
            toast: null,
        }
    })
}

describe("real folder expansion", () => {
    test("loads descendant folders through scan_directory", async () => {
        await ensureMockWorkspace()

        const pid = v2Store.getState().active
        expect(v2Store.getState().ui[pid].treeLoaded).toBe(true)
        expect(findNode(v2Store.getState().ui[pid].treeData, "src")?.d).toEqual([])

        v2Store.getState().toggleDir("src")
        await new Promise((resolve) => setTimeout(resolve, 30))

        const ui = v2Store.getState().ui[pid]
        expect(ui.open.src).toBe(true)
        const srcNode = findNode(ui.treeData, "src")
        expect(srcNode?.loaded).toBe(true)
        expect(srcNode?.d?.length).toBeGreaterThan(0)
        expect(srcNode?.d?.some((n) => n.n === "v2")).toBe(true)
    })

    test("creates a named folder through the real delegate and refreshes git", async () => {
        await ensureMockWorkspace()
        const originalPrompt = window.prompt
        window.prompt = () => {
            throw new Error("window.prompt must not be used for Explorer creation")
        }

        try {
            v2Store.getState().addNode("src", "dir")
            expect(v2Store.getState().nodeNameDialog).toMatchObject({
                dirPath: "src",
                kind: "dir",
                value: "new-folder",
            })
            v2Store.getState().setNodeNameValue("feature")
            v2Store.getState().submitNodeNameDialog()

            await waitFor(() => createDirectoryCalls.length === 1)
            await waitFor(() => gitStatusCalls.length > 0)
            expect(createDirectoryCalls[0]).toEqual({ workspaceRoot: ROOT, relativePath: "src/feature" })
            expect(v2Store.getState().toast).toBe("Created folder src/feature")
        } finally {
            window.prompt = originalPrompt
        }
    })

    test("creates a named file through the real delegate instead of hardcoded untitled.ts", async () => {
        await ensureMockWorkspace()

        v2Store.getState().addNode("src", "file")
        expect(v2Store.getState().nodeNameDialog).toMatchObject({
            dirPath: "src",
            kind: "file",
            value: "untitled.ts",
        })
        v2Store.getState().setNodeNameValue("named.ts")
        v2Store.getState().submitNodeNameDialog()

        await waitFor(() => createTextFileCalls.length === 1)
        expect(createTextFileCalls[0]).toEqual({ workspaceRoot: ROOT, relativePath: "src/named.ts" })
        expect(createTextFileCalls[0].relativePath).not.toBe("src/untitled.ts")
    })

    test("opens workspace html files in the built-in browser only from the explicit browser action", async () => {
        await ensureMockWorkspace()
        patchDemoProject((project) => {
            project.treeData = [{
                n: "public",
                p: ROOT + "/public",
                loaded: true,
                d: [{ n: "index.html", p: ROOT + "/public/index.html" }],
            }]
        })

        v2Store.getState().openFile("public/index.html")

        await waitFor(() => Boolean(v2Store.getState().ui.demo.tabs.find((tab) => tab.type === "file" && tab.path === "public/index.html")?.content))
        const editorTab = v2Store.getState().ui.demo.tabs.find((item) => item.type === "file" && item.path === "public/index.html")!
        expect(editorTab.title).toBeUndefined()
        expect(editorTab.name).toBe("index.html")
        expect(editorTab.realPath).toBe(ROOT + "/public/index.html")
        expect(editorTab.content).toBe("disk")
        expect(v2Store.getState().ui.demo.activeTab).toBe(editorTab.id)
        expect(v2Store.getState().ui.demo.tabs.some((item) => item.type === "browser" && item.path === "public/index.html")).toBe(false)

        ;(v2Store.getState() as any).openFileInBrowser("public/index.html")

        await waitFor(() => Boolean(v2Store.getState().ui.demo.tabs.find((tab) => tab.type === "browser" && tab.path === "public/index.html")?.htmlPreview))
        const tab = v2Store.getState().ui.demo.tabs.find((item) => item.type === "browser" && item.path === "public/index.html")!
        expect(tab.title).toBe("index.html")
        expect(tab.realPath).toBe(ROOT + "/public/index.html")
        expect(tab.url).toBe("workspace://public/index.html")
        expect(tab.htmlPreview).toBe("disk")
        expect(v2Store.getState().ui.demo.activeTab).toBe(tab.id)
        expect(v2Store.getState().ui.demo.tabs.some((item) => item.type === "file" && item.path === "public/index.html")).toBe(true)

        ;(v2Store.getState() as any).openFileInBrowser("public/index.html")

        expect(v2Store.getState().ui.demo.tabs.filter((item) => item.type === "browser" && item.path === "public/index.html")).toHaveLength(1)
        expect(v2Store.getState().ui.demo.activeTab).toBe(tab.id)
    })

    test("delete opens a confirmation before removing files and refreshes git after confirmation", async () => {
        await ensureMockWorkspace()

        v2Store.getState().deleteNode("src/v2")

        expect(deletePathCalls).toEqual([])
        expect(v2Store.getState().confirm?.title).toBe("Delete src/v2")
        expect(v2Store.getState().confirm?.danger).toBe(true)

        v2Store.getState().confirm?.action()
        await waitFor(() => deletePathCalls.length === 1)
        await waitFor(() => gitStatusCalls.length > 0)
        expect(deletePathCalls[0]).toEqual({ workspaceRoot: ROOT, path: "src/v2" })
    })

    test("ignores internal git watcher events instead of refreshing the graph repeatedly", async () => {
        await ensureMockWorkspace()

        v2Store.getState().markExternalFileChange("demo", ROOT, ROOT + "/.git/index.lock", null)
        await new Promise((resolve) => setTimeout(resolve, 240))

        expect(gitStatusCalls).toEqual([])
    })

    test("database history delegate loads real query history into the tab", async () => {
        await ensureMockWorkspace()
        patchDemoProject((project) => {
            project.tabs = [{
                id: 9101,
                type: "db",
                title: "users",
                table: "users",
                conn: "main",
                profileId: "db-main",
                view: "history",
                sql: "select * from users",
                historyLoading: false,
            }]
            project.activeTab = 9101
        })

        v2Store.getState().loadDbHistory(9101)

        await waitFor(() => Boolean(v2Store.getState().ui.demo.tabs[0]?.history?.length))
        expect(dbHistoryCalls).toEqual([{ profileId: "db-main" }])
        const tab = v2Store.getState().ui.demo.tabs[0]
        expect(tab.historyLoading).toBe(false)
        expect(tab.history?.[0].kind).toBe("Mutation")
        expect(tab.history?.[0].rows).toBe("3 affected")
    })

    test("sftp disconnect and reconnect delegates call remote APIs and refresh panes", async () => {
        await ensureMockWorkspace()
        patchDemoProject((project) => {
            project.sftp = {
                host: "deploy@example.com",
                hostId: "host-1",
                localPath: ROOT,
                localRel: "",
                remotePath: "/srv/app",
                local: [],
                remote: [],
                sel: null,
                clip: null,
                focus: "local",
                connected: true,
                loading: false,
            }
            project.sshHosts = [{ label: "deploy@example.com", sub: "prod", live: true, hostId: "host-1", remotePath: "/srv/app" }]
        })

        v2Store.getState().sftpDisconnect()

        await waitFor(() => remoteDisconnectCalls.length === 1)
        expect(remoteDisconnectCalls).toEqual([{ profileId: "host-1" }])
        expect(v2Store.getState().ui.demo.sftp.connected).toBe(false)
        expect(v2Store.getState().ui.demo.sshHosts[0].live).toBe(false)

        v2Store.getState().sftpReconnect()

        await waitFor(() => remoteConnectCalls.length === 1 && Boolean(v2Store.getState().ui.demo.sftp.remote.length))
        expect(remoteConnectCalls).toEqual([{ profileId: "host-1" }])
        expect(v2Store.getState().ui.demo.sftp.connected).toBe(true)
        expect(v2Store.getState().ui.demo.sftp.remote[0].name).toBe("app.log")
        expect(v2Store.getState().ui.demo.sshHosts[0].live).toBe(true)
    })

    test("sftp run command delegates to remote API and reports stdout preview", async () => {
        await ensureMockWorkspace()
        patchDemoProject((project) => {
            project.sftp = {
                host: "deploy@example.com",
                hostId: "host-1",
                localPath: ROOT,
                localRel: "",
                remotePath: "/srv/app",
                local: [],
                remote: [],
                sel: null,
                clip: null,
                focus: "local",
                connected: true,
                loading: false,
            }
        })

        v2Store.getState().sftpRunCommand(" uptime ")

        await waitFor(() => remoteCommandCalls.length === 1)
        expect(remoteCommandCalls).toEqual([{ profileId: "host-1", command: "uptime" }])
        expect(v2Store.getState().toast).toContain("exit 0")
        expect(v2Store.getState().toast).toContain("ok from uptime")
    })

    test("sftp enter ignores stale remote directory responses after host changes", async () => {
        await ensureMockWorkspace()
        patchDemoProject((project) => {
            project.sftp = {
                host: "deploy@example.com",
                hostId: "host-1",
                localPath: ROOT,
                localRel: "",
                remotePath: "/srv/app",
                local: [],
                remote: [{ chip: "dir", name: "logs/", size: "4.0K", kind: "dir", p: "/srv/app/logs" }],
                sel: null,
                clip: null,
                focus: "remote",
                connected: true,
                loading: false,
            }
        })
        blockSftpList = true

        v2Store.getState().sftpEnter("remote", 0)
        await waitFor(() => sftpListResolvers.length === 1)
        patchDemoProject((project) => {
            project.sftp = {
                ...project.sftp,
                host: "deploy@other",
                hostId: "host-2",
                remotePath: "/other",
                remote: [],
            }
        })
        blockSftpList = false
        sftpListResolvers.splice(0).forEach((resolve) => resolve())
        await new Promise((resolve) => setTimeout(resolve, 20))

        const sf = v2Store.getState().ui.demo.sftp
        expect(sf.hostId).toBe("host-2")
        expect(sf.remotePath).toBe("/other")
        expect(sf.remote).toEqual([])
    })

    test("sftp transfer ignores stale refresh responses after host changes", async () => {
        await ensureMockWorkspace()
        patchDemoProject((project) => {
            project.sftp = {
                host: "deploy@example.com",
                hostId: "host-1",
                localPath: ROOT,
                localRel: "",
                remotePath: "/srv/app",
                local: [{ chip: "ts", name: "server.ts", size: "4.1K", kind: "file", p: ROOT + "/server.ts" }],
                remote: [],
                sel: null,
                clip: null,
                focus: "local",
                connected: true,
                loading: false,
            }
        })
        v2Store.setState({ toast: null })
        blockSftpList = true

        v2Store.getState().sftpTransfer("local", 0, "remote")
        await waitFor(() => sftpListResolvers.length === 1)
        patchDemoProject((project) => {
            project.sftp = {
                ...project.sftp,
                host: "deploy@other",
                hostId: "host-2",
                remotePath: "/other",
                remote: [],
            }
        })
        blockSftpList = false
        sftpListResolvers.splice(0).forEach((resolve) => resolve())
        await new Promise((resolve) => setTimeout(resolve, 20))

        const sf = v2Store.getState().ui.demo.sftp
        expect(sf.hostId).toBe("host-2")
        expect(sf.remotePath).toBe("/other")
        expect(sf.remote).toEqual([])
        expect(v2Store.getState().toast ?? "").not.toContain("uploaded via SFTP")
    })

    test("ssh host profile save and delete delegate to remote APIs and refresh v2 hosts", async () => {
        await ensureMockWorkspace()

        await (v2Store.getState() as any).saveSshHost({
            name: "edge",
            host: "edge.example.com",
            port: 2222,
            username: "deploy",
            auth_kind: "Agent",
            default_remote_path: "/srv/app",
            keepalive_seconds: 30,
            connect_timeout_seconds: 10,
        })

        await waitFor(() => saveRemoteHostCalls.length === 1 && v2Store.getState().ui.demo.sshHosts.length === 1)
        expect(saveRemoteHostCalls).toEqual([{
            input: {
                workspace_root: ROOT,
                name: "edge",
                host: "edge.example.com",
                port: 2222,
                username: "deploy",
                auth_kind: "Agent",
                default_remote_path: "/srv/app",
                keepalive_seconds: 30,
                connect_timeout_seconds: 10,
            },
        }])
        expect(v2Store.getState().ui.demo.sshHosts[0]).toMatchObject({
            label: "deploy@edge.example.com",
            hostId: "host-1",
            remotePath: "/srv/app",
        })
        expect(v2Store.getState().ui.demo.sshProfiles[0]).toMatchObject({
            id: "host-1",
            host: "edge.example.com",
        })

        await (v2Store.getState() as any).deleteSshHost("host-1")

        await waitFor(() => deleteRemoteHostCalls.length === 1 && v2Store.getState().ui.demo.sshHosts.length === 0)
        expect(deleteRemoteHostCalls).toEqual([{ workspaceRoot: ROOT, profileId: "host-1" }])
        expect(v2Store.getState().ui.demo.sshProfiles).toEqual([])
    })

    test("ssh shell opens a Rust-owned remote terminal session", async () => {
        await ensureMockWorkspace()
        const host = { label: "deploy@example.com", sub: "prod", live: false, hostId: "host-1", remotePath: "/srv/app" }
        patchDemoProject((project) => {
            project.fn = "ssh"
            project.sshHosts = [host]
        })

        v2Store.getState().openShell(host)

        await waitFor(() => terminalSpawnCalls.length + sshSpawnCalls.length > 0)
        expect(sshSpawnCalls).toEqual([{
            workspaceId: "demo",
            workspaceRoot: ROOT,
            profileId: "host-1",
            rows: 24,
            cols: 80,
        }])
        expect(terminalSpawnCalls).toEqual([])
        expect(terminalWriteCalls).toEqual([])
        expect(v2Store.getState().ui.demo.sshHosts[0].live).toBe(true)
        expect(v2Store.getState().ui.demo.tabs[0]).toMatchObject({
            type: "cmd",
            title: "deploy@example.com",
            sessionId: "ssh-1",
        })

        writeToSession("ssh-1", "ls\n")

        expect(sshWriteCalls).toEqual([{ sessionId: "ssh-1", data: "ls\n" }])
        expect(terminalWriteCalls).toEqual([])

        resizeSession("ssh-1", 40, 120)

        expect(sshResizeCalls).toEqual([{ sessionId: "ssh-1", rows: 40, cols: 120 }])
    })

    test("ssh terminal events feed the v2 terminal replay and exit state", async () => {
        await ensureMockWorkspace()
        const host = { label: "deploy@example.com", sub: "prod", live: false, hostId: "host-1", remotePath: "/srv/app" }
        patchDemoProject((project) => {
            project.sshHosts = [host]
        })

        v2Store.getState().openShell(host)

        await waitFor(() => sshSpawnCalls.length === 1)
        handleSshTerminalOutput({
            session_id: "ssh-1",
            chunk: "remote ready\n",
        })
        handleSshTerminalExit({
            session_id: "ssh-1",
            exit_code: 0,
        })

        expect(replayTerminalOutput("ssh-1")).toContain("remote ready")
        expect(v2Store.getState().ui.demo.tabs[0]?.exited).toBe(true)
        expect(v2Store.getState().ui.demo.sshHosts[0].live).toBe(false)
    })

    test("ssh exit keeps the host live while sftp is still connected", async () => {
        await ensureMockWorkspace()
        const host = { label: "deploy@example.com", sub: "prod", live: true, hostId: "host-1", remotePath: "/srv/app" }
        patchDemoProject((project) => {
            project.sshHosts = [host]
            project.sftp = {
                host: "deploy@example.com",
                hostId: "host-1",
                localPath: ROOT,
                localRel: "",
                remotePath: "/srv/app",
                local: [],
                remote: [],
                sel: null,
                clip: null,
                focus: "remote",
                connected: true,
                loading: false,
            }
        })

        v2Store.getState().openShell(host)

        await waitFor(() => sshSpawnCalls.length === 1)
        handleSshTerminalExit({
            session_id: "ssh-1",
            exit_code: 0,
        })

        expect(v2Store.getState().ui.demo.tabs[0]?.exited).toBe(true)
        expect(v2Store.getState().ui.demo.sshHosts[0].live).toBe(true)
    })

    test("ssh terminal sessions can be restored into v2 tabs after bootstrap", async () => {
        await ensureMockWorkspace()
        remoteHosts = [{
            id: "host-1",
            workspace_root: ROOT,
            name: "edge",
            host: "edge.example.com",
            port: 22,
            username: "deploy",
            auth: "Agent",
            default_remote_path: "/srv/app",
            keepalive_seconds: 30,
            connect_timeout_seconds: 10,
            created_ms: 1,
            updated_ms: 2,
        }]
        sshTerminalSessions = [{
            id: "host-1:ssh-7",
            host_id: "host-1",
            workspace_id: "demo",
            name: "deploy@edge.example.com",
            running: true,
        }]
        patchDemoProject((project) => {
            project.sshProfiles = remoteHosts
            project.sshHosts = []
        })

        await restoreSshTerminalSessions("demo")

        const project = v2Store.getState().ui.demo
        expect(project.sshHosts[0]).toMatchObject({
            hostId: "host-1",
            label: "deploy@edge.example.com",
            live: true,
        })
        expect(project.tabs[0]).toMatchObject({
            type: "cmd",
            title: "deploy@edge.example.com",
            sessionId: "host-1:ssh-7",
        })

        writeToSession("host-1:ssh-7", "pwd\n")
        expect(sshWriteCalls).toEqual([{ sessionId: "host-1:ssh-7", data: "pwd\n" }])
    })

    test("browser capture delegate stores the returned screenshot on the browser tab", async () => {
        await ensureMockWorkspace()
        patchDemoProject((project) => {
            project.tabs = [{
                id: 9201,
                type: "browser",
                title: "localhost:5173",
                url: "http://localhost:5173",
            }]
            project.activeTab = 9201
        })

        v2Store.getState().browserCapture(9201, { x: 10, y: 20, width: 300, height: 180 })

        await waitFor(() => Boolean(v2Store.getState().ui.demo.tabs[0]?.screenshot))
        expect(browserCaptureCalls).toEqual([{
            workspaceRoot: ROOT,
            request: {
                url: "http://localhost:5173",
                title: "localhost:5173",
                bounds: { x: 10, y: 20, width: 300, height: 180 },
            },
        }])
        expect(v2Store.getState().ui.demo.tabs[0].screenshot).toEqual({
            dataUrl: "data:image/png;base64,ZmFrZQ==",
            width: 300,
            height: 180,
        })
    })

    test("restored backups keep the disk content as the saved baseline", async () => {
        await ensureMockWorkspace()
        v2Store.getState().toggleDir("src")
        await new Promise((resolve) => setTimeout(resolve, 30))

        v2Store.getState().restoreBackup("b1")
        await new Promise((resolve) => setTimeout(resolve, 30))

        const pid = v2Store.getState().active
        const tab = v2Store.getState().ui[pid].tabs.find((t) => t.type === "file" && t.path === "src/App.tsx")!
        expect(tab.content).toBe("draft")
        expect(tab.savedContent).toBe("disk")
        expect(tab.dirty).toBe(true)

        v2Store.getState().setTabContent(tab.id, "")
        const edited = v2Store.getState().ui[pid].tabs.find((t) => t.id === tab.id)!
        expect(edited.dirty).toBe(true)
    })

    test("open language document stores diagnostics under the active tab display path", async () => {
        await ensureMockWorkspace()
        v2Store.getState().toggleDir("src")
        await new Promise((resolve) => setTimeout(resolve, 30))

        lspCalls.length = 0
        v2Store.getState().openFile("src/App.tsx")

        await waitFor(() => Boolean(v2Store.getState().ui.demo.diagnosticsByPath["src/App.tsx"]?.length))
        const tab = v2Store.getState().ui.demo.tabs.find((t) => t.type === "file" && t.path === "src/App.tsx")!
        const displayPath = tab.path!

        expect(displayPath).toBe("src/App.tsx")
        expect(v2Store.getState().ui.demo.diagnosticsByPath[displayPath][0].path).toBe(displayPath)
        expect(lspCalls.some((call) => call.cmd === "lsp_open_document" && call.args.path === displayPath)).toBe(true)
        expect(lspCalls.some((call) => call.cmd === "lsp_document_diagnostics" && call.args.path === displayPath)).toBe(true)
    })

    test("restart language server delegates the server language instead of an editor path", async () => {
        await ensureMockWorkspace()

        lspCalls.length = 0
        v2Store.getState().restartLspServer("TypeScript")

        await waitFor(() => lspCalls.some((call) => call.cmd === "lsp_restart_server"))
        const restart = lspCalls.find((call) => call.cmd === "lsp_restart_server")!

        expect(restart.args.language).toBe("TypeScript")
        expect("path" in restart.args).toBe(false)
    })

    test("editor symbol actions ensure the active document before LSP requests", async () => {
        await ensureMockWorkspace()
        v2Store.getState().toggleDir("src")
        await new Promise((resolve) => setTimeout(resolve, 30))
        v2Store.getState().openFile("src/App.tsx")
        await waitFor(() => Boolean(v2Store.getState().ui.demo.tabs.find((t) => t.type === "file" && t.path === "src/App.tsx")?.content))

        const cases = [
            { run: () => v2Store.getState().gotoDefinition("src/App.tsx", 1, 1), command: "lsp_definition" },
            { run: () => v2Store.getState().findReferences("src/App.tsx", 1, 1), command: "lsp_references" },
            { run: () => v2Store.getState().codeActionsAt("src/App.tsx", 1, 1), command: "lsp_code_actions" },
            { run: () => v2Store.getState().renameSymbol("src/App.tsx", 1, 1, "renamed"), command: "lsp_rename" },
        ]

        for (const item of cases) {
            lspCalls.length = 0
            item.run()
            await waitFor(() => lspCalls.some((call) => call.cmd === item.command))

            const ensureIndex = lspCalls.findIndex((call) => call.cmd === "lsp_ensure_document")
            const requestIndex = lspCalls.findIndex((call) => call.cmd === item.command)
            expect(ensureIndex).toBeGreaterThanOrEqual(0)
            expect(ensureIndex).toBeLessThan(requestIndex)
            expect(lspCalls[ensureIndex].args.content).toBe("disk")
        }
    })

    test("concurrent editor symbol actions share one pending document ensure", async () => {
        await ensureMockWorkspace()
        v2Store.getState().toggleDir("src")
        await new Promise((resolve) => setTimeout(resolve, 30))
        v2Store.getState().openFile("src/App.tsx")
        await waitFor(() => Boolean(v2Store.getState().ui.demo.tabs.find((t) => t.type === "file" && t.path === "src/App.tsx")?.content))

        lspCalls.length = 0
        blockEnsure = true

        try {
            v2Store.getState().gotoDefinition("src/App.tsx", 1, 1)
            v2Store.getState().findReferences("src/App.tsx", 1, 1)

            await waitFor(() => lspCalls.some((call) => call.cmd === "lsp_ensure_document"))
            await new Promise((resolve) => setTimeout(resolve, 20))
            expect(lspCalls.filter((call) => call.cmd === "lsp_ensure_document")).toHaveLength(1)

            blockEnsure = false
            for (const resolve of ensureResolvers.splice(0)) resolve()

            await waitFor(() => lspCalls.some((call) => call.cmd === "lsp_definition"))
            await waitFor(() => lspCalls.some((call) => call.cmd === "lsp_references"))
        } finally {
            blockEnsure = false
            for (const resolve of ensureResolvers.splice(0)) resolve()
        }
    })

    test("pending document ensure exposes a Starting language server state", async () => {
        await ensureMockWorkspace()
        v2Store.setState((state) => ({
            ui: {
                ...state.ui,
                demo: {
                    ...state.ui.demo,
                    lspServers: [],
                    tabs: [{
                        id: 9101,
                        type: "file",
                        title: "App.tsx",
                        path: "src/App.tsx",
                        realPath: ROOT + "/src/App.tsx",
                        content: "disk",
                        savedContent: "disk",
                    }],
                    activeTab: 9101,
                },
            },
        }))

        lspCalls.length = 0
        blockEnsure = true

        try {
            v2Store.getState().gotoDefinition("src/App.tsx", 1, 1)
            await waitFor(() => lspCalls.some((call) => call.cmd === "lsp_ensure_document"))

            const server = v2Store.getState().ui.demo.lspServers.find((item) => item.language === "TypeScript")
            expect(server?.state).toBe("Starting")
            expect(server?.command).toBe("typescript-language-server")

            blockEnsure = false
            for (const resolve of ensureResolvers.splice(0)) resolve()
            await waitFor(() => lspCalls.some((call) => call.cmd === "lsp_definition"))
            await waitFor(() => v2Store.getState().ui.demo.lspServers.some((item) => item.language === "TypeScript" && item.state === "Running"))
        } finally {
            blockEnsure = false
            for (const resolve of ensureResolvers.splice(0)) resolve()
        }
    })

    test("missing-command document ensure shows an actionable toast and skips the LSP request", async () => {
        await ensureMockWorkspace()
        v2Store.getState().toggleDir("src")
        await new Promise((resolve) => setTimeout(resolve, 30))
        v2Store.getState().openFile("src/App.tsx")
        await waitFor(() => Boolean(v2Store.getState().ui.demo.tabs.find((t) => t.type === "file" && t.path === "src/App.tsx")?.content))

        lspCalls.length = 0
        ensureReadiness = "MissingCommand"
        v2Store.getState().gotoDefinition("src/App.tsx", 1, 1)

        await waitFor(() => String(v2Store.getState().toast).includes("missing language server command: typescript-language-server"))
        expect(lspCalls.some((call) => call.cmd === "lsp_definition")).toBe(false)
    })

    test("workspace diagnostics do not restore diagnostics for a closed language tab", async () => {
        await ensureMockWorkspace()
        v2Store.getState().toggleDir("src")
        await new Promise((resolve) => setTimeout(resolve, 30))

        v2Store.getState().openFile("src/App.tsx")
        await waitFor(() => Boolean(v2Store.getState().ui.demo.diagnosticsByPath["src/App.tsx"]?.length))
        const tab = v2Store.getState().ui.demo.tabs.find((t) => t.type === "file" && t.path === "src/App.tsx")!
        v2Store.getState().closeTab(tab.id)
        expect(v2Store.getState().ui.demo.diagnosticsByPath["src/App.tsx"]).toBeUndefined()

        workspaceDiagnostics = [{
            path: "src/App.tsx",
            range: { start_line: 0, start_character: 0, end_line: 0, end_character: 4 },
            severity: "Error",
            message: "stale diagnostic",
            source: "mock-lsp",
        }]
        lspCalls.length = 0
        v2Store.getState().reloadLang()

        await waitFor(() => lspCalls.some((call) => call.cmd === "lsp_workspace_diagnostics"))
        expect(v2Store.getState().ui.demo.diagnosticsByPath["src/App.tsx"]).toBeUndefined()
    })

    test("rename updates open language documents after writing edited files", async () => {
        await ensureMockWorkspace()
        v2Store.getState().toggleDir("src")
        await new Promise((resolve) => setTimeout(resolve, 30))

        v2Store.getState().openFile("src/App.tsx")
        await waitFor(() => Boolean(v2Store.getState().ui.demo.tabs.find((t) => t.type === "file" && t.path === "src/App.tsx")?.content))
        renameEdit = {
            changes: {
                "file:///ws/demo/src/App.tsx": [{
                    range: { start_line: 0, start_character: 0, end_line: 0, end_character: 4 },
                    newText: "renamed",
                }],
            },
        }
        lspCalls.length = 0

        v2Store.getState().renameSymbol("src/App.tsx", 1, 1, "renamed")
        await waitFor(() => Boolean(v2Store.getState().confirm))
        v2Store.getState().confirm!.action()

        await waitFor(() => lspCalls.some((call) => call.cmd === "lsp_open_document" && call.args.path === "src/App.tsx" && call.args.content === "renamed"))
        expect(lspCalls.some((call) => call.cmd === "lsp_open_document" && call.args.path === "src/App.tsx" && call.args.content === "renamed")).toBe(true)
    })

    test("save serializes the selected CRLF line ending", async () => {
        await ensureMockWorkspace()
        v2Store.getState().toggleDir("src")
        await new Promise((resolve) => setTimeout(resolve, 30))

        v2Store.getState().openFile("src/App.tsx")
        await waitFor(() => Boolean(v2Store.getState().ui.demo.tabs.find((t) => t.type === "file" && t.path === "src/App.tsx")?.content))
        const tab = v2Store.getState().ui.demo.tabs.find((t) => t.type === "file" && t.path === "src/App.tsx")!

        v2Store.getState().setTabContent(tab.id, "one\ntwo\n")
        v2Store.getState().setTabLineEnding(tab.id, "crlf")
        v2Store.getState().saveTab(tab.id)

        await waitFor(() => writeFileCalls.some((call) => call.path === ROOT + "/src/App.tsx"))
        const call = writeFileCalls.find((item) => item.path === ROOT + "/src/App.tsx")
        expect(call.content).toBe("one\r\ntwo\r\n")

        const saved = v2Store.getState().ui.demo.tabs.find((t) => t.id === tab.id)!
        expect(saved.savedContent).toBe("one\ntwo\n")
        expect(saved.savedLineEnding).toBe("crlf")
        expect(saved.dirty).toBe(false)
    })

    test("save completion does not clear a newer autosave timer", async () => {
        await ensureMockWorkspace()
        v2Store.getState().toggleDir("src")
        await new Promise((resolve) => setTimeout(resolve, 30))

        savedBackups.length = 0
        writeResolvers.length = 0
        blockWrite = true

        v2Store.getState().openFile("src/App.tsx")
        await new Promise((resolve) => setTimeout(resolve, 30))

        const pid = v2Store.getState().active
        const tab = v2Store.getState().ui[pid].tabs.find((t) => t.type === "file" && t.path === "src/App.tsx")!
        v2Store.getState().setTabContent(tab.id, "saved draft")
        v2Store.getState().saveTab(tab.id)
        await waitFor(() => writeResolvers.length === 1)

        v2Store.getState().setTabContent(tab.id, "new draft")
        blockWrite = false
        writeResolvers.splice(0).forEach((resolve) => resolve())

        await waitFor(() => savedBackups.some((backup) => backup.content === "new draft"))
        expect(savedBackups.some((backup) => backup.content === "new draft")).toBe(true)
    })

    test("save completion does not reopen LSP diagnostics for a closed tab", async () => {
        await ensureMockWorkspace()
        v2Store.getState().toggleDir("src")
        await new Promise((resolve) => setTimeout(resolve, 30))

        writeResolvers.length = 0
        blockWrite = true

        v2Store.getState().openFile("src/App.tsx")
        await waitFor(() => Boolean(v2Store.getState().ui.demo.tabs.find((t) => t.type === "file" && t.path === "src/App.tsx")?.content))
        const tab = v2Store.getState().ui.demo.tabs.find((t) => t.type === "file" && t.path === "src/App.tsx")!
        v2Store.getState().setTabContent(tab.id, "saved draft")
        v2Store.getState().saveTab(tab.id)
        await waitFor(() => writeResolvers.length === 1)

        v2Store.getState().closeTab(tab.id)
        lspCalls.length = 0
        blockWrite = false
        writeResolvers.splice(0).forEach((resolve) => resolve())

        await new Promise((resolve) => setTimeout(resolve, 80))
        expect(lspCalls.some((call) => call.cmd === "lsp_open_document" && call.args.path === "src/App.tsx")).toBe(false)
        expect(v2Store.getState().ui.demo.diagnosticsByPath["src/App.tsx"]).toBeUndefined()
    })
})

describe("real commit export", () => {
    test("passes the picker destination and overwrite flag to git_export_commit", async () => {
        await seedExportCommit()

        v2Store.getState().exportCommit(0, "changed_files", "zip")

        await waitFor(() => exportCalls.length === 1)
        expect(exportCalls[0]).toEqual({
            workspaceRoot: ROOT,
            hash: "abcdef1234567890",
            scope: "changed_files",
            format: "zip",
            destDir: "/tmp/export-target",
            overwrite: false,
        })
        expect(v2Store.getState().toast).toBe("Exported abc123 · 2 files")
    })

    test("does not call git_export_commit when the picker is cancelled", async () => {
        await seedExportCommit()
        pickedFolder = null

        v2Store.getState().exportCommit(0, "snapshot", "folder")
        await new Promise((resolve) => setTimeout(resolve, 30))

        expect(exportCalls).toEqual([])
    })

    test("shows export errors from git_export_commit", async () => {
        await seedExportCommit()
        exportFailure = new Error("disk denied")

        v2Store.getState().exportCommit(0, "snapshot", "folder")

        await waitFor(() => v2Store.getState().toast === "Export commit: disk denied")
        expect(exportCalls).toHaveLength(1)
    })

    test("hunk refresh does not convert an open commit diff into a working diff", async () => {
        await seedExportCommit()

        v2Store.getState().openCommitFileDiff(0, "src/server.ts")
        await waitFor(() => v2Store.getState().ui.demo.tabs.some((tab) => tab.type === "diff" && tab.diffCommit === "abcdef1234567890"))
        await waitFor(() => compareCommitFileCalls.length === 1)
        expect(compareCommitFileCalls[0]).toEqual({
            workspaceRoot: ROOT,
            hash: "abcdef1234567890",
            path: "src/server.ts",
        })

        v2Store.getState().stageHunks("src/server.ts", [{ hunk_index: 0, line_indices: null }])
        await waitFor(() => hunkStageCalls.length === 1)
        await new Promise((resolve) => setTimeout(resolve, 30))

        const tab = v2Store.getState().ui.demo.tabs.find((item) => item.type === "diff" && item.diffCommit === "abcdef1234567890")
        expect(tab?.diffCommit).toBe("abcdef1234567890")
        expect(tab?.diffStaged).toBeUndefined()
        expect(tab?.diffHunks?.hunks[0].lines[1].text).toBe("working")
    })
})
