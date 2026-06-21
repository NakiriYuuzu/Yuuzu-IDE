/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { TabStrip } from "./TabStrip"
import { v2Store } from "./v2-store"

ensureTestDom()

const initialState = {
    mode: v2Store.getState().mode,
    active: v2Store.getState().active,
    order: [...v2Store.getState().order],
    meta: structuredClone(v2Store.getState().meta),
    ui: structuredClone(v2Store.getState().ui),
}
const renameTerminalTabDefault = v2Store.getState().renameTerminalTab

const fileTab = { id: 9001, type: "file" as const, name: "README.md", path: "README.md" }
const cmdTab = { id: 9002, type: "cmd" as const, title: "zsh", buf: "", lines: [] }

function prepareStore(): void {
    act(() => {
        v2Store.setState({
            mode: "demo",
            active: "api",
            ui: {
                ...v2Store.getState().ui,
                api: {
                    ...v2Store.getState().ui.api,
                    activeTab: fileTab.id,
                    tabs: [fileTab, cmdTab],
                },
            },
        })
    })
}

beforeEach(() => {
    prepareStore()
})

afterEach(() => {
    cleanup()
    v2Store.setState({
        mode: initialState.mode,
        active: initialState.active,
        order: [...initialState.order],
        meta: structuredClone(initialState.meta),
        ui: structuredClone(initialState.ui),
        renameTerminalTab: renameTerminalTabDefault,
    })
})

describe("TabStrip", () => {
    test("double-click rename does not activate an inactive cmd tab first", async () => {
        const view = render(<TabStrip />)
        const cmdTitle = view.getByText(cmdTab.title!)

        fireEvent.click(cmdTitle, { detail: 1 })
        fireEvent.click(cmdTitle, { detail: 2 })
        fireEvent.doubleClick(cmdTitle, { detail: 2 })
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 260))
        })

        expect(view.getByRole("textbox", { name: "Rename tab" })).toBeTruthy()
        expect(v2Store.getState().ui.api.activeTab).toBe(fileTab.id)
    })

    test("single-click cmd title still activates the tab", async () => {
        const view = render(<TabStrip />)
        const cmdTitle = view.getByText(cmdTab.title!)

        fireEvent.click(cmdTitle, { detail: 1 })
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 260))
        })

        expect(v2Store.getState().ui.api.activeTab).toBe(cmdTab.id)
    })

    test("renames an inactive cmd tab on Enter", () => {
        const calls: Array<[number, string]> = []
        const originalRename = v2Store.getState().renameTerminalTab
        act(() => v2Store.setState({
            renameTerminalTab: (tabId, nextTitle) => {
                calls.push([tabId, nextTitle])
                originalRename(tabId, nextTitle)
            },
        }))

        const view = render(<TabStrip />)
        const cmdTitle = view.getByText(cmdTab.title!)
        fireEvent.doubleClick(cmdTitle)

        const input = view.getByRole("textbox", { name: "Rename tab" }) as HTMLInputElement
        expect(input).toBeTruthy()
        expect(input.value).toBe("zsh")
        fireEvent.change(input, { target: { value: "renamed terminal" } })
        fireEvent.keyDown(input, { key: "Enter" })

        expect(calls).toEqual([[cmdTab.id, "renamed terminal"]])
        expect(v2Store.getState().ui.api.tabs.find((t) => t.id === cmdTab.id)?.title).toBe("renamed terminal")
        expect(v2Store.getState().ui.api.activeTab).toBe(fileTab.id)
    })

    test("renames on blur and cancels on Escape", () => {
        const calls: Array<[number, string]> = []
        const originalRename = v2Store.getState().renameTerminalTab
        act(() => v2Store.setState({
            renameTerminalTab: (tabId, nextTitle) => {
                calls.push([tabId, nextTitle])
                originalRename(tabId, nextTitle)
            },
        }))

        const view = render(<TabStrip />)
        const cmdTitle = view.getByText(cmdTab.title!)
        fireEvent.doubleClick(cmdTitle)
        const input = view.getByRole("textbox", { name: "Rename tab" }) as HTMLInputElement
        expect(input.value).toBe("zsh")
        fireEvent.change(input, { target: { value: "blurred terminal" } })
        fireEvent.blur(input)

        expect(calls).toEqual([[cmdTab.id, "blurred terminal"]])

        fireEvent.doubleClick(view.getByText("blurred terminal"))
        const second = view.getByRole("textbox", { name: "Rename tab" }) as HTMLInputElement
        fireEvent.change(second, { target: { value: "discarded" } })
        fireEvent.keyDown(second, { key: "Escape" })

        expect(calls).toEqual([[cmdTab.id, "blurred terminal"]])
        expect(v2Store.getState().ui.api.tabs.find((t) => t.id === cmdTab.id)?.title).toBe("blurred terminal")
    })
})
