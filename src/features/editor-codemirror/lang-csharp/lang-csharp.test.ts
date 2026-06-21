import { describe, expect, test } from "bun:test"
import { csharp, csharpLanguage } from "./index"
import { parser } from "./parser"
import { csharpSnippets } from "./snippets"

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

describe("csharp CodeMirror language package", () => {
    test("exports LanguageSupport and language data", () => {
        const support = csharp()
        expect(support.extension).toBeTruthy()
        expect(csharpLanguage.data.of({})).toBeTruthy()
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
