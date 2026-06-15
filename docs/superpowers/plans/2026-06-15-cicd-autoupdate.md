# CI/CD Release Pipeline 與 Auto-Update 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Yuuzu-IDE 在 push 版本 tag 後自動於 macOS + Windows build 並簽章 release artifacts 上傳 GitHub Release，且 app 能在啟動時 / 從 Settings 手動檢查、下載、安裝並重啟更新。

**Architecture:** 採方案 A——官方 `tauri-plugin-updater` + GitHub Releases + `tauri-action`。CI 用 minisign 私鑰簽章、產生 `latest.json`；app 內建公鑰驗章。前端把可測的決策邏輯（要不要顯示、顯示什麼 toast）抽成純函式，Tauri 整合維持薄包裝。

**Tech Stack:** Tauri 2、Rust、React 19 + zustand、`bun:test`、GitHub Actions、`tauri-apps/tauri-action`、minisign。

**設計依據：** `docs/superpowers/specs/2026-06-15-cicd-autoupdate-design.md`

**Git 慣例：** 依本 repo owner 慣例，**staging 與 commit 由 owner 負責**。每個 Task 末尾的 commit 指令是「建議指令」——由 owner 執行，或明確授權執行的 agent 對該 Task 列出的檔案 stage。commit message 結尾固定 `Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>`，**不得**加入任何 AI 作者。

---

## File Structure

| 檔案 | 責任 | 動作 |
|------|------|------|
| `src/v2/updater.ts` | 更新檢查的純邏輯 + 薄 Tauri 包裝（`checkForUpdate`、`updateToastMessage`） | 新增 |
| `src/v2/updater.test.ts` | `updater.ts` 的單元測試 | 新增 |
| `src/v2/v2-model.ts` | `SETTINGS_CONFIG` 新增 "Updates" section | 修改 |
| `src/v2/Overlays.tsx` | `UpdatesSection` 元件 + 接進 `SettingsModal` | 修改 |
| `src/v2/Workbench.tsx` | 啟動時 silent 更新檢查 | 修改 |
| `src-tauri/Cargo.toml` | 加 updater / process plugin crate | 修改 |
| `src-tauri/src/lib.rs` | 註冊兩個 plugin | 修改 |
| `src-tauri/capabilities/default.json` | 加 updater / process 權限 | 修改 |
| `src-tauri/tauri.conf.json` | `createUpdaterArtifacts` + `plugins.updater` | 修改 |
| `package.json` | 加兩個 JS plugin 套件 | 修改 |
| `.github/workflows/release.yml` | 發版 pipeline | 新增 |
| `.github/workflows/ci.yml` | push/PR 驗證 | 新增 |
| `docs/release/update-strategy.md` | 改寫成自動流程 | 修改 |

---

## Task 1: Rust — 加入 updater 與 process plugin

**Files:**
- Modify: `src-tauri/Cargo.toml:23-24`
- Modify: `src-tauri/src/lib.rs:31`
- Modify: `src-tauri/capabilities/default.json:8-12`

- [ ] **Step 1: 加入 Cargo 相依**

在 `src-tauri/Cargo.toml` 的 `tauri-plugin-dialog = "2.7.1"`（第 24 行）下方加入：

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 2: 在 builder 註冊 plugin**

`src-tauri/src/lib.rs` 第 31 行 `.plugin(tauri_plugin_dialog::init())` 改成：

```rust
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
```

- [ ] **Step 3: 加入 capability 權限**

`src-tauri/capabilities/default.json` 的 `permissions` 陣列改成：

```json
  "permissions": [
    "core:default",
    "dialog:allow-open",
    "core:window:allow-start-dragging",
    "updater:default",
    "process:allow-restart"
  ]
```

- [ ] **Step 4: 編譯驗證**

Run: `. "$HOME/.cargo/env" && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 編譯成功（會下載 `tauri-plugin-updater`、`tauri-plugin-process` 新 crate）。

- [ ] **Step 5: 建議 commit（owner 執行）**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(config): 🚀 register updater and process plugins

- add tauri-plugin-updater / tauri-plugin-process crates
- register both in the Tauri builder
- grant updater:default and process:allow-restart capabilities

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 2: 加入前端 JS plugin 套件

**Files:**
- Modify: `package.json`（dependencies）

- [ ] **Step 1: 安裝套件**

Run: `bun add @tauri-apps/plugin-updater @tauri-apps/plugin-process`
Expected: `package.json` 的 `dependencies` 多出 `@tauri-apps/plugin-updater` 與 `@tauri-apps/plugin-process`（^2），`bun.lock` 更新。

- [ ] **Step 2: 驗證安裝**

Run: `grep -E "plugin-updater|plugin-process" package.json`
Expected: 兩行都出現。

- [ ] **Step 3: 建議 commit（owner 執行）**

```bash
git add package.json bun.lock
git commit -m "deps(api): 📦 add tauri updater and process JS plugins

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 3: 前端核心邏輯 `updater.ts`（TDD）

**Files:**
- Create: `src/v2/updater.ts`
- Test: `src/v2/updater.test.ts`

- [ ] **Step 1: 先寫失敗測試**

建立 `src/v2/updater.test.ts`：

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { check } from "@tauri-apps/plugin-updater"
import { checkForUpdate, updateToastMessage, type UpdateCheck } from "./updater"

describe("updateToastMessage", () => {
    const available: UpdateCheck = { kind: "available", version: "0.2.0", install: async () => {} }
    const current: UpdateCheck = { kind: "current" }
    const errored: UpdateCheck = { kind: "error", message: "offline" }

    test("available + silent → 引導到 Settings", () => {
        expect(updateToastMessage(available, true)).toBe("更新 0.2.0 可用 — 前往 Settings › Updates 安裝")
    })
    test("available + 主動 → 簡短可用訊息", () => {
        expect(updateToastMessage(available, false)).toBe("更新 0.2.0 可用")
    })
    test("current + silent → 不顯示", () => {
        expect(updateToastMessage(current, true)).toBeNull()
    })
    test("current + 主動 → 已是最新", () => {
        expect(updateToastMessage(current, false)).toBe("已是最新版本")
    })
    test("error + silent → 不顯示", () => {
        expect(updateToastMessage(errored, true)).toBeNull()
    })
    test("error + 主動 → 顯示錯誤", () => {
        expect(updateToastMessage(errored, false)).toBe("檢查更新失敗：offline")
    })
})

describe("checkForUpdate", () => {
    test("有更新 → available + version", async () => {
        const fakeCheck = (async () => ({
            version: "0.2.0",
            downloadAndInstall: async () => {},
        })) as unknown as typeof check
        const r = await checkForUpdate(fakeCheck)
        expect(r.kind).toBe("available")
        if (r.kind === "available") expect(r.version).toBe("0.2.0")
    })
    test("無更新 → current", async () => {
        const fakeCheck = (async () => null) as unknown as typeof check
        const r = await checkForUpdate(fakeCheck)
        expect(r.kind).toBe("current")
    })
    test("check 拋錯 → error + message", async () => {
        const fakeCheck = (async () => {
            throw new Error("offline")
        }) as unknown as typeof check
        const r = await checkForUpdate(fakeCheck)
        expect(r.kind).toBe("error")
        if (r.kind === "error") expect(r.message).toBe("offline")
    })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test src/v2/updater.test.ts`
Expected: FAIL — 找不到模組 `./updater`（Cannot find module）。

- [ ] **Step 3: 寫最小實作**

建立 `src/v2/updater.ts`：

```ts
import { check } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"

export type UpdateCheck =
    | { kind: "available"; version: string; install: () => Promise<void> }
    | { kind: "current" }
    | { kind: "error"; message: string }

// 查詢更新；checkFn 可注入以便測試,預設打真正的 Tauri updater。
export async function checkForUpdate(checkFn: typeof check = check): Promise<UpdateCheck> {
    try {
        const update = await checkFn()
        if (!update) return { kind: "current" }
        return {
            kind: "available",
            version: update.version,
            install: async () => {
                await update.downloadAndInstall()
                await relaunch()
            },
        }
    } catch (e) {
        return { kind: "error", message: e instanceof Error ? e.message : String(e) }
    }
}

// 依檢查結果與是否使用者主動觸發,決定要顯示的 toast 文字。
// 回傳 null = 不顯示(silent 模式的「無更新」「錯誤」皆靜默略過)。
export function updateToastMessage(result: UpdateCheck, silent: boolean): string | null {
    switch (result.kind) {
        case "available":
            return silent
                ? `更新 ${result.version} 可用 — 前往 Settings › Updates 安裝`
                : `更新 ${result.version} 可用`
        case "current":
            return silent ? null : "已是最新版本"
        case "error":
            return silent ? null : `檢查更新失敗：${result.message}`
    }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `bun test src/v2/updater.test.ts`
Expected: PASS — 9 個測試全綠。

- [ ] **Step 5: 建議 commit（owner 執行）**

```bash
git add src/v2/updater.ts src/v2/updater.test.ts
git commit -m "feat(ui): 🚀 add updater check logic with toast messaging

- checkForUpdate maps Tauri updater result to a tagged union
- updateToastMessage decides silent vs interactive copy
- unit-tested via injected check fn (no Tauri runtime needed)

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 4: Settings → Updates section

**Files:**
- Modify: `src/v2/v2-model.ts:829`（type）, `:875`（config）
- Modify: `src/v2/Overlays.tsx`（import、`UpdatesSection`、`SettingsModal` 分支）

- [ ] **Step 1: 擴充 `custom` 型別**

`src/v2/v2-model.ts` 第 829 行：

```ts
    custom?: "performance" | "diagnostics" | "recovery" | "updates"
```

- [ ] **Step 2: 加入 Updates section**

`src/v2/v2-model.ts` 在 `recovery` 那一筆（第 875 行）之後、陣列結尾 `]` 之前加入：

```ts
    { id: "updates", label: "Updates", glyph: "⟳", desc: "Check for and install Yuuzu-IDE updates.", rows: [], custom: "updates" },
```

- [ ] **Step 3: 在 Overlays 匯入 updater**

`src/v2/Overlays.tsx` 第 24 行 `import { writeToSession } from "./controller"` 之後加入：

```ts
import { checkForUpdate, updateToastMessage, type UpdateCheck } from "./updater"
```

- [ ] **Step 4: 新增 `UpdatesSection` 元件**

`src/v2/Overlays.tsx` 在 `export function SettingsModal()`（第 531 行）**之前**插入：

```tsx
function UpdatesSection() {
    const showToast = useV2Store((s) => s.showToast)
    const [checking, setChecking] = useState(false)
    const [installing, setInstalling] = useState(false)
    const [result, setResult] = useState<UpdateCheck | null>(null)

    const onCheck = async () => {
        setChecking(true)
        const r = await checkForUpdate()
        setResult(r)
        setChecking(false)
        const msg = updateToastMessage(r, false)
        if (msg) showToast(msg)
    }

    const onInstall = async () => {
        if (result?.kind !== "available") return
        setInstalling(true)
        try {
            await result.install()
        } catch (e) {
            setInstalling(false)
            showToast("安裝更新失敗：" + (e instanceof Error ? e.message : String(e)))
        }
    }

    return (
        <div className="yz2-setting-row">
            <div className="info-col">
                <span className="lbl">Software update</span>
                <span className="dsc">
                    {result?.kind === "available"
                        ? `更新 ${result.version} 可安裝`
                        : "啟動時會自動檢查；也可在此手動檢查。"}
                </span>
            </div>
            <div className="yz2-choice-group">
                <button type="button" className="yz2-choice" onClick={onCheck} disabled={checking || installing}>
                    {checking ? "Checking…" : "Check for updates"}
                </button>
                {result?.kind === "available" ? (
                    <button type="button" className="yz2-choice is-on" onClick={onInstall} disabled={installing}>
                        {installing ? "Installing…" : "Install & Restart"}
                    </button>
                ) : null}
            </div>
        </div>
    )
}
```

- [ ] **Step 5: 接進 SettingsModal 的 custom 分支**

`src/v2/Overlays.tsx` 第 577-579 行的 recovery 分支：

```tsx
                        ) : cur.custom === "recovery" ? (
                            <RecoverySection />
                        ) : (
```

改成：

```tsx
                        ) : cur.custom === "recovery" ? (
                            <RecoverySection />
                        ) : cur.custom === "updates" ? (
                            <UpdatesSection />
                        ) : (
```

- [ ] **Step 6: 型別檢查 + build**

Run: `bun run build`
Expected: `tsc` 無錯、`vite build` 成功。

- [ ] **Step 7: 建議 commit（owner 執行）**

```bash
git add src/v2/v2-model.ts src/v2/Overlays.tsx
git commit -m "feat(ui): 🚀 add Updates section to Settings

- new updates section in SETTINGS_CONFIG
- UpdatesSection with manual Check + Install & Restart buttons
- reuses existing setting-row / choice styles

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 5: 啟動時 silent 更新檢查

**Files:**
- Modify: `src/v2/Workbench.tsx:10`（import）, `:413-415`（effect 旁）

- [ ] **Step 1: 匯入 updater**

`src/v2/Workbench.tsx` 第 10 行 `import { useV2Store, v2Store } from "./v2-store"` 之後（緊接下一行）加入：

```ts
import { checkForUpdate, updateToastMessage } from "./updater"
```

- [ ] **Step 2: 加入啟動檢查 effect**

`src/v2/Workbench.tsx` 在現有 bootstrap effect（第 413-415 行）之後插入：

```tsx
    useEffect(() => {
        void (async () => {
            const result = await checkForUpdate()
            const msg = updateToastMessage(result, true)
            if (msg) v2Store.getState().showToast(msg)
        })()
    }, [])
```

說明：在 demo/web 或 `tauri dev`（updater 停用）時，`check()` 會 reject → `checkForUpdate` 回 `{kind:"error"}` → silent 下 `updateToastMessage` 回 `null` → 不顯示，符合預期。

- [ ] **Step 3: 型別檢查 + build**

Run: `bun run build`
Expected: 成功，無 TS 錯誤。

- [ ] **Step 4: 全量前端測試（確認沒打壞既有）**

Run: `bun test`
Expected: 既有測試 + `updater.test.ts` 全綠。
（註：`SidePanel.test` 在 full-suite 偶有既存 flaky，與本變更無關；若紅燈先單獨重跑該檔確認。）

- [ ] **Step 5: 建議 commit（owner 執行）**

```bash
git add src/v2/Workbench.tsx
git commit -m "feat(ui): 🚀 check for updates silently on launch

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 6: 【手動】產生 minisign 金鑰 + 設定 GitHub Secrets

> 這個 Task 由 owner 在本機手動執行，無法由程式碼代勞。私鑰**絕不進 git**。

- [ ] **Step 1: 產生金鑰對**

Run: `bun run tauri signer generate -w ~/.tauri/yuuzu-ide.key`
過程會要求輸入密碼（可空，但建議設）。完成後得到：
- `~/.tauri/yuuzu-ide.key`（私鑰）
- `~/.tauri/yuuzu-ide.key.pub`（公鑰）

- [ ] **Step 2: 取得公鑰內容（Task 7 要用）**

Run: `cat ~/.tauri/yuuzu-ide.key.pub`
複製整段內容備用。

- [ ] **Step 3: 設定 GitHub repo secrets**

用 `gh`（或 GitHub 網頁 Settings → Secrets and variables → Actions）：

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/yuuzu-ide.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD   # 互動輸入剛剛的密碼;若空密碼則設為空字串
```

- [ ] **Step 4: 驗證 secrets 存在**

Run: `gh secret list`
Expected: 看到 `TAURI_SIGNING_PRIVATE_KEY` 與 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

- [ ] **Step 5: 備份私鑰**

把 `~/.tauri/yuuzu-ide.key` 與密碼存進密碼管理器。遺失 = 無法再發出能被現有 app 接受的更新。

---

## Task 7: tauri.conf.json — updater 設定

**Files:**
- Modify: `src-tauri/tauri.conf.json:30-40`（bundle）, 新增 `plugins` 區塊

> 依賴 Task 6 的公鑰。

- [ ] **Step 1: 開啟 updater artifacts**

`src-tauri/tauri.conf.json` 的 `bundle` 區塊（第 30-40 行）加入 `createUpdaterArtifacts`：

```jsonc
  "bundle": {
    "active": true,
    "targets": "all",
    "createUpdaterArtifacts": true,
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
```

- [ ] **Step 2: 加入 plugins.updater**

在 `bundle` 區塊之後（`}` 結尾與最外層 `}` 之間）加入 `plugins` 頂層鍵，`pubkey` 填入 Task 6 Step 2 的公鑰：

```jsonc
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/NakiriYuuzu/Yuuzu-IDE/releases/latest/download/latest.json"
      ],
      "pubkey": "貼上 ~/.tauri/yuuzu-ide.key.pub 的內容"
    }
  }
```

- [ ] **Step 3: 驗證 JSON 合法 + schema**

Run: `bun run tauri build --help >/dev/null && python3 -c "import json;json.load(open('src-tauri/tauri.conf.json'))"`
Expected: 無錯誤輸出（JSON 解析成功）。

說明：開啟 `createUpdaterArtifacts` 後，**完整 bundle**（`bun run tauri build`）在本機需要簽章金鑰環境變數才會成功；CI 會提供。`cargo build` 與 `bun run build` 不受影響。

- [ ] **Step 4: 建議 commit（owner 執行）**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(config): 🚀 configure updater endpoint and signing pubkey

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 8: Release pipeline `.github/workflows/release.yml`

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: 建立 workflow**

```yaml
name: release

on:
  push:
    tags:
      - 'v*.*.*'
  workflow_dispatch:

jobs:
  build:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Install frontend deps
        run: bun install

      - name: Build, sign and release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'Yuuzu-IDE ${{ github.ref_name }}'
          releaseDraft: true
          prerelease: false
```

- [ ] **Step 2: 驗證 YAML**

Run: `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/release.yml'))"`
Expected: 無錯誤（YAML 合法）。若本機有 `actionlint`，再跑 `actionlint .github/workflows/release.yml`。

- [ ] **Step 3: 建議 commit（owner 執行）**

```bash
git add .github/workflows/release.yml
git commit -m "ci: 👷 add tauri release pipeline for macOS and Windows

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 9: CI 驗證 `.github/workflows/ci.yml`

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 建立 workflow**

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  verify:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Install deps
        run: bun install

      - name: Frontend tests
        run: bun test

      - name: Frontend build
        run: bun run build

      - name: Rust tests
        run: cargo test --manifest-path src-tauri/Cargo.toml

      - name: Rust format
        run: cargo fmt --manifest-path src-tauri/Cargo.toml --check

      - name: Rust clippy
        run: cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

- [ ] **Step 2: 驗證 YAML**

Run: `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: 無錯誤。

- [ ] **Step 3: 建議 commit（owner 執行）**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: 👷 add push/PR verification workflow

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 10: 改寫 `docs/release/update-strategy.md`

**Files:**
- Modify: `docs/release/update-strategy.md`（整檔改寫）

- [ ] **Step 1: 改寫文件**

把整個檔案內容換成：

```markdown
# Update Strategy

Yuuzu-IDE 透過 GitHub Releases 自動發版，並由 app 內建的 `tauri-plugin-updater`
進行更新。更新完整性由 minisign 簽章保證（與 OS code signing 無關）。

## 發版流程

1. 同步 bump 版號（三處保持一致）：
   - `src-tauri/tauri.conf.json` 的 `version`
   - `package.json` 的 `version`
   - `src-tauri/Cargo.toml` 的 `version`
2. 跑下方「發版前驗證」確認綠燈。
3. commit 版號變更。
4. 打 tag 並 push：`git tag vX.Y.Z && git push origin vX.Y.Z`。
5. GitHub Actions `release.yml` 會在 macOS 與 Windows 各自 build、簽章、
   上傳到一個 **draft** Release，並產生 `latest.json`。
6. 到 GitHub Releases 檢查 draft（兩平台 artifacts + `latest.json` 都在）後，
   手動 **Publish**。發布後 auto-update endpoint 才會生效。

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

- App 啟動時靜默呼叫 updater；有新版顯示非阻斷 toast，引導到 Settings › Updates。
- Settings › Updates 提供手動「Check for updates」與「Install & Restart」。
- Endpoint：`https://github.com/NakiriYuuzu/Yuuzu-IDE/releases/latest/download/latest.json`
  ——只會解析到**最新已 publish 的非 prerelease** release，故 draft 不影響使用者。
- App 內建 minisign 公鑰驗證 `latest.json` 的簽章，驗章失敗即拒絕安裝。

## 簽章金鑰

- CI 用 GitHub Secrets `TAURI_SIGNING_PRIVATE_KEY` /
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 簽章。
- 公鑰寫在 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。
- 私鑰須妥善備份；遺失將無法再發出能被現有 app 接受的更新。

## 限制

- 未做 OS code signing：macOS 首次安裝會被 Gatekeeper 擋（右鍵→打開），
  Windows 首次安裝跳 SmartScreen「不明發行者」。
- macOS 不簽章下偶有 quarantine 眉角；根治需 Apple Developer notarization。
- macOS 自動更新要求 app 安裝在可寫位置（通常 `/Applications`）。

## Rollback Path

保留前一版安裝檔，直到新版穩定運作一天。若新版無法穩定啟動或破壞 recovery，
重新安裝舊版並保留失敗版本以便診斷。
```

- [ ] **Step 2: 建議 commit（owner 執行）**

```bash
git add docs/release/update-strategy.md
git commit -m "docs: 📚 rewrite update strategy for automated releases

Co-Authored-By: Yuuzu <yuuzu@yuuzu.net>"
```

---

## Task 11: 端到端發版 + 更新驗證

> 大多為手動驗證；確認整條鏈真的能跑通。

- [ ] **Step 1: 版號設為當前基準**

確認 `tauri.conf.json` / `package.json` / `Cargo.toml` 三處 `version` 一致（例如維持 `0.1.0`）。

- [ ] **Step 2: 觸發一次 release（測試 tag）**

```bash
git tag v0.1.0 && git push origin v0.1.0
```
到 GitHub Actions 看 `release.yml`：macOS + Windows 兩個 job 都應綠燈，並在 Releases 產生一個 **draft** `Yuuzu-IDE v0.1.0`，內含兩平台安裝檔 + `*.sig` + `latest.json`。

- [ ] **Step 3: 檢查 latest.json**

下載 draft 裡的 `latest.json`，確認 `platforms` 含 `darwin-aarch64` 與 `windows-x86_64`，各有 `signature` 與 `url`。

- [ ] **Step 4: 安裝基準版並 publish 下一版**

1. 從 draft 安裝 v0.1.0 到本機（macOS 放 `/Applications`）。
2. Publish 該 v0.1.0 release。
3. 三處版號 bump 成 `0.1.1`，commit，`git tag v0.1.1 && git push origin v0.1.1`。
4. 等 CI 跑完 → 檢查 v0.1.1 draft → Publish。

- [ ] **Step 5: 驗證 app 內更新**

1. 開啟已安裝的 v0.1.0。
2. 啟動時應跳 toast「更新 0.1.1 可用 …」。
3. 進 Settings › Updates → 「Check for updates」→ 出現「Install & Restart」。
4. 按下後應下載、安裝、自動重啟，版本變 v0.1.1。

- [ ] **Step 6: 清理**

刪除任何純測試用的 release/tag（若有）。

---

## Self-Review 對照（spec → task）

- Release pipeline（spec §4.1）→ Task 8 ✓
- CI 驗證（spec §4.2）→ Task 9 ✓
- Updater + process plugin（spec §4.3）→ Task 1, 2 ✓
- Minisign 金鑰（spec §4.4）→ Task 6 ✓
- 前端 updater + UX（spec §4.5）→ Task 3, 4, 5 ✓
- 版本管理（spec §4.6）→ Task 10, 11 ✓
- 文件更新（spec §4.7）→ Task 10 ✓
- tauri.conf.json updater（spec §4.3）→ Task 7 ✓
- 端到端（spec §7）→ Task 11 ✓

型別一致性：`UpdateCheck`、`checkForUpdate`、`updateToastMessage` 在 Task 3 定義，Task 4/5 沿用同名同簽章 ✓。
