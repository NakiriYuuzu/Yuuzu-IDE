import { snippetCompletion } from "@codemirror/autocomplete"

export const csharpSnippets = [
    snippetCompletion("class ${Name} {\n\t${}\n}", { label: "class", detail: "class declaration" }),
    snippetCompletion("interface I${Name} {\n\t${}\n}", { label: "interface", detail: "interface declaration" }),
    snippetCompletion("record ${Name}(${Type} ${property});", { label: "record", detail: "record declaration" }),
    snippetCompletion("namespace ${Name};", { label: "namespace", detail: "file-scoped namespace" }),
    snippetCompletion("using ${Namespace};", { label: "using", detail: "using directive" }),
    snippetCompletion("public static void Main(string[] args) {\n\t${}\n}", { label: "main", detail: "entry point" }),
]
