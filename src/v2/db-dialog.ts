import type {
    ConnectionTestResult,
    DatabaseKind,
    DatabaseProfile,
    DatabaseProfileInput,
} from "../features/database/database-model"

export type DbDialogMode = "new" | "edit"

export type DbDialogState = {
    open: boolean
    mode: DbDialogMode
    profileId: string | null
    name: string
    kind: DatabaseKind
    sqlitePath: string
    host: string
    port: string
    database: string
    username: string
    password: string
    readOnly: boolean
    production: boolean
    testing: boolean
    saving: boolean
    error: string | null
    testResult: ConnectionTestResult | null
}

export function defaultDbDialogState(): DbDialogState {
    return {
        open: false,
        mode: "new",
        profileId: null,
        name: "",
        kind: "SQLite",
        sqlitePath: "",
        host: "localhost",
        port: "5432",
        database: "",
        username: "",
        password: "",
        readOnly: false,
        production: false,
        testing: false,
        saving: false,
        error: null,
        testResult: null,
    }
}

export function newDbDialogState(): DbDialogState {
    return {
        ...defaultDbDialogState(),
        open: true,
    }
}

export function dbProfileToDialog(profile: DatabaseProfile): DbDialogState {
    const base = {
        ...defaultDbDialogState(),
        open: true,
        mode: "edit" as const,
        profileId: profile.id,
        name: profile.name,
        kind: profile.kind,
        readOnly: profile.read_only,
        production: profile.production,
    }

    if ("SQLite" in profile.source) {
        return {
            ...base,
            sqlitePath: profile.source.SQLite.path,
        }
    }

    return {
        ...base,
        host: profile.source.Tcp.host,
        port: String(profile.source.Tcp.port),
        database: profile.source.Tcp.database,
        username: profile.source.Tcp.username ?? "",
    }
}

export function validateDbDialog(dialog: DbDialogState): string | null {
    if (!dialog.name.trim()) return "請輸入連線名稱"
    if (dialog.kind === "SQLite") {
        if (!dialog.sqlitePath.trim()) return "請選擇 SQLite 檔案"
        return null
    }

    if (!dialog.host.trim()) return "請輸入主機"
    const port = Number(dialog.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "請輸入有效 port"
    if (!dialog.database.trim()) return "請輸入資料庫名稱"
    return null
}

export function dbDialogToInput(dialog: DbDialogState, workspaceRoot: string): DatabaseProfileInput {
    const input: DatabaseProfileInput = {
        ...(dialog.mode === "edit" && dialog.profileId ? { id: dialog.profileId } : {}),
        workspace_root: workspaceRoot,
        name: dialog.name.trim(),
        kind: dialog.kind,
        read_only: dialog.readOnly,
        production: dialog.production,
    }

    if (dialog.kind === "SQLite") {
        return {
            ...input,
            sqlite_path: dialog.sqlitePath.trim(),
        }
    }

    return {
        ...input,
        host: dialog.host.trim(),
        port: Number(dialog.port),
        database: dialog.database.trim(),
        ...(dialog.username.trim() ? { username: dialog.username.trim() } : {}),
        ...(dialog.password ? { password: dialog.password } : {}),
    }
}
