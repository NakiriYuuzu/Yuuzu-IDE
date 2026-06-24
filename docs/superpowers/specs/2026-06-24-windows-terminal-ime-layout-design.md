# Windows Terminal IME Layout Stability — 設計規格

> 🟡 **實作狀態:已實作 / 待 Windows smoke** — 本文件根據 GitHub issue #12 與 2026-06-24 worktree 分析整理; containment CSS 與 regression test 已落地,但 Windows WebView2 IME packaged app smoke 尚未執行。對應 issue: https://github.com/NakiriYuuzu/Yuuzu-IDE/issues/12

- 日期:2026-06-24
- 任務類型:`bugfix` + `ui-runtime`
- 範圍:Windows WebView2 packaged app 中,使用中文 / 繁中 IME 輸入 terminal 時,防止 terminal 或整體 workbench 被水平撐開。
- 主要設計原則:先修正 terminal/xterm 外層 containment,保留既有 xterm.js IME 行為與 Rust PTY resize 語意。

---

## 1. 問題背景

Issue #12 回報 Windows only 行為:

- 在 terminal / xterm 畫面使用中文 IME 輸入。
- 每輸入字元,terminal 畫面或整體 UI 會向右偏移。
- 截圖描述顯示 IME candidate window 與 terminal content 區域疑似造成水平 overflow / layout shift。

目前可確認的程式現況:

- v2 terminal tab 由 `src/v2/ContentViews.tsx` 的 `.yz2-term > .yz2-xterm > TerminalTab` 渲染。
- AgentZone real terminal 由 `src/v2/AgentZone.tsx` 的 `.yz2-az-win-body.real > TerminalTab` 渲染。
- `TerminalTab` 已有 `requestAnimationFrame` coalescing、`sameTerminalDimensions` guard,以及 unmount cancel 邏輯。
- xterm.js 在 IME composition 時會啟用 `.composition-view`,並把 `.xterm-helper-textarea` 移到 cursor/composition view 位置;composition text 是 `white-space: nowrap`。

因此本 bug 不應先假設是 PTY resize loop。更可能是外層 flex/grid item 缺少水平 containment,導致 xterm helper / composition DOM 在 Windows WebView2 中把 terminal 容器或上層 layout 撐寬。

---

## 2. Goals

- Windows 中文 / 繁中 IME 輸入期間,terminal tab 不水平推動 editor/content column。
- AgentZone terminal window 中的 IME 輸入不推動 AgentZone grid、side panel 或整體 workbench。
- xterm candidate/composition UI 仍可正常顯示與定位。
- FitAddon resize 仍依容器尺寸同步 PTY,但不因相同 dimensions 重複送 resize。
- 建立可自動化的 CSS/component regression guard;IME 本身以 Windows packaged app 手動 smoke 作最終證明。

## 3. Non-goals

- 不替換 xterm.js。
- 不修改 Rust PTY backend 或 terminal IPC contract。
- 不處理 terminal Ctrl+C / Ctrl+V copy-paste;那屬於 issue #15。
- 不重設 xterm CJK width/unicode provider。
- 不重做 AgentZone layout 或 terminal UI。

---

## 4. Root Cause Hypothesis

根本假設:

> Windows WebView2 在 IME composition 期間會讓 xterm helper textarea / composition view 產生暫態寬度或定位壓力;Yuuzu-IDE 的 terminal 外層 flex/grid item 沒有完整 `min-width: 0` 與 `overflow: hidden`,所以該壓力向上傳遞,造成 terminal/content/workbench 水平 layout shift。

支持證據:

- `.yz2-view` 目前只有 `flex: 1` / `min-height: 0`,缺 `min-width: 0` 與 overflow containment。
- `.yz2-xterm` 目前只有 `flex: 1` / `min-height: 0` / `display: flex`,缺 `min-width: 0` 與 `overflow: hidden`。
- `.terminal-host` 目前有 `width: 100%` / `height: 100%`,但缺 `box-sizing: border-box`,`min-width: 0`,`overflow: hidden`。
- AgentZone `.yz2-az`,`.yz2-az-canvas`,`.yz2-az-grid`,`.yz2-az-win`,`.yz2-az-win-body.real` 的水平 containment 不完整。
- xterm.js CSS 對 `.composition-view` 使用 `position: absolute; white-space: nowrap`,且 composition helper 會用 `getBoundingClientRect()` 把 textarea 寬度設成 composition view 寬度。

需要 Windows smoke 確認的部分:

- 實際 layout shift 是否完全由 containment 修復。
- IME candidate window 是否仍在合理位置,沒有因過度裁切變得不可用。

---

## 5. Design

### 5.1 Main terminal containment

在 v2 terminal rendering path 上補齊水平 containment:

- `.yz2-main`:加入 `min-width: 0` 與 `overflow: hidden`,避免 child flex item 反推 workbench。
- `.yz2-view`:加入 `min-width: 0` 與 `overflow: hidden`,讓 view 本身成為 containment boundary。
- `.yz2-term`:加入 `min-width: 0` 與 `overflow: hidden`,terminal footer 仍維持固定高度。
- `.yz2-xterm`:加入 `min-width: 0`,`overflow: hidden`,`width: 100%`。
- `.yz2 .terminal-host`:加入 `box-sizing: border-box`,`min-width: 0`,`overflow: hidden`。
- `.yz2 .terminal-host .xterm`,`.xterm-viewport`,`.xterm-screen`:限制 `max-width: 100%`,避免內部 canvas/helper DOM 造成 intrinsic width 外溢。

這是主要修復面。它不改 xterm.js 行為,只把 terminal host 視為固定尺寸的渲染 viewport。

### 5.2 AgentZone terminal containment

AgentZone real terminal 需要同樣規則,但不能破壞現有 grid/resizer:

- `.yz2-az`:加入 `min-width: 0` 與 `overflow: hidden`。
- `.yz2-az-head`:加入 `min-width: 0`,避免 header 文字或 controls 反推寬度。
- `.yz2-az-canvas`:加入 `min-width: 0`;保留 scroll 行為,但水平 overflow 應由 window/body containment 截斷。
- `.yz2-az-grid`:加入 `min-width: 0`,並維持 `repeat(..., minmax(0, 1fr))` / two-column `minmax(220px, ...)` 現有規則。
- `.yz2-az-win`:加入 `min-width: 0`。
- `.yz2-az-win-body.real`:加入 `min-width: 0`,並保持 `overflow: hidden; display: flex`。
- `.yz2-az-win-body.real .terminal-host`:沿用 terminal host containment,保留較小 padding。

### 5.3 Resize sync policy

先保留現有 `TerminalTab` resize code:

- mount 時同步一次尺寸。
- ResizeObserver tick 只排一個 rAF。
- `fitAddon.proposeDimensions()` 正規化後,相同 rows/cols 不重送 `onResize`。
- unmount 時取消 pending animation frame。

只有在新增 regression 或 Windows smoke 證明仍有 resize feedback loop 時,才進一步改 `TerminalTab`。避免把 containment bug 擴大成 terminal runtime refactor。

---

## 6. Affected Files

| File | Responsibility |
| --- | --- |
| `src/v2/yuzu.css` | 補 `.yz2-main`、`.yz2-view`、terminal、xterm、AgentZone 的 horizontal containment。 |
| `src/v2/terminal-containment.test.tsx` | 增加 main terminal 與 AgentZone real terminal DOM containment regression,並檢查必要 CSS declarations。 |
| `src/features/terminal/TerminalTab.test.ts` | 保留既有 resize coalescing 與 duplicate dimensions regression。 |
| `docs/architecture/issue-12-windows-terminal-ime-smoke.md` | 實作後記錄 Windows packaged app IME smoke 結果。 |

不預期修改:

- `src-tauri/src/terminal.rs`
- `src/features/terminal/terminal-api.ts`
- `src/v2/controller.ts`,除非 smoke 顯示 resize event source 還有缺口。

---

## 7. Test Strategy

### Focused automated tests

```bash
bun test src/v2/terminal-containment.test.tsx src/features/terminal/TerminalTab.test.ts
```

Required assertions:

- `TerminalTab` repeated ResizeObserver ticks with same proposed dimensions emit one PTY resize only.
- main terminal render path exposes `.yz2-xterm .terminal-host`.
- AgentZone real terminal render path exposes `.yz2-az-win-body.real .terminal-host`.
- CSS contract is covered through class presence and, where practical, style text assertions against `src/v2/yuzu.css` for required containment declarations.

### Broader frontend gate

```bash
bun test src/features/terminal src/v2
bun run build
git diff --check
```

### Runtime smoke

Because this is a Windows WebView2 + IME behavior, static tests are not sufficient.

Required Windows packaged app smoke:

1. Build packaged debug app:

   ```bash
   bun run tauri build --debug --bundles app
   ```

   If updater artifact signing blocks completion, record that failure and rerun only for local app smoke:

   ```bash
   bun run tauri build --debug --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
   ```

2. On Windows, launch the packaged debug app.
3. Open a real workspace.
4. Open a normal terminal tab.
5. Switch to Traditional Chinese or Chinese IME.
6. Type at least 30 composed characters.
7. Confirm content column, side panel, status bar, and full workbench width do not move.
8. Open AgentZone terminal and repeat the IME input.
9. Confirm AgentZone grid/window/body width does not move.
10. Record Windows version, WebView2 runtime version, IME language, before/after result, and any screenshots in `docs/architecture/issue-12-windows-terminal-ime-smoke.md`.

---

## 8. Acceptance Criteria

- Windows WebView2 packaged app 中文 / 繁中 IME input 不再造成 terminal 或 workbench 向右偏移。
- Candidate/composition UI 仍可使用,沒有被產品容器裁切到不可操作。
- Normal terminal tab 與 AgentZone terminal 都具備 horizontal overflow containment。
- Terminal resize sync 不會因 repeated same dimensions 形成 PTY resize loop。
- Focused tests 與 broad frontend gate 通過。
- Windows smoke evidence 已寫入 `docs/architecture/issue-12-windows-terminal-ime-smoke.md`。

---

## 9. Risks And Follow-ups

- 如果 containment 會裁切 xterm composition view,需調整 boundary:優先保護 workbench 不移動,再針對 `.composition-view` 設定可用但不反推 layout 的定位/overflow 規則。
- 如果 Windows smoke 仍有位移,下一步才檢查 FitAddon 回饋來源,例如 composition 期間 WebView2 是否回報了 oscillating host width。
- 如果 CJK glyph width 本身在 xterm.js 6 / Windows WebView2 不穩,另開 issue 設計 unicode width provider 或 xterm option,不要混入本 containment bugfix。
