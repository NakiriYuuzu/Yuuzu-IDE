import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";

import { initialEditorText } from "./editor-sample";
import { loadMonaco } from "./load-monaco";

export function EditorTab() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    let disposed = false;

    void loadMonaco().then((monaco) => {
      if (disposed || !hostRef.current || editorRef.current) {
        return;
      }

      editorRef.current = monaco.editor.create(hostRef.current, {
        value: initialEditorText(),
        language: "typescript",
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
      });
    });

    return () => {
      disposed = true;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className="monaco-host" />;
}
