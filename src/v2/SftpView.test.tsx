/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render } from "@testing-library/react"

import { ensureTestDom } from "../test/test-dom"
import { SftpView } from "./SftpView"
import type { Tab } from "./v2-model"
import { registerRealDelegate, v2Store } from "./v2-store"

ensureTestDom()

const initialApiUI = structuredClone(v2Store.getState().ui.api)
const tab: Tab = { id: 9401, type: "sftp", title: "sftp" }

function resetSftp(connected: boolean, hostId: string | undefined) {
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
                sftp: {
                    host: "deploy@example.com",
                    hostId,
                    localPath: "/workspace",
                    localRel: "",
                    remotePath: "/srv/app",
                    local: [],
                    remote: [],
                    sel: null,
                    clip: null,
                    focus: "local",
                    connected,
                    loading: false,
                },
            },
        },
    }))
}

afterEach(() => {
    cleanup()
    registerRealDelegate(null)
    v2Store.setState((s) => ({
        mode: "demo",
        active: "api",
        ctx: null,
        confirm: null,
        toast: null,
        ui: {
            ...s.ui,
            api: structuredClone(initialApiUI),
        },
    }))
})

describe("SftpView", () => {
    test("disconnects when real sftp is connected", () => {
        const calls: string[] = []
        resetSftp(true, "host-1")
        registerRealDelegate({
            sftpDisconnect: () => calls.push("disconnect"),
        } as any)

        const view = render(<SftpView tab={tab} />)
        fireEvent.click(view.getByRole("button", { name: "Disconnect SFTP" }))

        expect(calls).toEqual(["disconnect"])
    })

    test("reconnects only when a real host id exists", () => {
        const calls: string[] = []
        resetSftp(false, "host-1")
        registerRealDelegate({
            sftpReconnect: () => calls.push("reconnect"),
        } as any)

        const view = render(<SftpView tab={tab} />)
        fireEvent.click(view.getByRole("button", { name: "Reconnect SFTP" }))

        expect(calls).toEqual(["reconnect"])

        cleanup()
        resetSftp(false, undefined)
        const withoutHost = render(<SftpView tab={tab} />)
        expect(withoutHost.queryByRole("button", { name: "Reconnect SFTP" })).toBeNull()
    })

    test("runs a one-off remote command from the prompt", () => {
        const calls: string[] = []
        resetSftp(true, "host-1")
        registerRealDelegate({
            sftpRunCommand: (command: string) => calls.push(command),
        } as any)

        const view = render(<SftpView tab={tab} />)
        fireEvent.click(view.getByRole("button", { name: "Open remote command prompt" }))
        fireEvent.change(view.getByLabelText("Remote command"), { target: { value: " uptime " } })
        fireEvent.click(view.getByRole("button", { name: "Run remote command" }))

        expect(calls).toEqual(["uptime"])
    })
})
