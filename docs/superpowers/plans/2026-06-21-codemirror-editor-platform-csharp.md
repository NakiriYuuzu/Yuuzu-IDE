# CodeMirror Editor Platform And C# Syntax Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Yuuzu-IDE's planned editor-platform track to CodeMirror 6 and add a first-party Lezer-based C# syntax package while keeping semantic language intelligence in the existing Rust/Tauri LSP layer.

**Architecture:** Treat CodeMirror as the editor interaction surface, not the language brain. The v2 store and controller remain the source of truth for open documents, dirty state, save behavior, file watcher events, backups, LSP document sync, diagnostics, and completion delegation; CodeMirror surfaces those capabilities through a narrow editor adapter. The handwritten C# Lezer package provides syntax, indentation, folding, comments, brackets, and snippets only; Roslyn or another C# LSP remains responsible for semantic completion and refactoring.

**Tech Stack:** Tauri 2, Vite, React 19, TypeScript 6, Bun, CodeMirror 6, Lezer, existing `src/v2/*` store/controller architecture, existing Rust LSP backend.

---

## Scope Lock

Task class: `feature` plus `ui-runtime`.

In scope:
- Add CodeMirror 6 and Lezer dependencies.
- Create a first-party internal `@yuuzu/codemirror-lang-csharp` implementation under `src/features/editor-codemirror/lang-csharp/`.
- Add a CodeMirror language selection layer for Rust, C#, YAML, Markdown, HTML, CSS, XML, JavaScript, and TypeScript.
- Add an editor adapter boundary so the current textarea engine can remain as a fallback while CodeMirror reaches parity.
- Wire CodeMirror content changes through the existing `useV2Store().setTabContent(...)`, `saveTab(...)`, `completeAt(...)`, `hoverAt(...)`, and navigation actions.
- Preserve the current v2 Yuzu visual design from `docs/ui-design/` and `src/v2/yuzu.css`.
- Preserve Rust/Tauri ownership of document sync, auto-save, file watcher refreshes, LSP open/change/save, diagnostics, and scheduling.
- Add focused Bun tests for the parser, language selection, adapter behavior, completion merging, and dirty/save/external-change state.

Out of scope:
- Replacing Roslyn, OmniSharp, or any C# language server with a homemade C# type checker.
- Recreating IntelliJ PSI, full semantic resolve, project-wide refactoring, or framework inspections.
- Removing the current textarea editor fallback before CodeMirror parity is verified.
- Making Monaco the primary editor direction.
- Completing Node 14 Docs, Debug, Extension, or Language panel port-over work.
- Staging, committing, or pushing without explicit user approval.

Dirty worktree note:
- This repository commonly has user-owned uncommitted changes. Execution must run `git status --short`, read current file contents before each edit, and preserve unrelated changes. At the time this plan was written, `roadmap.md` and many `src/v2/*` files were already dirty.

Execution order:
1. Finish or intentionally pause Node 14 work before enabling CodeMirror by default.
2. Implement this plan behind a fallback flag or internal setting first.
3. Enable CodeMirror by default only after the tests and manual editor parity checks pass.

## File Structure

- `package.json`
  - Add CodeMirror/Lezer packages and a parser-generation script.
- `bun.lock`
  - Updated by `bun add` and `bun install`.
- `src/features/editor-codemirror/lang-csharp/csharp.grammar`
  - Handwritten Lezer grammar for the first C# syntax slice.
- `src/features/editor-codemirror/lang-csharp/parser.js`
  - Generated parser output from Lezer.
- `src/features/editor-codemirror/lang-csharp/parser.d.ts`
  - TypeScript declaration for the generated parser module.
- `src/features/editor-codemirror/lang-csharp/snippets.ts`
  - C# keyword and snippet completions.
- `src/features/editor-codemirror/lang-csharp/index.ts`
  - `csharpLanguage` and `csharp()` `LanguageSupport` entrypoint.
- `src/features/editor-codemirror/lang-csharp/lang-csharp.test.ts`
  - Parser, language data, snippets, incomplete-code, and syntax-tree tests.
- `src/features/editor-codemirror/language-selection.ts`
  - File extension to CodeMirror language support mapping.
- `src/features/editor-codemirror/language-selection.test.ts`
  - Language selection tests for Rust, C#, YAML, Markdown, HTML, CSS, XML, JS, TS, JSX, and TSX.
- `src/v2/editor/editor-surface.ts`
  - Shared editor surface props, cursor types, and completion merge helpers.
- `src/v2/editor/editor-surface.test.ts`
  - Pure tests for cursor conversion, completion merge, stale request checks, and document version checks.
- `src/v2/editor/TextareaEditorSurface.tsx`
  - Current textarea editor behavior moved out of `ContentViews.tsx` as the fallback surface.
- `src/v2/editor/CodeMirrorEditorSurface.tsx`
  - CodeMirror-backed editor surface.
- `src/v2/editor/EditorHost.tsx`
  - Chooses textarea fallback or CodeMirror surface and keeps `ContentViews.tsx` small.
- `src/v2/ContentViews.tsx`
  - Renders `EditorHost` for editable real file tabs.
- `src/v2/ContentViews.test.tsx`
  - Existing completion tests plus CodeMirror host tests.
- `src/v2/v2-model.ts`
  - Optional setting metadata for editor engine selection while CodeMirror is behind a guarded rollout.
- `src/v2/v2-store.ts`
  - Ensure editor changes notify backups, dirty state, auto-save scheduling, and LSP document change scheduling through one path.
- `src/v2/v2-store.test.ts`
  - State tests for dirty state, LSP change scheduling, autosave setting behavior, and external file conflict handling.
- `src/v2/yuzu.css`
  - CodeMirror theme bridge using existing v2 editor variables and syntax colors.

---

### Task 1: Add CodeMirror And Lezer Dependencies

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Install runtime editor packages**

Run:

```bash
bun add @codemirror/state @codemirror/view @codemirror/language @codemirror/commands @codemirror/search @codemirror/autocomplete @codemirror/lang-rust @codemirror/lang-yaml @codemirror/lang-markdown @codemirror/lang-html @codemirror/lang-css @codemirror/lang-xml @codemirror/lang-javascript @lezer/lr
```

Expected: `package.json` and `bun.lock` include the CodeMirror runtime packages.

- [ ] **Step 2: Install the Lezer generator**

Run:

```bash
bun add -d @lezer/generator
```

Expected: `package.json` and `bun.lock` include `@lezer/generator` in dev dependencies.

- [ ] **Step 3: Add the parser generation script**

Add this script entry to `package.json`:

```json
"gen:csharp-parser": "lezer-generator src/features/editor-codemirror/lang-csharp/csharp.grammar -o src/features/editor-codemirror/lang-csharp/parser.js"
```

Expected: the existing scripts stay unchanged, with `gen:csharp-parser` added beside `dev`, `build`, `preview`, and `tauri`.

- [ ] **Step 4: Verify dependency resolution**

Run:

```bash
bun install
bun run build
```

Expected: dependency installation succeeds. `bun run build` may still fail until later tasks create the referenced parser files if the script was added before imports; if it fails, the failure must be limited to missing files introduced by this plan.

---

### Task 2: Create The C# Lezer Grammar Slice

**Files:**
- Create: `src/features/editor-codemirror/lang-csharp/csharp.grammar`
- Create: `src/features/editor-codemirror/lang-csharp/parser.d.ts`
- Generate: `src/features/editor-codemirror/lang-csharp/parser.js`
- Test: `src/features/editor-codemirror/lang-csharp/lang-csharp.test.ts`

- [ ] **Step 1: Write parser tests first**

Create `src/features/editor-codemirror/lang-csharp/lang-csharp.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { parser } from "./parser"

function treeText(source: string): string {
    return parser.parse(source).topNode.toString()
}

describe("csharp lezer parser", () => {
    test("parses common top-level C# declarations", () => {
        const tree = treeText(`
using System;

namespace Demo.App;

[Serializable]
public sealed record User(string Name, int Age);

public interface IRepository<T> {
    T Find(string id);
}

public class Program {
    public static void Main(string[] args) {
        Console.WriteLine($"hello {args.Length}");
    }
}
`)

        expect(tree).toContain("CompilationUnit")
        expect(tree).toContain("UsingDirective")
        expect(tree).toContain("NamespaceDeclaration")
        expect(tree).toContain("RecordDeclaration")
        expect(tree).toContain("InterfaceDeclaration")
        expect(tree).toContain("ClassDeclaration")
        expect(tree).toContain("MethodDeclaration")
        expect(tree).not.toContain("⚠")
    })

    test("keeps a syntax tree for incomplete editing states", () => {
        const tree = treeText(`
public class Draft {
    public string Name { get;
    public void Save(
`)

        expect(tree).toContain("CompilationUnit")
        expect(tree).toContain("ClassDeclaration")
    })
})
```

- [ ] **Step 2: Run the parser test and verify failure**

Run:

```bash
bun test src/features/editor-codemirror/lang-csharp/lang-csharp.test.ts
```

Expected: FAIL because `./parser` does not exist yet.

- [ ] **Step 3: Add the first grammar**

Create `src/features/editor-codemirror/lang-csharp/csharp.grammar`:

```lezer
@top CompilationUnit { Item* }

@skip { whitespace | LineComment | BlockComment }

Item {
  UsingDirective |
  NamespaceDeclaration |
  TypeDeclaration |
  MemberDeclaration |
  Statement |
  PreprocessorDirective
}

UsingDirective { "using" IdentifierPath ";" }

NamespaceDeclaration {
  "namespace" IdentifierPath (";" | Block)
}

TypeDeclaration {
  AttributeList*
  Modifier*
  (ClassDeclaration | InterfaceDeclaration | RecordDeclaration | EnumDeclaration | StructDeclaration)
}

ClassDeclaration { "class" identifier TypeParameters? BaseList? Block }
InterfaceDeclaration { "interface" identifier TypeParameters? BaseList? Block }
RecordDeclaration { "record" ("class" | "struct")? identifier TypeParameters? PrimaryConstructor? BaseList? (";" | Block) }
StructDeclaration { "struct" identifier TypeParameters? BaseList? Block }
EnumDeclaration { "enum" identifier BaseList? EnumBody }

MemberDeclaration {
  AttributeList*
  Modifier*
  (MethodDeclaration | PropertyDeclaration | FieldDeclaration | ConstructorDeclaration | TypeDeclaration)
}

MethodDeclaration { TypeName identifier TypeParameters? ParameterList Block? ";"? }
ConstructorDeclaration { identifier ParameterList Block }
PropertyDeclaration { TypeName identifier AccessorBlock }
FieldDeclaration { TypeName VariableDeclarator ("," VariableDeclarator)* ";" }
VariableDeclarator { identifier ("=" Expression)? }

AccessorBlock { "{" Accessor* "}" }
Accessor { Modifier* ("get" | "set" | "init") (";" | Block) }

PrimaryConstructor { ParameterList }
ParameterList { "(" (Parameter ("," Parameter)*)? ")" }
Parameter { AttributeList* Modifier* TypeName identifier? ("=" Expression)? }

Block { "{" Statement* "}" }
EnumBody { "{" (identifier ("=" Expression)? ("," identifier ("=" Expression)?)*)? ","? "}" }

Statement {
  Block |
  LocalDeclaration |
  IfStatement |
  ForStatement |
  ForeachStatement |
  WhileStatement |
  SwitchStatement |
  ReturnStatement |
  ExpressionStatement |
  PreprocessorDirective
}

LocalDeclaration { Modifier* TypeName VariableDeclarator ("," VariableDeclarator)* ";" }
IfStatement { "if" ParenthesizedExpression Statement ("else" Statement)? }
ForStatement { "for" "(" Expression? ";" Expression? ";" Expression? ")" Statement }
ForeachStatement { "foreach" "(" TypeName identifier "in" Expression ")" Statement }
WhileStatement { "while" ParenthesizedExpression Statement }
SwitchStatement { "switch" ParenthesizedExpression "{" SwitchSection* "}" }
SwitchSection { ("case" Pattern ":" | "default" ":") Statement* }
ReturnStatement { "return" Expression? ";" }
ExpressionStatement { Expression ";" }

Expression {
  LambdaExpression |
  AssignmentExpression
}

AssignmentExpression { BinaryExpression (("=" | "+=" | "-=" | "*=" | "/=" | "??=") AssignmentExpression)? }
BinaryExpression { PostfixExpression (BinaryOp PostfixExpression)* }
PostfixExpression { PrimaryExpression (MemberAccess | Invocation | ElementAccess)* }
PrimaryExpression {
  Literal |
  identifier |
  IdentifierPath |
  ObjectCreation |
  ParenthesizedExpression |
  CollectionExpression
}

ObjectCreation { "new" TypeName (ArgumentList | ObjectInitializer)? }
ObjectInitializer { "{" (VariableDeclarator ("," VariableDeclarator)*)? ","? "}" }
CollectionExpression { "[" (Expression ("," Expression)*)? ","? "]" }
ParenthesizedExpression { "(" Expression? ")" }
Invocation { ArgumentList }
ArgumentList { "(" (Argument ("," Argument)*)? ")" }
Argument { identifier ":" Expression | Expression }
ElementAccess { "[" Expression "]" }
MemberAccess { "." identifier }
LambdaExpression { (ParameterList | identifier) "=>" (Expression | Block) }

Pattern { identifier | Literal | TypeName identifier? }
BaseList { ":" TypeName ("," TypeName)* }
TypeParameters { "<" identifier ("," identifier)* ">" }
TypeName { IdentifierPath TypeParameters? ("?" | "[]")* }
IdentifierPath { identifier ("." identifier)* }
AttributeList { "[" IdentifierPath (ArgumentList)? "]" }
Modifier { "public" | "private" | "protected" | "internal" | "static" | "readonly" | "sealed" | "abstract" | "virtual" | "override" | "async" | "partial" | "extern" | "unsafe" | "ref" | "out" | "in" | "required" }
Literal { number | string | character | "true" | "false" | "null" }
BinaryOp { "==" | "!=" | "<=" | ">=" | "<" | ">" | "&&" | "||" | "??" | "+" | "-" | "*" | "/" | "%" | "is" | "as" }
PreprocessorDirective { preproc }

@tokens {
  whitespace { $[\s]+ }
  LineComment { "//" ![\n]* }
  BlockComment { "/*" (![*] | "*" ![/])* "*/" }
  preproc { "#" ![\n]* }
  identifier { $[A-Za-z_] $[A-Za-z0-9_]* }
  number { $[0-9]+ ("." $[0-9]+)? }
  string { "\"" (!["\\\n] | "\\" _)* "\"" | "$\"" (!["\\\n] | "\\" _ | "{" ![}] * "}")* "\"" | "@\"" (!["] | "\"\"")* "\"" }
  character { "'" (!['\\\n] | "\\" _) "'" }
}
```

- [ ] **Step 4: Add generated parser typing**

Create `src/features/editor-codemirror/lang-csharp/parser.d.ts`:

```ts
import type { LRParser } from "@lezer/lr"

export const parser: LRParser
```

- [ ] **Step 5: Generate the parser**

Run:

```bash
bun run gen:csharp-parser
```

Expected: `src/features/editor-codemirror/lang-csharp/parser.js` is created.

- [ ] **Step 6: Run the parser tests**

Run:

```bash
bun test src/features/editor-codemirror/lang-csharp/lang-csharp.test.ts
```

Expected: PASS for the common declaration sample and incomplete editing sample. If Lezer reports grammar conflicts, resolve them inside `csharp.grammar` by narrowing ambiguous productions instead of adding semantic analysis.

---

### Task 3: Add C# LanguageSupport, Highlighting, Folding, And Snippets

**Files:**
- Create: `src/features/editor-codemirror/lang-csharp/snippets.ts`
- Create: `src/features/editor-codemirror/lang-csharp/index.ts`
- Modify: `src/features/editor-codemirror/lang-csharp/lang-csharp.test.ts`

- [ ] **Step 1: Add snippet tests**

Append to `lang-csharp.test.ts`:

```ts
import { csharp, csharpLanguage } from "./index"
import { csharpSnippets } from "./snippets"

describe("csharp CodeMirror language package", () => {
    test("exports LanguageSupport and language data", () => {
        const support = csharp()
        expect(support.extension).toBeTruthy()
        expect(csharpLanguage.data.of({}).extension).toBeTruthy()
    })

    test("contains daily-editing snippets", () => {
        const labels = csharpSnippets.map((item) => item.label)
        expect(labels).toContain("class")
        expect(labels).toContain("interface")
        expect(labels).toContain("record")
        expect(labels).toContain("namespace")
        expect(labels).toContain("main")
    })
})
```

- [ ] **Step 2: Run the language package test and verify failure**

Run:

```bash
bun test src/features/editor-codemirror/lang-csharp/lang-csharp.test.ts
```

Expected: FAIL because `index.ts` and `snippets.ts` do not exist.

- [ ] **Step 3: Add snippets**

Create `src/features/editor-codemirror/lang-csharp/snippets.ts`:

```ts
import { snippetCompletion } from "@codemirror/autocomplete"

export const csharpSnippets = [
    snippetCompletion("class ${Name} {\n\t${}\n}", { label: "class", detail: "class declaration" }),
    snippetCompletion("interface I${Name} {\n\t${}\n}", { label: "interface", detail: "interface declaration" }),
    snippetCompletion("record ${Name}(${Type} ${property});", { label: "record", detail: "record declaration" }),
    snippetCompletion("namespace ${Name};", { label: "namespace", detail: "file-scoped namespace" }),
    snippetCompletion("using ${Namespace};", { label: "using", detail: "using directive" }),
    snippetCompletion("public static void Main(string[] args) {\n\t${}\n}", { label: "main", detail: "entry point" }),
]
```

- [ ] **Step 4: Add the language support entrypoint**

Create `src/features/editor-codemirror/lang-csharp/index.ts`:

```ts
import { completeFromList } from "@codemirror/autocomplete"
import {
    LRLanguage,
    LanguageSupport,
    delimitedIndent,
    foldInside,
    foldNodeProp,
    indentNodeProp,
} from "@codemirror/language"
import { styleTags, tags as t } from "@lezer/highlight"

import { parser } from "./parser"
import { csharpSnippets } from "./snippets"

const csharpKeywords = [
    "abstract", "as", "async", "await", "base", "bool", "break", "case", "catch",
    "class", "const", "continue", "default", "delegate", "do", "else", "enum",
    "event", "explicit", "extern", "false", "finally", "fixed", "for", "foreach",
    "if", "implicit", "in", "interface", "internal", "is", "lock", "namespace",
    "new", "null", "object", "operator", "out", "override", "params", "private",
    "protected", "public", "readonly", "record", "ref", "required", "return",
    "sealed", "sizeof", "stackalloc", "static", "string", "struct", "switch",
    "this", "throw", "true", "try", "typeof", "unsafe", "using", "var", "virtual",
    "void", "volatile", "while",
]

export const csharpLanguage = LRLanguage.define({
    name: "csharp",
    parser: parser.configure({
        props: [
            indentNodeProp.add({
                Block: delimitedIndent({ closing: "}" }),
                EnumBody: delimitedIndent({ closing: "}" }),
                AccessorBlock: delimitedIndent({ closing: "}" }),
                ObjectInitializer: delimitedIndent({ closing: "}" }),
                CollectionExpression: delimitedIndent({ closing: "]" }),
                ArgumentList: delimitedIndent({ closing: ")" }),
                ParameterList: delimitedIndent({ closing: ")" }),
            }),
            foldNodeProp.add({
                Block: foldInside,
                EnumBody: foldInside,
                AccessorBlock: foldInside,
                ObjectInitializer: foldInside,
            }),
            styleTags({
                "ClassDeclaration/identifier InterfaceDeclaration/identifier RecordDeclaration/identifier StructDeclaration/identifier EnumDeclaration/identifier": t.definition(t.typeName),
                "MethodDeclaration/identifier ConstructorDeclaration/identifier": t.definition(t.function(t.variableName)),
                "PropertyDeclaration/identifier FieldDeclaration/VariableDeclarator/identifier": t.definition(t.propertyName),
                IdentifierPath: t.namespace,
                Modifier: t.modifier,
                Literal: t.constant(t.name),
                string: t.string,
                character: t.character,
                number: t.number,
                LineComment: t.lineComment,
                BlockComment: t.blockComment,
                PreprocessorDirective: t.processingInstruction,
            }),
        ],
    }),
    languageData: {
        commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
        closeBrackets: { brackets: ["(", "[", "{", "\"", "'"] },
        indentOnInput: /^\s*[\}\]\)]$/,
        wordChars: "_",
    },
})

export function csharp(): LanguageSupport {
    return new LanguageSupport(csharpLanguage, [
        csharpLanguage.data.of({
            autocomplete: completeFromList([
                ...csharpSnippets,
                ...csharpKeywords.map((label) => ({ label, type: "keyword" })),
            ]),
        }),
    ])
}
```

- [ ] **Step 5: Run the C# package tests**

Run:

```bash
bun test src/features/editor-codemirror/lang-csharp/lang-csharp.test.ts
```

Expected: PASS.

---

### Task 4: Add CodeMirror Language Selection

**Files:**
- Create: `src/features/editor-codemirror/language-selection.ts`
- Create: `src/features/editor-codemirror/language-selection.test.ts`

- [ ] **Step 1: Write language selection tests**

Create `src/features/editor-codemirror/language-selection.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { codeMirrorLanguageIdForPath } from "./language-selection"

describe("codeMirrorLanguageIdForPath", () => {
    test.each([
        ["src/main.rs", "rust"],
        ["src/Program.cs", "csharp"],
        ["script.csx", "csharp"],
        ["config.yaml", "yaml"],
        ["config.yml", "yaml"],
        ["README.md", "markdown"],
        ["index.html", "html"],
        ["style.css", "css"],
        ["layout.xml", "xml"],
        ["index.js", "javascript"],
        ["index.jsx", "javascript"],
        ["index.ts", "typescript"],
        ["index.tsx", "typescript"],
    ])("%s maps to %s", (path, expected) => {
        expect(codeMirrorLanguageIdForPath(path)).toBe(expected)
    })

    test("unknown files stay plaintext", () => {
        expect(codeMirrorLanguageIdForPath("notes.unknown")).toBe("plaintext")
    })
})
```

- [ ] **Step 2: Run the language selection test and verify failure**

Run:

```bash
bun test src/features/editor-codemirror/language-selection.test.ts
```

Expected: FAIL because `language-selection.ts` does not exist.

- [ ] **Step 3: Implement language selection**

Create `src/features/editor-codemirror/language-selection.ts`:

```ts
import type { Extension } from "@codemirror/state"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { javascript } from "@codemirror/lang-javascript"
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
        case "typescript":
            return [javascript({ jsx: path.toLowerCase().endsWith(".tsx"), typescript: true })]
        case "javascript":
            return [javascript({ jsx: path.toLowerCase().endsWith(".jsx") })]
        case "plaintext":
            return []
    }
}
```

- [ ] **Step 4: Run selection and C# tests**

Run:

```bash
bun test src/features/editor-codemirror/language-selection.test.ts src/features/editor-codemirror/lang-csharp/lang-csharp.test.ts
```

Expected: PASS.

---

### Task 5: Add Pure Editor Adapter Helpers

**Files:**
- Create: `src/v2/editor/editor-surface.ts`
- Create: `src/v2/editor/editor-surface.test.ts`

- [ ] **Step 1: Write adapter helper tests**

Create `src/v2/editor/editor-surface.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import type { LanguageCompletionItem } from "../../features/language/language-model"
import {
    cursorFromOffset,
    mergeCompletionItems,
    offsetFromCursor,
    shouldAcceptAsyncEditorResult,
} from "./editor-surface"

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
})
```

- [ ] **Step 2: Run the helper test and verify failure**

Run:

```bash
bun test src/v2/editor/editor-surface.test.ts
```

Expected: FAIL because `editor-surface.ts` does not exist.

- [ ] **Step 3: Implement adapter helpers**

Create `src/v2/editor/editor-surface.ts`:

```ts
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
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
bun test src/v2/editor/editor-surface.test.ts
```

Expected: PASS.

---

### Task 6: Extract The Textarea Fallback Surface

**Files:**
- Create: `src/v2/editor/TextareaEditorSurface.tsx`
- Create: `src/v2/editor/EditorHost.tsx`
- Modify: `src/v2/ContentViews.tsx`
- Test: `src/v2/ContentViews.test.tsx`

- [ ] **Step 1: Preserve the current completion behavior with the existing test**

Run:

```bash
bun test src/v2/ContentViews.test.tsx
```

Expected: PASS before extraction, including the existing `ctrl+space requests completions and inserts a selected item` test.

- [ ] **Step 2: Move the current `EditableBody` implementation**

Create `src/v2/editor/TextareaEditorSurface.tsx` by moving the current `EditableBody` implementation and its helper functions from `src/v2/ContentViews.tsx`. Keep the behavior equivalent:

```ts
export function TextareaEditorSurface({ tab }: { tab: Tab }) {
    // Use the moved current textarea implementation.
    // Keep the same store selectors, hover behavior, completion popup,
    // reveal handling, save shortcut, tab indentation, diagnostics, and blame gutter.
}
```

The moved component must still call:

```ts
const setTabContent = useV2Store((s) => s.setTabContent)
const saveTab = useV2Store((s) => s.saveTab)
const gotoDefinition = useV2Store((s) => s.gotoDefinition)
const completeAt = useV2Store((s) => s.completeAt)
const hoverAt = useV2Store((s) => s.hoverAt)
const clearReveal = useV2Store((s) => s.clearReveal)
const setCursor = useV2Store((s) => s.setCursor)
```

- [ ] **Step 3: Add an editor host that defaults to textarea**

Create `src/v2/editor/EditorHost.tsx`:

```tsx
import type { Tab } from "../v2-model"
import { TextareaEditorSurface } from "./TextareaEditorSurface"

export function EditorHost({ tab }: { tab: Tab }) {
    return <TextareaEditorSurface tab={tab} />
}
```

- [ ] **Step 4: Update `ContentViews.tsx` to render the host**

In `src/v2/ContentViews.tsx`, import the host:

```ts
import { EditorHost } from "./editor/EditorHost"
```

Replace:

```tsx
body = <EditableBody tab={tab} />
```

with:

```tsx
body = <EditorHost tab={tab} />
```

Remove helper imports and local helper functions from `ContentViews.tsx` only after the moved file compiles.

- [ ] **Step 5: Run the existing editor tests**

Run:

```bash
bun test src/v2/ContentViews.test.tsx
```

Expected: PASS with no behavior change.

---

### Task 7: Add The CodeMirror Surface Behind A Guard

**Files:**
- Create: `src/v2/editor/CodeMirrorEditorSurface.tsx`
- Modify: `src/v2/editor/EditorHost.tsx`
- Modify: `src/v2/v2-model.ts`
- Modify: `src/v2/v2-store.ts`
- Test: `src/v2/ContentViews.test.tsx`

- [ ] **Step 1: Add a guarded editor engine setting**

In `src/v2/v2-model.ts`, add a settings row in the Editor section:

```ts
{ k: "editorEngine", label: "Editor engine", desc: "Editor surface used for editable files", choice: ["textarea", "codemirror"], def: "textarea" },
```

Expected: the default remains `textarea` so current behavior is preserved.

- [ ] **Step 2: Add a CodeMirror host smoke test**

In `src/v2/ContentViews.test.tsx`, add a test that sets `stVals.editorEngine` to `codemirror`, renders a real file tab, changes text, and verifies store content:

```tsx
test("CodeMirror editor surface writes through the v2 store", async () => {
    const tab = {
        id: 9201,
        type: "file" as const,
        name: "Program.cs",
        path: "Program.cs",
        realPath: "/workspace/Program.cs",
        content: "class Program {}",
        contentLang: "csharp",
        savedContent: "class Program {}",
    }
    v2Store.setState((s) => ({
        mode: "real",
        stVals: { ...s.stVals, editorEngine: "codemirror" },
        active: "api",
        ui: {
            ...s.ui,
            api: { ...s.ui.api, tabs: [tab], activeTab: tab.id },
        },
    }))

    const view = render(<EditorView tab={tab as Tab} />)
    const editor = view.container.querySelector(".cm-editor")
    expect(editor).toBeTruthy()
})
```

- [ ] **Step 3: Create `CodeMirrorEditorSurface.tsx`**

Create `src/v2/editor/CodeMirrorEditorSurface.tsx`:

```tsx
import { autocompletion, startCompletion } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language"
import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { useEffect, useMemo, useRef } from "react"

import { isLspSupportedDocumentPath } from "../../features/language/language-model"
import { codeMirrorLanguageForPath } from "../../features/editor-codemirror/language-selection"
import type { Tab } from "../v2-model"
import { useV2Store } from "../v2-store"
import { cursorFromOffset } from "./editor-surface"

export function CodeMirrorEditorSurface({ tab }: { tab: Tab }) {
    const hostRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const setTabContent = useV2Store((s) => s.setTabContent)
    const saveTab = useV2Store((s) => s.saveTab)
    const setCursor = useV2Store((s) => s.setCursor)
    const tabSize = useV2Store((s) => (s.stVals.tabSize === "4" ? 4 : 2))
    const content = tab.content ?? ""
    const path = tab.path ?? ""

    const extensions = useMemo(() => [
        lineNumbers(),
        history(),
        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ...codeMirrorLanguageForPath(path),
        autocompletion(),
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
                    if (!isLspSupportedDocumentPath(path)) return false
                    startCompletion(view)
                    return true
                },
            },
            ...defaultKeymap,
            ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
            if (update.docChanged) setTabContent(tab.id, update.state.doc.toString())
            if (update.selectionSet || update.docChanged) {
                const offset = update.state.selection.main.head
                setCursor(cursorFromOffset(update.state.doc.toString(), offset))
            }
        }),
        EditorState.tabSize.of(tabSize),
    ], [path, saveTab, setCursor, setTabContent, tab.id, tabSize])

    useEffect(() => {
        const host = hostRef.current
        if (!host) return
        const state = EditorState.create({ doc: content, extensions })
        const view = new EditorView({ state, parent: host })
        viewRef.current = view
        return () => {
            view.destroy()
            viewRef.current = null
        }
    }, [content, extensions])

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
```

- [ ] **Step 4: Choose the surface in `EditorHost.tsx`**

Update `src/v2/editor/EditorHost.tsx`:

```tsx
import type { Tab } from "../v2-model"
import { useV2Store } from "../v2-store"
import { CodeMirrorEditorSurface } from "./CodeMirrorEditorSurface"
import { TextareaEditorSurface } from "./TextareaEditorSurface"

export function EditorHost({ tab }: { tab: Tab }) {
    const engine = useV2Store((s) => s.stVals.editorEngine)
    if (engine === "codemirror") return <CodeMirrorEditorSurface tab={tab} />
    return <TextareaEditorSurface tab={tab} />
}
```

- [ ] **Step 5: Run the focused editor tests**

Run:

```bash
bun test src/v2/ContentViews.test.tsx src/v2/editor/editor-surface.test.ts
```

Expected: PASS.

---

### Task 8: Wire LSP And Two-Stage Completion Through The Editor Adapter

**Files:**
- Modify: `src/v2/editor/CodeMirrorEditorSurface.tsx`
- Modify: `src/v2/editor/editor-surface.ts`
- Modify: `src/v2/editor/editor-surface.test.ts`
- Test: `src/v2/ContentViews.test.tsx`

- [ ] **Step 1: Add a local completion helper test**

In `src/v2/editor/editor-surface.test.ts`, add:

```ts
import { localWordCompletions } from "./editor-surface"

test("localWordCompletions returns nearby unique words", () => {
    expect(localWordCompletions("Console Console CancellationToken class", "Con").map((item) => item.label)).toEqual([
        "Console",
    ])
})
```

- [ ] **Step 2: Implement local word completions**

Add to `src/v2/editor/editor-surface.ts`:

```ts
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
```

- [ ] **Step 3: Connect CodeMirror completion to local first and LSP second**

In `CodeMirrorEditorSurface.tsx`, replace `autocompletion()` with an override source that:
- extracts the current word prefix from CodeMirror context,
- returns local completions immediately,
- requests `completeAt(path, line, col)`,
- ignores stale results if document version changed,
- merges LSP results into a follow-up completion update.

Use this shape:

```ts
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
    ],
})
```

Then keep the LSP call path in the surface or adapter as a second update. If the CodeMirror completion API cannot update the open list directly, keep LSP completion on explicit `Ctrl-Space` as a first milestone and document the exact API limitation in the task closeout.

- [ ] **Step 4: Run focused completion tests**

Run:

```bash
bun test src/v2/editor/editor-surface.test.ts src/v2/ContentViews.test.tsx
```

Expected: PASS.

---

### Task 9: Make Document Sync, Auto-Save, And File Watcher State Single-Path

**Files:**
- Modify: `src/v2/v2-store.ts`
- Modify: `src/v2/v2-store.test.ts`
- Modify: `src/v2/controller.ts`
- Test: `src/v2/v2-store.test.ts`

- [ ] **Step 1: Update the existing real language action test**

In `src/v2/v2-store.test.ts`, update the test currently named `real language actions delegate and editor changes backup without notifying LSP` so editor changes now backup and schedule LSP change:

```ts
test("real editor changes backup content and schedule LSP document sync", () => {
    const store = freshStore()
    const calls: unknown[][] = []
    registerRealDelegate({
        lspChange: (...args: unknown[]) => calls.push(["change", ...args]),
        backupTab: (...args: unknown[]) => calls.push(["backup", ...args]),
    } as any)
    store.setState({ mode: "real" })
    const tabId = store.getState().ui.api.tabs[0].id

    store.getState().setTabContent(tabId, "updated")

    expect(calls).toEqual([
        ["backup", tabId, "updated"],
        ["change", tabId],
    ])
})
```

- [ ] **Step 2: Run the store test and verify failure**

Run:

```bash
bun test src/v2/v2-store.test.ts
```

Expected: FAIL because `setTabContent` currently calls `backupTab` but does not call `lspChange`.

- [ ] **Step 3: Update `setTabContent`**

In `src/v2/v2-store.ts`, update the real-mode side effect:

```ts
if (get().mode === "real") {
    realDelegate?.backupTab(tabId, content)
    realDelegate?.lspChange(tabId)
}
```

- [ ] **Step 4: Add auto-save scheduling tests**

Add tests for `stVals.autosave`:

```ts
test("autosave off does not save on edit", () => {
    const store = freshStore()
    const calls: unknown[][] = []
    registerRealDelegate({
        backupTab: (...args: unknown[]) => calls.push(["backup", ...args]),
        lspChange: (...args: unknown[]) => calls.push(["change", ...args]),
        saveFile: (...args: unknown[]) => calls.push(["save", ...args]),
    } as any)
    store.setState((s) => ({ mode: "real", stVals: { ...s.stVals, autosave: "off" } }))
    const tabId = store.getState().ui.api.tabs[0].id

    store.getState().setTabContent(tabId, "updated")

    expect(calls).toEqual([
        ["backup", tabId, "updated"],
        ["change", tabId],
    ])
})
```

Add delayed/focus autosave tests only after introducing a fake timer helper in this file. Use Bun fake timers if available in the current Bun version; otherwise keep autosave behavior inside controller-level tests where timers can be controlled.

- [ ] **Step 5: Run store tests**

Run:

```bash
bun test src/v2/v2-store.test.ts
```

Expected: PASS.

---

### Task 10: Add CodeMirror Styling That Preserves Yuzu UI/UX

**Files:**
- Modify: `src/v2/yuzu.css`
- Test: `src/v2/ContentViews.test.tsx`

- [ ] **Step 1: Add CodeMirror theme bridge CSS**

Append near the existing editor CSS in `src/v2/yuzu.css`:

```css
.yz2-cm-host {
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--yz-editor);
  color: var(--yz-text);
  overflow: hidden;
}

.yz2-cm-host .cm-editor {
  height: 100%;
  background: var(--yz-editor);
  color: var(--yz-text);
  font-family: var(--yz-mono);
  font-size: var(--yz-code-size, 13px);
}

.yz2-cm-host .cm-scroller {
  font-family: var(--yz-mono);
  line-height: 21px;
}

.yz2-cm-host .cm-gutters {
  background: var(--yz-editor);
  color: var(--yz-muted);
  border-right: 1px solid var(--yz-line);
}

.yz2-cm-host .cm-activeLine,
.yz2-cm-host .cm-activeLineGutter {
  background: color-mix(in srgb, var(--yz-yuzu) 8%, transparent);
}

.yz2-cm-host .cm-tooltip,
.yz2-cm-host .cm-tooltip-autocomplete {
  background: var(--yz-panel);
  color: var(--yz-text);
  border: 1px solid var(--yz-line-strong);
  box-shadow: var(--yz-shadow-lg);
}
```

- [ ] **Step 2: Run a focused render test**

Run:

```bash
bun test src/v2/ContentViews.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Manual visual check**

Run:

```bash
bun run dev
```

Expected: with `editorEngine` set to `codemirror`, the editor still uses the Yuzu shell proportions, gutter tone, mono font, hover/completion surfaces, and no nested card styling. Verify against `docs/ui-design/scenes.jsx` and `docs/ui-design/ide.css`.

---

### Task 11: Add Measurements And Rollout Gate

**Files:**
- Create: `docs/architecture/node-15-codemirror-csharp-results.md`
- Modify: `roadmap.md`

- [ ] **Step 1: Create the result document**

Create `docs/architecture/node-15-codemirror-csharp-results.md`:

```md
# Node 15 CodeMirror C# Results

## Scope

- CodeMirror editor surface behind the editor engine setting.
- First-party Lezer-based C# syntax package.
- Rust/Tauri LSP remains the semantic source.

## Verification

- `bun test src/features/editor-codemirror/lang-csharp/lang-csharp.test.ts`
- `bun test src/features/editor-codemirror/language-selection.test.ts`
- `bun test src/v2/editor/editor-surface.test.ts`
- `bun test src/v2/ContentViews.test.tsx`
- `bun test src/v2/v2-store.test.ts`
- `bun run build`

## Measurements

| Metric | Textarea baseline | CodeMirror result | Notes |
|---|---:|---:|---|
| File open small file |  |  | measured manually |
| Typing latency p95 |  |  | measured manually |
| Completion first paint |  |  | local completion |
| LSP completion merge |  |  | async LSP |
| Idle memory one workspace |  |  | process RSS |

## Decision

Keep CodeMirror behind the setting until the measurement table is filled and regressions are fixed.
```

- [ ] **Step 2: Run the full focused gate**

Run:

```bash
bun test src/features/editor-codemirror/lang-csharp/lang-csharp.test.ts
bun test src/features/editor-codemirror/language-selection.test.ts
bun test src/v2/editor/editor-surface.test.ts
bun test src/v2/ContentViews.test.tsx
bun test src/v2/v2-store.test.ts
bun run build
```

Expected: all commands PASS before enabling CodeMirror by default.

- [ ] **Step 3: Update roadmap status only after verification**

After the result document contains real command output and measurement values, update Node 15 in `roadmap.md` from `planned` to either `in progress` or `completed` according to the actual state.

Expected: roadmap status is evidence-backed, not inferred from unchecked plan boxes.

---

## Review Checklist

- The CodeMirror surface is guarded and textarea fallback remains available.
- The C# package does not claim semantic type checking.
- LSP remains mandatory for C# completion, diagnostics, definition, references, rename, and code actions.
- Store/controller remain the source of truth for dirty state, save, auto-save, file watcher events, and LSP document sync.
- Tests cover pure helpers before UI wiring.
- `docs/ui-design/` remains the source of truth for visual parity.
- No staging, commit, or push happens unless the user explicitly authorizes it.
