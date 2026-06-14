/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import type { GitConflictFile } from "../features/git/git-model"
import { ConflictView } from "./ConflictView"
import type { Tab } from "./v2-model"
import { v2Store } from "./v2-store"

ensureTestDom()

afterEach(() => {
    cleanup()
    v2Store.setState((s) => ({
        confirm: null,
        ui: {
            ...s.ui,
            api: {
                ...s.ui.api,
                git: {
                    ...s.ui.api.git,
                    conflictChoices: {},
                },
            },
        },
    }))
})

const conflict: GitConflictFile = {
    path: "src/conflict.ts",
    base: "base",
    ours: "ours",
    theirs: "theirs",
    working: "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> incoming\n",
    blocks: [{
        start_line: 1,
        ours: ["ours"],
        theirs: ["theirs"],
    }],
    truncated: false,
}

const tab: Tab = {
    id: 1,
    type: "conflict",
    title: "conflict · conflict.ts",
    path: conflict.path,
    conflict,
}

describe("ConflictView", () => {
    test("renders choices and opens typed accept-side confirmation", () => {
        v2Store.getState().selectProject("api")
        v2Store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    tabs: [...s.ui.api.tabs, tab],
                    activeTab: tab.id,
                },
            },
        }))

        const view = render(<ConflictView tab={tab} />)
        expect(view.getByText("Conflict")).toBeTruthy()
        expect(view.getByText("src/conflict.ts")).toBeTruthy()
        expect(view.getByText("BASE")).toBeTruthy()
        expect(view.getByText("base")).toBeTruthy()

        fireEvent.click(view.getByRole("button", { name: "Use ours" }))
        expect(v2Store.getState().ui.api.git.conflictChoices).toEqual({ "src/conflict.ts:0": "ours" })
        expect((view.getByRole("button", { name: "Per-block write pending" }) as HTMLButtonElement).disabled).toBe(true)

        fireEvent.click(view.getByRole("button", { name: "Accept all ours" }))
        expect(v2Store.getState().confirm?.typed).toBe("ACCEPT OURS")
        expect(v2Store.getState().confirm?.danger).toBe(true)
    })
})
