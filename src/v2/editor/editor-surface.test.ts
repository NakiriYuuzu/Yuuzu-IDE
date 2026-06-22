import { describe, expect, test } from "bun:test"
import type { LanguageCompletionItem } from "../../features/language/language-model"
import {
    cursorFromOffset,
    localWordCompletions,
    mergeCompletionItems,
    offsetFromCursor,
    shouldAcceptAsyncEditorResult,
} from "./editor-surface"
import { YUZU_CODEMIRROR_HIGHLIGHT_SPECS } from "./CodeMirrorEditorSurface"

describe("editor surface helpers", () => {
    test("converts between offsets and one-based cursor positions", () => {
        const value = "one\ntwo\nthree"
        expect(cursorFromOffset(value, 0)).toEqual({ ln: 1, col: 1 })
        expect(cursorFromOffset(value, 5)).toEqual({ ln: 2, col: 2 })
        expect(offsetFromCursor(value, { ln: 3, col: 3 })).toBe(10)
    })

    test("merges local and LSP completions by label and keeps local fallback first", () => {
        const local: LanguageCompletionItem[] = [
            { label: "Console", detail: "local", insertText: "Console" },
            { label: "class", detail: "snippet", insertText: "class ${Name}" },
        ]
        const lsp: LanguageCompletionItem[] = [
            { label: "Console", detail: "System.Console", insertText: "Console" },
            { label: "CancellationToken", detail: "struct", insertText: "CancellationToken" },
        ]

        expect(mergeCompletionItems(local, lsp).map((item) => item.label)).toEqual([
            "Console",
            "class",
            "CancellationToken",
        ])
    })

    test("rejects stale async editor results", () => {
        expect(shouldAcceptAsyncEditorResult({ requestSeq: 2, currentSeq: 2, requestVersion: 4, currentVersion: 4 })).toBe(true)
        expect(shouldAcceptAsyncEditorResult({ requestSeq: 1, currentSeq: 2, requestVersion: 4, currentVersion: 4 })).toBe(false)
        expect(shouldAcceptAsyncEditorResult({ requestSeq: 2, currentSeq: 2, requestVersion: 3, currentVersion: 4 })).toBe(false)
    })

    test("localWordCompletions returns nearby unique words", () => {
        expect(localWordCompletions("Console Console CancellationToken class", "Con").map((item) => item.label)).toEqual([
            "Console",
        ])
    })

    test("CodeMirror highlight specs use Yuuzu syntax theme variables", () => {
        const colors = YUZU_CODEMIRROR_HIGHLIGHT_SPECS.map((spec) => spec.color)
        expect(colors).toContain("var(--yz-syntax-keyword)")
        expect(colors).toContain("var(--yz-syntax-string)")
        expect(colors).toContain("var(--yz-syntax-comment)")
        expect(colors).not.toContain("defaultHighlightStyle")
    })
})
