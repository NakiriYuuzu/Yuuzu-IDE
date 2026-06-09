import { Database as DatabaseIcon, ShieldAlert } from "lucide-react";
import { type CSSProperties, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { type DatabaseQueryResult, type DatabaseQueryResultRow } from "./database-model";

type DatabaseResultViewProps = {
  result: DatabaseQueryResult | null;
  loading: boolean;
  error: string | null;
};

function rowStyle(columns: number, height: number, start: number): CSSProperties {
  return {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    transform: `translateY(${start}px)`,
    height,
    display: "grid",
    gridTemplateColumns: `repeat(${Math.max(columns, 1)}, minmax(0, 1fr))`,
    minHeight: `${height}px`,
  };
}

export function DatabaseResultView({
  result,
  loading,
  error,
}: DatabaseResultViewProps) {
  const rows = result?.rows ?? [];
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 6,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const renderedRows =
    virtualRows.length > 0
      ? virtualRows
      : rows.map((_, index) => ({
          key: index,
          index,
          start: index * 28,
          size: 28,
        }));
  const totalHeight = virtualizer.getTotalSize();

  const columnCount = result?.columns.length ?? 0;
  const columnTemplate = `repeat(${Math.max(columnCount, 1)}, minmax(0, 1fr))`;

  const kindLabel = useMemo(() => result?.classification.kind ?? "Read", [result]);
  const affectedLabel = useMemo(() => {
    if (!result) {
      return null;
    }

    if (result.classification.kind === "Read") {
      return `${rows.length} rows`;
    }

    return `${result.affected_rows ?? 0} rows affected`;
  }, [result, rows.length]);

  return (
    <section className="database-result">
      <div className="database-result-toolbar">
        <span className={`database-kind-tag database-kind-${kindLabel.toLowerCase()}`}>
          <DatabaseIcon aria-hidden="true" />
          {kindLabel}
        </span>
        <span className="database-result-meta-value">
          {affectedLabel ?? "No active result"}
        </span>
        {result ? (
          <span className="database-result-meta-value">{result.executed_ms}ms</span>
        ) : (
          <span className="database-result-meta-value">No result</span>
        )}
        {result?.truncated ? (
          <span className="badge2 warn">truncated</span>
        ) : null}
        {result?.classification.requires_confirmation ? (
          <span className="database-result-warning">
            <ShieldAlert aria-hidden="true" />
            Requires confirmation
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="panel-error-inline" role="alert">
          {error}
        </div>
      ) : null}

      {loading && <div className="panel-empty">Running query</div>}

      {!result && !loading ? <div className="panel-empty">No result yet</div> : null}

      {result ? (
        <div className="database-result-wrap">
          <div
            className="database-result-table-wrap"
            ref={parentRef}
            style={{ height: 220 }}
          >
            <div
              className="dbgrid"
              role="table"
              style={{ gridTemplateColumns: columnTemplate }}
            >
              <div role="rowgroup">
                <div
                  role="row"
                  className="database-result-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: columnTemplate,
                    position: "sticky",
                    top: 0,
                  }}
                >
                  {result.columns.map((column) => (
                    <div
                      key={column}
                      role="columnheader"
                      className="database-result-header-cell"
                    >
                      {column}
                    </div>
                  ))}
                </div>
              </div>

              <div
                role="rowgroup"
                className="database-result-body"
                style={{
                  position: "relative",
                  height: `${totalHeight}px`,
                }}
              >
                {renderedRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  if (!row) {
                    return null;
                  }

                  return (
                    <div
                      key={virtualRow.key}
                      role="row"
                      className="database-result-row"
                      style={rowStyle(columnCount, virtualRow.size, virtualRow.start)}
                    >
                      {row.cells.map((cell: DatabaseQueryResultRow["cells"][number], colIndex) => {
                        const value = cell.kind === "Null" ? "NULL" : cell.display;
                        return (
                          <div
                            role="cell"
                            key={`${virtualRow.index}:${colIndex}`}
                            className="database-cell"
                          >
                            {value}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!loading && result && rows.length === 0 ? (
        <div className="panel-empty">Result is empty</div>
      ) : null}
    </section>
  );
}
