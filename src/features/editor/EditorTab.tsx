import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import type * as Monaco from "monaco-editor";

import { loadMonaco } from "./load-monaco";

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
};

type EditorIdentityInput = Pick<
  EditorTabProps,
  "workspaceId" | "filePath" | "language" | "readOnly" | "content"
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
}: EditorTabProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const previousFindFocusRef = useRef({
    findOpen: false,
    findFocusRequest,
  });
  const findQueryRef = useRef(findQuery);
  const onFindQueryChangeRef = useRef(onFindQueryChange);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onContentChangeRef = useRef(onContentChange);
  const editorIdentity = createEditorIdentity({
    workspaceId,
    filePath,
    language,
    readOnly,
    content,
  });

  useEffect(() => {
    findQueryRef.current = findQuery;
    onFindQueryChangeRef.current = onFindQueryChange;
    onDirtyChangeRef.current = onDirtyChange;
    onContentChangeRef.current = onContentChange;
  }, [findQuery, onFindQueryChange, onDirtyChange, onContentChange]);

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
      editorRef.current?.dispose();
      editorRef.current = null;
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
