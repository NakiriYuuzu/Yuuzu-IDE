/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { DbTableView } from "./DbTableView"
import type { Tab } from "./v2-model"
import { registerRealDelegate, v2Store } from "./v2-store"

ensureTestDom()

const initialApiUI = structuredClone(v2Store.getState().ui.api)

function reset(tab: Tab) {
    registerRealDelegate(null)
    v2Store.setState((s) => ({
        mode: "real",
        active: "api",
        ctx: null,
        confirm: null,
        toast: null,
        ui: {
            ...s.ui,
            api: {
                ...structuredClone(initialApiUI),
                tabs: [tab],
                activeTab: tab.id,
                dbConns: [{
                    name: tab.conn ?? "main",
                    engine: tab.engine ?? "SQLite",
                    live: true,
                    profileId: tab.profileId,
                    tables: [{
                        n: tab.table ?? "users",
                        c: tab.count ?? "—",
                        cols: [{ name: "id", type: "int", nullable: false, pk: true }],
                    }],
                }],
            },
        },
    }))
}

afterEach(() => {
    cleanup()
    registerRealDelegate(null)
    v2Store.setState((s) => ({
        mode: "demo",
        active: "api",
        ctx: null,
        confirm: null,
        toast: null,
        ui: {
            ...s.ui,
            api: structuredClone(initialApiUI),
        },
    }))
})

describe("DbTableView", () => {
    test("history segment loads real query history", () => {
        const calls: unknown[][] = []
        const tab: Tab = {
            id: 9301,
            type: "db",
            title: "users",
            table: "users",
            conn: "main",
            engine: "SQLite",
            profileId: "db-main",
            view: "data",
            sql: "select * from users",
        }
        reset(tab)
        registerRealDelegate({
            dbHistory: (...args: unknown[]) => calls.push(["history", ...args]),
        } as any)

        const view = render(<DbTableView tab={tab} />)
        fireEvent.click(view.getByRole("button", { name: "History" }))

        expect(v2Store.getState().ui.api.tabs[0].view).toBe("history")
        expect(calls).toEqual([["history", tab.id]])
    })

    test("renders history loading and rows", () => {
        const tab: Tab = {
            id: 9302,
            type: "db",
            title: "users",
            table: "users",
            conn: "main",
            engine: "SQLite",
            profileId: "db-main",
            view: "history",
            history: [{
                sql: "UPDATE users SET active = 0",
                kind: "Mutation",
                when: "10:39",
                rows: "3 affected",
            }],
        }
        reset(tab)

        const view = render(<DbTableView tab={tab} />)

        expect(view.getByText("UPDATE users SET active = 0")).toBeTruthy()
        expect(view.getByText("Mutation")).toBeTruthy()
        expect(view.getByText("3 affected")).toBeTruthy()
    })

    test("renders mutation kind chip and honest fallback footer", () => {
        const tab: Tab = {
            id: 9303,
            type: "db",
            title: "users",
            table: "users",
            conn: "main",
            engine: "SQLite",
            profileId: "db-main",
            view: "data",
            sql: "update users set active = 0",
            grid: {
                cols: ["id"],
                rows: [["1"], ["2"]],
                ms: 8,
                truncated: false,
                affected: null,
                kind: "Mutation",
            },
        }
        reset(tab)

        const view = render(<DbTableView tab={tab} />)

        expect(view.getByText("Mutation")).toBeTruthy()
        expect(view.getByText("2 shown · 2 (shown) total")).toBeTruthy()
    })
})
