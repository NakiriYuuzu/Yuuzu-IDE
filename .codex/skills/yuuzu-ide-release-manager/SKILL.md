---
name: yuuzu-ide-release-manager
description: Prepare, validate, tag, inspect, publish, or troubleshoot Yuuzu-IDE releases. Use this whenever the user mentions Yuuzu-IDE release work, version tags such as v0.1.0, changelog dates, release gates, GitHub draft releases, latest.json, updater artifacts, macOS Apple Silicon, Windows x64, portable zip assets, or asks whether it is safe to publish.
---

# Yuuzu-IDE Release Manager

Use this skill for Yuuzu-IDE release work from release readiness through tag,
GitHub draft inspection, publish decision, and post-publish smoke.

The goal is to keep releases evidence-backed and human-controlled. Building a
draft release is reversible; publishing a release and moving updater endpoints is
not, so separate those gates clearly.

## Scope

Release tasks are `release` class under `AGENTS.md`.

Likely files:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `CHANGELOG.md`
- `.github/workflows/release.yml`
- `docs/release/update-strategy.md`
- `docs/superpowers/plans/2026-06-15-cicd-autoupdate.md`
- `docs/superpowers/specs/2026-06-15-cicd-autoupdate-design.md`

Out of scope unless the user explicitly asks:

- Changing updater keys or secrets.
- Weakening release verification.
- Publishing a GitHub release.
- Pushing tags.
- Marking roadmap items complete.
- Rewriting unrelated release docs.

## Release Identity

Yuuzu-IDE currently releases for:

- macOS Apple Silicon: `darwin-aarch64`
- Windows x64: `windows-x86_64`

Windows portable `.zip` is a manual distribution asset. It is not the updater
URL. `latest.json` should point Windows updater metadata at a signed installer
artifact, not the portable zip.

## Preflight

Start read-only unless the user has explicitly asked to edit, tag, push, or
publish.

1. Run:

```bash
git status --short --branch
git fetch origin --prune --tags
git status --short --branch
```

2. Confirm the release base:

```bash
git rev-parse --short HEAD
git rev-parse --short origin/main
git tag --list 'v*' --sort=-version:refname | head -20
git ls-remote --tags origin 'refs/tags/v*' | sed -n '1,40p'
```

If `HEAD` and `origin/main` differ, do not tag until the user chooses the
intended release commit.

3. Inspect remote state:

```bash
gh run list --repo NakiriYuuzu/Yuuzu-IDE --workflow ci.yml --branch main --limit 5
gh run list --repo NakiriYuuzu/Yuuzu-IDE --workflow release.yml --limit 10
gh release list --repo NakiriYuuzu/Yuuzu-IDE --limit 20
gh secret list --repo NakiriYuuzu/Yuuzu-IDE
```

The signing secrets should include:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

4. Verify version metadata:

```bash
rg -n '"version":|"version" =|## \[' package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml CHANGELOG.md
bun scripts/extract-release-notes.mjs vX.Y.Z
```

For a formal release, the changelog date should usually match the publish date.
If the user wants to keep an earlier prepared date, call that out rather than
silently changing it.

## Local Release Gate

Use the full local gate before replacing a local app bundle or advising that a
release commit is ready:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
bun run tauri build --debug
```

If the final Tauri build creates the `.app`, `.dmg`, or updater tarball but
fails only with:

```text
A public key has been found, but no private key.
```

then record that as a local signing-environment blocker. Do not treat it as
evidence that GitHub release signing will fail when the repo secrets exist.
Rerun an app-bundle-only local gate to prove packaged app bundling:

```bash
bun run tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

This override is only for local packaged-app verification. It does not validate
updater artifact signing.

## Tag Gate

Before creating a tag, report:

- release version
- release commit hash
- clean worktree status
- local gate result
- latest `main` CI result
- whether local and remote `vX.Y.Z` tags already exist
- changelog date decision

Prefer an annotated tag for formal releases:

```bash
git tag -a vX.Y.Z -m "Yuuzu-IDE vX.Y.Z"
git push origin vX.Y.Z
```

Only create or push the tag after explicit user approval.

## Draft Release Inspection

After pushing a tag, watch the release workflow:

```bash
gh run list --repo NakiriYuuzu/Yuuzu-IDE --workflow release.yml --limit 5
gh run watch <run-id> --repo NakiriYuuzu/Yuuzu-IDE --exit-status
```

Then inspect the draft release before publish:

```bash
gh release view vX.Y.Z --repo NakiriYuuzu/Yuuzu-IDE --json tagName,name,isDraft,isPrerelease,assets
```

Download or inspect `latest.json` from the draft release and confirm:

- `platforms` includes `darwin-aarch64`
- `platforms` includes `windows-x86_64`
- each platform has `signature` and `url`
- Windows updater URL points to an installer artifact, not the portable zip
- the Windows portable zip exists as a separate asset
- the release body matches `CHANGELOG.md` for the tag

If release assets are ambiguous, stop and report the mismatch. Do not publish.

## Publish Gate

Publishing moves the GitHub `latest` release endpoint and makes updater checks
see the version. Require explicit user approval immediately before publish.

Before publish, summarize:

- tag and commit
- workflow run result
- asset list
- `latest.json` platform validation
- known limitations: no Apple notarization, Windows SmartScreen warning, macOS
  first-open Gatekeeper friction, updater private key dependency

Do not publish from automation unless the user explicitly says to publish this
specific tag.

## Post-Publish Smoke

After publish:

1. Confirm endpoint availability:

```bash
curl -L https://github.com/NakiriYuuzu/Yuuzu-IDE/releases/latest/download/latest.json
```

2. Install and smoke the macOS Apple Silicon artifact when feasible:

- app launches
- main v2 shell renders
- open workspace works
- basic file/editor/terminal path works
- Settings > Updates can check without crashing

3. For Windows, confirm at minimum that the portable zip exists and contains
`Yuuzu-IDE.exe`. Prefer a Windows machine or runner for install/runtime smoke.

4. Record skipped smoke checks with reasons.

## Closeout Format

Use this shape:

```text
Release:
Base:
Version metadata:
Verification:
Remote CI:
Draft release:
latest.json:
Artifacts:
Publish state:
Skipped / blocked:
Next:
```

Only say a gate passed when the command or GitHub run actually passed in the
current release attempt.
