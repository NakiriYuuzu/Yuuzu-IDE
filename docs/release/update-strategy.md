# Update Strategy

Yuuzu-IDE uses a manual update channel for personal use during Node 13. There is
no automatic updater or public release channel in this node.

## Manual Update Channel

1. Pull or check out the intended repository revision.
2. Run the full local verification sequence from the repository root.
3. Build a debug package with `bun run tauri build --debug`.
4. Replace the local app bundle only after the verification commands pass for
   the current host.

## Build Verification

Before replacing the local app bundle, run:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
bun run tauri build --debug
```

The current-host package is ready to install locally only when the commands
above pass and the debug bundle is produced under `src-tauri/target/debug/bundle/`.

## Rollback Path

Keep the previous debug app bundle or DMG until one day of work has passed
without recovery or startup regressions. If the new build loses recovery data,
fails to start reliably, or blocks normal workspace loading, restore the
previous bundle and keep the failing revision available for diagnosis.

## Windows Packaging Note

Do not call the Windows installer daily-driver ready from macOS verification.
Run the same Node 13 verification sequence on a Windows host before accepting a
Windows installer for daily use.
