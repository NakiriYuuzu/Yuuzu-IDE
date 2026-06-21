/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"

import {
    SIDE_PANEL_MAX_WIDTH,
    SIDE_PANEL_MIN_WIDTH,
    clampSidePanelWidth,
    createV2Store,
    emptyUI,
    sanitizeTerminalTitle,
    registerRealDelegate,
    settingLimit,
} from "./v2-store"

function freshStore() {
    return createV2Store()
}

afterEach(() => {
    registerRealDelegate(null)
})

describe("project rail", () => {
    test("language state defaults are present in demo and real slices", () => {
        const store = freshStore()
        expect(store.getState().ui.api).toMatchObject({
            diagnosticsByPath: {},
            lspServers: [],
            lspLogs: [],
            lspRefs: null,
            lspLoaded: false,
        })
        expect(emptyUI()).toMatchObject({
            diagnosticsByPath: {},
            lspServers: [],
            lspLogs: [],
            lspRefs: null,
            lspLoaded: false,
        })
    })

    test("switching projects keeps each project's tabs and function mode", () => {
        const store = freshStore()
        const s = store.getState()

        s.selectFn("git")
        expect(store.getState().ui.api.fn).toBe("git")

        s.selectProject("web")
        expect(store.getState().active).toBe("web")
        expect(store.getState().ui.web.fn).toBe("files")

        s.selectProject("api")
        expect(store.getState().ui.api.fn).toBe("git")
    })

    test("addProject opens a preset folder and keeps other state", () => {
        const store = freshStore()
        store.getState().addProject()
        const st = store.getState()
        expect(st.order).toContain("ml")
        expect(st.active).toBe("ml")
        expect(st.ui.api.tabs.length).toBeGreaterThan(0)

        store.getState().addProject()
        expect(store.getState().order).toContain("docs")

        store.getState().addProject()
        expect(store.getState().toast).toBe("All demo folders are already open")
    })

    test("selectFn supports the language mode", () => {
        const store = freshStore()
        store.getState().selectFn("lang")
        expect(store.getState().ui.api.fn).toBe("lang")
    })

    test("closeProject removes the folder and moves focus", () => {
        const store = freshStore()
        store.getState().closeProject("api")
        const st = store.getState()
        expect(st.order).not.toContain("api")
        expect(st.active).toBe("web")
    })
})

describe("language actions", () => {
    test("demo language actions stay safe and close references locally", () => {
        const store = freshStore()
        const st = store.getState() as any

        expect(typeof st.gotoDefinition).toBe("function")
        expect(typeof st.findReferences).toBe("function")
        expect(typeof st.renameSymbol).toBe("function")
        expect(typeof st.closeRefs).toBe("function")
        expect(typeof st.reloadLang).toBe("function")
        expect(typeof st.restartLspServer).toBe("function")

        st.gotoDefinition("src/server.ts", 1, 1)
        expect(store.getState().toast).toContain("needs a real workspace")

        st.findReferences("src/server.ts", 1, 1)
        expect(store.getState().toast).toContain("needs a real workspace")

        st.renameSymbol("src/server.ts", 1, 1, "renamed")
        expect(store.getState().toast).toContain("needs a real workspace")
        expect(store.getState().confirm).toBeNull()

        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    lspRefs: [{ path: "src/server.ts", line: 1, col: 1, preview: "src/server.ts:1" }],
                },
            },
        }))
        st.closeRefs()
        expect(store.getState().ui.api.lspRefs).toBeNull()

        st.reloadLang()
        st.restartLspServer("TypeScript")
        expect(store.getState().toast).toContain("needs a real workspace")
    })

    test("real language actions delegate and editor changes backup without notifying LSP", () => {
        const store = freshStore()
        const calls: unknown[][] = []
        registerRealDelegate({
            gotoDefinition: (...args: unknown[]) => calls.push(["goto", ...args]),
            findReferences: (...args: unknown[]) => calls.push(["refs", ...args]),
            renameSymbol: (...args: unknown[]) => calls.push(["rename", ...args]),
            restartLspServer: (...args: unknown[]) => calls.push(["restart", ...args]),
            reloadLang: () => calls.push(["reload"]),
            lspChange: (...args: unknown[]) => calls.push(["change", ...args]),
            backupTab: (...args: unknown[]) => calls.push(["backup", ...args]),
        } as any)
        store.setState({ mode: "real" })
        const tabId = store.getState().ui.api.tabs[0].id

        ;(store.getState() as any).gotoDefinition("src/server.ts", 2, 3)
        ;(store.getState() as any).findReferences("src/server.ts", 4, 5)
        ;(store.getState() as any).renameSymbol("src/server.ts", 6, 7, "renamed")
        ;(store.getState() as any).restartLspServer("TypeScript")
        ;(store.getState() as any).reloadLang()
        store.getState().setTabContent(tabId, "updated")

        expect(calls).toEqual([
            ["goto", "src/server.ts", 2, 3],
            ["refs", "src/server.ts", 4, 5],
            ["rename", "src/server.ts", 6, 7, "renamed"],
            ["restart", "TypeScript"],
            ["reload"],
            ["backup", tabId, "updated"],
        ])
    })

    test("hoverAt returns null in demo and delegates in real", async () => {
        const store = freshStore()
        expect(await store.getState().hoverAt("src/server.ts", 1, 1)).toBeNull()

        const calls: unknown[][] = []
        registerRealDelegate({
            hoverAt: async (...args: unknown[]) => {
                calls.push(["hover", ...args])
                return { path: "src/server.ts", line: 1, character: 1, contents: "fn foo()" }
            },
        } as any)
        store.setState({ mode: "real" })
        const res = await store.getState().hoverAt("src/server.ts", 2, 3)
        expect(calls).toEqual([["hover", "src/server.ts", 2, 3]])
        expect(res).toEqual({ path: "src/server.ts", line: 1, character: 1, contents: "fn foo()" })
    })
})

describe("connected domain actions", () => {
    test("demo database history populates the active table tab", () => {
        const store = freshStore()
        const table = store.getState().ui.api.dbConns[0].tables[0]
        store.getState().openDbTable(0, table)
        const tabId = store.getState().ui.api.activeTab!

        ;(store.getState() as any).setDbView(tabId, "history")
        ;(store.getState() as any).loadDbHistory(tabId)

        const tab = store.getState().ui.api.tabs.find((item) => item.id === tabId)!
        expect(tab.view).toBe("history")
        expect(tab.history?.length).toBeGreaterThan(0)
        expect(tab.history?.some((row) => row.kind === "Mutation")).toBe(true)
    })

    test("database dialog opens from raw profiles for editing without a password", () => {
        const store = freshStore()
        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    dbProfiles: [{
                        id: "pg-1",
                        workspace_root: "/workspace",
                        name: "App Postgres",
                        kind: "PostgreSQL",
                        source: {
                            Tcp: {
                                host: "localhost",
                                port: 5432,
                                database: "app",
                                username: "yuuzu",
                                secret_id: "secret-1",
                            },
                        },
                        read_only: false,
                        production: true,
                        created_ms: 1,
                        updated_ms: 2,
                    }],
                },
            },
        }))

        ;(store.getState() as any).openDbConnDialog("edit", "pg-1")

        expect(store.getState().ui.api.dbDialog).toMatchObject({
            open: true,
            mode: "edit",
            profileId: "pg-1",
            name: "App Postgres",
            host: "localhost",
            port: "5432",
            database: "app",
            username: "yuuzu",
            password: "",
            production: true,
        })
    })

    test("real database management actions delegate and update dialog state", async () => {
        const store = freshStore()
        const calls: unknown[][] = []
        registerRealDelegate({
            dbTestConn: async (...args: unknown[]) => {
                calls.push(["test", ...args])
                return { ok: true, message: "連線成功", elapsed_ms: 1, server_version: "SQLite 3" }
            },
            dbSaveConn: async (...args: unknown[]) => {
                calls.push(["save", ...args])
            },
            dbDeleteConn: async (...args: unknown[]) => {
                calls.push(["delete", ...args])
            },
        } as any)
        store.setState((s) => ({
            mode: "real",
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    dbDialog: {
                        ...s.ui.api.dbDialog,
                        open: true,
                    },
                },
            },
        }))
        const input = {
            workspace_root: "/workspace",
            name: "Local",
            kind: "SQLite" as const,
            sqlite_path: "/workspace/app.db",
            read_only: false,
            production: false,
        }

        await (store.getState() as any).testDbConn(input)
        expect(store.getState().ui.api.dbDialog.testResult?.ok).toBe(true)
        await (store.getState() as any).saveDbConn(input)
        await (store.getState() as any).deleteDbConn("pg-1")

        expect(calls).toEqual([
            ["test", input],
            ["save", input],
            ["delete", "pg-1"],
        ])
        expect(store.getState().ui.api.dbDialog.open).toBe(false)
    })

    test("demo saveDbConn keeps raw profiles so saved connections can be edited", async () => {
        const store = freshStore()
        const input = {
            workspace_root: "/demo/api",
            name: "Smoke DB",
            kind: "SQLite" as const,
            sqlite_path: "/tmp/smoke.db",
            read_only: false,
            production: false,
        }

        await (store.getState() as any).saveDbConn(input)
        const profileId = store.getState().ui.api.dbConns.find((conn) => conn.name === "Smoke DB")?.profileId
        expect(profileId).toBeTruthy()

        ;(store.getState() as any).openDbConnDialog("edit", profileId)

        expect(store.getState().ui.api.dbDialog).toMatchObject({
            open: true,
            mode: "edit",
            profileId,
            name: "Smoke DB",
            sqlitePath: "/tmp/smoke.db",
        })
    })

    test("demo saveDbConn gives duplicate names distinct profile ids", async () => {
        const store = freshStore()
        const input = {
            workspace_root: "/demo/api",
            name: "Duplicate DB",
            kind: "SQLite" as const,
            sqlite_path: "/tmp/duplicate.db",
            read_only: false,
            production: false,
        }

        await (store.getState() as any).saveDbConn(input)
        await (store.getState() as any).saveDbConn(input)

        const conns = store.getState().ui.api.dbConns.filter((conn) => conn.name === "Duplicate DB")
        expect(conns.length).toBe(2)
        expect(new Set(conns.map((conn) => conn.profileId)).size).toBe(2)

        await (store.getState() as any).deleteDbConn(conns[0].profileId!)
        expect(store.getState().ui.api.dbConns.filter((conn) => conn.name === "Duplicate DB").length).toBe(1)
    })

    test("demo sftp disconnect and reconnect stay safe", () => {
        const store = freshStore()
        const st = store.getState() as any

        st.sftpDisconnect()
        expect(store.getState().toast).toContain("needs a real workspace")

        st.sftpReconnect()
        expect(store.getState().toast).toContain("needs a real workspace")

        st.sftpRunCommand("uptime")
        expect(store.getState().toast).toContain("needs a real workspace")
    })

    test("demo browser capture stays safe", () => {
        const store = freshStore()
        const tab = store.getState().ui.api.tabs.find((item) => item.type === "browser")!

        ;(store.getState() as any).browserCapture(tab.id, { x: 1, y: 2, width: 300, height: 200 })

        expect(store.getState().toast).toContain("needs a real workspace")
    })

    test("real connected domain actions delegate and browser capture guards empty urls", () => {
        const store = freshStore()
        const calls: unknown[][] = []
        registerRealDelegate({
            dbHistory: (...args: unknown[]) => calls.push(["history", ...args]),
            sftpDisconnect: () => calls.push(["disconnect"]),
            sftpReconnect: () => calls.push(["reconnect"]),
            sftpRunCommand: (...args: unknown[]) => calls.push(["run", ...args]),
            browserCapture: (...args: unknown[]) => calls.push(["capture", ...args]),
        } as any)
        const table = store.getState().ui.api.dbConns[0].tables[0]
        store.getState().openDbTable(0, table)
        const dbTabId = store.getState().ui.api.activeTab!
        store.setState({ mode: "real" })

        ;(store.getState() as any).loadDbHistory(dbTabId)
        ;(store.getState() as any).sftpDisconnect()
        ;(store.getState() as any).sftpReconnect()
        ;(store.getState() as any).sftpRunCommand("  uptime  ")

        store.getState().newBrowser()
        const emptyBrowserId = store.getState().ui.api.activeTab!
        ;(store.getState() as any).browserCapture(emptyBrowserId, { x: 0, y: 0, width: 10, height: 10 })
        expect(calls.some((call) => call[0] === "capture")).toBe(false)
        expect(store.getState().toast).toContain("Type a URL first")

        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    tabs: s.ui.api.tabs.map((tab) =>
                        tab.id === emptyBrowserId ? { ...tab, url: "localhost:5173", title: "localhost:5173" } : tab,
                    ),
                },
            },
        }))
        ;(store.getState() as any).browserCapture(emptyBrowserId, { x: 1, y: 2, width: 300, height: 200 })

        expect(calls).toEqual([
            ["history", dbTabId],
            ["disconnect"],
            ["reconnect"],
            ["run", "uptime"],
            ["capture", emptyBrowserId, { x: 1, y: 2, width: 300, height: 200 }],
        ])
    })
})

describe("tabs", () => {
    test("openFile reuses an existing tab for the same path", () => {
        const store = freshStore()
        const before = store.getState().ui.api.tabs.length
        store.getState().openFile("src/server.ts")
        expect(store.getState().ui.api.tabs.length).toBe(before)

        store.getState().openFile("src/db/pool.ts")
        expect(store.getState().ui.api.tabs.length).toBe(before + 1)
    })

    test("closeTab promotes a neighbour to active", () => {
        const store = freshStore()
        store.getState().openFile("src/server.ts")
        const tabs = store.getState().ui.api.tabs
        const active = store.getState().ui.api.activeTab
        store.getState().closeTab(active!)
        const after = store.getState().ui.api
        expect(after.tabs.length).toBe(tabs.length - 1)
        expect(after.activeTab).not.toBe(active)
        expect(after.tabs.find((t) => t.id === after.activeTab)).toBeDefined()
    })

    test("closeOthers keeps only the target and clears a stale split", () => {
        const store = freshStore()
        const first = store.getState().ui.api.tabs[0]
        store.getState().toggleSplit()
        store.getState().closeOthers(first.id)
        const p = store.getState().ui.api
        expect(p.tabs).toHaveLength(1)
        expect(p.activeTab).toBe(first.id)
    })

    test("newTerm numbers terminals per project", () => {
        const store = freshStore()
        store.getState().newTerm()
        const p = store.getState().ui.api
        const t = p.tabs[p.tabs.length - 1]
        expect(t.type).toBe("cmd")
        expect(t.title).toBe("zsh · 2")
        expect(p.activeTab).toBe(t.id)
    })

    test("selectFn('git') ensures a single git graph tab", () => {
        const store = freshStore()
        store.getState().selectFn("git")
        store.getState().selectFn("files")
        store.getState().selectFn("git")
        const gitTabs = store.getState().ui.api.tabs.filter((t) => t.type === "git")
        expect(gitTabs).toHaveLength(1)
        expect(store.getState().ui.api.activeTab).toBe(gitTabs[0].id)
    })

    test("openFileHistory switches to the git graph in demo mode", () => {
        const store = freshStore()

        store.getState().openFileHistory("src/server.ts")

        expect(store.getState().ui.api.fn).toBe("git")
        expect(store.getState().ui.api.tabs.some((tab) => tab.type === "git")).toBe(true)
        expect(store.getState().toast).toBe("History for src/server.ts")
    })
})

describe("terminal emulation", () => {
    test("applyOscTitle updates only unlocked terminal surfaces", () => {
        const store = freshStore()
        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    tabs: [
                        ...s.ui.api.tabs,
                        { id: 9001, type: "cmd", title: "zsh", sessionId: "term-a" },
                        { id: 9002, type: "cmd", title: "manual", titleLocked: true, sessionId: "term-b" },
                    ],
                    wins: [
                        ...s.ui.api.wins,
                        {
                            id: 9101,
                            title: "agent",
                            status: "shell",
                            lines: [],
                            buf: "",
                            min: false,
                            max: false,
                            sessionId: "agent-a",
                        },
                        {
                            id: 9102,
                            title: "locked agent",
                            status: "shell",
                            lines: [],
                            buf: "",
                            min: false,
                            max: false,
                            titleLocked: true,
                            sessionId: "agent-b",
                        },
                    ],
                },
            },
        }))

        store.getState().applyOscTitle("term-a", "  vim src/App.tsx  ")
        store.getState().applyOscTitle("term-b", "should not apply")
        store.getState().applyOscTitle("agent-a", "claude")
        store.getState().applyOscTitle("agent-b", "should not apply")
        store.getState().applyOscTitle("agent-a", "   ")

        const state = store.getState().ui.api
        expect(state.tabs.find((t) => t.id === 9001)?.title).toBe("vim src/App.tsx")
        expect(state.tabs.find((t) => t.id === 9002)?.title).toBe("manual")
        expect(state.wins.find((w) => w.id === 9101)?.title).toBe("claude")
        expect(state.wins.find((w) => w.id === 9102)?.title).toBe("locked agent")
    })

    test("manual terminal rename locks and empty rename unlocks", () => {
        const store = freshStore()
        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    tabs: [...s.ui.api.tabs, { id: 9001, type: "cmd", title: "zsh", sessionId: "term-a" }],
                },
            },
        }))

        store.getState().renameTerminalTab(9001, "  build logs  ")
        expect(store.getState().ui.api.tabs.find((t) => t.id === 9001)).toMatchObject({
            title: "build logs",
            titleLocked: true,
        })

        store.getState().applyOscTitle("term-a", "ignored")
        expect(store.getState().ui.api.tabs.find((t) => t.id === 9001)?.title).toBe("build logs")

        store.getState().renameTerminalTab(9001, "")
        expect(store.getState().ui.api.tabs.find((t) => t.id === 9001)?.titleLocked).toBe(false)

        store.getState().applyOscTitle("term-a", "next osc")
        expect(store.getState().ui.api.tabs.find((t) => t.id === 9001)?.title).toBe("next osc")
    })

    test("typing into the buffer and running a command appends output", () => {
        const store = freshStore()
        store.getState().newTerm()
        const tabId = store.getState().ui.api.activeTab!
        store.getState().setTermBuf(tabId, () => "ls")
        store.getState().runTermCmd(tabId)
        const tab = store.getState().ui.api.tabs.find((t) => t.id === tabId)!
        expect(tab.buf).toBe("")
        expect(tab.lines?.some((l) => l.includes("❯ ls"))).toBe(true)
        expect(tab.lines?.some((l) => l.includes("package.json"))).toBe(true)
    })

    test("manual agent rename locks and empty rename unlocks", () => {
        const store = freshStore()
        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    wins: [...s.ui.api.wins, {
                        id: 9101,
                        title: "agent",
                        status: "shell",
                        lines: [],
                        buf: "",
                        min: false,
                        max: false,
                        sessionId: "agent-a",
                    }],
                },
            },
        }))

        store.getState().renameAgentSession(9101, "  claude router  ")
        expect(store.getState().ui.api.wins.find((w) => w.id === 9101)).toMatchObject({
            title: "claude router",
            titleLocked: true,
        })

        store.getState().renameAgentSession(9101, "")
        expect(store.getState().ui.api.wins.find((w) => w.id === 9101)?.titleLocked).toBe(false)
    })

    test("clear empties the scrollback", () => {
        const store = freshStore()
        store.getState().newTerm()
        const tabId = store.getState().ui.api.activeTab!
        store.getState().setTermBuf(tabId, () => "clear")
        store.getState().runTermCmd(tabId)
        const tab = store.getState().ui.api.tabs.find((t) => t.id === tabId)!
        expect(tab.lines).toHaveLength(0)
    })

    test("sanitizeTerminalTitle removes controls and limits long titles", () => {
        expect(sanitizeTerminalTitle(" \u0000foo\nbar\u007f ")).toBe("foobar")
        expect(sanitizeTerminalTitle("x".repeat(130))).toHaveLength(120)
        expect(sanitizeTerminalTitle(" \n\t ")).toBe("")
    })
})

describe("git commit", () => {
    test("stage and unstage actions move demo working-tree files", () => {
        const store = freshStore()
        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    git: {
                        ...s.ui.api.git,
                        staged: [{ path: "src/staged.ts", kind: "modified", st: "M", staged: true }],
                        unstaged: [
                            { path: "src/a.ts", kind: "modified", st: "M", staged: false },
                            { path: "src/b.ts", kind: "added", st: "A", staged: false },
                        ],
                    },
                },
            },
        }))

        store.getState().stageFiles(["src/a.ts"])
        expect(store.getState().ui.api.git.staged.map((file) => file.path)).toEqual(["src/staged.ts", "src/a.ts"])
        expect(store.getState().ui.api.git.unstaged.map((file) => file.path)).toEqual(["src/b.ts"])

        store.getState().unstageAll()
        expect(store.getState().ui.api.git.staged).toEqual([])
        expect(store.getState().ui.api.git.unstaged.map((file) => file.path)).toEqual(["src/b.ts", "src/staged.ts", "src/a.ts"])

        store.getState().stageAll()
        expect(store.getState().ui.api.git.unstaged).toEqual([])
        expect(store.getState().ui.api.git.staged.map((file) => file.path)).toEqual(["src/b.ts", "src/staged.ts", "src/a.ts"])
    })

    test("discardFiles opens a typed destructive confirmation", () => {
        const store = freshStore()
        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    git: {
                        ...s.ui.api.git,
                        unstaged: [{ path: "src/a.ts", kind: "modified", st: "M", staged: false }],
                    },
                },
            },
        }))

        store.getState().discardFiles(["src/a.ts"])
        expect(store.getState().confirm?.typed).toBe("DISCARD")
        expect(store.getState().confirm?.danger).toBe(true)

        store.getState().confirm?.action()
        expect(store.getState().ui.api.git.unstaged).toEqual([])
    })

    test("openWorkingDiff opens and reuses a demo diff tab", () => {
        const store = freshStore()
        const before = store.getState().ui.api.tabs.length

        store.getState().openWorkingDiff("src/a.ts", false)
        let ui = store.getState().ui.api
        const tab = ui.tabs.find((item) => item.type === "diff" && item.path === "src/a.ts")
        expect(tab).toBeDefined()
        expect(tab?.diffStaged).toBe(false)
        expect(tab?.diff?.some((row) => row.t === "a")).toBe(true)
        expect(tab?.diffHunks?.path).toBe("src/a.ts")
        expect(ui.tabs.length).toBe(before + 1)

        store.getState().openWorkingDiff("src/a.ts", false)
        ui = store.getState().ui.api
        expect(ui.tabs.filter((item) => item.type === "diff" && item.path === "src/a.ts")).toHaveLength(1)
        expect(ui.activeTab).toBe(tab!.id)
    })

    test("hunk stage and unstage delegate through demo path moves", () => {
        const store = freshStore()
        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    git: {
                        ...s.ui.api.git,
                        staged: [],
                        unstaged: [{ path: "src/a.ts", kind: "modified", st: "M", staged: false }],
                    },
                },
            },
        }))

        const selected = [{ hunk_index: 0, line_indices: [1] }]
        store.getState().stageHunks("src/a.ts", selected)
        expect(store.getState().ui.api.git.staged.map((file) => file.path)).toEqual(["src/a.ts"])
        expect(store.getState().ui.api.git.unstaged).toEqual([])

        store.getState().unstageHunks("src/a.ts", selected)
        expect(store.getState().ui.api.git.staged).toEqual([])
        expect(store.getState().ui.api.git.unstaged.map((file) => file.path)).toEqual(["src/a.ts"])
    })

    test("revertHunk opens a typed destructive confirmation", () => {
        const store = freshStore()

        store.getState().revertHunk("src/a.ts", [{ hunk_index: 0, line_indices: null }])
        expect(store.getState().confirm?.typed).toBe("DISCARD")
        expect(store.getState().confirm?.danger).toBe(true)
        expect(store.getState().confirm?.label).toBe("Revert")

        store.getState().confirm?.action()
        expect(store.getState().toast).toContain("Reverted selected changes")
    })

    test("checkoutBranch opens a typed branch confirmation and switches demo branch", () => {
        const store = freshStore()

        store.getState().checkoutBranch("topic")
        expect(store.getState().confirm?.typed).toBe("CHECKOUT topic")
        expect(store.getState().confirm?.label).toBe("Checkout")

        store.getState().confirm?.action()
        expect(store.getState().meta.api.branch).toBe("topic")
        expect(store.getState().ui.api.git.branch).toBe("topic")
        expect(store.getState().ui.api.branchPopupOpen).toBe(false)
    })

    test("branch popup demo supports create, rename and typed delete", () => {
        const store = freshStore()

        store.getState().openBranchPopup()
        expect(store.getState().ui.api.branchPopupOpen).toBe(true)
        expect(store.getState().ui.api.git.branchesFull.length).toBeGreaterThan(0)

        store.getState().createBranch("topic")
        expect(store.getState().ui.api.git.branchesFull.some((branch) => branch.name === "topic")).toBe(true)

        store.getState().renameBranch("topic", "topic-renamed")
        expect(store.getState().ui.api.git.branchesFull.some((branch) => branch.name === "topic-renamed")).toBe(true)

        store.getState().deleteBranch("topic-renamed")
        expect(store.getState().confirm?.typed).toBe("DELETE topic-renamed")
        expect(store.getState().confirm?.danger).toBe(true)
        store.getState().confirm?.action()
        expect(store.getState().ui.api.git.branchesFull.some((branch) => branch.name === "topic-renamed")).toBe(false)
    })

    test("stash panel demo supports stash, apply, pop, drop and branch", () => {
        const store = freshStore()

        store.getState().openStashPanel()
        expect(store.getState().ui.api.stashPanelOpen).toBe(true)
        expect(store.getState().ui.api.git.stashes.length).toBeGreaterThan(0)

        store.getState().stashChanges("work in progress", true)
        expect(store.getState().ui.api.git.stashes[0].message).toContain("work in progress")
        expect(store.getState().ui.api.git.stashes[0].message).toContain("untracked")

        store.getState().applyStash(0)
        expect(store.getState().toast).toBe("Applied stash@{0}")

        store.getState().popStash(0)
        expect(store.getState().ui.api.git.stashes.every((stash) => stash.index !== 0 || !stash.message.includes("work in progress"))).toBe(true)

        store.getState().stashToBranch(0, "stash-branch")
        expect(store.getState().ui.api.git.branchesFull.some((branch) => branch.name === "stash-branch")).toBe(true)

        const beforeDuplicate = store.getState().ui.api.git.stashes.length
        store.getState().stashToBranch(0, "stash-branch")
        expect(store.getState().toast).toBe("Branch already exists: stash-branch")
        expect(store.getState().ui.api.git.stashes.length).toBe(beforeDuplicate)

        store.getState().dropStash(0)
        expect(store.getState().confirm?.typed).toBe("DROP stash@{0}")
        expect(store.getState().confirm?.danger).toBe(true)
        store.getState().confirm?.action()
        expect(store.getState().ui.api.git.stashes.some((stash) => stash.index === 0)).toBe(false)
    })

    test("stashToBranch rejects demo branches even before branches are loaded", () => {
        const store = freshStore()
        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    git: {
                        ...s.ui.api.git,
                        branch: "main",
                        branchesFull: [],
                        stashes: [{ index: 0, message: "wip", when_unix: 100 }],
                    },
                },
            },
        }))

        store.getState().stashToBranch(0, "main")
        expect(store.getState().toast).toBe("Branch already exists: main")
        expect(store.getState().ui.api.git.stashes).toHaveLength(1)

        store.getState().stashToBranch(0, "feat/pag")
        expect(store.getState().toast).toBe("Branch already exists: feat/pag")
        expect(store.getState().ui.api.git.stashes).toHaveLength(1)
    })

    test("stashToBranch keeps demo branch guards after adding a branch", () => {
        const store = freshStore()
        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    git: {
                        ...s.ui.api.git,
                        branch: "main",
                        branchesFull: [],
                        stashes: [
                            { index: 0, message: "first", when_unix: 100 },
                            { index: 1, message: "second", when_unix: 90 },
                        ],
                    },
                },
            },
        }))

        store.getState().stashToBranch(0, "stash-branch")
        expect(store.getState().ui.api.git.branchesFull.some((branch) => branch.name === "stash-branch")).toBe(true)
        expect(store.getState().ui.api.git.stashes).toHaveLength(1)

        store.getState().stashToBranch(0, "feat/pag")
        expect(store.getState().toast).toBe("Branch already exists: feat/pag")
        expect(store.getState().ui.api.git.stashes).toHaveLength(1)
    })

    test("stashToBranch can recreate a deleted demo branch", () => {
        const store = freshStore()
        store.getState().openBranchPopup()
        expect(store.getState().ui.api.git.branchesFull.some((branch) => branch.name === "feat/pag")).toBe(true)

        store.getState().deleteBranch("feat/pag")
        store.getState().confirm?.action()
        expect(store.getState().ui.api.git.branchesFull.some((branch) => branch.name === "feat/pag")).toBe(false)

        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    git: {
                        ...s.ui.api.git,
                        stashes: [{ index: 0, message: "wip", when_unix: 100 }],
                    },
                },
            },
        }))

        store.getState().stashToBranch(0, "feat/pag")
        expect(store.getState().toast).toBe("Created branch feat/pag from stash@{0}")
        expect(store.getState().ui.api.git.branchesFull.some((branch) => branch.name === "feat/pag")).toBe(true)
        expect(store.getState().ui.api.git.stashes).toHaveLength(0)
    })

    test("resetHard opens a typed destructive confirmation", () => {
        const store = freshStore()

        store.getState().resetHard()
        expect(store.getState().confirm?.typed).toBe("RESET HARD")
        expect(store.getState().confirm?.danger).toBe(true)
        store.getState().confirm?.action()
        expect(store.getState().toast).toBe("Reset working tree")
    })

    test("resetTo opens typed confirmations for each mode", () => {
        const store = freshStore()
        const short = store.getState().ui.api.git.commits[0].h

        store.getState().resetTo(0, "soft")
        expect(store.getState().confirm?.typed).toBe("RESET " + short)
        expect(store.getState().confirm?.danger).toBe(true)

        store.getState().resetTo(0, "mixed")
        expect(store.getState().confirm?.typed).toBe("RESET " + short)

        store.getState().resetTo(0, "hard")
        expect(store.getState().confirm?.typed).toBe("RESET HARD " + short)
        store.getState().confirm?.action()
        expect(store.getState().toast).toBe("Reset main to " + short + " (hard)")
    })

    test("rebaseOnto opens a typed destructive confirmation", () => {
        const store = freshStore()

        store.getState().rebaseOnto("origin/main")
        expect(store.getState().confirm?.typed).toBe("REBASE origin/main")
        expect(store.getState().confirm?.danger).toBe(true)
        store.getState().confirm?.action()
        expect(store.getState().toast).toBe("Rebased main onto origin/main")
    })

    test("exportCommit delegates without hardcoding a destination", () => {
        const store = freshStore()
        const calls: unknown[][] = []
        registerRealDelegate({ gitExportCommit: (...args: unknown[]) => calls.push(args) } as any)
        store.setState({ mode: "real" })
        const commit = store.getState().ui.api.git.commits[0]

        store.getState().exportCommit(0, "changed_files", "zip")

        expect(calls).toEqual([[commit.fullHash ?? commit.h, commit.h, "changed_files", "zip"]])
        expect(JSON.stringify(calls)).not.toContain("~/Downloads")
    })

    test("openCommitFileDiff opens a demo compare-to-current diff tab", () => {
        const store = freshStore()

        ;(store.getState() as any).openCommitFileDiff(0, "src/server.ts")

        const active = store.getState().ui.api.tabs.find((tab) => tab.id === store.getState().ui.api.activeTab)
        expect(active?.type).toBe("diff")
        expect(active?.title).toBe("compare · server.ts")
        expect(active?.path).toBe("src/server.ts")
        expect(active?.diffStaged).toBeUndefined()
        expect(active?.diffCompare).toBe("worktree")
        expect(active?.diff?.length).toBeGreaterThan(0)
    })

    test("openCommitFileDiff delegates commit hash and path in real mode", () => {
        const store = freshStore()
        const calls: unknown[][] = []
        registerRealDelegate({ gitOpenCommitFileDiff: (...args: unknown[]) => calls.push(args) } as any)
        store.setState({ mode: "real" })
        const commit = store.getState().ui.api.git.commits[0]

        ;(store.getState() as any).openCommitFileDiff(0, "src/server.ts")

        expect(calls).toEqual([[commit.fullHash ?? commit.h, commit.h, "src/server.ts"]])
    })

    test("chooseConflictBlock stores side choices for a conflict tab", () => {
        const store = freshStore()

        store.getState().openConflict("src/conflict.ts")
        expect(store.getState().ui.api.tabs.find((tab) => tab.type === "conflict" && tab.path === "src/conflict.ts")).toBeDefined()

        store.getState().chooseConflictBlock(0, "ours")
        store.getState().chooseConflictBlock(1, "theirs")
        expect(store.getState().ui.api.git.conflictChoices).toEqual({
            "src/conflict.ts:0": "ours",
            "src/conflict.ts:1": "theirs",
        })
    })

    test("chooseConflictBlock scopes choices to the active conflict path", () => {
        const store = freshStore()

        store.getState().openConflict("src/conflict-a.ts")
        store.getState().chooseConflictBlock(0, "ours")
        store.getState().openConflict("src/conflict-b.ts")
        store.getState().chooseConflictBlock(0, "theirs")

        expect(store.getState().ui.api.git.conflictChoices).toEqual({
            "src/conflict-a.ts:0": "ours",
            "src/conflict-b.ts:0": "theirs",
        })
    })

    test("acceptConflictSide opens a typed destructive confirmation", () => {
        const store = freshStore()
        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    git: {
                        ...s.ui.api.git,
                        conflicts: [{ path: "src/conflict.ts", kind: "conflict", st: "U", staged: false }],
                        hasConflicts: true,
                        conflictChoices: { "src/conflict.ts:0": "ours" },
                    },
                },
            },
        }))

        store.getState().acceptConflictSide("src/conflict.ts", "ours")
        expect(store.getState().confirm?.typed).toBe("ACCEPT OURS")
        expect(store.getState().confirm?.danger).toBe(true)
        store.getState().confirm?.action()
        expect(store.getState().ui.api.git.conflicts).toHaveLength(0)
        expect(store.getState().ui.api.git.hasConflicts).toBe(false)
        expect(store.getState().ui.api.git.conflictChoices).toEqual({})
    })

    test("acceptConflictSide preserves choices for other conflict paths", () => {
        const store = freshStore()
        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    git: {
                        ...s.ui.api.git,
                        conflicts: [
                            { path: "src/conflict-a.ts", kind: "conflict", st: "U", staged: false },
                            { path: "src/conflict-b.ts", kind: "conflict", st: "U", staged: false },
                        ],
                        hasConflicts: true,
                        conflictChoices: {
                            "src/conflict-a.ts:0": "ours",
                            "src/conflict-b.ts:0": "theirs",
                        },
                    },
                },
            },
        }))

        store.getState().acceptConflictSide("src/conflict-a.ts", "ours")
        store.getState().confirm?.action()

        expect(store.getState().ui.api.git.conflicts.map((file) => file.path)).toEqual(["src/conflict-b.ts"])
        expect(store.getState().ui.api.git.conflictChoices).toEqual({ "src/conflict-b.ts:0": "theirs" })
    })

    test("markResolved clears a conflict from the working tree", () => {
        const store = freshStore()
        store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    git: {
                        ...s.ui.api.git,
                        conflicts: [{ path: "src/conflict.ts", kind: "conflict", st: "U", staged: false }],
                        hasConflicts: true,
                        conflictChoices: { "src/conflict.ts:0": "theirs" },
                    },
                },
            },
        }))

        store.getState().markResolved("src/conflict.ts")
        expect(store.getState().ui.api.git.conflicts).toHaveLength(0)
        expect(store.getState().ui.api.git.hasConflicts).toBe(false)
        expect(store.getState().ui.api.git.conflictChoices).toEqual({})
    })

    test("doCommit prepends the commit, moves main and bumps ahead", () => {
        const store = freshStore()
        const before = store.getState().ui.api.git
        store.getState().setCommitMsg("feat: new thing")
        store.getState().doCommit()
        const git = store.getState().ui.api.git
        expect(git.commits.length).toBe(before.commits.length + 1)
        expect(git.commits[0].m).toBe("feat: new thing")
        expect(git.commits[0].refs).toContain("main")
        expect(git.commits[1].refs).not.toContain("main")
        expect(git.ahead).toBe(before.ahead + 1)
        expect(store.getState().ui.api.commitMsg).toBe("")
    })

    test("doCommit without a message only toasts", () => {
        const store = freshStore()
        const before = store.getState().ui.api.git.commits.length
        store.getState().doCommit()
        expect(store.getState().ui.api.git.commits.length).toBe(before)
        expect(store.getState().toast).toBe("Type a commit message first")
    })
})

describe("sftp", () => {
    test("copy then paste transfers the file to the focused pane", () => {
        const store = freshStore()
        store.getState().sftpSelect("local", 0)
        store.getState().sftpCopy()
        expect(store.getState().ui.api.sftp.clip?.name).toBe("server.ts")

        store.getState().sftpFocus("remote")
        store.getState().sftpPaste()
        const sf = store.getState().ui.api.sftp
        expect(sf.clip).toBeNull()
        const moved = sf.remote.find((f) => f.name === "server.ts")
        expect(moved?.isNew).toBe(true)
    })

    test("drag transfer copies across panes without duplicating", () => {
        const store = freshStore()
        store.getState().sftpTransfer("local", 0, "remote")
        store.getState().sftpTransfer("local", 0, "remote")
        const sf = store.getState().ui.api.sftp
        expect(sf.remote.filter((f) => f.name === "server.ts")).toHaveLength(1)
        expect(sf.focus).toBe("remote")
    })

    test("delete removes the row", () => {
        const store = freshStore()
        const before = store.getState().ui.api.sftp.local.length
        store.getState().sftpDelete("local", 0)
        expect(store.getState().ui.api.sftp.local.length).toBe(before - 1)
    })
})

describe("agent zone", () => {
    test("azNew switches to agent mode and activates the session", () => {
        const store = freshStore()
        const before = store.getState().ui.api.wins.length
        store.getState().azNew()
        const p = store.getState().ui.api
        expect(p.wins.length).toBe(before + 1)
        expect(p.fn).toBe("agent")
        expect(p.azActive).toBe(p.wins[p.wins.length - 1].id)
    })

    test("collapse and maximize are mutually exclusive per window", () => {
        const store = freshStore()
        const id = store.getState().ui.api.wins[0].id
        store.getState().azCollapse(id)
        expect(store.getState().ui.api.wins[0].min).toBe(true)
        store.getState().azMax(id)
        const w = store.getState().ui.api.wins[0]
        expect(w.max).toBe(true)
        expect(w.min).toBe(false)
    })

    test("maximizing one window clears max on the others", () => {
        const store = freshStore()
        const [a, b] = store.getState().ui.api.wins
        store.getState().azMax(a.id)
        store.getState().azMax(b.id)
        const wins = store.getState().ui.api.wins
        expect(wins.find((w) => w.id === a.id)?.max).toBe(false)
        expect(wins.find((w) => w.id === b.id)?.max).toBe(true)
    })

    test("typing routes into the active session buffer and Enter executes", () => {
        const store = freshStore()
        const id = store.getState().ui.api.wins[0].id
        store.getState().azFront(id)
        store.getState().setAzBuf(id, (b) => b + "git status")
        store.getState().runAzCmd(id)
        const w = store.getState().ui.api.wins[0]
        expect(w.buf).toBe("")
        expect(w.lines.some((l) => l.includes("git status"))).toBe(true)
        expect(w.lines.some((l) => l.includes("working tree clean"))).toBe(true)
    })

    test("closing the active session moves focus to the first remaining", () => {
        const store = freshStore()
        const [a, b] = store.getState().ui.api.wins
        store.getState().azFront(a.id)
        store.getState().azClose(a.id)
        const p = store.getState().ui.api
        expect(p.wins.find((w) => w.id === a.id)).toBeUndefined()
        expect(p.azActive).toBe(b.id)
    })

    test("column override locks the count and Auto (null) clears it", () => {
        const store = freshStore()
        expect(store.getState().azColsOverride).toBeNull()
        store.getState().setAzColsOverride(3)
        expect(store.getState().azColsOverride).toBe(3)
        store.getState().setAzColsOverride(4)
        expect(store.getState().azColsOverride).toBe(4)
        store.getState().setAzColsOverride(null)
        expect(store.getState().azColsOverride).toBeNull()
    })
})

describe("explorer mutations", () => {
    test("addNode creates a uniquely named file, opens it and toasts", () => {
        const store = freshStore()
        store.getState().addNode("src", "file")
        store.getState().addNode("src", "file")
        const p = store.getState().ui.api
        const src = p.treeData.find((n) => n.n === "src")!
        expect(src.d?.some((n) => n.n === "untitled.ts")).toBe(true)
        expect(src.d?.some((n) => n.n === "untitled-2.ts")).toBe(true)
        expect(p.tabs.some((t) => t.path === "src/untitled-2.ts")).toBe(true)
    })

    test("deleteNode drops the subtree and closes dependent tabs", () => {
        const store = freshStore()
        store.getState().openFile("src/routes/users.ts")
        store.getState().deleteNode("src/routes")
        const p = store.getState().ui.api
        const src = p.treeData.find((n) => n.n === "src")!
        expect(src.d?.some((n) => n.n === "routes")).toBe(false)
        expect(p.tabs.some((t) => t.path?.startsWith("src/routes/"))).toBe(false)
        expect(p.tabs.find((t) => t.id === p.activeTab)).toBeDefined()
    })
})

describe("settings", () => {
    test("clamps side panel width to the supported visual range", () => {
        expect(clampSidePanelWidth(100)).toBe(SIDE_PANEL_MIN_WIDTH)
        expect(clampSidePanelWidth(284)).toBe(284)
        expect(clampSidePanelWidth(999)).toBe(SIDE_PANEL_MAX_WIDTH)
        expect(clampSidePanelWidth(Number.NaN)).toBe(284)
    })

    test("setSetting stores values and theme follows the choice row", () => {
        const store = freshStore()
        store.getState().setSetting("fontSize", "14")
        expect(store.getState().stVals.fontSize).toBe("14")

        const before = store.getState().theme
        store.getState().setSetting("theme", before === "dark" ? "light" : "dark")
        expect(store.getState().theme).not.toBe(before)
    })

    test("setSetting persists across store instances via localStorage", () => {
        // bun test registers a happy-dom window; expose its storage globally so
        // the store's bare `localStorage` references resolve like in a browser.
        const g = globalThis as { localStorage?: Storage }
        if (!g.localStorage) g.localStorage = window.localStorage
        g.localStorage.removeItem("yuuzu-ide-v2-settings")
        freshStore().getState().setSetting("rowLimit", "1K")
        expect(freshStore().getState().stVals.rowLimit).toBe("1K")
        g.localStorage.removeItem("yuuzu-ide-v2-settings")
    })

    test("persists side panel width across store instances", () => {
        const g = globalThis as { localStorage?: Storage }
        if (!g.localStorage) g.localStorage = window.localStorage
        g.localStorage.removeItem("yuuzu-ide-v2-settings")

        const store = freshStore()
        store.getState().setSidePanelWidth(360)
        expect(store.getState().sidePanelWidth).toBe(360)

        store.getState().persistSidePanelWidth()
        expect(freshStore().getState().sidePanelWidth).toBe(360)

        g.localStorage.removeItem("yuuzu-ide-v2-settings")
    })

    test("settingLimit maps the rowLimit choice onto a numeric LIMIT", () => {
        expect(settingLimit({})).toBe(500)
        expect(settingLimit({ rowLimit: "100" })).toBe(100)
        expect(settingLimit({ rowLimit: "1K" })).toBe(1000)
    })

    test("loadStability populates demo diagnostics and metrics", () => {
        const store = freshStore()
        store.getState().loadStability()

        expect(store.getState().stab.metric).not.toBeNull()
        expect(store.getState().stab.events.length).toBeGreaterThan(0)
        expect(store.getState().stab.loading).toBe(false)
    })

    test("custom settings sections load stability data", () => {
        const store = freshStore()
        store.getState().setSettingsSection("performance")

        expect(store.getState().stSec).toBe("performance")
        expect(store.getState().stab.metric).not.toBeNull()
    })

    test("discardBackup opens a destructive confirmation", () => {
        const store = freshStore()
        store.getState().discardBackup("backup-1")

        expect(store.getState().confirm?.label).toBe("Discard")
        expect(store.getState().confirm?.danger).toBe(true)
    })
})

describe("editor edits", () => {
    test("setTabContent tracks dirtiness against the saved snapshot", () => {
        const store = freshStore()
        const tab = store.getState().ui.api.tabs.find((t) => t.type === "file")!
        store.getState().setTabContent(tab.id, "draft")
        let now = store.getState().ui.api.tabs.find((t) => t.id === tab.id)!
        expect(now.dirty).toBe(true)

        store.getState().setTabContent(tab.id, "")
        now = store.getState().ui.api.tabs.find((t) => t.id === tab.id)!
        expect(now.dirty).toBe(false)
    })

    test("setCursor updates and ignores identical positions", () => {
        const store = freshStore()
        store.getState().setCursor({ ln: 3, col: 7 })
        const ref = store.getState().cursor
        store.getState().setCursor({ ln: 3, col: 7 })
        expect(store.getState().cursor).toBe(ref)
        store.getState().setCursor(null)
        expect(store.getState().cursor).toBeNull()
    })

    test("toggleBlame adds and removes demo blame data", () => {
        const store = freshStore()
        const fileTab = store.getState().ui.api.tabs.find((tab) => tab.type === "file" && tab.path)!

        store.getState().toggleBlame(fileTab.id)
        let tab = store.getState().ui.api.tabs.find((item) => item.id === fileTab.id)!
        expect(tab.blame?.path).toBe(fileTab.path)
        expect(tab.blame?.segments.length).toBeGreaterThan(0)

        store.getState().toggleBlame(fileTab.id)
        tab = store.getState().ui.api.tabs.find((item) => item.id === fileTab.id)!
        expect(tab.blame).toBeUndefined()
        expect(tab.blameLoading).toBe(false)
    })
})

describe("confirm modal", () => {
    test("git checkout and revert ask for confirmation before acting", () => {
        const store = freshStore()
        store.getState().checkoutCommit(0)
        const confirm = store.getState().confirm
        expect(confirm?.label).toBe("Checkout")
        confirm?.action()
        expect(store.getState().toast).toContain("detached HEAD")
        store.getState().closeConfirm()
        expect(store.getState().confirm).toBeNull()

        store.getState().revertCommit(1)
        expect(store.getState().confirm?.danger).toBe(true)
    })
})

describe("sftp clipboard", () => {
    test("sftpCopy remembers the source pane and row for real transfers", () => {
        const store = freshStore()
        store.getState().sftpSelect("local", 2)
        store.getState().sftpCopy()
        const clip = store.getState().ui.api.sftp.clip
        expect(clip?.from).toBe("local")
        expect(clip?.idx).toBe(2)
    })

    test("pasting onto the source pane is rejected", () => {
        const store = freshStore()
        store.getState().sftpSelect("local", 0)
        store.getState().sftpCopy()
        store.getState().sftpFocus("local")
        store.getState().sftpPaste()
        expect(store.getState().ui.api.sftp.clip).not.toBeNull()
        expect(store.getState().toast).toContain("other pane")
    })
})

describe("openFile reveal", () => {
    test("openFile threads reveal in demo and clearReveal removes it", () => {
        const store = freshStore()
        store.getState().openFile("src/server.ts", { line: 5, col: 3 })

        const opened = store.getState().ui.api.tabs.find((tab) => tab.type === "file" && tab.path === "src/server.ts")
        expect(opened?.reveal).toEqual({ line: 5, col: 3 })

        store.getState().clearReveal(opened!.id)
        expect(store.getState().ui.api.tabs.find((tab) => tab.id === opened!.id)?.reveal).toBeUndefined()
    })

    test("openFile creates a new demo file tab with reveal and activates it", () => {
        const store = freshStore()
        const p0 = store.getState().ui.api
        expect(p0.tabs.some((tab) => tab.type === "file" && tab.path === "src/new-file.ts")).toBe(false)

        store.getState().openFile("src/new-file.ts", { line: 7, col: 2 })

        const p1 = store.getState().ui.api
        const opened = p1.tabs.find((tab) => tab.type === "file" && tab.path === "src/new-file.ts")
        expect(opened).toBeDefined()
        expect(opened?.reveal).toEqual({ line: 7, col: 2 })
        expect(p1.activeTab).toBe(opened!.id)
        expect(p1.tabs.length).toBe(p0.tabs.length + 1)
    })

    test("openFile forwards path and reveal to the real delegate", () => {
        const store = freshStore()
        const calls: unknown[][] = []
        registerRealDelegate({
            openFile: (...args: unknown[]) => calls.push(["open", ...args]),
        } as any)

        store.setState({ mode: "real" })
        ;(store.getState() as any).openFile("src/server.ts", { line: 2, col: 4 })

        expect(calls).toEqual([["open", "src/server.ts", { line: 2, col: 4 }]])
    })
})
