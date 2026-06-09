import { AlertTriangle, FileText, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  staleReferenceCount,
  type DocPreview,
  type DocReferenceHint,
} from "./docs-model";

export type MarkdownPreviewProps = {
  preview: DocPreview | null;
  selectedPath: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};

function referenceBadge(reference: DocReferenceHint) {
  if (!reference.exists) {
    return <span className="badge2 danger">missing</span>;
  }

  if (reference.stale) {
    return <span className="badge2 warn">stale</span>;
  }

  return null;
}

function ReferenceHints({ references }: { references: DocReferenceHint[] }) {
  return (
    <div className="doc-reference-list">
      <div className="doc-reference-head">
        <span>References</span>
        <span>{references.length}</span>
      </div>
      {references.length > 0 ? (
        references.map((reference, index) => (
          <div
            className="doc-reference-row"
            key={`${reference.target_path}:${index}`}
          >
            <span className="doc-reference-path">{reference.target_path}</span>
            {referenceBadge(reference)}
            <span className="doc-reference-reason">{reference.reason}</span>
          </div>
        ))
      ) : (
        <div className="doc-reference-empty">No references detected</div>
      )}
    </div>
  );
}

export function MarkdownPreview({
  preview,
  selectedPath,
  loading,
  error,
  onRefresh,
}: MarkdownPreviewProps) {
  const pathLabel = preview?.path ?? selectedPath ?? "No doc selected";
  const staleCount = staleReferenceCount(preview);

  return (
    <div className="markdown-preview">
      <div className="markdown-toolbar">
        <FileText aria-hidden="true" />
        <span className="markdown-title">Markdown Preview</span>
        <span className="markdown-path mono" title={pathLabel}>
          {pathLabel}
        </span>
        {staleCount > 0 ? (
          <span className="badge2 warn">{staleCount} stale refs</span>
        ) : null}
        <button
          type="button"
          className="iconbtn"
          title="Refresh preview"
          aria-label="Refresh preview"
          disabled={!selectedPath}
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden="true" />
        </button>
      </div>

      {error ? (
        <div className="markdown-alert" role="alert">
          <AlertTriangle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {!preview ? (
        <div className="markdown-empty">
          {loading ? "Loading preview" : "Select a doc to preview"}
        </div>
      ) : (
        <>
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {preview.content}
            </ReactMarkdown>
          </div>
          <ReferenceHints references={preview.references} />
        </>
      )}
    </div>
  );
}
