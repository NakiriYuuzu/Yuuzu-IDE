/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { PROJECT_PRESETS } from "./v2-model"
import { defUI, v2Store } from "./v2-store"
import { StashPanel } from "./StashPanel"

ensureTestDom()

afterEach(() => cleanup())

describe("StashPanel", () => {
    test("tolerates the real bootstrap state before a project is active", () => {
        v2Store.setState({ mode: "real", active: "", order: [], meta: {}, ui: {} })

        const view = render(<StashPanel />)

        expect(view.container.textContent).toBe("")
    })

    test("branch editor closes when stash indices are reindexed under it", async () => {
        const apiMeta = { ...PROJECT_PRESETS[0], branch: "main" }
        const apiUI = defUI("api")
        v2Store.setState((s) => ({
            mode: "demo",
            order: ["api"],
            active: "api",
            meta: { ...s.meta, api: apiMeta },
            ui: {
                ...s.ui,
                api: {
                    ...apiUI,
                    stashPanelOpen: true,
                    git: {
                        ...apiUI.git,
                        stashes: [
                            { index: 0, message: "first", when_unix: 100 },
                            { index: 1, message: "second", when_unix: 200 },
                        ],
                    },
                },
            },
        }))

        const view = render(<StashPanel />)
        fireEvent.click(view.getAllByText("Branch")[1])
        expect(view.getByLabelText("Branch from stash 1")).toBeTruthy()

        await act(async () => {
            v2Store.setState((s) => ({
                ui: {
                    ...s.ui,
                    api: {
                        ...s.ui.api,
                        git: {
                            ...s.ui.api.git,
                            stashes: [{ index: 0, message: "second", when_unix: 200 }],
                        },
                    },
                },
            }))
        })

        await waitFor(() => {
            expect(Boolean(view.queryByLabelText("Branch from stash 0"))).toBe(false)
            expect(Boolean(view.queryByLabelText("Branch from stash 1"))).toBe(false)
        })
    })
})
