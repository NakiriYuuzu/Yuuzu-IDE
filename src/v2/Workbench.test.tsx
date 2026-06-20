/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cleanup, render } from "@testing-library/react"

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
        meta: structuredClone(initialWorkbenchState.meta),
        ui: structuredClone(initialWorkbenchState.ui),
    })
})

afterEach(() => {
    cleanup()
    v2Store.setState({
        mode: initialWorkbenchState.mode,
        active: initialWorkbenchState.active,
        meta: structuredClone(initialWorkbenchState.meta),
        ui: structuredClone(initialWorkbenchState.ui),
    })
})

describe("WorkbenchV2", () => {
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
