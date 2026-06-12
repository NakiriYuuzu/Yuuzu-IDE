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
