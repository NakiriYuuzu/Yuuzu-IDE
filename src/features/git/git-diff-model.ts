export type GitLineKind = "context" | "add" | "del";

export type GitHunkLine = {
  kind: GitLineKind;
  old_no: number | null;
  new_no: number | null;
  text: string;
  word_ranges: [number, number][];
};

export type GitHunk = {
  header: string;
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: GitHunkLine[];
};

export type GitDiffHunks = {
  path: string;
  staged: boolean;
  binary: boolean;
  truncated: boolean;
  hunks: GitHunk[];
};

export type HunkSelection = {
  hunk_index: number;
  line_indices: number[] | null;
};

export type SideBySideRow = {
  left: GitHunkLine | null;
  right: GitHunkLine | null;
  hunkIndex: number;
  kind: "context" | "change";
};

export function alignSideBySide(hunks: GitHunk[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  hunks.forEach((hunk, hunkIndex) => {
    let i = 0;
    const lines = hunk.lines;
    while (i < lines.length) {
      const line = lines[i];
      if (line.kind === "context") {
        rows.push({ left: line, right: line, hunkIndex, kind: "context" });
        i += 1;
        continue;
      }
      const dels: GitHunkLine[] = [];
      while (i < lines.length && lines[i].kind === "del") {
        dels.push(lines[i]);
        i += 1;
      }
      const adds: GitHunkLine[] = [];
      while (i < lines.length && lines[i].kind === "add") {
        adds.push(lines[i]);
        i += 1;
      }
      const span = Math.max(dels.length, adds.length);
      for (let n = 0; n < span; n += 1) {
        rows.push({
          left: dels[n] ?? null,
          right: adds[n] ?? null,
          hunkIndex,
          kind: "change",
        });
      }
    }
  });
  return rows;
}

export type DiffSelection = {
  byHunk: Record<number, "all" | Set<number>>;
};

export function createDiffSelection(): DiffSelection {
  return { byHunk: {} };
}

function changeLineIndices(hunk: GitHunk): number[] {
  const indices: number[] = [];
  hunk.lines.forEach((line, index) => {
    if (line.kind !== "context") {
      indices.push(index);
    }
  });
  return indices;
}

export function toggleHunk(
  selection: DiffSelection,
  hunkIndex: number,
  _hunk: GitHunk,
): DiffSelection {
  const byHunk = { ...selection.byHunk };
  if (byHunk[hunkIndex] !== undefined) {
    delete byHunk[hunkIndex];
  } else {
    byHunk[hunkIndex] = "all";
  }
  return { byHunk };
}

export function toggleLine(
  selection: DiffSelection,
  hunkIndex: number,
  lineIndex: number,
  hunk: GitHunk,
): DiffSelection {
  const byHunk = { ...selection.byHunk };
  const current = byHunk[hunkIndex];
  let next: Set<number>;
  if (current === "all") {
    next = new Set(changeLineIndices(hunk));
  } else if (current instanceof Set) {
    next = new Set(current);
  } else {
    next = new Set();
  }
  if (next.has(lineIndex)) {
    next.delete(lineIndex);
  } else if (hunk.lines[lineIndex] && hunk.lines[lineIndex].kind !== "context") {
    next.add(lineIndex);
  }
  if (next.size === 0) {
    delete byHunk[hunkIndex];
  } else {
    byHunk[hunkIndex] = next;
  }
  return { byHunk };
}

export function isHunkSelected(
  selection: DiffSelection,
  hunkIndex: number,
): boolean {
  return selection.byHunk[hunkIndex] !== undefined;
}

export function isLineSelected(
  selection: DiffSelection,
  hunkIndex: number,
  lineIndex: number,
): boolean {
  const entry = selection.byHunk[hunkIndex];
  if (entry === "all") {
    return true;
  }
  if (entry instanceof Set) {
    return entry.has(lineIndex);
  }
  return false;
}

export function hasSelection(selection: DiffSelection): boolean {
  return Object.keys(selection.byHunk).length > 0;
}

export function selectionsForApi(selection: DiffSelection): HunkSelection[] {
  return Object.entries(selection.byHunk)
    .map(([hunkIndex, entry]) => ({
      hunk_index: Number(hunkIndex),
      line_indices:
        entry === "all" ? null : [...entry].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.hunk_index - b.hunk_index);
}

export function hunksToUnifiedText(hunks: GitDiffHunks): string {
  if (hunks.binary) {
    return `Binary file ${hunks.path} differs`;
  }
  const parts: string[] = [];
  for (const hunk of hunks.hunks) {
    parts.push(hunk.header);
    for (const line of hunk.lines) {
      const prefix =
        line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      parts.push(`${prefix}${line.text}`);
    }
  }
  return parts.join("\n");
}
