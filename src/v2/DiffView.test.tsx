/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { DiffView } from "./DiffView"
import type { Tab } from "./v2-model"
import { v2Store } from "./v2-store"
import type { GitDiffHunks } from "../features/git/git-diff-model"

ensureTestDom()

afterEach(() => cleanup())

const hunks: GitDiffHunks = {
    path: "src/app.ts",
    staged: false,
    binary: false,
    truncated: false,
    hunks: [{
        header: "@@ -1,3 +1,3 @@",
        old_start: 1,
        old_lines: 3,
        new_start: 1,
        new_lines: 3,
        lines: [
            { kind: "context", old_no: 1, new_no: 1, text: "keep", word_ranges: [] },
            { kind: "del", old_no: 2, new_no: null, text: "old", word_ranges: [] },
            { kind: "add", old_no: null, new_no: 2, text: "new", word_ranges: [] },
        ],
    }],
}

function seedGit(staged: boolean) {
    v2Store.setState((s) => ({
        mode: "demo",
        active: "api",
        confirm: null,
        ui: {
            ...s.ui,
            api: {
                ...s.ui.api,
                git: {
                    ...s.ui.api.git,
                    staged: staged ? [{ path: "src/app.ts", kind: "modified", st: "M", staged: true }] : [],
                    unstaged: staged ? [] : [{ path: "src/app.ts", kind: "modified", st: "M", staged: false }],
                    conflicts: [],
                    hasConflicts: false,
                },
            },
        },
    }))
}

describe("DiffView", () => {
    test("renders flattened diff rows with line numbers", () => {
        const tab: Tab = {
            id: 1,
            type: "diff",
            title: "diff · app.ts",
            path: "src/app.ts",
            diffStaged: false,
            diff: [
                { t: "h", s: "@@ -1,2 +1,2 @@", oldNo: null, newNo: null, hunkIndex: 0, lineIndex: null },
                { t: "d", s: "old", oldNo: 1, newNo: null, hunkIndex: 0, lineIndex: 0 },
                { t: "a", s: "new", oldNo: null, newNo: 1, hunkIndex: 0, lineIndex: 1 },
            ],
        }

        const view = render(<DiffView tab={tab} />)
        expect(view.getByText("src/app.ts")).toBeTruthy()
        expect(view.getByText("Unstaged")).toBeTruthy()
        expect(view.getByText("@@ -1,2 +1,2 @@")).toBeTruthy()
        expect(view.getByText("old")).toBeTruthy()
        expect(view.getByText("new")).toBeTruthy()
    })

    test("renders compare hunks with current on the left and selected version on the right", () => {
        const tab: Tab = {
            id: 5,
            type: "diff",
            title: "compare · app.ts",
            path: "src/app.ts",
            diffCommit: "abc123",
            diffCompare: "worktree",
            diffHunks: hunks,
        }

        const view = render(<DiffView tab={tab} />)
        const left = view.getByLabelText("Current version")
        const right = view.getByLabelText("Selected version")

        expect(left.textContent).toContain("new")
        expect(left.textContent).not.toContain("old")
        expect(right.textContent).toContain("old")
        expect(right.textContent).not.toContain("new")
    })

    test("renders demo compare rows with current on the left and selected version on the right", () => {
        const tab: Tab = {
            id: 6,
            type: "diff",
            title: "compare · app.ts",
            path: "src/app.ts",
            diffCommit: "abc123",
            diffCompare: "worktree",
            diff: [
                { t: "h", s: "@@ -1,2 +1,2 @@", oldNo: null, newNo: null, hunkIndex: 0, lineIndex: null },
                { t: "d", s: "old", oldNo: 1, newNo: null, hunkIndex: 0, lineIndex: 0 },
                { t: "a", s: "new", oldNo: null, newNo: 1, hunkIndex: 0, lineIndex: 1 },
            ],
        }

        const view = render(<DiffView tab={tab} />)
        const left = view.getByLabelText("Current version")
        const right = view.getByLabelText("Selected version")

        expect(left.textContent).toContain("new")
        expect(left.textContent).not.toContain("old")
        expect(right.textContent).toContain("old")
        expect(right.textContent).not.toContain("new")
    })

    test("renders legacy commit diff tabs as current versus selected compare", () => {
        const tab: Tab = {
            id: 7,
            type: "diff",
            title: "commit · app.ts",
            path: "src/app.ts",
            diffCommit: "abc123",
            diffHunks: hunks,
        }

        const view = render(<DiffView tab={tab} />)
        const left = view.getByLabelText("Current version")
        const right = view.getByLabelText("Selected version")

        expect(view.container.querySelector(".badge")?.textContent).toBe("Current")
        expect(left.textContent).toContain("new")
        expect(left.textContent).not.toContain("old")
        expect(right.textContent).toContain("old")
        expect(right.textContent).not.toContain("new")
    })

    test("stages a whole hunk from an unstaged working diff", () => {
        seedGit(false)
        const tab: Tab = {
            id: 2,
            type: "diff",
            title: "diff · app.ts",
            path: "src/app.ts",
            diffStaged: false,
            diffHunks: hunks,
        }

        const view = render(<DiffView tab={tab} />)
        fireEvent.click(view.getByText("Stage hunk"))

        expect(v2Store.getState().ui.api.git.staged.map((file) => file.path)).toEqual(["src/app.ts"])
        expect(v2Store.getState().ui.api.git.unstaged).toEqual([])
        expect((view.getByText("Stage hunk") as HTMLButtonElement).disabled).toBe(false)
    })

    test("selected lines enable staged action and revert confirmation", () => {
        seedGit(false)
        const tab: Tab = {
            id: 3,
            type: "diff",
            title: "diff · app.ts",
            path: "src/app.ts",
            diffStaged: false,
            diffHunks: hunks,
        }

        const view = render(<DiffView tab={tab} />)
        const lineChecks = view.container.querySelectorAll(".yz2-diff-line input[type=checkbox]")
        expect(lineChecks.length).toBe(2)
        fireEvent.click(lineChecks[0] as Element)

        const stageSelected = view.getByText("Stage selected") as HTMLButtonElement
        expect(stageSelected.disabled).toBe(false)
        const revertSelected = view.getByText("Revert selected") as HTMLButtonElement
        expect(revertSelected.disabled).toBe(false)

        fireEvent.click(revertSelected)
        expect(v2Store.getState().confirm?.typed).toBe("DISCARD")
        expect(v2Store.getState().confirm?.label).toBe("Revert")
        expect((view.getByText("Stage selected") as HTMLButtonElement).disabled).toBe(true)
        expect((view.getByText("Revert selected") as HTMLButtonElement).disabled).toBe(true)
        v2Store.getState().closeConfirm()
        expect((lineChecks[1] as HTMLInputElement).disabled).toBe(false)
        fireEvent.click(lineChecks[1] as Element)
        expect((view.getByText("Stage selected") as HTMLButtonElement).disabled).toBe(false)
    })

    test("staged diffs unstage hunks and do not offer revert", () => {
        seedGit(true)
        const tab: Tab = {
            id: 4,
            type: "diff",
            title: "staged · app.ts",
            path: "src/app.ts",
            diffStaged: true,
            diffHunks: { ...hunks, staged: true },
        }

        const view = render(<DiffView tab={tab} />)
        expect(view.queryByText("Revert selected")).toBeNull()
        fireEvent.click(view.getByText("Unstage hunk"))

        expect(v2Store.getState().ui.api.git.staged).toEqual([])
        expect(v2Store.getState().ui.api.git.unstaged.map((file) => file.path)).toEqual(["src/app.ts"])
        expect((view.getByText("Unstage hunk") as HTMLButtonElement).disabled).toBe(false)
    })
})
