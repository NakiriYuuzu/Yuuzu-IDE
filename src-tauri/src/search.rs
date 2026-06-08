use ignore::WalkBuilder;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

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

pub fn search_workspace(
    workspace_root: &Path,
    query: &str,
    max_results: usize,
    max_file_bytes: u64,
) -> Result<WorkspaceSearchResult, String> {
    let query = query.trim().to_lowercase();
    if query.is_empty() || max_results == 0 {
        return Ok(WorkspaceSearchResult::default());
    }

    let mut result = WorkspaceSearchResult::default();
    let mut builder = WalkBuilder::new(workspace_root);
    builder
        .hidden(false)
        .parents(true)
        .ignore(true)
        .git_ignore(true)
        .sort_by_file_path(|left, right| left.cmp(right));

    for entry in builder.build() {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let Some(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        if result.filename_matches.len() + result.text_matches.len() >= max_results {
            result.truncated = true;
            break;
        }

        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        if name.to_lowercase().contains(&query) {
            result.filename_matches.push(FilenameMatch {
                path: path.to_path_buf(),
                name,
            });
            if result_count(&result) >= max_results {
                result.truncated = true;
                break;
            }
        }

        let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
        if metadata.len() > max_file_bytes {
            continue;
        }
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        let hits = content
            .lines()
            .enumerate()
            .filter_map(|(index, line)| {
                if line.to_lowercase().contains(&query) {
                    Some(TextHit {
                        line_number: index + 1,
                        line: line.to_string(),
                    })
                } else {
                    None
                }
            })
            .take(5)
            .collect::<Vec<_>>();
        if !hits.is_empty() {
            result.text_matches.push(TextFileMatch {
                path: path.to_path_buf(),
                hits,
            });
            if result_count(&result) >= max_results {
                result.truncated = true;
                break;
            }
        }
    }

    Ok(result)
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
}
