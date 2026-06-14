/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { SidePanel } from "./SidePanel"
import { v2Store } from "./v2-store"

ensureTestDom()

let restoreActions: (() => void) | null = null

function resetSidePanelStore() {
    restoreActions?.()
    restoreActions = null
    cleanup()
    v2Store.setState((s) => ({
        mode: "demo",
        active: "api",
        ctx: null,
        confirm: null,
        ui: {
            ...s.ui,
            api: {
                ...s.ui.api,
                diagnosticsByPath: {},
                lspServers: [],
                lspLogs: [],
                lspRefs: null,
                lspLoaded: false,
            },
        },
    }))
    v2Store.getState().selectFn("files")
}

beforeEach(() => {
    resetSidePanelStore()
})

afterEach(() => {
    resetSidePanelStore()
})

describe("SidePanel", () => {
    test("language mode renders a panel body instead of a blank area", () => {
        v2Store.getState().selectFn("lang")

        const view = render(<SidePanel />)

        expect(view.getByText("LANGUAGE")).toBeTruthy()
        expect(view.getByText("Language services are not connected in demo mode.")).toBeTruthy()
    })

    test("language panel renders servers diagnostics logs and dispatches actions", () => {
        const calls: unknown[][] = []
        const previousReloadLang = v2Store.getState().reloadLang
        const previousRestartLspServer = v2Store.getState().restartLspServer
        const previousOpenFile = v2Store.getState().openFile
        restoreActions = () => {
            v2Store.setState({
                reloadLang: previousReloadLang,
                restartLspServer: previousRestartLspServer,
                openFile: previousOpenFile,
            })
        }
        act(() => {
            v2Store.setState((s) => ({
                mode: "real",
                active: "api",
                ui: {
                    ...s.ui,
                    api: {
                        ...s.ui.api,
                        fn: "lang",
                        lspLoaded: true,
                        lspServers: [{
                            workspace_id: "api",
                            workspace_root: "/workspace/api",
                            language: "TypeScript",
                            display_name: "TypeScript",
                            state: "Running",
                            pid: 123,
                            memory_bytes: 1048576,
                            open_documents: 2,
                            last_error: null,
                        }],
                        diagnosticsByPath: {
                            "src/server.ts": [{
                                path: "src/server.ts",
                                range: { start_line: 2, start_character: 4, end_line: 2, end_character: 10 },
                                severity: "Error",
                                message: "mock diagnostic",
                                source: "tsserver",
                            }],
                        },
                        lspLogs: ["initialized", "diagnostics updated"],
                    },
                },
                reloadLang: () => calls.push(["reload"]),
                restartLspServer: (path: string) => calls.push(["restart", path]),
                openFile: (path: string) => calls.push(["open", path]),
            }))
        })

        const view = render(<SidePanel />)

        expect(view.getByText("LANGUAGE SERVERS")).toBeTruthy()
        expect(view.getByText("TypeScript")).toBeTruthy()
        expect(view.container.querySelector(".yz2-lang-state.is-running")).toBeTruthy()
        expect(view.getByText("DIAGNOSTICS")).toBeTruthy()
        expect(view.getByText("src/server.ts:3")).toBeTruthy()
        expect(view.getByText("mock diagnostic")).toBeTruthy()
        expect(view.container.querySelector(".yz2-lang-sev.is-error")).toBeTruthy()
        expect(view.getByText("SERVER LOGS")).toBeTruthy()
        expect(view.getByText(/diagnostics updated/)).toBeTruthy()

        fireEvent.click(view.getByRole("button", { name: "Refresh language data" }))
        fireEvent.click(view.getByRole("button", { name: "Restart TypeScript" }))
        fireEvent.click(view.getByRole("button", { name: "Open src/server.ts" }))

        expect(calls).toEqual([
            ["reload"],
            ["restart", "TypeScript"],
            ["open", "src/server.ts"],
        ])
    })

    test("language server restart uses the row language when no document path is available", () => {
        const calls: unknown[][] = []
        const previousRestartLspServer = v2Store.getState().restartLspServer
        restoreActions = () => {
            v2Store.setState({
                restartLspServer: previousRestartLspServer,
            })
        }
        act(() => {
            v2Store.setState((s) => ({
                mode: "real",
                active: "api",
                ui: {
                    ...s.ui,
                    api: {
                        ...s.ui.api,
                        fn: "lang",
                        tabs: [],
                        lspLoaded: true,
                        diagnosticsByPath: {},
                        lspServers: [{
                            workspace_id: "api",
                            workspace_root: "/workspace/api",
                            language: "Rust",
                            display_name: "Rust Analyzer",
                            state: "Stopped",
                            pid: null,
                            memory_bytes: null,
                            open_documents: 0,
                            last_error: null,
                        }],
                    },
                },
                restartLspServer: (language: string) => calls.push(["restart", language]),
            }))
        })

        const view = render(<SidePanel />)

        fireEvent.click(view.getByRole("button", { name: "Restart Rust Analyzer" }))

        expect(calls).toEqual([["restart", "Rust"]])
    })
})
