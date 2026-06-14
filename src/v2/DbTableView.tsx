import { hlLine } from "./v2-model"
import type { DbCol, Tab } from "./v2-model"
import { Segs } from "./ContentViews"
import { useV2Store } from "./v2-store"

const COL_DEFS: [string, string, string, string, string][] = [
    ["id", "int4", "not null", "nextval(seq)", "PK"],
    ["name", "text", "not null", "—", ""],
    ["email", "text", "not null", "—", "UQ"],
    ["role", "text", "not null", "'member'", "IX"],
    ["created_at", "timestamptz", "not null", "now()", ""],
]

const KEY_STYLE: Record<string, React.CSSProperties> = {
    PK: { background: "var(--yz-2a2210)", border: "1px solid var(--yz-6b5a22)", color: "var(--yz-ffcb6b)" },
    UQ: { background: "var(--yz-10202e)", border: "1px solid var(--yz-274968)", color: "var(--yz-82aaff)" },
    IX: { background: "var(--yz-1b2410)", border: "1px solid var(--yz-45611a)", color: "var(--yz-a8e23f)" },
}

const DATA: [string, string, string, string][] = [
    ["1042", "Mina Okada", "mina@yuuzu.dev", "2026-05-31 09:14"],
    ["1038", "Theo Brandt", "theo@yuuzu.dev", "2026-05-28 17:02"],
    ["1021", "Priya Nair", "priya@yuuzu.dev", "2026-05-20 11:48"],
    ["0994", "Lukas Vogel", "lukas@yuuzu.dev", "2026-05-12 08:33"],
    ["0982", "Sora Tanaka", "sora@yuuzu.dev", "2026-05-09 22:10"],
    ["0961", "Elena Rossi", "elena@yuuzu.dev", "2026-04-30 14:55"],
    ["0950", "Omar Haddad", "omar@yuuzu.dev", "2026-04-22 19:27"],
    ["0944", "Ada Eze", "ada@yuuzu.dev", "2026-04-18 10:05"],
]

const GRID_COLS = "44px 72px 1fr 1.4fr 100px 150px"
const STRUCT_COLS = "44px 1.2fr 1fr 0.9fr 1.1fr 76px"
const HIST_COLS = "44px minmax(220px, 1fr) 100px 92px 92px"

function DbKindChip({ kind }: { kind: "Read" | "Mutation" | "Destructive" }) {
    if (kind === "Read") return null
    return <span className={"yz2-db-kind is-" + kind.toLowerCase()}>{kind}</span>
}

function RealGrid({ tab }: { tab: Tab }) {
    const grid = tab.grid
    if (!grid || grid.running) {
        return <div className="yz2-ed-loading">{grid?.running ? "Running query…" : "No result yet — hit ▶ Run."}</div>
    }
    if (grid.error) {
        return (
            <div className="yz2-db-error">
                <div style={{ fontWeight: 700, marginBottom: 6 }}>✗ query failed</div>
                <div>{grid.error}</div>
            </div>
        )
    }
    if (!grid.cols.length) {
        return (
            <div className="yz2-ed-loading">
                ✓ statement ran in {grid.ms} ms
                {grid.affected != null ? " — " + grid.affected + " rows affected" : ""}
            </div>
        )
    }
    const template = "44px repeat(" + grid.cols.length + ", minmax(110px, 1fr))"
    return (
        <div style={{ flex: 1, overflow: "auto" }}>
            <div className="yz2-grid-head" style={{ gridTemplateColumns: template, minWidth: "max-content" }}>
                <span className="idx">#</span>
                {grid.cols.map((c) => (
                    <span key={c}>{c}</span>
                ))}
            </div>
            {grid.rows.map((row, i) => (
                <div key={i} className="yz2-grid-row" style={{ gridTemplateColumns: template, minWidth: "max-content" }}>
                    <span className="idx">{i + 1}</span>
                    {row.map((cell, j) => (
                        <span key={j} className={cell === "NULL" ? "dim" : undefined} title={cell}>
                            {cell}
                        </span>
                    ))}
                </div>
            ))}
            {!grid.rows.length ? <div className="yz2-panel-note" style={{ margin: 10 }}>0 rows</div> : null}
        </div>
    )
}

function RealStructure({ cols }: { cols: DbCol[] }) {
    if (!cols.length) {
        return <div className="yz2-ed-loading">No column metadata — refresh the connection in the side panel.</div>
    }
    return (
        <div style={{ flex: 1, overflow: "auto" }}>
            <div className="yz2-grid-head" style={{ gridTemplateColumns: STRUCT_COLS }}>
                <span className="idx">#</span>
                <span>column</span>
                <span>type</span>
                <span>nullable</span>
                <span>default</span>
                <span>key</span>
            </div>
            {cols.map((c, i) => (
                <div key={c.name} className="yz2-grid-row" style={{ gridTemplateColumns: STRUCT_COLS }}>
                    <span className="idx">{i + 1}</span>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    <span style={{ color: "var(--yz-c792ea)" }}>{c.type}</span>
                    <span className="dim" style={{ fontSize: 11 }}>{c.nullable ? "nullable" : "not null"}</span>
                    <span style={{ fontSize: 11, color: "var(--yz-5a6675)" }}>—</span>
                    <span>{c.pk ? <span className="yz2-key-badge" style={KEY_STYLE.PK}>PK</span> : null}</span>
                </div>
            ))}
        </div>
    )
}

export function DbTableView({ tab }: { tab: Tab }) {
    const isReal = useV2Store((s) => s.mode === "real") && !!tab.profileId
    const setDbView = useV2Store((s) => s.setDbView)
    const setDbSql = useV2Store((s) => s.setDbSql)
    const loadDbHistory = useV2Store((s) => s.loadDbHistory)
    const runDbQuery = useV2Store((s) => s.runDbQuery)
    const exportDbResult = useV2Store((s) => s.exportDbResult)
    const realCols = useV2Store((s) => {
        const conn = s.ui[s.active].dbConns.find((c) => c.name === tab.conn)
        return conn?.tables.find((t) => t.n === tab.table)?.cols ?? null
    })
    const view = tab.view ?? "data"
    const sql = tab.sql ?? "SELECT id, name, email, role\nFROM " + (tab.table ?? "users") + "\nWHERE role = 'admin'\nORDER BY created_at DESC\nLIMIT 8;"

    return (
        <div className="yz2-view" key={tab.id}>
            <div className="yz2-db-head">
                <span style={{ color: "var(--yz-9ccc65)" }}>⛁</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{tab.conn} / {tab.table}</span>
                <span className="yz2-engine-chip">{tab.engine}</span>
                <span className="yz2-seg-group">
                    {([["data", "Data"], ["structure", "Structure"], ["sql", "SQL"], ["history", "History"]] as const).map(([v, label]) => (
                        <button
                            type="button"
                            key={v}
                            className={"yz2-seg" + (view === v ? " is-on" : "")}
                            onClick={() => {
                                setDbView(tab.id, v)
                                if (v === "history") loadDbHistory(tab.id)
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </span>
                <span className="yz2-spacer" />
                {tab.grid?.kind ? <DbKindChip kind={tab.grid.kind} /> : null}
                <button type="button" className="yz2-run-btn" onClick={() => runDbQuery(tab.id)}>
                    ▶ Run ⌘⏎
                </button>
                <button type="button" className="yz2-export-btn" onClick={() => exportDbResult(tab.id)}>
                    Export
                </button>
            </div>

            {view === "sql" ? (
                isReal ? (
                    <div className="yz2-sql-edit">
                        <textarea
                            className="yz2-sql-input"
                            value={sql}
                            spellCheck={false}
                            placeholder="SELECT * FROM …"
                            onChange={(e) => setDbSql(tab.id, e.target.value)}
                            onKeyDown={(e) => {
                                e.stopPropagation()
                                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                    e.preventDefault()
                                    runDbQuery(tab.id)
                                }
                            }}
                        />
                        <div className="yz2-sql-result">
                            <RealGrid tab={tab} />
                        </div>
                    </div>
                ) : (
                    <div className="yz2-sql-block">
                        {sql.split("\n").map((l, i) => (
                            <div key={i} className="yz2-sql-line">
                                <span className="ln">{i + 1}</span>
                                <span className="cd">
                                    <Segs segs={hlLine(l, "sql")} />
                                </span>
                            </div>
                        ))}
                    </div>
                )
            ) : null}

            {view === "history" ? (
                <div className="yz2-db-history">
                    {tab.historyLoading ? (
                        <div className="yz2-ed-loading">Loading query history…</div>
                    ) : (tab.history ?? []).length ? (
                        <>
                            <div className="yz2-grid-head" style={{ gridTemplateColumns: HIST_COLS }}>
                                <span className="idx">#</span>
                                <span>sql</span>
                                <span>kind</span>
                                <span>when</span>
                                <span>rows</span>
                            </div>
                            {(tab.history ?? []).map((row, i) => (
                                <div key={i} className="yz2-grid-row yz2-db-hist-row" style={{ gridTemplateColumns: HIST_COLS }}>
                                    <span className="idx">{i + 1}</span>
                                    <span className="yz2-ellipsis" title={row.sql}>{row.sql}</span>
                                    <span>{row.kind === "Read" ? <span className="yz2-db-kind is-read">Read</span> : <DbKindChip kind={row.kind} />}</span>
                                    <span className="dim">{row.when}</span>
                                    <span className="dim">{row.rows}</span>
                                </div>
                            ))}
                        </>
                    ) : (
                        <div className="yz2-ed-loading">No query history yet.</div>
                    )}
                </div>
            ) : null}

            {view === "structure" ? (
                isReal ? (
                    <RealStructure cols={realCols ?? []} />
                ) : (
                    <div style={{ flex: 1, overflow: "auto" }}>
                        <div className="yz2-grid-head" style={{ gridTemplateColumns: STRUCT_COLS }}>
                            <span className="idx">#</span>
                            <span>column</span>
                            <span>type</span>
                            <span>nullable</span>
                            <span>default</span>
                            <span>key</span>
                        </div>
                        {COL_DEFS.map((c, i) => (
                            <div key={c[0]} className="yz2-grid-row" style={{ gridTemplateColumns: STRUCT_COLS }}>
                                <span className="idx">{i + 1}</span>
                                <span style={{ fontWeight: 600 }}>{c[0]}</span>
                                <span style={{ color: "var(--yz-c792ea)" }}>{c[1]}</span>
                                <span className="dim" style={{ fontSize: 11 }}>{c[2]}</span>
                                <span style={{ fontSize: 11, color: "var(--yz-5a6675)" }}>{c[3]}</span>
                                <span>{c[4] ? <span className="yz2-key-badge" style={KEY_STYLE[c[4]]}>{c[4]}</span> : null}</span>
                            </div>
                        ))}
                    </div>
                )
            ) : null}

            {view === "data" ? (
                isReal ? (
                    <>
                        <div className="yz2-db-meta">
                            {tab.grid && !tab.grid.running && !tab.grid.error ? (
                                <>
                                    <span style={{ color: "var(--yz-a8e23f)", fontWeight: 600 }}>{tab.grid.rows.length} rows</span>
                                    <span>· {tab.grid.ms} ms</span>
                                    {tab.grid.truncated ? <span style={{ color: "var(--yz-ffcb6b)" }}>· truncated at limit</span> : null}
                                </>
                            ) : (
                                <span style={{ color: "var(--yz-5a6675)" }}>{tab.grid?.running ? "running…" : "no result"}</span>
                            )}
                        </div>
                        <RealGrid tab={tab} />
                        <div className="yz2-db-foot">
                            <span className="yz2-ellipsis" style={{ color: "var(--yz-5a6675)" }}>{tab.sql}</span>
                            <span className="yz2-spacer" />
                            <span>{tab.grid && !tab.grid.error ? tab.grid.rows.length + " shown · " + (tab.count ?? (tab.grid.rows.length + " (shown)")) + " total" : ""}</span>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="yz2-db-meta">
                            <span style={{ color: "var(--yz-a8e23f)", fontWeight: 600 }}>8 rows</span>
                            <span>· 14 ms</span>
                            <span style={{ border: "1px solid var(--yz-2b3547)", borderRadius: 10, padding: "1px 8px", color: "var(--yz-5a6675)" }}>
                                ⚲ No filter
                            </span>
                        </div>
                        <div style={{ flex: 1, overflow: "auto" }}>
                            <div className="yz2-grid-head" style={{ gridTemplateColumns: GRID_COLS }}>
                                <span className="idx">#</span>
                                <span>id</span>
                                <span>name</span>
                                <span>email</span>
                                <span>role</span>
                                <span>created_at</span>
                            </div>
                            {DATA.map((r, i) => (
                                <div key={r[0]} className="yz2-grid-row" style={{ gridTemplateColumns: GRID_COLS }}>
                                    <span className="idx">{i + 1}</span>
                                    <span className="dim">{r[0]}</span>
                                    <span>{r[1]}</span>
                                    <span className="dim">{r[2]}</span>
                                    <span><span className="yz2-role-pill">● admin</span></span>
                                    <span className="dim">{r[3]}</span>
                                </div>
                            ))}
                        </div>
                        <div className="yz2-db-foot">
                            <span className="pg">‹</span>
                            <span style={{ color: "var(--yz-8b97a7)" }}>page 1</span>
                            <span className="pg">›</span>
                            <span>· 50 rows / page</span>
                            <span className="yz2-spacer" />
                            <span>8 shown · {tab.count ?? "—"} total · 14 ms</span>
                        </div>
                    </>
                )
            ) : null}
        </div>
    )
}
