# Explorer Create Modal Fix Spec

Date: 2026-06-22
Status: Implemented in current working tree
Task class: bugfix + ui-runtime

## Problem

Packaged debug smoke showed that Explorer root context-menu actions `New folder`
and `New file` closed the menu but did not create anything. The same smoke
verified that editor typing/save, Git Graph detail stability, copy hash, and
window close-to-hide still worked, so the failure was isolated to the Explorer
create flow.

The failing path depended on `window.prompt` inside `src/v2/controller.ts`.
Unit tests mocked `window.prompt`, but the packaged Tauri WebView did not
surface a usable prompt in this flow. As a result, the create operation stopped
before `create_directory` or `create_text_file` IPC was called.

## Scope

In scope:

- Explorer context-menu `New file` and `New folder` in the shipping v2 shell.
- Real workspace create flow from context menu to Tauri IPC.
- Regression coverage for the app-owned name modal and real delegate create
  calls.

Out of scope:

- Rust filesystem command behavior and workspace-boundary checks.
- Delete, rename, drag/drop, or file-tree refresh architecture outside the
  existing create refresh.
- Demo-mode auto-generated file/folder names.

## Decision

Replace the browser prompt dependency with an app-owned modal:

- `src/v2/v2-store.ts` owns `nodeNameDialog` state.
- In real mode, `addNode(dirPath, kind)` opens the modal with the existing
  fallback name: `untitled.ts` for files and `new-folder` for folders.
- `NodeNameModal` in `src/v2/Overlays.tsx` collects the name, supports submit
  by Enter, and supports cancel by button, backdrop, or Escape.
- Store submission validates required name and single path segment before
  calling the real delegate.
- `src/v2/controller.ts` accepts the submitted name, revalidates it, checks
  sibling duplicates, then runs the existing `createDirectory` or
  `createTextFile` IPC, refreshes the directory, schedules Git reload, and
  shows the existing success/error toast.

## Acceptance Criteria

- Real Explorer `New folder` and `New file` never call `window.prompt`.
- Right-click create opens a visible app modal with a focused name input.
- Submitting `feature` for folder under `src` calls `create_directory` with
  `relativePath: "src/feature"` and schedules Git refresh.
- Submitting `named.ts` for file under `src` calls `create_text_file` with
  `relativePath: "src/named.ts"` and does not fall back to `src/untitled.ts`.
- Empty names and names containing `/` or `\` are rejected before IPC.
- Duplicate names remain blocked by the controller duplicate check.
- Cancel, backdrop click, and Escape close the modal without IPC.

## Verification

Focused regression:

```bash
bun test src/v2/Overlays.test.tsx src/v2/folder-expand.test.ts
```

Build/type gate:

```bash
bun run build
```

Broader v2 regression gate:

```bash
bun test src/v2
```

Packaged runtime smoke should be rerun against the debug app after
`bun run tauri build --debug`:

- Open a temporary workspace.
- Right-click Explorer root and create a folder with a unique name.
- Confirm the folder exists on disk.
- Right-click Explorer root and create a file with a unique name.
- Confirm the file exists on disk and can be opened.
