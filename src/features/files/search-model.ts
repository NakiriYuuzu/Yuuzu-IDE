export type FilenameMatch = {
  path: string;
  name: string;
};

export type TextHit = {
  line_number: number;
  line: string;
};

export type TextFileMatch = {
  path: string;
  hits: TextHit[];
};

export type WorkspaceSearchResult = {
  filename_matches: FilenameMatch[];
  text_matches: TextFileMatch[];
  truncated: boolean;
};

export function searchSummary(result: WorkspaceSearchResult): string {
  const fileCount = new Set([
    ...result.filename_matches.map((item) => item.path),
    ...result.text_matches.map((item) => item.path),
  ]).size;
  const hitCount =
    result.filename_matches.length +
    result.text_matches.reduce((sum, item) => sum + item.hits.length, 0);

  return `${hitCount} ${hitCount === 1 ? "match" : "matches"} in ${fileCount} ${
    fileCount === 1 ? "file" : "files"
  }`;
}
