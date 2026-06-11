/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { Window as HappyWindow } from "happy-dom";

const loadMonacoMock = mock<() => Promise<unknown>>();

mock.module("./load-monaco", () => ({
  loadMonaco: loadMonacoMock,
}));

const {
  EditorTab,
  activeDebugLineDecorations,
  createEditorIdentity,
  debugBreakpointDecorations,
  normalizeLspCodeActionList,
  normalizeLspCompletionList,
  normalizeLspLocations,
  normalizeLspWorkspaceEdit,
  shouldFocusFindInput,
} = await import("./EditorTab");

const fakeUri = {
  file: (path: string) => ({ kind: "file", value: path }),
  parse: (uri: string) => ({ kind: "parse", value: uri }),
};

function installDom() {
  const testWindow = new HappyWindow({ url: "http://localhost/" });
  globalThis.window = testWindow as unknown as Window & typeof globalThis;
  globalThis.document = testWindow.document as unknown as Document;
  globalThis.HTMLElement =
    testWindow.HTMLElement as unknown as typeof HTMLElement;
  globalThis.HTMLInputElement =
    testWindow.HTMLInputElement as unknown as typeof HTMLInputElement;
  globalThis.Event = testWindow.Event as unknown as typeof Event;
  globalThis.MouseEvent = testWindow.MouseEvent as unknown as typeof MouseEvent;
  Object.defineProperty(globalThis, "navigator", {
    value: testWindow.navigator,
    configurable: true,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });

  return { promise, resolve };
}

function fakeMonaco(markerCalls: unknown[][], createCalls: unknown[] = []) {
  const model = {
    findMatches: () => [],
    getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
    onDidChangeContent: () => ({ dispose: () => {} }),
  };
  const editor = {
    dispose: () => {},
    getModel: () => model,
    getValue: () => "fn main() {}",
    revealRangeInCenter: () => {},
    setSelection: () => {},
  };
  const disposable = { dispose: () => {} };

  return {
    editor: {
      create: (_host: unknown, options: unknown) => {
        createCalls.push(options);
        return editor;
      },
      setModelMarkers: (_model: unknown, _owner: string, markers: unknown[]) => {
        markerCalls.push(markers);
      },
    },
    languages: {
      registerCodeActionProvider: () => disposable,
      registerCompletionItemProvider: () => disposable,
      registerDefinitionProvider: () => disposable,
      registerHoverProvider: () => disposable,
      registerReferenceProvider: () => disposable,
      registerRenameProvider: () => disposable,
    },
    Range: class {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;

      constructor(
        startLineNumber: number,
        startColumn: number,
        endLineNumber: number,
        endColumn: number,
      ) {
        this.startLineNumber = startLineNumber;
        this.startColumn = startColumn;
        this.endLineNumber = endLineNumber;
        this.endColumn = endColumn;
      }
    },
    Uri: {
      file: (path: string) => ({ kind: "file", value: path }),
      parse: (uri: string) => ({ kind: "parse", value: uri }),
    },
  };
}

async function waitUntil(assertion: () => void) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
}

function editorProps(diagnostics: Parameters<typeof EditorTab>[0]["diagnostics"]) {
  return {
    workspaceId: "workspace",
    filePath: "src/main.rs",
    content: "fn main() {}",
    language: "rust",
    readOnly: false,
    findOpen: false,
    findFocusRequest: 0,
    findQuery: "",
    diagnostics,
    onCodeActions: () => Promise.resolve([]),
    onCompletion: () => Promise.resolve([]),
    onContentChange: () => {},
    onDirtyChange: () => {},
    onFindQueryChange: () => {},
    onGoToDefinition: () => Promise.resolve([]),
    onHover: () => Promise.resolve(null),
    onReferences: () => Promise.resolve([]),
    onRename: () => Promise.resolve({}),
  };
}

describe("createEditorIdentity", () => {
  test("ignores live content so Monaco is not recreated on every edit", () => {
    const first = createEditorIdentity({
      workspaceId: "workspace-a",
      filePath: "/repo/src/main.ts",
      language: "typescript",
      readOnly: false,
    });
    const next = createEditorIdentity({
      workspaceId: "workspace-a",
      filePath: "/repo/src/main.ts",
      language: "typescript",
      readOnly: false,
    });

    expect(next).toBe(first);
  });

  test("ignores diagnostics so Monaco is not recreated", () => {
    const first = createEditorIdentity({
      workspaceId: "workspace",
      filePath: "src/main.rs",
      language: "rust",
      readOnly: false,
    });

    const second = createEditorIdentity({
      workspaceId: "workspace",
      filePath: "src/main.rs",
      language: "rust",
      readOnly: false,
    });

    expect(first).toBe(second);
  });

  test("changes when file identity changes", () => {
    const first = createEditorIdentity({
      workspaceId: "workspace-a",
      filePath: "/repo/src/main.ts",
      language: "typescript",
      readOnly: false,
    });
    const next = createEditorIdentity({
      workspaceId: "workspace-b",
      filePath: "/repo/src/main.ts",
      language: "typescript",
      readOnly: false,
    });

    expect(next).not.toBe(first);
  });
});

describe("shouldFocusFindInput", () => {
  test("focuses again for repeated requests while find is already open", () => {
    expect(shouldFocusFindInput(true, 2, true, 1)).toBe(true);
    expect(shouldFocusFindInput(true, 2, true, 2)).toBe(false);
    expect(shouldFocusFindInput(true, 1, false, 1)).toBe(true);
  });
});

describe("debug breakpoint helpers", () => {
  test("maps breakpoint lines to Monaco glyph decorations", () => {
    const decorations = debugBreakpointDecorations([
      { line: 7, verified: true },
      { line: 12, verified: false },
    ]);

    expect(decorations.map((item) => item.options.glyphMarginClassName)).toEqual([
      "debug-breakpoint verified",
      "debug-breakpoint pending",
    ]);
  });

  test("maps active debug line to a Monaco line decoration", () => {
    expect(activeDebugLineDecorations(8)).toEqual([
      {
        range: {
          startLineNumber: 8,
          startColumn: 1,
          endLineNumber: 8,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className: "debug-active-line",
        },
      },
    ]);
    expect(activeDebugLineDecorations(null)).toEqual([]);
  });
});

describe("LSP provider payload normalization", () => {
  test("maps definition and reference locations to Monaco locations", () => {
    expect(
      normalizeLspLocations(
        [
          {
            uri: "file:///workspace/src/main.rs",
            range: {
              start: { line: 1, character: 2 },
              end: { line: 1, character: 5 },
            },
          },
        ],
        fakeUri,
      ),
    ).toEqual([
      {
        uri: { kind: "parse", value: "file:///workspace/src/main.rs" },
        range: {
          startLineNumber: 2,
          startColumn: 3,
          endLineNumber: 2,
          endColumn: 6,
        },
      },
    ]);
  });

  test("maps completion lists to Monaco suggestions", () => {
    const range = {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 5,
    };

    expect(
      normalizeLspCompletionList(
        {
          isIncomplete: true,
          items: [{ label: "main", kind: 3, insertText: "main()" }],
        },
        range,
      ),
    ).toEqual({
      incomplete: true,
      suggestions: [
        {
          label: "main",
          kind: 1,
          insertText: "main()",
          range,
        },
      ],
    });
  });

  test("maps code actions to Monaco action lists", () => {
    const list = normalizeLspCodeActionList(
      [
        {
          title: "Apply fix",
          kind: "quickfix",
          edit: {
            changes: {
              "file:///workspace/src/main.rs": [
                {
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 2 },
                  },
                  newText: "fn",
                },
              ],
            },
          },
        },
      ],
      fakeUri,
    );

    expect(list.actions).toEqual([
      {
        title: "Apply fix",
        kind: "quickfix",
        edit: {
          edits: [
            {
              resource: { kind: "parse", value: "file:///workspace/src/main.rs" },
              textEdit: {
                range: {
                  startLineNumber: 1,
                  startColumn: 1,
                  endLineNumber: 1,
                  endColumn: 3,
                },
                text: "fn",
              },
              versionId: undefined,
            },
          ],
        },
      },
    ]);
  });

  test("maps rename workspace edits to Monaco workspace edits", () => {
    expect(
      normalizeLspWorkspaceEdit(
        {
          changes: {
            "file:///workspace/src/main.rs": [
              {
                range: {
                  start: { line: 2, character: 4 },
                  end: { line: 2, character: 8 },
                },
                newText: "renamed",
              },
            ],
          },
        },
        fakeUri,
      ),
    ).toEqual({
      edits: [
        {
          resource: { kind: "parse", value: "file:///workspace/src/main.rs" },
          textEdit: {
            range: {
              startLineNumber: 3,
              startColumn: 5,
              endLineNumber: 3,
              endColumn: 9,
            },
            text: "renamed",
          },
          versionId: undefined,
        },
      ],
    });
  });
});

describe("EditorTab Monaco marker lifecycle", () => {
  test("applies latest diagnostics when Monaco resolves after rerender", async () => {
    installDom();
    const { createRoot } = await import("react-dom/client");
    const { flushSync } = await import("react-dom");
    const load = deferred<unknown>();
    const markerCalls: unknown[][] = [];
    loadMonacoMock.mockReturnValueOnce(load.promise);

    const firstDiagnostic = {
      path: "src/main.rs",
      range: {
        start_line: 0,
        start_character: 0,
        end_line: 0,
        end_character: 2,
      },
      severity: "error",
      message: "old diagnostic",
      source: "rust-analyzer",
    };
    const secondDiagnostic = {
      ...firstDiagnostic,
      message: "new diagnostic",
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(React.createElement(EditorTab, editorProps([firstDiagnostic])));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => {
      root.render(React.createElement(EditorTab, editorProps([secondDiagnostic])));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    load.resolve(fakeMonaco(markerCalls));

    await waitUntil(() => expect(markerCalls.length).toBeGreaterThan(0));
    expect(markerCalls[markerCalls.length - 1]?.[0]).toEqual(
      expect.objectContaining({ message: "new diagnostic" }),
    );
    root.unmount();
    container.remove();
    loadMonacoMock.mockReset();
  });

  test("enables glyph margin when debug breakpoint affordances are provided", async () => {
    installDom();
    const { createRoot } = await import("react-dom/client");
    const { flushSync } = await import("react-dom");
    const load = deferred<unknown>();
    const markerCalls: unknown[][] = [];
    const createCalls: unknown[] = [];
    loadMonacoMock.mockReturnValueOnce(load.promise);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        React.createElement(EditorTab, {
          ...editorProps([]),
          debugBreakpoints: [{ line: 7, verified: true }],
          activeDebugLine: 7,
          onToggleBreakpoint: () => {},
        }),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    load.resolve(fakeMonaco(markerCalls, createCalls));

    await waitUntil(() => expect(createCalls.length).toBe(1));
    expect(createCalls[0]).toEqual(expect.objectContaining({ glyphMargin: true }));
    root.unmount();
    container.remove();
    loadMonacoMock.mockReset();
  });
});
