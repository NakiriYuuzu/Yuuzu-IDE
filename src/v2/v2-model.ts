// Yuuzu IDE v2 — domain model, demo content and pure helpers.
// Transcribed from the Claude Design handoff (Yuuzu IDE v2.dc.html); the demo
// content is the design's own dataset so every surface renders without a backend.

import type { GitBlameFile, GitBranchFull, GitChangeKind, GitConflictFile, GitStashEntry } from "../features/git/git-model"
import type { GitDiffHunks } from "../features/git/git-diff-model"
import type { LanguageServerStatus, LspDiagnostic } from "../features/language/language-model"
import type { DatabaseProfile, QueryKind } from "../features/database/database-model"
import type { DbDialogState } from "./db-dialog"

export type FnMode = "files" | "git" | "db" | "ssh" | "agent" | "lang"

export type TabKind = "file" | "cmd" | "browser" | "git" | "db" | "sftp" | "diff" | "conflict"

// Result grid of a real database query (rows pre-rendered as display strings).
export type DbGrid = {
    cols: string[]
    rows: string[][]
    ms: number
    truncated: boolean
    affected: number | null
    kind?: QueryKind
    running?: boolean
    error?: string
}

export type DbHistoryRow = {
    sql: string
    kind: QueryKind
    when: string
    rows: string
}

export type MetricSnapshot = {
    memoryBytes: number | null
    uptimeMs: number
    workspaceCount: number
    docsIndexEntries: number
    fileTreeEntries: number
    processId: number
}

export type DiagEvent = {
    id: string
    level: "debug" | "info" | "warn" | "error"
    source: string
    message: string
    ts: number
}

export type BackupSummary = {
    id: string
    path: string
    updatedMs: number
    contentLength: number
}

export type Tab = {
    id: number
    type: TabKind
    title?: string
    name?: string
    path?: string
    reveal?: { line: number; col: number }
    dirty?: boolean
    url?: string
    mode?: "api" | "web" | "blank"
    buf?: string
    lines?: string[]
    table?: string
    conn?: string
    engine?: string
    count?: string
    view?: "data" | "structure" | "sql" | "history"
    // real-backend fields
    sessionId?: string
    titleLocked?: boolean
    realPath?: string
    content?: string | null
    contentLang?: string
    loading?: boolean
    tooLarge?: boolean
    exited?: boolean
    // real editor: last saved snapshot + disk version for conflict detection
    savedContent?: string | null
    version?: { modified_ms: number; len: number } | null
    saving?: boolean
    // set when the file changed on disk outside the editor (file watcher)
    externalChange?: boolean
    // real database console
    profileId?: string
    sql?: string
    grid?: DbGrid
    history?: DbHistoryRow[]
    historyLoading?: boolean
    // real browser preview (loopback iframe)
    urlInput?: string
    urlErr?: string
    reloadN?: number
    screenshot?: { dataUrl: string; width: number; height: number }
    // real git diff tab
    diff?: DiffRow[]
    diffHunks?: GitDiffHunks
    diffStaged?: boolean
    diffCommit?: string
    diffCompare?: "worktree"
    // real git conflict tab
    conflict?: GitConflictFile
    // real git blame gutter
    blame?: GitBlameFile
    blameLoading?: boolean
}

export type AzWindow = {
    id: number
    title: string
    titleLocked?: boolean
    status: string
    lines: string[]
    buf: string
    min: boolean
    max: boolean
    sessionId?: string
}

export type SftpFile = {
    chip: string
    name: string
    size: string
    isNew?: boolean
    // real-backend fields: entry kind and full path on its side
    kind?: "file" | "dir" | "link"
    p?: string
}

export type SftpPane = "local" | "remote"

export type SftpState = {
    host?: string
    localPath: string
    remotePath: string
    local: SftpFile[]
    remote: SftpFile[]
    sel: { pane: SftpPane; idx: number } | null
    clip: (SftpFile & { from: SftpPane; idx: number }) | null
    focus: SftpPane
    // real-backend fields
    hostId?: string
    localRel?: string
    connected?: boolean
    loading?: boolean
}

export type TreeNode = {
    n: string
    mod?: boolean
    d?: TreeNode[]
    // real-backend fields: absolute/scan path and lazy-load marker
    p?: string
    loaded?: boolean
}

export type GitCommit = {
    lane: number
    m: string
    a: string
    h: string
    t: string
    refs: string[]
    par: number[]
    fullHash?: string
}

export type GitDetail = {
    hash: string
    body: string
    files: { path: string; st: string; add: number; del: number }[]
}

export type GitFile = {
    path: string
    kind: GitChangeKind
    st: "A" | "M" | "D" | "U"
    staged: boolean
}

export type DiffRow = {
    t: "h" | "x" | "a" | "d"
    s: string
    oldNo: number | null
    newNo: number | null
    hunkIndex: number
    lineIndex: number | null
}

export type GitData = {
    ahead: number
    behind: number
    commits: GitCommit[]
    staged: GitFile[]
    unstaged: GitFile[]
    conflicts: GitFile[]
    hasConflicts: boolean
    branch: string
    upstream: string | null
    branchesFull: GitBranchFull[]
    stashes: GitStashEntry[]
    conflictChoices: Record<string, "ours" | "theirs">
}

export type DbCol = { name: string; type: string; nullable: boolean; pk: boolean }

export type DbTable = { n: string; c: string; cols?: DbCol[] }

export type DbConn = {
    name: string
    engine: string
    live: boolean
    tables: DbTable[]
    profileId?: string
    inspected?: boolean
}

export type SshHost = {
    label: string
    sub: string
    live: boolean
    hostId?: string
    remotePath?: string
}

export type ProjectMeta = {
    id: string
    name: string
    glyph: string
    branch: string
    bg: string
    fg: string
    bd: string
    root?: string
}

export type ProjectUI = {
    fn: FnMode
    open: Record<string, boolean>
    dbOpen: Record<number, boolean>
    tabs: Tab[]
    activeTab: number | null
    split: number | null
    sftp: SftpState
    wins: AzWindow[]
    azActive: number | null
    treeData: TreeNode[]
    git: GitData
    commitMsg: string
    gitSel: number
    gitFilter: string
    branchPopupOpen: boolean
    stashPanelOpen: boolean
    dbConns: DbConn[]
    dbProfiles: DatabaseProfile[]
    dbDialog: DbDialogState
    sshHosts: SshHost[]
    treeLoaded: boolean
    gitLoaded: boolean
    gitDetail: GitDetail | null
    diagnosticsByPath: Record<string, LspDiagnostic[]>
    lspServers: LanguageServerStatus[]
    lspLogs: string[]
    lspRefs: { path: string; line: number; col: number; preview: string }[] | null
    lspLoaded: boolean
}

export type CtxKind =
    | "file" | "dir" | "root" | "tab" | "project" | "editor" | "term"
    | "browser" | "dbconn" | "dbtable" | "host" | "sftp" | "commit" | "session"

export type CtxTarget = {
    kind: CtxKind
    x: number
    y: number
    path?: string
    id?: number
    type?: TabKind
    name?: string
    projectId?: string
    url?: string
    ci?: number
    live?: boolean
    table?: DbTable
    host?: SshHost
    pane?: SftpPane
    idx?: number
    isDir?: boolean
    hash?: string
    commitIdx?: number
    winId?: number
    cursor?: { ln: number; col: number } | null
}

// ---------------------------------------------------------------- demo data

export const PROJECT_PRESETS: ProjectMeta[] = [
    { id: "api", name: "yuuzu-api", glyph: "AP", branch: "main", bg: "var(--yz-1b2410)", fg: "var(--yz-a8e23f)", bd: "var(--yz-45611a)" },
    { id: "web", name: "yuuzu-web", glyph: "WB", branch: "feat/landing", bg: "var(--yz-10202e)", fg: "var(--yz-82aaff)", bd: "var(--yz-274968)" },
    { id: "edge", name: "infra-edge", glyph: "ED", branch: "main", bg: "var(--yz-241327)", fg: "var(--yz-ce93d8)", bd: "var(--yz-5b2f63)" },
]

export const ADD_PRESETS: ProjectMeta[] = [
    { id: "ml", name: "yuuzu-ml", glyph: "ML", branch: "main", bg: "var(--yz-2a1d10)", fg: "var(--yz-f6a960)", bd: "var(--yz-6b4a22)" },
    { id: "docs", name: "yuuzu-docs", glyph: "DC", branch: "main", bg: "var(--yz-102024)", fg: "var(--yz-6fd6c3)", bd: "var(--yz-23545c)" },
]

const TREES: Record<string, TreeNode[]> = {
    api: [
        { n: "src", d: [
            { n: "db", d: [{ n: "pool.ts" }, { n: "schema.sql" }] },
            { n: "routes", d: [{ n: "users.ts", mod: true }, { n: "projects.ts" }] },
            { n: "lib", d: [{ n: "logger.ts" }] },
            { n: "server.ts" },
        ] },
        { n: "public", d: [{ n: "favicon.svg" }] },
        { n: ".env" }, { n: "package.json" }, { n: "README.md" }, { n: "tsconfig.json" },
    ],
    web: [
        { n: "src", d: [
            { n: "components", d: [{ n: "Hero.tsx" }, { n: "Nav.tsx" }] },
            { n: "styles", d: [{ n: "hero.css" }] },
            { n: "index.tsx" },
        ] },
        { n: "public", d: [{ n: "og-cover.png" }] },
        { n: "package.json" }, { n: "vite.config.ts" },
    ],
    edge: [
        { n: "ansible", d: [{ n: "playbook.yml" }] },
        { n: "scripts", d: [{ n: "deploy.sh" }, { n: "rollback.sh" }] },
        { n: "Caddyfile" }, { n: "README.md" },
    ],
}

export function treeFor(pid: string): TreeNode[] {
    const base = TREES[pid] ?? [{ n: "src", d: [{ n: "index.ts" }] }, { n: "package.json" }, { n: "README.md" }]
    return JSON.parse(JSON.stringify(base)) as TreeNode[]
}

const DBS: Record<string, DbConn[]> = {
    api: [
        { name: "local.db", engine: "SQLite", live: true, tables: [
            { n: "users", c: "1,243" }, { n: "projects", c: "87" }, { n: "sessions", c: "5,219" }, { n: "migrations", c: "12" },
        ] },
        { name: "prod · aws-rds", engine: "PostgreSQL", live: true, tables: [
            { n: "users", c: "48,310" }, { n: "events", c: "2.1M" },
        ] },
        { name: "legacy-erp", engine: "MS SQL Server", live: false, tables: [
            { n: "dbo.Customers", c: "9,402" },
        ] },
    ],
    web: [
        { name: "cms.db", engine: "SQLite", live: true, tables: [
            { n: "pages", c: "34" }, { n: "assets", c: "412" },
        ] },
    ],
    edge: [],
}

export function dbsFor(pid: string): DbConn[] {
    return DBS[pid] ?? []
}

const HOSTS: Record<string, SshHost[]> = {
    api: [
        { label: "deploy@edge-01", sub: "eu-central · key ed25519", live: true },
        { label: "deploy@staging-02", sub: "us-east · key ed25519", live: false },
    ],
    web: [
        { label: "deploy@pages-cdn", sub: "static deploy target", live: false },
    ],
    edge: [
        { label: "root@edge-01", sub: "eu-central · primary", live: true },
        { label: "root@edge-02", sub: "us-east · replica", live: true },
    ],
}

export function hostsFor(pid: string): SshHost[] {
    return HOSTS[pid] ?? []
}

const GIT: Record<string, GitData> = {
    api: gitData({ branch: "main", ahead: 2, behind: 0, commits: [
        { lane: 0, m: "merge: feat/users-pagination", a: "yuuzu", h: "f3a91c", t: "2h", refs: ["main", "origin"], par: [3, 1] },
        { lane: 1, m: "feat: cursor pagination on /users", a: "claude", h: "8c12de", t: "3h", refs: ["feat/pag"], par: [2] },
        { lane: 1, m: "test: pagination edge cases", a: "claude", h: "4be77a", t: "3h", refs: [], par: [4] },
        { lane: 0, m: "chore: bump express to 5.1", a: "yuuzu", h: "2b9e44", t: "6h", refs: [], par: [4] },
        { lane: 0, m: "fix: pool timeout on idle", a: "claude", h: "91d2af", t: "1d", refs: [], par: [5] },
        { lane: 2, m: "spike: sessions cache", a: "yuuzu", h: "7aa012", t: "2d", refs: ["spike"], par: [6] },
        { lane: 0, m: "feat: /health endpoint", a: "claude", h: "c0ffee", t: "2d", refs: ["v0.4.2"], par: [7] },
        { lane: 0, m: "chore: scaffold express api", a: "yuuzu", h: "a11ce5", t: "4d", refs: [], par: [] },
    ] }),
    web: gitData({ branch: "feat/landing", ahead: 1, behind: 0, commits: [
        { lane: 1, m: "feat: hero stagger reveal", a: "claude", h: "d4e021", t: "1h", refs: ["feat/landing"], par: [1] },
        { lane: 1, m: "feat: landing scaffold", a: "yuuzu", h: "99ab10", t: "1d", refs: [], par: [2] },
        { lane: 0, m: "chore: vite + react init", a: "yuuzu", h: "5c77e0", t: "2d", refs: ["main"], par: [3] },
        { lane: 0, m: "init", a: "yuuzu", h: "000a1f", t: "2d", refs: [], par: [] },
    ] }),
    edge: gitData({ branch: "main", ahead: 0, behind: 1, commits: [
        { lane: 0, m: "fix: zero-downtime symlink swap", a: "yuuzu", h: "e810bc", t: "5h", refs: ["main"], par: [1] },
        { lane: 0, m: "feat: rollback script", a: "claude", h: "77fe02", t: "1d", refs: [], par: [2] },
        { lane: 0, m: "feat: caddy reverse proxy", a: "yuuzu", h: "3d91aa", t: "3d", refs: ["v1.0"], par: [3] },
        { lane: 0, m: "init infra repo", a: "yuuzu", h: "b00710", t: "6d", refs: [], par: [] },
    ] }),
}

export function emptyGitData(branch = ""): GitData {
    return {
        ahead: 0,
        behind: 0,
        commits: [],
        staged: [],
        unstaged: [],
        conflicts: [],
        hasConflicts: false,
        branch,
        upstream: null,
        branchesFull: [],
        stashes: [],
        conflictChoices: {},
    }
}

function gitData(data: Pick<GitData, "ahead" | "behind" | "commits"> & Partial<GitData>): GitData {
    return { ...emptyGitData(data.branch ?? ""), ...data }
}

export function gitFor(pid: string): GitData {
    const base = GIT[pid] ?? gitData({ ahead: 0, behind: 0, commits: [
        { lane: 0, m: "init repository", a: "yuuzu", h: "000a1f", t: "now", refs: ["main"], par: [] },
    ] })
    return JSON.parse(JSON.stringify(base)) as GitData
}

const SFTP_LOCAL: Record<string, SftpFile[]> = {
    api: [
        { chip: "ts", name: "server.ts", size: "4.1K" },
        { chip: "ts", name: "users.ts", size: "2.6K" },
        { chip: "sql", name: "schema.sql", size: "1.8K" },
        { chip: "csv", name: "users-export.csv", size: "12K" },
        { chip: "{}", name: "package.json", size: "1.2K" },
        { chip: "md", name: "README.md", size: "3.4K" },
    ],
    web: [
        { chip: "tsx", name: "index.tsx", size: "2.2K" },
        { chip: "css", name: "hero.css", size: "1.6K" },
        { chip: "{}", name: "package.json", size: "1.1K" },
        { chip: "img", name: "og-cover.png", size: "214K" },
    ],
    edge: [
        { chip: "sh", name: "deploy.sh", size: "2.1K" },
        { chip: "sh", name: "rollback.sh", size: "1.4K" },
        { chip: "yml", name: "playbook.yml", size: "3.0K" },
        { chip: "Cf", name: "Caddyfile", size: "0.9K" },
    ],
}

export function sftpFor(pid: string): SftpState {
    const local = (SFTP_LOCAL[pid] ?? SFTP_LOCAL.edge).map((f) => ({ ...f }))
    const home = pid === "api" ? "yuuzu-api" : pid === "web" ? "yuuzu-web" : "infra-edge"
    return {
        localPath: "~/dev/" + home,
        remotePath: "/var/www",
        local,
        remote: [
            { chip: "dir", name: "releases/", size: "4.0K" },
            { chip: "ln", name: "current → releases/0.4.2", size: "—" },
            { chip: "sh", name: "deploy.sh", size: "2.1K" },
            { chip: "env", name: ".env.production", size: "0.4K" },
            { chip: "dir", name: "logs/", size: "12K" },
        ],
        sel: null,
        clip: null,
        focus: "local",
    }
}

// ---------------------------------------------------------------- demo code

type CodeEntry = { lang: string; src: string }

const CODE: Record<string, CodeEntry> = {
    "src/server.ts": { lang: "ts", src: 'import express from "express";\nimport { createConnection } from "./db/pool";\nimport { usersRouter } from "./routes/users";\nimport { logger } from "./lib/logger";\n\nconst app = express();\nconst PORT = process.env.PORT ?? 3000;\n\napp.use(express.json());\napp.use(logger);\n\n// Mount the resource routers\napp.use("/api/users", usersRouter);\n\napp.get("/health", (req, res) => {\n  res.json({ status: "ok", uptime: process.uptime() });\n});\n\nasync function main() {\n  await createConnection();\n  app.listen(PORT, () => console.log("api on :" + PORT));\n}\n\nmain();' },
    "src/routes/users.ts": { lang: "ts", src: 'import { Router } from "express";\nimport { db } from "../db/pool";\n\nexport const usersRouter = Router();\n\n// GET /api/users?page=1 — cursor pagination, 50 per page\nusersRouter.get("/", async (req, res) => {\n  const page = Number(req.query.page ?? 1);\n  const rows = await db.query(\n    "SELECT id, name, email, role FROM users LIMIT 50 OFFSET $1",\n    [(page - 1) * 50]\n  );\n  res.json({ page, count: rows.length, rows });\n});\n\nusersRouter.get("/:id", async (req, res) => {\n  const row = await db.one("SELECT * FROM users WHERE id = $1", [req.params.id]);\n  if (!row) return res.status(404).json({ error: "not found" });\n  res.json(row);\n});' },
    "src/db/pool.ts": { lang: "ts", src: 'import { Pool } from "pg";\n\nexport const db = new Pool({\n  connectionString: process.env.DATABASE_URL,\n  max: 10,\n  idleTimeoutMillis: 30000,\n});\n\nexport async function createConnection() {\n  await db.query("SELECT 1");\n  console.log("db pool ready");\n}' },
    "src/db/schema.sql": { lang: "sql", src: "CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL,\n  email TEXT NOT NULL,\n  role TEXT NOT NULL,\n  created_at TEXT NOT NULL\n);\n\nCREATE TABLE sessions (\n  id INTEGER PRIMARY KEY,\n  user_id INTEGER REFERENCES users(id),\n  started_at TEXT NOT NULL\n);" },
    "src/index.tsx": { lang: "ts", src: 'import { createRoot } from "react-dom/client";\nimport { Hero } from "./components/Hero";\nimport { Nav } from "./components/Nav";\nimport "./styles/hero.css";\n\nfunction App() {\n  return (\n    <main className="page">\n      <Nav version="0.4.2" />\n      <Hero\n        title="The CLI-first IDE built around Claude Code"\n        tagline="Editors, databases, SSH and a built-in browser."\n      />\n    </main>\n  );\n}\n\ncreateRoot(document.getElementById("root")).render(<App />);' },
    "src/styles/hero.css": { lang: "css", src: ".hero {\n  min-height: 72vh;\n  display: grid;\n  place-items: center;\n  background: radial-gradient(80% 60% at 70% 0%, #15240B 0%, #0A0E16 60%);\n}\n\n.hero h1 {\n  font-size: 64px;\n  letter-spacing: -0.02em;\n  animation: reveal 0.6s ease both;\n}\n\n.hero h1 .accent { color: #A8E23F; }\n\n@keyframes reveal {\n  from { opacity: 0; transform: translateY(14px); }\n  to { opacity: 1; transform: none; }\n}" },
    "scripts/deploy.sh": { lang: "sh", src: '#!/usr/bin/env bash\nset -euo pipefail\n\n# Zero-downtime deploy: upload, swap symlink, restart\nHOST="deploy@edge-01"\nRELEASE="releases/$(date +%Y%m%d%H%M)"\n\nrsync -az --exclude node_modules ./ "$HOST:/var/www/$RELEASE"\nssh "$HOST" "ln -sfn /var/www/$RELEASE /var/www/current"\nssh "$HOST" "systemctl restart yuuzu-api"\n\necho "deployed $RELEASE"' },
}

const extraCode: Record<string, CodeEntry> = {}

export function codeFor(path: string): CodeEntry {
    return (
        extraCode[path] ??
        CODE[path] ?? {
            lang: "md",
            src: "# " + (path.split("/").pop() ?? path) + "\n\n(read-only preview)\n\nOpen in the editor to make changes.",
        }
    )
}

export function registerCode(path: string, entry: CodeEntry): void {
    extraCode[path] = entry
}

// ---------------------------------------------------------------- highlighter

export type Seg = { c: string; s: string; w?: number }

const KEYWORDS: Record<string, string> = {
    rust: "as,async,await,break,const,continue,crate,dyn,else,enum,extern,false,fn,for,if,impl,in,let,loop,match,mod,move,mut,pub,ref,return,self,Self,static,struct,super,trait,true,type,unsafe,use,where,while",
    ts: "import,from,const,let,var,return,async,await,function,export,default,if,else,new,try,catch,throw,interface,type,extends,class",
    js: "import,from,const,let,var,return,async,await,function,export,default,if,else,new,try,catch,throw,class,extends",
    json: "",
    py: "and,as,assert,async,await,break,class,continue,def,elif,else,except,False,finally,for,from,if,import,in,is,lambda,None,not,or,pass,raise,return,True,try,while,with,yield",
    sql: "CREATE,TABLE,SELECT,FROM,WHERE,ORDER,BY,LIMIT,DESC,ASC,AND,OR,INTEGER,TEXT,NOT,NULL,PRIMARY,KEY,REFERENCES,INSERT,INTO,VALUES",
    html: "",
    css: "animation,from,to,@media,@keyframes",
    sh: "set,echo,ssh,rsync,date,ln,systemctl,exit,if,then,fi,export",
    md: "",
}

const TYPE_KEYWORDS: Record<string, string> = {
    rust: "struct,enum,trait,impl,type",
    ts: "interface,type,class,enum",
    js: "class",
    py: "class",
}

const HL_COLORS = {
    k: "var(--yz-syntax-keyword)",
    s: "var(--yz-syntax-string)",
    n: "var(--yz-syntax-number)",
    f: "var(--yz-syntax-function)",
    t: "var(--yz-syntax-type)",
    c: "var(--yz-syntax-comment)",
    d: "var(--yz-syntax-default)",
    a: "var(--yz-syntax-attribute)",
    g: "var(--yz-syntax-tag)",
    v: "var(--yz-syntax-variable)",
}

export function hlLine(line: string, lang: string): Seg[] {
    const kws = (KEYWORDS[lang] ?? "").split(",").filter(Boolean)
    const typeKws = (TYPE_KEYWORDS[lang] ?? "").split(",").filter(Boolean)
    const comRe =
        lang === "sql" ? "--"
            : lang === "sh" || lang === "py" ? "#"
                : lang === "ts" || lang === "js" || lang === "rust" ? "//"
                    : null
    const C = HL_COLORS
    const trimmed = line.trimStart()
    if (comRe && trimmed.startsWith(comRe)) return [{ c: C.c, s: line }]
    if (comRe === "//") {
        const ci = line.indexOf("//")
        if (ci > 0) {
            const head = hlLine(line.slice(0, ci), lang)
            head.push({ c: C.c, s: line.slice(ci) })
            return head
        }
    }
    const segs: Seg[] = []
    const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g
    let i = 0
    let m: RegExpExecArray | null
    let previousWord = ""
    while ((m = re.exec(line)) !== null) {
        if (m.index > i) segs.push({ c: C.d, s: line.slice(i, m.index) })
        const after = line.slice(re.lastIndex).trimStart()
        const before = line.slice(0, m.index).trimEnd()
        if (m[1]) {
            if (lang === "json" && after.startsWith(":")) segs.push({ c: C.a, s: m[1] })
            else segs.push({ c: C.s, s: m[1] })
            previousWord = ""
        }
        else if (m[2]) {
            segs.push({ c: C.n, s: m[2] })
            previousWord = ""
        }
        else {
            const w = m[3]
            const previousChar = before.slice(-1)
            if (lang === "html" && (previousChar === "<" || before.endsWith("</"))) segs.push({ c: C.g, s: w })
            else if ((lang === "html" || lang === "css") && after.startsWith("=")) segs.push({ c: C.a, s: w })
            else if (lang === "css" && after.startsWith(":")) segs.push({ c: C.a, s: w })
            else if (typeKws.indexOf(previousWord) >= 0) segs.push({ c: C.t, s: w })
            else if (kws.indexOf(w) >= 0) segs.push({ c: C.k, s: w })
            else if (after.startsWith("(")) segs.push({ c: C.f, s: w })
            else segs.push({ c: C.d, s: w })
            previousWord = w
        }
        i = re.lastIndex
    }
    if (i < line.length) segs.push({ c: C.d, s: line.slice(i) })
    return segs.length ? segs : [{ c: C.d, s: " " }]
}

export function hlCode(path: string): { n: number; segs: Seg[] }[] {
    const { lang, src } = codeFor(path)
    return src.split("\n").map((l, idx) => ({ n: idx + 1, segs: hlLine(l, lang) }))
}

export function termSegs(str: string): Seg[] {
    if (str.startsWith("❯")) return [{ c: "var(--yz-a8e23f)", w: 700, s: "❯" }, { c: "var(--yz-e6edf3)", w: 600, s: str.slice(1) }]
    if (str.startsWith("●")) return [{ c: "var(--yz-5a6675)", w: 400, s: "●" }, { c: "var(--yz-8b97a7)", w: 400, s: str.slice(1) }]
    if (str.startsWith("◆")) return [{ c: "var(--yz-a8e23f)", w: 400, s: "◆" }, { c: "var(--yz-8b97a7)", w: 400, s: str.slice(1) }]
    if (str.startsWith("✓")) return [{ c: "var(--yz-a8e23f)", w: 600, s: str }]
    if (str.startsWith("✗")) return [{ c: "var(--yz-f07178)", w: 600, s: str }]
    if (str.startsWith("✻")) return [{ c: "var(--yz-c792ea)", w: 600, s: str }]
    if (str.startsWith("$")) return [{ c: "var(--yz-82aaff)", w: 600, s: "$" }, { c: "var(--yz-dbe4ec)", w: 400, s: str.slice(1) }]
    return [{ c: "var(--yz-8b97a7)", w: 400, s: str }]
}

// ---------------------------------------------------------------- misc logic

export function estTokens(src: string): number {
    return Math.ceil(src.length / 3.7)
}

export function fmtK(n: number): string {
    return n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n)
}

export function ctxPct(tokens: number): string {
    const v = (tokens / 200000) * 100
    return v < 0.1 ? "<0.1" : v.toFixed(1)
}

export function sizeLabel(bytes: number | null | undefined): string {
    if (bytes == null) return "—"
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + "M"
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + "K"
    return bytes + "B"
}

const LANG_LABELS: Record<string, string> = {
    rust: "Rust",
    ts: "TypeScript",
    js: "JavaScript",
    json: "JSON",
    py: "Python",
    html: "HTML",
    sql: "SQL",
    css: "CSS",
    sh: "Shell",
    md: "Plain Text",
}

export function langLabel(lang: string | undefined): string {
    return LANG_LABELS[lang ?? ""] ?? "Plain Text"
}

export function buildSelect(table: string, limit: number): string {
    return "SELECT * FROM " + table + " LIMIT " + limit + ";"
}

export function azColsForWidth(width: number): number {
    if (!width) return 2
    if (width >= 3200) return 4
    if (width >= 2000) return 3
    if (width >= 760) return 2
    return 1
}

export function azAutoCols(sessionCount: number, width: number): number {
    const count = Number.isFinite(sessionCount) ? Math.max(0, Math.floor(sessionCount)) : 0
    const cap = azColsForWidth(width)
    let wanted = 1
    if (count >= 7) wanted = 4
    else if (count >= 5) wanted = 3
    else if (count >= 2) wanted = 2
    return Math.max(1, Math.min(cap, wanted))
}

// Resolve the AgentZone column count: a manual override (2 / 3 / 4) wins,
// otherwise Auto chooses a session-aware grid capped by the canvas width.
export function resolveAzCols(override: number | null, width: number, sessionCount: number): number {
    return override ?? azAutoCols(sessionCount, width)
}

export function agentZoneSplitHandleLeft(width: number, ratio: number): number {
    if (!width) return 0
    const usable = Math.max(1, width - 32 - 14)
    return Math.round(16 + usable * (ratio / 100) + 7)
}

export function execOut(cmd: string, branch: string): string[] {
    if (cmd === "ls") return ["src  public  .env  package.json  README.md  tsconfig.json"]
    if (cmd === "git status") return ["● on branch " + branch + " — working tree clean"]
    if (cmd === "npm run dev") return ["● vite dev server starting…", "✓ ready on :3000 in 312ms"]
    if (cmd.startsWith("claude")) return ["✻ claude code v1.2", "● describe a task — reads, edits and runs against this repo"]
    if (cmd) return ["✗ zsh: command not found: " + cmd.split(" ")[0]]
    return []
}

export type ChipColors = [chip: string, bg: string, fg: string]

export function chipFor(name: string): ChipColors {
    const ext = name.includes(".") ? name.split(".").pop() ?? name : name
    const M: Record<string, ChipColors> = {
        rs: ["rs", "var(--yz-241327)", "var(--yz-ce93d8)"],
        ts: ["ts", "var(--yz-10202e)", "var(--yz-82aaff)"],
        tsx: ["tsx", "var(--yz-10202e)", "var(--yz-82aaff)"],
        mts: ["ts", "var(--yz-10202e)", "var(--yz-82aaff)"],
        cts: ["ts", "var(--yz-10202e)", "var(--yz-82aaff)"],
        js: ["js", "var(--yz-10202e)", "var(--yz-82aaff)"],
        jsx: ["jsx", "var(--yz-10202e)", "var(--yz-82aaff)"],
        mjs: ["js", "var(--yz-10202e)", "var(--yz-82aaff)"],
        cjs: ["js", "var(--yz-10202e)", "var(--yz-82aaff)"],
        html: ["html", "var(--yz-10202e)", "var(--yz-82aaff)"],
        htm: ["html", "var(--yz-10202e)", "var(--yz-82aaff)"],
        sql: ["sql", "var(--yz-15240b)", "var(--yz-9ccc65)"],
        css: ["css", "var(--yz-2a1218)", "var(--yz-f07178)"],
        md: ["md", "var(--yz-1a2230)", "var(--yz-8b97a7)"],
        json: ["{}", "var(--yz-2a2210)", "var(--yz-ffcb6b)"],
        py: ["py", "var(--yz-15240b)", "var(--yz-9ccc65)"],
        pyw: ["py", "var(--yz-15240b)", "var(--yz-9ccc65)"],
        pyi: ["py", "var(--yz-15240b)", "var(--yz-9ccc65)"],
        sh: ["sh", "var(--yz-15240b)", "var(--yz-9ccc65)"],
        yml: ["yml", "var(--yz-221530)", "var(--yz-c792ea)"],
        svg: ["svg", "var(--yz-2a2210)", "var(--yz-ffcb6b)"],
        png: ["img", "var(--yz-221530)", "var(--yz-c792ea)"],
        env: ["env", "var(--yz-1a2230)", "var(--yz-8b97a7)"],
    }
    return M[ext] ?? ["·", "var(--yz-1a2230)", "var(--yz-5a6675)"]
}

export const DIR_CHIP: ChipColors = ["/", "var(--yz-1b2410)", "var(--yz-a8e23f)"]

export function refChipStyle(ref: string): { background: string; border: string; color: string } {
    if (ref === "main" || ref === "origin") {
        return { background: "var(--yz-1b2410)", border: "1px solid var(--yz-45611a)", color: "var(--yz-a8e23f)" }
    }
    if (ref.startsWith("v")) {
        return { background: "var(--yz-2a2210)", border: "1px solid var(--yz-6b5a22)", color: "var(--yz-ffcb6b)" }
    }
    return { background: "var(--yz-10202e)", border: "1px solid var(--yz-274968)", color: "var(--yz-82aaff)" }
}

export const LANE_COLORS = ["var(--yz-a8e23f)", "var(--yz-82aaff)", "var(--yz-f78c6c)"]

export type CommitFile = { path: string; st: "M" | "A" | "D"; add: number; del: number }

export function commitFiles(pid: string, c: GitCommit): CommitFile[] {
    const pools: Record<string, string[]> = {
        api: ["src/routes/users.ts", "src/server.ts", "src/db/pool.ts", "src/db/schema.sql", "tests/users.pagination.test.ts", "package.json"],
        web: ["src/components/Hero.tsx", "src/styles/hero.css", "src/index.tsx", "src/components/Nav.tsx", "package.json"],
        edge: ["scripts/deploy.sh", "scripts/rollback.sh", "ansible/playbook.yml", "Caddyfile"],
    }
    const pool = pools[pid] ?? pools.api
    const seed = c.h.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0)
    const n = 1 + (seed % 3)
    const out: CommitFile[] = []
    for (let k = 0; k < n; k++) {
        const path = pool[(seed + k * 3) % pool.length]
        if (out.find((f) => f.path === path)) continue
        const st = k === n - 1 && seed % 4 === 1 ? "A" : "M"
        out.push({ path, st, add: 2 + (seed * (k + 3)) % 96, del: st === "A" ? 0 : (seed * (k + 7)) % 34 })
    }
    return out
}

export function blameLineMap(file: GitBlameFile | undefined | null): Record<number, { short: string; author: string }> {
    const map: Record<number, { short: string; author: string }> = {}
    if (!file) return map
    file.segments.forEach((segment) => {
        for (let line = segment.line_start; line < segment.line_start + segment.line_count; line += 1) {
            map[line] = { short: segment.short_hash, author: segment.author }
        }
    })
    return map
}

export type LspSeverity = "error" | "warning" | "info" | "hint"

export function normSeverity(severity: string): LspSeverity {
    const value = severity.toLowerCase()
    if (value === "error") return "error"
    if (value === "warning") return "warning"
    if (value === "information" || value === "info") return "info"
    return "hint"
}

export function diagBadge(map: Record<string, LspDiagnostic[]>): string | null {
    const count = Object.values(map).reduce((sum, rows) => sum + rows.length, 0)
    return count > 0 ? String(count) : null
}

const DIAG_RANK: Record<LspSeverity, number> = {
    error: 4,
    warning: 3,
    info: 2,
    hint: 1,
}

export function diagLineSeverity(diags: LspDiagnostic[]): Map<number, LspSeverity> {
    const byLine = new Map<number, LspSeverity>()
    for (const diag of diags) {
        const line = diag.range.start_line + 1
        const severity = normSeverity(diag.severity)
        const current = byLine.get(line)
        if (!current || DIAG_RANK[severity] > DIAG_RANK[current]) {
            byLine.set(line, severity)
        }
    }
    return byLine
}

export type DiffLine = { t: "h" | "x" | "a" | "d"; s: string }

export function buildDiff(c: GitCommit): DiffLine[] {
    return [
        { t: "h", s: "@@ -24,6 +24,9 @@" },
        { t: "x", s: "export async function handler(req, res) {" },
        { t: "x", s: "  const input = parse(req);" },
        { t: "d", s: "  const result = await run(input);" },
        { t: "a", s: "  // " + c.m },
        { t: "a", s: "  const result = await run(input, { safe: true });" },
        { t: "a", s: '  audit.log("' + c.h + '", result.id);' },
        { t: "x", s: "  res.json(result);" },
        { t: "x", s: "}" },
    ]
}

// ---------------------------------------------------------------- settings

export type SettingRow = {
    k?: string
    label: string
    desc: string
    toggle?: boolean
    choice?: string[]
    def?: string | boolean
    info?: string
}

export type SettingSection = {
    id: string
    label: string
    glyph: string
    desc: string
    rows: SettingRow[]
    custom?: "performance" | "diagnostics" | "recovery" | "language"
}

export const SETTINGS_CONFIG: SettingSection[] = [
    { id: "general", label: "General", glyph: "⚙", desc: "Appearance and workspace behaviour.", rows: [
        { k: "theme", label: "Theme", desc: "Interface color scheme — also on the ◐ title-bar button", choice: ["dark", "light"], def: "dark" },
        { k: "palette", label: "Accent palette", desc: "Yuzu green or XDS terracotta accent", choice: ["yuzu", "terracotta"], def: "yuzu" },
        { k: "density", label: "UI density", desc: "Row heights and paddings across panels", choice: ["comfortable", "compact"], def: "comfortable" },
        { k: "lang", label: "Language", desc: "IDE display language", choice: ["English", "繁體中文"], def: "English" },
        { k: "restore", label: "Restore tabs on launch", desc: "Reopen each project exactly as you left it", toggle: true, def: true },
    ] },
    { id: "editor", label: "Editor", glyph: "⌸", desc: "Text editing and file display.", rows: [
        { k: "fontSize", label: "Font size", desc: "Editor and terminal type size", choice: ["12", "13", "14", "16"], def: "13" },
        { k: "tabSize", label: "Indentation", desc: "Spaces inserted per tab", choice: ["2", "4"], def: "2" },
        { k: "formatSave", label: "Format on save", desc: "Run the formatter before writing to disk", toggle: true, def: true },
        { k: "autosave", label: "Autosave", desc: "When edits are written automatically", choice: ["off", "focus", "delay"], def: "focus" },
        { k: "tokenChip", label: "Show token estimate", desc: "Σ chip in the editor header — cost of sending the file to Claude", toggle: true, def: true },
    ] },
    { id: "terminal", label: "Terminal", glyph: "❯", desc: "Shell sessions in tabs and AgentZone.", rows: [
        { k: "shell", label: "Default shell", desc: "Used for new CMD tabs", choice: ["zsh", "bash", "fish"], def: "zsh" },
        { k: "blink", label: "Cursor blink", desc: "Blinking block cursor", toggle: true, def: true },
        { k: "scrollback", label: "Scrollback", desc: "Lines kept per session", choice: ["1K", "5K", "10K"], def: "5K" },
    ] },
    { id: "agents", label: "AI · Agents", glyph: "✦", desc: "Claude Code sessions in AgentZone.", rows: [
        { k: "model", label: "Model", desc: "Default model for new sessions", choice: ["sonnet", "opus", "haiku"], def: "sonnet" },
        { k: "maxSessions", label: "Max parallel sessions", desc: "Per project, across all grids", choice: ["2", "4", "6", "8"], def: "4" },
        { k: "budget", label: "Token budget / session", desc: "Soft cap before the session asks to continue", choice: ["50K", "100K", "200K"], def: "100K" },
        { k: "autoApprove", label: "Auto-approve file edits", desc: "Let agents write without confirmation", toggle: true, def: false },
        { k: "autoTest", label: "Auto-run tests after edits", desc: "Run the project test task when an agent finishes", toggle: true, def: true },
    ] },
    { id: "connections", label: "Connections", glyph: "⇅", desc: "SSH, SFTP and database defaults.", rows: [
        { k: "conflict", label: "SFTP conflict policy", desc: "When a pasted file already exists", choice: ["ask", "overwrite", "rename"], def: "ask" },
        { k: "keepAlive", label: "SSH keep-alive", desc: "Send keep-alive packets every 30s", toggle: true, def: true },
        { k: "rowLimit", label: "Query row limit", desc: "Default LIMIT for new SQL queries", choice: ["100", "500", "1K"], def: "500" },
        { k: "maskSecrets", label: "Mask secrets in logs", desc: "Hide .env values in terminals and diffs", toggle: true, def: true },
    ] },
    { id: "shortcuts", label: "Shortcuts", glyph: "⌘", desc: "Default key bindings.", rows: [
        { label: "Command palette", desc: "Search files or run a command", info: "⌘K" },
        { label: "New terminal", desc: "Opens in the current project", info: "⌃`" },
        { label: "New browser tab", desc: "Preview a localhost URL", info: "⌘⇧B" },
        { label: "Toggle split editor", desc: "Second editor group on the right", info: "⌘\\" },
        { label: "Exit focus / close menu", desc: "AgentZone focus, palette, menus", info: "Esc" },
        { label: "SFTP copy / paste", desc: "Transfer the selected file", info: "⌘C · ⌘V" },
    ] },
    { id: "language", label: "Language Servers", glyph: "◇", desc: "Language servers, diagnostics and logs for the active workspace.", rows: [], custom: "language" },
    { id: "performance", label: "Performance", glyph: "◷", desc: "Live process metrics — memory, uptime and index sizes.", rows: [], custom: "performance" },
    { id: "diagnostics", label: "Diagnostics", glyph: "◉", desc: "Recent IDE action log written by the backend.", rows: [], custom: "diagnostics" },
    { id: "recovery", label: "Recovery", glyph: "↺", desc: "Unsaved edits backed up automatically.", rows: [], custom: "recovery" },
]

export function settingDefault(key: string): string | boolean | null {
    for (const sec of SETTINGS_CONFIG) {
        for (const row of sec.rows) {
            if (row.k === key) return row.def ?? null
        }
    }
    return null
}

export function fmtBytes(bytes: number | null): string {
    if (bytes == null) return "—"
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
    const units = ["B", "KB", "MB", "GB", "TB"]
    let value = bytes
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024
        unitIndex += 1
    }
    return unitIndex === 0 ? `${Math.round(value)} ${units[unitIndex]}` : `${value.toFixed(1)} ${units[unitIndex]}`
}

export function fmtUptime(uptimeMs: number): string {
    if (!Number.isFinite(uptimeMs) || uptimeMs <= 0) return "0s"
    const totalSeconds = Math.floor(uptimeMs / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) return `${hours}h ${minutes}m`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
}

export function diagLevelStyle(level: DiagEvent["level"]): { color: string; bg: string } {
    if (level === "error") return { color: "var(--yz-f07178)", bg: "var(--yz-241327)" }
    if (level === "warn") return { color: "var(--yz-ffcb6b)", bg: "var(--yz-2a2210)" }
    if (level === "info") return { color: "var(--yz-82aaff)", bg: "var(--yz-10202e)" }
    return { color: "var(--yz-5a6675)", bg: "var(--yz-11161f)" }
}

export function tsLabel(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "pending"
    return new Date(ms).toLocaleTimeString()
}

export function fmtBackupSize(len: number): string {
    return `${len.toLocaleString()} bytes`
}

// ---------------------------------------------------------------- palette

export type PaletteFile = { name: string; path: string }

export function flattenTree(nodes: TreeNode[], base = ""): PaletteFile[] {
    const out: PaletteFile[] = []
    for (const node of nodes) {
        const path = base ? base + "/" + node.n : node.n
        if (node.d) out.push(...flattenTree(node.d, path))
        else out.push({ name: node.n, path })
    }
    return out
}

export function filterPaletteFiles(nodes: TreeNode[], query: string): PaletteFile[] {
    const ql = query.toLowerCase()
    return flattenTree(nodes)
        .filter((f) => !ql || f.name.toLowerCase().includes(ql) || f.path.toLowerCase().includes(ql))
        .slice(0, 5)
}

export type PaletteCommand = { glyph: string; label: string; kbd: string; action: string }

export const PALETTE_COMMANDS: PaletteCommand[] = [
    { glyph: "◫", label: "View: Toggle Split Editor", kbd: "⌘\\", action: "split" },
    { glyph: "⎇", label: "Git: Open Commit Graph", kbd: "", action: "git" },
    { glyph: "⛁", label: "Database: New Query", kbd: "⌘Q", action: "query" },
    { glyph: "❯", label: "Terminal: New", kbd: "⌃`", action: "term" },
    { glyph: "◉", label: "Browser: New Tab", kbd: "⌘⇧B", action: "browser" },
    { glyph: "✦", label: "AgentZone: New Session", kbd: "", action: "agent" },
]

export function filterPaletteCommands(query: string): PaletteCommand[] {
    const ql = query.toLowerCase()
    return PALETTE_COMMANDS.filter((c) => !ql || c.label.toLowerCase().includes(ql))
}
