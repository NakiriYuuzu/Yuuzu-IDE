# Docs Context And Markdown Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Node 5 so workspace documentation can be indexed, searched,
previewed, selected as future agent context, persisted as inspectable context
packs, and checked for stale file references.

**Architecture:** Rust owns trusted-workspace document discovery, docs-only
search, markdown preview payloads, staleness hints, and persisted context packs.
React owns the Docs activity, docs panel, markdown preview surface, context
source selection, context pack creation, and visible metadata links to
workspace, task runs, and future agent sessions. The UI follows
`docs/ui-design/` workbench density: compact rail icon, panel rows, badges,
toolbar controls, and full-width editor surfaces.

**Tech Stack:** Tauri 2 Rust commands, `ignore` 0.4.26 for bounded traversal,
serde JSON stores, Vite 8, React 19, TypeScript 6, Zustand, lucide-react, Bun
tests, Cargo tests, `react-markdown@latest`, and `remark-gfm@latest`.

---

## Source Material

- `roadmap.md` Node 5: Docs panel, markdown preview, docs index, docs-only
  search, context source selection, context pack creation, metadata links, and
  staleness hints.
- `docs/architecture/tech-stack.md`: Rust owns workspace operations and
  bounded search/indexing.
- `docs/ui-design/app.jsx`: compact left rail, workbench panels, tab/surface
  patterns, command palette expectations.
- `docs/ui-design/panels.jsx`: panel headers, row density, action icons,
  section labels, and compact metadata rows.
- `docs/ui-design/ide.css`: `.btn`, `.input2`, `.badge2`, `.dbgrid`, `.row`,
  and `.agent`/prompt styling for context pack inspection.

## File Structure

- Create `src-tauri/src/docs.rs`: documentation discovery, preview, docs-only
  search, reference extraction, staleness hints, context pack data types,
  context pack persistence, and Rust tests.
- Modify `src-tauri/src/commands.rs`: Tauri command wrappers that validate
  registered workspaces and delegate to docs functions/store methods.
- Modify `src-tauri/src/lib.rs`: register Node 5 docs commands and initialize
  the docs context store in app state.
- Create `src/features/docs/docs-api.ts`: typed Tauri calls for docs index,
  preview, search, context packs, and metadata links.
- Create `src/features/docs/docs-model.ts`: pure docs state, stale-result guards,
  source selection, context pack draft helpers, markdown title extraction, and
  source count/badge helpers.
- Create `src/features/docs/docs-model.test.ts`: Bun tests for pure docs state.
- Create `src/features/docs/DocsPanel.tsx`: Docs activity panel for index,
  docs-only search, selected source list, context pack creation, and pack list.
- Create `src/features/docs/MarkdownPreview.tsx`: markdown preview surface using
  `react-markdown` and `remark-gfm`.
- Modify `src/app/activity-rail.tsx`: add Docs activity with a `BookOpenText`
  icon.
- Modify `src/app/workspace-view-state.ts`: add `docs: DocsViewState` and
  surface `docs-preview`.
- Modify `src/app/AppShell.tsx`: load docs index on workspace changes, wire Docs
  panel callbacks, open markdown preview surface, create context packs, link
  packs to active task runs, show staleness hints, and expose command palette
  docs commands.
- Modify `src/app/command-palette-model.ts`: add docs commands.
- Modify `src/features/tasks/task-model.ts`: add optional frontend-only context
  metadata helpers for active task runs without changing Rust task execution.
- Modify `src/features/tasks/task-model.test.ts`: test task context metadata
  helpers.
- Modify `src/features/tasks/TaskPanel.tsx`: show selected context pack metadata
  for the active run and provide a link action.
- Modify `src/index.css`: add Docs panel, markdown preview, context pack, and
  staleness hint styles aligned with the existing workbench.
- Modify `package.json` and `bun.lock`: add latest markdown preview packages.
- Create `docs/architecture/node-5-docs-results.md`: evidence and measurements
  after implementation.
- Modify `docs/architecture/progress.md`: append Node 5 status and verification.
- Modify `roadmap.md`: mark Node 5 complete and move current priority to Node 6
  after verification.

## Shared Command Contract

Rust command payloads must use these command names:

```text
docs_index
docs_preview
docs_search
list_context_packs
create_context_pack
delete_context_pack
link_context_pack
```

Rust data types:

```rust
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

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ContextPack {
    pub id: String,
    pub workspace_root: String,
    pub name: String,
    pub doc_paths: Vec<String>,
    pub linked_task_run_ids: Vec<String>,
    pub linked_agent_session_ids: Vec<String>,
    pub created_ms: u64,
    pub updated_ms: u64,
}
```

Traversal rules:

- Index `README.md`, `AGENTS.md`, `roadmap.md`, and recursive `docs/`
  markdown files ending in `.md` or `.mdx` when present.
- Skip hidden directories, `node_modules`, `target`, `dist`, and files over
  512 KiB.
- Return repo-relative paths with forward slashes.
- Staleness is true when a markdown link points to a workspace file that exists
  and the referenced file modification time is newer than the doc modification
  time.
- Missing links are references, but not stale.
- Context pack IDs are UUID v4 strings.

---

### Task 1: Rust Docs Index, Preview, Search, And Staleness

**Files:**
- Create: `src-tauri/src/docs.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/docs.rs`

- [ ] **Step 1: Write failing Rust tests for docs indexing and preview**

Add these tests inside `#[cfg(test)] mod tests` in `src-tauri/src/docs.rs`:

```rust
#[test]
fn indexes_workspace_markdown_docs_with_titles_and_sections() {
    let temp = tempfile::tempdir().expect("temp dir");
    write_file(temp.path().join("README.md"), "# Root Readme\n");
    write_file(temp.path().join("docs/architecture/overview.md"), "# Architecture\n");
    write_file(temp.path().join("docs/guide.mdx"), "# Guide\n");
    write_file(temp.path().join("src/lib.rs"), "fn main() {}\n");

    let entries = index_docs(temp.path()).expect("index docs");

    assert_eq!(
        entries.iter().map(|entry| entry.path.as_str()).collect::<Vec<_>>(),
        vec!["README.md", "docs/architecture/overview.md", "docs/guide.mdx"],
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
```

- [ ] **Step 2: Write failing Rust tests for docs-only search bounds**

Add this test:

```rust
#[test]
fn search_docs_only_reads_markdown_sources_and_caps_matches() {
    let temp = tempfile::tempdir().expect("temp dir");
    write_file(temp.path().join("docs/a.md"), "# A\nagent context\n");
    write_file(temp.path().join("docs/b.mdx"), "# B\nagent context\n");
    write_file(temp.path().join("src/app.ts"), "agent context\n");

    let result = search_docs(temp.path(), "agent", 1).expect("search");

    assert_eq!(result.matches.len(), 1);
    assert!(result.truncated);
    assert!(result.matches[0].path.ends_with(".md") || result.matches[0].path.ends_with(".mdx"));
}
```

- [ ] **Step 3: Run the Rust tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml docs::tests -- --nocapture
```

Expected: FAIL because `src-tauri/src/docs.rs` and docs commands do not exist.

- [ ] **Step 4: Implement minimal docs domain**

Create `src-tauri/src/docs.rs` with the shared command contract types and these
public functions:

```rust
pub const MAX_DOC_BYTES: u64 = 512 * 1024;
pub const MAX_DOC_SEARCH_RESULTS: usize = 100;

pub fn index_docs(workspace_root: &Path) -> Result<Vec<DocIndexEntry>, String>;
pub fn preview_doc(workspace_root: &Path, path: &str) -> Result<DocPreview, String>;
pub fn search_docs(
    workspace_root: &Path,
    query: &str,
    limit: usize,
) -> Result<DocSearchResult, String>;
```

Implementation requirements:

- Use `ignore::WalkBuilder` with hidden files off and the same heavy-directory
  names skipped by existing workspace scan conventions.
- Include root-level `README.md`, `AGENTS.md`, and `roadmap.md` even though they
  are outside `docs/`.
- Use `Path::strip_prefix` and a helper `path_to_slash` for repo-relative
  paths.
- Extract title from the first markdown heading line. If no heading exists, use
  the file stem.
- Extract section as the first path segment after `docs/`; root-level docs use
  `workspace`.
- Parse markdown links with a small bracket scanner that only accepts relative
  links ending in a workspace-contained file path.
- Compute staleness from filesystem metadata modification times.

Add command wrappers in `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub fn docs_index(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<crate::docs::DocIndexEntry>, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::docs::index_docs(&workspace_root)
}

#[tauri::command]
pub fn docs_preview(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
) -> Result<crate::docs::DocPreview, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::docs::preview_doc(&workspace_root, &path)
}

#[tauri::command]
pub fn docs_search(
    state: State<'_, AppState>,
    workspace_root: String,
    query: String,
) -> Result<crate::docs::DocSearchResult, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::docs::search_docs(&workspace_root, &query, crate::docs::MAX_DOC_SEARCH_RESULTS)
}
```

Register `pub mod docs;` and the three commands in `src-tauri/src/lib.rs`.

- [ ] **Step 5: Run focused Rust tests to verify GREEN**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml docs::tests -- --nocapture
```

Expected: PASS for the docs index, preview, staleness, and docs-only search
tests.

- [ ] **Step 6: Refactor**

Keep helper functions small:

```rust
fn is_doc_path(path: &Path) -> bool;
fn doc_title(content: &str, fallback: &str) -> String;
fn doc_section(relative_path: &str) -> String;
fn markdown_references(content: &str) -> Vec<String>;
```

Run:

```bash
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/docs.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add docs index and preview commands"
```

### Task 2: Rust Context Pack Persistence And Metadata Links

**Files:**
- Modify: `src-tauri/src/docs.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/docs.rs`

- [ ] **Step 1: Write failing Rust tests for context pack storage**

Add these tests to `src-tauri/src/docs.rs`:

```rust
#[test]
fn context_pack_store_round_trips_workspace_packs() {
    let temp = tempfile::tempdir().expect("temp dir");
    let store = ContextPackStore::new(temp.path().join("context-packs.json"));

    let pack = store
        .create_pack(
            "/workspace",
            "Architecture pack",
            vec!["docs/architecture/overview.md".to_string()],
        )
        .expect("create pack");

    let loaded = store.list_packs("/workspace").expect("list packs");
    assert_eq!(loaded, vec![pack]);
}

#[test]
fn context_pack_links_task_and_agent_metadata_without_duplicates() {
    let temp = tempfile::tempdir().expect("temp dir");
    let store = ContextPackStore::new(temp.path().join("context-packs.json"));
    let pack = store
        .create_pack("/workspace", "Run pack", vec!["README.md".to_string()])
        .expect("create pack");

    let updated = store
        .link_pack(
            &pack.id,
            Some("workspace:task-1"),
            Some("agent-session-1"),
        )
        .expect("link pack");
    let updated = store
        .link_pack(
            &updated.id,
            Some("workspace:task-1"),
            Some("agent-session-1"),
        )
        .expect("link pack again");

    assert_eq!(updated.linked_task_run_ids, vec!["workspace:task-1"]);
    assert_eq!(updated.linked_agent_session_ids, vec!["agent-session-1"]);
}
```

- [ ] **Step 2: Run the context pack tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml docs::tests::context_pack_store_round_trips_workspace_packs -- --exact
```

Expected: FAIL because `ContextPackStore` does not exist.

- [ ] **Step 3: Implement context pack store and commands**

Add `ContextPackStore` in `src-tauri/src/docs.rs`:

```rust
#[derive(Clone, Debug)]
pub struct ContextPackStore {
    path: PathBuf,
}

impl ContextPackStore {
    pub fn new(path: PathBuf) -> Self;
    pub fn list_packs(&self, workspace_root: &str) -> Result<Vec<ContextPack>, String>;
    pub fn create_pack(
        &self,
        workspace_root: &str,
        name: &str,
        doc_paths: Vec<String>,
    ) -> Result<ContextPack, String>;
    pub fn delete_pack(&self, id: &str) -> Result<(), String>;
    pub fn link_pack(
        &self,
        id: &str,
        task_run_id: Option<&str>,
        agent_session_id: Option<&str>,
    ) -> Result<ContextPack, String>;
}
```

Store all packs in `context-packs.json` under the Tauri config directory. Use
the same atomic temp-file save pattern as `WorkspaceRegistryStore`.

Modify `AppState` in `src-tauri/src/commands.rs`:

```rust
docs_store: crate::docs::ContextPackStore,
```

Initialize it in `AppState::new`:

```rust
let docs_store = crate::docs::ContextPackStore::new(
    config_dir.as_ref().join("context-packs.json"),
);
```

Add methods:

```rust
pub fn list_context_packs(&self, workspace_root: &str) -> Result<Vec<ContextPack>, String>;
pub fn create_context_pack(
    &self,
    workspace_root: &str,
    name: String,
    doc_paths: Vec<String>,
) -> Result<ContextPack, String>;
pub fn delete_context_pack(&self, id: String) -> Result<(), String>;
pub fn link_context_pack(
    &self,
    id: String,
    task_run_id: Option<String>,
    agent_session_id: Option<String>,
) -> Result<ContextPack, String>;
```

Add Tauri command wrappers named `list_context_packs`, `create_context_pack`,
`delete_context_pack`, and `link_context_pack`. `create_context_pack` must call
`trusted_workspace_root` and validate each doc path with `preview_doc` before
persisting.

- [ ] **Step 4: Run focused Rust tests to verify GREEN**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml docs::tests -- --nocapture
```

Expected: PASS for docs tests.

- [ ] **Step 5: Refactor and run command signature checks**

Add or extend `commands::tests` with a compile-time command signature check:

```rust
#[test]
fn create_context_pack_preserves_flat_command_signature() {
    let _command: fn(
        State<'_, AppState>,
        String,
        String,
        Vec<String>,
    ) -> Result<crate::docs::ContextPack, String> = create_context_pack;
}
```

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml commands::tests::create_context_pack_preserves_flat_command_signature -- --exact
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/docs.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: persist docs context packs"
```

### Task 3: Frontend Docs API And Pure State

**Files:**
- Create: `src/features/docs/docs-api.ts`
- Create: `src/features/docs/docs-model.ts`
- Create: `src/features/docs/docs-model.test.ts`
- Modify: `src/app/workspace-view-state.ts`

- [ ] **Step 1: Write failing Bun tests for docs state**

Create `src/features/docs/docs-model.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";

import {
  createDocsState,
  docsBadgeCount,
  replaceDocsIndex,
  selectDocSource,
  selectedDocPaths,
  shouldApplyDocsResult,
  storeContextPack,
  updateContextPackDraftName,
} from "./docs-model";

describe("docs model", () => {
  test("stores docs index and reports stale badge count", () => {
    const state = replaceDocsIndex(createDocsState(), [
      { path: "README.md", title: "Readme", section: "workspace", modified_ms: 1, size_bytes: 10, stale: false },
      { path: "docs/architecture.md", title: "Architecture", section: "docs", modified_ms: 2, size_bytes: 20, stale: true },
    ]);

    expect(state.index.map((entry) => entry.path)).toEqual(["README.md", "docs/architecture.md"]);
    expect(docsBadgeCount(state)).toBe("1");
  });

  test("tracks selected docs for context pack creation", () => {
    const state = selectDocSource(
      selectDocSource(createDocsState(), "README.md", true),
      "docs/architecture.md",
      true,
    );

    expect(selectedDocPaths(state)).toEqual(["README.md", "docs/architecture.md"]);
  });

  test("stores context pack draft and persisted packs", () => {
    const state = storeContextPack(
      updateContextPackDraftName(createDocsState(), "Architecture pack"),
      {
        id: "pack-1",
        workspace_root: "/workspace",
        name: "Architecture pack",
        doc_paths: ["README.md"],
        linked_task_run_ids: [],
        linked_agent_session_ids: [],
        created_ms: 1,
        updated_ms: 1,
      },
    );

    expect(state.packDraftName).toBe("");
    expect(state.contextPacks[0].name).toBe("Architecture pack");
  });

  test("rejects stale async docs results", () => {
    expect(
      shouldApplyDocsResult(
        { requestId: 2, workspaceId: "a", workspacePath: "/a", query: "docs" },
        { requestId: 3, workspaceId: "a", workspacePath: "/a", query: "docs" },
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run docs model tests to verify RED**

Run:

```bash
bun test src/features/docs/docs-model.test.ts
```

Expected: FAIL because `docs-model.ts` does not exist.

- [ ] **Step 3: Implement docs API and model**

Create `src/features/docs/docs-api.ts`:

```typescript
import { call } from "../../lib/tauri";
import type {
  ContextPack,
  DocIndexEntry,
  DocPreview,
  DocSearchResult,
} from "./docs-model";

export function getDocsIndex(workspaceRoot: string): Promise<DocIndexEntry[]> {
  return call("docs_index", { workspaceRoot });
}

export function getDocPreview(
  workspaceRoot: string,
  path: string,
): Promise<DocPreview> {
  return call("docs_preview", { workspaceRoot, path });
}

export function searchDocs(
  workspaceRoot: string,
  query: string,
): Promise<DocSearchResult> {
  return call("docs_search", { workspaceRoot, query });
}

export function listContextPacks(workspaceRoot: string): Promise<ContextPack[]> {
  return call("list_context_packs", { workspaceRoot });
}

export function createContextPack(args: {
  workspaceRoot: string;
  name: string;
  docPaths: string[];
}): Promise<ContextPack> {
  return call("create_context_pack", args);
}

export function deleteContextPack(id: string): Promise<void> {
  return call("delete_context_pack", { id });
}

export function linkContextPack(args: {
  id: string;
  taskRunId?: string | null;
  agentSessionId?: string | null;
}): Promise<ContextPack> {
  return call("link_context_pack", args);
}
```

Create `src/features/docs/docs-model.ts` with exported types matching the Rust
contract and pure helpers used by the tests:

```typescript
export type DocsViewState = {
  index: DocIndexEntry[];
  previewByPath: Record<string, DocPreview>;
  searchQuery: string;
  searchResult: DocSearchResult | null;
  selectedDocPaths: Record<string, true>;
  contextPacks: ContextPack[];
  activePackId: string | null;
  packDraftName: string;
  loading: boolean;
  error: string | null;
};
```

Add `docs: createDocsState()` to `WorkspaceViewState`, freeze docs arrays and
objects in `freezeWorkspaceView`, and add `updateDocs` to the store.

- [ ] **Step 4: Run focused Bun tests to verify GREEN**

Run:

```bash
bun test src/features/docs/docs-model.test.ts src/app/workspace-view-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Refactor**

Keep the request identity type parallel to `SearchRequestIdentity`:

```typescript
export type DocsRequestIdentity = {
  requestId: number;
  workspaceId: string | null;
  workspacePath: string | null;
  query: string;
};
```

Run:

```bash
bun test src/features/docs/docs-model.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/docs/docs-api.ts src/features/docs/docs-model.ts src/features/docs/docs-model.test.ts src/app/workspace-view-state.ts
git commit -m "feat: add docs frontend state"
```

### Task 4: Docs Panel And Docs-Only Search UI

**Files:**
- Create: `src/features/docs/DocsPanel.tsx`
- Modify: `src/app/activity-rail.tsx`
- Modify: `src/app/command-palette-model.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/index.css`
- Test: `src/features/docs/docs-model.test.ts`
- Test: `src/app/command-palette-model.test.ts`

- [ ] **Step 1: Write failing Bun tests for docs commands and panel helpers**

Extend `src/app/command-palette-model.test.ts`:

```typescript
test("includes node 5 docs commands", () => {
  expect(node5Commands.map((command) => command.id)).toEqual([
    "open-docs",
    "refresh-docs-index",
    "create-context-pack",
  ]);
});
```

Extend `src/features/docs/docs-model.test.ts`:

```typescript
test("summarizes docs search results", () => {
  expect(
    docsSearchSummary({
      truncated: false,
      matches: [
        { path: "README.md", title: "Readme", line_number: 1, line: "context" },
        { path: "docs/a.md", title: "A", line_number: 2, line: "context" },
      ],
    }),
  ).toBe("2 matches in 2 docs");
});
```

- [ ] **Step 2: Run Bun tests to verify RED**

Run:

```bash
bun test src/app/command-palette-model.test.ts src/features/docs/docs-model.test.ts
```

Expected: FAIL because docs commands and search summary do not exist.

- [ ] **Step 3: Implement Docs activity and panel**

Add `"docs"` to `ActivityId` and `activities` in `src/app/activity-rail.tsx`
using `BookOpenText` from lucide-react.

Add `node5Commands` in `src/app/command-palette-model.ts`:

```typescript
export const node5Commands: CommandItem[] = [
  { id: "open-docs", label: "Open docs panel", group: "Docs" },
  { id: "refresh-docs-index", label: "Refresh docs index", group: "Docs" },
  { id: "create-context-pack", label: "Create context pack", group: "Docs" },
];
```

Create `DocsPanel.tsx` with props:

```typescript
export type DocsPanelProps = {
  state: DocsViewState;
  onRefresh: () => void;
  onSearch: (query: string) => void;
  onOpenPreview: (path: string) => void;
  onToggleSource: (path: string, selected: boolean) => void;
  onPackNameChange: (name: string) => void;
  onCreatePack: () => void;
  onSelectPack: (id: string) => void;
  onDeletePack: (id: string) => void;
};
```

Panel layout:

- Header title `Docs`.
- Refresh icon button.
- Search input labeled `Search docs`.
- Section `Docs Index` showing doc rows with title, path, section badge, stale
  badge, preview button, and source checkbox.
- Section `Context Sources` showing selected count and selected doc paths.
- Context pack name input and create button.
- Section `Context Packs` showing persisted packs with doc count, task link
  count, agent link count, inspect/select action, and delete icon.

Wire `PanelBody` in `AppShell.tsx` for `activeActivity === "docs"`.

- [ ] **Step 4: Wire docs index/search loading in AppShell**

On workspace change:

- Load `getDocsIndex`.
- Load `listContextPacks`.
- Store results via docs model helpers.
- Set errors with concise copy such as `Docs index failed: ${message}`.

Add handlers:

```typescript
async function refreshDocsIndexForWorkspace(workspaceId: string, workspaceRoot: string): Promise<void>;
async function searchDocsForWorkspace(query: string): Promise<void>;
function openDocsPanel(): void;
```

Command routing:

- `open-docs`: set active activity to `docs`, open panel.
- `refresh-docs-index`: refresh active workspace docs.
- `create-context-pack`: create from selected docs when name is non-empty.

- [ ] **Step 5: Add CSS**

Add styles in `src/index.css`:

```css
.docs-panel { display: flex; flex-direction: column; min-width: 0; }
.docs-search { padding: 8px; border-bottom: 1px solid var(--line); }
.docs-row { min-height: 34px; align-items: center; }
.docs-row-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.docs-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.docs-row-path { overflow: hidden; color: var(--txt-faint); text-overflow: ellipsis; white-space: nowrap; }
.docs-pack-create { display: grid; grid-template-columns: minmax(0, 1fr) 30px; gap: 6px; padding: 8px 10px; }
.docs-source-list { padding: 0 10px 8px; color: var(--txt-dim); font-family: var(--font-mono); font-size: 11px; }
```

- [ ] **Step 6: Run focused tests to verify GREEN**

Run:

```bash
bun test src/app/command-palette-model.test.ts src/features/docs/docs-model.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/docs/DocsPanel.tsx src/app/activity-rail.tsx src/app/command-palette-model.ts src/app/AppShell.tsx src/index.css src/features/docs/docs-model.test.ts src/app/command-palette-model.test.ts
git commit -m "feat: add docs panel"
```

### Task 5: Markdown Preview Surface

**Files:**
- Create: `src/features/docs/MarkdownPreview.tsx`
- Modify: `src/features/docs/docs-model.ts`
- Modify: `src/features/docs/docs-model.test.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/workspace-view-state.ts`
- Modify: `src/index.css`
- Modify: `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Install latest markdown rendering packages**

Run:

```bash
bun add react-markdown@latest remark-gfm@latest
```

Expected: `package.json` and `bun.lock` update with current latest versions.

- [ ] **Step 2: Write failing tests for preview cache and staleness count**

Extend `src/features/docs/docs-model.test.ts`:

```typescript
test("stores markdown preview by path and counts stale references", () => {
  const state = storePreview(createDocsState(), {
    path: "docs/architecture.md",
    title: "Architecture",
    content: "# Architecture",
    modified_ms: 1,
    references: [
      { target_path: "src/app.ts", exists: true, stale: true, reason: "Referenced file changed after this doc." },
      { target_path: "missing.ts", exists: false, stale: false, reason: "Referenced file is missing." },
    ],
  });

  expect(state.previewByPath["docs/architecture.md"]?.title).toBe("Architecture");
  expect(staleReferenceCount(state.previewByPath["docs/architecture.md"])).toBe(1);
});
```

- [ ] **Step 3: Run preview model test to verify RED**

Run:

```bash
bun test src/features/docs/docs-model.test.ts
```

Expected: FAIL because preview helpers do not exist.

- [ ] **Step 4: Implement preview state and surface**

Add `storePreview` and `staleReferenceCount` to `docs-model.ts`.

Add `docs-preview` to `Surface` in `workspace-view-state.ts`.

Create `MarkdownPreview.tsx`:

```typescript
import { AlertTriangle, FileText, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { DocPreview } from "./docs-model";

export type MarkdownPreviewProps = {
  preview: DocPreview | null;
  selectedPath: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};
```

Render:

- Toolbar with `FileText`, `Markdown Preview`, path label, stale reference badge,
  and Refresh button.
- Error alert if present.
- Empty copy `Select a doc to preview` when no preview is loaded.
- `ReactMarkdown` with `remarkGfm`.
- Reference hint list below the markdown body, with stale and missing badges.

Wire `AppShell`:

- `openDocPreview(path)` sets surface `docs-preview`, active activity `docs`,
  selects path, then loads `getDocPreview`.
- Main surface renders `MarkdownPreview`.

- [ ] **Step 5: Add CSS**

Add styles:

```css
.markdown-preview { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--editor); }
.markdown-toolbar { min-height: 38px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-bottom: 1px solid var(--line); background: var(--chrome); }
.markdown-body { flex: 1; min-height: 0; overflow: auto; padding: 18px 24px 28px; color: var(--txt); user-select: text; }
.markdown-body h1, .markdown-body h2, .markdown-body h3 { letter-spacing: 0; }
.markdown-body pre { overflow: auto; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--chrome); }
.markdown-body code { color: var(--yuzu); font-family: var(--font-mono); }
.doc-reference-list { border-top: 1px solid var(--line); padding: 8px 12px; background: var(--chrome); }
.doc-reference-row { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 0; font-family: var(--font-mono); font-size: 11px; color: var(--txt-dim); }
```

- [ ] **Step 6: Run focused tests and build to verify GREEN**

Run:

```bash
bun test src/features/docs/docs-model.test.ts
bun run build
```

Expected: PASS. Vite chunk warning is acceptable if exit code is 0.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock src/features/docs/MarkdownPreview.tsx src/features/docs/docs-model.ts src/features/docs/docs-model.test.ts src/app/AppShell.tsx src/app/workspace-view-state.ts src/index.css
git commit -m "feat: add markdown docs preview"
```

### Task 6: Context Pack UI, Task Links, And Agent Metadata Fields

**Files:**
- Modify: `src/features/docs/DocsPanel.tsx`
- Modify: `src/features/docs/docs-model.ts`
- Modify: `src/features/docs/docs-model.test.ts`
- Modify: `src/features/tasks/task-model.ts`
- Modify: `src/features/tasks/task-model.test.ts`
- Modify: `src/features/tasks/TaskPanel.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing tests for context pack selection and task links**

Extend `src/features/docs/docs-model.test.ts`:

```typescript
test("updates linked context pack metadata in place", () => {
  const state = storeContextPack(createDocsState(), {
    id: "pack-1",
    workspace_root: "/workspace",
    name: "Pack",
    doc_paths: ["README.md"],
    linked_task_run_ids: [],
    linked_agent_session_ids: [],
    created_ms: 1,
    updated_ms: 1,
  });

  const updated = storeContextPack(state, {
    ...state.contextPacks[0],
    linked_task_run_ids: ["workspace:task-1"],
    linked_agent_session_ids: ["agent-1"],
    updated_ms: 2,
  });

  expect(updated.contextPacks[0].linked_task_run_ids).toEqual(["workspace:task-1"]);
  expect(updated.contextPacks[0].linked_agent_session_ids).toEqual(["agent-1"]);
});
```

Extend `src/features/tasks/task-model.test.ts`:

```typescript
test("tracks selected context pack for an active task run", () => {
  const run = {
    id: "workspace:task-1",
    workspace_id: "workspace",
    label: "build",
    command: "bun run build",
    cwd: "/workspace",
    status: "Running" as const,
    exit_code: null,
  };
  const state = upsertTaskRun(createTaskState(), run);

  const linked = linkTaskRunContextPack(state, run.id, "pack-1");

  expect(linked.contextPackByRunId[run.id]).toBe("pack-1");
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/features/docs/docs-model.test.ts src/features/tasks/task-model.test.ts
```

Expected: FAIL because task context metadata helpers do not exist.

- [ ] **Step 3: Implement metadata helpers**

Extend `TaskViewState`:

```typescript
contextPackByRunId: Record<string, string>;
```

Add helper:

```typescript
export function linkTaskRunContextPack(
  state: TaskViewState,
  runId: string,
  contextPackId: string,
): TaskViewState {
  if (!state.runs.some((run) => run.id === runId)) {
    return state;
  }

  return {
    ...state,
    contextPackByRunId: {
      ...state.contextPackByRunId,
      [runId]: contextPackId,
    },
  };
}
```

Update `createTaskState`, freeze logic in `workspace-view-state.ts`, and tests.

- [ ] **Step 4: Wire DocsPanel context actions**

In `DocsPanel.tsx`:

- Keep source checkbox rows.
- Disable create button unless pack name and at least one doc source exist.
- Add `Use for active task` button on each pack row when a task run exists.
- Add agent metadata input labeled `Agent session id` for future Node 8
  sessions; when non-empty, link via `link_context_pack`.

In `AppShell.tsx`:

- `createContextPackFromSelection` calls `createContextPack`.
- `linkPackToActiveTask(packId)` calls `linkContextPack` with current active task
  run ID, then updates docs state and task metadata.
- `linkPackToAgentSession(packId, agentSessionId)` calls `linkContextPack` with
  the agent session ID.

In `TaskPanel.tsx`:

- Accept `contextPackNameById` and `contextPackByRunId`.
- Show a compact badge on active run output header when a run has a linked pack.

- [ ] **Step 5: Add CSS**

Add styles:

```css
.docs-pack-row { min-height: 38px; }
.docs-pack-actions { display: flex; gap: 4px; }
.docs-context-badge { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-context-strip { display: flex; align-items: center; gap: 6px; margin: 0 10px 8px; color: var(--txt-dim); font-size: 11px; }
```

- [ ] **Step 6: Run focused tests to verify GREEN**

Run:

```bash
bun test src/features/docs/docs-model.test.ts src/features/tasks/task-model.test.ts src/app/workspace-view-state.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/docs/DocsPanel.tsx src/features/docs/docs-model.ts src/features/docs/docs-model.test.ts src/features/tasks/task-model.ts src/features/tasks/task-model.test.ts src/features/tasks/TaskPanel.tsx src/app/AppShell.tsx src/app/workspace-view-state.ts src/index.css
git commit -m "feat: link docs context packs"
```

### Task 7: Verification, Browser Smoke, And Documentation

**Files:**
- Create: `docs/architecture/node-5-docs-results.md`
- Modify: `docs/architecture/progress.md`
- Modify: `roadmap.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
. "$HOME/.cargo/env" && bun run tauri build --debug
```

Expected: all commands PASS. Vite chunk warning remains acceptable if exit code
is 0.

- [ ] **Step 2: Run focused docs verification**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml docs::tests -- --nocapture
bun test src/features/docs/docs-model.test.ts src/features/tasks/task-model.test.ts
```

Expected: all focused docs and task metadata tests PASS.

- [ ] **Step 3: Run browser UI smoke with Tauri IPC mocks**

Start Vite:

```bash
bun run dev --host 127.0.0.1 --port 1420
```

Use Playwright CLI:

```bash
PWCLI=/Users/yuuzu/.agents/skills/playwright/scripts/playwright_cli.sh
sh "$PWCLI" open http://127.0.0.1:1420/
cat > /tmp/yuuzu-node5-docs-smoke.js <<'NODE5SMOKE'
async function(page) {
  await page.addInitScript(() => {
    const callbacks = new Map();
    let nextCallback = 1;
    const workspace = { id: "mock", name: "yuuzu-ide", path: "/mock/repo", pinned: true };
    const registry = { active_workspace_id: "mock", workspaces: [workspace] };
    let packs = [
      {
        id: "pack-1",
        workspace_root: "/mock/repo",
        name: "Architecture context",
        doc_paths: ["README.md", "docs/architecture/tech-stack.md"],
        linked_task_run_ids: ["mock:task-1"],
        linked_agent_session_ids: ["agent-session-1"],
        created_ms: 1,
        updated_ms: 1,
      },
    ];
    const docIndex = [
      { path: "README.md", title: "Readme", section: "workspace", modified_ms: 1, size_bytes: 128, stale: false },
      { path: "docs/architecture/tech-stack.md", title: "Tech Stack", section: "architecture", modified_ms: 2, size_bytes: 512, stale: false },
      { path: "docs/architecture/old-plan.md", title: "Old Plan", section: "architecture", modified_ms: 3, size_bytes: 256, stale: true },
    ];
    const preview = {
      path: "docs/architecture/old-plan.md",
      title: "Old Plan",
      content: "# Old Plan\n\nSee [AppShell](../../src/app/AppShell.tsx).\n\n- context source\n- markdown preview\n",
      modified_ms: 3,
      references: [
        {
          target_path: "src/app/AppShell.tsx",
          exists: true,
          stale: true,
          reason: "Referenced file changed after this doc.",
        },
      ],
    };
    const invoke = async (cmd, args) => {
      if (cmd === "plugin:event|listen") return 1;
      if (cmd === "plugin:event|unlisten") return null;
      if (cmd === "list_workspaces") return registry;
      if (cmd === "scan_workspace" || cmd === "scan_directory") return [];
      if (cmd === "watch_workspace") return { workspace_root: "/mock/repo", watch_id: "mock-watch" };
      if (cmd === "unwatch_workspace") return null;
      if (cmd === "list_workspace_tasks") {
        return [{ id: "build", label: "build", command: "bun run build", cwd: "/mock/repo", source: "package.json" }];
      }
      if (cmd === "list_task_runs") {
        return [{ id: "mock:task-1", workspace_id: "mock", label: "build", command: "bun run build", cwd: "/mock/repo", status: "Exited", exit_code: 0 }];
      }
      if (cmd === "git_status") {
        return { workspace_root: "/mock/repo", repository_root: "/mock/repo", branch: "main", upstream: "origin/main", ahead: 0, behind: 0, clean: true, has_conflicts: false, changes: [] };
      }
      if (cmd === "git_list_branches") return [{ name: "main", current: true, remote: false, upstream: "origin/main" }];
      if (cmd === "docs_index") return docIndex;
      if (cmd === "docs_preview") return { ...preview, path: args?.path ?? preview.path };
      if (cmd === "docs_search") {
        return {
          truncated: false,
          matches: [
            { path: "README.md", title: "Readme", line_number: 1, line: "context pack" },
            { path: "docs/architecture/tech-stack.md", title: "Tech Stack", line_number: 7, line: "docs context" },
          ],
        };
      }
      if (cmd === "list_context_packs") return packs;
      if (cmd === "create_context_pack") {
        const pack = {
          id: "pack-2",
          workspace_root: args?.workspaceRoot ?? "/mock/repo",
          name: args?.name ?? "Smoke pack",
          doc_paths: args?.docPaths ?? ["README.md"],
          linked_task_run_ids: [],
          linked_agent_session_ids: [],
          created_ms: 2,
          updated_ms: 2,
        };
        packs = [pack, ...packs];
        return pack;
      }
      if (cmd === "link_context_pack") {
        packs = packs.map((pack) =>
          pack.id === args?.id
            ? {
                ...pack,
                linked_task_run_ids: args?.taskRunId ? [args.taskRunId] : pack.linked_task_run_ids,
                linked_agent_session_ids: args?.agentSessionId ? [args.agentSessionId] : pack.linked_agent_session_ids,
                updated_ms: pack.updated_ms + 1,
              }
            : pack,
        );
        return packs.find((pack) => pack.id === args?.id) ?? packs[0];
      }
      return null;
    };
    window.__TAURI_INTERNALS__ = {
      invoke,
      transformCallback(callback) {
        const id = nextCallback++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      convertFileSrc(path) {
        return path;
      },
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI__ = { internals: window.__TAURI_INTERNALS__ };
  });
  await page.goto("http://127.0.0.1:1420/");
  await page.waitForTimeout(900);
}
NODE5SMOKE
sh "$PWCLI" run-code --filename /tmp/yuuzu-node5-docs-smoke.js
sh "$PWCLI" snapshot
```

The injected mock must return:

- `list_workspaces`: one active workspace.
- `docs_index`: `README.md`, `docs/architecture/tech-stack.md`, and one stale
  doc.
- `docs_preview`: markdown content with one stale reference.
- `docs_search`: two docs matches.
- `list_context_packs`: one persisted pack.
- `create_context_pack` and `link_context_pack`: updated pack payloads.

Smoke checkpoints:

- Docs rail item is visible and opens Docs panel.
- Docs panel shows index rows, stale badges, selected source count, pack create
  controls, and context packs.
- Docs search result summary appears after search.
- Clicking a doc opens Markdown Preview with rendered heading and reference
  hints.
- Creating a pack adds it to Context Packs.
- Linking a pack to active task shows task context metadata.
- At 390 by 844, Docs panel and Markdown Preview controls stay within their
  containers.

Remove `.playwright-cli/` artifacts after recording evidence.

- [ ] **Step 4: Write results document**

Create `docs/architecture/node-5-docs-results.md` with sections:

```markdown
# Node 5 Docs Results

## Scope

## Verification

## Smoke Evidence

## Measurements

## TDD And Review Evidence

## Commit Milestones

## Residual Risks

## Result
```

Include command outputs, test counts, debug app paths, browser smoke evidence,
context pack persistence evidence, and any residual WebView automation caveats.

- [ ] **Step 5: Update progress and roadmap**

Append Node 5 to `docs/architecture/progress.md`.

Update `roadmap.md` Current Priority:

```markdown
Node 0, Node 1, Node 2, Node 3, Node 4, and Node 5 are complete. The next active
priority is Node 6: add modern code intelligence while keeping idle overhead
low.
```

Add a Node 5 verification bullet under Current Priority.

- [ ] **Step 6: Run documentation checks**

Run:

```bash
rg -n 'T[B]D|T[O]DO|F[I]XME|place[ ]holder|<[^>]+>' docs/architecture/node-5-docs-results.md docs/architecture/progress.md roadmap.md
git diff --check
```

Expected: `rg` finds no matches and `git diff --check` passes.

- [ ] **Step 7: Commit**

```bash
git add docs/architecture/node-5-docs-results.md docs/architecture/progress.md roadmap.md
git commit -m "docs: record node 5 docs results"
```

## Self-Review

Spec coverage:

- Docs panel: Task 4.
- Markdown preview: Task 5.
- Docs index: Task 1 and Task 4.
- Docs-only search: Task 1 and Task 4.
- Context source selection: Task 3 and Task 4.
- Context pack creation: Task 2 and Task 6.
- Workspace, task, and agent session metadata links: Task 2 and Task 6.
- Staleness hints when selected docs reference changed files: Task 1 and Task 5.
- User can find and preview docs: Task 4 and Task 5.
- User can select docs as future agent context: Task 4 and Task 6.
- Context packs persisted and inspectable: Task 2 and Task 6.

Placeholder scan:

- This plan avoids banned deferred-work wording and uses exact files, commands,
  and expected outcomes.

Type consistency:

- Rust commands use snake_case command names and camelCase frontend wrapper
  arguments through `call`, matching existing Tauri wrapper patterns.
- `DocIndexEntry`, `DocPreview`, `DocSearchResult`, and `ContextPack` names are
  consistent across Rust contract, frontend model, and API wrapper.
- `docs-preview` is the only new workbench surface in Node 5.

Execution handoff:

Use `superpowers:subagent-driven-development` and dispatch a fresh implementer,
then spec-compliance reviewer, then code-quality reviewer for each task.
