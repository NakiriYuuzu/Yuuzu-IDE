export type FindMatch = {
  lineNumber: number;
  column: number;
  preview: string;
};

export function findInText(content: string, query: string): FindMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  return content.split(/\r?\n/).flatMap((line, index) => {
    const column = line.toLowerCase().indexOf(needle);
    return column >= 0
      ? [{ lineNumber: index + 1, column: column + 1, preview: line }]
      : [];
  });
}
