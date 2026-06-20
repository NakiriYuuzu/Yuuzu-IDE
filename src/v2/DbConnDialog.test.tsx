/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act, cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { defaultDbDialogState } from "./db-dialog"
import { DbConnDialog } from "./DbConnDialog"
import { v2Store } from "./v2-store"

ensureTestDom()

const initialState = {
    mode: v2Store.getState().mode,
    active: v2Store.getState().active,
    meta: structuredClone(v2Store.getState().meta),
    ui: structuredClone(v2Store.getState().ui),
}

beforeEach(() => {
    cleanup()
    v2Store.setState({
        mode: "real",
        active: "api",
        meta: {
            ...structuredClone(initialState.meta),
            api: { ...initialState.meta.api, root: "/workspace" },
        },
        ui: structuredClone(initialState.ui),
    })
})

afterEach(() => {
    cleanup()
    v2Store.setState({
        mode: initialState.mode,
        active: initialState.active,
        meta: structuredClone(initialState.meta),
        ui: structuredClone(initialState.ui),
    })
})

describe("DbConnDialog", () => {
    test("submits sqlite test and save actions with the current form input", async () => {
        const calls: unknown[][] = []
        const previous = {
            testDbConn: v2Store.getState().testDbConn,
            saveDbConn: v2Store.getState().saveDbConn,
        }
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
            testDbConn: mock(async (input) => {
                calls.push(["test", input])
                return { ok: true, message: "連線成功", elapsed_ms: 1, server_version: "SQLite 3" }
            }),
            saveDbConn: mock(async (input) => {
                calls.push(["save", input])
            }),
        }))

        try {
            const view = render(<DbConnDialog />)

            fireEvent.change(view.getByLabelText("連線名稱"), { target: { value: "Local DB" } })
            fireEvent.change(view.getByLabelText("SQLite 檔案"), { target: { value: "/workspace/app.db" } })

            await act(async () => {
                fireEvent.click(view.getByRole("button", { name: "測試連線" }))
            })
            await act(async () => {
                fireEvent.click(view.getByRole("button", { name: "儲存" }))
            })

            expect(calls).toEqual([
                ["test", {
                    workspace_root: "/workspace",
                    name: "Local DB",
                    kind: "SQLite",
                    sqlite_path: "/workspace/app.db",
                    read_only: false,
                    production: false,
                }],
                ["save", {
                    workspace_root: "/workspace",
                    name: "Local DB",
                    kind: "SQLite",
                    sqlite_path: "/workspace/app.db",
                    read_only: false,
                    production: false,
                }],
            ])
        } finally {
            v2Store.setState(previous)
        }
    })

    test("shows validation errors instead of dispatching incomplete input", () => {
        const calls: unknown[] = []
        const previous = v2Store.getState().testDbConn
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
            testDbConn: mock(async (input) => {
                calls.push(input)
                return null
            }),
        }))

        try {
            const view = render(<DbConnDialog />)

            fireEvent.click(view.getByRole("button", { name: "測試連線" }))

            expect(view.getByText("請輸入連線名稱")).toBeTruthy()
            expect(calls).toEqual([])
        } finally {
            v2Store.setState({ testDbConn: previous })
        }
    })
})
