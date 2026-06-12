use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::git;

pub const MAX_LANES: usize = 12;
pub const LOG_PAGE_SIZE: usize = 200;
pub const MAX_LOG_ROWS: usize = 2_000;

#[derive(Debug, Clone)]
pub struct TopoCommit {
    pub hash: String,
    pub parents: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    Through,
    Fork,
    Join,
    Stop,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphEdge {
    pub from_lane: u8,
    pub to_lane: u8,
    pub kind: EdgeKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefKind {
    Head,
    Branch,
    Tag,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitRef {
    pub name: String,
    pub kind: RefKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitLogRow {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub when_unix: i64,
    pub refs: Vec<GitRef>,
    pub parents: Vec<String>,
    pub lane: u8,
    pub lane_overflow: bool,
    pub merge: bool,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GitLogFilter {
    /// Ref name; None = HEAD history, Some("--all") = all refs.
    pub branch: Option<String>,
    pub author: Option<String>,
    /// e.g. "2.weeks"
    pub since: Option<String>,
    pub grep: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLogPage {
    pub rows: Vec<GitLogRow>,
    pub has_more: bool,
    pub total_loaded: usize,
    pub truncated: bool,
}

struct LaneStamped {
    lane: u8,
    lane_overflow: bool,
    edges: Vec<GraphEdge>,
    merge: bool,
}

fn clamp_lane(i: usize) -> u8 {
    i.min(MAX_LANES - 1) as u8
}

fn assign_lanes(commits: &[TopoCommit]) -> Vec<LaneStamped> {
    let mut active: Vec<Option<String>> = Vec::new();
    let mut out = Vec::with_capacity(commits.len());

    for c in commits {
        let mut edges = Vec::new();
        // find or allocate this commit's lane
        let lane = match active
            .iter()
            .position(|s| s.as_deref() == Some(c.hash.as_str()))
        {
            Some(i) => i,
            None => match active.iter().position(Option::is_none) {
                Some(i) => {
                    active[i] = Some(c.hash.clone());
                    i
                }
                None => {
                    active.push(Some(c.hash.clone()));
                    active.len() - 1
                }
            },
        };
        // every other occupied lane passes through, except the ones joining below
        for (i, slot) in active.iter().enumerate() {
            if i != lane && slot.is_some() && slot.as_deref() != Some(c.hash.as_str()) {
                let li = clamp_lane(i);
                edges.push(GraphEdge {
                    from_lane: li,
                    to_lane: li,
                    kind: EdgeKind::Through,
                });
            }
        }
        // all OTHER lanes waiting for this same hash join into `lane`
        for (i, slot) in active.iter_mut().enumerate() {
            if i != lane && slot.as_deref() == Some(c.hash.as_str()) {
                edges.push(GraphEdge {
                    from_lane: clamp_lane(i),
                    to_lane: clamp_lane(lane),
                    kind: EdgeKind::Join,
                });
                *slot = None;
            }
        }
        // distribute parents
        match c.parents.split_first() {
            None => {
                edges.push(GraphEdge {
                    from_lane: clamp_lane(lane),
                    to_lane: clamp_lane(lane),
                    kind: EdgeKind::Stop,
                });
                active[lane] = None;
            }
            Some((first, rest)) => {
                active[lane] = Some(first.clone());
                for p in rest {
                    if let Some(existing) =
                        active.iter().position(|s| s.as_deref() == Some(p.as_str()))
                    {
                        edges.push(GraphEdge {
                            from_lane: clamp_lane(lane),
                            to_lane: clamp_lane(existing),
                            kind: EdgeKind::Fork,
                        });
                    } else {
                        let slot = active.iter().position(Option::is_none).unwrap_or_else(|| {
                            active.push(None);
                            active.len() - 1
                        });
                        active[slot] = Some(p.clone());
                        edges.push(GraphEdge {
                            from_lane: clamp_lane(lane),
                            to_lane: clamp_lane(slot),
                            kind: EdgeKind::Fork,
                        });
                    }
                }
            }
        }
        let lane_overflow = lane >= MAX_LANES;
        out.push(LaneStamped {
            lane: clamp_lane(lane),
            lane_overflow,
            edges,
            merge: c.parents.len() > 1,
        });
    }
    out
}

pub(crate) fn parse_refs(decoration: &str) -> Vec<GitRef> {
    decoration
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            if let Some(rest) = s.strip_prefix("HEAD -> ") {
                GitRef {
                    name: rest.to_string(),
                    kind: RefKind::Head,
                }
            } else if s == "HEAD" {
                GitRef {
                    name: "HEAD".to_string(),
                    kind: RefKind::Head,
                }
            } else if let Some(rest) = s.strip_prefix("tag: ") {
                GitRef {
                    name: rest.to_string(),
                    kind: RefKind::Tag,
                }
            } else {
                GitRef {
                    name: s.to_string(),
                    kind: RefKind::Branch,
                }
            }
        })
        .collect()
}

// Pagination model: the frontend always requests `limit = page_count * 200` from
// offset 0 and Rust recomputes lanes over the whole loaded prefix — lanes stay
// consistent across "load more", the payload stays bounded by MAX_LOG_ROWS, and
// `git log` is fast enough for this on personal-scale repos. Past 2,000 rows the
// UI directs users to filters.
pub fn log_page(
    workspace_root: &Path,
    filter: &GitLogFilter,
    limit: usize,
) -> Result<GitLogPage, String> {
    let limit = limit.clamp(1, MAX_LOG_ROWS);
    let mut args: Vec<String> = vec![
        "log".into(),
        "--topo-order".into(),
        "-z".into(),
        "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s".into(),
        "-n".into(),
        (limit + 1).to_string(),
    ];
    match filter.branch.as_deref() {
        None => {}
        Some("--all") => args.push("--all".into()),
        Some(branch) => {
            let b = branch.trim();
            if b.is_empty() || b.starts_with('-') {
                return Err("invalid branch filter".to_string());
            }
            args.push(b.to_string());
        }
    }
    if let Some(a) = filter.author.as_deref().filter(|s| !s.trim().is_empty()) {
        args.push(format!("--author={}", a.trim()));
    }
    if let Some(s) = filter.since.as_deref().filter(|s| !s.trim().is_empty()) {
        args.push(format!("--since={}", s.trim()));
    }
    if let Some(g) = filter.grep.as_deref().filter(|s| !s.trim().is_empty()) {
        args.push(format!("--grep={}", g.trim()));
        args.push("--regexp-ignore-case".into());
    }
    if let Some(p) = filter.path.as_deref().filter(|s| !s.trim().is_empty()) {
        let normalized = git::normalize_repo_relative_paths(Path::new(""), &[p.to_string()])?;
        args.push("--".into());
        args.push(normalized[0].to_string_lossy().into_owned());
    }
    let output = git::run_git_in(workspace_root, &args)?;
    let (mut topo, mut meta) = parse_log_records(&output);
    let has_more = topo.len() > limit;
    topo.truncate(limit);
    meta.truncate(limit);
    let lanes = assign_lanes(&topo);
    let rows = topo
        .into_iter()
        .zip(meta)
        .zip(lanes)
        .map(|((t, m), l)| GitLogRow {
            hash: t.hash,
            short_hash: m.short_hash,
            subject: m.subject,
            author: m.author,
            when_unix: m.when_unix,
            refs: m.refs,
            parents: t.parents,
            lane: l.lane,
            lane_overflow: l.lane_overflow,
            merge: l.merge,
            edges: l.edges,
        })
        .collect::<Vec<_>>();
    let total_loaded = rows.len();
    Ok(GitLogPage {
        rows,
        has_more,
        total_loaded,
        truncated: total_loaded >= MAX_LOG_ROWS,
    })
}

pub(crate) struct LogMeta {
    pub short_hash: String,
    pub author: String,
    pub when_unix: i64,
    pub refs: Vec<GitRef>,
    pub subject: String,
}

pub(crate) fn parse_log_records(output: &[u8]) -> (Vec<TopoCommit>, Vec<LogMeta>) {
    let mut topo = Vec::new();
    let mut meta = Vec::new();
    for record in output.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        let text = String::from_utf8_lossy(record);
        let f: Vec<&str> = text.split('\u{1f}').collect();
        if f.len() < 7 {
            continue;
        }
        topo.push(TopoCommit {
            hash: f[0].to_string(),
            parents: f[2].split_whitespace().map(String::from).collect(),
        });
        meta.push(LogMeta {
            short_hash: f[1].to_string(),
            author: f[3].to_string(),
            when_unix: f[4].parse::<i64>().unwrap_or(0),
            refs: parse_refs(f[5]),
            subject: f[6].to_string(),
        });
    }
    (topo, meta)
}

pub const MAX_DETAIL_FILES: usize = 500;
pub const MAX_EXPORT_FILES: usize = 2_000;
pub const MAX_EXPORT_BYTES: u64 = 200 * 1_024 * 1_024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitFileChange {
    pub status: String,
    pub path: String,
    pub old_path: Option<String>,
    pub additions: i64,
    pub deletions: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommitDetail {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub body: String,
    pub author: String,
    pub author_email: String,
    pub when_unix: i64,
    pub parents: Vec<String>,
    pub refs: Vec<GitRef>,
    pub files: Vec<CommitFileChange>,
    pub files_truncated: bool,
}

fn validate_hash(hash: &str) -> Result<String, String> {
    let h = hash.trim();
    if h.len() >= 6 && h.len() <= 64 && h.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(h.to_string())
    } else {
        Err("invalid commit hash".to_string())
    }
}

fn short_hash_of(workspace_root: &Path, hash: &str) -> Result<String, String> {
    let output = git::run_git_in(
        workspace_root,
        &["rev-parse".into(), "--short".into(), hash.to_string()],
    )?;
    Ok(String::from_utf8_lossy(&output).trim().to_string())
}

// `-m --first-parent` makes merge commits report their first-parent diff
// (plain diff-tree prints nothing for merges); `-M` detects renames.
fn change_list_args(format_flag: &str, hash: &str) -> Vec<String> {
    vec![
        "diff-tree".into(),
        "-m".into(),
        "--first-parent".into(),
        "-M".into(),
        "--no-commit-id".into(),
        format_flag.into(),
        "-r".into(),
        "-z".into(),
        "--root".into(),
        hash.to_string(),
    ]
}

pub fn commit_detail(workspace_root: &Path, hash: &str) -> Result<GitCommitDetail, String> {
    let hash = validate_hash(hash)?;
    let meta = git::run_git_in(
        workspace_root,
        &[
            "show".into(),
            "--no-patch".into(),
            "--pretty=format:%H%x1f%h%x1f%s%x1f%b%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%D".into(),
            hash.clone(),
        ],
    )?;
    let text = String::from_utf8_lossy(&meta);
    let f: Vec<&str> = text.split('\u{1f}').collect();
    if f.len() < 9 {
        return Err("unexpected git show output".into());
    }

    let status_out = git::run_git_in(workspace_root, &change_list_args("--name-status", &hash))?;
    let numstat_out = git::run_git_in(workspace_root, &change_list_args("--numstat", &hash))?;
    let (files, files_truncated) = parse_change_lists(&status_out, &numstat_out, MAX_DETAIL_FILES)?;

    Ok(GitCommitDetail {
        hash: f[0].into(),
        short_hash: f[1].into(),
        subject: f[2].into(),
        body: f[3].trim().into(),
        author: f[4].into(),
        author_email: f[5].into(),
        when_unix: f[6].parse().unwrap_or(0),
        parents: f[7].split_whitespace().map(String::from).collect(),
        refs: parse_refs(f[8]),
        files,
        files_truncated,
    })
}

struct NameStatusEntry {
    status: String,
    path: String,
    old_path: Option<String>,
}

fn parse_name_status(output: &[u8]) -> Result<Vec<NameStatusEntry>, String> {
    let text = String::from_utf8_lossy(output);
    let mut records = text.split('\0').filter(|r| !r.is_empty());
    let mut entries = Vec::new();
    while let Some(status) = records.next() {
        let status = status.trim();
        if status.is_empty() {
            continue;
        }
        if status.starts_with('R') || status.starts_with('C') {
            let old = records.next().ok_or("missing rename source path")?;
            let new = records.next().ok_or("missing rename target path")?;
            entries.push(NameStatusEntry {
                status: status.chars().take(1).collect(),
                path: new.to_string(),
                old_path: Some(old.to_string()),
            });
        } else {
            let path = records.next().ok_or("missing change path")?;
            entries.push(NameStatusEntry {
                status: status.to_string(),
                path: path.to_string(),
                old_path: None,
            });
        }
    }
    Ok(entries)
}

fn parse_numstat(output: &[u8]) -> Result<std::collections::HashMap<String, (i64, i64)>, String> {
    let text = String::from_utf8_lossy(output);
    let mut records = text.split('\0').filter(|r| !r.is_empty());
    let mut stats = std::collections::HashMap::new();
    while let Some(record) = records.next() {
        let mut parts = record.splitn(3, '\t');
        let additions = parts.next().unwrap_or("-").trim();
        let deletions = parts.next().unwrap_or("-").trim();
        let path = parts.next().unwrap_or("");
        // "-" marks binary files
        let additions: i64 = additions.parse().unwrap_or(0);
        let deletions: i64 = deletions.parse().unwrap_or(0);
        if path.is_empty() {
            // rename record: stat fields end the record, two NUL-separated paths follow
            let _old = records.next().ok_or("missing numstat rename source")?;
            let new = records.next().ok_or("missing numstat rename target")?;
            stats.insert(new.to_string(), (additions, deletions));
        } else {
            stats.insert(path.to_string(), (additions, deletions));
        }
    }
    Ok(stats)
}

fn parse_change_lists(
    status_out: &[u8],
    numstat_out: &[u8],
    max_files: usize,
) -> Result<(Vec<CommitFileChange>, bool), String> {
    let entries = parse_name_status(status_out)?;
    let stats = parse_numstat(numstat_out)?;
    let truncated = entries.len() > max_files;
    let files = entries
        .into_iter()
        .take(max_files)
        .map(|entry| {
            let (additions, deletions) = stats.get(&entry.path).copied().unwrap_or((0, 0));
            CommitFileChange {
                status: entry.status,
                path: entry.path,
                old_path: entry.old_path,
                additions,
                deletions,
            }
        })
        .collect();
    Ok((files, truncated))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportScope {
    ChangedFiles,
    Snapshot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Folder,
    Zip,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportReport {
    pub written_files: usize,
    pub total_bytes: u64,
    pub skipped_deleted: usize,
    pub destination: String,
}

pub fn export_commit(
    workspace_root: &Path,
    hash: &str,
    scope: ExportScope,
    format: ExportFormat,
    dest: &Path,
    overwrite: bool,
) -> Result<ExportReport, String> {
    let hash = validate_hash(hash)?;
    std::fs::create_dir_all(dest).map_err(|err| err.to_string())?;
    match (scope, format) {
        (ExportScope::ChangedFiles, ExportFormat::Folder) => {
            export_changed_to_folder(workspace_root, &hash, dest, overwrite)
        }
        (ExportScope::ChangedFiles, ExportFormat::Zip) => {
            let tmp = tempfile::tempdir().map_err(|err| err.to_string())?;
            let mut report = export_changed_to_folder(workspace_root, &hash, tmp.path(), true)?;
            let zip_path = dest.join(format!("{}-changed.zip", &hash[..7.min(hash.len())]));
            if zip_path.exists() && !overwrite {
                return Err(format!("destination exists: {}", zip_path.display()));
            }
            zip_directory(tmp.path(), &zip_path)?;
            report.destination = zip_path.display().to_string();
            Ok(report)
        }
        (ExportScope::Snapshot, ExportFormat::Zip) => {
            let zip_path = dest.join(format!("{}-snapshot.zip", &hash[..7.min(hash.len())]));
            if zip_path.exists() && !overwrite {
                return Err(format!("destination exists: {}", zip_path.display()));
            }
            git::run_git_in(
                workspace_root,
                &[
                    "archive".into(),
                    "--format=zip".into(),
                    "-o".into(),
                    zip_path.display().to_string(),
                    hash.clone(),
                ],
            )?;
            let bytes = std::fs::metadata(&zip_path).map(|m| m.len()).unwrap_or(0);
            if bytes > MAX_EXPORT_BYTES {
                let _ = std::fs::remove_file(&zip_path);
                return Err("snapshot exceeds 200 MB bound".into());
            }
            Ok(ExportReport {
                written_files: 1,
                total_bytes: bytes,
                skipped_deleted: 0,
                destination: zip_path.display().to_string(),
            })
        }
        (ExportScope::Snapshot, ExportFormat::Folder) => {
            let tmp = tempfile::NamedTempFile::new().map_err(|err| err.to_string())?;
            git::run_git_in(
                workspace_root,
                &[
                    "archive".into(),
                    "--format=zip".into(),
                    "-o".into(),
                    tmp.path().display().to_string(),
                    hash.clone(),
                ],
            )?;
            unzip_into(tmp.path(), dest, overwrite)
        }
    }
}

fn export_changed_to_folder(
    workspace_root: &Path,
    hash: &str,
    dest: &Path,
    overwrite: bool,
) -> Result<ExportReport, String> {
    let status_out = git::run_git_in(workspace_root, &change_list_args("--name-status", hash))?;
    let entries = parse_name_status(&status_out)?;
    let kept: Vec<_> = entries.iter().filter(|e| e.status != "D").collect();
    let skipped_deleted = entries.len() - kept.len();
    if kept.len() > MAX_EXPORT_FILES {
        return Err(format!(
            "{} files exceeds the 2000-file bound; use a snapshot zip instead",
            kept.len()
        ));
    }

    if !overwrite {
        let conflicts: Vec<String> = kept
            .iter()
            .filter(|e| dest.join(&e.path).exists())
            .map(|e| e.path.clone())
            .take(20)
            .collect();
        if !conflicts.is_empty() {
            return Err(format!(
                "destination already contains: {}",
                conflicts.join(", ")
            ));
        }
    }

    let mut total_bytes = 0u64;
    let mut written_files = 0usize;
    for entry in &kept {
        let normalized =
            git::normalize_repo_relative_paths(Path::new(""), std::slice::from_ref(&entry.path))?;
        let bytes = git::run_git_in(
            workspace_root,
            &["show".into(), format!("{hash}:{}", entry.path)],
        )?;
        total_bytes += bytes.len() as u64;
        if total_bytes > MAX_EXPORT_BYTES {
            return Err("export exceeds 200 MB bound; use a snapshot zip instead".into());
        }
        let target = dest.join(&normalized[0]);
        if !target.starts_with(dest) {
            return Err(format!("export path escapes destination: {}", entry.path));
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        std::fs::write(&target, &bytes).map_err(|err| err.to_string())?;
        written_files += 1;
    }
    Ok(ExportReport {
        written_files,
        total_bytes,
        skipped_deleted,
        destination: dest.display().to_string(),
    })
}

fn zip_directory(source: &Path, zip_path: &Path) -> Result<(), String> {
    use std::io::Write;

    let file = std::fs::File::create(zip_path).map_err(|err| err.to_string())?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    fn walk(
        writer: &mut zip::ZipWriter<std::fs::File>,
        options: zip::write::SimpleFileOptions,
        root: &Path,
        dir: &Path,
    ) -> Result<(), String> {
        let mut entries: Vec<_> = std::fs::read_dir(dir)
            .map_err(|err| err.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|err| err.to_string())?;
        entries.sort_by_key(|e| e.path());
        for entry in entries {
            let path = entry.path();
            if path.is_dir() {
                walk(writer, options, root, &path)?;
            } else {
                let name = path
                    .strip_prefix(root)
                    .map_err(|err| err.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/");
                writer
                    .start_file(&name, options)
                    .map_err(|err| err.to_string())?;
                let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
                writer.write_all(&bytes).map_err(|err| err.to_string())?;
            }
        }
        Ok(())
    }

    walk(&mut writer, options, source, source)?;
    writer.finish().map_err(|err| err.to_string())?;
    Ok(())
}

fn unzip_into(zip_path: &Path, dest: &Path, overwrite: bool) -> Result<ExportReport, String> {
    let file = std::fs::File::open(zip_path).map_err(|err| err.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|err| err.to_string())?;

    let mut written_files = 0usize;
    let mut total_bytes = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|err| err.to_string())?;
        // zip-slip guard: enclosed_name rejects entries escaping the destination
        let Some(relative) = entry.enclosed_name() else {
            return Err(format!("zip entry escapes destination: {}", entry.name()));
        };
        let target = dest.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(|err| err.to_string())?;
            continue;
        }
        if target.exists() && !overwrite {
            return Err(format!("destination exists: {}", target.display()));
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let mut output = std::fs::File::create(&target).map_err(|err| err.to_string())?;
        let copied = std::io::copy(&mut entry, &mut output).map_err(|err| err.to_string())?;
        total_bytes += copied;
        written_files += 1;
        if total_bytes > MAX_EXPORT_BYTES {
            return Err("export exceeds 200 MB bound".into());
        }
    }
    Ok(ExportReport {
        written_files,
        total_bytes,
        skipped_deleted: 0,
        destination: dest.display().to_string(),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

pub fn cherry_pick(workspace_root: &Path, hash: &str) -> Result<git::GitRepositoryStatus, String> {
    let hash = validate_hash(hash)?;
    let result = git::run_git_in(workspace_root, &["cherry-pick".into(), hash]);
    if let Err(err) = result {
        let _ = git::run_git_in(workspace_root, &["cherry-pick".into(), "--abort".into()]);
        return Err(err);
    }
    git::repository_status(workspace_root)
}

pub fn revert_commit(
    workspace_root: &Path,
    hash: &str,
    confirmation: &str,
) -> Result<git::GitRepositoryStatus, String> {
    let hash = validate_hash(hash)?;
    let short = short_hash_of(workspace_root, &hash)?;
    git::require_confirmation(confirmation, &format!("REVERT {short}"))?;
    let result = git::run_git_in(workspace_root, &["revert".into(), "--no-edit".into(), hash]);
    if let Err(err) = result {
        let _ = git::run_git_in(workspace_root, &["revert".into(), "--abort".into()]);
        return Err(err);
    }
    git::repository_status(workspace_root)
}

pub fn reset_to(
    workspace_root: &Path,
    hash: &str,
    mode: ResetMode,
    confirmation: &str,
) -> Result<git::GitRepositoryStatus, String> {
    let hash = validate_hash(hash)?;
    let short = short_hash_of(workspace_root, &hash)?;
    let (expected, flag) = match mode {
        ResetMode::Soft => (format!("RESET {short}"), "--soft"),
        ResetMode::Mixed => (format!("RESET {short}"), "--mixed"),
        ResetMode::Hard => (format!("RESET HARD {short}"), "--hard"),
    };
    git::require_confirmation(confirmation, &expected)?;
    git::run_git_in(workspace_root, &["reset".into(), flag.into(), hash])?;
    git::repository_status(workspace_root)
}

pub fn commit_file_diff(
    workspace_root: &Path,
    hash: &str,
    path: &str,
) -> Result<git::GitDiffHunks, String> {
    let hash = validate_hash(hash)?;
    let normalized = git::normalize_repo_relative_paths(Path::new(""), &[path.to_string()])?;
    let output = git::run_git_in(
        workspace_root,
        &[
            "show".into(),
            "-m".into(),
            "--first-parent".into(),
            "--no-ext-diff".into(),
            "--no-color".into(),
            "--pretty=format:".into(),
            hash,
            "--".into(),
            normalized[0].to_string_lossy().into_owned(),
        ],
    )?;
    let truncated_bytes = output.len() > git::GIT_DIFF_LIMIT_BYTES;
    let visible = if truncated_bytes {
        &output[..git::GIT_DIFF_LIMIT_BYTES]
    } else {
        &output[..]
    };
    let raw = String::from_utf8_lossy(visible);
    let mut parsed = git::parse_unified_diff(&raw, git::MAX_DIFF_HUNKS, git::MAX_DIFF_TOTAL_LINES)?;
    parsed.path = normalized[0].to_string_lossy().into_owned();
    parsed.truncated = parsed.truncated || truncated_bytes;
    git::attach_word_ranges(&mut parsed);
    Ok(parsed)
}

pub fn file_history(workspace_root: &Path, path: &str, limit: usize) -> Result<GitLogPage, String> {
    let normalized = git::normalize_repo_relative_paths(Path::new(""), &[path.to_string()])?;
    let limit = limit.clamp(1, MAX_LOG_ROWS);
    let args: Vec<String> = vec![
        "log".into(),
        "--follow".into(),
        "-z".into(),
        "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s".into(),
        "-n".into(),
        (limit + 1).to_string(),
        "--".into(),
        normalized[0].to_string_lossy().into_owned(),
    ];
    let output = git::run_git_in(workspace_root, &args)?;
    let (mut topo, mut meta) = parse_log_records(&output);
    let has_more = topo.len() > limit;
    topo.truncate(limit);
    meta.truncate(limit);
    // single-file history renders as a linear list: every row stays on lane 0
    let rows = topo
        .into_iter()
        .zip(meta)
        .map(|(t, m)| GitLogRow {
            hash: t.hash,
            short_hash: m.short_hash,
            subject: m.subject,
            author: m.author,
            when_unix: m.when_unix,
            refs: m.refs,
            parents: t.parents,
            lane: 0,
            lane_overflow: false,
            merge: false,
            edges: Vec::new(),
        })
        .collect::<Vec<_>>();
    let total_loaded = rows.len();
    Ok(GitLogPage {
        rows,
        has_more,
        total_loaded,
        truncated: total_loaded >= MAX_LOG_ROWS,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(hash: &str, parents: &[&str]) -> TopoCommit {
        TopoCommit {
            hash: hash.into(),
            parents: parents.iter().map(|p| p.to_string()).collect(),
        }
    }

    #[test]
    fn linear_history_stays_on_lane_zero() {
        let rows = assign_lanes(&[input("c", &["b"]), input("b", &["a"]), input("a", &[])]);
        assert!(rows.iter().all(|r| r.lane == 0));
        assert!(rows[2].edges.iter().any(|e| e.kind == EdgeKind::Stop));
    }

    #[test]
    fn merge_forks_second_parent_to_new_lane_and_branch_point_joins_back() {
        // m merges f into mainline: m(parents: b, f) ; f(parent: a) ; b(parent: a) ; a(root)
        let rows = assign_lanes(&[
            input("m", &["b", "f"]),
            input("f", &["a"]),
            input("b", &["a"]),
            input("a", &[]),
        ]);
        assert_eq!(rows[0].lane, 0);
        assert!(rows[0].merge);
        assert!(rows[0]
            .edges
            .iter()
            .any(|e| e.kind == EdgeKind::Fork && e.to_lane == 1));
        assert_eq!(rows[1].lane, 1, "feature commit stays on lane 1");
        assert_eq!(rows[2].lane, 0);
        // both lane 0 (via b) and lane 1 (via f) wait for "a" → join at a
        let a_row = &rows[3];
        assert_eq!(a_row.lane, 0);
        assert!(a_row
            .edges
            .iter()
            .any(|e| e.kind == EdgeKind::Join && e.from_lane == 1));
    }

    #[test]
    fn lanes_clamp_at_max_and_flag_overflow() {
        // octopus-ish: one commit with 14 parents
        let parents: Vec<String> = (0..14).map(|i| format!("p{i}")).collect();
        let head = TopoCommit {
            hash: "h".into(),
            parents: parents.clone(),
        };
        let mut commits = vec![head];
        commits.extend(parents.iter().map(|p| TopoCommit {
            hash: p.clone(),
            parents: vec![],
        }));
        let rows = assign_lanes(&commits);
        assert!(rows.iter().all(|r| (r.lane as usize) < MAX_LANES));
        assert!(rows.iter().any(|r| r.lane_overflow));
    }

    pub(crate) fn temp_repo_with_merge() -> crate::git::tests::TempGitRepo {
        let repo = crate::git::tests::TempGitRepo::new();
        repo.write_file("a.txt", "1\n");
        repo.run(["add", "."]);
        repo.run(["commit", "-m", "first"]);
        repo.run(["branch", "-M", "main"]);
        repo.run(["checkout", "-b", "feat"]);
        repo.write_file("b.txt", "2\n");
        repo.run(["add", "."]);
        repo.run(["commit", "-m", "feat work"]);
        repo.run(["checkout", "main"]);
        repo.write_file("a.txt", "1\n1\n");
        repo.run(["add", "."]);
        repo.run(["commit", "-m", "main work"]);
        repo.run(["merge", "--no-ff", "-m", "merge feat", "feat"]);
        repo
    }

    #[test]
    fn log_page_returns_rows_with_lanes_from_real_repo() {
        let repo = temp_repo_with_merge();

        let page = log_page(repo.path(), &GitLogFilter::default(), 50).expect("page");
        assert_eq!(page.rows.len(), 4);
        assert!(page.rows[0].merge);
        assert!(
            page.rows.iter().any(|r| r.lane > 0),
            "feature commits left lane 0"
        );
        assert!(!page.has_more);
    }

    #[test]
    fn commit_detail_lists_changed_files_with_stats() {
        let repo = temp_repo_with_merge();
        let head = log_page(repo.path(), &GitLogFilter::default(), 1)
            .unwrap()
            .rows[0]
            .hash
            .clone();
        let detail = commit_detail(repo.path(), &head).expect("detail");
        assert_eq!(detail.hash, head);
        assert!(!detail.files.is_empty());
        assert!(detail.files.iter().all(|f| !f.path.is_empty()));
    }

    #[test]
    fn export_changed_files_writes_commit_version_with_folders() {
        let repo = crate::git::tests::TempGitRepo::new();
        std::fs::create_dir_all(repo.path().join("src/deep")).unwrap();
        repo.write_file("src/deep/f.ts", "v1\n");
        repo.run(["add", "."]);
        repo.run(["commit", "-m", "one"]);
        repo.write_file("src/deep/f.ts", "v2\n");
        repo.run(["add", "."]);
        repo.run(["commit", "-m", "two"]);
        let rows = log_page(repo.path(), &GitLogFilter::default(), 10)
            .unwrap()
            .rows;
        let second = rows[0].hash.clone();
        // must NOT leak into the export
        repo.write_file("src/deep/f.ts", "working-tree-v3\n");

        let dest = tempfile::tempdir().unwrap();
        let report = export_commit(
            repo.path(),
            &second,
            ExportScope::ChangedFiles,
            ExportFormat::Folder,
            dest.path(),
            false,
        )
        .expect("export");

        assert_eq!(report.written_files, 1);
        let exported = std::fs::read_to_string(dest.path().join("src/deep/f.ts")).unwrap();
        assert_eq!(
            exported, "v2\n",
            "exports the commit version, not the working tree"
        );
    }

    #[test]
    fn export_refuses_overwrite_without_flag_and_lists_conflicts() {
        let repo = crate::git::tests::TempGitRepo::new();
        repo.write_file("a.txt", "x\n");
        repo.run(["add", "."]);
        repo.run(["commit", "-m", "c"]);
        let hash = log_page(repo.path(), &GitLogFilter::default(), 1)
            .unwrap()
            .rows[0]
            .hash
            .clone();
        let dest = tempfile::tempdir().unwrap();
        std::fs::write(dest.path().join("a.txt"), "existing").unwrap();

        let err = export_commit(
            repo.path(),
            &hash,
            ExportScope::ChangedFiles,
            ExportFormat::Folder,
            dest.path(),
            false,
        )
        .expect_err("conflict rejected");
        assert!(err.contains("a.txt"));

        export_commit(
            repo.path(),
            &hash,
            ExportScope::ChangedFiles,
            ExportFormat::Folder,
            dest.path(),
            true,
        )
        .expect("overwrite allowed with flag");
    }

    #[test]
    fn reset_to_and_revert_require_typed_confirmation() {
        let repo = temp_repo_with_merge();
        let rows = log_page(repo.path(), &GitLogFilter::default(), 10)
            .unwrap()
            .rows;
        let target = rows.last().unwrap().hash.clone();
        let short = rows.last().unwrap().short_hash.clone();

        assert!(reset_to(repo.path(), &target, ResetMode::Hard, "").is_err());
        assert!(reset_to(
            repo.path(),
            &target,
            ResetMode::Hard,
            &format!("RESET HARD {short}")
        )
        .is_ok());
    }

    #[test]
    fn file_history_follows_renames_on_lane_zero() {
        let repo = crate::git::tests::TempGitRepo::new();
        repo.write_file("old.txt", "1\n");
        repo.run(["add", "."]);
        repo.run(["commit", "-m", "create old"]);
        repo.run(["mv", "old.txt", "new.txt"]);
        repo.run(["commit", "-m", "rename to new"]);

        let page = file_history(repo.path(), "new.txt", 10).expect("history");
        assert_eq!(page.rows.len(), 2, "follow crosses the rename");
        assert!(page.rows.iter().all(|r| r.lane == 0));
        assert!(!page.has_more);
    }


    #[test]
    #[ignore = "manual measurement against the host repository"]
    fn measure_log_blame_export_on_this_repo() {
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf();

        let started = std::time::Instant::now();
        let page = log_page(&repo, &GitLogFilter::default(), 200).expect("log page");
        let log_ms = started.elapsed().as_millis();

        let started = std::time::Instant::now();
        let blame = crate::git::blame_file(&repo, "src/app/AppShell.tsx").expect("blame");
        let blame_ms = started.elapsed().as_millis();

        let dest = tempfile::tempdir().expect("dest");
        let hash = page.rows[0].hash.clone();
        let started = std::time::Instant::now();
        let report = export_commit(
            &repo,
            &hash,
            ExportScope::ChangedFiles,
            ExportFormat::Folder,
            dest.path(),
            true,
        )
        .expect("export");
        let export_ms = started.elapsed().as_millis();

        println!(
            "MEASURE git_log_page 200 rows: {log_ms} ms ({} rows)",
            page.rows.len()
        );
        println!(
            "MEASURE git_blame_file AppShell.tsx: {blame_ms} ms ({} segments)",
            blame.segments.len()
        );
        println!(
            "MEASURE export_commit changed-files: {export_ms} ms ({} files)",
            report.written_files
        );
    }

    #[test]
    fn parses_refs_into_kinds() {
        let refs = parse_refs("HEAD -> main, tag: v0.4.1, origin/main");
        assert_eq!(
            refs[0],
            GitRef {
                name: "main".into(),
                kind: RefKind::Head
            }
        );
        assert_eq!(
            refs[1],
            GitRef {
                name: "v0.4.1".into(),
                kind: RefKind::Tag
            }
        );
        assert_eq!(
            refs[2],
            GitRef {
                name: "origin/main".into(),
                kind: RefKind::Branch
            }
        );
    }
}
