# Update Strategy

Yuuzu-IDE 透過 GitHub Releases 自動發版，並由 app 內建的
`tauri-plugin-updater` 進行更新。發版目標是 macOS Apple Silicon
(`darwin-aarch64`) 與 Windows x64 (`windows-x86_64`)；Windows release 需包含
portable `.zip`。更新完整性由 minisign 簽章保證（與 OS code signing 無關）。

## 發版流程

1. 同步 bump 版號（三處保持一致）：
   - `src-tauri/tauri.conf.json` 的 `version`
   - `package.json` 的 `version`
   - `src-tauri/Cargo.toml` 的 `version`
2. 在 `CHANGELOG.md` 新增對應版本段落，例如 `## [0.2.0] - YYYY-MM-DD`。
3. 跑下方「發版前驗證」確認綠燈。
4. commit 版號與 changelog 變更。
5. 打 tag 並 push：`git tag vX.Y.Z && git push origin vX.Y.Z`。
6. GitHub Actions `release.yml` 會在 `macos-26` 與 `windows-2025` 各自 build、
   簽章、上傳到一個 **draft** Release，並產生 `latest.json`。
7. 到 GitHub Releases 檢查 draft：macOS 需有 Apple Silicon artifact，Windows
   需有 x64 installer / updater `.sig`、portable `.zip`，且 `latest.json` 都在。
8. 手動 **Publish**。發布後 auto-update endpoint 才會生效。

## 發版前驗證

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

（與 CI 的 `ci.yml` 同一組指令。）

## Auto-Update 運作方式

- App 啟動時靜默呼叫 updater；有新版顯示非阻斷 toast，引導到 Settings ›
  Updates。
- Settings › Updates 提供手動「Check for updates」與「Install & Restart」。
- Settings › Updates 會顯示 updater 回傳的新版本日期與更新內容。
- Endpoint：`https://github.com/NakiriYuuzu/Yuuzu-IDE/releases/latest/download/latest.json`
  ——只會解析到最新已 publish 的非 prerelease release，故 draft 不影響使用者。
- App 內建 minisign 公鑰驗證 `latest.json` 的簽章，驗章失敗即拒絕安裝。
- Release notes 由 `CHANGELOG.md` 的版本段落擷取後填入 GitHub Release body；
  Tauri updater 會把該內容作為更新 metadata 回傳給 UI。
- Windows `windows-x86_64` entry 應指向 Tauri updater 支援的 signed installer
  artifact（例如 `Yuuzu-IDE_0.2.0_x64-setup.exe`），不是 portable zip。
- Windows portable zip（例如 `Yuuzu-IDE_0.2.0_windows_x64_portable.zip`）是免安裝
  release asset，解壓後直接執行；portable 版更新方式是手動下載新版 zip 並替換。

## 簽章金鑰

- CI 用 GitHub Secrets `TAURI_SIGNING_PRIVATE_KEY` /
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 簽章。
- 公鑰寫在 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。
- 私鑰須妥善備份；遺失將無法再發出能被現有 app 接受的更新。

## 限制

- 未做 OS code signing：macOS 首次安裝會被 Gatekeeper 擋（右鍵→打開），
  Windows 首次安裝跳 SmartScreen「不明發行者」。
- macOS 使用 ad-hoc signing identity `"-"` 降低 Apple Silicon 下載後被判定
  damaged 的風險；根治仍需 Apple Developer notarization。
- macOS 自動更新要求 app 安裝在可寫位置（通常 `/Applications`）。

## Rollback Path

保留前一版安裝檔，直到新版穩定運作一天。若新版無法穩定啟動或破壞
recovery，重新安裝舊版並保留失敗版本以便診斷。
