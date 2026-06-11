# Node 10 Remote SSH And SFTP Results

## Status

Completed and passed.

## Scope

- Workspace-scoped SSH host profiles.
- Keyring-backed remote credentials and private key metadata.
- SSH terminal sessions with deterministic frontend event routing.
- SFTP directory browsing, upload, and download.
- Remote command execution with bounded output.
- Visible connection health, failures, retry, keepalive, and connect timeout.
- Host-specific defaults for remote path and session behavior.
- Frontend remote workbench panel integrated with the activity rail, command
  palette, and workspace view state.

## TDD Evidence

### Task 1: Rust profile domain and secret storage

- RED command: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml remote::tests::save_host_profile_stores_password_in_secret_store_only`.
- RED result: failed before remote profile storage and secret handling existed.
- GREEN command: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml remote::tests`.
- GREEN result: passed after profile CRUD, workspace scoping, and secret
  persistence were implemented.
- REFACTOR command: `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`.
- REFACTOR result: passed.

### Task 2: Rust runtime sessions, SFTP, and health model

- RED command: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml remote::runtime_tests::remote_state_records_connection_failure_as_visible_health`.
- RED result: failed before runtime state and visible connection health existed.
- GREEN command: `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml remote::runtime_tests`.
- GREEN result: passed after terminal, command, SFTP, transfer, and recovery
  runtime behavior was added.
- REFACTOR command: `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`.
- REFACTOR result: passed with no warnings.

### Task 3: Frontend remote model

- RED command: `bun test src/features/remote/remote-model.test.ts`.
- RED result: failed before `remote-model.ts` existed.
- GREEN command: `bun test src/features/remote/remote-model.test.ts`.
- GREEN result: passed after host, session, SFTP, transfer, and health reducers
  were implemented.
- REFACTOR command: `bun run build`.
- REFACTOR result: passed with Vite chunk-size warnings only.

### Task 4: Remote workbench panel

- RED command: `bun test src/features/remote/RemotePanel.test.tsx`.
- RED result: failed with missing `RemotePanel` module before the panel existed.
- GREEN command: `bun test src/features/remote/RemotePanel.test.tsx`.
- GREEN result: passed after the SSH, SFTP, transfer, command, and retry UI was
  implemented.
- REFACTOR command: `bun run build`.
- REFACTOR result: passed with Vite chunk-size warnings only.

### Task 5: AppShell and workspace integration

- RED command: `bun test src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts`.
- RED result: failed before the remote activity entry, `node10Commands`, and
  workspace remote state existed.
- GREEN command: `bun test src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx`.
- GREEN result: passed after the remote surface, workspace persistence, command
  palette integration, event routing, stale refresh guards, and active SSH
  session preservation were implemented.
- Additional RED/GREEN evidence: AppShell contract tests first exposed wrong SSH
  terminal props and stopped-session text, then exposed active-session refresh
  replacement, and passed after the fixes.
- REFACTOR command: `bun run build`.
- REFACTOR result: passed with Vite chunk-size warnings only.

### Task 6: Recovery, transfers, and final hardening

- RED command: `bun test src/features/remote/RemotePanel.test.tsx src/features/remote/remote-model.test.ts`.
- RED result: failed before failure messaging and `recordRemoteTransfer`
  behavior were complete.
- GREEN command: `bun test src/features/remote/remote-model.test.ts src/features/remote/RemotePanel.test.tsx`.
- GREEN result: passed with 13 passed, 0 failed, 33 expect calls.
- Additional RED/GREEN evidence: `bun test src/app/AppShell.contract.test.tsx`
  exposed missing transfer filename export, then passed after basename
  normalization moved into the remote model.
- REFACTOR command: `bun run build`.
- REFACTOR result: passed with Vite chunk-size warnings only.

## Review Evidence

- Task 4 final spec-compliance review: APPROVED.
- Task 4 final code-quality review: APPROVED.
- Task 5 final spec-compliance review: APPROVED.
- Task 5 final code-quality review: APPROVED.
- Task 6 final spec-compliance review: APPROVED.
- Task 6 final code-quality review: APPROVED.
- All Node 10 agents were run with `gpt-5.5` and `xhigh` reasoning after the
  user model lock.

## Verification Evidence

- `bun test` -> PASS: 296 passed, 0 failed, 823 expect calls across 36 files.
- `bun run build` -> PASS with `tsc && vite build`; Vite chunk-size warnings
  only.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml` ->
  PASS: 261 passed, 0 failed, 1 ignored.
- `. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  -> PASS.
- `. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  -> PASS with no warnings.
- `bun run tauri build --debug` -> PASS; artifacts:
  - `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app`
  - `src-tauri/target/debug/bundle/dmg/Yuuzu-IDE_0.1.0_aarch64.dmg`
- `bun test src/features/remote/remote-model.test.ts src/features/remote/RemotePanel.test.tsx`
  -> PASS: 13 passed, 0 failed, 33 expect calls.
- `bun test src/app/activity-rail.test.tsx src/app/command-palette-model.test.ts src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx`
  -> PASS: 75 passed, 0 failed, 245 expect calls.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml remote::tests`
  -> PASS: 8 passed, 0 failed.
- `. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml remote::runtime_tests`
  -> PASS: 12 passed, 0 failed.

## Acceptance

- User can open SSH terminals per workspace: PASS.
- User can browse and transfer files through SFTP: PASS.
- Connection failures are visible and recoverable: PASS.

## Residual Risks

- Live SSH and SFTP behavior still depends on user-provided hosts,
  credentials, and network conditions.
- Node 10 intentionally does not implement full remote workspace editing.
- Node 10 intentionally does not implement remote container orchestration.
- Browser and Tauri web previews cannot fully exercise real SSH/SFTP without a
  real backend host fixture; the UI layout was checked with mocked state during
  frontend review.
