/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test"

const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = []

mock.module("@tauri-apps/api/core", () => ({
    invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args })
        return { ok: true, message: "連線成功", elapsed_ms: 1, server_version: "SQLite 3" }
    },
}))

const { testDatabaseConnection } = await import("./database-api")

describe("database api", () => {
    beforeEach(() => {
        calls.length = 0
    })

    test("testDatabaseConnection invokes the flat Tauri command", async () => {
        const input = {
            workspace_root: "/workspace",
            name: "local",
            kind: "SQLite" as const,
            sqlite_path: "/workspace/app.db",
            read_only: true,
            production: false,
        }

        const result = await testDatabaseConnection(input)

        expect(result.ok).toBe(true)
        expect(calls).toEqual([{ command: "test_database_connection", args: { input } }])
    })
})
