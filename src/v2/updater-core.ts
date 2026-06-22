export type UpdaterCheckResult = {
    available: true
    version: string
    date?: string
    body?: string
    downloadAndInstall: () => Promise<void>
} | {
    available?: false
    version: string
}

export type UpdaterCheckFn = () => Promise<UpdaterCheckResult | null>
export type UpdaterRelaunchFn = () => Promise<void>

export type UpdateCheck =
    | { kind: "available"; version: string; date?: string; notes?: string; install: () => Promise<void> }
    | { kind: "current" }
    | { kind: "error"; message: string }

export async function resolveUpdateCheck(
    checkFn: UpdaterCheckFn,
    relaunchFn: UpdaterRelaunchFn,
): Promise<UpdateCheck> {
    try {
        const update = await checkFn()
        if (!update || !update.available) {
            return { kind: "current" }
        }

        return {
            kind: "available",
            version: update.version,
            date: update.date,
            notes: update.body,
            install: async () => {
                await update.downloadAndInstall()
                await relaunchFn()
            },
        }
    } catch (error) {
        return {
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
        }
    }
}

export function updateToastMessage(result: UpdateCheck, silent: boolean): string | null {
    if (result.kind === "available") {
        return silent
            ? `更新 ${result.version} 可用 — 前往 Settings › Updates 安裝`
            : `更新 ${result.version} 可用`
    }
    if (silent) {
        return null
    }
    if (result.kind === "current") {
        return "已是最新版本"
    }
    return `檢查更新失敗：${result.message}`
}
