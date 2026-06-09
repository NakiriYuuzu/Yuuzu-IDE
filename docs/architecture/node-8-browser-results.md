# Node 8 Browser Preview Results

## Status

Node 8 completed and passed.

Task 6 verification first exposed a full-suite frontend test isolation failure:
`DocsPanel.test.tsx` replaced the shared Happy DOM after Testing Library had
already loaded. The remediation commit `b382df1` switched that test to the
shared `ensureTestDom()` helper. The required verification commands were then
rerun and passed as recorded in the `Verification Evidence` section.

## Scope Delivered

- Delivered embedded browser preview.
- Added localhost launcher and browser URL launch actions.
- Added task-derived dev-server target detection.
- Added reload and hard reload controls.
- Added workspace-scoped browser state.
- Added split editor/browser layout.
- Added macOS preview-region screenshot capture using the Tauri webview helper.
- Added screenshot items in agent context.
- Added bounded console error state in browser panel.

## TDD Evidence

| Task | RED command | RED reason | GREEN command | Refactor verification command |
| --- | --- | --- | --- | --- |
| Task 1 | `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml browser_preview::tests -- --nocapture` | Missing browser preview functions/types before implementation. | `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml browser_preview::tests -- --nocapture` | `cargo test --manifest-path src-tauri/Cargo.toml browser_preview::tests -- --nocapture`; `cargo fmt --check`; `cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings` |
| Task 2 | `bun test src/features/browser/browser-model.test.ts src/features/agents/agent-model.test.ts` | Browser model and screenshot kind missing. | `bun test src/features/browser/browser-model.test.ts src/features/agents/agent-model.test.ts` | `bun test src/features/browser/browser-model.test.ts src/features/agents/agent-model.test.ts`; `bun run build` |
| Task 3 | `bun test src/features/browser/BrowserPreviewSurface.test.tsx` | `Cannot find module './BrowserPreviewSurface'` before adapter and surface existed. | `bun test src/features/browser/BrowserPreviewSurface.test.tsx src/features/browser/browser-model.test.ts` | `bun test src/features/browser/BrowserPreviewSurface.test.tsx src/features/browser/browser-model.test.ts`; `bun run build` |
| Task 4 | `bun test src/features/browser/BrowserPanel.test.tsx src/app/command-palette-model.test.ts src/app/activity-rail.test.tsx` | URL/enter behavior and console row handling mismatched expected inputs before BrowserPanel/commands/rail existed; later duplicate console id mismatch showed `Received: undefined`. | `bun test src/features/browser/BrowserPanel.test.tsx src/app/command-palette-model.test.ts src/app/activity-rail.test.tsx` | `bun test src/features/browser/BrowserPanel.test.tsx src/app/AppShell.contract.test.tsx src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts`; `bun run build` |
| Task 5 | `bun test src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx src/features/browser/BrowserPanel.test.tsx src/features/browser/BrowserPreviewSurface.test.tsx` | Missing browser state/source fields/PanelBody props/routing; follow-up stale-result red was helper-contract/import-missing replay issue against parent, not an ideal old-behavior assertion failure, and was fixed with stale-result gating updates. | `bun test src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx src/features/browser/BrowserPanel.test.tsx src/features/browser/BrowserPreviewSurface.test.tsx` | `bun test src/app/command-palette-model.test.ts src/features/browser/browser-model.test.ts`; `bun test src/features/browser/BrowserPanel.test.tsx src/features/browser/BrowserPreviewSurface.test.tsx src/features/browser/browser-model.test.ts`; `bun run build` |

## Review Evidence

| Task | Implementer commits | Spec-compliance reviewer | Code-quality reviewer | Follow-up fix commits |
| --- | --- | --- | --- | --- |
| Task 1 | `f65a078`, `0c8306a`, `74ee7cc` | `0c8306a` fixed initial spec gaps and was approved. | `74ee7cc` fixed code-quality issues and was approved. | `0c8306a`, `74ee7cc` |
| Task 2 | `c816dc3`, `2efb535`, `b38a928` | `2efb535` fixed initial scope gaps and was approved. | `b38a928` fixed code-quality edge cases and was approved. | `2efb535`, `b38a928` |
| Task 3 | `dd2c210`, `f3cdf30`, `0df6ed1`, `fbfa9ca` | `f3cdf30` fixed spec gaps and was approved. | `0df6ed1` and `fbfa9ca` were approved for lifecycle and event-receiver work. | `f3cdf30`, `0df6ed1`, `fbfa9ca` |
| Task 4 | `987c999`, `eefdf3f`, `cbb0842` | `987c999` was approved after implementation. | `eefdf3f` and `cbb0842` were approved for code-quality issues. | `eefdf3f`, `cbb0842` |
| Task 5 | `d395791`, `8b04509`, `9645e89`, `7cbb68f` | `8b04509` and `9645e89` were approved for spec alignment. | `7cbb68f` was approved for code-quality hardening. | `8b04509`, `9645e89`, `7cbb68f` |

Verification remediation:

- `b382df1` fixed `DocsPanel.test.tsx` test-DOM isolation. The RED command
  `bun test src/app/activity-rail.test.tsx src/features/docs/DocsPanel.test.tsx src/features/browser/BrowserPanel.test.tsx src/features/browser/BrowserPreviewSurface.test.tsx`
  reproduced 15 pass and 9 fail with empty-document Testing Library errors.
  The same command passed after the fix with 24 pass, 0 failed, and 70 expect
  calls.

## Verification Evidence

- `bun test` → PASS: 235 passed, 0 failed, 627 expect() calls, ran 235 tests
  across 31 files.
- `bun run build` → PASS: `tsc && vite build` completed successfully, with chunk-size warnings only.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml` → PASS: 176 Rust tests passed, 0 failed, 1 ignored, plus 0 main/doc tests.
- `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check` → PASS.
- `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` → PASS.
- `. "$HOME/.cargo/env" && bun run tauri build --debug` → PASS: built `src-tauri/target/debug/yuuzu-ide`, `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app`, and `src-tauri/target/debug/bundle/dmg/Yuuzu-IDE_0.1.0_aarch64.dmg`.
- `git diff --check` → PASS.
- `bun test src/features/browser/browser-model.test.ts src/features/browser/BrowserPanel.test.tsx src/features/browser/BrowserPreviewSurface.test.tsx src/app/AppShell.contract.test.tsx` → PASS: 54 passed, 0 failed, 178 expect() calls, ran 54 tests across 4 files.

## Residual Risks

- Screenshot capture uses macOS `/usr/sbin/screencapture`.
- Non-macOS capture returns explicit unsupported error.
- Current Tauri WebView package lacks a direct page-pixel screenshot API, so capture uses
  preview-region screenshot.
- Console error state is present, while automatic console event collection depends on
  future WebView event support.
