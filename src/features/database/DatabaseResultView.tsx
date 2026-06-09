import { Database as DatabaseIcon, ShieldAlert } from "lucide-react";
import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { type DatabaseQueryResult, type DatabaseQueryResultRow } from "./database-model";

type DatabaseResultViewProps = {
  result: DatabaseQueryResult | null;
  loading: boolean;
  error: string | null;
};

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
  const hasRows = rows.length > 0;

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

      {!result && !loading ? (
        <div className="panel-empty">No result yet</div>
      ) : null}

      {result ? (
        <div className="database-result-wrap">
          <div
            className="database-result-table-wrap"
            ref={parentRef}
            style={{ height: 220 }}
          >
            <table className="dbgrid" role="table">
              <thead>
                <tr>
                  {result.columns.map((column) => (
                    <th key={column} role="columnheader">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody
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
                    <tr
                      key={virtualRow.key}
                      className="database-result-row"
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`,
                        height: virtualRow.size,
                      }}
                    >
                      {row.cells.map((cell: DatabaseQueryResultRow["cells"][number], index) => {
                        const value = cell.kind === "Null" ? "NULL" : cell.display;
                        return (
                          <td key={`${virtualRow.index}:${index}`}>
                            <span className="mono database-cell">{value}</span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!loading && result && !hasRows ? (
        <div className="panel-empty">Result is empty</div>
      ) : null}
    </section>
  );
}
