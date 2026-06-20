import type { ChangeEvent, FormEvent } from "react"

import type { DatabaseKind } from "../features/database/database-model"
import { dbDialogToInput, validateDbDialog, type DbDialogState } from "./db-dialog"
import { useV2Store } from "./v2-store"

function kindPort(kind: DatabaseKind): string {
    if (kind === "MsSql") return "1433"
    if (kind === "PostgreSQL") return "5432"
    return ""
}

export function DbConnDialog() {
    const active = useV2Store((s) => s.active)
    const mode = useV2Store((s) => s.mode)
    const root = useV2Store((s) => s.meta[s.active]?.root ?? "")
    const dialog = useV2Store((s) => s.ui[s.active]?.dbDialog)
    const patchDbDialog = useV2Store((s) => s.patchDbDialog)
    const closeDbConnDialog = useV2Store((s) => s.closeDbConnDialog)
    const testDbConn = useV2Store((s) => s.testDbConn)
    const saveDbConn = useV2Store((s) => s.saveDbConn)

    if (!dialog?.open) return null

    const patch = (partial: Partial<DbDialogState>) => {
        patchDbDialog({ ...partial, error: null, testResult: null })
    }
    const textPatch = (key: keyof Pick<DbDialogState, "name" | "sqlitePath" | "host" | "port" | "database" | "username" | "password">) =>
        (event: ChangeEvent<HTMLInputElement>) => patch({ [key]: event.target.value } as Partial<DbDialogState>)
    const checkboxPatch = (key: keyof Pick<DbDialogState, "readOnly" | "production">) =>
        (event: ChangeEvent<HTMLInputElement>) => patch({ [key]: event.target.checked } as Partial<DbDialogState>)
    const setKind = (event: ChangeEvent<HTMLSelectElement>) => {
        const kind = event.target.value as DatabaseKind
        patch({
            kind,
            port: kindPort(kind) || dialog.port,
        })
    }
    const buildInput = () => {
        const workspaceRoot = root || (mode === "demo" ? "/demo/" + active : "")
        const error = !workspaceRoot ? "Workspace root unavailable" : validateDbDialog(dialog)
        if (error) {
            patchDbDialog({ error, testResult: null })
            return null
        }
        return dbDialogToInput(dialog, workspaceRoot)
    }
    const testConnection = () => {
        const input = buildInput()
        if (input) void testDbConn(input)
    }
    const saveConnection = (event: FormEvent) => {
        event.preventDefault()
        const input = buildInput()
        if (input) void saveDbConn(input)
    }
    const title = dialog.mode === "edit" ? "編輯連線" : "新增連線"

    return (
        <>
            <div className="yz2-modal-backdrop" onClick={closeDbConnDialog} />
            <form className="yz2-dbdlg" role="dialog" aria-label={title} onSubmit={saveConnection}>
                <div className="yz2-dbdlg-head">
                    <span>{title}</span>
                    <span className="yz2-spacer" />
                    <button type="button" className="yz2-modal-close" onClick={closeDbConnDialog}>×</button>
                </div>
                <div className="yz2-dbdlg-body">
                    <label className="yz2-dbdlg-field">
                        <span>連線名稱</span>
                        <input aria-label="連線名稱" value={dialog.name} onChange={textPatch("name")} autoFocus />
                    </label>
                    <label className="yz2-dbdlg-field">
                        <span>資料庫類型</span>
                        <select aria-label="資料庫類型" value={dialog.kind} onChange={setKind}>
                            <option value="SQLite">SQLite</option>
                            <option value="PostgreSQL">PostgreSQL</option>
                            <option value="MsSql">MSSQL</option>
                        </select>
                    </label>
                    {dialog.kind === "SQLite" ? (
                        <label className="yz2-dbdlg-field">
                            <span>SQLite 檔案</span>
                            <input aria-label="SQLite 檔案" value={dialog.sqlitePath} onChange={textPatch("sqlitePath")} />
                        </label>
                    ) : (
                        <div className="yz2-dbdlg-grid">
                            <label className="yz2-dbdlg-field">
                                <span>主機</span>
                                <input aria-label="主機" value={dialog.host} onChange={textPatch("host")} />
                            </label>
                            <label className="yz2-dbdlg-field">
                                <span>Port</span>
                                <input aria-label="Port" value={dialog.port} onChange={textPatch("port")} inputMode="numeric" />
                            </label>
                            <label className="yz2-dbdlg-field">
                                <span>資料庫名稱</span>
                                <input aria-label="資料庫名稱" value={dialog.database} onChange={textPatch("database")} />
                            </label>
                            <label className="yz2-dbdlg-field">
                                <span>使用者</span>
                                <input aria-label="使用者" value={dialog.username} onChange={textPatch("username")} />
                            </label>
                            <label className="yz2-dbdlg-field yz2-dbdlg-wide">
                                <span>密碼</span>
                                <input
                                    aria-label="密碼"
                                    type="password"
                                    value={dialog.password}
                                    placeholder={dialog.mode === "edit" ? "留空 = 不變更" : ""}
                                    autoComplete={dialog.mode === "edit" ? "new-password" : "current-password"}
                                    onChange={textPatch("password")}
                                />
                            </label>
                        </div>
                    )}
                    <div className="yz2-dbdlg-checks">
                        <label>
                            <input type="checkbox" checked={dialog.readOnly} onChange={checkboxPatch("readOnly")} />
                            <span>唯讀連線</span>
                        </label>
                        <label>
                            <input type="checkbox" checked={dialog.production} onChange={checkboxPatch("production")} />
                            <span>Production</span>
                        </label>
                    </div>
                    {dialog.error ? <div className="yz2-dbdlg-msg is-error">{dialog.error}</div> : null}
                    {dialog.testResult ? (
                        <div className={"yz2-dbdlg-msg" + (dialog.testResult.ok ? " is-ok" : " is-error")}>
                            <span>{dialog.testResult.message}</span>
                            {dialog.testResult.server_version ? <span>{dialog.testResult.server_version}</span> : null}
                            <span>{dialog.testResult.elapsed_ms} ms</span>
                        </div>
                    ) : null}
                </div>
                <div className="yz2-dbdlg-actions">
                    <span className="yz2-dbdlg-root">{active}</span>
                    <span className="yz2-spacer" />
                    <button type="button" className="yz2-btn-ghost" onClick={testConnection} disabled={dialog.testing || dialog.saving}>
                        {dialog.testing ? "測試中..." : "測試連線"}
                    </button>
                    <button type="button" className="yz2-btn-ghost" onClick={closeDbConnDialog} disabled={dialog.saving}>取消</button>
                    <button type="submit" className="yz2-btn-accent" disabled={dialog.testing || dialog.saving}>
                        {dialog.saving ? "儲存中..." : "儲存"}
                    </button>
                </div>
            </form>
        </>
    )
}
