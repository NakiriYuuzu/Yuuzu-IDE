import type { Extension } from "@codemirror/state"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { rust } from "@codemirror/lang-rust"
import { xml } from "@codemirror/lang-xml"
import { yaml } from "@codemirror/lang-yaml"

import { csharp } from "./lang-csharp"

export type CodeMirrorLanguageId =
    | "rust"
    | "csharp"
    | "yaml"
    | "markdown"
    | "html"
    | "css"
    | "xml"
    | "json"
    | "javascript"
    | "typescript"
    | "plaintext"

export function codeMirrorLanguageIdForPath(path: string): CodeMirrorLanguageId {
    const lower = path.toLowerCase()
    if (lower.endsWith(".rs")) return "rust"
    if (lower.endsWith(".cs") || lower.endsWith(".csx")) return "csharp"
    if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml"
    if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "markdown"
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html"
    if (lower.endsWith(".css")) return "css"
    if (lower.endsWith(".xml")) return "xml"
    if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "json"
    if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "typescript"
    if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript"
    return "plaintext"
}

export function codeMirrorLanguageForPath(path: string): Extension[] {
    switch (codeMirrorLanguageIdForPath(path)) {
        case "rust":
            return [rust()]
        case "csharp":
            return [csharp()]
        case "yaml":
            return [yaml()]
        case "markdown":
            return [markdown()]
        case "html":
            return [html()]
        case "css":
            return [css()]
        case "xml":
            return [xml()]
        case "json":
            return [json()]
        case "typescript":
            return [javascript({ jsx: path.toLowerCase().endsWith(".tsx"), typescript: true })]
        case "javascript":
            return [javascript({ jsx: path.toLowerCase().endsWith(".jsx") })]
        case "plaintext":
            return []
    }
}
