import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";

import { loadMonaco } from "./load-monaco";

type EditorTabProps = {
  workspaceId: string;
  filePath: string;
  content: string;
  language: string;
  readOnly: boolean;
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

export function EditorTab({
  workspaceId,
  filePath,
  content,
  language,
  readOnly,
  onDirtyChange,
  onContentChange,
}: EditorTabProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
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
    onDirtyChangeRef.current = onDirtyChange;
    onContentChangeRef.current = onContentChange;
  }, [onDirtyChange, onContentChange]);

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
    });

    return () => {
      disposed = true;
      disposable?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [editorIdentity]);

  return (
    <div
      ref={hostRef}
      className="monaco-host"
      data-file-path={filePath}
      data-workspace-id={workspaceId}
    />
  );
}
