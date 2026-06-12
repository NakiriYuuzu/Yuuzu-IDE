# Git Deep Dive Results

## Status

Completed and passed on the current macOS host.

## Scope

- Real DAG commit log with topo-order parsing, streaming lane assignment
  (fork/join/stop edges, 12-lane clamp), branch/author/date/path/text filters,
  prefix-recompute pagination bounded at 2,000 rows, and a commit detail
  sidebar with name-status + numstat file lists.
- Commit actions: checkout revision, new branch from commit, cherry-pick,
  confirmed revert (`REVERT <short>`), confirmed reset soft/mixed/hard
  (`RESET <short>` / `RESET HARD <short>`), copy hash, and export.
- Single-commit export: changed-files or snapshot scope, folder or zip format,
  commit-version content (never the working tree), folder structure preserved,
  overwrite refusal that lists conflicting paths, 2,000-file / 200 MB bounds,
  zip-slip guard on snapshot extraction.
- Hunk- and line-level partial staging through patch reconstruction with
  recounted headers, applied via `git apply --cached` (and `-R` for unstage /
  confirmed `DISCARD` revert).
- Structured diff hunks with prefix/suffix word-level ranges, unified and
  side-by-side rendering with `<mark>` word highlights.
- Three-way conflict resolver fed by stage 1/2/3 versions with parsed conflict
  blocks, per-block ours/theirs choices resolved client-side and written back,
  whole-side accepts behind `ACCEPT OURS` / `ACCEPT THEIRS` confirmations.
- Branch popup (status-bar chip) with local/remote groups, search, favorites,
  ahead/behind, merge/rename/confirmed delete (`DELETE <name>`), rebase-onto
  picker, and the stash suite (list/apply/pop/branch/confirmed
  `DROP stash@{n}`).
- Porcelain blame merged into per-commit segments rendered as an editor-side
  gutter with click-through to the log; file history with `--follow`.
- 24 new/upgraded async Tauri commands following the Spec A
  `spawn_blocking` pattern; all list payloads carry `truncated` flags.

## TDD Evidence

Each task ran RED before GREEN in the same session; representative observed
RED output is quoted per task.

### Task 1: Structured diff hunks (`705d5fa`)

- RED: `cargo test --manifest-path src-tauri/Cargo.toml git::tests::parses_unified_diff`
  failed with `error[E0433]: cannot find type 'GitLineKind'` and
  `error[E0425]: cannot find function 'parse_unified_diff' in this scope`.
- GREEN: `git::tests` 12 passed, 0 failed.
- Note: the plan's `word_diff_ranges` expectations were hand-recounted before
  implementation and corrected from `[[31, 53]]/[[31, 57]]` to
  `[[30, 51]]/[[30, 57]]` (common prefix is 30 chars, suffix 2).

### Task 2: Hunk/line staging (`6b3353a`)

- RED: `error[E0422]: cannot find struct ... 'HunkSelection'`,
  `error[E0425]: cannot find function 'build_selection_patch'`.
- GREEN: `git::tests` 15 passed, 0 failed; recounted header asserted as
  `@@ -1,2 +1,2 @@` per the plan's hand-recount instruction.

### Task 3: Log topology and lanes (`0121b86`)

- RED: `error[E0425]: cannot find function 'assign_lanes'`,
  `cannot find type 'EdgeKind'`, `cannot find value 'MAX_LANES'`.
- GREEN: `git_log::tests` 5 passed including the real-temp-repo integration
  test (merge row flagged, feature commits left lane 0).

### Task 4: Commit detail, actions, export (`0705f1c`)

- RED: `error[E0425]: cannot find function 'commit_detail' / 'export_commit' /
  'reset_to'`, `error[E0433]: cannot find type 'ExportScope' / 'ResetMode'`.
- GREEN: `git_log` 9 passed, 0 failed.
- Probe-driven corrections to the plan: plain `diff-tree` prints nothing for
  merge commits, so change lists use `-m --first-parent -M`; export paths are
  validated through `normalize_repo_relative_paths` (the plan's
  `starts_with` check alone does not resolve `..` components); confirmation
  short hashes come from `git rev-parse --short` to match the frontend `%h`.

### Task 5: Branches-full and stash suite (`6f28d02`)

- RED: `error[E0425]: cannot find function 'branches_full' / 'stash_list' /
  'stash_apply' / 'stash_drop'`.
- GREEN: `git::tests` 17 passed, 0 failed.
- Probe-driven corrections: `for-each-ref` accepts `%1f` hex literals but
  `stash list --format` uses log pretty-format syntax where the literal must
  be `%x1f` (verified against a live repo before implementation); remote
  detection queries `refs/heads` and `refs/remotes` separately instead of the
  plan's name heuristic.

### Task 6: Conflict three-way, blame, file history (`de00d78`)

- RED: `error[E0425]: cannot find function 'conflict_file' / 'mark_resolved' /
  'blame_file'`.
- GREEN: `git`-prefixed suites 29 passed, 0 failed, including blame segment
  merging and `--follow` rename tracking.

### Task 7: Frontend log model and DAG view (`6b20dd2`)

- RED: `bun test src/features/git/git-log-model.test.ts` failed with
  `Cannot find module './git-log-model'`.
- GREEN: 10 passed across model + view suites (filters, lane SVG, selection,
  context-menu hook, export dialog gating, load-more).

### Task 8: Diff viewer upgrade and partial staging (`b34a74d`)

- RED: `Cannot find module './git-diff-model'`; after the view rewrite, the
  line-checkbox count assertion caught the hunk checkbox sharing the line
  checkbox class (3 ≠ 2) and the classes were split.
- GREEN: full frontend suite 454 passed, 0 failed; AppShell diff pipeline and
  agent diff context migrated to structured hunks
  (`hunksToUnifiedText` feeds the agent context).

### Task 9: Conflict resolver, branch popup, stash UI, blame gutter (`00f9356`)

- RED: `Cannot find module './GitConflictView' / './GitBranchPopup' /
  './GitBlameGutter'`; git-model reducer additions asserted first.
- GREEN: 467 passed, 0 failed.

### Task 10: AppShell integration, palette, verification (this commit)

- RED: contract test `selecting a conflicted file opens the conflict resolver`
  first failed with `ReferenceError: replaceGitStatus is not defined` (import
  added), and the new view-state test failed with `updateGitLog` missing.
- GREEN: 87 contract tests passed; full suite below.

## Review Evidence

- Plan deviations were each verified by a live probe before coding (diff-tree
  merge behavior, `%x1f` vs `%1f`, rename `-z` record shapes, word-range
  arithmetic) and are recorded in the task notes above.
- Two clippy findings (`needless_range_loop`, `cloned_ref_to_slice_refs`) were
  fixed at gate time; every task ended with fmt + clippy clean.
- The `git-rebase-main` hardcoded palette dispatch was replaced by
  `git-rebase-branch`, which routes through the branch popup's
  "Rebase current onto this…" action and the existing `REBASE <target>`
  confirmation.

## Verification Evidence

All commands run at Task 10 completion on the current host:

- `bun test`: PASS — 476 tests, 0 failed (1,356 expect calls, 56 files).
- `bun run build`: PASS (`tsc && vite build`; pre-existing chunk-size
  warnings remain acceptable).
- `cargo test --manifest-path src-tauri/Cargo.toml`: PASS — 344 passed,
  0 failed, 3 ignored (the new host-repo measurement test is ignored by
  default).
- `cargo fmt --check`: PASS.
- `cargo clippy --all-targets --all-features -- -D warnings`: PASS.
- `bun run tauri build --debug`: PASS — produced both
  `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app` and
  `src-tauri/target/debug/bundle/dmg/Yuuzu-IDE_0.1.0_aarch64.dmg`.

## Measurements

Captured via the ignored `measure_log_blame_export_on_this_repo` test against
this repository (200+ commits) on the current host:

- `git_log_page` first page, 200 rows: **94 ms** (target < 150 ms).
- `git_blame_file` on `src/app/AppShell.tsx` (1,322 segments): **252 ms**
  (target < 400 ms).
- `export_commit` changed-files folder mode (11 files): **136 ms**.

## Residual Risks

- Lane assignment renders merges/branch points correctly on personal-scale
  repos; pathological octopus merges clamp into lane 11 with the
  `lane_overflow` flag rather than widening the graph.
- Per-block conflict resolution rewrites the file from parsed marker blocks;
  exotic conflict styles (`diff3` bases, nested markers) fall back to
  whole-side accepts or manual editing.
- The blame gutter assumes the editor's 19 px line height and does not yet
  scroll-sync with Monaco; it is positioned as a side gutter, not an inline
  decoration layer.
- `git_export_commit` destination validation requires absolute paths; network
  volumes and permission failures surface as command errors rather than a
  pre-flight check.
