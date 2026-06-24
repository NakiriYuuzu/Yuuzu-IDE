/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import type { AzWindow, Tab } from "./v2-model"
import { v2Store } from "./v2-store"

const loadXtermMock = mock(() => new Promise<never>(() => {}))

mock.module("../features/terminal/load-xterm", () => ({
    loadXterm: loadXtermMock,
}))

ensureTestDom()

const { TerminalView } = await import("./ContentViews")
const { AgentZone } = await import("./AgentZone")

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

const yuzuCss = readFileSync(new URL("./yuzu.css", import.meta.url), "utf8")
const yuzuCssWithoutComments = yuzuCss.replace(/\/\*[\s\S]*?\*\//g, "")

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

function cssRuleBodyForSelector(selector: string): string {
    const rules = [...yuzuCssWithoutComments.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    const rule = rules.find((match) =>
        match[1]!.split(",").map((part) => part.trim()).includes(selector),
    )
    expect(rule).toBeTruthy()
    return rule![2]!.replace(/\s+/g, " ").trim()
}

function expectRuleContains(selector: string, declarations: string[]) {
    const body = cssRuleBodyForSelector(selector)
    for (const declaration of declarations) {
        expect(body).toContain(declaration)
    }
}

describe("terminal containment contract", () => {
    test("main terminal renders inside the bounded xterm host chain", () => {
        const tab: Tab = {
            id: 9301,
            type: "cmd",
            title: "zsh",
            sessionId: "workspace:terminal-1",
        }

        const view = render(<TerminalView tab={tab} />)
        const host = view.container.querySelector(
            ".yz2-view .yz2-term .yz2-xterm .terminal-host",
        )

        expect(host).toBeTruthy()
    })

    test("AgentZone real terminals render inside a bounded terminal body", () => {
        const win: AzWindow = {
            id: 9401,
            title: "agent session",
            status: "running",
            lines: [],
            buf: "",
            min: false,
            max: false,
            sessionId: "agent:terminal-1",
        }
        v2Store.setState((s) => ({
            active: "api",
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    wins: [win],
                },
            },
        }))

        const view = render(<AgentZone />)
        const host = view.container.querySelector(
            ".yz2-az-win-body.real .terminal-host",
        )

        expect(host).toBeTruthy()
    })

    test("AgentZone terminal canvas pins horizontal scroll caused by focused xterm helpers", () => {
        const win: AzWindow = {
            id: 9402,
            title: "agent session",
            status: "running",
            lines: [],
            buf: "",
            min: false,
            max: false,
            sessionId: "agent:terminal-2",
        }
        v2Store.setState((s) => ({
            active: "api",
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    wins: [win],
                },
            },
        }))

        const view = render(<AgentZone />)
        const canvas = view.container.querySelector(".yz2-az-canvas") as HTMLDivElement

        canvas.scrollLeft = 42
        fireEvent.scroll(canvas)

        expect(canvas.scrollLeft).toBe(0)
    })

    test("terminal CSS keeps xterm and IME helper layout inside the workbench", () => {
        expectRuleContains(".yz2-main", [
            "min-width: 0;",
            "overflow: hidden;",
        ])
        expectRuleContains(".yz2-view", [
            "min-width: 0;",
            "overflow: hidden;",
        ])
        expectRuleContains(".yz2-term", [
            "min-width: 0;",
            "overflow: hidden;",
        ])
        expectRuleContains(".yz2-xterm", [
            "min-width: 0;",
            "overflow: hidden;",
            "width: 100%;",
        ])
        expectRuleContains(".yz2 .terminal-host", [
            "box-sizing: border-box;",
            "min-width: 0;",
            "overflow: hidden;",
        ])
        expectRuleContains(".yz2 .terminal-host .xterm", [
            "max-width: 100%;",
        ])
        expectRuleContains(".yz2 .terminal-host .xterm-viewport", [
            "max-width: 100%;",
        ])
        expectRuleContains(".yz2 .terminal-host .xterm-screen", [
            "max-width: 100%;",
        ])
    })

    test("AgentZone CSS prevents terminal windows from forcing horizontal layout", () => {
        expectRuleContains(".yz2-az", [
            "min-width: 0;",
            "overflow: hidden;",
        ])
        expectRuleContains(".yz2-az-head", [
            "min-width: 0;",
        ])
        expectRuleContains(".yz2-az-canvas", [
            "min-width: 0;",
            "overflow-x: hidden;",
            "overflow-y: auto;",
        ])
        expectRuleContains(".yz2-az-grid", [
            "min-width: 0;",
        ])
        expectRuleContains(".yz2-az-win", [
            "min-width: 0;",
            "overflow: hidden;",
        ])
        expectRuleContains(".yz2-az-win-body", [
            "min-width: 0;",
        ])
        expectRuleContains(".yz2-az-win-body.real", [
            "min-width: 0;",
            "overflow: hidden;",
            "display: flex;",
        ])
    })
})
