/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { BranchPopup } from "./BranchPopup"
import { PROJECT_PRESETS } from "./v2-model"
import { defUI, v2Store } from "./v2-store"

ensureTestDom()

afterEach(() => cleanup())

function branchRow(container: HTMLElement, name: string): HTMLElement {
    const row = [...container.querySelectorAll<HTMLElement>(".yz2-branch-row")]
        .find((item) => item.textContent?.includes(name))
    if (!row) throw new Error("Missing branch row: " + name)
    return row
}

function rowButton(row: HTMLElement, label: string): HTMLButtonElement {
    const button = [...row.querySelectorAll<HTMLButtonElement>("button")]
        .find((item) => item.textContent?.trim() === label)
    if (!button) throw new Error("Missing button: " + label)
    return button
}

describe("BranchPopup", () => {
    test("remote checkout uses a local branch target instead of detached remote ref", () => {
        const apiMeta = { ...PROJECT_PRESETS[0], branch: "main" }
        const apiUI = defUI("api")
        v2Store.setState((s) => ({
            mode: "demo",
            order: ["api"],
            active: "api",
            confirm: null,
            meta: { ...s.meta, api: apiMeta },
            ui: {
                ...s.ui,
                api: {
                    ...apiUI,
                    branchPopupOpen: true,
                    git: {
                        ...apiUI.git,
                        branch: "main",
                        branchesFull: [
                            { name: "main", current: true, remote: false, upstream: "origin/main", ahead: 0, behind: 0, head_short: "aaaaaa" },
                            { name: "origin/main", current: false, remote: true, upstream: null, ahead: 0, behind: 0, head_short: "aaaaaa" },
                            { name: "origin/feature", current: false, remote: true, upstream: null, ahead: 0, behind: 0, head_short: "bbbbbb" },
                        ],
                    },
                },
            },
        }))

        const view = render(<BranchPopup />)
        expect(rowButton(branchRow(view.container, "origin/main"), "Checkout").disabled).toBe(true)

        const remoteCheckout = rowButton(branchRow(view.container, "origin/feature"), "Checkout")
        expect(remoteCheckout.disabled).toBe(false)
        fireEvent.click(remoteCheckout)

        expect(v2Store.getState().confirm?.typed).toBe("CHECKOUT feature")
    })
})
