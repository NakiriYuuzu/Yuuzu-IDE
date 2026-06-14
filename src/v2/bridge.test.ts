/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import {
    confirmationFromError,
    cursorToLsp,
    engineLabel,
    applyTextEdits,
    findNode,
    flattenWorkspaceEdit,
    glyphForName,
    langForPath,
    lspRangeToCursor,
    mapLspDiagnostics,
    mapLspLocations,
    mapDbProfiles,
    mapDbHistory,
    mapDbTables,
    mapBackups,
    mapDiagnosticEvents,
    mapDiffHunks,
    mapEntriesToNodes,
    mapGitLog,
    mapGitStatusGroups,
    mapLocalEntries,
    mapMetric,
    mapQueryResult,
    mapRemoteEntries,
    mapRemoteHosts,
    screenBoundsFromRect,
    mapWorkspaceToMeta,
    parentPath,
    relativePathFromUri,
    setNodeChildren,
} from "./bridge"
import type { GitLogRow } from "../features/git/git-log-model"
import type { GitRepositoryStatus } from "../features/git/git-model"
import type { RemoteFileEntry } from "../features/remote/remote-model"

describe("glyphForName", () => {
    test("uses segment initials for hyphenated names", () => {
        expect(glyphForName("yuuzu-api")).toBe("YA")
        expect(glyphForName("infra_edge")).toBe("IE")
    })

    test("falls back to the first two characters", () => {
        expect(glyphForName("workbench")).toBe("WO")
    })
})

describe("mapWorkspaceToMeta", () => {
    test("cycles colors and keeps the workspace root", () => {
        const a = mapWorkspaceToMeta({ id: "1", name: "alpha", path: "/a", pinned: false }, 0)
        const b = mapWorkspaceToMeta({ id: "2", name: "beta", path: "/b", pinned: false }, 5)
        expect(a.root).toBe("/a")
        expect(a.bg).toBe(b.bg)
        expect(mapWorkspaceToMeta({ id: "3", name: "c", path: "/c", pinned: false }, 1).fg).not.toBe(a.fg)
    })
})

describe("file tree mapping", () => {
    const entries = [
        { name: "readme.md", path: "/w/readme.md", is_dir: false },
        { name: "src", path: "/w/src", is_dir: true },
    ]

    test("maps entries dirs-first with lazy children", () => {
        const nodes = mapEntriesToNodes(entries)
        expect(nodes[0]).toEqual({ n: "src", p: "/w/src", d: [], loaded: false })
        expect(nodes[1]).toEqual({ n: "readme.md", p: "/w/readme.md" })
    })

    test("setNodeChildren fills the addressed directory only", () => {
        const tree = mapEntriesToNodes(entries)
        const filled = setNodeChildren(tree, "src", [{ n: "main.ts", p: "/w/src/main.ts" }])
        expect(filled[0].loaded).toBe(true)
        expect(filled[0].d?.[0].n).toBe("main.ts")
        expect(filled[1]).toEqual(tree[1])
    })

    test("findNode resolves nested display paths", () => {
        let tree = mapEntriesToNodes(entries)
        tree = setNodeChildren(tree, "src", [{ n: "deep", p: "/w/src/deep", d: [], loaded: false }])
        expect(findNode(tree, "src/deep")?.p).toBe("/w/src/deep")
        expect(findNode(tree, "missing")).toBeNull()
    })
})

describe("langForPath", () => {
    test("maps extensions onto highlighter languages", () => {
        expect(langForPath("src/main.rs")).toBe("rust")
        expect(langForPath("a/b.tsx")).toBe("ts")
        expect(langForPath("a/b.mts")).toBe("ts")
        expect(langForPath("src/app.js")).toBe("js")
        expect(langForPath("src/app.cjs")).toBe("js")
        expect(langForPath("package.json")).toBe("json")
        expect(langForPath("scripts/build.py")).toBe("py")
        expect(langForPath("typings/build.pyi")).toBe("py")
        expect(langForPath("index.html")).toBe("html")
        expect(langForPath("templates/page.htm")).toBe("html")
        expect(langForPath("x.sql")).toBe("sql")
        expect(langForPath("s.zsh")).toBe("sh")
        expect(langForPath("notes.txt")).toBe("md")
    })
})

describe("lsp coordinate helpers", () => {
    test("converts editor cursors to LSP positions", () => {
        expect(cursorToLsp({ ln: 1, col: 1 })).toEqual({ line: 0, character: 0 })
        expect(cursorToLsp({ ln: 5, col: 3 })).toEqual({ line: 4, character: 2 })
        expect(cursorToLsp({ ln: 2, col: 0 })).toEqual({ line: 1, character: 0 })
    })

    test("converts LSP ranges to editor cursors", () => {
        expect(lspRangeToCursor({
            start_line: 3,
            start_character: 2,
            end_line: 3,
            end_character: 8,
        })).toEqual({ ln: 4, col: 3 })
    })

    test("maps file URIs back to workspace relative paths", () => {
        expect(relativePathFromUri("/root", "file:///root/src/a.ts")).toBe("src/a.ts")
        expect(relativePathFromUri("/root/", "file:///root/a%20b.ts")).toBe("a b.ts")
        expect(relativePathFromUri("/root", "file:///other/src/a.ts")).toBeNull()
        expect(relativePathFromUri("/root", "file:///root")).toBeNull()
        expect(relativePathFromUri("/root", "file:///root/../other/a.ts")).toBeNull()
        expect(relativePathFromUri("/root", "file:///root/%2e%2e/other/a.ts")).toBeNull()
        expect(relativePathFromUri("/root", "/root/src/a.ts")).toBeNull()
        expect(relativePathFromUri("/root", "file:///root/%ZZ.ts")).toBeNull()
        expect(relativePathFromUri("/root", "file:///root2/src/a.ts")).toBeNull()
    })
})

describe("lsp mapping helpers", () => {
    test("maps LSP locations and location links to editor cursors", () => {
        const range = {
            start: { line: 3, character: 2 },
            end: { line: 3, character: 8 },
        }
        expect(mapLspLocations([
            { uri: "file:///root/src/a.ts", range },
            { targetUri: "file:///root/src/b.ts", targetSelectionRange: range },
            { uri: "file:///other/out.ts", range },
        ], "/root")).toEqual([
            { path: "src/a.ts", line: 4, col: 3 },
            { path: "src/b.ts", line: 4, col: 3 },
        ])
    })

    test("falls back to targetRange for location links", () => {
        expect(mapLspLocations({
            targetUri: "file:///root/src/link.ts",
            targetRange: {
                start: { line: 2, character: 4 },
                end: { line: 2, character: 9 },
            },
        }, "/root")).toEqual([{ path: "src/link.ts", line: 3, col: 5 }])
    })

    test("maps a single LSP location object", () => {
        expect(mapLspLocations({
            uri: "file:///root/src/a.ts",
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
            },
        }, "/root")).toEqual([{ path: "src/a.ts", line: 1, col: 1 }])
    })

    test("skips malformed LSP locations", () => {
        expect(mapLspLocations(null, "/root")).toEqual([])
        expect(mapLspLocations("bad", "/root")).toEqual([])
        expect(mapLspLocations({ uri: "file:///root/src/a.ts", range: null }, "/root")).toEqual([])
        expect(mapLspLocations({
            uri: "file:///root/src/a.ts",
            range: {
                start: { line: NaN, character: 0 },
                end: { line: 0, character: 1 },
            },
        }, "/root")).toEqual([])
        expect(mapLspLocations({
            uri: "file:///root/src/a.ts",
            range: {
                start: { line: 0, character: Infinity },
                end: { line: 0, character: 1 },
            },
        }, "/root")).toEqual([])
    })

    test("groups LSP diagnostics by path", () => {
        const one = {
            path: "src/a.ts",
            range: { start_line: 0, start_character: 0, end_line: 0, end_character: 1 },
            severity: "Error",
            message: "first",
            source: "tsserver",
        }
        const two = { ...one, message: "second" }
        const three = { ...one, path: "src/b.ts", message: "third" }

        expect(mapLspDiagnostics([one, two, three])).toEqual({
            "src/a.ts": [one, two],
            "src/b.ts": [three],
        })
    })
})

describe("lsp workspace edit helpers", () => {
    const range = (startLine: number, startCharacter: number, endLine: number, endCharacter: number) => ({
        start_line: startLine,
        start_character: startCharacter,
        end_line: endLine,
        end_character: endCharacter,
    })

    test("flattens workspace edits from changes objects", () => {
        expect(flattenWorkspaceEdit({
            changes: {
                "file:///root/src/a.ts": [
                    { range: range(0, 0, 0, 3), newText: "Bar" },
                ],
            },
        }, "/root")).toEqual([{
            path: "src/a.ts",
            edits: [{ range: range(0, 0, 0, 3), newText: "Bar" }],
        }])
    })

    test("flattens workspace edits from documentChanges arrays and skips bad URIs", () => {
        expect(flattenWorkspaceEdit({
            documentChanges: [
                {
                    textDocument: { uri: "file:///root/src/a.ts" },
                    edits: [{ range: range(1, 0, 1, 3), newText: "One" }],
                },
                {
                    textDocument: { uri: "file:///other/src/b.ts" },
                    edits: [{ range: range(0, 0, 0, 1), newText: "Bad" }],
                },
            ],
        }, "/root")).toEqual([{
            path: "src/a.ts",
            edits: [{ range: range(1, 0, 1, 3), newText: "One" }],
        }])
    })

    test("applies text edits from the end of the document", () => {
        expect(applyTextEdits("foo bar foo", [
            { range: range(0, 0, 0, 3), newText: "X" },
            { range: range(0, 8, 0, 11), newText: "Y" },
        ])).toBe("X bar Y")
    })

    test("applies multiline text edits", () => {
        expect(applyTextEdits("a\nbcd\ne", [
            { range: range(0, 1, 2, 0), newText: "XY" },
        ])).toBe("aXYe")
    })

    test("skips invalid text edit ranges", () => {
        expect(applyTextEdits("abc", [
            { range: range(0, 2, 0, 1), newText: "X" },
        ])).toBe("abc")
        expect(applyTextEdits("a\nb\nc", [
            { range: range(2, 0, 1, 0), newText: "X" },
        ])).toBe("a\nb\nc")
        expect(applyTextEdits("abc", [
            { range: range(9, 0, 9, 1), newText: "X" },
        ])).toBe("abc")
    })
})

describe("mapGitLog", () => {
    const row = (hash: string, parents: string[], lane = 0): GitLogRow => ({
        hash,
        short_hash: hash.slice(0, 6),
        subject: "subject " + hash,
        author: "yuuzu",
        when_unix: 1_000_000,
        refs: [{ name: "main", kind: "branch" }, { name: "HEAD", kind: "head" }],
        parents,
        lane,
        lane_overflow: false,
        merge: parents.length > 1,
        edges: [],
    })

    test("converts parent hashes into row indices and strips HEAD refs", () => {
        const rows = [row("aaaaaa1", ["bbbbbb2"]), row("bbbbbb2", ["cccccc3"]), row("cccccc3", [])]
        const git = mapGitLog(rows, null, 1_000_120)
        expect(git.commits[0].par).toEqual([1])
        expect(git.commits[1].par).toEqual([2])
        expect(git.commits[2].par).toEqual([])
        expect(git.commits[0].refs).toEqual(["main"])
        expect(git.commits[0].fullHash).toBe("aaaaaa1")
        expect(git.commits[0].t).toBe("2m")
    })

    test("keeps ahead/behind from the repository status", () => {
        const git = mapGitLog([], {
            workspace_root: "/w",
            repository_root: "/w",
            branch: "main",
            upstream: null,
            ahead: 3,
            behind: 1,
            clean: true,
            has_conflicts: false,
            changes: [],
        }, 0)
        expect(git.ahead).toBe(3)
        expect(git.behind).toBe(1)
    })

    test("clamps lanes beyond the three design colors", () => {
        const rows = [row("aaaaaa1", [], 7)]
        expect(mapGitLog(rows, null, 0).commits[0].lane).toBe(2)
    })
})

describe("git working tree mapping", () => {
    const status: GitRepositoryStatus = {
        workspace_root: "/w",
        repository_root: "/w",
        branch: "main",
        upstream: "origin/main",
        ahead: 1,
        behind: 2,
        clean: false,
        has_conflicts: true,
        changes: [
            { path: "src/staged.ts", original_path: null, index_status: "M", worktree_status: " ", kind: "modified" },
            { path: "src/unstaged.ts", original_path: null, index_status: " ", worktree_status: "M", kind: "modified" },
            { path: "src/new.ts", original_path: null, index_status: "A", worktree_status: " ", kind: "added" },
            { path: "src/conflict.ts", original_path: null, index_status: "U", worktree_status: "U", kind: "conflict" },
        ],
    }

    test("maps status groups into v2 git files", () => {
        const groups = mapGitStatusGroups(status)

        expect(groups.branch).toBe("main")
        expect(groups.upstream).toBe("origin/main")
        expect(groups.hasConflicts).toBe(true)
        expect(groups.staged.map((file) => [file.path, file.st, file.staged])).toContainEqual(["src/staged.ts", "M", true])
        expect(groups.staged.map((file) => [file.path, file.st, file.staged])).toContainEqual(["src/new.ts", "A", true])
        expect(groups.unstaged.map((file) => [file.path, file.st, file.staged])).toContainEqual(["src/unstaged.ts", "M", false])
        expect(groups.unstaged.some((file) => file.path === "src/conflict.ts")).toBe(false)
        expect(groups.conflicts).toEqual([{ path: "src/conflict.ts", kind: "conflict", st: "U", staged: false }])
    })

    test("maps null status to empty groups", () => {
        expect(mapGitStatusGroups(null)).toEqual({
            staged: [],
            unstaged: [],
            conflicts: [],
            hasConflicts: false,
            branch: "",
            upstream: null,
        })
    })

    test("flattens git diff hunks for v2 rendering", () => {
        const rows = mapDiffHunks({
            path: "src/app.ts",
            staged: false,
            binary: false,
            truncated: false,
            hunks: [{
                header: "@@ -1,2 +1,3 @@",
                old_start: 1,
                old_lines: 2,
                new_start: 1,
                new_lines: 3,
                lines: [
                    { kind: "context", old_no: 1, new_no: 1, text: "keep", word_ranges: [] },
                    { kind: "del", old_no: 2, new_no: null, text: "old", word_ranges: [] },
                    { kind: "add", old_no: null, new_no: 2, text: "new", word_ranges: [] },
                ],
            }],
        })

        expect(rows).toEqual([
            { t: "h", s: "@@ -1,2 +1,3 @@", oldNo: null, newNo: null, hunkIndex: 0, lineIndex: null },
            { t: "x", s: "keep", oldNo: 1, newNo: 1, hunkIndex: 0, lineIndex: 0 },
            { t: "d", s: "old", oldNo: 2, newNo: null, hunkIndex: 0, lineIndex: 1 },
            { t: "a", s: "new", oldNo: null, newNo: 2, hunkIndex: 0, lineIndex: 2 },
        ])
    })
})

describe("connection mapping", () => {
    test("maps database profiles with friendly engine labels", () => {
        const conns = mapDbProfiles([
            {
                id: "p1",
                workspace_root: "/w",
                name: "local.db",
                kind: "sqlite" as never,
                source: "manual" as never,
                read_only: false,
                production: false,
                created_ms: 0,
                updated_ms: 0,
            },
        ])
        expect(conns[0]).toMatchObject({ name: "local.db", engine: "SQLite", profileId: "p1", tables: [] })
        expect(engineLabel("postgresql")).toBe("PostgreSQL")
    })

    test("maps schema tables with column metadata", () => {
        const tables = mapDbTables([
            {
                schema: null,
                name: "users",
                row_count: 1243,
                columns: [
                    { name: "id", data_type: "INTEGER", nullable: false, primary_key: true },
                    { name: "email", data_type: "TEXT", nullable: true, primary_key: false },
                ],
            },
        ])
        expect(tables[0].n).toBe("users")
        expect(tables[0].c).toBe("1,243")
        expect(tables[0].cols).toEqual([
            { name: "id", type: "INTEGER", nullable: false, pk: true },
            { name: "email", type: "TEXT", nullable: true, pk: false },
        ])
    })

    test("maps remote hosts to user@host labels", () => {
        const hosts = mapRemoteHosts([
            {
                id: "h1",
                workspace_root: "/w",
                name: "edge",
                host: "edge-01",
                port: 22,
                username: "deploy",
                auth: { kind: "agent" } as never,
                default_remote_path: "/var/www",
                keepalive_seconds: 30,
                connect_timeout_seconds: 10,
                created_ms: 0,
                updated_ms: 0,
            },
        ])
        expect(hosts[0]).toMatchObject({
            label: "deploy@edge-01",
            sub: "edge · port 22",
            hostId: "h1",
            remotePath: "/var/www",
        })
    })
})

describe("query result mapping", () => {
    test("renders cells as display strings with NULL markers", () => {
        const grid = mapQueryResult({
            profile_id: "p1",
            sql: "SELECT 1",
            classification: { kind: "Read", requires_confirmation: false, confirmation_text: "", reason: "" },
            columns: ["id", "name"],
            rows: [
                { cells: [{ kind: "Text", display: "1" }, { kind: "Null", display: "" }] },
            ],
            affected_rows: null,
            truncated: true,
            executed_ms: 12,
            history_id: "h1",
        })
        expect(grid.cols).toEqual(["id", "name"])
        expect(grid.rows).toEqual([["1", "NULL"]])
        expect(grid.ms).toBe(12)
        expect(grid.truncated).toBe(true)
        expect(grid.kind).toBe("Read")
    })

    test("preserves mutation classification kind", () => {
        const grid = mapQueryResult({
            profile_id: "p1",
            sql: "UPDATE users SET active = 0",
            classification: {
                kind: "Mutation",
                requires_confirmation: true,
                confirmation_text: "RUN MUTATION",
                reason: "updates rows",
            },
            columns: [],
            rows: [],
            affected_rows: 3,
            truncated: false,
            executed_ms: 5,
            history_id: "h2",
        })

        expect(grid.kind).toBe("Mutation")
        expect(grid.affected).toBe(3)
    })

    test("maps database query history rows", () => {
        const rows = mapDbHistory([{
            sql: "DELETE FROM sessions",
            kind: "Mutation",
            executed_ms: 1_700_000_000_000,
            affected_rows: 3,
            row_count: null,
        }, {
            sql: "SELECT * FROM users",
            kind: "Read",
            executed_ms: 1_700_000_001_000,
            affected_rows: null,
            row_count: 12,
        }])

        expect(rows[0].sql).toBe("DELETE FROM sessions")
        expect(rows[0].kind).toBe("Mutation")
        expect(rows[0].rows).toBe("3 affected")
        expect(rows[0].when.length).toBeGreaterThan(0)
        expect(rows[1].rows).toBe("12 rows")
    })

    test("calculates browser capture screen bounds", () => {
        expect(screenBoundsFromRect(
            { x: 10.4, y: 20.6, width: 300.2, height: 199.8 },
            5,
            7,
        )).toEqual({ x: 15, y: 28, width: 300, height: 200 })
    })

    test("confirmationFromError extracts the backend confirmation text", () => {
        expect(confirmationFromError("mutation requires confirmation text: RUN MUTATION")).toBe("RUN MUTATION")
        expect(confirmationFromError("destructive SQL requires confirmation text: RUN DESTRUCTIVE SQL")).toBe(
            "RUN DESTRUCTIVE SQL",
        )
        expect(confirmationFromError("table users does not exist")).toBeNull()
    })
})

describe("stability mapping", () => {
    test("maps metric snapshots with nullable memory", () => {
        const metric = mapMetric({
            memory_bytes: null,
            uptime_ms: 1000,
            workspace_count: 2,
            docs_index_entries: 0,
            file_tree_entries: 9,
            process_id: 42,
        })

        expect(metric).toEqual({
            memoryBytes: null,
            uptimeMs: 1000,
            workspaceCount: 2,
            docsIndexEntries: 0,
            fileTreeEntries: 9,
            processId: 42,
        })
    })

    test("sorts and caps diagnostic events", () => {
        const rows = Array.from({ length: 52 }, (_, i) => ({
            id: String(i),
            timestamp_ms: i,
            level: "info" as const,
            source: "test",
            message: "event " + i,
        }))
        const events = mapDiagnosticEvents(rows)

        expect(events).toHaveLength(50)
        expect(events[0].ts).toBe(51)
        expect(events[49].ts).toBe(2)
    })

    test("maps recovery backups to sorted summaries", () => {
        const backups = mapBackups([
            { id: "b1", path: "b.ts", content: "abcd", updated_ms: 1 },
            { id: "b2", path: "a.ts", content: "abc", updated_ms: 2 },
        ])

        expect(backups[0]).toEqual({ id: "b2", path: "a.ts", updatedMs: 2, contentLength: 3 })
        expect(backups[1]).toEqual({ id: "b1", path: "b.ts", updatedMs: 1, contentLength: 4 })
    })
})

describe("sftp mapping", () => {
    const remote: RemoteFileEntry[] = [
        { host_id: "h1", path: "/var/www/app.ts", name: "app.ts", kind: "File", size: 2048, modified_ms: 0, link_target: null },
        { host_id: "h1", path: "/var/www/releases", name: "releases", kind: "Directory", size: null, modified_ms: 0, link_target: null },
        { host_id: "h1", path: "/var/www/current", name: "current", kind: "Symlink", size: null, modified_ms: 0, link_target: "/var/www/releases/1" },
    ]

    test("maps remote entries dirs-first with size labels", () => {
        const files = mapRemoteEntries(remote)
        expect(files[0]).toMatchObject({ name: "releases/", chip: "dir", kind: "dir", size: "—" })
        expect(files[1]).toMatchObject({ name: "app.ts", chip: "ts", kind: "file", size: "2.0K", p: "/var/www/app.ts" })
        expect(files[2]).toMatchObject({ name: "current", chip: "ln", kind: "link" })
    })

    test("maps local workspace entries dirs-first", () => {
        const files = mapLocalEntries([
            { name: "readme.md", path: "/w/readme.md", is_dir: false },
            { name: "src", path: "/w/src", is_dir: true },
        ])
        expect(files[0]).toMatchObject({ name: "src/", kind: "dir" })
        expect(files[1]).toMatchObject({ name: "readme.md", kind: "file", p: "/w/readme.md" })
    })

    test("parentPath walks up and stops at the root", () => {
        expect(parentPath("/var/www/releases")).toBe("/var/www")
        expect(parentPath("/var")).toBe("/")
        expect(parentPath("/")).toBe("/")
    })
})
