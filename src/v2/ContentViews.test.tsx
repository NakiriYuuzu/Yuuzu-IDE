/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { EditorView as CodeMirrorView } from "@codemirror/view"
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { BrowserView, EditorView } from "./ContentViews"
import type { Tab } from "./v2-model"
import { registerRealDelegate, v2Store } from "./v2-store"

ensureTestDom()

const initialApiUI = structuredClone(v2Store.getState().ui.api)
const initialStVals = structuredClone(v2Store.getState().stVals)

afterEach(() => {
    cleanup()
    registerRealDelegate(null)
    v2Store.setState((s) => ({
        mode: "demo",
        active: "api",
        ctx: null,
        confirm: null,
        cursor: null,
        stVals: structuredClone(initialStVals),
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
    test("editable real files use CodeMirror by default", () => {
        const tab = {
            id: 8999,
            type: "file" as const,
            name: "server.ts",
            path: "src/server.ts",
            realPath: "/workspace/src/server.ts",
            content: "const a = 1\n",
            savedContent: "const a = 1\n",
            contentLang: "ts",
        }
        v2Store.setState((s) => {
            const { editorEngine: _editorEngine, ...stVals } = s.stVals
            return {
                mode: "real",
                active: "api",
                stVals,
                ui: {
                    ...s.ui,
                    api: {
                        ...s.ui.api,
                        tabs: [tab],
                        activeTab: tab.id,
                    },
                },
            }
        })

        const view = render(<EditorView tab={tab} />)

        expect(view.container.querySelector(".yz2-ed-body.is-codemirror")).toBeTruthy()
        expect(view.container.querySelector(".cm-editor")).toBeTruthy()
        expect(view.container.querySelector("textarea")).toBeNull()
    })

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
            stVals: { ...s.stVals, editorEngine: "textarea" },
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
            stVals: { ...s.stVals, editorEngine: "textarea" },
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

    test("editor context menu falls back to the store cursor for CodeMirror targets", () => {
        const tab = {
            id: 9003,
            type: "file" as const,
            name: "server.ts",
            path: "src/server.ts",
            realPath: "/workspace/src/server.ts",
            content: "alpha\nbeta\n",
            savedContent: "alpha\nbeta\n",
            contentLang: "ts",
        }
        v2Store.setState((s) => {
            const { editorEngine: _editorEngine, ...stVals } = s.stVals
            return {
                mode: "real",
                active: "api",
                cursor: { ln: 2, col: 2 },
                stVals,
                ui: {
                    ...s.ui,
                    api: {
                        ...s.ui.api,
                        tabs: [tab],
                        activeTab: tab.id,
                    },
                },
            }
        })

        const view = render(<EditorView tab={tab} />)
        const body = view.container.querySelector(".yz2-ed-body") as HTMLElement

        fireEvent.contextMenu(body, { clientX: 14, clientY: 18 })

        expect(v2Store.getState().ctx).toMatchObject({
            kind: "editor",
            path: "src/server.ts",
            cursor: { ln: 2, col: 2 },
        })
    })

    test("editor context menu derives the CodeMirror cursor from the click position", () => {
        const tab = {
            id: 9004,
            type: "file" as const,
            name: "server.ts",
            path: "src/server.ts",
            realPath: "/workspace/src/server.ts",
            content: "alpha\nbeta\n",
            savedContent: "alpha\nbeta\n",
            contentLang: "ts",
        }
        v2Store.setState((s) => {
            const { editorEngine: _editorEngine, ...stVals } = s.stVals
            return {
                mode: "real",
                active: "api",
                cursor: null,
                stVals,
                ui: {
                    ...s.ui,
                    api: {
                        ...s.ui.api,
                        tabs: [tab],
                        activeTab: tab.id,
                    },
                },
            }
        })

        const view = render(<EditorView tab={tab} />)
        const cmEditor = view.container.querySelector(".cm-editor") as HTMLElement
        const cmView = CodeMirrorView.findFromDOM(cmEditor)
        expect(cmView).toBeTruthy()
        const originalPosAtCoords = cmView!.posAtCoords
        cmView!.posAtCoords = () => 7

        try {
            fireEvent.contextMenu(cmEditor, { clientX: 24, clientY: 32 })
        } finally {
            cmView!.posAtCoords = originalPosAtCoords
        }

        expect(v2Store.getState().ctx).toMatchObject({
            kind: "editor",
            path: "src/server.ts",
            cursor: { ln: 2, col: 2 },
        })
    })

    test("ctrl/cmd+click on a supported file triggers gotoDefinition at the caret", () => {
        const calls: unknown[][] = []
        registerRealDelegate({
            openFile: () => {},
            backupTab: () => {},
            gotoDefinition: (...args: unknown[]) => calls.push(["goto", ...args]),
            hoverAt: async () => null,
        } as any)

        const tab = {
            id: 9101,
            type: "file" as const,
            name: "server.ts",
            path: "src/server.ts",
            realPath: "/workspace/src/server.ts",
            content: "alpha\nbeta\n",
            contentLang: "ts",
        }
        v2Store.setState((s) => ({
            mode: "real",
            active: "api",
            stVals: { ...s.stVals, editorEngine: "textarea" },
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    tabs: [tab],
                    activeTab: tab.id,
                },
            },
        }))

        const view = render(<EditorView tab={tab as Tab} />)
        const textarea = view.container.querySelector("textarea") as HTMLTextAreaElement
        textarea.selectionStart = 7
        textarea.selectionEnd = 7

        fireEvent.click(textarea, { ctrlKey: true })

        expect(calls).toEqual([["goto", "src/server.ts", 2, 2]])
    })

    test("ctrl/cmd+click on an unsupported file does not call gotoDefinition", () => {
        const calls: unknown[][] = []
        registerRealDelegate({
            openFile: () => {},
            backupTab: () => {},
            gotoDefinition: (...args: unknown[]) => calls.push(["goto", ...args]),
            hoverAt: async () => null,
        } as any)

        const tab = {
            id: 9102,
            type: "file" as const,
            name: "README.md",
            path: "README.md",
            realPath: "/workspace/README.md",
            content: "alpha\nbeta\n",
            contentLang: "md",
        }
        v2Store.setState((s) => ({
            mode: "real",
            active: "api",
            stVals: { ...s.stVals, editorEngine: "textarea" },
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    tabs: [tab],
                    activeTab: tab.id,
                },
            },
        }))

        const view = render(<EditorView tab={tab as Tab} />)
        const textarea = view.container.querySelector("textarea") as HTMLTextAreaElement
        textarea.selectionStart = 7
        textarea.selectionEnd = 7

        fireEvent.click(textarea, { ctrlKey: true })

        expect(calls).toEqual([])
    })

    test("reveal clamp keeps caret within target line", async () => {
        const tab = {
            id: 9103,
            type: "file" as const,
            name: "server.ts",
            path: "src/server.ts",
            realPath: "/workspace/src/server.ts",
            content: "alpha\nbeta\n",
            contentLang: "ts",
            reveal: { line: 1, col: 999 },
        }
        v2Store.setState((s) => ({
            mode: "real",
            active: "api",
            stVals: { ...s.stVals, editorEngine: "textarea" },
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    tabs: [tab],
                    activeTab: tab.id,
                },
            },
        }))

        const view = render(<EditorView tab={tab as Tab} />)
        const textarea = view.container.querySelector("textarea") as HTMLTextAreaElement

        await Promise.resolve()

        expect(textarea.selectionStart).toBe(5)
        expect(textarea.selectionEnd).toBe(5)
    })

    test("reveal horizontally scrolls to the target column", async () => {
        const baseTab = {
            id: 9104,
            type: "file" as const,
            name: "server.ts",
            path: "src/server.ts",
            realPath: "/workspace/src/server.ts",
            content: "a".repeat(220) + "\nbeta\n",
            contentLang: "ts",
        }
        v2Store.setState((s) => ({
            mode: "real",
            active: "api",
            stVals: { ...s.stVals, editorEngine: "textarea" },
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    tabs: [baseTab],
                    activeTab: baseTab.id,
                },
            },
        }))

        const view = render(<EditorView tab={baseTab as Tab} />)
        const body = view.container.querySelector(".yz2-ed-body") as HTMLDivElement
        const textarea = view.container.querySelector("textarea") as HTMLTextAreaElement

        let recorded = 0
        let hasScrollSpy = false
        try {
            Object.defineProperty(body, "scrollLeft", {
                configurable: true,
                get: () => recorded,
                set: (v: number) => {
                    recorded = v
                    hasScrollSpy = true
                },
            })
        } catch {
            hasScrollSpy = false
        }

        v2Store.setState((s) => ({
            ...s,
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    tabs: [{ ...baseTab, reveal: { line: 1, col: 200 } }],
                    activeTab: baseTab.id,
                },
            },
        }))

        await Promise.resolve()

        if (hasScrollSpy) {
            expect(recorded).toBeGreaterThan(0)
        }
        expect(textarea.selectionStart).toBeGreaterThan(0)
    })

    test("ctrl+space requests completions and inserts a selected item", async () => {
        const calls: unknown[][] = []
        registerRealDelegate({
            completeAt: async (...args: unknown[]) => {
                calls.push(args)
                return [{ label: "console", detail: "global", insertText: "console" }]
            },
            openFile: () => {},
            backupTab: () => {},
            hoverAt: async () => null,
        } as any)

        const tab = {
            id: 9105,
            type: "file" as const,
            name: "server.ts",
            path: "src/server.ts",
            realPath: "/workspace/src/server.ts",
            content: "con",
            contentLang: "ts",
        }
        v2Store.setState((s) => ({
            mode: "real",
            active: "api",
            stVals: { ...s.stVals, editorEngine: "textarea" },
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    tabs: [tab],
                    activeTab: tab.id,
                },
            },
        }))

        const view = render(<EditorView tab={tab as Tab} />)
        const textarea = view.container.querySelector("textarea") as HTMLTextAreaElement
        textarea.selectionStart = 3
        textarea.selectionEnd = 3

        fireEvent.keyDown(textarea, { key: " ", code: "Space", ctrlKey: true })

        const option = await view.findByRole("button", { name: /console/ })
        fireEvent.click(option)

        expect(calls).toEqual([["src/server.ts", 1, 4]])
        expect(v2Store.getState().ui.api.tabs[0].content).toBe("console")
    })

    test("CodeMirror editor surface uses a bounded scroll body", async () => {
        const tab = {
            id: 9201,
            type: "file" as const,
            name: "Program.cs",
            path: "Program.cs",
            realPath: "/workspace/Program.cs",
            content: "class Program {}",
            contentLang: "csharp",
            savedContent: "class Program {}",
        }
        v2Store.setState((s) => ({
            mode: "real",
            stVals: { ...s.stVals, editorEngine: "codemirror" },
            active: "api",
            ui: {
                ...s.ui,
                api: { ...s.ui.api, tabs: [tab], activeTab: tab.id },
            },
        }))

        const view = render(<EditorView tab={tab as Tab} />)
        const body = view.container.querySelector(".yz2-ed-body.is-codemirror")
        const editor = view.container.querySelector(".cm-editor")
        expect(body).toBeTruthy()
        expect(editor).toBeTruthy()
    })

    test("CodeMirror editor surface preserves the editor instance across content updates", async () => {
        const tab = {
            id: 9202,
            type: "file" as const,
            name: "server.ts",
            path: "src/server.ts",
            realPath: "/workspace/src/server.ts",
            content: "const alpha = 1\n",
            contentLang: "ts",
            savedContent: "const alpha = 1\n",
        }
        v2Store.setState((s) => ({
            mode: "real",
            stVals: { ...s.stVals, editorEngine: "codemirror" },
            active: "api",
            ui: {
                ...s.ui,
                api: { ...s.ui.api, tabs: [tab], activeTab: tab.id },
            },
        }))

        const view = render(<EditorView tab={tab as Tab} />)
        const editor = view.container.querySelector(".cm-editor")

        view.rerender(<EditorView tab={{ ...tab, content: "const alpha = 12\n" } as Tab} />)
        await Promise.resolve()

        expect(view.container.querySelector(".cm-editor")).toBe(editor)
    })

    test("CodeMirror does not mark CRLF disk content dirty on mount", async () => {
        const calls: unknown[][] = []
        registerRealDelegate({
            backupTab: (...args: unknown[]) => calls.push(["backup", ...args]),
            lspChange: (...args: unknown[]) => calls.push(["change", ...args]),
        } as any)
        const tab = {
            id: 9203,
            type: "file" as const,
            name: "win.ts",
            path: "src/win.ts",
            realPath: "C:\\repo\\src\\win.ts",
            content: "const alpha = 1\r\nconst beta = 2\r\n",
            savedContent: "const alpha = 1\r\nconst beta = 2\r\n",
            lineEnding: "crlf" as const,
            savedLineEnding: "crlf" as const,
            contentLang: "ts",
        }
        v2Store.setState((s) => ({
            mode: "real",
            stVals: { ...s.stVals, editorEngine: "codemirror" },
            active: "api",
            ui: {
                ...s.ui,
                api: { ...s.ui.api, tabs: [tab], activeTab: tab.id },
            },
        }))

        render(<EditorView tab={tab as Tab} />)

        await waitFor(() => {
            const now = v2Store.getState().ui.api.tabs.find((item) => item.id === tab.id)!
            expect(now.content).toBe("const alpha = 1\nconst beta = 2\n")
            expect(now.savedContent).toBe("const alpha = 1\nconst beta = 2\n")
            expect(now.dirty).toBe(false)
        })
        expect(calls).toEqual([])
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

    test("renders workspace html previews with a sandboxed iframe", () => {
        const tab: Tab = {
            id: 9504,
            type: "browser",
            title: "index.html",
            path: "public/index.html",
            url: "workspace://public/index.html",
            htmlPreview: "<!doctype html><html><body><h1>Hello</h1></body></html>",
        }
        resetBrowser(tab)

        const view = render(<BrowserView tab={tab} />)
        const frame = view.container.querySelector("iframe") as HTMLIFrameElement
        const button = view.getByRole("button", { name: "Capture browser screenshot" }) as HTMLButtonElement

        expect(frame.getAttribute("srcdoc")).toContain("<h1>Hello</h1>")
        expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-modals")
        expect(button.disabled).toBe(true)
        expect((view.container.querySelector(".yz2-url-input") as HTMLInputElement).readOnly).toBe(true)
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
