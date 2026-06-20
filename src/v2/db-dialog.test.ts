/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { DatabaseProfile } from "../features/database/database-model"
import {
    dbDialogToInput,
    dbProfileToDialog,
    defaultDbDialogState,
    validateDbDialog,
} from "./db-dialog"

const tcpProfile: DatabaseProfile = {
    id: "pg-1",
    workspace_root: "/workspace",
    name: "App Postgres",
    kind: "PostgreSQL",
    source: {
        Tcp: {
            host: "localhost",
            port: 5432,
            database: "app",
            username: "yuuzu",
            secret_id: "secret-1",
        },
    },
    read_only: false,
    production: true,
    created_ms: 1,
    updated_ms: 2,
}

describe("db dialog state", () => {
    test("prefills edit state from a saved tcp profile without exposing the password", () => {
        const dialog = dbProfileToDialog(tcpProfile)

        expect(dialog.open).toBe(true)
        expect(dialog.mode).toBe("edit")
        expect(dialog.profileId).toBe("pg-1")
        expect(dialog.name).toBe("App Postgres")
        expect(dialog.kind).toBe("PostgreSQL")
        expect(dialog.host).toBe("localhost")
        expect(dialog.port).toBe("5432")
        expect(dialog.database).toBe("app")
        expect(dialog.username).toBe("yuuzu")
        expect(dialog.password).toBe("")
        expect(dialog.production).toBe(true)
    })

    test("converts a new sqlite dialog into a backend input", () => {
        const input = dbDialogToInput({
            ...defaultDbDialogState(),
            open: true,
            name: " Local DB ",
            kind: "SQLite",
            sqlitePath: " /workspace/app.db ",
            readOnly: true,
        }, "/workspace")

        expect(input).toEqual({
            workspace_root: "/workspace",
            name: "Local DB",
            kind: "SQLite",
            sqlite_path: "/workspace/app.db",
            read_only: true,
            production: false,
        })
    })

    test("omits blank passwords when converting edit tcp dialogs", () => {
        const dialog = {
            ...dbProfileToDialog(tcpProfile),
            name: "Renamed",
            password: "",
        }

        expect(dbDialogToInput(dialog, "/workspace")).toEqual({
            id: "pg-1",
            workspace_root: "/workspace",
            name: "Renamed",
            kind: "PostgreSQL",
            host: "localhost",
            port: 5432,
            database: "app",
            username: "yuuzu",
            read_only: false,
            production: true,
        })

        expect(dbDialogToInput({ ...dialog, password: "new-secret" }, "/workspace")).toMatchObject({
            password: "new-secret",
        })
    })

    test("validates required fields for the active database kind", () => {
        expect(validateDbDialog({ ...defaultDbDialogState(), name: "" })).toBe("請輸入連線名稱")
        expect(validateDbDialog({ ...defaultDbDialogState(), name: "Local", sqlitePath: "" })).toBe("請選擇 SQLite 檔案")
        expect(validateDbDialog({
            ...defaultDbDialogState(),
            name: "PG",
            kind: "PostgreSQL",
            host: "",
            port: "5432",
            database: "app",
        })).toBe("請輸入主機")
        expect(validateDbDialog({
            ...defaultDbDialogState(),
            name: "PG",
            kind: "PostgreSQL",
            host: "localhost",
            port: "70000",
            database: "app",
        })).toBe("請輸入有效 port")
    })
})
