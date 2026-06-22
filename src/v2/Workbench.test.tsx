/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"

type TestUpdateCheck =
    | { kind: "available"; version: string; install: () => Promise<void> }
    | { kind: "current" }
    | { kind: "error"; message: string }

let nextUpdateResult: TestUpdateCheck = { kind: "current" }
const checkForUpdateMock = mock(async () => nextUpdateResult)
const updateToastMessageMock = mock((result: TestUpdateCheck, silent: boolean) => {
    if (result.kind === "available") {
        return silent
            ? "更新 " + result.version + " 可用 — 前往 Settings › Updates 安裝"
            : "更新 " + result.version + " 可用"
    }
    if (silent) return null
    if (result.kind === "current") return "已是最新版本"
    return "檢查更新失敗：" + result.message
})

mock.module("./updater", () => ({
    checkForUpdate: checkForUpdateMock,
    updateToastMessage: updateToastMessageMock,
}))

import { defaultDbDialogState } from "./db-dialog"
import { registerRealDelegate, v2Store } from "./v2-store"
import { WorkbenchV2 } from "./Workbench"

ensureTestDom()

const initialWorkbenchState = {
    mode: v2Store.getState().mode,
    active: v2Store.getState().active,
    order: [...v2Store.getState().order],
    meta: structuredClone(v2Store.getState().meta),
    ui: structuredClone(v2Store.getState().ui),
    pal: structuredClone(v2Store.getState().pal),
    stVals: structuredClone(v2Store.getState().stVals),
    stab: structuredClone(v2Store.getState().stab),
    toast: v2Store.getState().toast,
}
const baselineMetric = {
    memoryBytes: 184 * 1024 * 1024,
    uptimeMs: 3_600_000,
    workspaceCount: 3,
    docsIndexEntries: 0,
    fileTreeEntries: 42,
    processId: 0,
}

beforeEach(() => {
    cleanup()
    nextUpdateResult = { kind: "current" }
    checkForUpdateMock.mockClear()
    updateToastMessageMock.mockClear()
    v2Store.setState({
        mode: "demo",
        active: "api",
        order: [...initialWorkbenchState.order],
        panelOpen: true,
        meta: structuredClone(initialWorkbenchState.meta),
        ui: structuredClone(initialWorkbenchState.ui),
        pal: structuredClone(initialWorkbenchState.pal),
        stVals: structuredClone(initialWorkbenchState.stVals),
        stab: { ...structuredClone(initialWorkbenchState.stab), metric: { ...baselineMetric } },
        toast: null,
    })
})

afterEach(() => {
    cleanup()
    v2Store.setState({
        mode: initialWorkbenchState.mode,
        active: initialWorkbenchState.active,
        order: [...initialWorkbenchState.order],
        panelOpen: true,
        meta: structuredClone(initialWorkbenchState.meta),
        ui: structuredClone(initialWorkbenchState.ui),
        pal: structuredClone(initialWorkbenchState.pal),
        stVals: structuredClone(initialWorkbenchState.stVals),
        stab: structuredClone(initialWorkbenchState.stab),
        toast: initialWorkbenchState.toast,
    })
    registerRealDelegate(null)
})

describe("WorkbenchV2", () => {
    test("renders side panel toggle before the brand and keeps toggling the panel", () => {
        const view = render(<WorkbenchV2 />)

        const titlebar = view.container.querySelector(".yz2-titlebar")
        const toggle = view.getByRole("button", { name: "Toggle side panel" })
        const brand = view.container.querySelector(".yz2-brand")

        expect(titlebar).toBeTruthy()
        expect(brand).toBeTruthy()
        expect(Array.from(titlebar!.children).indexOf(toggle)).toBeLessThan(
            Array.from(titlebar!.children).indexOf(brand!),
        )
        expect(toggle.getAttribute("aria-expanded")).toBe("true")
        expect(view.getByText("EXPLORER")).toBeTruthy()

        fireEvent.click(toggle)
        expect(v2Store.getState().panelOpen).toBe(false)
        expect(toggle.getAttribute("aria-expanded")).toBe("false")
        expect(view.queryByText("EXPLORER")).toBeNull()

        fireEvent.click(toggle)
        expect(v2Store.getState().panelOpen).toBe(true)
        expect(toggle.getAttribute("aria-expanded")).toBe("true")
        expect(view.getByText("EXPLORER")).toBeTruthy()
    })

    test("mounts the database connection dialog overlay", () => {
        v2Store.setState((s) => ({
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    dbDialog: {
                        ...defaultDbDialogState(),
                        open: true,
                    },
                },
            },
        }))

        const view = render(<WorkbenchV2 />)

        expect(view.getByRole("dialog", { name: "新增連線" })).toBeTruthy()
    })

    test("shows a silent update toast when an update is available", async () => {
        nextUpdateResult = { kind: "available", version: "0.2.0", install: async () => {} }

        render(<WorkbenchV2 />)

        await waitFor(() => expect(v2Store.getState().toast).toBe("更新 0.2.0 可用 — 前往 Settings › Updates 安裝"))
        expect(checkForUpdateMock).toHaveBeenCalledTimes(1)
        expect(updateToastMessageMock).toHaveBeenCalledWith(nextUpdateResult, true)
    })

    test("does not show a silent update toast for current or failed checks", async () => {
        nextUpdateResult = { kind: "current" }
        render(<WorkbenchV2 />)

        await waitFor(() => expect(checkForUpdateMock).toHaveBeenCalledTimes(1))
        expect(v2Store.getState().toast).toBeNull()

        cleanup()
        checkForUpdateMock.mockClear()
        updateToastMessageMock.mockClear()
        nextUpdateResult = { kind: "error", message: "offline" }
        v2Store.setState({ toast: null })

        render(<WorkbenchV2 />)

        await waitFor(() => expect(checkForUpdateMock).toHaveBeenCalledTimes(1))
        expect(v2Store.getState().toast).toBeNull()
    })

    test("shows only memory from performance metrics in the left status bar", () => {
        v2Store.setState((s) => ({
            stab: {
                ...s.stab,
                metric: {
                    memoryBytes: 128 * 1024 * 1024,
                    uptimeMs: 120_000,
                    workspaceCount: 3,
                    docsIndexEntries: 42,
                    fileTreeEntries: 99,
                    processId: 1234,
                },
            },
        }))

        const view = render(<WorkbenchV2 />)

        const status = view.container.querySelector(".yz2-status")
        expect(status?.textContent).toContain("Memory 128.0 MB")
        expect(status?.textContent).not.toContain("Uptime")
        expect(status?.textContent).not.toContain("Files")
        expect(status?.textContent).not.toContain("PID")
    })

    test("renders the real bootstrap empty workspace state", () => {
        v2Store.setState({
            mode: "real",
            active: "",
            order: [],
            meta: {},
            ui: {},
            pal: { open: true, q: "" },
        })

        const view = render(<WorkbenchV2 />)

        expect(view.getByText("No project folders yet.")).toBeTruthy()
        expect(view.getByText("Search or run a command")).toBeTruthy()
        expect(view.getByText("COMMANDS")).toBeTruthy()
    })

    test("starts background metric refresh from the configured performance interval", () => {
        let calls = 0
        const captured: { delay: number; callback?: () => void } = { delay: 0 }
        const originalSetInterval = globalThis.setInterval
        const originalClearInterval = globalThis.clearInterval
        globalThis.setInterval = ((callback: TimerHandler, delay?: number) => {
            captured.callback = callback as () => void
            captured.delay = Number(delay)
            return 42 as unknown as ReturnType<typeof setInterval>
        }) as unknown as typeof setInterval
        globalThis.clearInterval = (() => undefined) as unknown as typeof clearInterval
        registerRealDelegate({ refreshMetric: () => { calls += 1 } } as any)
        v2Store.setState((s) => ({
            mode: "real",
            stVals: { ...s.stVals, metricRefreshInterval: "5s" },
        }))

        try {
            render(<WorkbenchV2 />)
            expect(captured.delay).toBe(5_000)
            expect(calls).toBe(0)
            const tick = captured.callback
            if (!tick) throw new Error("expected metric refresh interval callback")
            tick()
            expect(calls).toBe(1)
        } finally {
            globalThis.setInterval = originalSetInterval
            globalThis.clearInterval = originalClearInterval
        }
    })

    test("does not start background metric refresh when the performance interval is off", () => {
        let intervalStarted = false
        const originalSetInterval = globalThis.setInterval
        globalThis.setInterval = (() => {
            intervalStarted = true
            return 42 as unknown as ReturnType<typeof setInterval>
        }) as unknown as typeof setInterval
        v2Store.setState((s) => ({
            mode: "real",
            stVals: { ...s.stVals, metricRefreshInterval: "off" },
        }))

        try {
            render(<WorkbenchV2 />)
            expect(intervalStarted).toBe(false)
        } finally {
            globalThis.setInterval = originalSetInterval
        }
    })
})
