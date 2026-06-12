# Node 12 Extension And Ecosystem Layer Results

## Status

Completed and passed.

## Scope Delivered

- Internal command registry shared by core and extension command contributions.
- Workspace-scoped extension status and disablement.
- Public extension API draft for commands, themes, keybindings, snippets, workspace hooks, isolation, and performance budgets.
- Extensions panel following the dense workbench design language.
- Slow-extension performance sample visibility.

## TDD Evidence

- Task 1 Rust domain: commits `e48f6ce` and `f33cfc4`. RED: missing extension Rust APIs; follow-up RED: concurrent fixed temp save, sample cap, duplicate snippet id. GREEN/REFACTOR: extensions tests 7 passed, command extension tests 2 passed, fmt passed, diff check passed.
- Task 2 frontend model/API/panel: commits `2abc3ce` and `af2a255`. RED: missing model/panel modules; follow-up RED: keyboard activation did not call toggle. GREEN/REFACTOR: extension tests 10 passed, TypeScript check passed, diff check passed.
- Task 3 command registry: commits `de9a7ff` and `2abd0f4`. RED: missing command registry; follow-up RED: duplicate core id in extension commands and dynamic search regression. GREEN/REFACTOR: command tests 22 passed, TypeScript check passed, diff check passed.
- Task 4 AppShell integration: commits `55b3a76`, `f9a19ba`, `b9b85f1`, `26990b2`, `033a496`, `9eaf016`. RED: missing extensions rail/state/AppShell integration; follow-up REDs for core command shadowing, stale toggle snapshots, performance/refresh/toggle interleavings, `yuuzu.core` command filtering, cross-extension snapshot ordering, and pending toggle clobber. GREEN/REFACTOR: AppShell tests 65 passed, 7-file Node 12 frontend suite 129 passed, build passed with Vite warnings only, diff checks passed.
- Task 5 API draft: commits `bbd4d60`, `f4b4491`, `1736b1d`. RED/review findings: manifest contribution shape mismatch, `api_version` mismatch, `operation` type mismatch. GREEN/REFACTOR: marker scans no matches, coverage scans hit required terms, diff checks passed.

## Agent Review Evidence

All Node 12 implementer, spec-compliance, and code-quality agents used `gpt-5.5` with `xhigh`; no agent used or changed to `gpt-5.4`.

- Task 1 quality review was initially CHANGES_REQUIRED, then approved after `f33cfc4` hardened the workspace store and extension sample behavior.
- Task 2 quality review was initially CHANGES_REQUIRED, then approved after `af2a255` fixed keyboard activation for extension toggles.
- Task 3 quality review was initially CHANGES_REQUIRED, then approved after `2abd0f4` guarded duplicate extension command ids and preserved dynamic search behavior.
- Task 4 spec and quality reviews found multiple integration issues; fixes through `9eaf016` resolved core command shadowing, stale snapshots, performance refresh ordering, `yuuzu.core` filtering, cross-extension ordering, and pending toggle clobber. Final spec and quality reviews approved.
- Task 5 spec and quality reviews found API draft mismatches; fixes through `1736b1d` resolved manifest contribution shape, `api_version`, and `operation` type alignment. Final spec and quality reviews approved.

## Full Verification Evidence

Final verification ran on 2026-06-12 from `/Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide` immediately before this results commit, against implementation head `1736b1d0e2573a789ade9a60ed11579d854015a6`.

- `bun test`: PASS.

```text
 371 pass
 0 fail
 1053 expect() calls
Ran 371 tests across 41 files. [3.58s]
```

- `bun run build`: PASS with `tsc && vite build`; Vite chunk-size warnings only. The final emitted output lines were:

```text
dist/assets/tsMode-BMVv67bZ.js                                21.87 kB │ gzip:   6.16 kB
dist/assets/lspLanguageFeatures-gTnJsses.js                   28.25 kB │ gzip:   7.18 kB
dist/assets/editor.main-f3LKKVYn.js                           95.42 kB │ gzip:  22.39 kB
dist/assets/xterm-DooSxjI5.js                                340.34 kB │ gzip:  86.29 kB
dist/assets/index-CUb_a0_3.js                                620.25 kB │ gzip: 174.18 kB
dist/assets/editor.api2-BmGoRSl4.js                        3,626.86 kB │ gzip: 926.78 kB

✓ built in 3.36s
[plugin builtin:vite-reporter]
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
```

- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml`: PASS. The final test summary lines were:

```text
test result: ok. 294 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out; finished in 39.89s

     Running unittests src/main.rs (src-tauri/target/debug/deps/yuuzu_ide-7b8d346f3f5bb413)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests yuuzu_ide_lib

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

- `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`: PASS with exit code 0 and no stdout/stderr output.

- `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`: PASS.

```text
    Checking yuuzu-ide v0.1.0 (/Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide/src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 7.86s
```

- `bun run tauri build --debug`: PASS with before-build Vite chunk-size warnings only. The final bundle output lines were:

```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 48.53s
       Built application at: /Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide/src-tauri/target/debug/yuuzu-ide
    Bundling Yuuzu-IDE.app (/Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide/src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app)
    Bundling Yuuzu-IDE_0.1.0_aarch64.dmg (/Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide/src-tauri/target/debug/bundle/dmg/Yuuzu-IDE_0.1.0_aarch64.dmg)
     Running bundle_dmg.sh
    Finished 2 bundles at:
        /Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide/src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app
        /Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide/src-tauri/target/debug/bundle/dmg/Yuuzu-IDE_0.1.0_aarch64.dmg
```

## Acceptance Results

- Internal features use the same command registry extension authors will use: PASS.
- Extensions can be disabled per workspace: PASS.
- Slow extensions can be identified: PASS.

## Residual Risks

- Node 12 does not include a marketplace.
- Node 12 does not execute arbitrary third-party extension host code.
- Workspace hooks are manifest records only until a future host capability model is implemented.
- Vite chunk-size warnings remain expected because Monaco, language workers, and terminal assets are large; the build exits successfully.
