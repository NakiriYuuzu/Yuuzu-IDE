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
                TypeBlock: delimitedIndent({ closing: "}" }),
                Block: delimitedIndent({ closing: "}" }),
                EnumBody: delimitedIndent({ closing: "}" }),
                InterfaceBody: delimitedIndent({ closing: "}" }),
                AccessorBlock: delimitedIndent({ closing: "}" }),
                CollectionExpression: delimitedIndent({ closing: "]" }),
                ArgumentList: delimitedIndent({ closing: ")" }),
                ParameterList: delimitedIndent({ closing: ")" }),
            }),
            foldNodeProp.add({
                TypeBlock: foldInside,
                Block: foldInside,
                EnumBody: foldInside,
                InterfaceBody: foldInside,
                AccessorBlock: foldInside,
            }),
            styleTags({
                "ClassDeclaration/identifier InterfaceDeclaration/identifier RecordDeclaration/identifier StructDeclaration/identifier EnumDeclaration/identifier": t.definition(t.typeName),
                "MethodDeclaration/identifier": t.definition(t.function(t.variableName)),
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
