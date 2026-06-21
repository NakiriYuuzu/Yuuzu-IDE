/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { ConfirmModal, ContextMenu, ReferencesOverlay } from "./Overlays"
import { v2Store } from "./v2-store"

ensureTestDom()

const initialOverlayState = {
    mode: v2Store.getState().mode,
    active: v2Store.getState().active,
    order: [...v2Store.getState().order],
    meta: structuredClone(v2Store.getState().meta),
    ui: structuredClone(v2Store.getState().ui),
}

afterEach(() => {
    cleanup()
    v2Store.setState({
        mode: initialOverlayState.mode,
        active: initialOverlayState.active,
        order: [...initialOverlayState.order],
        meta: structuredClone(initialOverlayState.meta),
        ui: structuredClone(initialOverlayState.ui),
        confirm: null,
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
        }
        const calls: unknown[][] = []
        const prompt = globalThis.prompt

        act(() => v2Store.setState({
            gotoDefinition: (...args: unknown[]) => calls.push(["goto", ...args]),
            findReferences: (...args: unknown[]) => calls.push(["refs", ...args]),
            renameSymbol: (...args: unknown[]) => calls.push(["rename", ...args]),
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
        } finally {
            globalThis.prompt = prompt
            act(() => v2Store.setState(previous))
        }

        expect(calls).toEqual([
            ["goto", "src/server.ts", 2, 4],
            ["refs", "src/server.ts", 2, 4],
            ["rename", "src/server.ts", 2, 4, "renamed"],
        ])
    })

    test("editor language actions stay disabled without a context cursor", () => {
        const previous = {
            gotoDefinition: v2Store.getState().gotoDefinition,
            findReferences: v2Store.getState().findReferences,
            renameSymbol: v2Store.getState().renameSymbol,
        }
        const calls: unknown[][] = []

        act(() => v2Store.setState({
            gotoDefinition: (...args: unknown[]) => calls.push(["goto", ...args]),
            findReferences: (...args: unknown[]) => calls.push(["refs", ...args]),
            renameSymbol: (...args: unknown[]) => calls.push(["rename", ...args]),
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

            expect(goto.disabled).toBe(true)
            expect(refs.disabled).toBe(true)
            expect(rename.disabled).toBe(true)

            fireEvent.click(goto)
            fireEvent.click(refs)
            fireEvent.click(rename)
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
