/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"

type TestUpdateCheck =
    | { kind: "available"; version: string; date?: string; notes?: string; install: () => Promise<void> }
    | { kind: "current" }
    | { kind: "error"; message: string }

let nextUpdateResult: TestUpdateCheck = { kind: "current" }
const checkForUpdateMock = mock(async () => nextUpdateResult)
const updateToastMessageMock = mock((result: TestUpdateCheck, silent: boolean) => {
    if (result.kind === "available") {
        return silent
            ? "更新 " + result.version + " 可用 — 前往 Settings › Updates 安裝"
            : "更新 " + result.version + " 可用"
    }
    if (silent) return null
    if (result.kind === "current") return "已是最新版本"
    return "檢查更新失敗：" + result.message
})

mock.module("./updater", () => ({
    checkForUpdate: checkForUpdateMock,
    updateToastMessage: updateToastMessageMock,
}))

import { CodeActionsOverlay, ConfirmModal, ContextMenu, NodeNameModal, ReferencesOverlay, SettingsModal } from "./Overlays"
import { v2Store } from "./v2-store"

ensureTestDom()

const initialOverlayState = {
    mode: v2Store.getState().mode,
    active: v2Store.getState().active,
    order: [...v2Store.getState().order],
    meta: structuredClone(v2Store.getState().meta),
    ui: structuredClone(v2Store.getState().ui),
    stOpen: v2Store.getState().stOpen,
    stSec: v2Store.getState().stSec,
    toast: v2Store.getState().toast,
}

beforeEach(() => {
    nextUpdateResult = { kind: "current" }
    checkForUpdateMock.mockClear()
    updateToastMessageMock.mockClear()
})

afterEach(() => {
    cleanup()
    v2Store.setState({
        mode: initialOverlayState.mode,
        active: initialOverlayState.active,
        order: [...initialOverlayState.order],
        meta: structuredClone(initialOverlayState.meta),
        ui: structuredClone(initialOverlayState.ui),
        stOpen: initialOverlayState.stOpen,
        stSec: initialOverlayState.stSec,
        toast: initialOverlayState.toast,
        confirm: null,
        nodeNameDialog: null,
        ctx: null,
    })
})

describe("ConfirmModal", () => {
    test("requires typed confirmation before running a destructive action", () => {
        let ran = false
        v2Store.getState().openConfirm({
            title: "Discard changes",
            body: "This cannot be undone.",
            label: "Discard",
            danger: true,
            typed: "DISCARD",
            action: () => {
                ran = true
            },
        })

        const view = render(<ConfirmModal />)
        const button = view.getByRole("button", { name: "Discard" }) as HTMLButtonElement
        expect(button.disabled).toBe(true)

        fireEvent.change(view.getByLabelText("Confirmation text"), { target: { value: "DISCAR" } })
        expect(button.disabled).toBe(true)

        fireEvent.change(view.getByLabelText("Confirmation text"), { target: { value: "DISCARD" } })
        expect(button.disabled).toBe(false)
        fireEvent.click(button)

        expect(ran).toBe(true)
        expect(v2Store.getState().confirm).toBeNull()
    })
})

describe("ContextMenu", () => {
    test("html file context menu opens the file in the built-in browser", () => {
        const previous = {
            ctx: v2Store.getState().ctx,
            openFileInBrowser: (v2Store.getState() as any).openFileInBrowser,
        }
        const opened: string[] = []

        act(() => v2Store.setState({
            openFileInBrowser: (path: string) => opened.push(path),
        } as any))

        try {
            act(() => v2Store.getState().openCtx({ kind: "file", x: 12, y: 20, path: "public/index.html" }))
            const htmlMenu = render(<ContextMenu />)
            fireEvent.click(htmlMenu.getByRole("button", { name: "Open in Browser" }))
            expect(opened).toEqual(["public/index.html"])
            htmlMenu.unmount()

            act(() => v2Store.getState().openCtx({ kind: "file", x: 12, y: 20, path: "src/server.ts" }))
            const tsMenu = render(<ContextMenu />)
            expect(tsMenu.queryByRole("button", { name: "Open in Browser" })).toBeNull()
        } finally {
            act(() => v2Store.setState({
                ctx: previous.ctx,
                openFileInBrowser: previous.openFileInBrowser,
            } as any))
        }
    })

    test("new folder uses the in-app name modal instead of browser prompt", () => {
        const previousAddNode = v2Store.getState().addNode
        const calls: Array<Parameters<typeof previousAddNode>> = []
        const originalPrompt = window.prompt
        window.prompt = () => {
            throw new Error("window.prompt must not be used for Explorer creation")
        }

        act(() => v2Store.setState({
            mode: "real",
            addNode: (...args: Parameters<typeof previousAddNode>) => {
                calls.push(args)
                previousAddNode(...args)
            },
        }))

        try {
            act(() => v2Store.getState().openCtx({ kind: "root", x: 12, y: 20 }))
            const menu = render(<ContextMenu />)
            fireEvent.click(menu.getByRole("button", { name: "New folder" }))
            menu.unmount()

            expect(calls).toEqual([["", "dir"]])
            expect(v2Store.getState().nodeNameDialog).toMatchObject({
                dirPath: "",
                kind: "dir",
                value: "new-folder",
            })

            const modal = render(<NodeNameModal />)
            const input = modal.getByLabelText("Name") as HTMLInputElement
            expect(input.value).toBe("new-folder")
            fireEvent.change(input, { target: { value: "feature" } })
            fireEvent.click(modal.getByRole("button", { name: "Create folder" }))

            expect(v2Store.getState().nodeNameDialog).toBeNull()
        } finally {
            window.prompt = originalPrompt
            act(() => v2Store.setState({ addNode: previousAddNode, nodeNameDialog: null }))
        }
    })

    test("commit rows expose typed reset and rebase actions", () => {
        v2Store.getState().selectProject("api")
        const short = v2Store.getState().ui.api.git.commits[0].h

        v2Store.getState().openCtx({ kind: "commit", x: 12, y: 20, commitIdx: 0 })

        let view = render(<ContextMenu />)
        fireEvent.click(view.getByRole("button", { name: /Reset to here \(hard\)/ }))
        expect(v2Store.getState().confirm?.typed).toBe("RESET HARD " + short)
        expect(v2Store.getState().confirm?.danger).toBe(true)
        view.unmount()

        v2Store.setState({ confirm: null })
        v2Store.getState().openCtx({ kind: "commit", x: 12, y: 20, commitIdx: 0 })
        view = render(<ContextMenu />)
        fireEvent.click(view.getByRole("button", { name: /Reset working tree \(hard\)/ }))
        expect(v2Store.getState().confirm?.typed).toBe("RESET HARD")
        expect(v2Store.getState().confirm?.danger).toBe(true)
        view.unmount()

        v2Store.setState({ confirm: null })
        v2Store.getState().openCtx({ kind: "commit", x: 12, y: 20, commitIdx: 0 })
        view = render(<ContextMenu />)
        fireEvent.click(view.getByRole("button", { name: new RegExp("Rebase main onto " + short) }))
        expect(v2Store.getState().confirm?.typed).toBe("REBASE " + short)
        expect(v2Store.getState().confirm?.danger).toBe(true)
    })

    test("commit export menu items pass scope and format to the store", () => {
        v2Store.getState().selectProject("api")
        const previous = v2Store.getState().exportCommit
        const calls: Array<Parameters<typeof previous>> = []

        act(() => v2Store.setState({
            exportCommit: (...args: Parameters<typeof previous>) => {
                calls.push(args)
            },
        }))

        const clickExport = (label: RegExp) => {
            act(() => v2Store.getState().openCtx({ kind: "commit", x: 12, y: 20, commitIdx: 0 }))
            const view = render(<ContextMenu />)
            fireEvent.click(view.getByRole("button", { name: label }))
            view.unmount()
        }

        try {
            clickExport(/Export changed files \(folder\)/)
            clickExport(/Export changed files \(zip\)/)
            clickExport(/Export snapshot \(folder\)/)
            clickExport(/Export snapshot \(zip\)/)
        } finally {
            act(() => v2Store.setState({ exportCommit: previous }))
        }

        expect(calls).toEqual([
            [0, "changed_files", "folder"],
            [0, "changed_files", "zip"],
            [0, "snapshot", "folder"],
            [0, "snapshot", "zip"],
        ])
    })

    test("editor rows route language actions with the context cursor", () => {
        const previous = {
            gotoDefinition: v2Store.getState().gotoDefinition,
            findReferences: v2Store.getState().findReferences,
            renameSymbol: v2Store.getState().renameSymbol,
            codeActionsAt: v2Store.getState().codeActionsAt,
        }
        const calls: unknown[][] = []
        const prompt = globalThis.prompt

        act(() => v2Store.setState({
            gotoDefinition: (...args: unknown[]) => calls.push(["goto", ...args]),
            findReferences: (...args: unknown[]) => calls.push(["refs", ...args]),
            renameSymbol: (...args: unknown[]) => calls.push(["rename", ...args]),
            codeActionsAt: (...args: unknown[]) => calls.push(["actions", ...args]),
        }))
        globalThis.prompt = () => "renamed"

        try {
            const openMenu = () => {
                act(() => v2Store.getState().openCtx({
                    kind: "editor",
                    x: 12,
                    y: 20,
                    path: "src/server.ts",
                    cursor: { ln: 2, col: 4 },
                }))
                return render(<ContextMenu />)
            }

            let view = openMenu()
            fireEvent.click(view.getByRole("button", { name: /Go to Definition/ }))
            view.unmount()

            view = openMenu()
            fireEvent.click(view.getByRole("button", { name: /Find References/ }))
            view.unmount()

            view = openMenu()
            fireEvent.click(view.getByRole("button", { name: /Rename Symbol/ }))
            view.unmount()

            view = openMenu()
            fireEvent.click(view.getByRole("button", { name: /Code Actions/ }))
            view.unmount()
        } finally {
            globalThis.prompt = prompt
            act(() => v2Store.setState(previous))
        }

        expect(calls).toEqual([
            ["goto", "src/server.ts", 2, 4],
            ["refs", "src/server.ts", 2, 4],
            ["rename", "src/server.ts", 2, 4, "renamed"],
            ["actions", "src/server.ts", 2, 4],
        ])
    })

    test("editor language actions stay disabled without a context cursor", () => {
        const previous = {
            gotoDefinition: v2Store.getState().gotoDefinition,
            findReferences: v2Store.getState().findReferences,
            renameSymbol: v2Store.getState().renameSymbol,
            codeActionsAt: v2Store.getState().codeActionsAt,
        }
        const calls: unknown[][] = []

        act(() => v2Store.setState({
            gotoDefinition: (...args: unknown[]) => calls.push(["goto", ...args]),
            findReferences: (...args: unknown[]) => calls.push(["refs", ...args]),
            renameSymbol: (...args: unknown[]) => calls.push(["rename", ...args]),
            codeActionsAt: (...args: unknown[]) => calls.push(["actions", ...args]),
        }))

        try {
            act(() => v2Store.getState().openCtx({
                kind: "editor",
                x: 12,
                y: 20,
                path: "src/server.ts",
                cursor: null,
            }))
            const view = render(<ContextMenu />)
            const goto = view.getByRole("button", { name: /Go to Definition/ }) as HTMLButtonElement
            const refs = view.getByRole("button", { name: /Find References/ }) as HTMLButtonElement
            const rename = view.getByRole("button", { name: /Rename Symbol/ }) as HTMLButtonElement
            const actions = view.getByRole("button", { name: /Code Actions/ }) as HTMLButtonElement

            expect(goto.disabled).toBe(true)
            expect(refs.disabled).toBe(true)
            expect(rename.disabled).toBe(true)
            expect(actions.disabled).toBe(true)

            fireEvent.click(goto)
            fireEvent.click(refs)
            fireEvent.click(rename)
            fireEvent.click(actions)
            expect(calls).toEqual([])
        } finally {
            act(() => v2Store.setState(previous))
        }
    })

    test("Rename terminal tab passes prompt value to store action", () => {
        const previous = {
            renameTerminalTab: v2Store.getState().renameTerminalTab,
        }
        const calls: Array<Parameters<typeof previous.renameTerminalTab>> = []
        const prompt = globalThis.prompt
        const promptCalls: Array<{ label: string | undefined; value: string | undefined }> = []
        const tab = { id: 9901, type: "cmd" as const, title: "zsh", sessionId: "term-rename" }
        act(() => v2Store.setState((s) => ({
            ui: {
                ...s.ui,
                [s.active]: {
                    ...s.ui[s.active],
                    tabs: [tab],
                    activeTab: tab.id,
                },
            },
        })))
        const title = tab.title ?? ""

        const inputs = ["renamed terminal", "", null]
        let cursor = 0
        globalThis.prompt = (label?: string, value?: string) => {
            promptCalls.push({ label, value })
            return inputs[cursor++] ?? null
        }

        act(() => v2Store.setState({
            renameTerminalTab: (tabId, nextTitle) => calls.push([tabId, nextTitle]),
        }))

        try {
            v2Store.getState().openCtx({ kind: "tab", x: 12, y: 20, id: tab.id, type: "cmd" })
            const view = render(<ContextMenu />)
            fireEvent.click(view.getByRole("button", { name: /Rename terminal/ }))
            view.unmount()

            v2Store.getState().openCtx({ kind: "tab", x: 12, y: 20, id: tab.id, type: "cmd" })
            const second = render(<ContextMenu />)
            fireEvent.click(second.getByRole("button", { name: /Rename terminal/ }))
            second.unmount()

            v2Store.getState().openCtx({ kind: "tab", x: 12, y: 20, id: tab.id, type: "cmd" })
            const third = render(<ContextMenu />)
            fireEvent.click(third.getByRole("button", { name: /Rename terminal/ }))
            third.unmount()

            expect(calls).toEqual([
                [tab.id, "renamed terminal"],
                [tab.id, ""],
            ])
            expect(promptCalls[0]?.label).toBe("Rename terminal:")
            expect(promptCalls[0]?.value).toBe(title)
            expect(promptCalls).toHaveLength(3)
        } finally {
            globalThis.prompt = prompt
            act(() => v2Store.setState(previous))
        }
    })

    test("Rename session for agent passes prompt value to store action", () => {
        const previous = {
            renameAgentSession: v2Store.getState().renameAgentSession,
        }
        const calls: Array<Parameters<typeof previous.renameAgentSession>> = []
        const prompt = globalThis.prompt
        const promptCalls: Array<{ label: string | undefined; value: string | undefined }> = []
        const win = {
            id: 9902,
            title: "agent session",
            status: "shell",
            lines: [],
            buf: "",
            min: false,
            max: false,
            sessionId: "agent-rename",
        }
        act(() => v2Store.setState((s) => ({
            ui: {
                ...s.ui,
                [s.active]: {
                    ...s.ui[s.active],
                    wins: [win],
                    azActive: win.id,
                },
            },
        })))

        globalThis.prompt = (label?: string, value?: string) => {
            promptCalls.push({ label, value })
            return "renamed session"
        }

        act(() => v2Store.setState({
            renameAgentSession: (winId, nextTitle) => calls.push([winId, nextTitle]),
        }))

        try {
            v2Store.getState().openCtx({ kind: "session", x: 12, y: 20, winId: win.id })
            const view = render(<ContextMenu />)
            fireEvent.click(view.getByRole("button", { name: /Rename session/ }))
            view.unmount()

            expect(calls).toEqual([[win.id, "renamed session"]])
            expect(promptCalls[0]?.label).toBe("Rename session:")
            expect(promptCalls[0]?.value).toBe(win.title)
        } finally {
            globalThis.prompt = prompt
            act(() => v2Store.setState(previous))
        }
    })

    test("database connection menu exposes edit and confirmed delete actions", () => {
        const previous = {
            openDbConnDialog: v2Store.getState().openDbConnDialog,
            deleteDbConn: v2Store.getState().deleteDbConn,
        }
        const calls: unknown[][] = []
        act(() => v2Store.setState((s) => ({
            openDbConnDialog: (...args: unknown[]) => calls.push(["edit", ...args]),
            deleteDbConn: (...args: unknown[]) => {
                calls.push(["delete", ...args])
                return Promise.resolve()
            },
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    dbConns: [{
                        name: "App DB",
                        engine: "PostgreSQL",
                        live: true,
                        tables: [],
                        profileId: "pg-1",
                    }],
                },
            },
        })))

        try {
            act(() => v2Store.getState().openCtx({ kind: "dbconn", x: 12, y: 20, ci: 0, name: "App DB", live: true }))
            let view = render(<ContextMenu />)
            fireEvent.click(view.getByRole("button", { name: "編輯連線" }))
            expect(calls).toEqual([["edit", "edit", "pg-1"]])
            view.unmount()

            act(() => v2Store.getState().openCtx({ kind: "dbconn", x: 12, y: 20, ci: 0, name: "App DB", live: true }))
            view = render(<ContextMenu />)
            fireEvent.click(view.getByRole("button", { name: "刪除連線" }))
            expect(v2Store.getState().confirm?.title).toBe("刪除連線")
            view.unmount()

            view = render(<ConfirmModal />)
            fireEvent.click(view.getByRole("button", { name: "刪除" }))
            expect(calls).toEqual([
                ["edit", "edit", "pg-1"],
                ["delete", "pg-1"],
            ])
        } finally {
            act(() => v2Store.setState(previous))
        }
    })
})

describe("SettingsModal", () => {
    test("Settings nav exposes the Updates section", () => {
        act(() => v2Store.setState({
            stOpen: true,
            stSec: "general",
        }))

        const view = render(<SettingsModal />)
        fireEvent.click(view.getByRole("button", { name: /Updates/ }))

        expect(v2Store.getState().stSec).toBe("updates")
        expect(view.getByText("Check for and install Yuuzu-IDE updates.")).toBeTruthy()
        expect(view.getByRole("button", { name: "Check for updates" })).toBeTruthy()
    })

    test("Updates section reports current version from a manual check", async () => {
        nextUpdateResult = { kind: "current" }
        act(() => v2Store.setState({
            stOpen: true,
            stSec: "updates",
            toast: null,
        }))

        const view = render(<SettingsModal />)
        fireEvent.click(view.getByRole("button", { name: "Check for updates" }))

        expect(await view.findByText("已是最新版本")).toBeTruthy()
        expect(checkForUpdateMock).toHaveBeenCalledTimes(1)
        expect(updateToastMessageMock).toHaveBeenCalledWith({ kind: "current" }, false)
        expect(v2Store.getState().toast).toBe("已是最新版本")
    })

    test("Updates section offers Install & Restart when an update is available", async () => {
        const install = mock(async () => {})
        nextUpdateResult = {
            kind: "available",
            version: "0.2.0",
            date: "2026-06-22T03:17:20Z",
            notes: "### Changes\n- Added Windows portable zip",
            install,
        }
        act(() => v2Store.setState({
            stOpen: true,
            stSec: "updates",
            toast: null,
        }))

        const view = render(<SettingsModal />)
        fireEvent.click(view.getByRole("button", { name: "Check for updates" }))

        const installButton = await view.findByRole("button", { name: "Install & Restart" })
        expect(view.getByText("更新 0.2.0 可用")).toBeTruthy()
        expect(view.getByText("2026-06-22T03:17:20Z")).toBeTruthy()
        expect(view.getByText("### Changes")).toBeTruthy()
        expect(view.getByText("- Added Windows portable zip")).toBeTruthy()
        expect(v2Store.getState().toast).toBe("更新 0.2.0 可用")

        fireEvent.click(installButton)
        await waitFor(() => expect(install).toHaveBeenCalledTimes(1))
    })

    test("Performance section configures background metric refresh interval", () => {
        const previous = {
            stOpen: v2Store.getState().stOpen,
            stSec: v2Store.getState().stSec,
            stVals: structuredClone(v2Store.getState().stVals),
            stab: structuredClone(v2Store.getState().stab),
        }

        act(() => v2Store.setState((s) => ({
            stOpen: true,
            stSec: "performance",
            stVals: { ...s.stVals, metricRefreshInterval: "off" },
        })))

        try {
            const view = render(<SettingsModal />)

            expect(view.getByText("Background refresh")).toBeTruthy()
            expect(view.getByText("Update status-bar memory without loading diagnostics")).toBeTruthy()
            fireEvent.click(view.getByRole("button", { name: "10s" }))

            expect(v2Store.getState().stVals.metricRefreshInterval).toBe("10s")
        } finally {
            act(() => v2Store.setState(previous))
        }
    })

    test("Language Servers section tolerates bootstrap no-workspace state", () => {
        const previous = {
            mode: v2Store.getState().mode,
            active: v2Store.getState().active,
            stOpen: v2Store.getState().stOpen,
            stSec: v2Store.getState().stSec,
            ui: structuredClone(v2Store.getState().ui),
        }

        act(() => v2Store.setState({
            mode: "real",
            active: "",
            stOpen: true,
            stSec: "language",
            ui: {},
        }))

        try {
            const view = render(<SettingsModal />)
            expect(view.getByText("No active workspace.")).toBeTruthy()
            expect(view.getByRole("button", { name: "Refresh language data" })).toBeTruthy()
        } finally {
            act(() => v2Store.setState(previous))
        }
    })

    test("Language Servers reloads language data when mounted and active workspace switches", () => {
        const previous = {
            mode: v2Store.getState().mode,
            active: v2Store.getState().active,
            stOpen: v2Store.getState().stOpen,
            stSec: v2Store.getState().stSec,
            ui: structuredClone(v2Store.getState().ui),
            reloadLang: v2Store.getState().reloadLang,
        }
        const reloadCalls: string[] = []

        act(() => v2Store.setState((s) => {
            const first = s.order[0] ?? "api"
            const second = s.order[1]
            return {
                mode: "real",
                active: first,
                stOpen: true,
                stSec: "language",
                ui: {
                    ...s.ui,
                    [first]: {
                        ...s.ui[first],
                        lspLoaded: false,
                        lspServers: [],
                        diagnosticsByPath: {},
                        lspLogs: [],
                    },
                    ...(s.ui[second]
                        ? {
                            [second]: {
                                ...s.ui[second],
                                lspLoaded: false,
                                lspServers: [],
                                diagnosticsByPath: {},
                                lspLogs: [],
                            },
                        }
                        : {}),
                },
                reloadLang: () => {
                    reloadCalls.push(v2Store.getState().active)
                },
            }
        }))

        try {
            render(<SettingsModal />)
            const previousActive = v2Store.getState().active
            const nextActive = v2Store.getState().order.find((id) => id !== previousActive)
            expect(nextActive).toBeDefined()

            expect(reloadCalls).toEqual([previousActive])

            act(() => {
                v2Store.setState({ active: nextActive! })
            })

            if (!nextActive) {
                throw new Error("Expected a second project id for active switch coverage")
            }

            const expected = [previousActive, nextActive]
            expect(reloadCalls).toEqual(expected)
        } finally {
            act(() => v2Store.setState(previous))
        }
    })

    test("Language Servers section renders servers and diagnostics and restarts a selected server", () => {
        const previous = {
            active: v2Store.getState().active,
            mode: v2Store.getState().mode,
            stOpen: v2Store.getState().stOpen,
            stSec: v2Store.getState().stSec,
            ui: structuredClone(v2Store.getState().ui),
            restartLspServer: v2Store.getState().restartLspServer,
        }

        const restartCalls: string[] = []

        act(() => v2Store.setState((s) => ({
            active: "api",
            mode: "real",
            stOpen: true,
            stSec: "language",
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    lspLoaded: true,
                    lspServers: [{
                        workspace_id: "w1",
                        workspace_root: "/Users/yuuzu/projects/api",
                        language: "typescript",
                        display_name: "TypeScript Language Server",
                        state: "Running",
                        pid: 1234,
                        memory_bytes: 1_572_864,
                        open_documents: 2,
                        last_error: null,
                    }],
                    diagnosticsByPath: {
                        "src/server.ts": [{
                            path: "src/server.ts",
                            severity: "error",
                            range: {
                                start_line: 2,
                                start_character: 1,
                                end_line: 2,
                                end_character: 3,
                            },
                            message: "Unexpected token",
                            source: "tsc",
                        }],
                    },
                    lspLogs: [
                        "[info] Language server started",
                    ],
                },
            },
            restartLspServer: (language) => restartCalls.push(language),
        })))

        try {
            const view = render(<SettingsModal />)

            expect(view.getByText("LANGUAGE SERVERS")).toBeTruthy()
            expect(view.getByText("TypeScript Language Server")).toBeTruthy()
            expect(view.getByText("src/server.ts:3")).toBeTruthy()
            expect(view.getByText("Unexpected token")).toBeTruthy()

            fireEvent.click(view.getByRole("button", { name: "Restart TypeScript Language Server" }))
            expect(restartCalls).toEqual(["typescript"])
        } finally {
            act(() => v2Store.setState(previous))
        }
    })

    test("Language Servers diagnostic click opens file at reveal position and closes settings", () => {
        const previous = {
            active: v2Store.getState().active,
            mode: v2Store.getState().mode,
            stOpen: v2Store.getState().stOpen,
            stSec: v2Store.getState().stSec,
            ui: structuredClone(v2Store.getState().ui),
            openFile: v2Store.getState().openFile,
        }

        const opened: Array<{ path: string; reveal?: { line: number; col: number } }> = []

        act(() => v2Store.setState((s) => ({
            active: "api",
            mode: "real",
            stOpen: true,
            stSec: "language",
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    lspLoaded: true,
                    lspServers: [],
                    diagnosticsByPath: {
                        "src/server.ts": [{
                            path: "src/server.ts",
                            severity: "warning",
                            range: {
                                start_line: 4,
                                start_character: 2,
                                end_line: 4,
                                end_character: 6,
                            },
                            message: "Unused variable",
                            source: "tsc",
                        }],
                    },
                    lspLogs: [],
                },
            },
            openFile: (path, reveal) => opened.push({ path, reveal }),
        })))

        try {
            const view = render(<SettingsModal />)
            fireEvent.click(view.getByRole("button", { name: /Open src\/server\.ts:5 .*Unused variable/ }))

            expect(opened).toEqual([{ path: "src/server.ts", reveal: { line: 5, col: 3 } }])
            expect(v2Store.getState().stOpen).toBe(false)
        } finally {
            act(() => v2Store.setState(previous))
        }
    })

    test("Language Servers searches workspace symbols and opens a selected result", async () => {
        const previous = {
            active: v2Store.getState().active,
            mode: v2Store.getState().mode,
            stOpen: v2Store.getState().stOpen,
            stSec: v2Store.getState().stSec,
            ui: structuredClone(v2Store.getState().ui),
            openFile: v2Store.getState().openFile,
            workspaceSymbols: v2Store.getState().workspaceSymbols,
        }

        const opened: Array<{ path: string; reveal?: { line: number; col: number } }> = []

        act(() => v2Store.setState((s) => ({
            active: "api",
            mode: "real",
            stOpen: true,
            stSec: "language",
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    lspLoaded: true,
                    lspServers: [],
                    diagnosticsByPath: {},
                    lspLogs: [],
                },
            },
            workspaceSymbols: async (query) => query === "User"
                ? [{
                    name: "UserService",
                    kind: "Class",
                    path: "src/UserService.cs",
                    line: 8,
                    col: 5,
                    containerName: "App.Services",
                }]
                : [],
            openFile: (path, reveal) => opened.push({ path, reveal }),
        })))

        try {
            const view = render(<SettingsModal />)
            fireEvent.change(view.getByLabelText("Workspace symbol query"), { target: { value: "User" } })
            fireEvent.click(view.getByRole("button", { name: "Search workspace symbols" }))

            const result = await view.findByRole("button", { name: /Open symbol UserService/ })
            fireEvent.click(result)

            expect(opened).toEqual([{ path: "src/UserService.cs", reveal: { line: 8, col: 5 } }])
            expect(v2Store.getState().stOpen).toBe(false)
        } finally {
            act(() => v2Store.setState(previous))
        }
    })
})

describe("ReferencesOverlay", () => {
    test("tolerates the real bootstrap state before a project is active", () => {
        v2Store.setState({ mode: "real", active: "", order: [], meta: {}, ui: {} })

        const view = render(<ReferencesOverlay />)

        expect(view.container.textContent).toBe("")
    })

    test("renders references and opens a selected file", () => {
        const previous = v2Store.getState().openFile
        const opened: string[] = []
        act(() => v2Store.setState((s) => ({
            active: "api",
            openFile: (path: string) => opened.push(path),
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    lspRefs: [
                        { path: "src/server.ts", line: 2, col: 4, preview: "const server = createServer()" },
                    ],
                },
            },
        })))

        try {
            const view = render(<ReferencesOverlay />)
            fireEvent.click(view.getByRole("button", { name: new RegExp("src/server\\.ts:2") }))

            expect(opened).toEqual(["src/server.ts"])
            expect(v2Store.getState().ui.api.lspRefs).toBeNull()
        } finally {
            act(() => v2Store.setState({ openFile: previous }))
        }
    })
})

describe("CodeActionsOverlay", () => {
    test("renders code actions and applies the selected action", () => {
        const previous = {
            active: v2Store.getState().active,
            ui: structuredClone(v2Store.getState().ui),
            applyCodeAction: v2Store.getState().applyCodeAction,
        }
        const applied: number[] = []

        act(() => v2Store.setState((s) => ({
            active: "api",
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    lspActions: [{
                        title: "Add using System",
                        kind: "quickfix",
                        edit: { changes: {} },
                    }],
                },
            },
            applyCodeAction: (index) => applied.push(index),
        })))

        try {
            const view = render(<CodeActionsOverlay />)
            fireEvent.click(view.getByRole("button", { name: /Apply code action Add using System/ }))

            expect(applied).toEqual([0])
        } finally {
            act(() => v2Store.setState(previous))
        }
    })
})
