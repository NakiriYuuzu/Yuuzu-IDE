/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { AgentZone } from "./AgentZone"
import { v2Store } from "./v2-store"

ensureTestDom()

const initialState = {
    mode: v2Store.getState().mode,
    active: v2Store.getState().active,
    azWidth: v2Store.getState().azWidth,
    azColsOverride: v2Store.getState().azColsOverride,
    azSplitRatio: v2Store.getState().azSplitRatio,
    order: [...v2Store.getState().order],
    meta: structuredClone(v2Store.getState().meta),
    ui: structuredClone(v2Store.getState().ui),
}

beforeEach(() => {
    cleanup()
    v2Store.setState({
        mode: initialState.mode,
        active: initialState.active,
        azWidth: initialState.azWidth,
        azColsOverride: initialState.azColsOverride,
        azSplitRatio: initialState.azSplitRatio,
        order: [...initialState.order],
        meta: structuredClone(initialState.meta),
        ui: structuredClone(initialState.ui),
    })
})

afterEach(() => {
    cleanup()
    v2Store.setState({
        mode: initialState.mode,
        active: initialState.active,
        azWidth: initialState.azWidth,
        azColsOverride: initialState.azColsOverride,
        azSplitRatio: initialState.azSplitRatio,
        order: [...initialState.order],
        meta: structuredClone(initialState.meta),
        ui: structuredClone(initialState.ui),
    })
})

describe("AgentZone", () => {
    function setSessions(count: number, overrides: { title?: string; sessionId?: string } = {}) {
        const seed = {
            id: 9101,
            title: "agent session",
            status: "running",
            lines: [],
            buf: "",
            min: false,
            max: false,
            ...overrides,
        }
        const wins = Array.from({ length: Math.max(1, count) }, (_, idx) => ({
            ...seed,
            id: seed.id + idx,
            title: count > 1 ? `agent session ${idx + 1}` : seed.title,
        }))

        act(() => {
            v2Store.setState((s) => ({
                ui: {
                    ...s.ui,
                    api: {
                        ...s.ui.api,
                        wins,
                    },
                },
            }))
        })

        return wins
    }

    function setSession(overrides: { title?: string; sessionId?: string } = {}) {
        return setSessions(1, overrides)[0]
    }

    test("double click title enters inline edit and Enter submits rename", () => {
        const seed = setSession({ title: "claude runner" })
        const calls: Array<[number, string]> = []
        const previous = v2Store.getState().renameAgentSession
        act(() =>
            v2Store.setState({
                renameAgentSession: (winId, nextTitle) => {
                    calls.push([winId, nextTitle])
                },
            }),
        )

        try {
            const view = render(<AgentZone />)

            fireEvent.doubleClick(view.getByText(seed.title))
            const editor = view.getByRole("textbox")

            expect((editor as HTMLInputElement).value).toBe(seed.title)

            fireEvent.change(editor, { target: { value: "renamed session" } })
            fireEvent.keyDown(editor, { key: "Enter", code: "Enter" })

            expect(calls).toEqual([[seed.id, "renamed session"]])
        } finally {
            act(() => v2Store.setState({ renameAgentSession: previous }))
        }
    })

    test("blur submits rename and Escape cancels without rename", () => {
        const seed = setSession({ title: "focus session" })
        const calls: Array<[number, string]> = []
        const previous = v2Store.getState().renameAgentSession
        act(() =>
            v2Store.setState({
                renameAgentSession: (winId, nextTitle) => {
                    calls.push([winId, nextTitle])
                },
            }),
        )

        try {
            const view = render(<AgentZone />)

            fireEvent.doubleClick(view.getByText(seed.title))
            const editor = view.getByRole("textbox")

            fireEvent.change(editor, { target: { value: "blur session" } })
            fireEvent.blur(editor)
            expect(calls).toEqual([[seed.id, "blur session"]])

            fireEvent.doubleClick(view.getByText(seed.title))
            const cancelEditor = view.getByRole("textbox")
            fireEvent.change(cancelEditor, { target: { value: "cancelled" } })
            fireEvent.keyDown(cancelEditor, { key: "Escape", code: "Escape" })
            expect(calls).toEqual([[seed.id, "blur session"]])
        } finally {
            act(() => v2Store.setState({ renameAgentSession: previous }))
        }
    })

    test("Enter and Escape do not suppress a later blur rename", () => {
        const seed = setSession({ title: "sticky session" })
        const view = render(<AgentZone />)

        fireEvent.doubleClick(view.getByText(seed.title))
        const enterEditor = view.getByRole("textbox")
        fireEvent.change(enterEditor, { target: { value: "entered session" } })
        fireEvent.keyDown(enterEditor, { key: "Enter", code: "Enter" })

        expect(v2Store.getState().ui.api.wins.find((w) => w.id === seed.id)?.title).toBe("entered session")

        fireEvent.doubleClick(view.getByText("entered session"))
        const afterEnterEditor = view.getByRole("textbox")
        fireEvent.change(afterEnterEditor, { target: { value: "after enter blur" } })
        fireEvent.blur(afterEnterEditor)

        expect(v2Store.getState().ui.api.wins.find((w) => w.id === seed.id)?.title).toBe("after enter blur")

        fireEvent.doubleClick(view.getByText("after enter blur"))
        const escapeEditor = view.getByRole("textbox")
        fireEvent.change(escapeEditor, { target: { value: "cancelled title" } })
        fireEvent.keyDown(escapeEditor, { key: "Escape", code: "Escape" })

        expect(v2Store.getState().ui.api.wins.find((w) => w.id === seed.id)?.title).toBe("after enter blur")

        fireEvent.doubleClick(view.getByText("after enter blur"))
        const afterEscapeEditor = view.getByRole("textbox")
        fireEvent.change(afterEscapeEditor, { target: { value: "after escape blur" } })
        fireEvent.blur(afterEscapeEditor)

        expect(v2Store.getState().ui.api.wins.find((w) => w.id === seed.id)?.title).toBe("after escape blur")
    })

    test("double-click title does not trigger maximize action", () => {
        const seed = setSession({ title: "focus target" })
        const calls: number[] = []
        const previous = v2Store.getState().azMax
        act(() =>
            v2Store.setState({
                azMax: (id) => {
                    calls.push(id)
                },
            }),
        )

        try {
            const view = render(<AgentZone />)
            fireEvent.doubleClick(view.getByText(seed.title))

            expect(calls).toHaveLength(0)
        } finally {
            act(() => v2Store.setState({ azMax: previous }))
        }
    })

    test("double-click inside the rename input does not trigger maximize action", () => {
        const seed = setSession({ title: "editable target" })
        const calls: number[] = []
        const previous = v2Store.getState().azMax
        act(() =>
            v2Store.setState({
                azMax: (id) => {
                    calls.push(id)
                },
            }),
        )

        try {
            const view = render(<AgentZone />)
            fireEvent.doubleClick(view.getByText(seed.title))
            fireEvent.doubleClick(view.getByRole("textbox"))

            expect(calls).toHaveLength(0)
        } finally {
            act(() => v2Store.setState({ azMax: previous }))
        }
    })

    test("resolved two-column layout shows separator and manual 3-column hides it", () => {
        setSessions(4)
        const view = render(<AgentZone />)
        expect(view.getByRole("separator")).toBeTruthy()

        act(() => v2Store.getState().setAzColsOverride(3))
        expect(view.queryByRole("separator")).toBeNull()
    })

    test("dragging the separator updates azSplitRatio", () => {
        setSessions(4)
        act(() => v2Store.setState({ azWidth: 1000 }))
        render(<AgentZone />)

        const canvas = document.querySelector(".yz2-az-canvas") as HTMLDivElement
        const rect = {
            left: 16,
            right: 1016,
            top: 0,
            bottom: 700,
            width: 1000,
            height: 700,
            x: 16,
            y: 0,
            toJSON: () => "",
        } as unknown as DOMRect
        canvas.getBoundingClientRect = () => rect

        const separator = document.querySelector('[role="separator"]') as HTMLDivElement
        expect(separator).toBeTruthy()

        fireEvent.pointerDown(separator, { clientX: 200, pointerId: 1 })
        fireEvent.pointerMove(separator, { clientX: 10000, pointerId: 1 })
        fireEvent.pointerUp(separator, { clientX: 10000, pointerId: 1 })

        expect(v2Store.getState().azSplitRatio).toBe(70)
    })

    test("keyboard controls update ratio and aria-valuenow", () => {
        setSessions(4)
        act(() => v2Store.setState({ azWidth: 1280 }))
        render(<AgentZone />)
        const separator = document.querySelector('[role="separator"]') as HTMLDivElement
        expect(separator).toBeTruthy()
        separator.focus()

        fireEvent.keyDown(separator, { key: "ArrowRight" })
        expect(separator.getAttribute("aria-valuenow")).toBe("52")
        expect(v2Store.getState().azSplitRatio).toBe(52)

        fireEvent.keyDown(separator, { key: "Home" })
        expect(separator.getAttribute("aria-valuenow")).toBe("30")
        expect(v2Store.getState().azSplitRatio).toBe(30)

        fireEvent.keyDown(separator, { key: "End" })
        expect(separator.getAttribute("aria-valuenow")).toBe("70")
        expect(v2Store.getState().azSplitRatio).toBe(70)
    })
})
