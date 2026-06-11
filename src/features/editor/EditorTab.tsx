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
  onGoToDefinition: (line: number, character: number) => Promise<unknown>;
  onReferences: (line: number, character: number) => Promise<unknown>;
  onCompletion: (line: number, character: number) => Promise<unknown>;
  onCodeActions: (line: number, character: number) => Promise<unknown>;
  onRename: (line: number, character: number, newName: string) => Promise<unknown>;
  debugBreakpoints?: DebugEditorBreakpoint[];
  activeDebugLine?: number | null;
  onToggleBreakpoint?: (line: number) => void;
};

type DebugEditorBreakpoint = {
  line: number;
  verified: boolean;
};

const EMPTY_DEBUG_BREAKPOINTS: DebugEditorBreakpoint[] = [];

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

type UriFactory<TUri> = {
  file: (path: string) => TUri;
  parse: (uri: string) => TUri;
};

type MonacoLocation<TUri> = {
  uri: TUri;
  range: Monaco.IRange;
};

type MonacoTextEdit<TUri> = {
  resource: TUri;
  textEdit: {
    range: Monaco.IRange;
    text: string;
  };
  versionId: undefined;
};

type MonacoWorkspaceEdit<TUri> = {
  edits: MonacoTextEdit<TUri>[];
};

type MonacoCodeAction<TUri> = {
  title: string;
  command?: Monaco.languages.Command;
  edit?: MonacoWorkspaceEdit<TUri>;
  diagnostics?: Monaco.editor.IMarkerData[];
  kind?: string;
  isPreferred?: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function lspRangeToMonacoRange(value: unknown): Monaco.IRange | null {
  const range = record(value);
  const start = record(range?.start);
  const end = record(range?.end);
  if (
    typeof start?.line !== "number" ||
    typeof start.character !== "number" ||
    typeof end?.line !== "number" ||
    typeof end.character !== "number"
  ) {
    return null;
  }

  return {
    startLineNumber: start.line + 1,
    startColumn: start.character + 1,
    endLineNumber: end.line + 1,
    endColumn: end.character + 1,
  };
}

function uriFromLsp<TUri>(uriFactory: UriFactory<TUri>, value: unknown): TUri | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  return value.includes("://") ? uriFactory.parse(value) : uriFactory.file(value);
}

export function normalizeLspLocations<TUri>(
  value: unknown,
  uriFactory: UriFactory<TUri>,
): MonacoLocation<TUri>[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const locations: MonacoLocation<TUri>[] = [];

  for (const item of items) {
    const location = record(item);
    const uri = uriFromLsp(
      uriFactory,
      location?.uri ?? location?.targetUri,
    );
    const range = lspRangeToMonacoRange(location?.range ?? location?.targetRange);
    if (!uri || !range) {
      continue;
    }

    const targetSelectionRange = lspRangeToMonacoRange(
      location?.targetSelectionRange,
    );
    if (targetSelectionRange) {
      locations.push({ uri, range, targetSelectionRange } as MonacoLocation<TUri>);
    } else {
      locations.push({ uri, range });
    }
  }

  return locations;
}

function monacoCompletionKindFromLsp(kind: unknown): number {
  const map: Record<number, number> = {
    1: 18,
    2: 0,
    3: 1,
    4: 2,
    5: 3,
    6: 4,
    7: 5,
    8: 7,
    9: 8,
    10: 9,
    11: 12,
    12: 13,
    13: 15,
    14: 17,
    15: 28,
    16: 19,
    17: 20,
    18: 21,
    19: 23,
    20: 15,
    21: 14,
    22: 7,
    23: 10,
    24: 9,
    25: 11,
  };

  return typeof kind === "number" ? (map[kind] ?? 18) : 18;
}

function completionLabel(value: unknown): string | Monaco.languages.CompletionItemLabel | null {
  if (typeof value === "string") {
    return value;
  }

  const label = record(value);
  if (typeof label?.label !== "string") {
    return null;
  }

  return {
    label: label.label,
    detail: typeof label.detail === "string" ? label.detail : undefined,
    description:
      typeof label.description === "string" ? label.description : undefined,
  };
}

function completionLabelText(
  label: string | Monaco.languages.CompletionItemLabel,
): string {
  return typeof label === "string" ? label : label.label;
}

export function normalizeLspCompletionList(
  value: unknown,
  fallbackRange: Monaco.IRange,
): Monaco.languages.CompletionList {
  const completionList = record(value);
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray(completionList?.items)
      ? completionList.items
      : [];
  const suggestions: Monaco.languages.CompletionItem[] = [];

  for (const rawItem of rawItems) {
    const item = record(rawItem);
    const label = completionLabel(item?.label);
    if (!item || !label) {
      continue;
    }

    const textEdit = record(item.textEdit);
    const textEditRange = lspRangeToMonacoRange(textEdit?.range);
    const insertText =
      typeof item.insertText === "string"
        ? item.insertText
        : typeof textEdit?.newText === "string"
          ? textEdit.newText
          : completionLabelText(label);
    const suggestion: Monaco.languages.CompletionItem = {
      label,
      kind: monacoCompletionKindFromLsp(item.kind),
      insertText,
      range: textEditRange ?? fallbackRange,
    };

    if (typeof item.detail === "string") {
      suggestion.detail = item.detail;
    }
    if (typeof item.documentation === "string") {
      suggestion.documentation = item.documentation;
    }
    if (typeof item.sortText === "string") {
      suggestion.sortText = item.sortText;
    }
    if (typeof item.filterText === "string") {
      suggestion.filterText = item.filterText;
    }
    if (item.insertTextFormat === 2) {
      suggestion.insertTextRules = 4;
    }

    suggestions.push(suggestion);
  }

  return {
    suggestions,
    incomplete: completionList?.isIncomplete === true ? true : undefined,
  };
}

function normalizeCommand(value: unknown): Monaco.languages.Command | undefined {
  const command = record(value);
  if (
    typeof command?.command !== "string" ||
    typeof command.title !== "string"
  ) {
    return undefined;
  }

  return {
    id: command.command,
    title: command.title,
    arguments: Array.isArray(command.arguments) ? command.arguments : undefined,
  };
}

function normalizeTextEdits<TUri>(
  uriFactory: UriFactory<TUri>,
  uri: unknown,
  edits: unknown,
): MonacoTextEdit<TUri>[] {
  const resource = uriFromLsp(uriFactory, uri);
  if (!resource || !Array.isArray(edits)) {
    return [];
  }

  return edits.flatMap((edit) => {
    const textEdit = record(edit);
    const range = lspRangeToMonacoRange(textEdit?.range);
    if (!range || typeof textEdit?.newText !== "string") {
      return [];
    }

    return [{
      resource,
      textEdit: {
        range,
        text: textEdit.newText,
      },
      versionId: undefined,
    }];
  });
}

export function normalizeLspWorkspaceEdit<TUri>(
  value: unknown,
  uriFactory: UriFactory<TUri>,
): MonacoWorkspaceEdit<TUri> | null {
  const workspaceEdit = record(value);
  if (!workspaceEdit) {
    return null;
  }

  const edits: MonacoTextEdit<TUri>[] = [];
  const changes = record(workspaceEdit.changes);
  if (changes) {
    for (const [uri, textEdits] of Object.entries(changes)) {
      edits.push(...normalizeTextEdits(uriFactory, uri, textEdits));
    }
  }

  if (Array.isArray(workspaceEdit.documentChanges)) {
    for (const change of workspaceEdit.documentChanges) {
      const textDocumentEdit = record(change);
      const textDocument = record(textDocumentEdit?.textDocument);
      edits.push(
        ...normalizeTextEdits(
          uriFactory,
          textDocument?.uri,
          textDocumentEdit?.edits,
        ),
      );
    }
  }

  return edits.length > 0 ? { edits } : null;
}

export function normalizeLspCodeActionList<TUri>(
  value: unknown,
  uriFactory: UriFactory<TUri>,
): { actions: MonacoCodeAction<TUri>[] } {
  const codeActionList = record(value);
  const rawActions = Array.isArray(value)
    ? value
    : Array.isArray(codeActionList?.actions)
      ? codeActionList.actions
      : [];
  const actions: MonacoCodeAction<TUri>[] = [];

  for (const rawAction of rawActions) {
    const action = record(rawAction);
    if (!action || typeof action.title !== "string") {
      continue;
    }

    const normalized: MonacoCodeAction<TUri> = {
      title: action.title,
    };
    if (typeof action.kind === "string") {
      normalized.kind = action.kind;
    }
    if (action.isPreferred === true) {
      normalized.isPreferred = true;
    }
    const edit = normalizeLspWorkspaceEdit(action.edit, uriFactory);
    if (edit) {
      normalized.edit = edit;
    }
    const command = normalizeCommand(action.command);
    if (command) {
      normalized.command = command;
    }

    actions.push(normalized);
  }

  return { actions };
}

export function debugBreakpointDecorations(
  breakpoints: DebugEditorBreakpoint[],
): Monaco.editor.IModelDeltaDecoration[] {
  return breakpoints
    .filter((breakpoint) => Number.isFinite(breakpoint.line) && breakpoint.line > 0)
    .map((breakpoint) => ({
      range: {
        startLineNumber: breakpoint.line,
        startColumn: 1,
        endLineNumber: breakpoint.line,
        endColumn: 1,
      },
      options: {
        glyphMarginClassName: `debug-breakpoint ${
          breakpoint.verified ? "verified" : "pending"
        }`,
      },
    }));
}

export function activeDebugLineDecorations(
  activeDebugLine: number | null | undefined,
): Monaco.editor.IModelDeltaDecoration[] {
  if (!activeDebugLine || activeDebugLine <= 0) {
    return [];
  }

  return [
    {
      range: {
        startLineNumber: activeDebugLine,
        startColumn: 1,
        endLineNumber: activeDebugLine,
        endColumn: 1,
      },
      options: {
        isWholeLine: true,
        className: "debug-active-line",
      },
    },
  ];
}

function debugDecorations(
  debugBreakpoints: DebugEditorBreakpoint[],
  activeDebugLine: number | null | undefined,
): Monaco.editor.IModelDeltaDecoration[] {
  return [
    ...debugBreakpointDecorations(debugBreakpoints),
    ...activeDebugLineDecorations(activeDebugLine),
  ];
}

function shouldEnableDebugGlyphMargin(
  debugBreakpoints: DebugEditorBreakpoint[] | undefined,
  onToggleBreakpoint: ((line: number) => void) | undefined,
): boolean {
  return Boolean(onToggleBreakpoint || (debugBreakpoints?.length ?? 0) > 0);
}

function isGlyphMarginTarget(
  monaco: typeof import("monaco-editor"),
  target: Monaco.editor.IMouseTarget,
): boolean {
  const mouseTargetType = monaco.editor.MouseTargetType;
  return target.type === (mouseTargetType?.GUTTER_GLYPH_MARGIN ?? 2);
}

function lineNumberFromMouseTarget(
  target: Monaco.editor.IMouseTarget,
): number | null {
  const targetRecord = target as {
    position?: { lineNumber?: unknown };
    range?: { startLineNumber?: unknown };
  };
  const lineNumber =
    targetRecord.position?.lineNumber ?? targetRecord.range?.startLineNumber;

  return typeof lineNumber === "number" && lineNumber > 0 ? lineNumber : null;
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
  debugBreakpoints = EMPTY_DEBUG_BREAKPOINTS,
  activeDebugLine = null,
  onToggleBreakpoint,
}: EditorTabProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const debugDecorationsRef =
    useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const providerDisposablesRef = useRef<Monaco.IDisposable[]>([]);
  const diagnosticsRef = useRef(diagnostics);
  const debugBreakpointsRef = useRef(debugBreakpoints);
  const activeDebugLineRef = useRef(activeDebugLine);
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
  const onToggleBreakpointRef = useRef(onToggleBreakpoint);
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
    onToggleBreakpointRef.current = onToggleBreakpoint;
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
    onToggleBreakpoint,
  ]);

  useEffect(() => {
    debugBreakpointsRef.current = debugBreakpoints;
    activeDebugLineRef.current = activeDebugLine;
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    if (typeof editor.updateOptions === "function") {
      editor.updateOptions({
        glyphMargin: shouldEnableDebugGlyphMargin(
          debugBreakpoints,
          onToggleBreakpointRef.current,
        ),
      });
    }
    setDebugDecorations(editor);
  }, [activeDebugLine, debugBreakpoints, editorIdentity, onToggleBreakpoint]);

  useEffect(() => {
    diagnosticsRef.current = diagnostics;
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

    const markers = diagnosticsRef.current.map((diagnostic) => ({
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

  function setDebugDecorations(
    editor: Monaco.editor.IStandaloneCodeEditor | null,
  ): void {
    if (!editor || typeof editor.createDecorationsCollection !== "function") {
      return;
    }

    const decorations = debugDecorations(
      debugBreakpointsRef.current,
      activeDebugLineRef.current,
    );
    const collection =
      debugDecorationsRef.current ?? editor.createDecorationsCollection();
    collection.set(decorations);
    debugDecorationsRef.current = collection;
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
    let contentDisposable: { dispose: () => void } | undefined;
    let mouseDisposable: { dispose: () => void } | undefined;
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
        glyphMargin: shouldEnableDebugGlyphMargin(
          debugBreakpointsRef.current,
          onToggleBreakpointRef.current,
        ),
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
            try {
              const locations = normalizeLspLocations(
                await onGoToDefinitionRef.current(
                  position.lineNumber - 1,
                  position.column - 1,
                ),
                monaco.Uri,
              );

              return locations.length > 0
                ? (locations as Monaco.languages.Definition)
                : null;
            } catch {
              return null;
            }
          },
        }),
        monaco.languages.registerReferenceProvider(language, {
          provideReferences: async (_editorModel, position) => {
            try {
              const locations = normalizeLspLocations(
                await onReferencesRef.current(
                  position.lineNumber - 1,
                  position.column - 1,
                ),
                monaco.Uri,
              );

              return locations.length > 0
                ? (locations as Monaco.languages.Location[])
                : null;
            } catch {
              return null;
            }
          },
        }),
        monaco.languages.registerCompletionItemProvider(language, {
          provideCompletionItems: async (editorModel, position) => {
            try {
              const word = editorModel.getWordUntilPosition(position);
              const range = {
                startLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endLineNumber: position.lineNumber,
                endColumn: word.endColumn,
              };
              return normalizeLspCompletionList(
                await onCompletionRef.current(
                  position.lineNumber - 1,
                  position.column - 1,
                ),
                range,
              );
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
                ...normalizeLspCodeActionList(codeActions, monaco.Uri),
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
            try {
              return normalizeLspWorkspaceEdit(
                await onRenameRef.current(
                  position.lineNumber - 1,
                  position.column - 1,
                  newName,
                ),
                monaco.Uri,
              ) as Monaco.languages.WorkspaceEdit | null;
            } catch {
              return null;
            }
          },
        }),
      ];

      setEditorMarkers(editorRef.current);
      setDebugDecorations(editorRef.current);

      const model = editorRef.current.getModel();
      contentDisposable = model?.onDidChangeContent(() => {
        const next = editorRef.current?.getValue() ?? "";
        onContentChangeRef.current(next);
        onDirtyChangeRef.current(next !== initialContent);
      });
      if (typeof editorRef.current.onMouseDown === "function") {
        mouseDisposable = editorRef.current.onMouseDown((event) => {
          if (!isGlyphMarginTarget(monaco, event.target)) {
            return;
          }
          const lineNumber = lineNumberFromMouseTarget(event.target);
          if (lineNumber) {
            onToggleBreakpointRef.current?.(lineNumber);
          }
        });
      }
      revealFirstFindMatch(findQueryRef.current);
    });

    return () => {
      disposed = true;
      contentDisposable?.dispose();
      mouseDisposable?.dispose();
      providerDisposablesRef.current.forEach((disposable) => disposable.dispose());
      providerDisposablesRef.current = [];
      debugDecorationsRef.current?.clear();
      debugDecorationsRef.current = null;
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
