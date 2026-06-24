# Issue 12 Windows Terminal IME Smoke

Date: 2026-06-24
Issue: https://github.com/NakiriYuuzu/Yuuzu-IDE/issues/12
Build: packaged debug app

## Environment

- OS: macOS 26.5.1 (Darwin 25.5.0, arm64)
- WebView2 runtime: not available on this host
- IME: not run on Windows in this session
- Workspace: Yuuzu-IDE repository
- Windows follow-up build: `v0.1.0-pr24-issue12-test.1` draft release artifacts from GitHub Actions run `28105789890`

## Build Evidence

- `bun run tauri build --debug --bundles app`: produced `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app` and `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app.tar.gz`, then failed because a public updater key exists without `TAURI_SIGNING_PRIVATE_KEY`.
- `bun run tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'`: produced `src-tauri/target/debug/bundle/macos/Yuuzu-IDE.app` with updater artifacts disabled.

## Smoke Steps

Windows WebView2 IME smoke was not run on this host.

Follow-up Windows test on `v0.1.0-pr24-issue12-test.1` reported that the `pi`
agent terminal still shifts horizontally in AgentZone.

## Result

- Normal terminal tab: not verified on Windows in this session.
- AgentZone terminal: user-reported `pi` agent still shifts horizontally on Windows.
- Candidate/composition UI: not verified on Windows in this session.
- Follow-up fix: AgentZone canvas now rejects horizontal scroll and pins
  `scrollLeft` back to `0` so focused xterm helper textarea / IME composition
  cannot move the agent canvas.

## Residual Risk

- Issue #12 must not be closed until a new Windows packaged app smoke verifies Chinese or Traditional Chinese IME input in both normal terminal tabs and AgentZone terminals after the AgentZone scroll-lock fix.
