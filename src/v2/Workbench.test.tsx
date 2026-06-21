/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { defaultDbDialogState } from "./db-dialog"
import { v2Store } from "./v2-store"
import { WorkbenchV2 } from "./Workbench"

ensureTestDom()

const initialWorkbenchState = {
    mode: v2Store.getState().mode,
    active: v2Store.getState().active,
    meta: structuredClone(v2Store.getState().meta),
    ui: structuredClone(v2Store.getState().ui),
}

beforeEach(() => {
    cleanup()
    v2Store.setState({
        mode: "demo",
        active: "api",
        panelOpen: true,
        meta: structuredClone(initialWorkbenchState.meta),
        ui: structuredClone(initialWorkbenchState.ui),
    })
})

afterEach(() => {
    cleanup()
    v2Store.setState({
        mode: initialWorkbenchState.mode,
        active: initialWorkbenchState.active,
        panelOpen: true,
        meta: structuredClone(initialWorkbenchState.meta),
        ui: structuredClone(initialWorkbenchState.ui),
    })
})

describe("WorkbenchV2", () => {
    test("renders side panel toggle before the brand and keeps toggling the panel", () => {
        const view = render(<WorkbenchV2 />)

        const titlebar = view.container.querySelector(".yz2-titlebar")
        const toggle = view.getByRole("button", { name: "Toggle side panel" })
        const brand = view.container.querySelector(".yz2-brand")

        expect(titlebar).toBeTruthy()
        expect(brand).toBeTruthy()
        expect(Array.from(titlebar!.children).indexOf(toggle)).toBeLessThan(
            Array.from(titlebar!.children).indexOf(brand!),
        )
        expect(toggle.getAttribute("aria-expanded")).toBe("true")
        expect(view.getByText("EXPLORER")).toBeTruthy()

        fireEvent.click(toggle)
        expect(v2Store.getState().panelOpen).toBe(false)
        expect(toggle.getAttribute("aria-expanded")).toBe("false")
        expect(view.queryByText("EXPLORER")).toBeNull()

        fireEvent.click(toggle)
        expect(v2Store.getState().panelOpen).toBe(true)
        expect(toggle.getAttribute("aria-expanded")).toBe("true")
        expect(view.getByText("EXPLORER")).toBeTruthy()
    })

    test("mounts the database connection dialog overlay", () => {
        v2Store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    dbDialog: {
                        ...defaultDbDialogState(),
                        open: true,
                    },
                },
            },
        }))

        const view = render(<WorkbenchV2 />)

        expect(view.getByRole("dialog", { name: "新增連線" })).toBeTruthy()
    })
})
