import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import type * as Monaco from "monaco-editor";

import { loadMonaco } from "./load-monaco";
import type { LspDiagnostic } from "../language/language-model";
import { severityToMonacoMarker } from "../language/language-model";

type EditorTabProps = {
  workspaceId: string;
  filePath: string;
  content: string;
  language: string;
  readOnly: boolean;
  findOpen: boolean;
  findFocusRequest: number;
  findQuery: string;
  onFindQueryChange: (query: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onContentChange: (content: string) => void;
  diagnostics: LspDiagnostic[];
  onHover: (line: number, character: number) => Promise<string | null>;
  onGoToDefinition: (line: number, character: number) => Promise<void>;
  onReferences: (line: number, character: number) => Promise<void>;
  onCompletion: (line: number, character: number) => Promise<unknown[]>;
  onCodeActions: (line: number, character: number) => Promise<unknown[]>;
  onRename: (line: number, character: number, newName: string) => Promise<void>;
};

type EditorIdentityInput = Pick<
  EditorTabProps,
  "workspaceId" | "filePath" | "language" | "readOnly"
>;

export function createEditorIdentity({
  workspaceId,
  filePath,
  language,
  readOnly,
}: EditorIdentityInput): string {
  return `${workspaceId}:${filePath}:${language}:${readOnly}`;
}

export function shouldFocusFindInput(
  findOpen: boolean,
  findFocusRequest: number,
  previousFindOpen: boolean,
  previousFindFocusRequest: number,
): boolean {
  return (
    findOpen &&
    (!previousFindOpen || findFocusRequest !== previousFindFocusRequest)
  );
}

export function EditorTab({
  workspaceId,
  filePath,
  content,
  language,
  readOnly,
  findOpen,
  findFocusRequest,
  findQuery,
  onFindQueryChange,
  onDirtyChange,
  onContentChange,
  diagnostics,
  onHover,
  onGoToDefinition,
  onReferences,
  onCompletion,
  onCodeActions,
  onRename,
}: EditorTabProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const providerDisposablesRef = useRef<Monaco.IDisposable[]>([]);
  const previousFindFocusRef = useRef({
    findOpen: false,
    findFocusRequest,
  });
  const findQueryRef = useRef(findQuery);
  const onFindQueryChangeRef = useRef(onFindQueryChange);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onContentChangeRef = useRef(onContentChange);
  const onHoverRef = useRef(onHover);
  const onGoToDefinitionRef = useRef(onGoToDefinition);
  const onReferencesRef = useRef(onReferences);
  const onCompletionRef = useRef(onCompletion);
  const onCodeActionsRef = useRef(onCodeActions);
  const onRenameRef = useRef(onRename);
  const editorIdentity = createEditorIdentity({
    workspaceId,
    filePath,
    language,
    readOnly,
  });

  useEffect(() => {
    findQueryRef.current = findQuery;
    onFindQueryChangeRef.current = onFindQueryChange;
    onDirtyChangeRef.current = onDirtyChange;
    onContentChangeRef.current = onContentChange;
    onHoverRef.current = onHover;
    onGoToDefinitionRef.current = onGoToDefinition;
    onReferencesRef.current = onReferences;
    onCompletionRef.current = onCompletion;
    onCodeActionsRef.current = onCodeActions;
    onRenameRef.current = onRename;
  }, [
    findQuery,
    onFindQueryChange,
    onDirtyChange,
    onContentChange,
    onHover,
    onGoToDefinition,
    onReferences,
    onCompletion,
    onCodeActions,
    onRename,
  ]);

  useEffect(() => {
    setEditorMarkers(editorRef.current);
  }, [diagnostics, editorIdentity]);

  function setEditorMarkers(
    editor: Monaco.editor.IStandaloneCodeEditor | null,
  ): void {
    if (!editor || !monacoRef.current) {
      return;
    }

    const model = editor.getModel();
    if (!model) {
      return;
    }

    const markers = diagnostics.map((diagnostic) => ({
      severity: severityToMonacoMarker(diagnostic.severity),
      message: diagnostic.message,
      startLineNumber: diagnostic.range.start_line + 1,
      startColumn: diagnostic.range.start_character + 1,
      endLineNumber: diagnostic.range.end_line + 1,
      endColumn: diagnostic.range.end_character + 1,
      source: diagnostic.source ?? undefined,
    }));

    monacoRef.current.editor.setModelMarkers(model, "yuuzu-lsp", markers);
  }

  function revealFirstFindMatch(query: string) {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const needle = query.trim();
    if (!editor || !model || !needle) {
      return;
    }

    const matches = model.findMatches(needle, false, false, false, null, true);
    if (matches[0]) {
      editor.revealRangeInCenter(matches[0].range);
      editor.setSelection(matches[0].range);
    }
  }

  useEffect(() => {
    let disposed = false;
    let disposable: { dispose: () => void } | undefined;
    const initialContent = content;

    void loadMonaco().then((monaco) => {
      if (disposed || !hostRef.current) {
        return;
      }

      editorRef.current = monaco.editor.create(hostRef.current, {
        value: content,
        language,
        readOnly,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
      });
      monacoRef.current = monaco;

      providerDisposablesRef.current.forEach((disposable) => disposable.dispose());
      providerDisposablesRef.current = [
        monaco.languages.registerHoverProvider(language, {
          provideHover: (_model, position) => {
            return onHoverRef.current(position.lineNumber - 1, position.column - 1)
              .then((contents) => {
                if (!contents) {
                  return null;
                }

                return {
                  range: new monaco.Range(
                    position.lineNumber,
                    position.column,
                    position.lineNumber,
                    position.column,
                  ),
                  contents: [{ value: contents }],
                };
              })
              .catch(() => null);
          },
        }),
        monaco.languages.registerDefinitionProvider(language, {
          provideDefinition: async (_editorModel, position) => {
            return onGoToDefinitionRef.current(
              position.lineNumber - 1,
              position.column - 1,
            )
              .then(() => null)
              .catch(() => null);
          },
        }),
        monaco.languages.registerReferenceProvider(language, {
          provideReferences: async (_editorModel, position) => {
            return onReferencesRef.current(
              position.lineNumber - 1,
              position.column - 1,
            )
              .then(() => null)
              .catch(() => null);
          },
        }),
        monaco.languages.registerCompletionItemProvider(language, {
          provideCompletionItems: async (_editorModel, position) => {
            try {
              const completionItems = await onCompletionRef.current(
                position.lineNumber - 1,
                position.column - 1,
              );
              return {
                suggestions: completionItems as Monaco.languages.CompletionItem[],
              };
            } catch {
              return { suggestions: [] };
            }
          },
        }),
        monaco.languages.registerCodeActionProvider(language, {
          provideCodeActions: async (_editorModel, range) => {
            try {
              const codeActions = await onCodeActionsRef.current(
                range.getStartPosition().lineNumber - 1,
                range.getStartPosition().column - 1,
              );

              return {
                actions: codeActions as Monaco.languages.CodeAction[],
                dispose: () => {},
              };
            } catch {
              return {
                actions: [],
                dispose: () => {},
              };
            }
          },
        }),
        monaco.languages.registerRenameProvider(language, {
          provideRenameEdits: async (_editorModel, position, newName) => {
            return onRenameRef.current(
              position.lineNumber - 1,
              position.column - 1,
              newName,
            )
              .then(() => null)
              .catch(() => null);
          },
        }),
      ];

      setEditorMarkers(editorRef.current);

      const model = editorRef.current.getModel();
      disposable = model?.onDidChangeContent(() => {
        const next = editorRef.current?.getValue() ?? "";
        onContentChangeRef.current(next);
        onDirtyChangeRef.current(next !== initialContent);
      });
      revealFirstFindMatch(findQueryRef.current);
    });

    return () => {
      disposed = true;
      disposable?.dispose();
      providerDisposablesRef.current.forEach((disposable) => disposable.dispose());
      providerDisposablesRef.current = [];
      editorRef.current?.dispose();
      editorRef.current = null;
      monacoRef.current = null;
    };
  }, [editorIdentity]);

  useEffect(() => {
    revealFirstFindMatch(findQuery);
  }, [findQuery]);

  useEffect(() => {
    const previous = previousFindFocusRef.current;
    if (
      shouldFocusFindInput(
        findOpen,
        findFocusRequest,
        previous.findOpen,
        previous.findFocusRequest,
      )
    ) {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    }
    previousFindFocusRef.current = { findOpen, findFocusRequest };
  }, [findOpen, findFocusRequest]);

  return (
    <div className="editor-tab-surface">
      {findOpen || findQuery.trim() ? (
        <div className="editor-find">
          <Search aria-hidden="true" />
          <input
            ref={findInputRef}
            type="search"
            value={findQuery}
            aria-label="Find in file"
            placeholder="Find in file"
            onChange={(event) =>
              onFindQueryChangeRef.current(event.target.value)
            }
          />
        </div>
      ) : null}
      <div
        ref={hostRef}
        className="monaco-host"
        data-file-path={filePath}
        data-workspace-id={workspaceId}
      />
    </div>
  );
}
