/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test"

const relaunchMock = mock(async () => {})

import { resolveUpdateCheck, updateToastMessage } from "./updater-core"

beforeEach(() => {
    relaunchMock.mockClear()
})

describe("checkForUpdate", () => {
    test("returns an install callback for available updates", async () => {
        const downloadAndInstall = mock(async () => {})
        const result = await resolveUpdateCheck(async () => ({
            available: true,
            version: "0.2.0",
            date: "2026-06-22T03:17:20Z",
            body: "### Changes\n- Added Windows portable zip",
            downloadAndInstall,
        }), relaunchMock)

        expect(result.kind).toBe("available")
        if (result.kind !== "available") {
            throw new Error("expected an available update")
        }
        expect(result.version).toBe("0.2.0")
        expect(result.date).toBe("2026-06-22T03:17:20Z")
        expect(result.notes).toBe("### Changes\n- Added Windows portable zip")

        await result.install()

        expect(downloadAndInstall).toHaveBeenCalledTimes(1)
        expect(relaunchMock).toHaveBeenCalledTimes(1)
    })

    test("returns current when no update is available", async () => {
        await expect(resolveUpdateCheck(async () => null, relaunchMock)).resolves.toEqual({ kind: "current" })
        await expect(resolveUpdateCheck(async () => ({ available: false, version: "0.1.0" }), relaunchMock)).resolves.toEqual({
            kind: "current",
        })
    })

    test("returns a readable error message when update checking fails", async () => {
        await expect(resolveUpdateCheck(async () => {
            throw new Error("offline")
        }, relaunchMock)).resolves.toEqual({ kind: "error", message: "offline" })
    })
})

describe("updateToastMessage", () => {
    test("formats available update messages for silent and interactive checks", () => {
        const result = { kind: "available", version: "0.2.0", install: async () => {} } as const

        expect(updateToastMessage(result, true)).toBe("更新 0.2.0 可用 — 前往 Settings › Updates 安裝")
        expect(updateToastMessage(result, false)).toBe("更新 0.2.0 可用")
    })

    test("suppresses silent current and error messages", () => {
        expect(updateToastMessage({ kind: "current" }, true)).toBeNull()
        expect(updateToastMessage({ kind: "error", message: "offline" }, true)).toBeNull()
    })

    test("formats interactive current and error messages", () => {
        expect(updateToastMessage({ kind: "current" }, false)).toBe("已是最新版本")
        expect(updateToastMessage({ kind: "error", message: "offline" }, false)).toBe("檢查更新失敗：offline")
    })
})
