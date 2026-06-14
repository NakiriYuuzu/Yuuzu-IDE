/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { GitGraphView } from "./GitGraphView"
import { v2Store } from "./v2-store"

ensureTestDom()

afterEach(() => {
    cleanup()
    v2Store.setState({ mode: "demo", active: "api", ctx: null, confirm: null })
})

describe("GitGraphView", () => {
    test("changed files open commit file diffs without hiding the real commit body", () => {
        const previous = (v2Store.getState() as any).openCommitFileDiff
        const calls: unknown[][] = []
        const commit = {
            lane: 0,
            m: "Implement export",
            a: "yuuzu",
            h: "abc123",
            t: "1m",
            refs: ["main"],
            par: [],
            fullHash: "abcdef1234567890",
        }

        act(() => v2Store.setState((s) => ({
            mode: "real",
            active: "api",
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    gitLoaded: true,
                    gitSel: 0,
                    git: { ...s.ui.api.git, branch: "main", commits: [commit] },
                    gitDetail: {
                        hash: "abcdef1234567890",
                        body: "Detailed body\n\nPreserved context",
                        files: [{ path: "src/server.ts", st: "M", add: 3, del: 1 }],
                    },
                },
            },
            openCommitFileDiff: (...args: unknown[]) => {
                calls.push(args)
            },
        } as any)))

        try {
            const view = render(<GitGraphView />)

            expect(view.getByText(/Detailed body/)).toBeTruthy()
            fireEvent.click(view.getByRole("button", { name: /src\/server\.ts/ }))

            expect(calls).toEqual([[0, "src/server.ts"]])
        } finally {
            act(() => v2Store.setState({ openCommitFileDiff: previous } as any))
        }
    })
})
