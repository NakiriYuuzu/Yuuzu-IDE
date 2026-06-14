/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import {
    azColsForWidth,
    blameLineMap,
    buildSelect,
    chipFor,
    commitFiles,
    ctxPct,
    diagBadge,
    diagLineSeverity,
    diagLevelStyle,
    estTokens,
    execOut,
    filterPaletteCommands,
    filterPaletteFiles,
    flattenTree,
    fmtBackupSize,
    fmtBytes,
    fmtK,
    fmtUptime,
    gitFor,
    hlLine,
    langLabel,
    normSeverity,
    refChipStyle,
    resolveAzCols,
    SETTINGS_CONFIG,
    sizeLabel,
    tsLabel,
    termSegs,
    treeFor,
} from "./v2-model"

describe("token estimation", () => {
    test("estimates tokens at ~3.7 chars per token", () => {
        expect(estTokens("a".repeat(37))).toBe(10)
        expect(estTokens("abc")).toBe(1)
    })

    test("formats thousands with K suffix", () => {
        expect(fmtK(999)).toBe("999")
        expect(fmtK(1500)).toBe("1.5K")
    })

    test("reports context percentage of the 200K window", () => {
        expect(ctxPct(100)).toBe("<0.1")
        expect(ctxPct(2000)).toBe("1.0")
        expect(ctxPct(50000)).toBe("25.0")
    })
})

describe("azColsForWidth", () => {
    test("matches the design breakpoints (1 / 2 / 3 / 4 columns)", () => {
        expect(azColsForWidth(0)).toBe(2)
        expect(azColsForWidth(500)).toBe(1)
        expect(azColsForWidth(760)).toBe(2)
        expect(azColsForWidth(1999)).toBe(2)
        expect(azColsForWidth(2000)).toBe(3)
        expect(azColsForWidth(3199)).toBe(3)
        expect(azColsForWidth(3200)).toBe(4)
    })
})

describe("resolveAzCols", () => {
    test("null override falls back to width-based auto columns", () => {
        expect(resolveAzCols(null, 0)).toBe(2)
        expect(resolveAzCols(null, 500)).toBe(1)
        expect(resolveAzCols(null, 2000)).toBe(3)
        expect(resolveAzCols(null, 3200)).toBe(4)
    })

    test("a manual override wins over the auto breakpoint", () => {
        expect(resolveAzCols(2, 3200)).toBe(2)
        expect(resolveAzCols(3, 500)).toBe(3)
        expect(resolveAzCols(4, 0)).toBe(4)
    })
})

describe("hlLine", () => {
    test("highlights whole-line comments", () => {
        const segs = hlLine("// just a comment", "ts")
        expect(segs).toHaveLength(1)
        expect(segs[0].s).toBe("// just a comment")
        expect(segs[0].c).toBe("var(--yz-syntax-comment)")
    })

    test("splits trailing ts comments off highlighted code", () => {
        const segs = hlLine("const a = 1; // note", "ts")
        expect(segs[segs.length - 1].s).toBe("// note")
        expect(segs.some((sg) => sg.s === "const")).toBe(true)
    })

    test("colors keywords, strings and numbers distinctly", () => {
        const segs = hlLine('import x from "mod";', "ts")
        const kw = segs.find((sg) => sg.s === "import")
        const str = segs.find((sg) => sg.s === '"mod"')
        expect(kw?.c).toBe("var(--yz-syntax-keyword)")
        expect(str?.c).toBe("var(--yz-syntax-string)")
        const num = hlLine("let n = 42", "ts").find((sg) => sg.s === "42")
        expect(num?.c).toBe("var(--yz-syntax-number)")
    })

    test("treats call sites as function color", () => {
        const segs = hlLine("main();", "ts")
        const fn = segs.find((sg) => sg.s === "main")
        expect(fn?.c).toBe("var(--yz-syntax-function)")
    })

    test("uses the same semantic syntax tokens across supported languages", () => {
        expect(hlLine("fn main() {", "rust").find((sg) => sg.s === "fn")?.c).toBe("var(--yz-syntax-keyword)")
        expect(hlLine("pub struct User {", "rust").find((sg) => sg.s === "User")?.c).toBe("var(--yz-syntax-type)")
        expect(hlLine("def main():", "py").find((sg) => sg.s === "def")?.c).toBe("var(--yz-syntax-keyword)")
        expect(hlLine("class User:", "py").find((sg) => sg.s === "User")?.c).toBe("var(--yz-syntax-type)")
        expect(hlLine("export function main() {", "js").find((sg) => sg.s === "function")?.c).toBe("var(--yz-syntax-keyword)")
        expect(hlLine('{ "name": "yuuzu" }', "json").find((sg) => sg.s === '"name"')?.c).toBe("var(--yz-syntax-attribute)")
        expect(hlLine("<section class=\"hero\">", "html").find((sg) => sg.s === "section")?.c).toBe("var(--yz-syntax-tag)")
        expect(hlLine(".hero { color: red; }", "css").find((sg) => sg.s === "color")?.c).toBe("var(--yz-syntax-attribute)")
        expect(hlLine("SELECT id FROM users", "sql").find((sg) => sg.s === "SELECT")?.c).toBe("var(--yz-syntax-keyword)")
        expect(hlLine("#!/usr/bin/env bash", "sh")[0].c).toBe("var(--yz-syntax-comment)")
    })
})

describe("syntax theme tokens", () => {
    test("defines visibly distinct GitHub-style syntax variables for dark and light themes", () => {
        const css = readFileSync(new URL("./yuzu.css", import.meta.url), "utf8")
        const darkSyntax = {
            default: "#f0f6fc",
            keyword: "#ff7b72",
            string: "#a5d6ff",
            number: "#79c0ff",
            function: "#d2a8ff",
            type: "#d2a8ff",
            variable: "#ffa657",
            comment: "#9198a1",
            operator: "#9198a1",
            tag: "#7ee787",
            attribute: "#d2a8ff",
            punctuation: "#9198a1",
        }
        const lightSyntax = {
            default: "#25292e",
            keyword: "#cf222e",
            string: "#0a3069",
            number: "#0550ae",
            function: "#6639ba",
            type: "#6639ba",
            variable: "#953800",
            comment: "#59636e",
            operator: "#59636e",
            tag: "#0550ae",
            attribute: "#6639ba",
            punctuation: "#59636e",
        }
        const lightBlockStart = css.indexOf(':root[data-yz-theme="light"]')
        const lightBlockEnd = css.indexOf("\n}\n\n@keyframes", lightBlockStart)
        const lightBlock = css.slice(lightBlockStart, lightBlockEnd)

        for (const [name, value] of Object.entries(darkSyntax)) {
            expect(css).toContain(`--yz-syntax-${name}: ${value};`)
        }
        for (const [name, value] of Object.entries(lightSyntax)) {
            expect(lightBlock).toContain(`--yz-syntax-${name}: ${value};`)
        }
    })
})

describe("termSegs", () => {
    test("colors the prompt and success/error markers", () => {
        expect(termSegs("❯ ls")[0].c).toBe("var(--yz-a8e23f)")
        expect(termSegs("✓ done")[0].c).toBe("var(--yz-a8e23f)")
        expect(termSegs("✗ fail")[0].c).toBe("var(--yz-f07178)")
        expect(termSegs("$ npm run build")[0].c).toBe("var(--yz-82aaff)")
        expect(termSegs("plain")[0].c).toBe("var(--yz-8b97a7)")
    })
})

describe("execOut", () => {
    test("answers the demo commands", () => {
        expect(execOut("ls", "main")[0]).toContain("src")
        expect(execOut("git status", "feat/x")[0]).toContain("feat/x")
        expect(execOut("claude", "main")[0]).toContain("claude code")
        expect(execOut("nope", "main")[0]).toContain("command not found: nope")
        expect(execOut("", "main")).toHaveLength(0)
    })
})

describe("file chips", () => {
    test("maps known extensions and falls back to a dot", () => {
        expect(chipFor("main.rs")[0]).toBe("rs")
        expect(chipFor("a.ts")[0]).toBe("ts")
        expect(chipFor("a.js")[0]).toBe("js")
        expect(chipFor("script.py")[0]).toBe("py")
        expect(chipFor("a.json")[0]).toBe("{}")
        expect(chipFor("index.html")[0]).toBe("html")
        expect(chipFor("page.htm")[0]).toBe("html")
        expect(chipFor("a.unknown")[0]).toBe("·")
    })
})

describe("git demo data", () => {
    test("clones per call so commits can be mutated safely", () => {
        const a = gitFor("api")
        a.commits[0].m = "mutated"
        expect(gitFor("api").commits[0].m).not.toBe("mutated")
    })

    test("derives changed files deterministically from the hash", () => {
        const c = gitFor("api").commits[0]
        expect(commitFiles("api", c)).toEqual(commitFiles("api", c))
        expect(commitFiles("api", c).length).toBeGreaterThan(0)
    })

    test("styles main/origin refs as accent and tags as yellow", () => {
        expect(refChipStyle("main").color).toBe("var(--yz-a8e23f)")
        expect(refChipStyle("v0.4.2").color).toBe("var(--yz-ffcb6b)")
        expect(refChipStyle("feat/pag").color).toBe("var(--yz-82aaff)")
    })
})

describe("palette", () => {
    test("flattens the tree into files with full paths", () => {
        const files = flattenTree(treeFor("api"))
        expect(files.find((f) => f.path === "src/routes/users.ts")).toBeDefined()
    })

    test("filters files by name or path, capped at five", () => {
        const all = filterPaletteFiles(treeFor("api"), "")
        expect(all).toHaveLength(5)
        const hits = filterPaletteFiles(treeFor("api"), "users")
        expect(hits.every((f) => f.path.toLowerCase().includes("users"))).toBe(true)
    })

    test("filters commands by label", () => {
        const hits = filterPaletteCommands("terminal")
        expect(hits).toHaveLength(1)
        expect(hits[0].action).toBe("term")
        expect(filterPaletteCommands("")).toHaveLength(6)
    })
})

describe("real-wiring helpers", () => {
    test("sizeLabel formats bytes for the sftp panes", () => {
        expect(sizeLabel(null)).toBe("—")
        expect(sizeLabel(512)).toBe("512B")
        expect(sizeLabel(2048)).toBe("2.0K")
        expect(sizeLabel(3 * 1024 * 1024)).toBe("3.0M")
    })

    test("langLabel names the status-bar language", () => {
        expect(langLabel("rust")).toBe("Rust")
        expect(langLabel("ts")).toBe("TypeScript")
        expect(langLabel("js")).toBe("JavaScript")
        expect(langLabel("json")).toBe("JSON")
        expect(langLabel("py")).toBe("Python")
        expect(langLabel("html")).toBe("HTML")
        expect(langLabel("sql")).toBe("SQL")
        expect(langLabel(undefined)).toBe("Plain Text")
    })

    test("buildSelect produces the default table query", () => {
        expect(buildSelect("users", 500)).toBe("SELECT * FROM users LIMIT 500;")
    })
})

describe("blame helpers", () => {
    test("maps multiple blame segments to one entry per line", () => {
        const map = blameLineMap({
            path: "src/app.ts",
            truncated: false,
            segments: [
                { hash: "a".repeat(40), short_hash: "aaaaaaa", author: "mina", when_unix: 1, line_start: 1, line_count: 2 },
                { hash: "b".repeat(40), short_hash: "bbbbbbb", author: "yuuzu", when_unix: 2, line_start: 3, line_count: 1 },
            ],
        })

        expect(map).toEqual({
            1: { short: "aaaaaaa", author: "mina" },
            2: { short: "aaaaaaa", author: "mina" },
            3: { short: "bbbbbbb", author: "yuuzu" },
        })
    })
})

describe("lsp diagnostic helpers", () => {
    const diag = (line: number, severity: string) => ({
        path: "src/app.ts",
        range: { start_line: line, start_character: 0, end_line: line, end_character: 1 },
        severity,
        message: severity,
        source: "tsserver",
    })

    test("normalizes backend and frontend severity values", () => {
        expect(normSeverity("Error")).toBe("error")
        expect(normSeverity("warning")).toBe("warning")
        expect(normSeverity("Information")).toBe("info")
        expect(normSeverity("info")).toBe("info")
        expect(normSeverity("Hint")).toBe("hint")
        expect(normSeverity("Unknown")).toBe("hint")
    })

    test("counts diagnostics for badges", () => {
        expect(diagBadge({})).toBeNull()
        expect(diagBadge({ "src/app.ts": [diag(0, "Error"), diag(1, "Warning")] })).toBe("2")
    })

    test("keeps the highest severity per one-based editor line", () => {
        const map = diagLineSeverity([
            diag(2, "Warning"),
            diag(2, "Error"),
            diag(3, "Information"),
        ])

        expect(map.get(3)).toBe("error")
        expect(map.get(4)).toBe("info")
    })
})

describe("stability helpers", () => {
    test("formats metric and backup values for settings panels", () => {
        expect(fmtBytes(null)).toBe("—")
        expect(fmtBytes(0)).toBe("0 B")
        expect(fmtBytes(1536)).toBe("1.5 KB")
        expect(fmtBytes(184 * 1024 * 1024)).toContain("MB")
        expect(fmtUptime(3_600_000)).toContain("h")
        expect(fmtUptime(65_000)).toContain("m")
        expect(fmtUptime(5_000)).toBe("5s")
        expect(tsLabel(0)).toBe("pending")
        expect(fmtBackupSize(1234)).toContain("1,234")
    })

    test("maps diagnostic levels to existing design tokens", () => {
        expect(diagLevelStyle("error").color).toBe("var(--yz-f07178)")
        expect(diagLevelStyle("warn").color).toBe("var(--yz-ffcb6b)")
        expect(diagLevelStyle("info").color).toBe("var(--yz-82aaff)")
        expect(diagLevelStyle("debug").color).toBe("var(--yz-5a6675)")
    })

    test("registers custom settings sections for stability surfaces", () => {
        expect(SETTINGS_CONFIG.some((section) => section.custom === "performance")).toBe(true)
        expect(SETTINGS_CONFIG.some((section) => section.custom === "diagnostics")).toBe(true)
        expect(SETTINGS_CONFIG.some((section) => section.custom === "recovery")).toBe(true)
    })
})
