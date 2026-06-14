/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { BrowserView, EditorView } from "./ContentViews"
import type { Tab } from "./v2-model"
import { registerRealDelegate, v2Store } from "./v2-store"

ensureTestDom()

const initialApiUI = structuredClone(v2Store.getState().ui.api)

afterEach(() => {
    cleanup()
    registerRealDelegate(null)
    v2Store.setState((s) => ({
        mode: "demo",
        active: "api",
        ctx: null,
        confirm: null,
        ui: {
            ...s.ui,
            api: structuredClone(initialApiUI),
        },
    }))
})

function resetBrowser(tab: Tab) {
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
            },
        },
    }))
}

describe("EditorView", () => {
    test("real file diagnostics render gutter dots and line severity classes", () => {
        const tab = {
            id: 9001,
            type: "file" as const,
            name: "server.ts",
            path: "src/server.ts",
            realPath: "/workspace/src/server.ts",
            content: "const a = 1\nconst b = nope\n",
            savedContent: "const a = 1\nconst b = nope\n",
            contentLang: "ts",
        }
        v2Store.setState((s) => ({
            mode: "real",
            active: "api",
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    tabs: [tab],
                    activeTab: tab.id,
                    diagnosticsByPath: {
                        "src/server.ts": [{
                            path: "src/server.ts",
                            range: { start_line: 1, start_character: 10, end_line: 1, end_character: 14 },
                            severity: "Error",
                            message: "Cannot find name nope",
                            source: "tsserver",
                        }],
                    },
                },
            },
        }))

        const view = render(<EditorView tab={tab} />)

        expect(view.container.querySelector(".yz2-ed-diagdot.is-error")).toBeTruthy()
        expect(view.container.querySelector(".yz2-ed-hlline.has-error")).toBeTruthy()
    })

    test("editor context menu captures textarea cursor before blur clears store cursor", () => {
        const tab = {
            id: 9002,
            type: "file" as const,
            name: "server.ts",
            path: "src/server.ts",
            realPath: "/workspace/src/server.ts",
            content: "alpha\nbeta\n",
            savedContent: "alpha\nbeta\n",
            contentLang: "ts",
        }
        v2Store.setState((s) => ({
            mode: "real",
            active: "api",
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    tabs: [tab],
                    activeTab: tab.id,
                },
            },
        }))

        const view = render(<EditorView tab={tab} />)
        const textarea = view.container.querySelector("textarea") as HTMLTextAreaElement
        textarea.selectionStart = 7
        textarea.selectionEnd = 7

        fireEvent.contextMenu(textarea, { clientX: 14, clientY: 18 })

        expect(v2Store.getState().ctx).toMatchObject({
            kind: "editor",
            path: "src/server.ts",
            cursor: { ln: 2, col: 2 },
        })
    })
})

describe("BrowserView", () => {
    test("disables screenshot capture without a real page", () => {
        const tab: Tab = { id: 9501, type: "browser", title: "browser", urlInput: "" }
        resetBrowser(tab)

        const view = render(<BrowserView tab={tab} />)
        const button = view.getByRole("button", { name: "Capture browser screenshot" }) as HTMLButtonElement

        expect(button.disabled).toBe(true)
    })

    test("captures browser screenshot bounds", () => {
        const calls: unknown[][] = []
        const tab: Tab = { id: 9502, type: "browser", title: "localhost:5173", url: "http://localhost:5173" }
        resetBrowser(tab)
        registerRealDelegate({
            browserCapture: (...args: unknown[]) => calls.push(["capture", ...args]),
        } as any)
        Object.defineProperty(window, "screenX", { value: 5, configurable: true })
        Object.defineProperty(window, "screenY", { value: 7, configurable: true })

        const view = render(<BrowserView tab={tab} />)
        const frame = view.container.querySelector("iframe") as HTMLIFrameElement
        frame.getBoundingClientRect = () => ({
            x: 10.4,
            y: 20.6,
            width: 300.2,
            height: 180.4,
            top: 20.6,
            left: 10.4,
            right: 310.6,
            bottom: 201,
            toJSON: () => ({}),
        })

        fireEvent.click(view.getByRole("button", { name: "Capture browser screenshot" }))

        expect(calls).toEqual([["capture", tab.id, { x: 15, y: 28, width: 300, height: 180 }]])
    })

    test("renders browser screenshot thumbnail with dimensions", () => {
        const tab: Tab = {
            id: 9503,
            type: "browser",
            title: "localhost:5173",
            url: "http://localhost:5173",
            screenshot: {
                dataUrl: "data:image/png;base64,ZmFrZQ==",
                width: 300,
                height: 180,
            },
        }
        resetBrowser(tab)

        const view = render(<BrowserView tab={tab} />)
        const img = view.getByAltText("Browser screenshot") as HTMLImageElement

        expect(img.src).toContain("data:image/png;base64,ZmFrZQ==")
        expect(view.getByText("300×180")).toBeTruthy()
    })
})
