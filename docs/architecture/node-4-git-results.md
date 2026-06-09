# Node 4 Git Results

## Scope

- Rust Git CLI domain for status, diff, stage, unstage, discard, commit, amend,
  stash, branch list/create/checkout, fetch, pull, push, reset hard, rebase, and
  bounded commit graph.
- Trusted-workspace Tauri command wrappers for all Node 4 Git commands.
- Frontend Git API, pure Git view state, branch labels, diff cache, graph cache,
  status grouping, confirmation descriptors, and decoration maps.
- Source Control panel with staged and unstaged changes, commit message,
  commit-push, amend, stash, branch, and remote actions.
- Diff and commit graph workbench surfaces.
- Explorer and tab Git decorations.
- Confirmation dialog guardrails for discard, checkout, reset hard, and rebase.
- File watcher and task-finished refresh hooks that ignore internal `.git`
  updates.
- Narrow-screen Git diff and graph toolbar wrapping discovered during final
  browser smoke.

## Verification

| Command | Result |
| --- | --- |
| `bun test` | PASS: 97 tests, 0 failed |
| `bun run build` | PASS: exit 0; Vite chunk-size warning only |
| `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml` | PASS: 97 Rust lib tests, 0 failed |
| `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check` | PASS |
| `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | PASS |
| `. "$HOME/.cargo/env" && bun run tauri build --debug` | PASS: built debug app and debug DMG |
| `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git::tests -- --nocapture` | PASS: 9 focused Git tests, 0 failed |
| `bun test src/features/git/git-responsive-css.test.ts` | PASS: 1 focused responsive CSS test, 0 failed |
| `git diff --check` | PASS |

Build artifacts:

- Debug app:
  `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app`
- Debug DMG:
  `src-tauri/target/debug/bundle/dmg/Yuuzu-IDE_0.1.0_aarch64.dmg`

## Smoke Evidence

Browser smoke used `http://127.0.0.1:1420/` with Playwright CLI against the
Vite dev server. Normal browser execution does not provide Tauri IPC, so the
repo-backed Git flows are covered by Rust command tests and the browser smoke
uses injected Tauri IPC mocks for UI state rendering.

| Flow | Evidence |
| --- | --- |
| No-repository Source Control | Snapshot found Source Control, disabled commit, refresh enabled, graph disabled, disabled branch and remote actions, empty staged and unstaged sections, and `No Git status available`. |
| Mocked repository status | Snapshot found Git rail badge `3`, branch `main`, `main ahead 1`, one staged change, two unstaged changes, enabled graph, enabled fetch-pull-push, and stash enabled while commit stayed disabled without a message. |
| Diff surface | Clicking `README.md` opened the diff surface with path label, `Unstaged` badge, refresh action, and unified diff lines. |
| Commit graph surface | Clicking View graph opened Commit Graph with branch label `main ahead 1`, Fetch and All branches controls, commit rows, refs, author, date, and short hashes. |
| Desktop layout sanity | Browser eval found 36 visible controls in Git graph state, no narrow text overflow, and only expected compact 20 px icon row actions. |
| Mobile layout sanity | At 390 by 844, Git graph toolbar buttons were no longer offscreen after the responsive fix; toolbar computed `flex` was `0 1 auto`, height grew to 132 px, and table content remained horizontally scrollable inside a bounded wrapper. |

Playwright artifacts were removed after the smoke run.

## Measurements

| Measurement | Result | Pass Target |
| --- | ---: | ---: |
| Focused Rust Git tests, hot run | 0.75 s total shell time | responsive |
| Focused Rust Git test binary runtime | 0.35 s | responsive |
| Diff payload cap | 240 KiB plus truncation marker | bounded |
| Commit graph cap | 120 commits | bounded |
| Mobile graph toolbar overflow | 0 offscreen toolbar controls | no offscreen controls |
| Mobile graph table containment | wrapper width 120 px, scroll width 439 px | bounded with internal scroll |

## TDD And Review Evidence

- Task 1 used Rust RED/GREEN cycles for porcelain status parsing, path escape
  rejection, diff payload caps, literal wildcard pathspec handling, and
  deterministic rename parsing.
- Task 2 used Rust RED/GREEN cycles for stage, unstage, discard, commit, amend,
  stash, branch creation, checkout, fetch, pull, push, reset hard, rebase, blank
  input guards, path containment, literal pathspecs, and exact confirmation
  strings.
- Task 3 used Bun RED/GREEN cycles for frontend Git API and pure Git state,
  including grouping, branch labels, diff cache keys, branch ordering, bounded
  graph rows, confirmation text, refresh decisions, and decoration maps.
- Task 4 used Bun and UI RED/GREEN cycles for the Source Control panel,
  action-state gating, commit message handling, branch controls, staged and
  unstaged rows, conflict gating, and sidebar scrolling.
- Task 5 used Bun and UI RED/GREEN cycles for Git diff and graph surfaces,
  repository-action gating, branch graph refresh, and bounded view containers.
- Task 6 used Bun and UI RED/GREEN cycles for explorer and tab Git decorations,
  file watcher refresh suppression for `.git` internals, task-finished refresh,
  and typed confirmation dialogs.
- Final smoke found a narrow-screen graph-toolbar overflow. The follow-up fix
  added `src/features/git/git-responsive-css.test.ts`, first failed because the
  mobile toolbar rule did not override the base `flex: 0 0 38px`, then passed
  after adding `flex: 0 1 auto` and bounded toolbar/table CSS.
- Each implementation slice received implementer, spec-compliance reviewer, and
  code-quality reviewer coverage. Follow-up fixes were committed for literal
  diff pathspecs, rename parsing, public diff cache naming, conflict action
  gating, sidebar scrolling, bounded Git surfaces, repository action gating,
  `.git` watcher suppression, and mobile Git surface bounds.

## Commit Milestones

- `0bc3624` added the Node 4 implementation plan.
- `b349eb7` and `4310a43` added and hardened Git status and diff core.
- `33ebf11` added Git workflow mutation commands and guardrails.
- `8efbd9f` and `0e103cc` added and aligned the frontend Git API and state
  model.
- `7067fd6` and `785c5c4` added and hardened the Source Control panel.
- `c91f272` and `a66353d` added and bounded Git diff and graph views.
- `bedb1c9` and `328a0c1` added Git decorations and watcher/task refresh
  safeguards.
- `a6ae8c2` fixed narrow-screen Git diff and graph surface bounds found during
  final smoke.

## Residual Risks

- Normal browser preview cannot execute real Tauri Git IPC. Runtime confidence
  comes from Rust Git command tests, Tauri debug build, frontend state tests, and
  mocked browser UI smoke.
- Desktop WebView automation for real Git UI interaction remains unavailable in
  this environment, so the full edit-test-commit-push cycle is covered by
  command-level tests and mocked UI state rather than an end-to-end desktop
  click path.
- Vite still emits chunk-size warnings because Monaco workers remain large.
  Node 4 accepts this because builds exit 0 and heavy editor/terminal surfaces
  remain lazy-loaded.

## Result

Node 4 passes with the daily Git workflow implemented inside the app: registered
workspaces can load Git status, stage and unstage files, inspect diffs, commit,
amend, stash, switch and create branches, fetch, pull, push, inspect a bounded
commit graph, see Git decorations, and run destructive actions only after exact
typed confirmation.
