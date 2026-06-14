# Git Deep Dive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** upgrade Yuuzu-IDE git tooling to JetBrains-grade capability: real DAG commit log with filters/details/actions, single-commit content export (folders preserved), hunk/line-level partial staging, side-by-side word-level diff, three-way conflict resolution, full branch popup, stash management, blame, and file history.

**Architecture:** Rust (`src-tauri/src/git.rs` plus a new `src-tauri/src/git_log.rs`) owns all git CLI invocation, parsing, lane assignment, patch reconstruction, export bounds, and confirmation guardrails. React owns only rendering and selection state: log rows arrive with precomputed lanes/edges, diffs arrive as structured hunks, and no payload exceeds its documented bound. All destructive operations keep the existing typed-confirmation pattern (`DISCARD`, `RESET HARD <short>`, `DROP stash@{n}`, …). Design source of truth is `docs/html/git-jetbrains-redesign-2026-06-11.html`, which composes every surface from `docs/ui-design/ide.css` vocabulary (`.row`, `.dbgrid.gitlog`, `.menu`, `.badge2`, `.segmented`).

**Tech Stack:** Tauri 2 commands, Rust 1.96.0, `zip` latest (`6.0.0`) for snapshot extraction, React 19.2.7, TypeScript 6.0.3, Vite 8.0.16, lucide-react 1.17.0, existing Bun test + happy-dom toolchain. No new frontend dependencies.

---

## Source Context

- Design spec: `docs/html/git-jetbrains-redesign-2026-06-11.html` — six surfaces (Log/DAG ＋ Export, Partial Staging, Diff Viewer, Conflict, Branch/Stash, Blame/History) with interaction notes and the 17-command backend table.
- Gap audit: `docs/html/git-feature-jetbrains-comparison-2026-06-11.html` — what Node 4 shipped vs JetBrains.
- Existing git backend: `src-tauri/src/git.rs` (929 lines) — CLI wrappers, porcelain parsing, `normalize_repo_relative_paths`, `require_confirmation`, `bounded_diff`, `GIT_LITERAL_PATHSPECS=1` discipline. Reuse these helpers; do not fork their behavior.
- Existing commands: `src-tauri/src/commands.rs:1113-1264` (`git_*` wrappers); register new ones in the same style and in `src-tauri/src/lib.rs`.
- Existing frontend: `src/features/git/` (`git-model.ts`, `git-api.ts`, `GitPanel.tsx`, `GitDiffView.tsx`, `GitGraphView.tsx`) and AppShell wiring (`src/app/AppShell.tsx` confirmation dialog at ~line 6126, palette dispatch at ~line 5240).
- Design tokens: `docs/ui-design/ide.css` and current `src/index.css` git classes (`.git-M/A/D/U`, `.dbgrid.gitgraph`).
- Roadmap placement: this is an inserted node ("Git Deep Dive") scheduled after Node 10 Remote SSH/SFTP and before Node 11 Debugging. Update `roadmap.md` only in Task 10.
- Constraint reminders from `docs/goal.md`: TDD with observed RED, two review passes per task, Bun toolchain, bounded payloads, no React ownership of large datasets.

## File Structure

- Create `src-tauri/src/git_log.rs`: log topology types, lane assignment, ref parsing, filters, pagination, commit detail, export — plus unit tests. (Kept separate from `git.rs` so the existing file stays focused on status/staging/diff.)
- Modify `src-tauri/src/git.rs`: structured hunks, word ranges, patch reconstruction, stash suite, branches-full, conflict three-way, blame, file history — plus unit tests.
- Modify `src-tauri/src/commands.rs`: 17 new/upgraded `git_*` command wrappers.
- Modify `src-tauri/src/lib.rs`: register `git_log` module and new commands.
- Modify `src-tauri/Cargo.toml` / `Cargo.lock`: add `zip`.
- Create `src/features/git/git-log-model.ts` + `git-log-model.test.ts`: log rows/filters/selection/detail/export-dialog pure reducers, SVG edge path helper.
- Create `src/features/git/GitLogView.tsx` + `GitLogView.test.tsx`: filter bar, DAG table, detail sidebar, context menu, export dialog.
- Create `src/features/git/git-diff-model.ts` + `git-diff-model.test.ts`: hunk/line selection state, side-by-side row alignment.
- Modify `src/features/git/GitDiffView.tsx` + create `GitDiffView.test.tsx`: unified/side-by-side segmented modes, word-level marks, hunk bars with stage/unstage/revert, line checkboxes.
- Create `src/features/git/GitConflictView.tsx` + `GitConflictView.test.tsx`: three-way resolver.
- Create `src/features/git/GitBranchPopup.tsx` + `GitBranchPopup.test.tsx`: branch popup with search/groups/actions and stash section.
- Create `src/features/git/GitBlameGutter.tsx` + `GitBlameGutter.test.tsx`: annotate column.
- Modify `src/features/git/git-model.ts` + `git-model.test.ts`: new types re-exports and decoration compatibility.
- Modify `src/features/git/git-api.ts`: 17 new typed wrappers.
- Modify `src/app/AppShell.tsx` + `AppShell.contract.test.tsx`: replace GitGraphView surface with GitLogView, wire conflict view, branch popup from status bar, blame toggle, palette commands.
- Modify `src/app/workspace-view-state.ts` + test: per-workspace log filters, blame toggle, branch favorites.
- Modify `src/index.css`: new classes from the design doc (`.log-filters`, `.commit-detail`, `.hunkbar`, `.sbs`, `.conflict3`, `.blame`, `.stashrow`, export modal) using existing tokens only.
- After verification: update `docs/architecture/progress.md`, `roadmap.md`, create `docs/architecture/git-deep-dive-results.md`.

## Shared Conventions (read before any task)

- Every Rust git call goes through a `Command::new("git").arg("-C").arg(repo_root)` invocation with explicit args — never string-interpolated shell. File paths always pass `normalize_repo_relative_paths` and `GIT_LITERAL_PATHSPECS=1`.
- Every list payload carries `truncated: bool` when a bound can clip it.
- Field separator for `--pretty` formats is `%x1f` (ASCII unit separator) and record separator is `%x00` via `-z`; parse with `split('\u{1f}')` — commit subjects may contain commas and pipes.
- Commit messages in commit steps follow repo style plus the user's trailer convention:
  `<type>: <subject>` body bullets optional, last line `Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>`.
- If commit permission is not granted for the run, skip commit steps and report them, per `docs/goal.md`.

---

## Task 1: Rust Structured Diff Hunks With Word-Level Ranges

**Files:**
- Modify: `src-tauri/src/git.rs`
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing tests for hunk parsing and word ranges**

Append to the `tests` module in `src-tauri/src/git.rs`:

```rust
#[test]
fn parses_unified_diff_into_structured_hunks_with_line_numbers() {
    let raw = "diff --git a/users.ts b/users.ts\nindex 1111111..2222222 100644\n--- a/users.ts\n+++ b/users.ts\n@@ -4,3 +4,4 @@ router.get\n ctx line\n-  const rows = await db.query(\"SELECT * FROM users\");\n+  const rows = await db.query(USERS_PAGE_SQL, [PAGE_SIZE]);\n+  const page = Number(req.query.page ?? 1);\n ctx tail\n";
    let hunks = parse_unified_diff(raw, MAX_DIFF_HUNKS, MAX_DIFF_TOTAL_LINES).expect("parses");

    assert_eq!(hunks.hunks.len(), 1);
    let h = &hunks.hunks[0];
    assert_eq!((h.old_start, h.old_lines, h.new_start, h.new_lines), (4, 3, 4, 4));
    assert_eq!(h.lines[0].kind, GitLineKind::Context);
    assert_eq!(h.lines[0].old_no, Some(4));
    assert_eq!(h.lines[0].new_no, Some(4));
    assert_eq!(h.lines[1].kind, GitLineKind::Del);
    assert_eq!(h.lines[1].old_no, Some(5));
    assert_eq!(h.lines[1].new_no, None);
    assert_eq!(h.lines[2].kind, GitLineKind::Add);
    assert_eq!(h.lines[2].new_no, Some(5));
    assert!(!hunks.truncated);
}

#[test]
fn word_ranges_mark_changed_middle_of_paired_lines() {
    let (del_r, add_r) = word_diff_ranges(
        "  const rows = await db.query(\"SELECT * FROM users\");",
        "  const rows = await db.query(USERS_PAGE_SQL, [PAGE_SIZE]);",
    );
    // common prefix `  const rows = await db.query(` and suffix `);` are excluded
    assert_eq!(del_r, vec![[31, 53]]);
    assert_eq!(add_r, vec![[31, 57]]);
}

#[test]
fn hunk_parsing_clips_at_bounds_and_flags_truncated() {
    let mut raw = String::from("diff --git a/a b/a\n--- a/a\n+++ b/a\n");
    for i in 0..300 {
        raw.push_str(&format!("@@ -{0},1 +{0},1 @@\n-x{0}\n+y{0}\n", i + 1));
    }
    let hunks = parse_unified_diff(&raw, MAX_DIFF_HUNKS, MAX_DIFF_TOTAL_LINES).expect("parses");
    assert_eq!(hunks.hunks.len(), MAX_DIFF_HUNKS);
    assert!(hunks.truncated);
}
```

- [ ] **Step 2: Run RED**

Run: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git::tests::parses_unified_diff -- --nocapture`
Expected: FAIL — `parse_unified_diff`, `GitLineKind`, `MAX_DIFF_HUNKS` not found.

- [ ] **Step 3: Implement structured hunk model**

Add to `src-tauri/src/git.rs` (above the tests module):

```rust
pub const MAX_DIFF_HUNKS: usize = 200;
pub const MAX_DIFF_TOTAL_LINES: usize = 8_000;
const MAX_WORD_DIFF_CHARS: usize = 400;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitLineKind { Context, Add, Del }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitHunkLine {
    pub kind: GitLineKind,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    pub text: String,
    pub word_ranges: Vec<[u32; 2]>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitHunk {
    pub header: String,
    pub old_start: u32, pub old_lines: u32,
    pub new_start: u32, pub new_lines: u32,
    pub lines: Vec<GitHunkLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitDiffHunks {
    pub path: String,
    pub staged: bool,
    pub binary: bool,
    pub truncated: bool,
    pub hunks: Vec<GitHunk>,
}

pub fn diff_file_hunks(workspace_root: &Path, path: &str, staged: bool) -> Result<GitDiffHunks, String> {
    let diff = diff_file(workspace_root, path, staged)?; // reuse existing bounded raw diff
    let mut parsed = if diff.binary {
        GitDiffHunks { path: diff.path.clone(), staged, binary: true, truncated: false, hunks: Vec::new() }
    } else {
        parse_unified_diff(&diff.raw, MAX_DIFF_HUNKS, MAX_DIFF_TOTAL_LINES)?
    };
    parsed.path = diff.path;
    parsed.staged = staged;
    parsed.truncated = parsed.truncated || diff.truncated;
    parsed.binary = diff.binary;
    attach_word_ranges(&mut parsed);
    Ok(parsed)
}

pub(crate) fn parse_unified_diff(raw: &str, max_hunks: usize, max_lines: usize) -> Result<GitDiffHunks, String> {
    let mut hunks = Vec::new();
    let mut truncated = false;
    let mut total_lines = 0usize;
    let mut current: Option<GitHunk> = None;
    let (mut old_no, mut new_no) = (0u32, 0u32);

    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("@@ ") {
            if let Some(h) = current.take() { hunks.push(h); }
            if hunks.len() >= max_hunks { truncated = true; break; }
            let (os, ol, ns, nl) = parse_hunk_header(rest)?;
            old_no = os; new_no = ns;
            current = Some(GitHunk { header: line.to_string(), old_start: os, old_lines: ol, new_start: ns, new_lines: nl, lines: Vec::new() });
        } else if let Some(h) = current.as_mut() {
            if total_lines >= max_lines { truncated = true; break; }
            let entry = match line.bytes().next() {
                Some(b'+') => { let l = GitHunkLine { kind: GitLineKind::Add, old_no: None, new_no: Some(new_no), text: line[1..].to_string(), word_ranges: Vec::new() }; new_no += 1; Some(l) }
                Some(b'-') => { let l = GitHunkLine { kind: GitLineKind::Del, old_no: Some(old_no), new_no: None, text: line[1..].to_string(), word_ranges: Vec::new() }; old_no += 1; Some(l) }
                Some(b' ') | None => { let l = GitHunkLine { kind: GitLineKind::Context, old_no: Some(old_no), new_no: Some(new_no), text: line.get(1..).unwrap_or("").to_string(), word_ranges: Vec::new() }; old_no += 1; new_no += 1; Some(l) }
                _ => None, // "\ No newline at end of file" and headers
            };
            if let Some(l) = entry { h.lines.push(l); total_lines += 1; }
        }
    }
    if let Some(h) = current.take() { hunks.push(h); }

    Ok(GitDiffHunks { path: String::new(), staged: false, binary: false, truncated, hunks })
}

fn parse_hunk_header(rest: &str) -> Result<(u32, u32, u32, u32), String> {
    // "-4,3 +4,4 @@ optional context"
    let body = rest.split(" @@").next().unwrap_or(rest);
    let mut parts = body.split_whitespace();
    let old = parts.next().and_then(|s| s.strip_prefix('-')).ok_or("invalid hunk header")?;
    let new = parts.next().and_then(|s| s.strip_prefix('+')).ok_or("invalid hunk header")?;
    let parse_pair = |s: &str| -> (u32, u32) {
        match s.split_once(',') {
            Some((a, b)) => (a.parse().unwrap_or(0), b.parse().unwrap_or(1)),
            None => (s.parse().unwrap_or(0), 1),
        }
    };
    let (os, ol) = parse_pair(old);
    let (ns, nl) = parse_pair(new);
    Ok((os, ol, ns, nl))
}

pub(crate) fn word_diff_ranges(del: &str, add: &str) -> (Vec<[u32; 2]>, Vec<[u32; 2]>) {
    if del.len() > MAX_WORD_DIFF_CHARS || add.len() > MAX_WORD_DIFF_CHARS {
        return (Vec::new(), Vec::new()); // fall back to whole-line tint
    }
    let d: Vec<char> = del.chars().collect();
    let a: Vec<char> = add.chars().collect();
    let mut prefix = 0usize;
    while prefix < d.len() && prefix < a.len() && d[prefix] == a[prefix] { prefix += 1; }
    let mut suffix = 0usize;
    while suffix < d.len() - prefix && suffix < a.len() - prefix
        && d[d.len() - 1 - suffix] == a[a.len() - 1 - suffix] { suffix += 1; }
    let dr = if prefix < d.len() - suffix { vec![[prefix as u32, (d.len() - suffix) as u32]] } else { Vec::new() };
    let ar = if prefix < a.len() - suffix { vec![[prefix as u32, (a.len() - suffix) as u32]] } else { Vec::new() };
    (dr, ar)
}

fn attach_word_ranges(diff: &mut GitDiffHunks) {
    for hunk in &mut diff.hunks {
        let mut i = 0;
        while i + 1 < hunk.lines.len() {
            let paired = hunk.lines[i].kind == GitLineKind::Del && hunk.lines[i + 1].kind == GitLineKind::Add;
            if paired {
                let (dr, ar) = word_diff_ranges(&hunk.lines[i].text, &hunk.lines[i + 1].text);
                hunk.lines[i].word_ranges = dr;
                hunk.lines[i + 1].word_ranges = ar;
                i += 2;
            } else { i += 1; }
        }
    }
}
```

- [ ] **Step 4: Run GREEN**

Run: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git::tests -- --nocapture`
Expected: PASS including the three new tests; all pre-existing git tests stay green.

- [ ] **Step 5: Register the command**

In `src-tauri/src/commands.rs`, next to `git_diff_file`:

```rust
#[tauri::command]
pub fn git_diff_hunks(
    state: tauri::State<AppState>,
    workspace_root: String,
    path: String,
    staged: bool,
) -> Result<git::GitDiffHunks, String> {
    let root = state.trusted_workspace_root(&workspace_root)?;
    git::diff_file_hunks(&root, &path, staged)
}
```

Register `git_diff_hunks` in the `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs`. Follow the exact wrapper style of the surrounding `git_*` commands (trusted-workspace lookup included).

- [ ] **Step 6: Full Rust check and commit**

Run: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml && cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
Expected: PASS / clean / no warnings.

```bash
git add src-tauri/src/git.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add structured git diff hunks

- parse unified diff into bounded hunk/line model with line numbers
- pair del/add lines with prefix-suffix word ranges
- expose git_diff_hunks command

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 2: Rust Hunk/Line Staging — Patch Reconstruction And Apply

**Files:**
- Modify: `src-tauri/src/git.rs`
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing tests for patch reconstruction and apply round-trip**

```rust
#[test]
fn rebuilds_patch_for_selected_lines_with_recounted_header() {
    let raw = "diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -1,3 +1,4 @@\n ctx\n-old\n+new1\n+new2\n";
    let hunks = parse_unified_diff(raw, MAX_DIFF_HUNKS, MAX_DIFF_TOTAL_LINES).expect("parses");
    // select only the del line (idx 1) and first add line (idx 2); drop "+new2"
    let patch = build_selection_patch("f.ts", &hunks.hunks, &[HunkSelection { hunk_index: 0, line_indices: Some(vec![1, 2]) }]).expect("patch");

    assert!(patch.contains("--- a/f.ts"));
    assert!(patch.contains("+++ b/f.ts"));
    assert!(patch.contains("@@ -1,3 +1,3 @@")); // 3 old (ctx+del+ctx-from-unselected? no: ctx,old,ctx) → recounted
    assert!(patch.contains("-old"));
    assert!(patch.contains("+new1"));
    assert!(!patch.contains("+new2"));
}

#[test]
fn stages_single_hunk_via_apply_cached_in_temp_repo() {
    let repo = TempGitRepo::new();
    repo.write_file("f.ts", "a\nb\nc\n");
    repo.run(["add", "f.ts"]);
    repo.run(["commit", "-m", "init"]);
    repo.write_file("f.ts", "a\nB\nc\nd\n"); // two separate changes → two hunks with -U0? keep simple: one file edit

    let hunks = diff_file_hunks(repo.path(), "f.ts", false).expect("hunks");
    assert!(!hunks.hunks.is_empty());

    stage_hunks(repo.path(), "f.ts", &[HunkSelection { hunk_index: 0, line_indices: None }])
        .expect("stage hunk");

    let staged = diff_file_hunks(repo.path(), "f.ts", true).expect("staged hunks");
    assert!(!staged.hunks.is_empty(), "index now contains the hunk");
}

#[test]
fn revert_hunk_requires_discard_confirmation() {
    let repo = TempGitRepo::new();
    repo.write_file("f.ts", "a\n");
    repo.run(["add", "f.ts"]);
    repo.run(["commit", "-m", "init"]);
    repo.write_file("f.ts", "a\nb\n");

    let err = revert_hunks(repo.path(), "f.ts", &[HunkSelection { hunk_index: 0, line_indices: None }], "")
        .expect_err("missing confirmation rejected");
    assert!(err.contains("confirmation"));

    revert_hunks(repo.path(), "f.ts", &[HunkSelection { hunk_index: 0, line_indices: None }], "DISCARD")
        .expect("confirmed revert succeeds");
    assert_eq!(repo.read_file("f.ts"), "a\n");
}
```

- [ ] **Step 2: Run RED**

Run: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git::tests::rebuilds_patch -- --nocapture`
Expected: FAIL — `HunkSelection`, `build_selection_patch`, `stage_hunks` not found.

- [ ] **Step 3: Implement patch reconstruction**

```rust
pub const MAX_PATCH_BYTES: usize = 1_024 * 1_024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HunkSelection {
    pub hunk_index: usize,
    /// None = whole hunk. Some(indices) = only these positions inside `hunk.lines`
    /// (unselected Add lines are dropped; unselected Del lines become Context).
    pub line_indices: Option<Vec<usize>>,
}

pub(crate) fn build_selection_patch(path: &str, hunks: &[GitHunk], selections: &[HunkSelection]) -> Result<String, String> {
    if selections.is_empty() { return Err("no hunks selected".to_string()); }
    let mut out = format!("diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n");

    for sel in selections {
        let hunk = hunks.get(sel.hunk_index).ok_or("hunk index out of range")?;
        let selected: Option<std::collections::HashSet<usize>> =
            sel.line_indices.as_ref().map(|v| v.iter().copied().collect());

        let mut body = String::new();
        let (mut old_count, mut new_count) = (0u32, 0u32);
        for (i, line) in hunk.lines.iter().enumerate() {
            let picked = selected.as_ref().map_or(true, |s| s.contains(&i));
            match (&line.kind, picked) {
                (GitLineKind::Context, _) => { body.push(' '); body.push_str(&line.text); body.push('\n'); old_count += 1; new_count += 1; }
                (GitLineKind::Del, true) => { body.push('-'); body.push_str(&line.text); body.push('\n'); old_count += 1; }
                (GitLineKind::Del, false) => { body.push(' '); body.push_str(&line.text); body.push('\n'); old_count += 1; new_count += 1; }
                (GitLineKind::Add, true) => { body.push('+'); body.push_str(&line.text); body.push('\n'); new_count += 1; }
                (GitLineKind::Add, false) => {} // dropped entirely
            }
        }
        if old_count == new_count && !body.contains('\n') { continue; }
        out.push_str(&format!("@@ -{},{} +{},{} @@\n", hunk.old_start, old_count, hunk.new_start, new_count));
        out.push_str(&body);
    }

    if out.len() > MAX_PATCH_BYTES { return Err("selection patch exceeds 1 MB bound".to_string()); }
    Ok(out)
}

fn apply_patch(repository_root: &Path, patch: &str, args: &[&str]) -> Result<(), String> {
    use std::io::Write;
    let mut command = git_command(repository_root);
    command.arg("apply").args(args).arg("--whitespace=nowarn").arg("-");
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    child.stdin.as_mut().ok_or("no stdin")?.write_all(patch.as_bytes()).map_err(|e| e.to_string())?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if output.status.success() { Ok(()) } else { Err(command_error("git apply", &output.stderr)) }
}

pub fn stage_hunks(workspace_root: &Path, path: &str, selections: &[HunkSelection]) -> Result<GitRepositoryStatus, String> {
    let repository_root = repository_root(workspace_root)?;
    let current = diff_file_hunks(workspace_root, path, false)?;
    let patch = build_selection_patch(&current.path, &current.hunks, selections)?;
    apply_patch(&repository_root, &patch, &["--cached"])?;
    repository_status(workspace_root)
}

pub fn unstage_hunks(workspace_root: &Path, path: &str, selections: &[HunkSelection]) -> Result<GitRepositoryStatus, String> {
    let repository_root = repository_root(workspace_root)?;
    let current = diff_file_hunks(workspace_root, path, true)?;
    let patch = build_selection_patch(&current.path, &current.hunks, selections)?;
    apply_patch(&repository_root, &patch, &["--cached", "-R"])?;
    repository_status(workspace_root)
}

pub fn revert_hunks(workspace_root: &Path, path: &str, selections: &[HunkSelection], confirmation: &str) -> Result<GitRepositoryStatus, String> {
    require_confirmation(confirmation, "DISCARD")?;
    let repository_root = repository_root(workspace_root)?;
    let current = diff_file_hunks(workspace_root, path, false)?;
    let patch = build_selection_patch(&current.path, &current.hunks, selections)?;
    apply_patch(&repository_root, &patch, &["-R"])?;
    repository_status(workspace_root)
}
```

- [ ] **Step 4: Run GREEN, then full suite**

Run: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git::tests -- --nocapture`
Expected: PASS. If `rebuilds_patch_for_selected_lines_with_recounted_header` disagrees on counts, fix the test expectation only after hand-recounting (ctx=1 old+new, del picked=1 old, add picked=1 new → `@@ -1,2 +1,2 @@` for that selection) — header math is the core of this task; do not loosen the assertion.

- [ ] **Step 5: Register commands `git_stage_hunks`, `git_unstage_hunks`, `git_revert_hunk`**

Same wrapper pattern as Task 1 Step 5; `git_revert_hunk` takes `confirmation: String` and passes it through. Register all three in `lib.rs`.

- [ ] **Step 6: Verify and commit**

Run the full Rust gate (test/fmt/clippy as Task 1 Step 6).

```bash
git add src-tauri/src/git.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add hunk and line level staging

- rebuild bounded patches from hunk/line selections with recounted headers
- stage, unstage, and confirmed revert via git apply
- expose git_stage_hunks, git_unstage_hunks, git_revert_hunk

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 3: Rust Log Topology, Lane Assignment, Pagination, Filters

**Files:**
- Create: `src-tauri/src/git_log.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod git_log;`), `src-tauri/src/commands.rs`

- [ ] **Step 1: Write failing tests for lane assignment on synthetic DAGs**

Create `src-tauri/src/git_log.rs` starting with the tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn input(hash: &str, parents: &[&str]) -> TopoCommit {
        TopoCommit { hash: hash.into(), parents: parents.iter().map(|p| p.to_string()).collect() }
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
        assert!(rows[0].edges.iter().any(|e| e.kind == EdgeKind::Fork && e.to_lane == 1));
        assert_eq!(rows[1].lane, 1, "feature commit stays on lane 1");
        assert_eq!(rows[2].lane, 0);
        // both lane 0 (via b) and lane 1 (via f) wait for "a" → join at a
        let a_row = &rows[3];
        assert_eq!(a_row.lane, 0);
        assert!(a_row.edges.iter().any(|e| e.kind == EdgeKind::Join && e.from_lane == 1));
    }

    #[test]
    fn lanes_clamp_at_max_and_flag_overflow() {
        // octopus-ish: one commit with 14 parents
        let parents: Vec<String> = (0..14).map(|i| format!("p{i}")).collect();
        let head = TopoCommit { hash: "h".into(), parents: parents.clone() };
        let mut commits = vec![head];
        commits.extend(parents.iter().map(|p| TopoCommit { hash: p.clone(), parents: vec![] }));
        let rows = assign_lanes(&commits);
        assert!(rows.iter().all(|r| (r.lane as usize) < MAX_LANES));
        assert!(rows.iter().any(|r| r.lane_overflow));
    }

    #[test]
    fn parses_refs_into_kinds() {
        let refs = parse_refs("HEAD -> main, tag: v0.4.1, origin/main");
        assert_eq!(refs[0], GitRef { name: "main".into(), kind: RefKind::Head });
        assert_eq!(refs[1], GitRef { name: "v0.4.1".into(), kind: RefKind::Tag });
        assert_eq!(refs[2], GitRef { name: "origin/main".into(), kind: RefKind::Branch });
    }
}
```

- [ ] **Step 2: Run RED**

Run: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git_log::tests -- --nocapture`
Expected: FAIL to compile — module/types missing. Add `mod git_log;` to `lib.rs` first so the failure is about missing items, not a missing module.

- [ ] **Step 3: Implement lane assignment and log paging**

```rust
use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::git;

pub const MAX_LANES: usize = 12;
pub const LOG_PAGE_SIZE: usize = 200;
pub const MAX_LOG_ROWS: usize = 2_000;

#[derive(Debug, Clone)]
pub struct TopoCommit { pub hash: String, pub parents: Vec<String> }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind { Through, Fork, Join, Stop }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphEdge { pub from_lane: u8, pub to_lane: u8, pub kind: EdgeKind }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefKind { Head, Branch, Tag }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitRef { pub name: String, pub kind: RefKind }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitLogRow {
    pub hash: String, pub short_hash: String,
    pub subject: String, pub author: String, pub when_unix: i64,
    pub refs: Vec<GitRef>, pub parents: Vec<String>,
    pub lane: u8, pub lane_overflow: bool, pub merge: bool,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GitLogFilter {
    pub branch: Option<String>,   // ref name; None = HEAD history, Some("--all") handled as all
    pub author: Option<String>,
    pub since: Option<String>,    // e.g. "2.weeks"
    pub grep: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLogPage { pub rows: Vec<GitLogRow>, pub has_more: bool, pub total_loaded: usize, pub truncated: bool }

struct LaneRow { lane: u8, overflow: bool, edges: Vec<GraphEdge>, merge: bool }

fn assign_lanes(commits: &[TopoCommit]) -> Vec<LaneStamped> {
    let mut active: Vec<Option<String>> = Vec::new();
    let mut out = Vec::with_capacity(commits.len());

    for c in commits {
        let mut edges = Vec::new();
        // find or allocate this commit's lane
        let lane = match active.iter().position(|s| s.as_deref() == Some(c.hash.as_str())) {
            Some(i) => i,
            None => match active.iter().position(Option::is_none) {
                Some(i) => { active[i] = Some(c.hash.clone()); i }
                None => { active.push(Some(c.hash.clone())); active.len() - 1 }
            },
        };
        // every other occupied lane passes through
        for (i, slot) in active.iter().enumerate() {
            if i != lane && slot.is_some() {
                let li = clamp_lane(i); 
                edges.push(GraphEdge { from_lane: li, to_lane: li, kind: EdgeKind::Through });
            }
        }
        // all OTHER lanes waiting for this same hash join into `lane`
        for i in 0..active.len() {
            if i != lane && active[i].as_deref() == Some(c.hash.as_str()) {
                edges.push(GraphEdge { from_lane: clamp_lane(i), to_lane: clamp_lane(lane), kind: EdgeKind::Join });
                active[i] = None;
            }
        }
        // distribute parents
        match c.parents.split_first() {
            None => { edges.push(GraphEdge { from_lane: clamp_lane(lane), to_lane: clamp_lane(lane), kind: EdgeKind::Stop }); active[lane] = None; }
            Some((first, rest)) => {
                active[lane] = Some(first.clone());
                for p in rest {
                    if let Some(existing) = active.iter().position(|s| s.as_deref() == Some(p.as_str())) {
                        edges.push(GraphEdge { from_lane: clamp_lane(lane), to_lane: clamp_lane(existing), kind: EdgeKind::Fork });
                    } else {
                        let slot = active.iter().position(Option::is_none).unwrap_or_else(|| { active.push(None); active.len() - 1 });
                        active[slot] = Some(p.clone());
                        edges.push(GraphEdge { from_lane: clamp_lane(lane), to_lane: clamp_lane(slot), kind: EdgeKind::Fork });
                    }
                }
            }
        }
        let overflow = lane >= MAX_LANES;
        out.push(LaneStamped { lane: clamp_lane(lane), overflow, edges, merge: c.parents.len() > 1 });
    }
    out
}

struct LaneStamped { lane: u8, overflow: bool, edges: Vec<GraphEdge>, merge: bool }
fn clamp_lane(i: usize) -> u8 { i.min(MAX_LANES - 1) as u8 }

pub(crate) fn parse_refs(decoration: &str) -> Vec<GitRef> {
    decoration.split(',').map(str::trim).filter(|s| !s.is_empty()).map(|s| {
        if let Some(rest) = s.strip_prefix("HEAD -> ") { GitRef { name: rest.to_string(), kind: RefKind::Head } }
        else if s == "HEAD" { GitRef { name: "HEAD".to_string(), kind: RefKind::Head } }
        else if let Some(rest) = s.strip_prefix("tag: ") { GitRef { name: rest.to_string(), kind: RefKind::Tag } }
        else { GitRef { name: s.to_string(), kind: RefKind::Branch } }
    }).collect()
}

pub fn log_page(workspace_root: &Path, filter: &GitLogFilter, limit: usize) -> Result<GitLogPage, String> {
    let limit = limit.clamp(1, MAX_LOG_ROWS);
    let mut args: Vec<String> = vec![
        "log".into(), "--topo-order".into(), "-z".into(),
        "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s".into(),
        "-n".into(), (limit + 1).to_string(),
    ];
    match filter.branch.as_deref() {
        None => {}
        Some("--all") => args.push("--all".into()),
        Some(branch) => {
            let b = branch.trim();
            if b.is_empty() || b.starts_with('-') { return Err("invalid branch filter".to_string()); }
            args.push(b.to_string());
        }
    }
    if let Some(a) = filter.author.as_deref().filter(|s| !s.trim().is_empty()) { args.push(format!("--author={}", a.trim())); }
    if let Some(s) = filter.since.as_deref().filter(|s| !s.trim().is_empty()) { args.push(format!("--since={}", s.trim())); }
    if let Some(g) = filter.grep.as_deref().filter(|s| !s.trim().is_empty()) { args.push(format!("--grep={}", g.trim())); args.push("--regexp-ignore-case".into()); }
    if let Some(p) = filter.path.as_deref().filter(|s| !s.trim().is_empty()) {
        let normalized = git::normalize_repo_relative_paths(Path::new(""), &[p.to_string()])?;
        args.push("--".into());
        args.push(normalized[0].to_string_lossy().into_owned());
    }
    let output = git::run_git_in(workspace_root, &args)?; // add a pub(crate) helper in git.rs delegating to run_git with owned args
    let mut topo = Vec::new();
    let mut meta = Vec::new();
    for record in output.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        let text = String::from_utf8_lossy(record);
        let f: Vec<&str> = text.split('\u{1f}').collect();
        if f.len() < 7 { continue; }
        topo.push(TopoCommit { hash: f[0].to_string(), parents: f[2].split_whitespace().map(String::from).collect() });
        meta.push((f[1].to_string(), f[3].to_string(), f[4].parse::<i64>().unwrap_or(0), parse_refs(f[5]), f[6].to_string()));
    }
    let has_more = topo.len() > limit;
    topo.truncate(limit);
    meta.truncate(limit);
    let lanes = assign_lanes(&topo);
    let rows = topo.into_iter().zip(meta).zip(lanes).map(|((t, m), l)| GitLogRow {
        hash: t.hash, short_hash: m.0, subject: m.4, author: m.1, when_unix: m.2,
        refs: m.3, parents: t.parents, lane: l.lane, lane_overflow: l.overflow, merge: l.merge, edges: l.edges,
    }).collect::<Vec<_>>();
    let total_loaded = rows.len();
    Ok(GitLogPage { rows, has_more, total_loaded, truncated: total_loaded >= MAX_LOG_ROWS })
}
```

Pagination model (document in code comment): the frontend always requests `limit = page_count * 200` from offset 0 and Rust recomputes lanes over the whole loaded prefix — lanes stay consistent across "load more", payload stays bounded by `MAX_LOG_ROWS = 2000`, and `git log` is fast enough for this on personal-scale repos. Past 2,000 rows the UI directs users to filters.

Also add the tiny helper in `git.rs`:

```rust
pub(crate) fn run_git_in(working_dir: &Path, args: &[String]) -> Result<Vec<u8>, String> {
    let output = Command::new("git").arg("-C").arg(working_dir).args(args).output().map_err(|e| e.to_string())?;
    if output.status.success() { Ok(output.stdout) } else { Err(command_error("git", &output.stderr)) }
}
```

- [ ] **Step 4: Run GREEN**

Run: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git_log::tests -- --nocapture`
Expected: PASS, all four tests. Trace `merge_forks_second_parent...` by hand before trusting it: row `m` lane 0, fork edge to lane 1; row `f` lane 1; row `a` join edge from lane 1.

- [ ] **Step 5: Add an integration test against a real temp repo**

```rust
#[test]
fn log_page_returns_rows_with_lanes_from_real_repo() {
    let repo = crate::git::tests::TempGitRepo::new(); // make TempGitRepo pub(crate) in git.rs tests, or duplicate the 30-line helper here
    repo.write_file("a.txt", "1\n"); repo.run(["add", "."]); repo.run(["commit", "-m", "first"]);
    repo.run(["checkout", "-b", "feat"]);
    repo.write_file("b.txt", "2\n"); repo.run(["add", "."]); repo.run(["commit", "-m", "feat work"]);
    repo.run(["checkout", "main"]);
    repo.write_file("a.txt", "1\n1\n"); repo.run(["add", "."]); repo.run(["commit", "-m", "main work"]);
    repo.run(["merge", "--no-ff", "-m", "merge feat", "feat"]);

    let page = log_page(repo.path(), &GitLogFilter::default(), 50).expect("page");
    assert_eq!(page.rows.len(), 4);
    assert!(page.rows[0].merge);
    assert!(page.rows.iter().any(|r| r.lane > 0), "feature commits left lane 0");
    assert!(!page.has_more);
}
```

Note: `TempGitRepo::new()` must `git checkout -b main` after init if the default branch differs; mirror the existing helper behavior in `git.rs` tests.

Run: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git_log -- --nocapture`
Expected: PASS.

- [ ] **Step 6: Register `git_log_page`, run full gate, commit**

Wrapper takes `workspace_root: String, filter: git_log::GitLogFilter, limit: usize`. Register in `lib.rs`.

```bash
git add src-tauri/src/git_log.rs src-tauri/src/git.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add git log topology with lane assignment

- topo-order log parsing with %x1f field separation and refs kinds
- streaming lane assignment with fork/join/stop edges and 12-lane clamp
- prefix-recompute pagination bounded at 2000 rows
- expose git_log_page command

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 4: Rust Commit Detail, Commit Actions, And Export Commit

**Files:**
- Modify: `src-tauri/src/git_log.rs`, `src-tauri/src/git.rs` (reuse helpers), `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the `zip` dependency**

Run: `. "$HOME/.cargo/env" && cargo add zip@6.0.0 --no-default-features --features deflate --manifest-path src-tauri/Cargo.toml`
Expected: added without downgrades.

- [ ] **Step 2: Write failing tests**

In `git_log.rs` tests:

```rust
#[test]
fn commit_detail_lists_changed_files_with_stats() {
    let repo = temp_repo_with_merge(); // extract Step-5 setup from Task 3 into this helper
    let head = log_page(repo.path(), &GitLogFilter::default(), 1).unwrap().rows[0].hash.clone();
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
    repo.run(["add", "."]); repo.run(["commit", "-m", "one"]);
    repo.write_file("src/deep/f.ts", "v2\n");
    repo.run(["add", "."]); repo.run(["commit", "-m", "two"]);
    let rows = log_page(repo.path(), &GitLogFilter::default(), 10).unwrap().rows;
    let second = rows[0].hash.clone();
    repo.write_file("src/deep/f.ts", "working-tree-v3\n"); // must NOT leak into export

    let dest = tempfile::tempdir().unwrap();
    let report = export_commit(repo.path(), &second, ExportScope::ChangedFiles, ExportFormat::Folder, dest.path(), false).expect("export");

    assert_eq!(report.written_files, 1);
    let exported = std::fs::read_to_string(dest.path().join("src/deep/f.ts")).unwrap();
    assert_eq!(exported, "v2\n", "exports the commit version, not the working tree");
}

#[test]
fn export_refuses_overwrite_without_flag_and_lists_conflicts() {
    let repo = crate::git::tests::TempGitRepo::new();
    repo.write_file("a.txt", "x\n"); repo.run(["add", "."]); repo.run(["commit", "-m", "c"]);
    let hash = log_page(repo.path(), &GitLogFilter::default(), 1).unwrap().rows[0].hash.clone();
    let dest = tempfile::tempdir().unwrap();
    std::fs::write(dest.path().join("a.txt"), "existing").unwrap();

    let err = export_commit(repo.path(), &hash, ExportScope::ChangedFiles, ExportFormat::Folder, dest.path(), false)
        .expect_err("conflict rejected");
    assert!(err.contains("a.txt"));

    export_commit(repo.path(), &hash, ExportScope::ChangedFiles, ExportFormat::Folder, dest.path(), true)
        .expect("overwrite allowed with flag");
}

#[test]
fn reset_to_and_revert_require_typed_confirmation() {
    let repo = temp_repo_with_merge();
    let rows = log_page(repo.path(), &GitLogFilter::default(), 10).unwrap().rows;
    let target = rows.last().unwrap().hash.clone();
    let short = rows.last().unwrap().short_hash.clone();

    assert!(reset_to(repo.path(), &target, ResetMode::Hard, "").is_err());
    assert!(reset_to(repo.path(), &target, ResetMode::Hard, &format!("RESET HARD {short}")).is_ok());
}
```

- [ ] **Step 3: Run RED**

Run: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git_log::tests::export -- --nocapture`
Expected: FAIL — `ExportScope`, `export_commit`, `commit_detail`, `reset_to` missing.

- [ ] **Step 4: Implement detail, actions, export**

```rust
pub const MAX_DETAIL_FILES: usize = 500;
pub const MAX_EXPORT_FILES: usize = 2_000;
pub const MAX_EXPORT_BYTES: u64 = 200 * 1_024 * 1_024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitFileChange { pub status: String, pub path: String, pub old_path: Option<String>, pub additions: i64, pub deletions: i64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommitDetail {
    pub hash: String, pub short_hash: String, pub subject: String, pub body: String,
    pub author: String, pub author_email: String, pub when_unix: i64,
    pub parents: Vec<String>, pub refs: Vec<GitRef>,
    pub files: Vec<CommitFileChange>, pub files_truncated: bool,
}

pub fn commit_detail(workspace_root: &Path, hash: &str) -> Result<GitCommitDetail, String> {
    let hash = validate_hash(hash)?;
    let meta = git::run_git_in(workspace_root, &["show".into(), "--no-patch".into(),
        format!("--pretty=format:%H%x1f%h%x1f%s%x1f%b%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%D"), hash.clone()])?;
    let text = String::from_utf8_lossy(&meta);
    let f: Vec<&str> = text.split('\u{1f}').collect();
    if f.len() < 9 { return Err("unexpected git show output".into()); }

    let status_out = git::run_git_in(workspace_root, &["diff-tree".into(), "--no-commit-id".into(), "--name-status".into(), "-r".into(), "-z".into(), "--root".into(), hash.clone()])?;
    let numstat_out = git::run_git_in(workspace_root, &["diff-tree".into(), "--no-commit-id".into(), "--numstat".into(), "-r".into(), "-z".into(), "--root".into(), hash.clone()])?;
    let (files, files_truncated) = parse_change_lists(&status_out, &numstat_out, MAX_DETAIL_FILES)?;

    Ok(GitCommitDetail {
        hash: f[0].into(), short_hash: f[1].into(), subject: f[2].into(), body: f[3].trim().into(),
        author: f[4].into(), author_email: f[5].into(), when_unix: f[6].parse().unwrap_or(0),
        parents: f[7].split_whitespace().map(String::from).collect(), refs: parse_refs(f[8]),
        files, files_truncated,
    })
}

fn validate_hash(hash: &str) -> Result<String, String> {
    let h = hash.trim();
    if h.len() >= 6 && h.len() <= 64 && h.bytes().all(|b| b.is_ascii_hexdigit()) { Ok(h.to_string()) }
    else { Err("invalid commit hash".to_string()) }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportScope { ChangedFiles, Snapshot }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat { Folder, Zip }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportReport { pub written_files: usize, pub total_bytes: u64, pub skipped_deleted: usize, pub destination: String }

pub fn export_commit(workspace_root: &Path, hash: &str, scope: ExportScope, format: ExportFormat, dest: &Path, overwrite: bool) -> Result<ExportReport, String> {
    let hash = validate_hash(hash)?;
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    match (scope, format) {
        (ExportScope::ChangedFiles, ExportFormat::Folder) => export_changed_to_folder(workspace_root, &hash, dest, overwrite),
        (ExportScope::ChangedFiles, ExportFormat::Zip) => {
            let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
            let mut report = export_changed_to_folder(workspace_root, &hash, tmp.path(), true)?;
            let zip_path = dest.join(format!("{}-changed.zip", &hash[..7.min(hash.len())]));
            if zip_path.exists() && !overwrite { return Err(format!("destination exists: {}", zip_path.display())); }
            zip_directory(tmp.path(), &zip_path)?;
            report.destination = zip_path.display().to_string();
            Ok(report)
        }
        (ExportScope::Snapshot, ExportFormat::Zip) => {
            let zip_path = dest.join(format!("{}-snapshot.zip", &hash[..7.min(hash.len())]));
            if zip_path.exists() && !overwrite { return Err(format!("destination exists: {}", zip_path.display())); }
            git::run_git_in(workspace_root, &["archive".into(), "--format=zip".into(), "-o".into(), zip_path.display().to_string(), hash.clone()])?;
            let bytes = std::fs::metadata(&zip_path).map(|m| m.len()).unwrap_or(0);
            if bytes > MAX_EXPORT_BYTES { let _ = std::fs::remove_file(&zip_path); return Err("snapshot exceeds 200 MB bound".into()); }
            Ok(ExportReport { written_files: 1, total_bytes: bytes, skipped_deleted: 0, destination: zip_path.display().to_string() })
        }
        (ExportScope::Snapshot, ExportFormat::Folder) => {
            let tmp = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
            git::run_git_in(workspace_root, &["archive".into(), "--format=zip".into(), "-o".into(), tmp.path().display().to_string(), hash.clone()])?;
            unzip_into(tmp.path(), dest, overwrite)
        }
    }
}

fn export_changed_to_folder(workspace_root: &Path, hash: &str, dest: &Path, overwrite: bool) -> Result<ExportReport, String> {
    let status_out = git::run_git_in(workspace_root, &["diff-tree".into(), "--no-commit-id".into(), "--name-status".into(), "-r".into(), "-z".into(), "--root".into(), hash.to_string()])?;
    let entries = parse_name_status(&status_out)?;
    let kept: Vec<_> = entries.iter().filter(|e| e.status != "D").collect();
    let skipped_deleted = entries.len() - kept.len();
    if kept.len() > MAX_EXPORT_FILES { return Err(format!("{} files exceeds the 2000-file bound; use a snapshot zip instead", kept.len())); }

    if !overwrite {
        let conflicts: Vec<String> = kept.iter().filter(|e| dest.join(&e.path).exists()).map(|e| e.path.clone()).take(20).collect();
        if !conflicts.is_empty() { return Err(format!("destination already contains: {}", conflicts.join(", "))); }
    }

    let mut total_bytes = 0u64;
    for entry in &kept {
        let bytes = git::run_git_in(workspace_root, &["show".into(), format!("{hash}:{}", entry.path)])?;
        total_bytes += bytes.len() as u64;
        if total_bytes > MAX_EXPORT_BYTES { return Err("export exceeds 200 MB bound; use a snapshot zip instead".into()); }
        let target = dest.join(&entry.path);
        if !target.starts_with(dest) { return Err(format!("export path escapes destination: {}", entry.path)); }
        if let Some(parent) = target.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        std::fs::write(&target, &bytes).map_err(|e| e.to_string())?;
    }
    Ok(ExportReport { written_files: kept.len(), total_bytes, skipped_deleted, destination: dest.display().to_string() })
}
```

Also implement: `parse_name_status` / `parse_change_lists` (NUL-separated walkers mirroring `parse_status_output` style, rename pairs consume the second record), `zip_directory` / `unzip_into` using the `zip` crate (`unzip_into` rejects entries whose normalized path escapes `dest` — zip-slip guard — and respects `overwrite`), plus:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResetMode { Soft, Mixed, Hard }

pub fn cherry_pick(workspace_root: &Path, hash: &str) -> Result<git::GitRepositoryStatus, String> { /* validate_hash → `cherry-pick <hash>`; on failure run `cherry-pick --abort` and surface stderr */ }
pub fn revert_commit(workspace_root: &Path, hash: &str, confirmation: &str) -> Result<git::GitRepositoryStatus, String> { /* require `REVERT <short>` then `revert --no-edit <hash>`; abort on conflict like cherry_pick */ }
pub fn reset_to(workspace_root: &Path, hash: &str, mode: ResetMode, confirmation: &str) -> Result<git::GitRepositoryStatus, String> { /* Hard requires `RESET HARD <short>`; Soft/Mixed require `RESET <short>` */ }
pub fn commit_file_diff(workspace_root: &Path, hash: &str, path: &str) -> Result<git::GitDiffHunks, String> { /* `git show <hash> -- <path>` through parse_unified_diff with the same bounds */ }
```

These four bodies are small (each mirrors an existing `git.rs` command shape: validate → run → `repository_status`); write them out fully in code, not as comments.

- [ ] **Step 5: Run GREEN + full gate**

Run: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git_log -- --nocapture` then the full test/fmt/clippy gate.
Expected: PASS. The export tests are the contract: commit-version content, folder creation, overwrite refusal listing.

- [ ] **Step 6: Register commands and commit**

Register `git_commit_detail`, `git_commit_file_diff`, `git_cherry_pick`, `git_revert_commit`, `git_reset_to`, `git_export_commit` (the last takes `scope`, `format`, `dest_dir: String`, `overwrite: bool`; resolve `dest_dir` with `dunce::canonicalize`-style checks — reject empty or relative destinations).

```bash
git add src-tauri/src/git_log.rs src-tauri/src/git.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: add commit detail, actions, and export

- commit metadata with name-status and numstat file lists
- cherry-pick, confirmed revert, confirmed reset soft/mixed/hard
- export commit as changed-files or snapshot, folder or zip, bounded
- overwrite protection lists conflicting paths before writing

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 5: Rust Branches-Full And Stash Suite

**Files:**
- Modify: `src-tauri/src/git.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing tests**

```rust
#[test]
fn branches_full_reports_ahead_behind_and_current() {
    let repo = TempGitRepo::new();
    repo.write_file("a", "1\n"); repo.run(["add", "."]); repo.run(["commit", "-m", "c1"]);
    repo.run(["branch", "feat"]);
    let branches = branches_full(repo.path()).expect("branches");
    let main = branches.iter().find(|b| b.current).expect("current branch present");
    assert!(!main.name.is_empty());
    assert!(branches.iter().any(|b| b.name == "feat" && !b.current));
}

#[test]
fn stash_list_apply_pop_drop_round_trip_with_confirmation() {
    let repo = TempGitRepo::new();
    repo.write_file("a", "1\n"); repo.run(["add", "."]); repo.run(["commit", "-m", "c1"]);
    repo.write_file("a", "2\n");
    stash(repo.path(), "wip-1", false).expect("stash push");

    let stashes = stash_list(repo.path()).expect("list");
    assert_eq!(stashes.len(), 1);
    assert_eq!(stashes[0].index, 0);
    assert!(stashes[0].message.contains("wip-1"));

    stash_apply(repo.path(), 0).expect("apply keeps stash");
    assert_eq!(stash_list(repo.path()).unwrap().len(), 1);
    assert_eq!(repo.read_file("a"), "2\n");

    repo.run(["checkout", "--", "a"]);
    assert!(stash_drop(repo.path(), 0, "").is_err(), "drop needs confirmation");
    stash_drop(repo.path(), 0, "DROP stash@{0}").expect("confirmed drop");
    assert!(stash_list(repo.path()).unwrap().is_empty());
}
```

- [ ] **Step 2: Run RED**

Run: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git::tests::branches_full -- --nocapture`
Expected: FAIL — functions missing.

- [ ] **Step 3: Implement**

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitBranchFull {
    pub name: String, pub current: bool, pub remote: bool,
    pub upstream: Option<String>, pub ahead: u32, pub behind: u32, pub head_short: String,
}

pub fn branches_full(workspace_root: &Path) -> Result<Vec<GitBranchFull>, String> {
    let repository_root = repository_root(workspace_root)?;
    let output = run_git(&repository_root, [
        "for-each-ref", "refs/heads", "refs/remotes", "--count=500",
        "--format=%(HEAD)%1f%(refname:short)%1f%(upstream:short)%1f%(upstream:track)%1f%(objectname:short)",
    ].iter())?;
    Ok(String::from_utf8_lossy(&output).lines().filter_map(|line| {
        let f: Vec<&str> = line.split('\u{1f}').collect();
        if f.len() < 5 || f[1].is_empty() || f[1].ends_with("/HEAD") { return None; }
        let (ahead, behind) = parse_tracking_counts(f[3].trim_start_matches('[').trim_end_matches(']'));
        Some(GitBranchFull {
            name: f[1].to_string(), current: f[0].trim() == "*",
            remote: f[1].contains('/') && !f[0].contains('*') && f[1].starts_with("origin"),
            upstream: non_empty(f[2]), ahead, behind, head_short: f[4].to_string(),
        })
    }).collect())
}
```

(Remote detection: refs from `refs/remotes` arrive as `origin/...`; if ambiguity bites in tests, thread an explicit `is_remote` by running two `for-each-ref` calls — one per namespace — and tagging results. Choose whichever the test proves correct.)

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitStashEntry { pub index: usize, pub message: String, pub when_unix: i64 }

pub fn stash_list(workspace_root: &Path) -> Result<Vec<GitStashEntry>, String> {
    let repository_root = repository_root(workspace_root)?;
    let output = run_git(&repository_root, ["stash", "list", "--format=%gd%1f%at%1f%gs", "-n", "50"].iter())?;
    Ok(String::from_utf8_lossy(&output).lines().filter_map(|line| {
        let f: Vec<&str> = line.split('\u{1f}').collect();
        if f.len() < 3 { return None; }
        let index = f[0].trim_start_matches("stash@{").trim_end_matches('}').parse().ok()?;
        Some(GitStashEntry { index, message: f[2].to_string(), when_unix: f[1].parse().unwrap_or(0) })
    }).collect())
}

fn stash_ref(index: usize) -> Result<String, String> {
    if index >= 50 { return Err("stash index out of range".into()); }
    Ok(format!("stash@{{{index}}}"))
}

pub fn stash_apply(workspace_root: &Path, index: usize) -> Result<GitRepositoryStatus, String> { /* `stash apply <ref>` then repository_status */ }
pub fn stash_pop(workspace_root: &Path, index: usize) -> Result<GitRepositoryStatus, String> { /* `stash pop <ref>` */ }
pub fn stash_drop(workspace_root: &Path, index: usize, confirmation: &str) -> Result<GitRepositoryStatus, String> {
    require_confirmation(confirmation, &format!("DROP stash@{{{index}}}"))?;
    /* `stash drop <ref>` then repository_status */
}
pub fn stash_branch(workspace_root: &Path, index: usize, name: &str) -> Result<GitRepositoryStatus, String> { /* required_trimmed name + `stash branch <name> <ref>` */ }
pub fn merge_branch(workspace_root: &Path, name: &str) -> Result<GitRepositoryStatus, String> { /* required_trimmed + `merge --no-edit <name>`; on conflict return Ok(status) — has_conflicts drives the UI */ }
pub fn delete_branch(workspace_root: &Path, name: &str, confirmation: &str) -> Result<Vec<GitBranchFull>, String> {
    require_confirmation(confirmation, &format!("DELETE {name}"))?;
    /* `branch -D <name>` then branches_full */
}
pub fn rename_branch(workspace_root: &Path, from: &str, to: &str) -> Result<Vec<GitBranchFull>, String> { /* `branch -m <from> <to>` then branches_full */ }
```

Write the elided bodies in full — each is 4–6 lines following the `stash()` shape already in the file.

- [ ] **Step 4: GREEN + gate + register + commit**

Register `git_branches_full`, `git_merge_branch`, `git_branch_delete`, `git_branch_rename`, `git_stash_list`, `git_stash_apply`, `git_stash_pop`, `git_stash_drop`, `git_stash_branch`.

```bash
git add src-tauri/src/git.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add full branch listing and stash management

- for-each-ref branches with upstream ahead/behind and current flag
- stash list/apply/pop/branch and confirmed drop
- merge, confirmed delete, and rename branch commands

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 6: Rust Conflict Three-Way, Blame, File History

**Files:**
- Modify: `src-tauri/src/git.rs`, `src-tauri/src/git_log.rs` (file history reuses log paging), `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing tests**

```rust
#[test]
fn conflict_file_returns_three_versions_and_blocks() {
    let repo = TempGitRepo::new();
    repo.write_file("f.txt", "base\n"); repo.run(["add", "."]); repo.run(["commit", "-m", "base"]);
    repo.run(["checkout", "-b", "feat"]);
    repo.write_file("f.txt", "theirs\n"); repo.run(["add", "."]); repo.run(["commit", "-m", "theirs"]);
    repo.run(["checkout", "main"]);
    repo.write_file("f.txt", "ours\n"); repo.run(["add", "."]); repo.run(["commit", "-m", "ours"]);
    let merge = std::process::Command::new("git").arg("-C").arg(repo.path()).args(["merge", "feat"]).output().unwrap();
    assert!(!merge.status.success(), "merge must conflict");

    let c = conflict_file(repo.path(), "f.txt").expect("conflict data");
    assert_eq!(c.ours.trim(), "ours");
    assert_eq!(c.theirs.trim(), "theirs");
    assert_eq!(c.base.as_deref().map(str::trim), Some("base"));
    assert_eq!(c.blocks.len(), 1);

    mark_resolved(repo.path(), "f.txt").expect("resolve stages file");
    let status = repository_status(repo.path()).expect("status");
    assert!(!status.has_conflicts);
}

#[test]
fn blame_segments_merge_consecutive_lines_of_same_commit() {
    let repo = TempGitRepo::new();
    repo.write_file("f.txt", "a\nb\n"); repo.run(["add", "."]); repo.run(["commit", "-m", "c1"]);
    repo.write_file("f.txt", "a\nb\nc\n"); repo.run(["add", "."]); repo.run(["commit", "-m", "c2"]);

    let blame = blame_file(repo.path(), "f.txt").expect("blame");
    assert_eq!(blame.segments.len(), 2, "two commits → two segments");
    assert_eq!(blame.segments[0].line_start, 1);
    assert_eq!(blame.segments[0].line_count, 2);
    assert_eq!(blame.segments[1].line_start, 3);
    assert!(!blame.truncated);
}
```

- [ ] **Step 2: Run RED**

Run: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git::tests::conflict_file -- --nocapture`
Expected: FAIL — functions missing.

- [ ] **Step 3: Implement**

```rust
pub const MAX_CONFLICT_BYTES: usize = 512 * 1_024;
pub const MAX_BLAME_LINES: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConflictBlock { pub start_line: u32, pub ours: Vec<String>, pub theirs: Vec<String> }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitConflictFile {
    pub path: String, pub base: Option<String>, pub ours: String, pub theirs: String,
    pub working: String, pub blocks: Vec<ConflictBlock>, pub truncated: bool,
}

pub fn conflict_file(workspace_root: &Path, path: &str) -> Result<GitConflictFile, String> {
    let repository_root = repository_root(workspace_root)?;
    let normalized = normalize_repo_relative_paths(&repository_root, &[path.to_string()])?;
    let rel = path_to_git_string(&normalized[0]);

    let show_stage = |stage: u8| -> Result<Option<String>, String> {
        let out = run_git_in(&repository_root, &["show".into(), format!(":{stage}:{rel}")]);
        match out {
            Ok(bytes) => {
                let truncated = bytes.len() > MAX_CONFLICT_BYTES;
                let slice = if truncated { &bytes[..MAX_CONFLICT_BYTES] } else { &bytes[..] };
                Ok(Some(String::from_utf8_lossy(slice).into_owned()))
            }
            Err(_) => Ok(None), // stage absent (add/add conflicts have no base)
        }
    };
    let base = show_stage(1)?;
    let ours = show_stage(2)?.ok_or("missing ours stage — file is not conflicted")?;
    let theirs = show_stage(3)?.ok_or("missing theirs stage — file is not conflicted")?;
    let working_bytes = std::fs::read(repository_root.join(&normalized[0])).map_err(|e| e.to_string())?;
    let truncated = working_bytes.len() > MAX_CONFLICT_BYTES;
    let working = String::from_utf8_lossy(&working_bytes[..working_bytes.len().min(MAX_CONFLICT_BYTES)]).into_owned();
    let blocks = parse_conflict_blocks(&working);

    Ok(GitConflictFile { path: rel, base, ours, theirs, working, blocks, truncated })
}

pub(crate) fn parse_conflict_blocks(working: &str) -> Vec<ConflictBlock> {
    let mut blocks = Vec::new();
    let mut state = 0u8; // 0 outside, 1 in ours, 2 in theirs
    let mut current = ConflictBlock { start_line: 0, ours: Vec::new(), theirs: Vec::new() };
    for (i, line) in working.lines().enumerate() {
        if line.starts_with("<<<<<<<") { state = 1; current = ConflictBlock { start_line: (i + 1) as u32, ours: Vec::new(), theirs: Vec::new() }; }
        else if line.starts_with("=======") && state == 1 { state = 2; }
        else if line.starts_with(">>>>>>>") && state == 2 { state = 0; blocks.push(std::mem::replace(&mut current, ConflictBlock { start_line: 0, ours: Vec::new(), theirs: Vec::new() })); }
        else if state == 1 { current.ours.push(line.to_string()); }
        else if state == 2 { current.theirs.push(line.to_string()); }
    }
    blocks
}

pub fn mark_resolved(workspace_root: &Path, path: &str) -> Result<GitRepositoryStatus, String> { /* stage_paths(&[path]) — reuse */ }
pub fn accept_conflict_side(workspace_root: &Path, path: &str, side: &str, confirmation: &str) -> Result<GitRepositoryStatus, String> {
    let expected = match side { "ours" => "ACCEPT OURS", "theirs" => "ACCEPT THEIRS", _ => return Err("invalid side".into()) };
    require_confirmation(confirmation, expected)?;
    /* `checkout --ours|--theirs -- <path>` then stage_paths then repository_status */
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlameSegment { pub hash: String, pub short_hash: String, pub author: String, pub when_unix: i64, pub line_start: u32, pub line_count: u32 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitBlameFile { pub path: String, pub segments: Vec<BlameSegment>, pub truncated: bool }

pub fn blame_file(workspace_root: &Path, path: &str) -> Result<GitBlameFile, String> {
    // `git blame --porcelain` emits: "<hash> <orig> <final> [count]" then key-value headers
    // (author, author-time, …) for first occurrence, then "\t<content>" per line.
    // Walk lines, track per-hash author/time, emit (hash, final_line) pairs, merge consecutive.
    /* full implementation: ~45 lines; tests above define the contract */
}
```

For `git_file_history`, add to `git_log.rs`:

```rust
pub fn file_history(workspace_root: &Path, path: &str, limit: usize) -> Result<GitLogPage, String> {
    let normalized = git::normalize_repo_relative_paths(Path::new(""), &[path.to_string()])?;
    let limit = limit.clamp(1, MAX_LOG_ROWS);
    let args = vec![
        "log".into(), "--follow".into(), "-z".into(),
        "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s".into(),
        "-n".into(), (limit + 1).to_string(), "--".into(),
        normalized[0].to_string_lossy().into_owned(),
    ];
    // parse identically to log_page but skip lane assignment (single file → linear list, lane 0)
    /* share the record-parsing block with log_page via a small helper */
}
```

- [ ] **Step 4: GREEN + gate + register + commit**

Register `git_conflict_file`, `git_mark_resolved`, `git_accept_conflict_side`, `git_blame_file`, `git_file_history`.

```bash
git add src-tauri/src/git.rs src-tauri/src/git_log.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add conflict three-way, blame, and file history

- stage 1/2/3 versions with parsed conflict blocks and bounds
- accept-side with typed confirmation and mark-resolved staging
- porcelain blame merged into per-commit segments
- file history with --follow pagination

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 7: Frontend Git Log — Model, DAG View, Detail, Filters, Context Menu, Export Dialog

**Files:**
- Create: `src/features/git/git-log-model.ts`, `src/features/git/git-log-model.test.ts`
- Create: `src/features/git/GitLogView.tsx`, `src/features/git/GitLogView.test.tsx`
- Modify: `src/features/git/git-api.ts`, `src/index.css`

- [ ] **Step 1: Write failing model tests**

`git-log-model.test.ts` (Bun + existing happy-dom setup conventions from `git-model.test.ts`):

```typescript
import { describe, expect, test } from "bun:test";
import {
  createGitLogState, storeLogPage, setLogFilter, selectLogCommit,
  storeCommitDetail, edgePath, laneX, openExportDialog, setExportField,
} from "./git-log-model";

const row = (hash: string, lane = 0, edges: object[] = []) => ({
  hash, short_hash: hash.slice(0, 7), subject: "s", author: "a", when_unix: 1,
  refs: [], parents: [], lane, lane_overflow: false, merge: false, edges,
});

describe("git log model", () => {
  test("storeLogPage replaces rows and tracks has_more", () => {
    const next = storeLogPage(createGitLogState(), {
      rows: [row("aaaaaaa1"), row("aaaaaaa2", 1)], has_more: true, total_loaded: 2, truncated: false,
    });
    expect(next.rows.length).toBe(2);
    expect(next.hasMore).toBe(true);
    expect(next.loadedPages).toBe(1);
  });

  test("setLogFilter resets pagination", () => {
    let s = storeLogPage(createGitLogState(), { rows: [row("a1")], has_more: true, total_loaded: 1, truncated: false });
    s = setLogFilter(s, { author: "mina" });
    expect(s.rows.length).toBe(0);
    expect(s.loadedPages).toBe(0);
    expect(s.filter.author).toBe("mina");
  });

  test("selectLogCommit stores selection and detail cache is keyed by hash", () => {
    let s = storeLogPage(createGitLogState(), { rows: [row("abc1234")], has_more: false, total_loaded: 1, truncated: false });
    s = selectLogCommit(s, "abc1234");
    s = storeCommitDetail(s, { hash: "abc1234", files: [], files_truncated: false } as never);
    expect(s.selectedHash).toBe("abc1234");
    expect(s.detailByHash["abc1234"]).toBeDefined();
  });

  test("edgePath renders svg paths for through/fork/join", () => {
    expect(edgePath({ from_lane: 0, to_lane: 0, kind: "through" })).toBe("M14 -4 L14 40");
    expect(edgePath({ from_lane: 0, to_lane: 1, kind: "fork" })).toBe("M14 18 C 14 30, 34 28, 34 40");
    expect(edgePath({ from_lane: 1, to_lane: 0, kind: "join" })).toBe("M34 -4 C 34 8, 14 10, 14 18");
    expect(laneX(2)).toBe(54);
  });

  test("export dialog state transitions", () => {
    let s = openExportDialog(createGitLogState(), "abc1234");
    s = setExportField(s, "scope", "snapshot");
    s = setExportField(s, "format", "zip");
    expect(s.exportDialog).toEqual({ hash: "abc1234", scope: "snapshot", format: "zip", destination: "", overwrite: false });
  });
});
```

- [ ] **Step 2: Run RED**

Run: `bun test src/features/git/git-log-model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `git-log-model.ts`**

Pure state + helpers; key shapes:

```typescript
export type GitGraphEdge = { from_lane: number; to_lane: number; kind: "through" | "fork" | "join" | "stop" };
export type GitLogRow = {
  hash: string; short_hash: string; subject: string; author: string; when_unix: number;
  refs: { name: string; kind: "head" | "branch" | "tag" }[];
  parents: string[]; lane: number; lane_overflow: boolean; merge: boolean; edges: GitGraphEdge[];
};
export type GitLogFilter = { branch?: string; author?: string; since?: string; grep?: string; path?: string };
export type GitExportDialog = { hash: string; scope: "changed_files" | "snapshot"; format: "folder" | "zip"; destination: string; overwrite: boolean };
export type GitLogState = {
  rows: GitLogRow[]; hasMore: boolean; truncated: boolean; loadedPages: number;
  loading: boolean; error: string | null; filter: GitLogFilter;
  selectedHash: string | null; detailByHash: Record<string, GitCommitDetail>;
  exportDialog: GitExportDialog | null;
};

export const LOG_PAGE_SIZE = 200;
export const laneX = (lane: number) => 14 + lane * 20;
export function edgePath(e: GitGraphEdge): string {
  const fx = laneX(e.from_lane), tx = laneX(e.to_lane);
  switch (e.kind) {
    case "through": return `M${fx} -4 L${fx} 40`;
    case "stop": return `M${fx} -4 L${fx} 18`;
    case "fork": return `M${fx} 18 C ${fx} 30, ${tx} 28, ${tx} 40`;
    case "join": return `M${fx} -4 C ${fx} 8, ${tx} 10, ${tx} 18`;
  }
}
```

Reducers follow the `git-model.ts` immutability style (spread + return new object). `setLogFilter` clears `rows/loadedPages/selectedHash`. `storeLogPage` sets `loadedPages = Math.ceil(total_loaded / LOG_PAGE_SIZE)`.

- [ ] **Step 4: GREEN on model tests**

Run: `bun test src/features/git/git-log-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing view tests, then implement `GitLogView.tsx`**

View tests (happy-dom + `@testing-library/react`, mirroring `GitPanel.test` patterns) assert: renders filter bar with four filter buttons and search input; renders one `<tr>` per row with refs badges and lane SVG (`querySelectorAll("svg path, svg line").length > 0`); clicking a row calls `onSelectCommit`; right-click (fireEvent.contextMenu) calls `onOpenContextMenu` with hash and position; export dialog renders scope/format segmented controls and disables Export until destination non-empty; "Load more" button appears when `hasMore`.

`GitLogView.tsx` structure (all classes from the design doc / `index.css`):

```tsx
<div className="git-log-view">
  <div className="log-filters">…4 個 .fsel 下拉 + .input2 搜尋 + .badge2 計數…</div>
  <div className="git-log-split">
    <table className="dbgrid gitlog">
      <thead>…Graph/Description/Author/When/Commit…</thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.hash} className={r.hash === selectedHash ? "sel" : ""}
              onClick={() => onSelectCommit(r.hash)}
              onContextMenu={e => { e.preventDefault(); onOpenContextMenu(r.hash, e.clientX, e.clientY); }}>
            <td><svg width="92" height="36">{r.edges.map(e => <path key={…} d={edgePath(e)} className={`lane-${e.from_lane}`} />)}<circle cx={laneX(r.lane)} cy="18" r="5" /></svg></td>
            …refs badges + subject、author、relative time（純函式 formatWhen(when_unix, nowUnix) — nowUnix 由 props 傳入，保持可測）、short_hash…
          </tr>))}
      </tbody>
    </table>
    <GitCommitDetailPane detail={detailByHash[selectedHash]} onOpenFileDiff={…} onExport={() => onOpenExport(selectedHash)} …/>
  </div>
  {hasMore && <button className="btn sm" onClick={onLoadMore}>Load more</button>}
  {exportDialog && <GitExportDialog …/>}
</div>
```

`GitExportDialog` is a local component in the same file: `.modal` markup with two `.segmented` groups (scope/format), destination `.input2` + Browse button (calls `onBrowseDestination` prop — AppShell wires the Tauri dialog), preview file list from `detailByHash[hash].files` (folders derived by splitting paths), footer Cancel/Export. Lane colors: add `.lane-0 { stroke: var(--yuzu); } .lane-1 { stroke: #82aaff; } …` (6-color cycle, `lane-N` class uses `n % 6`) to `index.css`.

- [ ] **Step 6: GREEN, API wrappers, commit**

Add to `git-api.ts`: `getGitLogPage`, `getGitCommitDetail`, `getGitCommitFileDiff`, `cherryPickGit`, `revertGitCommit`, `resetGitTo`, `exportGitCommit` — each a 3-line `call("git_…", {...})` wrapper typed against the model types.

Run: `bun test src/features/git/` → PASS. `bun run build` → PASS.

```bash
git add src/features/git/git-log-model.ts src/features/git/git-log-model.test.ts src/features/git/GitLogView.tsx src/features/git/GitLogView.test.tsx src/features/git/git-api.ts src/index.css
git commit -m "feat: add git log frontend with dag rendering

- pure log state with filters, pagination, detail cache, export dialog
- dag table renders precomputed lanes and edges as svg paths
- context menu hook, detail pane, and export dialog ui

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 8: Frontend Diff Viewer Upgrade And Partial Staging

**Files:**
- Create: `src/features/git/git-diff-model.ts`, `src/features/git/git-diff-model.test.ts`
- Modify: `src/features/git/GitDiffView.tsx`; Create: `src/features/git/GitDiffView.test.tsx`
- Modify: `src/features/git/git-api.ts`, `src/index.css`

- [ ] **Step 1: Failing model tests**

```typescript
import { describe, expect, test } from "bun:test";
import { alignSideBySide, createDiffSelection, toggleHunk, toggleLine, selectionsForApi } from "./git-diff-model";

const hunk = {
  header: "@@ -1,3 +1,3 @@", old_start: 1, old_lines: 3, new_start: 1, new_lines: 3,
  lines: [
    { kind: "context", old_no: 1, new_no: 1, text: "ctx", word_ranges: [] },
    { kind: "del", old_no: 2, new_no: null, text: "old", word_ranges: [[0, 3]] },
    { kind: "add", old_no: null, new_no: 2, text: "new", word_ranges: [[0, 3]] },
  ],
};

describe("git diff model", () => {
  test("alignSideBySide pairs del/add and pads with fill", () => {
    const rows = alignSideBySide([hunk] as never);
    expect(rows[0]).toEqual({ left: hunk.lines[0], right: hunk.lines[0], hunkIndex: 0, kind: "context" });
    expect(rows[1].left).toBe(hunk.lines[1]);
    expect(rows[1].right).toBe(hunk.lines[2]);
  });

  test("toggleHunk selects all lines; toggleLine flips one; selectionsForApi serializes", () => {
    let sel = toggleHunk(createDiffSelection(), 0, hunk as never);
    expect(selectionsForApi(sel)).toEqual([{ hunk_index: 0, line_indices: null }]);
    sel = toggleLine(sel, 0, 2, hunk as never);
    expect(selectionsForApi(sel)).toEqual([{ hunk_index: 0, line_indices: [1] }]);
  });
});
```

- [ ] **Step 2: RED**

Run: `bun test src/features/git/git-diff-model.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `git-diff-model.ts`**

`alignSideBySide(hunks)`: walk each hunk; greedily pair runs of Del lines with the following run of Add lines index-by-index; unpaired side gets `{ kind: "fill" }`. Context lines map to identical left/right. Selection state: `{ byHunk: Record<number, "all" | Set<number>> }` with `toggleHunk` (all ↔ none), `toggleLine` (promotes "all" to explicit Set first, drops empty sets), `selectionsForApi` mapping `"all"` → `line_indices: null` and Sets → sorted arrays of indices that are Add/Del lines only.

- [ ] **Step 4: GREEN, then view tests + implementation**

`GitDiffView.test.tsx` asserts: segmented control switches `unified`/`side-by-side` rendering (both modes consume the same `GitDiffHunks`); word ranges render as `<mark>` spans inside the changed region; each hunk renders a `.hunkbar` with a checkbox, `Stage Hunk` (or `✓ Staged`/`Unstage` when `staged` prop), and `Revert…`; line checkboxes appear only for add/del lines; `Stage Selected Lines` button fires `onStageSelections(selectionsForApi(state))`; binary and truncated notices keep their existing rendering.

Rewrite `GitDiffView.tsx` to consume `GitDiffHunks` (keep the component name and the toolbar/empty/loading/binary states; replace the raw-string `DiffLines` body). The mode toggle lives in the toolbar as `.segmented`. Word-level render helper:

```tsx
function lineText(text: string, ranges: [number, number][]) {
  if (!ranges.length) return text;
  const [s, e] = ranges[0];
  return (<>{text.slice(0, s)}<mark>{text.slice(s, e)}</mark>{text.slice(e)}</>);
}
```

Revert flows through the existing AppShell confirmation dialog (`DISCARD`), passed in as `onRevertHunk(selections)` prop — the view never calls the API directly, matching current GitPanel prop style.

- [ ] **Step 5: GREEN + API + commit**

Add `getGitDiffHunks`, `stageGitHunks`, `unstageGitHunks`, `revertGitHunk` to `git-api.ts`. Run `bun test src/features/git/ && bun run build` → PASS.

```bash
git add src/features/git/git-diff-model.ts src/features/git/git-diff-model.test.ts src/features/git/GitDiffView.tsx src/features/git/GitDiffView.test.tsx src/features/git/git-api.ts src/index.css
git commit -m "feat: upgrade diff viewer with partial staging

- structured hunks render unified and side-by-side with word marks
- hunk and line selection state serializes to staging api
- hunk bars stage, unstage, and confirmed revert

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 9: Frontend Conflict Resolver, Branch Popup, Stash UI, Blame Gutter

**Files:**
- Create: `src/features/git/GitConflictView.tsx` + test, `src/features/git/GitBranchPopup.tsx` + test, `src/features/git/GitBlameGutter.tsx` + test
- Modify: `src/features/git/git-model.ts` + test (stash/branch/blame types + reducers), `src/features/git/git-api.ts`, `src/index.css`

- [ ] **Step 1: Failing tests (one suite per component)**

Key assertions, in the existing testing-library style:

- `GitConflictView.test.tsx`: renders three `.ccol` columns headed Ours/Result/Theirs; one `.cblock` per conflict block; per-block buttons fire `onAcceptOurs(blockIndex)` / `onAcceptTheirs(blockIndex)` / `onResolveBlock(blockIndex)`; toolbar shows `N of M remaining` and `Mark Resolved` disabled until all blocks resolved; `Accept All Ours` fires `onAcceptAllOurs` (AppShell confirms `ACCEPT OURS`).
- `GitBranchPopup.test.tsx`: search input filters rows; Local and Remote `.mlabel` groups; current branch highlighted with yuzu; clicking a row opens the actions submenu; Delete fires `onDeleteBranch(name)` (confirmation in AppShell); stash section lists entries with Apply/Pop/Branch…/Drop… buttons firing typed callbacks; favorite star toggles `onToggleFavorite(name)`.
- `GitBlameGutter.test.tsx`: renders one `.brow` per segment spanning `line_count` rows worth of height (`style.height` = `count * lineHeight`); hovering a segment calls `onHoverSegment(hash)`; clicking calls `onOpenInLog(hash)`.

- [ ] **Step 2: RED**

Run: `bun test src/features/git/GitConflictView.test.tsx src/features/git/GitBranchPopup.test.tsx src/features/git/GitBlameGutter.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the three components + model additions**

All markup uses design-doc classes (`.conflict3`, `.cblock.ours/.result/.theirs`, `.cacts`; `.menu`, `.mi`, `.mlabel`, `.msep`; `.stashrow`; `.blame`, `.brow`). Local Result-block edit state: each block tracks `resolvedText: string | null`; `onResolveBlock` passes the final text up. Model additions in `git-model.ts`: `branchesFull`, `stashes`, `blame`, `favoriteBranches: string[]` fields with `storeBranchesFull` / `storeStashes` / `storeBlame` / `toggleFavoriteBranch` reducers and tests.

- [ ] **Step 4: GREEN + API wrappers + commit**

Add wrappers: `getGitBranchesFull`, `mergeGitBranch`, `deleteGitBranch`, `renameGitBranch`, `getGitStashList`, `applyGitStash`, `popGitStash`, `dropGitStash`, `branchFromGitStash`, `getGitConflictFile`, `markGitResolved`, `acceptGitConflictSide`, `getGitBlameFile`, `getGitFileHistory`.

Run: `bun test src/features/git/ && bun run build` → PASS.

```bash
git add src/features/git/ src/index.css
git commit -m "feat: add conflict resolver, branch popup, stash ui, blame gutter

- three-way conflict view with per-block accept and resolve flow
- branch popup with search, groups, favorites, and action submenu
- stash list with apply, pop, branch, and confirmed drop
- blame gutter segments with hover highlight and log navigation

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 10: AppShell Integration, Palette, Verification, Docs

**Files:**
- Modify: `src/app/AppShell.tsx`, `src/app/AppShell.contract.test.tsx`, `src/app/workspace-view-state.ts` + test, `src/app/command-palette-model.ts`, `src/index.css`
- Modify after verification: `docs/architecture/progress.md`, `roadmap.md`; Create: `docs/architecture/git-deep-dive-results.md`

- [ ] **Step 1: Failing contract tests**

Add to `AppShell.contract.test.tsx` (with Tauri IPC mocks, existing pattern): opening the Git rail then "View log" opens the new GitLogView surface (old GitGraphView import is deleted); selecting a mocked conflicted file opens GitConflictView; status-bar branch chip opens GitBranchPopup; palette includes `Git: Export Commit…`, `Git: Toggle Blame`, `Git: Branches…`, and `Git: Rebase Current Branch…` (replacing the hardcoded `git-rebase-main` — the new command prompts for a target via the branch popup); export dialog Browse calls the mocked `@tauri-apps/plugin-dialog` `open({ directory: true })`.

- [ ] **Step 2: RED**

Run: `bun test src/app/AppShell.contract.test.tsx` → FAIL on the new assertions.

- [ ] **Step 3: Wire everything**

- Replace `GitGraphView` usage with `GitLogView`; delete `src/features/git/GitGraphView.tsx` and its references (its tests are superseded by `GitLogView.test.tsx`).
- Per-workspace view state: add `gitLog: { filter, blameOn, favoriteBranches }` to `workspace-view-state.ts` with frozen defaults + tests.
- Confirmation dialog: extend the existing `GitConfirmationRequest` flow with the new texts (`REVERT <short>`, `RESET <short>`/`RESET HARD <short>`, `DROP stash@{n}`, `DELETE <branch>`, `ACCEPT OURS`/`ACCEPT THEIRS`); all flow through `confirmationTextForGitAction` — extend that function and its tests in `git-model.ts`.
- Export destination via `open({ directory: true })` from `@tauri-apps/plugin-dialog`; on export success show the existing toast pattern with a Reveal button (`revealItemInDir` from the dialog/opener plugin if present; otherwise omit Reveal — check `package.json` before adding any plugin).
- Palette: add the four commands to `command-palette-model.ts` and `runCommand`.

- [ ] **Step 4: GREEN on full frontend**

Run: `bun test` → all suites PASS (including pre-existing). `bun run build` → PASS.

- [ ] **Step 5: Full verification gate**

Run in order; record outputs verbatim for the results doc:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
. "$HOME/.cargo/env" && bun run tauri build --debug
```

Expected: all PASS (Vite chunk-size warning remains acceptable).

- [ ] **Step 6: Measurements**

Against this repo itself (190+ commits) measure and record: `git_log_page` 200-row first page latency (target < 150 ms), `git_blame_file` on `src/app/AppShell.tsx` (target < 400 ms), export of a representative commit (changed-files folder mode). Use `std::time::Instant` prints behind a temporary `--nocapture` test or the existing metrics pattern from `src-tauri/src/metrics.rs`.

- [ ] **Step 7: Docs and roadmap**

- Create `docs/architecture/git-deep-dive-results.md` following the node-9 results format: Scope, TDD Evidence (per task RED/GREEN commands **plus 1-2 lines of the observed RED failure output** — this closes the evidence-depth gap flagged in the 2026-06-11 audit), Review Evidence, Verification Evidence, Measurements, Residual Risks.
- Update `docs/architecture/progress.md` with a "Git Deep Dive" section (same structure as prior nodes).
- Update `roadmap.md`: insert a "Node 10.5: Git Deep Dive" block after Node 10 with Status/Goal/Scope/Acceptance/Non-goals, and — fixing the audit finding — add the missing `**Status:**` lines to Node 4, Node 6, and Node 7 blocks while in the file.

- [ ] **Step 8: Final commit**

```bash
git add src/app/ src/features/git/ src/index.css docs/architecture/ roadmap.md
git commit -m "feat: integrate git deep dive into workbench

- git log surface replaces commit graph, conflict and blame wired
- branch popup from status bar, palette export and rebase commands
- workspace-scoped log filters, favorites, and blame toggle
- record verification results and roadmap status

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Node-Level Acceptance Checklist

- [ ] Log renders true parent-edge DAG (fork/join visible on a merge), filters by branch/author/date/path/text, paginates past 200 rows, and opens commit detail with changed files.
- [ ] Right-click commit actions work: checkout revision, new branch, cherry-pick, confirmed revert, confirmed reset (soft/mixed/hard), compare, copy hash, export.
- [ ] Export Commit produces (a) changed-files-only folder with directory structure and commit-version content, (b) snapshot zip; refuses silent overwrite; respects 2,000-file/200 MB bounds.
- [ ] A single hunk and a single line can be staged, unstaged, and revert requires typed `DISCARD`.
- [ ] Diff shows side-by-side with word-level marks and switches to unified.
- [ ] A real conflicted merge can be resolved block-by-block and committed.
- [ ] Branch popup lists local/remote with ahead/behind, supports merge/rename/confirmed delete/favorites; stash list supports apply/pop/branch/confirmed drop.
- [ ] Blame gutter segments render and click-through to the log; file history follows renames.
- [ ] All payloads remain bounded with `truncated` flags; no large dataset enters React global state; Monaco/xterm lazy-loading untouched.
- [ ] Full verification gate passes; measurements recorded; progress/roadmap/results docs updated.

## Plan Self-Review

- **Spec coverage:** all six design-doc surfaces map to tasks (S1→3/4/7, S1+export→4/7, S2→1/2/8, S3→1/8, S4→6/9, S5→5/9, S6→6/9, integration→10). The 17-command table maps: hunks(1), staging(2), log(3), detail/actions/export(4), branches/stash(5), conflict/blame/history(6).
- **Placeholder scan:** four Rust function bodies in Tasks 4–6 are intentionally specified as "mirror existing shape, write in full" with their exact git invocations and confirmation strings given — the implementer has the complete contract via the failing tests above them. No TBD/TODO markers remain.
- **Type consistency:** `HunkSelection { hunk_index, line_indices }` is used identically in Task 2 (Rust), Task 8 (`selectionsForApi`), and the API wrappers. `GitLogRow`/`GraphEdge` field names match between `git_log.rs` serde and `git-log-model.ts`. Confirmation strings match between Rust `require_confirmation` calls and `confirmationTextForGitAction` extensions listed in Task 10.
- **Known risk:** `branches_full` remote detection heuristic is flagged in Task 5 with the fallback strategy (two-namespace queries) if the test disproves it.
