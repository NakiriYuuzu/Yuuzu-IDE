// v2 ⇄ real backend bridge: Tauri detection plus pure mapping helpers that
// translate the existing feature-api payloads into the v2 domain model.
// Async orchestration lives in controller.ts; everything here is testable.

import type { Workspace } from "../features/workspace/workspace-api"
import type { FileTreeEntry } from "../features/workspace/workspace-api"
import type { GitRepositoryStatus } from "../features/git/git-model"
import { decorationMapFromStatus, groupGitChanges } from "../features/git/git-model"
import type { GitLogRow } from "../features/git/git-log-model"
import type { GitDiffHunks, GitHunkLine } from "../features/git/git-diff-model"
import { formatWhen } from "../features/git/git-log-model"
import type { DatabaseProfile, DatabaseQueryHistoryEntry, DatabaseQueryResult, DatabaseTable } from "../features/database/database-model"
import type { BrowserPreviewBounds } from "../features/browser/browser-model"
import type { DiagnosticEvent } from "../features/diagnostics/diagnostics-model"
import type { LspDiagnostic } from "../features/language/language-model"
import type { RemoteFileEntry, RemoteHostProfile } from "../features/remote/remote-model"

import { emptyGitData, sizeLabel } from "./v2-model"
import type { BackupSummary, DbConn, DbGrid, DbHistoryRow, DiffRow, DiagEvent, GitData, GitFile, MetricSnapshot, ProjectMeta, SftpFile, SshHost, TreeNode } from "./v2-model"

export function isTauri(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

// ---------------------------------------------------------------- projects

const COLOR_CYCLE: Pick<ProjectMeta, "bg" | "fg" | "bd">[] = [
    { bg: "var(--yz-1b2410)", fg: "var(--yz-a8e23f)", bd: "var(--yz-45611a)" },
    { bg: "var(--yz-10202e)", fg: "var(--yz-82aaff)", bd: "var(--yz-274968)" },
    { bg: "var(--yz-241327)", fg: "var(--yz-ce93d8)", bd: "var(--yz-5b2f63)" },
    { bg: "var(--yz-2a1d10)", fg: "var(--yz-f6a960)", bd: "var(--yz-6b4a22)" },
    { bg: "var(--yz-102024)", fg: "var(--yz-6fd6c3)", bd: "var(--yz-23545c)" },
]

export function glyphForName(name: string): string {
    const clean = name.replace(/[^A-Za-z0-9一-鿿]/g, "")
    if (!clean) return "??"
    // yuuzu-api → YA (first letters of segments) when hyphenated, else first two chars
    const segs = name.split(/[-_ ]+/).filter(Boolean)
    if (segs.length >= 2) {
        return (segs[0][0] + segs[1][0]).toUpperCase()
    }
    return clean.slice(0, 2).toUpperCase()
}

export function mapWorkspaceToMeta(ws: Workspace, index: number): ProjectMeta {
    const colors = COLOR_CYCLE[index % COLOR_CYCLE.length]
    return {
        id: ws.id,
        name: ws.name,
        glyph: glyphForName(ws.name),
        branch: "",
        root: ws.path,
        ...colors,
    }
}

// ---------------------------------------------------------------- file tree

export function mapEntriesToNodes(entries: FileTreeEntry[]): TreeNode[] {
    const dirs = entries.filter((e) => e.is_dir)
    const files = entries.filter((e) => !e.is_dir)
    const toNode = (e: FileTreeEntry): TreeNode =>
        e.is_dir ? { n: e.name, p: e.path, d: [], loaded: false } : { n: e.name, p: e.path }
    return [...dirs.map(toNode), ...files.map(toNode)]
}

export function setNodeChildren(tree: TreeNode[], displayPath: string, children: TreeNode[]): TreeNode[] {
    const segs = displayPath.split("/")
    const walk = (nodes: TreeNode[], depth: number): TreeNode[] =>
        nodes.map((node) => {
            if (node.n !== segs[depth]) return node
            if (depth === segs.length - 1) {
                return node.d ? { ...node, d: children, loaded: true } : node
            }
            return node.d ? { ...node, d: walk(node.d, depth + 1) } : node
        })
    return walk(tree, 0)
}

export function findNode(tree: TreeNode[], displayPath: string): TreeNode | null {
    const segs = displayPath.split("/")
    let nodes = tree
    let node: TreeNode | null = null
    for (const seg of segs) {
        node = nodes.find((n) => n.n === seg) ?? null
        if (!node) return null
        nodes = node.d ?? []
    }
    return node
}

export function langForPath(path: string): string {
    const ext = path.includes(".") ? path.split(".").pop()?.toLowerCase() ?? "" : ""
    if (ext === "rs") return "rust"
    if (ext === "ts" || ext === "tsx" || ext === "mts" || ext === "cts") return "ts"
    if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return "js"
    if (ext === "json") return "json"
    if (ext === "py" || ext === "pyw" || ext === "pyi") return "py"
    if (ext === "html" || ext === "htm") return "html"
    if (ext === "sql") return "sql"
    if (ext === "css" || ext === "scss") return "css"
    if (ext === "sh" || ext === "bash" || ext === "zsh") return "sh"
    return "md"
}

// ---------------------------------------------------------------- language

type LspRangeLike = {
    start_line: number
    start_character: number
    end_line: number
    end_character: number
}

type LspTextEdit = { range: LspRangeLike; newText: string }

export function cursorToLsp(cur: { ln: number; col: number }): { line: number; character: number } {
    return {
        line: Math.max(0, cur.ln - 1),
        character: Math.max(0, cur.col - 1),
    }
}

export function lspRangeToCursor(range: LspRangeLike): { ln: number; col: number } {
    return {
        ln: range.start_line + 1,
        col: range.start_character + 1,
    }
}

function normalizePosixPath(path: string): string {
    const unix = path.replace(/\\/g, "/")
    const absolute = unix.startsWith("/")
    const parts: string[] = []
    for (const part of unix.split("/")) {
        if (!part || part === ".") continue
        if (part === "..") {
            if (parts.length) parts.pop()
            continue
        }
        parts.push(part)
    }
    return (absolute ? "/" : "") + parts.join("/")
}

function isWindowsDrivePath(path: string): boolean {
    return /^[a-zA-Z]:($|\/)/.test(path)
}

function normalizeFileUriPathForRoot(root: string, path: string): { root: string; path: string; caseInsensitive: boolean } {
    const cleanRoot = normalizePosixPath(root).replace(/\/+$/, "")
    let cleanPath = normalizePosixPath(path)
    const caseInsensitive = isWindowsDrivePath(cleanRoot)
    if (caseInsensitive && /^\/[a-zA-Z]:($|\/)/.test(cleanPath)) {
        cleanPath = cleanPath.slice(1)
    }
    return { root: cleanRoot, path: cleanPath, caseInsensitive }
}

export function relativePathFromUri(root: string, uri: string): string | null {
    if (!uri.startsWith("file://")) return null
    const raw = uri.slice("file://".length)
    let path = raw
    try {
        path = decodeURIComponent(raw)
    } catch {
        return null
    }
    const normalized = normalizeFileUriPathForRoot(root, path)
    const cleanRoot = normalized.root
    const cleanPath = normalized.path
    const compareRoot = normalized.caseInsensitive ? cleanRoot.toLowerCase() : cleanRoot
    const comparePath = normalized.caseInsensitive ? cleanPath.toLowerCase() : cleanPath
    if (!comparePath.startsWith(compareRoot + "/")) return null
    const rel = cleanPath.slice(cleanRoot.length + 1)
    return rel ? rel : null
}

type LspPositionWire = { line: number; character: number }
type LspRangeWire = { start: LspPositionWire; end: LspPositionWire }

function wireRangeToCursor(range: LspRangeWire): { line: number; col: number } {
    return {
        line: range.start.line + 1,
        col: range.start.character + 1,
    }
}

export function mapLspLocations(value: unknown, root: string): { path: string; line: number; col: number }[] {
    const rows = Array.isArray(value) ? value : value ? [value] : []
    return rows.flatMap((row) => {
        if (!row || typeof row !== "object") return []
        const item = row as Record<string, unknown>
        const uri = typeof item.uri === "string"
            ? item.uri
            : typeof item.targetUri === "string"
                ? item.targetUri
                : ""
        const range = isWireRange(item.range)
            ? item.range
            : isWireRange(item.targetSelectionRange)
                ? item.targetSelectionRange
                : isWireRange(item.targetRange)
                    ? item.targetRange
                    : null
        const path = uri ? relativePathFromUri(root, uri) : null
        if (!path || !range) return []
        return [{ path, ...wireRangeToCursor(range) }]
    })
}

function isWireRange(value: unknown): value is LspRangeWire {
    if (!value || typeof value !== "object") return false
    const range = value as Record<string, unknown>
    return isWirePosition(range.start) && isWirePosition(range.end)
}

function isWirePosition(value: unknown): value is LspPositionWire {
    if (!value || typeof value !== "object") return false
    const pos = value as Record<string, unknown>
    const line = pos.line
    const character = pos.character
    return (
        typeof line === "number" &&
        typeof character === "number" &&
        Number.isInteger(line) &&
        Number.isInteger(character) &&
        line >= 0 &&
        character >= 0
    )
}

export function mapLspDiagnostics(diags: LspDiagnostic[]): Record<string, LspDiagnostic[]> {
    const byPath: Record<string, LspDiagnostic[]> = {}
    for (const diagnostic of diags) {
        byPath[diagnostic.path] = [...(byPath[diagnostic.path] ?? []), diagnostic]
    }
    return byPath
}

function isLspRangeLike(value: unknown): value is LspRangeLike {
    if (!value || typeof value !== "object") return false
    const range = value as Record<string, unknown>
    return (
        Number.isInteger(range.start_line) &&
        Number.isInteger(range.start_character) &&
        Number.isInteger(range.end_line) &&
        Number.isInteger(range.end_character) &&
        (range.start_line as number) >= 0 &&
        (range.start_character as number) >= 0 &&
        (range.end_line as number) >= 0 &&
        (range.end_character as number) >= 0
    )
}

function textEditsForUri(root: string, uri: unknown, edits: unknown): { path: string; edits: LspTextEdit[] } | null {
    if (typeof uri !== "string" || !Array.isArray(edits)) return null
    const path = relativePathFromUri(root, uri)
    if (!path) return null
    const mapped = edits.flatMap((edit) => {
        if (!edit || typeof edit !== "object") return []
        const row = edit as Record<string, unknown>
        if (!isLspRangeLike(row.range) || typeof row.newText !== "string") return []
        return [{ range: row.range, newText: row.newText }]
    })
    return mapped.length ? { path, edits: mapped } : null
}

export function flattenWorkspaceEdit(value: unknown, root: string): { path: string; edits: LspTextEdit[] }[] {
    if (!value || typeof value !== "object") return []
    const workspaceEdit = value as Record<string, unknown>
    const grouped = new Map<string, LspTextEdit[]>()
    const push = (group: { path: string; edits: LspTextEdit[] } | null) => {
        if (!group) return
        grouped.set(group.path, [...(grouped.get(group.path) ?? []), ...group.edits])
    }

    if (workspaceEdit.changes && typeof workspaceEdit.changes === "object") {
        for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
            push(textEditsForUri(root, uri, edits))
        }
    }

    if (Array.isArray(workspaceEdit.documentChanges)) {
        for (const change of workspaceEdit.documentChanges) {
            if (!change || typeof change !== "object") continue
            const textDocumentEdit = change as Record<string, unknown>
            const textDocument = textDocumentEdit.textDocument && typeof textDocumentEdit.textDocument === "object"
                ? textDocumentEdit.textDocument as Record<string, unknown>
                : null
            push(textEditsForUri(root, textDocument?.uri, textDocumentEdit.edits))
        }
    }

    return Array.from(grouped, ([path, edits]) => ({ path, edits }))
}

function offsetForLspPosition(content: string, line: number, character: number): number | null {
    let offset = 0
    for (let currentLine = 0; currentLine < line; currentLine += 1) {
        const nextBreak = content.indexOf("\n", offset)
        if (nextBreak < 0) return null
        offset = nextBreak + 1
    }
    const lineEnd = content.indexOf("\n", offset)
    const max = lineEnd < 0 ? content.length : lineEnd
    const target = offset + character
    return target <= max ? target : null
}

export function applyTextEdits(content: string, edits: LspTextEdit[]): string {
    return edits
        .flatMap((edit) => {
            const start = offsetForLspPosition(content, edit.range.start_line, edit.range.start_character)
            const end = offsetForLspPosition(content, edit.range.end_line, edit.range.end_character)
            if (start == null || end == null || end < start) return []
            return [{ start, end, text: edit.newText }]
        })
        .sort((left, right) => right.start - left.start)
        .reduce((next, edit) => next.slice(0, edit.start) + edit.text + next.slice(edit.end), content)
}

// ---------------------------------------------------------------- git

export function mapGitLog(rows: GitLogRow[], status: GitRepositoryStatus | null, nowUnix: number): GitData {
    const indexByHash = new Map<string, number>()
    rows.forEach((r, i) => indexByHash.set(r.hash, i))
    return {
        ...emptyGitData(status?.branch ?? ""),
        ahead: status?.ahead ?? 0,
        behind: status?.behind ?? 0,
        commits: rows.map((r) => ({
            lane: Math.min(r.lane, 2),
            m: r.subject,
            a: r.author,
            h: r.short_hash,
            fullHash: r.hash,
            t: formatWhen(r.when_unix, nowUnix).replace(" ago", ""),
            refs: r.refs.map((ref) => ref.name).filter((n) => n !== "HEAD"),
            par: r.parents
                .map((h) => indexByHash.get(h))
                .filter((i): i is number => typeof i === "number"),
        })),
    }
}

export function mapGitStatusGroups(status: GitRepositoryStatus | null): Pick<GitData, "staged" | "unstaged" | "conflicts" | "hasConflicts" | "branch" | "upstream"> {
    if (!status) {
        return {
            staged: [],
            unstaged: [],
            conflicts: [],
            hasConflicts: false,
            branch: "",
            upstream: null,
        }
    }
    const grouped = groupGitChanges(status.changes)
    const decorations = decorationMapFromStatus(status)
    const mapFile = (staged: boolean) => (change: GitRepositoryStatus["changes"][number]): GitFile => ({
        path: change.path,
        kind: change.kind,
        st: decorations[change.path] ?? "M",
        staged,
    })
    return {
        staged: grouped.staged.map(mapFile(true)),
        unstaged: grouped.unstaged.filter((change) => change.kind !== "conflict").map(mapFile(false)),
        conflicts: grouped.conflicts.map(mapFile(false)),
        hasConflicts: status.has_conflicts,
        branch: status.branch ?? "",
        upstream: status.upstream,
    }
}

function diffKind(line: GitHunkLine): DiffRow["t"] {
    if (line.kind === "add") return "a"
    if (line.kind === "del") return "d"
    return "x"
}

export function mapDiffHunks(diff: GitDiffHunks): DiffRow[] {
    const rows: DiffRow[] = []
    diff.hunks.forEach((hunk, hunkIndex) => {
        rows.push({
            t: "h",
            s: hunk.header,
            oldNo: null,
            newNo: null,
            hunkIndex,
            lineIndex: null,
        })
        hunk.lines.forEach((line, lineIndex) => {
            rows.push({
                t: diffKind(line),
                s: line.text,
                oldNo: line.old_no,
                newNo: line.new_no,
                hunkIndex,
                lineIndex,
            })
        })
    })
    return rows
}

// ---------------------------------------------------------------- database / ssh

export function engineLabel(kind: string): string {
    const k = kind.toLowerCase()
    if (k.includes("sqlite")) return "SQLite"
    if (k.includes("postgres")) return "PostgreSQL"
    if (k.includes("mysql")) return "MySQL"
    if (k.includes("mssql") || k.includes("sqlserver")) return "MS SQL Server"
    return kind
}

export function mapDbProfiles(profiles: DatabaseProfile[]): DbConn[] {
    return profiles.map((p) => ({
        name: p.name,
        engine: engineLabel(String(p.kind)),
        live: false,
        profileId: p.id,
        tables: [],
    }))
}

export function mapDbProfilesPreservingState(profiles: DatabaseProfile[], existing: DbConn[]): DbConn[] {
    const byProfileId = new Map(existing.flatMap((conn) => (conn.profileId ? [[conn.profileId, conn]] : [])))
    return mapDbProfiles(profiles).map((conn) => {
        const previous = conn.profileId ? byProfileId.get(conn.profileId) : undefined
        if (!previous) return conn
        return {
            ...conn,
            live: previous.live,
            inspected: previous.inspected,
            tables: previous.tables,
        }
    })
}

export function remapDbOpenByProfileId(
    next: DbConn[],
    previous: DbConn[],
    previousOpen: Record<number, boolean>,
): Record<number, boolean> {
    const openByProfileId = new Map(
        previous.flatMap((conn, index) => (conn.profileId && previousOpen[index] ? [[conn.profileId, true]] : [])),
    )
    const nextOpen: Record<number, boolean> = {}
    next.forEach((conn, index) => {
        if (conn.profileId && openByProfileId.get(conn.profileId)) nextOpen[index] = true
    })
    return nextOpen
}

export function mapDbTables(tables: DatabaseTable[]): DbConn["tables"] {
    return tables.map((t) => ({
        n: t.schema ? `${t.schema}.${t.name}` : t.name,
        c: t.row_count == null ? "—" : t.row_count.toLocaleString("en-US"),
        cols: t.columns.map((c) => ({
            name: c.name,
            type: c.data_type,
            nullable: c.nullable,
            pk: c.primary_key,
        })),
    }))
}

export function mapQueryResult(result: DatabaseQueryResult): DbGrid {
    return {
        cols: result.columns,
        rows: result.rows.map((r) => r.cells.map((c) => (c.kind === "Null" ? "NULL" : c.display))),
        ms: result.executed_ms,
        truncated: result.truncated,
        affected: result.affected_rows,
        kind: result.classification.kind,
    }
}

function historyRowCount(entry: DatabaseQueryHistoryEntry): string {
    if (entry.affected_rows != null) return entry.affected_rows + " affected"
    if (entry.row_count != null) return entry.row_count + " rows"
    return "0 rows"
}

export function mapDbHistory(entries: DatabaseQueryHistoryEntry[]): DbHistoryRow[] {
    return entries.map((entry) => ({
        sql: entry.sql,
        kind: entry.kind,
        when: new Date(entry.executed_ms).toLocaleTimeString(),
        rows: historyRowCount(entry),
    }))
}

export function screenBoundsFromRect(
    rect: { x: number; y: number; width: number; height: number },
    screenX: number,
    screenY: number,
): BrowserPreviewBounds {
    return {
        x: Math.round(rect.x + screenX),
        y: Math.round(rect.y + screenY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
    }
}

type MetricSnapshotIn = {
    memory_bytes: number | null
    uptime_ms: number
    workspace_count: number
    docs_index_entries: number
    file_tree_entries: number
    process_id: number
}

export function mapMetric(snap: MetricSnapshotIn): MetricSnapshot {
    return {
        memoryBytes: snap.memory_bytes ?? null,
        uptimeMs: snap.uptime_ms,
        workspaceCount: snap.workspace_count,
        docsIndexEntries: snap.docs_index_entries,
        fileTreeEntries: snap.file_tree_entries,
        processId: snap.process_id,
    }
}

export function mapDiagnosticEvents(rows: DiagnosticEvent[]): DiagEvent[] {
    return [...rows]
        .sort((left, right) => right.timestamp_ms - left.timestamp_ms)
        .slice(0, 50)
        .map((event) => ({
            id: event.id,
            level: event.level,
            source: event.source,
            message: event.message,
            ts: event.timestamp_ms,
        }))
}

type BackupIn = {
    id: string
    path: string
    content: string
    updated_ms: number
}

export function mapBackups(rows: BackupIn[]): BackupSummary[] {
    return [...rows]
        .sort((left, right) => right.updated_ms === left.updated_ms ? left.path.localeCompare(right.path) : right.updated_ms - left.updated_ms)
        .map((backup) => ({
            id: backup.id,
            path: backup.path,
            updatedMs: backup.updated_ms,
            contentLength: backup.content.length,
        }))
}

// The backend rejects mutating/destructive SQL until the request carries the
// exact confirmation text; its error message ends with that text.
export function confirmationFromError(message: string): string | null {
    const marker = "requires confirmation text: "
    const at = message.indexOf(marker)
    if (at < 0) return null
    const text = message.slice(at + marker.length).trim()
    return text || null
}

export function mapRemoteHosts(hosts: RemoteHostProfile[]): SshHost[] {
    return hosts.map((h) => ({
        label: `${h.username}@${h.host}`,
        sub: `${h.name} · port ${h.port}`,
        live: false,
        hostId: h.id,
        remotePath: h.default_remote_path || "/",
    }))
}

// ---------------------------------------------------------------- sftp

function chipForEntryName(name: string): string {
    return name.includes(".") ? (name.split(".").pop() ?? "·").slice(0, 3) : "·"
}

export function mapRemoteEntries(entries: RemoteFileEntry[]): SftpFile[] {
    const dirs = entries.filter((e) => e.kind === "Directory")
    const rest = entries.filter((e) => e.kind !== "Directory")
    const toFile = (e: RemoteFileEntry): SftpFile => ({
        chip: e.kind === "Directory" ? "dir" : e.kind === "Symlink" ? "ln" : chipForEntryName(e.name),
        name: e.kind === "Directory" ? e.name + "/" : e.name,
        size: e.kind === "Directory" ? "—" : sizeLabel(e.size),
        kind: e.kind === "Directory" ? "dir" : e.kind === "Symlink" ? "link" : "file",
        p: e.path,
    })
    return [...dirs.map(toFile), ...rest.map(toFile)]
}

export function mapLocalEntries(entries: FileTreeEntry[]): SftpFile[] {
    const dirs = entries.filter((e) => e.is_dir)
    const files = entries.filter((e) => !e.is_dir)
    const toFile = (e: FileTreeEntry): SftpFile => ({
        chip: e.is_dir ? "dir" : chipForEntryName(e.name),
        name: e.is_dir ? e.name + "/" : e.name,
        size: "—",
        kind: e.is_dir ? "dir" : "file",
        p: e.path,
    })
    return [...dirs.map(toFile), ...files.map(toFile)]
}

export function parentPath(path: string): string {
    const trimmed = path.replace(/\/+$/, "")
    const at = trimmed.lastIndexOf("/")
    if (at <= 0) return "/"
    return trimmed.slice(0, at)
}
