# Node 1 Core Results

## Scope

- Persistent workspace registry.
- Open folder as workspace.
- Add, remove, pin, and switch workspaces.
- Basic settings storage.
- Per-workspace shell view restoration.
- Command palette shell.
- Missing-path empty and error states.

## Verification

| Command | Result |
| --- | --- |
| `bun test` | PASS: 19 tests passed, 0 failed, 29 expect calls across 7 files |
| `bun run build` | PASS: `tsc && vite build`; Vite emitted large chunk warnings only |
| `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml` | PASS: 25 Rust tests passed, plus 0 main/doc tests |
| `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check` | PASS |
| `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS |
| `. "$HOME/.cargo/env" && bun run tauri build --debug` | PASS: built debug app and macOS debug app/dmg bundles |

## Measurements

| Measurement | Result | Pass Target |
| --- | ---: | ---: |
| Cold launch to visible shell/process-ready | 295 ms | under 2000 ms |
| Memory with one workspace registered | 74 MB physical footprint | under 180 MB |
| Memory with three workspaces registered | 74 MB physical footprint | under 300 MB |
| Main WebView count while switching/registering workspaces | 1 | exactly 1 |

## Measurement Notes

Measurements used the debug app at
`src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app`. The workspace registry was
pre-seeded at
`~/Library/Application Support/app.yuuzu.ide/workspace-registry.json` for the
measurement run and was restored or removed afterward.

Workspace paths used:

- `/Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide`
- `/Users/yuuzu/HanaokaYuuzu/Ai`
- `/Users/yuuzu/HanaokaYuuzu`

Desktop automation could not directly interact with the WebView during the
measurement run: AppleScript/System Events hung, and Computer Use returned
`cgWindowNotFound`. The launch row therefore records process and WebContent
readiness instead of a directly automated visible-shell interaction. Workspace
switching and state evidence uses the plan-approved lower-confidence path:
pre-seeded registry contents, process measurements, and passing Rust/React
tests.

The primary Node 1 memory metric is macOS physical footprint from `footprint`,
because process-tree RSS double-counts shared clean mappings in WebKit/Tauri.
RSS is listed below as a diagnostic value, not as the pass/fail memory metric.

| Scenario | Total Physical Footprint | Process-Tree RSS Diagnostic | WebContent Count |
| --- | ---: | ---: | ---: |
| One workspace, 8s settled | 74 MB | 206 MB | 1 |
| Three workspaces, 8s settled | 74 MB | 206 MB | 1 |

| Scenario | Process | Physical Footprint | RSS Diagnostic |
| --- | --- | ---: | ---: |
| One workspace, 8s settled | yuuzu-ide | 31 MB | 108.7 MB |
| One workspace, 8s settled | WebKit GPU | 12 MB | 31.6 MB |
| One workspace, 8s settled | WebKit Networking | 5.5 MB | 15.2 MB |
| One workspace, 8s settled | WebKit WebContent | 25 MB | 50.6 MB |
| Three workspaces, 8s settled | yuuzu-ide | 31 MB | 108.5 MB |
| Three workspaces, 8s settled | WebKit GPU | 12 MB | 31.8 MB |
| Three workspaces, 8s settled | WebKit Networking | 5.6 MB | 15.5 MB |
| Three workspaces, 8s settled | WebKit WebContent | 25 MB | 50.7 MB |

## Result

Node 1 passes the core app-shell and multi-workspace targets. The Tauri 2 +
React route remains viable: one and three registered workspaces stay under the
physical-footprint memory targets, and the app maintains one main WebContent
process. The RSS diagnostic for one workspace is above 180 MB, so future nodes
should keep physical footprint as the primary macOS memory gate while tracking
RSS as a residual metric caveat.
