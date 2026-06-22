# Media/Binary Image Viewer Design

Date: 2026-06-22

Issue: [#5 [Feat]: 希望能夠打開圖片](https://github.com/NakiriYuuzu/Yuuzu-IDE/issues/5)

## 1. Summary

Yuuzu-IDE 目前的 v2 開檔流程以文字檔為中心：`openFile` 建立 `type: "file"` tab，controller 呼叫 `readTextFile`，內容進入 editor、dirty/save、LSP、backup 與 diagnostics 流程。圖片或其他二進位檔若走這條路徑，會落到 unreadable/binary 狀態，無法預覽。

本設計新增 read-only media/binary viewer 架構。第一版真正支援 `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`。其他二進位檔會被分類並顯示 unsupported binary viewer，不實作 PDF、video、audio 或 hex renderer。

## 2. Goals

- 支援在 workspace 內開啟常見圖片檔。
- 圖片 tab 顯示 image preview、toolbar、metadata strip 與 info overlay。
- 建立可擴充的 media tab 邊界，避免圖片混入文字 editor 的 dirty/save/LSP/backup 流程。
- `.svg` 預設以 split 開啟：左側為 SVG text editor，右側為 image viewer。
- Unsupported binary 檔有明確 read-only surface，不再偽裝成文字檔。

## 3. Non-Goals

- 不做圖片編輯、annotation、旋轉、裁切、gallery 或 thumbnail grid。
- 不實作 PDF、video、audio、hex viewer。
- 不處理 remote/SFTP media preview。
- 不更動 CodeMirror/text editor engine。
- 不重構 Explorer、Palette、Search 的 open-file 入口。

## 4. Current Code Context

- `src/v2/controller.ts` 的 `openFile(displayPath, reveal?)` 是 real workspace 開檔核心入口，現在直接建立 `type: "file"` tab 並呼叫 `readTextFile`。
- `src/features/files/file-api.ts` 只有 `readTextFile`, `writeTextFile`, `createTextFile` 等文字/檔案操作 API。
- `src-tauri/src/file_system.rs` 只有 `read_text_file`，用 `EDITABLE_TEXT_LIMIT_BYTES` 限制文字讀取，並用 workspace path validation 保護本機檔案邊界。
- `src/v2/v2-model.ts` 的 `Tab` 目前把 `type: "file"` 與 `content?: string | null` 綁在同一條 editor 路徑。
- `src/v2/ContentViews.tsx` 的 `EditorView` 會依 `content`, `tooLarge`, `realPath` 決定 editor/unreadable/large-file 畫面。
- `src/v2/Workbench.tsx` 的 `Cmd+S` 只看 `at?.type === "file" && at.realPath !== undefined`，新增 media tab 時必須避免被保存流程吃到。

## 5. Design Decisions

### D1. 新增 read-only media tab 邊界

新增 `type: "media"` tab surface，不把圖片 payload 放入 `content: string`。Media tab 不參與 dirty/save/LSP/backup/editor diagnostics。Unsupported binary 也使用 media tab，但 payload 的 `kind` 為 `"unsupported"`。

### D2. 新增 Rust media 讀取 API

新增一條 Tauri command，例如 `read_media_file`，負責：

- trusted workspace root validation。
- workspace child path validation。
- regular file 檢查。
- size limit 檢查。
- mime/format 分類。
- base64 data URL 回傳。
- metadata 回傳。

Frontend 不直接讀任意本機路徑，也不組 local filesystem URL。

### D3. 第一版支援格式

第一版支援：

- `png`
- `jpg`
- `jpeg`
- `gif`
- `webp`
- `svg`

其他副檔名或無法識別的二進位檔進 unsupported binary viewer。若副檔名像圖片但資料無法被讀取或 decode，顯示 image decode/read error，不退回文字 editor。

### D4. SVG 預設 split

`.svg` 開啟時：

1. 左側開一般 `file` tab，走現有 `read_text_file` 與 editor 流程。
2. 右側開 media viewer tab，走新的 media API。
3. Workbench 設定 split，使 editor 在主區、viewer 在 side 區。

如果 SVG text read 失敗但 media read 成功，仍開 viewer，並以 toast 說明 editor 無法開啟。若 media read 失敗但 text read 成功，保留 editor 並顯示錯誤 toast。

### D5. Image viewer UI 採 A+C

第一版 UI 採「compact header + bottom metadata strip」，並加上可展開的 info overlay：

- Header: breadcrumb, filename, Fit, 100%, Zoom in/out, Open External, Reveal in Finder, Info。
- Canvas: 圖片置中，預設 fit-to-view，支援 100% 原始尺寸。
- Metadata strip: format, dimensions, byte size, modified time。
- Info overlay: full path, mime, byte size, dimensions, version/modified time。

第一版不做 drag pan。若 zoom 造成圖片超出視窗，以 scroll container 處理。

## 6. Data Flow

`openFile(displayPath, reveal?)` 仍是唯一入口。Explorer、Palette、Search 不需要各自知道 media 細節。

Suggested flow:

1. Controller 收到 `openFile(displayPath, reveal?)`。
2. Controller 根據 extension/classifier 決定路徑：
   - text: existing `readTextFile` flow。
   - bitmap image: create media tab, call `readMediaFile`。
   - svg: create/open file tab, create/open media tab, enable split。
   - unsupported binary: create media tab with `kind: "unsupported"`。
3. Rust media API 回傳 payload 後 patch tab。
4. UI 根據 tab type/payload render image viewer 或 unsupported viewer。

Frontend media payload shape is `MediaFilePayload`:

```ts
type MediaFilePayload = {
  kind: "image" | "unsupported";
  mime: string;
  format: string;
  dataUrl?: string;
  byteSize: number;
  dimensions?: { width: number; height: number } | null;
  version: { modified_ms: number; len: number };
  tooLarge?: boolean;
  error?: string;
};
```

Rust response shape is `MediaFileRead` and must serialize to this payload contract.

## 7. Error Handling And Safety

- Path safety: media API uses the same trusted workspace root validation pattern as `read_text_file`.
- Size limit: first version uses a bounded read limit. Recommended initial cap is 10 MiB for image data URL payloads.
- Too large: if file exceeds limit, open a too-large media viewer with metadata only.
- Decode failure: show image decode error. Do not fallback to text editor except the explicit SVG split editor.
- SVG safety: render SVG through image loading, not `dangerouslySetInnerHTML`; do not execute SVG scripts.
- Metadata failure: open viewer with `dimensions: unknown` when dimensions cannot be determined.
- File watcher: media tab may show changed-on-disk state and provide reload, but not overwrite/save.
- Cmd+S: only editable `file` tabs save.
- LSP/backup: media tabs do not call LSP open/change/close and do not save unsaved backups.

## 8. Testing And Verification

### Rust focused tests

- `read_media_file` rejects paths outside the workspace.
- `read_media_file` rejects directories.
- oversized media files return too-large metadata without returning full payload.
- supported extensions map to the expected mime/format.
- invalid image bytes return a decode/read error.
- SVG is classified as image but remains compatible with the text read path.

### Frontend tests

- Bitmap image opens a media tab and does not create dirty/save/LSP state.
- SVG opens a file tab plus media tab and sets split.
- Unsupported binary opens unsupported viewer.
- Re-opening an existing media tab activates it rather than duplicating it.
- `Cmd+S` saves only editable file tabs, not media tabs.
- Image viewer renders toolbar, metadata strip, and info overlay.
- Unsupported viewer renders a clear unsupported message.

### Manual smoke

- Open local `png`, `jpg`, and `svg` files in a real workspace.
- Confirm image rendering, fit/100% behavior, metadata, info overlay, and SVG split.
- Open a fake binary and an oversized file to confirm unsupported/too-large behavior.

## 9. Acceptance Criteria

- Common images open from Explorer/Palette into a read-only viewer.
- Image viewer shows metadata and basic zoom/fit controls.
- SVG opens split with editor left and image viewer right.
- Unsupported binary files show a read-only unsupported surface.
- Media tabs cannot be saved and do not trigger LSP or unsaved-backup work.
- Workspace path safety and size limits are covered by Rust tests.
- Focused frontend tests cover tab creation, split behavior, and save exclusion.

## 10. Implementation Notes For Planning

- Keep changes surgical: file classification belongs near the controller/open-file boundary; binary read/security belongs in Rust file-system command code.
- Prefer a focused media model/API file under `src/features/files/` or a new small `src/features/media/` only if it avoids bloating existing file APIs.
- Keep UI CSS in `src/v2/yuzu.css`, matching the existing compact v2 visual language.
- Do not mark roadmap work complete as part of this feature unless explicitly requested after implementation and verification.
