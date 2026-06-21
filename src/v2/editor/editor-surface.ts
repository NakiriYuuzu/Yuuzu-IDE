import type { LanguageCompletionItem } from "../../features/language/language-model"
import type { Tab } from "../v2-model"

export type EditorCursor = { ln: number; col: number }

export type EditorSurfaceProps = {
    tab: Tab
    content: string
    tabSize: number
    onContentChange: (tabId: number, content: string) => void
    onSave: (tabId: number) => void
    onCursorChange: (cursor: EditorCursor | null) => void
    completeAt: (path: string, line: number, col: number) => Promise<LanguageCompletionItem[]>
    hoverAt: (path: string, line: number, col: number) => Promise<{ contents: string } | null>
    gotoDefinition: (path: string, line: number, col: number) => void
}

export function cursorFromOffset(value: string, offset: number): EditorCursor {
    const clamped = Math.max(0, Math.min(offset, value.length))
    const before = value.slice(0, clamped)
    const lineStart = before.lastIndexOf("\n")
    return {
        ln: before.split("\n").length,
        col: clamped - lineStart,
    }
}

export function offsetFromCursor(value: string, cursor: EditorCursor): number {
    const lines = value.split("\n")
    const lineIndex = Math.max(0, Math.min(cursor.ln - 1, lines.length - 1))
    let offset = 0
    for (let index = 0; index < lineIndex; index += 1) offset += lines[index].length + 1
    return offset + Math.max(0, Math.min(cursor.col - 1, lines[lineIndex].length))
}

export function mergeCompletionItems(
    localItems: LanguageCompletionItem[],
    lspItems: LanguageCompletionItem[],
): LanguageCompletionItem[] {
    const seen = new Set<string>()
    const merged: LanguageCompletionItem[] = []
    for (const item of [...localItems, ...lspItems]) {
        const key = item.label.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(item)
    }
    return merged
}

export function shouldAcceptAsyncEditorResult(args: {
    requestSeq: number
    currentSeq: number
    requestVersion: number
    currentVersion: number
}): boolean {
    return args.requestSeq === args.currentSeq && args.requestVersion === args.currentVersion
}

export function localWordCompletions(content: string, prefix: string): LanguageCompletionItem[] {
    const normalizedPrefix = prefix.toLowerCase()
    if (!normalizedPrefix) return []
    const seen = new Set<string>()
    const result: LanguageCompletionItem[] = []
    for (const match of content.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
        const label = match[0]
        const key = label.toLowerCase()
        if (!key.startsWith(normalizedPrefix) || seen.has(key)) continue
        seen.add(key)
        result.push({ label, detail: "local", insertText: label })
        if (result.length >= 30) break
    }
    return result
}
