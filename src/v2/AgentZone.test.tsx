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
    order: [...v2Store.getState().order],
    meta: structuredClone(v2Store.getState().meta),
    ui: structuredClone(v2Store.getState().ui),
}

beforeEach(() => {
    cleanup()
    v2Store.setState({
        mode: initialState.mode,
        active: initialState.active,
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
        order: [...initialState.order],
        meta: structuredClone(initialState.meta),
        ui: structuredClone(initialState.ui),
    })
})

describe("AgentZone", () => {
    function setSession(overrides: { title?: string; sessionId?: string } = {}) {
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

        act(() => {
            v2Store.setState((s) => ({
                ui: {
                    ...s.ui,
                    api: {
                        ...s.ui.api,
                        wins: [seed],
                    },
                },
            }))
        })

        return seed
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
})
