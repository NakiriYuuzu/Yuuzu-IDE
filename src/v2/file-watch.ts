import { shouldMarkExternalChange, type FileVersion } from "../features/files/file-model"
import type { Tab, TreeNode } from "./v2-model"

// Normalize a filesystem path for cross-source comparison. The watcher emits
// std::fs canonical paths (Windows verbatim "\\?\" and "\\?\UNC\" prefixes) while
// the file tree uses dunce canonical paths (no prefix). Bridge both, and only
// case-fold Windows paths (their filesystems are case-insensitive); POSIX paths
// stay case-sensitive so distinct files are not conflated.
export function normalizeFsPath(p: string): string {
    const n = p
        .replace(/\\/g, "/")
        .replace(/^\/\/\?\/unc\//i, "//")
        .replace(/^\/\/\?\//, "")
        .replace(/\/+$/, "")
    const isWindows = /^[a-zA-Z]:\//.test(n) || n.startsWith("//")
    return isWindows ? n.toLowerCase() : n
}

function fileTabDiskPath(tab: Tab): string | null {
    if (tab.type !== "file") return null
    return tab.realPath ?? tab.path ?? null
}

// Ids of open file tabs whose on-disk file matches eventPath and whose known
// version differs from the event version (i.e. genuinely changed on disk).
export function externallyChangedTabIds(
    tabs: Tab[],
    eventPath: string,
    eventVersion: FileVersion | null
): number[] {
    const target = normalizeFsPath(eventPath)
    const ids: number[] = []
    for (const t of tabs) {
        const disk = fileTabDiskPath(t)
        if (disk == null) continue
        // No known baseline version (a loading or just-opened tab): skip — the
        // pending read sets the correct version, so we cannot say it diverged.
        if (t.version == null) continue
        if (normalizeFsPath(disk) !== target) continue
        if (shouldMarkExternalChange(t.version, eventVersion)) ids.push(t.id)
    }
    return ids
}

// True when path is one of write_text_file's atomic-write temp siblings
// (.<filename>.<pid>.<counter>.tmp). The tree must ignore these to avoid flicker.
export function isTempWritePath(pathNorm: string): boolean {
    const base = pathNorm.split("/").pop() ?? ""
    return /^\..+\.\d+\.\d+\.tmp$/.test(base)
}

// Find the tree node whose real path matches `norm` (normalized), returning the
// node and its display path (names joined). Descends only into matching ancestors.
export function findByReal(tree: TreeNode[], norm: string): { node: TreeNode; displayPath: string } | null {
    const walk = (nodes: TreeNode[], prefix: string): { node: TreeNode; displayPath: string } | null => {
        for (const node of nodes) {
            if (node.p == null) continue
            const np = normalizeFsPath(node.p)
            const display = prefix ? prefix + "/" + node.n : node.n
            if (np === norm) return { node, displayPath: display }
            if (node.d && node.d.length > 0 && norm.startsWith(np + "/")) {
                const found = walk(node.d, display)
                if (found) return found
            }
        }
        return null
    }
    return walk(tree, "")
}

// The display dir to re-scan for a watcher event, or null when no structural
// refresh is needed. rootNorm/eventPathNorm must already be normalizeFsPath'd.
export function treeRefreshTarget(
    tree: TreeNode[],
    rootNorm: string,
    eventPathNorm: string,
    eventExists: boolean
): string | null {
    if (isTempWritePath(eventPathNorm)) return null
    const self = findByReal(tree, eventPathNorm)
    if (eventExists && self) return null // modify: no structural change
    const at = eventPathNorm.lastIndexOf("/")
    const parentNorm = at <= 0 ? "" : eventPathNorm.slice(0, at)
    if (parentNorm === rootNorm || parentNorm === "") return ""
    const parent = findByReal(tree, parentNorm)
    if (parent && parent.node.d && parent.node.loaded) return parent.displayPath
    return null
}

// Merge freshly-scanned children into existing ones, preserving the loaded
// subtree (.d/.loaded) of directories that still exist (matched by name).
export function mergeTreeChildren(oldChildren: TreeNode[], freshNodes: TreeNode[]): TreeNode[] {
    const byName = new Map(oldChildren.map((n) => [n.n, n]))
    return freshNodes.map((fresh) => {
        const prev = byName.get(fresh.n)
        if (prev && prev.d && fresh.d) return { ...fresh, d: prev.d, loaded: prev.loaded }
        return fresh
    })
}
