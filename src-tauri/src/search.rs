use ignore::WalkBuilder;
use serde::Serialize;
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

const DEFAULT_MAX_SCANNED_FILES: usize = 1024;
const DEFAULT_MAX_SCANNED_BYTES: u64 = 16 * 1024 * 1024;
const DEFAULT_MAX_LINE_PREVIEW_CHARS: usize = 240;
const MAX_TEXT_HITS_PER_FILE: usize = 5;
const TRUNCATION_MARKER: &str = "...";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FilenameMatch {
    pub path: PathBuf,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TextHit {
    pub line_number: usize,
    pub line: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TextFileMatch {
    pub path: PathBuf,
    pub hits: Vec<TextHit>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct WorkspaceSearchResult {
    pub filename_matches: Vec<FilenameMatch>,
    pub text_matches: Vec<TextFileMatch>,
    pub truncated: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SearchLimits {
    max_results: usize,
    max_file_bytes: u64,
    max_scanned_files: usize,
    max_scanned_bytes: u64,
    max_line_preview_chars: usize,
}

impl SearchLimits {
    fn default_for(max_results: usize, max_file_bytes: u64) -> Self {
        Self {
            max_results,
            max_file_bytes,
            max_scanned_files: DEFAULT_MAX_SCANNED_FILES,
            max_scanned_bytes: DEFAULT_MAX_SCANNED_BYTES,
            max_line_preview_chars: DEFAULT_MAX_LINE_PREVIEW_CHARS,
        }
    }
}

pub fn search_workspace(
    workspace_root: &Path,
    query: &str,
    max_results: usize,
    max_file_bytes: u64,
) -> Result<WorkspaceSearchResult, String> {
    search_workspace_with_limits(
        workspace_root,
        query,
        SearchLimits::default_for(max_results, max_file_bytes),
    )
}

fn search_workspace_with_limits(
    workspace_root: &Path,
    query: &str,
    limits: SearchLimits,
) -> Result<WorkspaceSearchResult, String> {
    let mut builder = WalkBuilder::new(workspace_root);
    builder
        .hidden(false)
        .parents(true)
        .ignore(true)
        .git_ignore(true);

    let entries = builder.build().map(|entry| {
        entry
            .map(|entry| entry.path().to_path_buf())
            .map_err(|err| err.to_string())
    });

    search_entry_paths_with_limits(entries, query, limits)
}

fn search_entry_paths_with_limits(
    entries: impl IntoIterator<Item = Result<PathBuf, String>>,
    query: &str,
    limits: SearchLimits,
) -> Result<WorkspaceSearchResult, String> {
    let query = query.trim().to_lowercase();
    if query.is_empty() || limits.max_results == 0 {
        return Ok(WorkspaceSearchResult::default());
    }

    let mut result = WorkspaceSearchResult::default();
    let mut scanned_files = 0usize;
    let mut scanned_bytes = 0u64;
    for entry in entries {
        let Ok(path) = entry else {
            continue;
        };
        if result_count(&result) >= limits.max_results || scanned_files >= limits.max_scanned_files
        {
            result.truncated = true;
            break;
        }

        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.file_type().is_file() {
            continue;
        }
        let scanned_file_bytes = metadata.len().min(limits.max_file_bytes.saturating_add(1));
        if scanned_bytes.saturating_add(scanned_file_bytes) > limits.max_scanned_bytes {
            result.truncated = true;
            break;
        }
        scanned_files += 1;
        scanned_bytes = scanned_bytes.saturating_add(scanned_file_bytes);

        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        if name.to_lowercase().contains(&query) {
            result.filename_matches.push(FilenameMatch {
                path: path.clone(),
                name,
            });
            if result_count(&result) >= limits.max_results {
                result.truncated = true;
                break;
            }
        }

        if metadata.len() > limits.max_file_bytes {
            continue;
        }
        let Some(content) = read_text_file_bounded(&path, limits.max_file_bytes)? else {
            continue;
        };
        let hits = content
            .lines()
            .enumerate()
            .filter_map(|(index, line)| {
                if line.to_lowercase().contains(&query) {
                    Some(TextHit {
                        line_number: index + 1,
                        line: line_preview(line, limits.max_line_preview_chars),
                    })
                } else {
                    None
                }
            })
            .take(MAX_TEXT_HITS_PER_FILE)
            .collect::<Vec<_>>();
        if !hits.is_empty() {
            result.text_matches.push(TextFileMatch { path, hits });
            if result_count(&result) >= limits.max_results {
                result.truncated = true;
                break;
            }
        }
    }

    sort_result_vectors(&mut result);
    Ok(result)
}

fn sort_result_vectors(result: &mut WorkspaceSearchResult) {
    result
        .filename_matches
        .sort_by(|left, right| left.path.cmp(&right.path));
    result
        .text_matches
        .sort_by(|left, right| left.path.cmp(&right.path));
}

fn read_text_file_bounded(path: &Path, max_file_bytes: u64) -> Result<Option<String>, String> {
    read_text_file_bounded_with(max_file_bytes, |read_limit| {
        let file = File::open(path).map_err(|err| err.to_string())?;
        let mut reader = file.take(read_limit);
        let mut buffer = Vec::new();
        reader
            .read_to_end(&mut buffer)
            .map_err(|err| err.to_string())?;
        Ok(buffer)
    })
}

fn read_text_file_bounded_with(
    max_file_bytes: u64,
    read_file: impl FnOnce(u64) -> Result<Vec<u8>, String>,
) -> Result<Option<String>, String> {
    let Ok(buffer) = read_file(max_file_bytes.saturating_add(1)) else {
        return Ok(None);
    };
    if buffer.len() as u64 > max_file_bytes {
        return Ok(None);
    }

    match String::from_utf8(buffer) {
        Ok(content) => Ok(Some(content)),
        Err(_) => Ok(None),
    }
}

fn line_preview(line: &str, max_chars: usize) -> String {
    if line.chars().count() <= max_chars {
        return line.to_string();
    }
    if max_chars == 0 {
        return String::new();
    }
    if max_chars <= TRUNCATION_MARKER.len() {
        return TRUNCATION_MARKER[..max_chars].to_string();
    }

    let preview_chars = max_chars - TRUNCATION_MARKER.len();
    let mut preview = line.chars().take(preview_chars).collect::<String>();
    preview.push_str(TRUNCATION_MARKER);
    preview
}

fn result_count(result: &WorkspaceSearchResult) -> usize {
    result.filename_matches.len() + result.text_matches.len()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn filename_search_matches_paths_and_limits_results() {
        let root = tempdir().expect("tempdir");
        fs::create_dir(root.path().join("src")).expect("src");
        fs::write(root.path().join("src/server.ts"), "server").expect("server");
        fs::write(root.path().join("src/client.ts"), "client").expect("client");

        let results = super::search_workspace(root.path(), "server", 10, 1024).expect("search");

        assert_eq!(results.filename_matches.len(), 1);
        assert!(results.filename_matches[0].path.ends_with("src/server.ts"));
    }

    #[test]
    fn text_search_reports_line_hits() {
        let root = tempdir().expect("tempdir");
        fs::write(
            root.path().join("main.rs"),
            "fn main() {}\nprintln!(\"hi\");\n",
        )
        .expect("write");

        let results = super::search_workspace(root.path(), "println", 10, 1024).expect("search");

        assert_eq!(results.text_matches.len(), 1);
        assert_eq!(results.text_matches[0].hits[0].line_number, 2);
        assert_eq!(
            results.text_matches[0].hits[0].line.trim(),
            "println!(\"hi\");"
        );
    }

    #[test]
    fn text_search_skips_large_files() {
        let root = tempdir().expect("tempdir");
        fs::write(root.path().join("large.txt"), "x".repeat(2048)).expect("write");

        let results = super::search_workspace(root.path(), "x", 10, 1024).expect("search");

        assert!(results.text_matches.is_empty());
    }

    #[test]
    fn search_limits_total_result_groups() {
        let root = tempdir().expect("tempdir");
        fs::write(root.path().join("needle.txt"), "needle\n").expect("write");

        let results = super::search_workspace(root.path(), "needle", 1, 1024).expect("search");

        assert_eq!(
            results.filename_matches.len() + results.text_matches.len(),
            1
        );
        assert!(results.truncated);
    }

    #[test]
    fn search_truncates_long_line_previews() {
        let root = tempdir().expect("tempdir");
        let line = format!("needle {}", "x".repeat(400));
        fs::write(root.path().join("long.txt"), line).expect("write");

        let results = super::search_workspace(root.path(), "needle", 10, 1024).expect("search");
        let preview = &results.text_matches[0].hits[0].line;

        assert!(preview.len() <= 240);
        assert!(preview.ends_with("..."));
    }

    #[test]
    fn search_stops_after_scanned_file_limit() {
        let root = tempdir().expect("tempdir");
        for index in 0..1100 {
            fs::write(root.path().join(format!("file-{index}.txt")), "hay").expect("write");
        }

        let results = super::search_workspace(root.path(), "needle", 10, 1024).expect("search");

        assert!(results.filename_matches.is_empty());
        assert!(results.text_matches.is_empty());
        assert!(results.truncated);
    }

    #[test]
    fn bounded_reader_skips_files_that_exceed_byte_limit() {
        let root = tempdir().expect("tempdir");
        let path = root.path().join("growing.txt");
        fs::write(&path, "needle plus extra").expect("write");

        let content = super::read_text_file_bounded(&path, 6).expect("bounded read");

        assert!(content.is_none());
    }

    #[test]
    fn bounded_reader_skips_files_that_cannot_be_opened() {
        let root = tempdir().expect("tempdir");
        let missing = root.path().join("missing.txt");

        let content = super::read_text_file_bounded(&missing, 1024).expect("bounded read");

        assert!(content.is_none());
    }

    #[test]
    fn bounded_reader_skips_read_failures() {
        let content = super::read_text_file_bounded_with(1024, |_| Err("read failed".to_string()))
            .expect("bounded read");

        assert!(content.is_none());
    }

    #[test]
    fn search_skips_entry_errors() {
        let root = tempdir().expect("tempdir");
        let path = root.path().join("needle.txt");
        fs::write(&path, "needle").expect("write");

        let results = super::search_entry_paths_with_limits(
            [Err("walk failed".to_string()), Ok(path)],
            "needle",
            super::SearchLimits::default_for(10, 1024),
        )
        .expect("search");

        assert_eq!(results.filename_matches.len(), 1);
    }

    #[test]
    fn search_skips_metadata_failures() {
        let root = tempdir().expect("tempdir");
        let missing = root.path().join("missing.txt");
        let readable = root.path().join("readable.txt");
        fs::write(&readable, "needle").expect("write");

        let results = super::search_entry_paths_with_limits(
            [Ok(missing), Ok(readable)],
            "needle",
            super::SearchLimits::default_for(10, 1024),
        )
        .expect("search");

        assert_eq!(results.text_matches.len(), 1);
        assert!(results.text_matches[0].path.ends_with("readable.txt"));
    }

    #[test]
    fn search_sorts_bounded_result_vectors() {
        let root = tempdir().expect("tempdir");
        let a = root.path().join("a-needle.txt");
        let b = root.path().join("b-needle.txt");
        fs::write(&a, "needle").expect("write a");
        fs::write(&b, "needle").expect("write b");

        let results = super::search_entry_paths_with_limits(
            [Ok(b), Ok(a)],
            "needle",
            super::SearchLimits::default_for(10, 1024),
        )
        .expect("search");

        let filename_names = results
            .filename_matches
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>();
        let text_names = results
            .text_matches
            .iter()
            .map(|entry| {
                entry
                    .path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>();

        assert_eq!(filename_names, ["a-needle.txt", "b-needle.txt"]);
        assert_eq!(text_names, ["a-needle.txt", "b-needle.txt"]);
    }
}
