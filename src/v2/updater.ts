import { relaunch } from "@tauri-apps/plugin-process"
import { check } from "@tauri-apps/plugin-updater"

import { resolveUpdateCheck, updateToastMessage, type UpdateCheck, type UpdaterCheckFn } from "./updater-core"

export async function checkForUpdate(checkFn: UpdaterCheckFn = check): Promise<UpdateCheck> {
    return resolveUpdateCheck(checkFn, relaunch)
}

export { updateToastMessage }
export type { UpdateCheck }
