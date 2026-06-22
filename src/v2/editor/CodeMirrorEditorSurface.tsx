import { autocompletion, startCompletion } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting, type TagStyle } from "@codemirror/language"
import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { tags as t } from "@lezer/highlight"
import { useEffect, useMemo, useRef } from "react"

import { codeMirrorLanguageForPath } from "../../features/editor-codemirror/language-selection"
import { isLspSupportedDocumentPath } from "../../features/language/language-model"
import type { Tab } from "../v2-model"
import { useV2Store } from "../v2-store"
import {
    cursorFromOffset,
    localWordCompletions,
    mergeCompletionItems,
    shouldAcceptAsyncEditorResult,
} from "./editor-surface"

function documentVersion(value: string): number {
    let hash = value.length
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) | 0
    }
    return hash
}

export const YUZU_CODEMIRROR_HIGHLIGHT_SPECS: readonly TagStyle[] = [
    { tag: t.keyword, color: "var(--yz-syntax-keyword)" },
    { tag: [t.string, t.character, t.regexp], color: "var(--yz-syntax-string)" },
    { tag: [t.number, t.integer, t.float, t.bool], color: "var(--yz-syntax-number)" },
    { tag: [t.function(t.variableName), t.definition(t.function(t.variableName))], color: "var(--yz-syntax-function)" },
    { tag: [t.typeName, t.className, t.namespace], color: "var(--yz-syntax-type)" },
    { tag: [t.variableName, t.propertyName], color: "var(--yz-syntax-variable)" },
    { tag: t.comment, color: "var(--yz-syntax-comment)", fontStyle: "italic" },
    { tag: t.operator, color: "var(--yz-syntax-operator)" },
    { tag: t.tagName, color: "var(--yz-syntax-tag)" },
    { tag: t.attributeName, color: "var(--yz-syntax-attribute)" },
    { tag: t.punctuation, color: "var(--yz-syntax-punctuation)" },
    { tag: t.invalid, color: "var(--yz-f07178)" },
]

const yuzuHighlightStyle = HighlightStyle.define(YUZU_CODEMIRROR_HIGHLIGHT_SPECS)

export function CodeMirrorEditorSurface({ tab }: { tab: Tab }) {
    const hostRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const contentRef = useRef(tab.content ?? "")
    const setTabContent = useV2Store((s) => s.setTabContent)
    const saveTab = useV2Store((s) => s.saveTab)
    const setCursor = useV2Store((s) => s.setCursor)
    const completeAt = useV2Store((s) => s.completeAt)
    const tabSize = useV2Store((s) => (s.stVals.tabSize === "4" ? 4 : 2))
    const completionSeq = useRef(0)
    const content = tab.content ?? ""
    const path = tab.path ?? ""

    useEffect(() => {
        contentRef.current = content
    }, [content])

    const extensions = useMemo(() => [
        lineNumbers(),
        history(),
        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(yuzuHighlightStyle, { fallback: true }),
        ...codeMirrorLanguageForPath(path),
        autocompletion({
            override: [
                (context) => {
                    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/)
                    if (!word && !context.explicit) return null
                    const prefix = word?.text ?? ""
                    const local = localWordCompletions(context.state.doc.toString(), prefix)
                    return {
                        from: word?.from ?? context.pos,
                        options: local.map((item) => ({
                            label: item.label,
                            detail: item.detail ?? undefined,
                            apply: item.insertText,
                            type: item.detail === "local" ? "variable" : "keyword",
                        })),
                    }
                },
                async (context) => {
                    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/)
                    if ((!word && !context.explicit) || !isLspSupportedDocumentPath(path)) return null
                    const requestSeq = ++completionSeq.current
                    const source = context.state.doc.toString()
                    const requestVersion = documentVersion(source)
                    const prefix = word?.text ?? ""
                    const cursor = cursorFromOffset(source, context.pos)
                    const lspItems = await completeAt(path, cursor.ln, cursor.col)
                    const view = viewRef.current
                    const currentSource = view?.state.doc.toString() ?? source
                    if (!shouldAcceptAsyncEditorResult({
                        requestSeq,
                        currentSeq: completionSeq.current,
                        requestVersion,
                        currentVersion: documentVersion(currentSource),
                    })) {
                        return null
                    }
                    const local = localWordCompletions(currentSource, prefix)
                    return {
                        from: word?.from ?? context.pos,
                        options: mergeCompletionItems(local, lspItems).map((item) => ({
                            label: item.label,
                            detail: item.detail ?? undefined,
                            apply: item.insertText,
                            type: item.detail === "local" ? "variable" : "keyword",
                        })),
                    }
                },
            ],
        }),
        keymap.of([
            {
                key: "Mod-s",
                run: () => {
                    saveTab(tab.id)
                    return true
                },
            },
            {
                key: "Ctrl-Space",
                run: (view) => {
                    startCompletion(view)
                    return true
                },
            },
            ...defaultKeymap,
            ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                completionSeq.current += 1
                setTabContent(tab.id, update.state.doc.toString())
            }
            if (update.selectionSet || update.docChanged) {
                const offset = update.state.selection.main.head
                setCursor(cursorFromOffset(update.state.doc.toString(), offset))
            }
        }),
        EditorState.tabSize.of(tabSize),
    ], [completeAt, path, saveTab, setCursor, setTabContent, tab.id, tabSize])

    useEffect(() => {
        const host = hostRef.current
        if (!host) return
        const state = EditorState.create({ doc: contentRef.current, extensions })
        const view = new EditorView({ state, parent: host })
        viewRef.current = view
        return () => {
            view.destroy()
            viewRef.current = null
        }
    }, [extensions])

    useEffect(() => {
        const view = viewRef.current
        if (!view) return
        const next = tab.content ?? ""
        const current = view.state.doc.toString()
        if (next === current) return
        view.dispatch({
            changes: { from: 0, to: current.length, insert: next },
            selection: EditorSelection.cursor(Math.min(view.state.selection.main.head, next.length)),
        })
    }, [tab.content])

    return <div className="yz2-cm-host" ref={hostRef} aria-label={"Editor for " + path} />
}
