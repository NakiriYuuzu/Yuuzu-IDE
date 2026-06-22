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
        ["package.json", "json"],
        ["tsconfig.json", "json"],
        ["index.js", "javascript"],
        ["index.jsx", "javascript"],
        ["index.ts", "typescript"],
        ["index.tsx", "typescript"],
        ["scripts/tool.py", "python"],
        ["scripts/tool.pyw", "python"],
        ["types/tool.pyi", "python"],
    ] as const)("%s maps to %s", (path, expected) => {
        expect(codeMirrorLanguageIdForPath(path)).toBe(expected)
    })

    test("unknown files stay plaintext", () => {
        expect(codeMirrorLanguageIdForPath("notes.unknown")).toBe("plaintext")
    })
})
