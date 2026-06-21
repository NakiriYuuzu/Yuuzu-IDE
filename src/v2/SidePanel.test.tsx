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
        sidePanelWidth: 284,
        stVals: {
            ...s.stVals,
            sidePanelWidth: "284",
        },
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
    test("resizes the side panel from the keyboard separator", () => {
        const view = render(<SidePanel />)
        const handle = view.getByRole("separator", { name: "Resize side panel" })

        expect(handle.getAttribute("aria-valuemin")).toBe("220")
        expect(handle.getAttribute("aria-valuemax")).toBe("420")
        expect(handle.getAttribute("aria-valuenow")).toBe("284")

        fireEvent.keyDown(handle, { key: "ArrowRight" })
        expect(v2Store.getState().sidePanelWidth).toBe(300)
        expect(handle.getAttribute("aria-valuenow")).toBe("300")

        fireEvent.keyDown(handle, { key: "Home" })
        expect(v2Store.getState().sidePanelWidth).toBe(220)
        expect(handle.getAttribute("aria-valuenow")).toBe("220")

        fireEvent.keyDown(handle, { key: "End" })
        expect(v2Store.getState().sidePanelWidth).toBe(420)
        expect(handle.getAttribute("aria-valuenow")).toBe("420")
    })

    test("resizes the side panel by dragging the right edge", () => {
        const view = render(<SidePanel />)

        const side = view.container.querySelector(".yz2-side") as HTMLElement
        const handle = view.getByRole("separator", { name: "Resize side panel" }) as HTMLElement

        side.getBoundingClientRect = () => ({
            x: 100,
            y: 0,
            left: 100,
            top: 0,
            right: 384,
            bottom: 600,
            width: 284,
            height: 600,
            toJSON: () => ({}),
        })
        handle.setPointerCapture = () => undefined
        handle.releasePointerCapture = () => undefined

        fireEvent.pointerDown(handle, { pointerId: 1, clientX: 384 })
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 460 })
        expect(v2Store.getState().sidePanelWidth).toBe(360)
        expect(handle.classList.contains("is-dragging")).toBe(true)

        fireEvent.pointerUp(handle, { pointerId: 1, clientX: 460 })
        expect(handle.classList.contains("is-dragging")).toBe(false)
    })

    test("renders primary modes as icon-only activity tabs", () => {
        const view = render(<SidePanel />)

        const tabs = view.container.querySelector(".yz2-activity-tabs")
        expect(tabs).toBeTruthy()
        expect(tabs!.querySelectorAll(".yz2-activity-tab")).toHaveLength(5)

        expect(view.getByRole("button", { name: "Files" })).toBeTruthy()
        expect(view.getByRole("button", { name: "Git" })).toBeTruthy()
        expect(view.getByRole("button", { name: "Database" })).toBeTruthy()
        expect(view.getByRole("button", { name: "SSH-SFTP" })).toBeTruthy()
        expect(view.getByRole("button", { name: "AgentZone" })).toBeTruthy()

        expect(view.queryByText("Files")).toBeNull()
        expect(view.queryByText("Git")).toBeNull()
        expect(view.queryByText("Database")).toBeNull()
        expect(view.queryByText("SSH · SFTP")).toBeNull()
        expect(view.queryByText("AgentZone")).toBeNull()
    })

    test("activity tabs select the matching SidePanel mode", () => {
        const view = render(<SidePanel />)

        fireEvent.click(view.getByRole("button", { name: "Git" }))
        expect(v2Store.getState().ui.api.fn).toBe("git")
        expect(view.getByText("SOURCE CONTROL")).toBeTruthy()

        fireEvent.click(view.getByRole("button", { name: "Database" }))
        expect(v2Store.getState().ui.api.fn).toBe("db")
        expect(view.getByText("DATABASES")).toBeTruthy()

        fireEvent.click(view.getByRole("button", { name: "SSH-SFTP" }))
        expect(v2Store.getState().ui.api.fn).toBe("ssh")
        expect(view.getByText("SSH · SFTP")).toBeTruthy()

        fireEvent.click(view.getByRole("button", { name: "AgentZone" }))
        expect(v2Store.getState().ui.api.fn).toBe("agent")
        expect(view.getByText("AGENT ZONE")).toBeTruthy()
    })

    test("database empty state opens the add connection dialog", () => {
        const calls: unknown[][] = []
        const previousOpenDbConnDialog = v2Store.getState().openDbConnDialog
        restoreActions = () => {
            v2Store.setState({
                openDbConnDialog: previousOpenDbConnDialog,
            })
        }
        act(() => {
            v2Store.setState((s) => ({
                active: "api",
                openDbConnDialog: (...args: unknown[]) => calls.push(args),
                ui: {
                    ...s.ui,
                    api: {
                        ...s.ui.api,
                        fn: "db",
                        dbConns: [],
                    },
                },
            }))
        })

        const view = render(<SidePanel />)

        fireEvent.click(view.getByRole("button", { name: "+ 新增連線" }))

        expect(calls).toEqual([[]])
    })
})
