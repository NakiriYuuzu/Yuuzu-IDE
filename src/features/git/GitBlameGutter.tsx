import type { GitBlameFile } from "./git-model";

export type GitBlameGutterProps = {
  blame: GitBlameFile;
  lineHeight: number;
  onHoverSegment: (hash: string) => void;
  onOpenInLog: (hash: string) => void;
};

export function GitBlameGutter({
  blame,
  lineHeight,
  onHoverSegment,
  onOpenInLog,
}: GitBlameGutterProps) {
  return (
    <div className="blame" aria-label={`Blame for ${blame.path}`}>
      {blame.segments.map((segment) => (
        <div
          key={`${segment.hash}-${segment.line_start}`}
          className="brow"
          style={{ height: `${segment.line_count * lineHeight}px` }}
          role="button"
          tabIndex={0}
          onMouseEnter={() => onHoverSegment(segment.hash)}
          onClick={() => onOpenInLog(segment.hash)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onOpenInLog(segment.hash);
            }
          }}
        >
          <span className="brow-hash mono">{segment.short_hash}</span>
          <span className="brow-author">{segment.author}</span>
        </div>
      ))}
      {blame.truncated ? (
        <div className="brow truncated">blame truncated</div>
      ) : null}
    </div>
  );
}
