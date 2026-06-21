# Node 15 CodeMirror C# Results

## Scope

- CodeMirror editor surface as the default editor engine.
- First-party Lezer-based C# syntax package.
- CodeMirror language selection includes Rust, C#, YAML, Markdown, HTML, CSS,
  XML, JSON, JavaScript, and TypeScript.
- Rust/Tauri LSP remains the semantic source.
- Textarea editor remains available as an explicit fallback through the editor engine setting.

## Verification

- `bun test src/features/editor-codemirror/lang-csharp/lang-csharp.test.ts`
  - PASS: 4 tests, 17 assertions.
- `bun test src/features/editor-codemirror/language-selection.test.ts`
  - PASS: 16 tests, 16 assertions.
- `bun test src/v2/editor/editor-surface.test.ts`
  - PASS: 4 tests, 8 assertions.
- `bun test src/v2/ContentViews.test.tsx`
  - PASS: 12 tests, 19 assertions.
- `bun test src/v2/v2-model.test.ts`
  - PASS: editor engine setting defaults to CodeMirror and lists CodeMirror first.
- `bun test src/v2/v2-store.test.ts`
  - PASS: 84 tests, 269 assertions.
- `bun run build`
  - PASS: `tsc && vite build`.
  - Warning: Vite reports the main chunk is larger than 500 kB after CodeMirror packages are bundled.
- `bun run verify:editor-large-file`
  - PASS: starts Vite on `127.0.0.1:1428`, drives headless Chrome through CDP, migrates legacy `editorEngine: "textarea"` storage to CodeMirror, and verifies a 10,000-line editor stays virtualized while scrolling.

## Measurements

| Metric | Textarea baseline | CodeMirror result | Notes |
|---|---:|---:|---|
| File open small file | not measured | visual render verified | Dev-server browser check rendered a guarded real-mode C# tab with `.cm-editor` width 938 px and height 168 px. |
| 10k-line scroll ownership | outer editor body scroll | CodeMirror scroller owns scroll | Dev-server browser probe measured `.yz2-ed-body` at `589/589` client/scroll height and `.cm-scroller` at `589/210000`; after scrolling, `.cm-line` stayed bounded at 53 rendered lines. |
| 10k-line repeatable guard | none | automated browser probe | `bun run verify:editor-large-file` migrated legacy `textarea` storage to `codemirror`, measured `.yz2-ed-body` at `338/338`, `.cm-scroller` at `328/210000`, and `.cm-line` from 36 before scroll to 41 after scroll. |
| Typing latency p95 | not measured | not measured | Deferred until packaged-app parity pass. |
| Completion first paint | not measured | local source is synchronous | Covered by local completion helper tests; browser timing still pending. |
| LSP completion merge | not measured | async source guarded by request/document version | Covered by adapter helper and surface wiring tests. |
| Idle memory one workspace | not measured | not measured | Deferred until packaged-app measurement. |

## Browser Check

- Dev server: `bun run dev -- --host 127.0.0.1`, Vite served `http://127.0.0.1:1420/`.
- Browser operation: dynamically imported `/src/v2/v2-store.ts`, set `editorEngine: "codemirror"`, and rendered a real-mode `Program.cs` tab.
- DOM/style result:
  - `.cm-editor`: present.
  - `.yz2-cm-host`: present.
  - Size: 938 px x 168 px.
  - Background: `rgba(10, 14, 21, 0.925)`.
  - Text color: `rgb(230, 237, 243)`.
  - Font family: `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
  - Gutter color: `rgb(61, 70, 84)`.
  - Content check: `Program` and `Console` visible.
- Screenshot: `output/playwright/node15-codemirror-csharp.png`.
- Large-file scroll probe:
  - Input: generated 10,000-line `Huge.cs` tab in CodeMirror mode.
  - Before fix: `.yz2-ed-body` owned a `210040 px` scroll height while `.cm-scroller` was stretched to `210000 px`.
  - After fix: `.yz2-ed-body` is `overflow: hidden` with `589 px` client and scroll height; `.cm-scroller` owns the `210000 px` scroll range and renders 53 `.cm-line` nodes near the end of the document.
- Repeatable large-file guard:
  - Command: `bun run verify:editor-large-file`.
  - Input: legacy localStorage with `editorEngine: "textarea"`, followed by a reload and generated 10,000-line `Huge.ts` tab.
  - Result: storage is migrated to `editorEngine: "codemirror"` with marker `yuuzu-ide-v2-editor-engine-default-codemirror-v1`, `.yz2-ed-body.is-codemirror`, no textarea fallback, `.cm-scroller` owns the `210000 px` scroll range, and `.cm-line` remains bounded at 41 nodes after scrolling to the end.

## Decision

Use CodeMirror as the default editor engine while keeping `textarea` as an explicit fallback. Node 15 is in progress, not complete, until the packaged-app parity pass fills the remaining latency and memory measurements.
