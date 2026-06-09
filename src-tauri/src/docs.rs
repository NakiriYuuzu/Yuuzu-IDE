use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

pub const MAX_DOC_BYTES: u64 = 512 * 1024;
pub const MAX_DOC_SEARCH_RESULTS: usize = 100;

const MAX_INDEXED_DOCS: usize = 1_000;
const MAX_SCANNED_ENTRIES: usize = 5_000;
const MAX_DOC_SEARCH_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DocIndexEntry {
    pub path: String,
    pub title: String,
    pub section: String,
    pub modified_ms: u64,
    pub size_bytes: u64,
    pub stale: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DocPreview {
    pub path: String,
    pub title: String,
    pub content: String,
    pub modified_ms: u64,
    pub references: Vec<DocReferenceHint>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DocReferenceHint {
    pub target_path: String,
    pub exists: bool,
    pub stale: bool,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DocSearchResult {
    pub matches: Vec<DocSearchMatch>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DocSearchMatch {
    pub path: String,
    pub title: String,
    pub line_number: usize,
    pub line: String,
}

pub fn index_docs(workspace_root: &Path) -> Result<Vec<DocIndexEntry>, String> {
    index_docs_with_budget(workspace_root, DocsBudget::default())
}

fn collect_doc_entries(workspace_root: &Path, budget: DocsBudget) -> Result<DocEntryScan, String> {
    let canonical_root = canonical_workspace_root(workspace_root)?;
    let mut paths = Vec::new();
    let mut scanned_entries = 0;
    let mut truncation_reason = None;

    for file_name in ["README.md", "AGENTS.md", "roadmap.md"] {
        let path = workspace_root.join(file_name);
        scanned_entries += 1;
        if safe_doc_metadata(&canonical_root, &path)?.is_some() {
            paths.push(PathBuf::from(file_name));
        }
    }

    let docs_root = workspace_root.join("docs");
    if docs_root.is_dir() {
        let walker = ignore::WalkBuilder::new(&docs_root)
            .hidden(true)
            .sort_by_file_path(|left, right| left.cmp(right))
            .filter_entry(|entry| !is_skipped_entry(entry.path()))
            .build();

        for entry in walker {
            let entry = entry.map_err(|err| err.to_string())?;
            scanned_entries += 1;
            if scanned_entries > budget.max_scanned_entries {
                truncation_reason = Some("docs scan limit exceeded".to_string());
                break;
            }

            let path = entry.path();
            if path.is_file() && safe_doc_metadata(&canonical_root, path)?.is_some() {
                paths.push(relative_path(workspace_root, path)?);
            }
        }
    }

    paths.sort();
    if paths.len() > budget.max_indexed_docs {
        paths.truncate(budget.max_indexed_docs);
        truncation_reason.get_or_insert_with(|| "docs index limit exceeded".to_string());
    }

    let mut entries = Vec::with_capacity(paths.len());
    for relative in paths {
        let path = workspace_root.join(&relative);
        let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        let metadata = safe_doc_metadata(&canonical_root, &path)?
            .ok_or_else(|| format!("document not found: {}", path_to_slash(&relative)))?;
        let modified_ms = modified_ms(&metadata)?;
        let references = reference_hints(
            &canonical_root,
            workspace_root,
            &relative,
            modified_ms,
            &content,
        )?;

        entries.push(DocIndexEntry {
            path: path_to_slash(&relative),
            title: title_for(&content, &relative),
            section: section_for(&relative),
            modified_ms,
            size_bytes: metadata.len(),
            stale: references.iter().any(|reference| reference.stale),
        });
    }

    Ok(DocEntryScan {
        entries,
        truncation_reason,
    })
}

#[derive(Debug, Clone, Copy)]
struct DocsBudget {
    max_indexed_docs: usize,
    max_scanned_entries: usize,
    max_search_bytes: u64,
}

impl DocsBudget {
    const fn default() -> Self {
        Self {
            max_indexed_docs: MAX_INDEXED_DOCS,
            max_scanned_entries: MAX_SCANNED_ENTRIES,
            max_search_bytes: MAX_DOC_SEARCH_BYTES,
        }
    }

    #[cfg(test)]
    fn for_tests(
        max_indexed_docs: usize,
        max_scanned_entries: usize,
        max_search_bytes: u64,
    ) -> Self {
        Self {
            max_indexed_docs,
            max_scanned_entries,
            max_search_bytes,
        }
    }
}

struct DocEntryScan {
    entries: Vec<DocIndexEntry>,
    truncation_reason: Option<String>,
}

fn index_docs_with_budget(
    workspace_root: &Path,
    budget: DocsBudget,
) -> Result<Vec<DocIndexEntry>, String> {
    let scan = collect_doc_entries(workspace_root, budget)?;
    if let Some(reason) = scan.truncation_reason {
        return Err(reason);
    }
    Ok(scan.entries)
}

pub fn preview_doc(workspace_root: &Path, path: &str) -> Result<DocPreview, String> {
    let canonical_root = canonical_workspace_root(workspace_root)?;
    let relative = normalize_relative_path(Path::new(path))?;
    let full_path = workspace_root.join(&relative);
    let Some(metadata) = safe_doc_metadata(&canonical_root, &full_path)? else {
        return Err(format!("document not found: {path}"));
    };

    let content = fs::read_to_string(&full_path).map_err(|err| err.to_string())?;
    let modified_ms = modified_ms(&metadata)?;
    let references = reference_hints(
        &canonical_root,
        workspace_root,
        &relative,
        modified_ms,
        &content,
    )?;

    Ok(DocPreview {
        path: path_to_slash(&relative),
        title: title_for(&content, &relative),
        content,
        modified_ms,
        references,
    })
}

pub fn search_docs(
    workspace_root: &Path,
    query: &str,
    limit: usize,
) -> Result<DocSearchResult, String> {
    search_docs_with_budget(workspace_root, query, limit, DocsBudget::default())
}

fn search_docs_with_budget(
    workspace_root: &Path,
    query: &str,
    limit: usize,
    budget: DocsBudget,
) -> Result<DocSearchResult, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(DocSearchResult {
            matches: Vec::new(),
            truncated: false,
        });
    }

    let limit = limit.min(MAX_DOC_SEARCH_RESULTS);
    let scan = collect_doc_entries(workspace_root, budget)?;
    let mut matches = Vec::new();
    let mut truncated = scan.truncation_reason.is_some();
    let mut searched_bytes = 0;

    for doc in scan.entries {
        if searched_bytes + doc.size_bytes > budget.max_search_bytes {
            truncated = true;
            break;
        }
        searched_bytes += doc.size_bytes;
        let content =
            fs::read_to_string(workspace_root.join(&doc.path)).map_err(|err| err.to_string())?;
        for (line_index, line) in content.lines().enumerate() {
            if line.contains(query) {
                if matches.len() >= limit {
                    truncated = true;
                    return Ok(DocSearchResult { matches, truncated });
                }
                matches.push(DocSearchMatch {
                    path: doc.path.clone(),
                    title: doc.title.clone(),
                    line_number: line_index + 1,
                    line: line.to_string(),
                });
            }
        }
    }

    Ok(DocSearchResult { matches, truncated })
}

fn is_skipped_entry(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.starts_with('.') || matches!(name, "node_modules" | "target" | "dist")
        })
}

fn canonical_workspace_root(workspace_root: &Path) -> Result<PathBuf, String> {
    workspace_root
        .canonicalize()
        .map_err(|err| format!("workspace root unavailable: {err}"))
}

fn safe_doc_metadata(canonical_root: &Path, path: &Path) -> Result<Option<fs::Metadata>, String> {
    if !is_markdown_doc(path) {
        return Ok(None);
    }

    let Ok(metadata) = fs::symlink_metadata(path) else {
        return Ok(None);
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > MAX_DOC_BYTES {
        return Ok(None);
    }

    let canonical_path = path
        .canonicalize()
        .map_err(|err| format!("document path unavailable: {err}"))?;
    if !canonical_path.starts_with(canonical_root) {
        return Ok(None);
    }

    Ok(Some(metadata))
}

fn is_markdown_doc(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| matches!(extension, "md" | "mdx"))
}

fn relative_path(workspace_root: &Path, path: &Path) -> Result<PathBuf, String> {
    path.strip_prefix(workspace_root)
        .map(Path::to_path_buf)
        .map_err(|err| err.to_string())
}

fn normalize_relative_path(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        return Err("document path must be relative".to_string());
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err("document path escapes workspace".to_string());
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("document path must be relative".to_string());
            }
        }
    }

    Ok(normalized)
}

fn modified_ms(metadata: &fs::Metadata) -> Result<u64, String> {
    let modified = metadata.modified().map_err(|err| err.to_string())?;
    let duration = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?;
    Ok(duration.as_millis() as u64)
}

fn title_for(content: &str, path: &Path) -> String {
    content
        .lines()
        .find_map(|line| {
            let line = line.trim_start();
            if !line.starts_with('#') {
                return None;
            }
            let title = line.trim_start_matches('#').trim();
            if title.is_empty() {
                None
            } else {
                Some(title.to_string())
            }
        })
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("Untitled")
                .to_string()
        })
}

fn section_for(path: &Path) -> String {
    let mut components = path.components();
    if matches!(
        components.next(),
        Some(Component::Normal(segment)) if segment == "docs"
    ) {
        return components
            .next()
            .and_then(|segment| match segment {
                Component::Normal(name) => name.to_str(),
                _ => None,
            })
            .unwrap_or("docs")
            .to_string();
    }
    "workspace".to_string()
}

fn reference_hints(
    canonical_root: &Path,
    workspace_root: &Path,
    doc_path: &Path,
    doc_modified_ms: u64,
    content: &str,
) -> Result<Vec<DocReferenceHint>, String> {
    let mut references = Vec::new();
    for target in markdown_link_targets(content) {
        if !is_workspace_link(&target) {
            continue;
        }

        let target_without_fragment = target.split('#').next().unwrap_or_default();
        if target_without_fragment.is_empty() {
            continue;
        }

        let Some(target_path) = normalize_link_path(doc_path, target_without_fragment)? else {
            continue;
        };
        let full_target = workspace_root.join(&target_path);
        let metadata = workspace_file_metadata(canonical_root, &full_target)?;
        let exists = metadata.is_some();
        let stale = if exists {
            metadata
                .as_ref()
                .map(modified_ms)
                .transpose()?
                .is_some_and(|target_modified_ms| target_modified_ms > doc_modified_ms)
        } else {
            false
        };

        references.push(DocReferenceHint {
            target_path: path_to_slash(&target_path),
            exists,
            stale,
            reason: if stale {
                "referenced file is newer than document".to_string()
            } else if exists {
                "referenced file exists".to_string()
            } else {
                "referenced file is missing".to_string()
            },
        });
    }

    Ok(references)
}

fn workspace_file_metadata(
    canonical_root: &Path,
    path: &Path,
) -> Result<Option<fs::Metadata>, String> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(None);
    };
    if !metadata.is_file() {
        return Ok(None);
    }

    let canonical_path = path
        .canonicalize()
        .map_err(|err| format!("referenced path unavailable: {err}"))?;
    if !canonical_path.starts_with(canonical_root) {
        return Ok(None);
    }

    Ok(Some(metadata))
}

fn markdown_link_targets(content: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let bytes = content.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        let Some(open_bracket) = content[index..].find('[').map(|offset| index + offset) else {
            break;
        };
        let Some(close_bracket) = content[open_bracket..]
            .find(']')
            .map(|offset| open_bracket + offset)
        else {
            break;
        };
        let open_paren = close_bracket + 1;
        if bytes.get(open_paren) != Some(&b'(') {
            index = close_bracket + 1;
            continue;
        }
        let Some(close_paren) = content[open_paren + 1..]
            .find(')')
            .map(|offset| open_paren + 1 + offset)
        else {
            break;
        };
        let target = content[open_paren + 1..close_paren]
            .split_whitespace()
            .next()
            .unwrap_or_default();
        if !target.is_empty() {
            targets.push(target.to_string());
        }
        index = close_paren + 1;
    }

    targets
}

fn is_workspace_link(target: &str) -> bool {
    !target.starts_with('#')
        && !target.starts_with("http://")
        && !target.starts_with("https://")
        && !target.starts_with("mailto:")
}

fn normalize_link_path(doc_path: &Path, target: &str) -> Result<Option<PathBuf>, String> {
    let target = Path::new(target);
    if target.is_absolute() {
        return Ok(None);
    }
    let base = doc_path.parent().unwrap_or_else(|| Path::new(""));
    normalize_relative_path(&base.join(target)).map(Some)
}

fn path_to_slash(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(segment) => segment.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn write_file(path: impl AsRef<Path>, contents: &str) {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent dirs");
        }
        std::fs::write(path, contents).expect("write file");
    }

    #[test]
    fn indexes_workspace_markdown_docs_with_titles_and_sections() {
        let temp = tempfile::tempdir().expect("temp dir");
        write_file(temp.path().join("README.md"), "# Root Readme\n");
        write_file(
            temp.path().join("docs/architecture/overview.md"),
            "# Architecture\n",
        );
        write_file(temp.path().join("docs/guide.mdx"), "# Guide\n");
        write_file(temp.path().join("src/lib.rs"), "fn main() {}\n");

        let entries = index_docs(temp.path()).expect("index docs");

        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>(),
            vec![
                "README.md",
                "docs/architecture/overview.md",
                "docs/guide.mdx"
            ],
        );
        assert_eq!(entries[1].title, "Architecture");
        assert_eq!(entries[1].section, "architecture");
    }

    #[test]
    fn preview_reports_stale_references_to_newer_workspace_files() {
        let temp = tempfile::tempdir().expect("temp dir");
        let doc = temp.path().join("docs/architecture/overview.md");
        let source = temp.path().join("src/lib.rs");
        write_file(&doc, "# Architecture\n\nSee [lib](../../src/lib.rs).\n");
        std::thread::sleep(std::time::Duration::from_millis(20));
        write_file(&source, "fn changed() {}\n");

        let preview = preview_doc(temp.path(), "docs/architecture/overview.md").expect("preview");

        assert_eq!(preview.title, "Architecture");
        assert_eq!(preview.references.len(), 1);
        assert_eq!(preview.references[0].target_path, "src/lib.rs");
        assert!(preview.references[0].exists);
        assert!(preview.references[0].stale);
    }

    #[test]
    fn search_docs_only_reads_markdown_sources_and_caps_matches() {
        let temp = tempfile::tempdir().expect("temp dir");
        write_file(temp.path().join("docs/a.md"), "# A\nagent context\n");
        write_file(temp.path().join("docs/b.mdx"), "# B\nagent context\n");
        write_file(temp.path().join("src/app.ts"), "agent context\n");

        let result = search_docs(temp.path(), "agent", 1).expect("search");

        assert_eq!(result.matches.len(), 1);
        assert!(result.truncated);
        assert!(
            result.matches[0].path.ends_with(".md") || result.matches[0].path.ends_with(".mdx")
        );
    }

    #[cfg(unix)]
    #[test]
    fn preview_rejects_symlink_escape_docs() {
        let temp = tempfile::tempdir().expect("temp dir");
        let outside = tempfile::tempdir().expect("outside dir");
        write_file(outside.path().join("leak.md"), "# Leak\nsecret\n");
        std::fs::create_dir_all(temp.path().join("docs")).expect("create docs");
        std::os::unix::fs::symlink(
            outside.path().join("leak.md"),
            temp.path().join("docs/leak.md"),
        )
        .expect("symlink");

        let result = preview_doc(temp.path(), "docs/leak.md");

        assert!(result.is_err());
    }

    #[cfg(unix)]
    #[test]
    fn preview_rejects_parent_directory_symlink_escape_docs() {
        let temp = tempfile::tempdir().expect("temp dir");
        let outside = tempfile::tempdir().expect("outside dir");
        write_file(outside.path().join("leak.md"), "# Leak\nsecret\n");
        std::fs::create_dir_all(temp.path().join("docs")).expect("create docs");
        std::os::unix::fs::symlink(outside.path(), temp.path().join("docs/outside"))
            .expect("symlink dir");

        let result = preview_doc(temp.path(), "docs/outside/leak.md");

        assert!(result.is_err());
    }

    #[cfg(unix)]
    #[test]
    fn index_and_search_skip_symlink_escape_docs() {
        let temp = tempfile::tempdir().expect("temp dir");
        let outside = tempfile::tempdir().expect("outside dir");
        write_file(temp.path().join("docs/real.md"), "# Real\nsafe context\n");
        write_file(outside.path().join("leak.md"), "# Leak\nsecret context\n");
        std::os::unix::fs::symlink(outside.path(), temp.path().join("docs/outside"))
            .expect("symlink dir");
        std::fs::create_dir_all(temp.path().join("docs/links")).expect("create links");
        std::os::unix::fs::symlink(
            outside.path().join("leak.md"),
            temp.path().join("docs/links/leak.md"),
        )
        .expect("symlink file");

        let entries = index_docs(temp.path()).expect("index docs");
        let result = search_docs(temp.path(), "secret", 10).expect("search");

        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>(),
            vec!["docs/real.md"],
        );
        assert!(result.matches.is_empty());
        assert!(!result.truncated);
    }

    #[test]
    fn index_docs_returns_error_when_doc_budget_is_exceeded() {
        let temp = tempfile::tempdir().expect("temp dir");
        write_file(temp.path().join("docs/a.md"), "# A\n");
        write_file(temp.path().join("docs/b.md"), "# B\n");

        let result = index_docs_with_budget(temp.path(), DocsBudget::for_tests(1, 10, 1024));

        assert!(result.is_err());
        assert!(result
            .expect_err("budget error")
            .contains("docs index limit exceeded"));
    }

    #[test]
    fn search_docs_marks_truncated_when_index_budget_stops_scan() {
        let temp = tempfile::tempdir().expect("temp dir");
        write_file(temp.path().join("docs/a.md"), "# A\nagent context\n");
        write_file(temp.path().join("docs/b.md"), "# B\nagent context\n");

        let result =
            search_docs_with_budget(temp.path(), "agent", 10, DocsBudget::for_tests(1, 10, 1024))
                .expect("search");

        assert_eq!(result.matches.len(), 1);
        assert!(result.truncated);
    }

    #[test]
    fn search_docs_marks_truncated_when_read_budget_is_exceeded() {
        let temp = tempfile::tempdir().expect("temp dir");
        write_file(temp.path().join("docs/a.md"), "# A\nagent context\n");
        write_file(temp.path().join("docs/b.md"), "# B\nagent context\n");

        let result =
            search_docs_with_budget(temp.path(), "agent", 10, DocsBudget::for_tests(10, 10, 20))
                .expect("search");

        assert_eq!(result.matches.len(), 1);
        assert!(result.truncated);
    }
}
