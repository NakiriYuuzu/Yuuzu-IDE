# Media Binary Image Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only media tab architecture that opens common workspace images, shows metadata, opens SVG as editor-plus-viewer split, and keeps media out of editor save/LSP/backup flows.

**Architecture:** Rust owns trusted workspace path checks, bounded media reads, MIME/format classification, base64 data URLs, metadata, and external open/reveal commands. TypeScript keeps media contracts in `src/features/files/media-model.ts`, exposes IPC wrappers from `src/features/files/file-api.ts`, routes open-file decisions in `src/v2/controller.ts`, and renders media tabs through `src/v2/ContentViews.tsx`. The existing `openFile(displayPath, reveal?)` store/delegate entry remains the only frontend entry point.

**Tech Stack:** Tauri 2, Rust 2021, serde, base64 0.22, React 19, TypeScript 6, Bun test, Happy DOM, Cargo tests.

---

## Task Class And Scope

Task class: `feature`

In scope:

- Local workspace image/media open flow for `png`, `jpg`, `jpeg`, `gif`, `webp`, and `svg`.
- Unsupported local binary viewer for known binary extensions and invalid UTF-8 fallback.
- SVG split behavior: source editor left, image viewer right.
- Metadata strip, info overlay, zoom fit/100%, reload on changed media, open external, reveal in file manager.
- Focused Rust, TypeScript model, controller, UI, and watcher tests.

Out of scope:

- Remote/SFTP media preview.
- PDF, video, audio, or hex renderer.
- Image editing, annotation, thumbnail gallery, rotation, crop, drag pan.
- Roadmap completion status edits.
- Broad refactors of editor, Explorer, Palette, or Search.

Dirty worktree guard:

- Before starting execution, run `git status --short --branch`.
- Do not stage or commit existing deletions/untracked files outside this plan.
- This plan assumes execution starts from the current repo with possible user-owned dirty files. Use path-scoped `git add` in every commit step.

## File Structure

- Modify `src-tauri/src/file_system.rs`: add `MediaFileRead`, image classification, bounded media read, dimension helpers, and external open/reveal command helpers.
- Modify `src-tauri/src/commands.rs`: add Tauri commands `read_media_file`, `open_external_file`, and `reveal_file`.
- Modify `src-tauri/src/lib.rs`: register the new commands.
- Create `src/features/files/media-model.ts`: frontend media payload types and pure path classifiers.
- Create `src/features/files/media-model.test.ts`: focused tests for path classification.
- Modify `src/features/files/file-api.ts`: add IPC wrappers and exported media/action types.
- Modify `src/v2/v2-model.ts`: add `media` tab kind and media payload field.
- Modify `src/v2/file-watch.ts` and `src/v2/file-watch.test.ts`: mark media tabs changed on disk using the same version/path matching as file tabs.
- Modify `src/v2/TabStrip.tsx` and `src/v2/TabStrip.test.tsx`: render media/binary chips and preserve existing tab behavior.
- Modify `src/v2/controller.ts`: route image/SVG/unsupported binary open flows, load media payloads, reload media tabs, and exclude media from LSP/backup.
- Modify `src/v2/folder-expand.test.ts`: add real-controller tests using the existing mocked Tauri invoke harness.
- Modify `src/v2/ContentViews.tsx`: add `MediaView`, wire main and split rendering, metadata overlay, zoom controls, reload chip, and external/reveal buttons.
- Modify `src/v2/ContentViews.test.tsx`: add image viewer and unsupported viewer render tests.
- Modify `src/v2/Workbench.tsx`: add one `at.type === "media"` branch in main content routing.
- Modify `src/v2/yuzu.css`: add compact media viewer styles matching v2 visual language.

## Verification Plan

Focused verification:

```bash
bun test src/features/files/media-model.test.ts src/v2/file-watch.test.ts src/v2/TabStrip.test.tsx src/v2/ContentViews.test.tsx src/v2/folder-expand.test.ts
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml media
```

Broader verification after all tasks:

```bash
bun test src/v2 src/features/files
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
git diff --check
```

Runtime smoke:

```bash
bun run tauri build --debug --bundles app
```

Then open the debug app, open a workspace containing `png`, `jpg`, `svg`, a fake binary, and a file above the media size limit. Verify image render, metadata, SVG split, unsupported/too-large viewer, reload on external change, open external, and reveal in file manager.

Skipped gates:

- Full release gate is not required unless replacing an installed app bundle.
- `bun run verify:editor-large-file` is not required unless implementation touches CodeMirror/editor scrolling behavior beyond SVG source opening.

Success criteria:

- Common image files open into `type: "media"` tabs with image preview and metadata.
- SVG opens a source editor as active tab and a media viewer as split tab.
- Unsupported binary files open into a media tab with `kind: "unsupported"`.
- Media tabs do not save, do not call LSP, and do not create unsaved backups.
- Rust tests prove path safety and size bounding.

---

### Task 1: Rust Media Read API

**Files:**
- Modify: `src-tauri/src/file_system.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add failing Rust media tests**

Append these tests inside the existing `#[cfg(test)] mod tests` in `src-tauri/src/file_system.rs`.

```rust
    fn one_pixel_png() -> Vec<u8> {
        vec![
            0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x0d, b'I', b'H', b'D', b'R',
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00,
        ]
    }

    #[test]
    fn read_media_file_returns_png_payload() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("image.png");
        fs::write(&file, one_pixel_png()).expect("write png");

        let result = super::read_media_file(root.path(), &file, 1024).expect("read media");

        assert_eq!(result.kind, "image");
        assert_eq!(result.mime, "image/png");
        assert_eq!(result.format, "png");
        assert_eq!(result.byte_size, 29);
        assert_eq!(result.dimensions, Some(super::MediaDimensions { width: 1, height: 1 }));
        assert!(result.data_url.as_deref().unwrap_or("").starts_with("data:image/png;base64,"));
        assert!(!result.too_large);
        assert_eq!(result.error, None);
    }

    #[test]
    fn read_media_file_rejects_path_outside_workspace() {
        let root = tempdir().expect("tempdir");
        let outside = tempdir().expect("outside");
        let file = outside.path().join("image.png");
        fs::write(&file, one_pixel_png()).expect("write png");

        let result = super::read_media_file(root.path(), &file, 1024);

        assert!(result.unwrap_err().contains("outside workspace"));
    }

    #[test]
    fn read_media_file_rejects_directories() {
        let root = tempdir().expect("tempdir");
        let dir = root.path().join("assets");
        fs::create_dir(&dir).expect("create dir");

        let result = super::read_media_file(root.path(), &dir, 1024);

        assert!(result.unwrap_err().contains("not a regular file"));
    }

    #[test]
    fn read_media_file_marks_large_images_without_data_url() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("large.png");
        fs::write(&file, one_pixel_png()).expect("write png");

        let result = super::read_media_file(root.path(), &file, 4).expect("read media");

        assert_eq!(result.kind, "image");
        assert!(result.too_large);
        assert_eq!(result.data_url, None);
        assert_eq!(result.byte_size, 29);
    }

    #[test]
    fn read_media_file_reports_invalid_image_bytes() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("broken.png");
        fs::write(&file, b"not a png").expect("write broken image");

        let result = super::read_media_file(root.path(), &file, 1024).expect("read media");

        assert_eq!(result.kind, "image");
        assert_eq!(result.mime, "image/png");
        assert_eq!(result.data_url, None);
        assert_eq!(result.dimensions, None);
        assert_eq!(result.error.as_deref(), Some("image could not be decoded"));
    }

    #[test]
    fn read_media_file_classifies_unsupported_binary() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("archive.zip");
        fs::write(&file, [0, 1, 2, 3, 4]).expect("write binary");

        let result = super::read_media_file(root.path(), &file, 1024).expect("read media");

        assert_eq!(result.kind, "unsupported");
        assert_eq!(result.mime, "application/octet-stream");
        assert_eq!(result.format, "zip");
        assert_eq!(result.data_url, None);
        assert_eq!(result.byte_size, 5);
    }

    #[test]
    fn read_media_file_reads_svg_dimensions_from_attrs() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("icon.svg");
        fs::write(&file, r#"<svg width="32" height="18" xmlns="http://www.w3.org/2000/svg"></svg>"#)
            .expect("write svg");

        let result = super::read_media_file(root.path(), &file, 1024).expect("read media");

        assert_eq!(result.kind, "image");
        assert_eq!(result.mime, "image/svg+xml");
        assert_eq!(result.format, "svg");
        assert_eq!(result.dimensions, Some(super::MediaDimensions { width: 32, height: 18 }));
        assert!(result.data_url.as_deref().unwrap_or("").starts_with("data:image/svg+xml;base64,"));
    }
```

- [ ] **Step 2: Run Rust tests to verify red**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml media_file
```

Expected: FAIL with errors like `cannot find function read_media_file` and `cannot find struct MediaDimensions`.

- [ ] **Step 3: Add media structs and helpers**

In `src-tauri/src/file_system.rs`, add this import near the top:

```rust
use base64::{engine::general_purpose, Engine as _};
```

Add these types and constants after `FileOperationResult`:

```rust
pub const MEDIA_FILE_LIMIT_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MediaDimensions {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MediaFileRead {
    pub path: PathBuf,
    pub kind: String,
    pub mime: String,
    pub format: String,
    pub data_url: Option<String>,
    pub byte_size: u64,
    pub dimensions: Option<MediaDimensions>,
    pub version: FileVersion,
    pub too_large: bool,
    pub error: Option<String>,
}
```

Add these helper functions before `read_text_file`:

```rust
fn media_format(path: &Path) -> (String, String, bool) {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => ("png".to_string(), "image/png".to_string(), true),
        "jpg" | "jpeg" => ("jpeg".to_string(), "image/jpeg".to_string(), true),
        "gif" => ("gif".to_string(), "image/gif".to_string(), true),
        "webp" => ("webp".to_string(), "image/webp".to_string(), true),
        "svg" => ("svg".to_string(), "image/svg+xml".to_string(), true),
        "" => ("binary".to_string(), "application/octet-stream".to_string(), false),
        other => (other.to_string(), "application/octet-stream".to_string(), false),
    }
}

fn be_u32(bytes: &[u8]) -> u32 {
    u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn le_u16(bytes: &[u8]) -> u32 {
    u16::from_le_bytes([bytes[0], bytes[1]]) as u32
}

fn png_dimensions(bytes: &[u8]) -> Option<MediaDimensions> {
    let signature = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if bytes.len() < 24 || bytes[..8] != signature {
        return None;
    }
    Some(MediaDimensions {
        width: be_u32(&bytes[16..20]),
        height: be_u32(&bytes[20..24]),
    })
}

fn gif_dimensions(bytes: &[u8]) -> Option<MediaDimensions> {
    if bytes.len() < 10 || !(bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        return None;
    }
    Some(MediaDimensions {
        width: le_u16(&bytes[6..8]),
        height: le_u16(&bytes[8..10]),
    })
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<MediaDimensions> {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }
    let mut i = 2usize;
    while i + 8 < bytes.len() {
        while i < bytes.len() && bytes[i] != 0xff {
            i += 1;
        }
        if i + 3 >= bytes.len() {
            return None;
        }
        let marker = bytes[i + 1];
        i += 2;
        if marker == 0xd8 || marker == 0xd9 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        if i + 2 > bytes.len() {
            return None;
        }
        let len = u16::from_be_bytes([bytes[i], bytes[i + 1]]) as usize;
        if len < 2 || i + len > bytes.len() {
            return None;
        }
        let is_sof = matches!(
            marker,
            0xc0 | 0xc1 | 0xc2 | 0xc3 | 0xc5 | 0xc6 | 0xc7 | 0xc9 | 0xca | 0xcb | 0xcd | 0xce | 0xcf
        );
        if is_sof && len >= 7 {
            return Some(MediaDimensions {
                height: u16::from_be_bytes([bytes[i + 3], bytes[i + 4]]) as u32,
                width: u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as u32,
            });
        }
        i += len;
    }
    None
}

fn parse_svg_number(value: &str) -> Option<u32> {
    let trimmed = value.trim();
    let number = trimmed
        .chars()
        .take_while(|ch| ch.is_ascii_digit() || *ch == '.')
        .collect::<String>();
    if number.is_empty() {
        return None;
    }
    number.parse::<f32>().ok().map(|value| value.round() as u32).filter(|value| *value > 0)
}

fn svg_attr(text: &str, name: &str) -> Option<u32> {
    let key = format!("{name}=");
    let idx = text.find(&key)? + key.len();
    let rest = &text[idx..];
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let end = rest[1..].find(quote)? + 1;
    parse_svg_number(&rest[1..end])
}

fn svg_dimensions(bytes: &[u8]) -> Option<MediaDimensions> {
    let text = std::str::from_utf8(bytes).ok()?;
    if !text.to_ascii_lowercase().contains("<svg") {
        return None;
    }
    if let (Some(width), Some(height)) = (svg_attr(text, "width"), svg_attr(text, "height")) {
        return Some(MediaDimensions { width, height });
    }
    let view_box_idx = text.find("viewBox=")?;
    let rest = &text[view_box_idx + "viewBox=".len()..];
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let end = rest[1..].find(quote)? + 1;
    let parts = rest[1..end]
        .split_whitespace()
        .filter_map(parse_svg_number)
        .collect::<Vec<_>>();
    if parts.len() == 4 {
        return Some(MediaDimensions { width: parts[2], height: parts[3] });
    }
    None
}

fn image_dimensions(format: &str, bytes: &[u8]) -> Option<MediaDimensions> {
    match format {
        "png" => png_dimensions(bytes),
        "jpeg" => jpeg_dimensions(bytes),
        "gif" => gif_dimensions(bytes),
        "svg" => svg_dimensions(bytes),
        _ => None,
    }
}

fn valid_image_bytes(format: &str, bytes: &[u8]) -> bool {
    match format {
        "png" => png_dimensions(bytes).is_some(),
        "jpeg" => bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] == 0xd8,
        "gif" => gif_dimensions(bytes).is_some(),
        "webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        "svg" => std::str::from_utf8(bytes)
            .map(|text| text.to_ascii_lowercase().contains("<svg"))
            .unwrap_or(false),
        _ => false,
    }
}
```

- [ ] **Step 4: Add `read_media_file` implementation**

Add this function after `read_text_file`:

```rust
pub fn read_media_file(
    workspace_root: &Path,
    path: &Path,
    max_bytes: u64,
) -> Result<MediaFileRead, String> {
    let path = workspace_child(workspace_root, path, PathResolution::CanonicalExisting)?;
    let metadata = fs::metadata(&path).map_err(|err| err.to_string())?;
    if !metadata.is_file() {
        return Err(format!("not a regular file: {}", path.display()));
    }

    let version = file_version(&path)?;
    let byte_size = metadata.len();
    let (format, mime, supported_image) = media_format(&path);
    let kind = if supported_image { "image" } else { "unsupported" }.to_string();

    if !supported_image {
        return Ok(MediaFileRead {
            path,
            kind,
            mime,
            format,
            data_url: None,
            byte_size,
            dimensions: None,
            version,
            too_large: false,
            error: None,
        });
    }

    if byte_size > max_bytes {
        return Ok(MediaFileRead {
            path,
            kind,
            mime,
            format,
            data_url: None,
            byte_size,
            dimensions: None,
            version,
            too_large: true,
            error: None,
        });
    }

    let bytes = fs::read(&path).map_err(|err| err.to_string())?;
    if !valid_image_bytes(&format, &bytes) {
        return Ok(MediaFileRead {
            path,
            kind,
            mime,
            format,
            data_url: None,
            byte_size,
            dimensions: None,
            version,
            too_large: false,
            error: Some("image could not be decoded".to_string()),
        });
    }

    let encoded = general_purpose::STANDARD.encode(&bytes);
    Ok(MediaFileRead {
        path,
        kind,
        data_url: Some(format!("data:{mime};base64,{encoded}")),
        dimensions: image_dimensions(&format, &bytes),
        mime,
        format,
        byte_size,
        version,
        too_large: false,
        error: None,
    })
}
```

- [ ] **Step 5: Add Tauri command wrapper**

Modify the import in `src-tauri/src/commands.rs`:

```rust
use crate::file_system::{self, FileOperationResult, FileVersion, MediaFileRead, TextFileRead};
```

Add this command after `read_text_file`:

```rust
#[tauri::command]
pub async fn read_media_file(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
) -> Result<MediaFileRead, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || {
        file_system::read_media_file(
            &workspace_root,
            Path::new(&path),
            file_system::MEDIA_FILE_LIMIT_BYTES,
        )
    })
    .await
}
```

Register it in `src-tauri/src/lib.rs` next to `read_text_file`:

```rust
commands::read_text_file,
commands::read_media_file,
commands::write_text_file,
```

- [ ] **Step 6: Run focused Rust tests**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml media_file
```

Expected: PASS for all `read_media_file_*` tests.

- [ ] **Step 7: Commit Rust media API**

```bash
git add src-tauri/src/file_system.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add bounded media file reader"
```

---

### Task 2: Frontend Media Model, API, And Tab Type

**Files:**
- Create: `src/features/files/media-model.ts`
- Create: `src/features/files/media-model.test.ts`
- Modify: `src/features/files/file-api.ts`
- Modify: `src/v2/v2-model.ts`
- Modify: `src/v2/file-watch.ts`
- Modify: `src/v2/file-watch.test.ts`
- Modify: `src/v2/TabStrip.tsx`
- Modify: `src/v2/TabStrip.test.tsx`

- [ ] **Step 1: Add media model tests**

Create `src/features/files/media-model.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  binaryPreviewKindForPath,
  isSupportedImagePath,
  isSvgPath,
  mediaExtension,
} from "./media-model";

describe("media-model", () => {
  test("detects supported images", () => {
    expect(isSupportedImagePath("assets/banner.PNG")).toBe(true);
    expect(isSupportedImagePath("photo.jpeg")).toBe(true);
    expect(isSupportedImagePath("anim.gif")).toBe(true);
    expect(isSupportedImagePath("icon.svg")).toBe(true);
    expect(isSupportedImagePath("README.md")).toBe(false);
  });

  test("detects svg separately for split behavior", () => {
    expect(isSvgPath("assets/icon.svg")).toBe(true);
    expect(isSvgPath("assets/icon.SVG")).toBe(true);
    expect(isSvgPath("assets/icon.png")).toBe(false);
  });

  test("classifies known unsupported binary extensions", () => {
    expect(binaryPreviewKindForPath("archive.zip")).toBe("unsupported");
    expect(binaryPreviewKindForPath("debug.wasm")).toBe("unsupported");
    expect(binaryPreviewKindForPath("clip.mp4")).toBe("unsupported");
    expect(binaryPreviewKindForPath("src/main.ts")).toBe("text");
  });

  test("extracts lowercase extension without query-like suffixes", () => {
    expect(mediaExtension("ASSETS/Hero.WEBP")).toBe("webp");
    expect(mediaExtension("README")).toBe("");
  });
});
```

- [ ] **Step 2: Run media model test to verify red**

Run:

```bash
bun test src/features/files/media-model.test.ts
```

Expected: FAIL with `Cannot find module './media-model'`.

- [ ] **Step 3: Create frontend media model**

Create `src/features/files/media-model.ts`:

```ts
import type { FileVersion } from "./file-model";

export type MediaFileKind = "image" | "unsupported";

export type MediaDimensions = {
  width: number;
  height: number;
};

export type MediaFilePayload = {
  path: string;
  kind: MediaFileKind;
  mime: string;
  format: string;
  data_url: string | null;
  byte_size: number;
  dimensions: MediaDimensions | null;
  version: FileVersion;
  too_large: boolean;
  error: string | null;
};

export type BinaryPreviewKind = "image" | "unsupported" | "text";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const UNSUPPORTED_BINARY_EXTENSIONS = new Set([
  "pdf", "zip", "tar", "gz", "tgz", "7z", "rar",
  "wasm", "exe", "dll", "dylib", "so",
  "mp4", "mov", "webm", "mp3", "wav", "ogg",
  "ico", "icns", "avif", "heic",
]);

export function mediaExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isSvgPath(path: string): boolean {
  return mediaExtension(path) === "svg";
}

export function isSupportedImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(mediaExtension(path));
}

export function binaryPreviewKindForPath(path: string): BinaryPreviewKind {
  const ext = mediaExtension(path);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (UNSUPPORTED_BINARY_EXTENSIONS.has(ext)) return "unsupported";
  return "text";
}
```

- [ ] **Step 4: Add media IPC wrapper**

Modify `src/features/files/file-api.ts`:

```ts
import type { MediaFilePayload } from "./media-model";
```

Add this function after `readTextFile`:

```ts
export function readMediaFile(
  workspaceRoot: string,
  path: string,
): Promise<MediaFilePayload> {
  return call<MediaFilePayload>("read_media_file", { workspaceRoot, path });
}
```

Add these action wrappers near the other file operations; Task 4 adds their Rust commands:

```ts
export function openExternalFile(
  workspaceRoot: string,
  path: string,
): Promise<void> {
  return call<void>("open_external_file", { workspaceRoot, path });
}

export function revealFile(
  workspaceRoot: string,
  path: string,
): Promise<void> {
  return call<void>("reveal_file", { workspaceRoot, path });
}
```

- [ ] **Step 5: Add media tab type**

Modify `src/v2/v2-model.ts`:

```ts
import type { MediaFilePayload } from "../features/files/media-model"
```

Change `TabKind`:

```ts
export type TabKind = "file" | "media" | "cmd" | "browser" | "git" | "db" | "sftp" | "diff" | "conflict"
```

Add this field to `Tab` near the real-backend fields:

```ts
    media?: MediaFilePayload
```

- [ ] **Step 6: Let watcher mark media tabs**

Modify `src/v2/file-watch.ts`:

```ts
function fileTabDiskPath(tab: Tab): string | null {
    if (tab.type !== "file" && tab.type !== "media") return null
    return tab.realPath ?? tab.path ?? null
}
```

Add this test to `src/v2/file-watch.test.ts` inside `describe("externallyChangedTabIds", ...)`:

```ts
    test("flags media tabs whose version changed", () => {
        const tabs = [{ id: 9, type: "media", realPath: "/r/image.png", version: v(1, 10) } as Tab]
        expect(externallyChangedTabIds(tabs, "/r/image.png", v(2, 10))).toEqual([9])
    })
```

- [ ] **Step 7: Add media tab glyph**

Modify `src/v2/TabStrip.tsx` in `tabGlyph`:

```tsx
    if (t.type === "media") {
        if (t.media?.kind === "unsupported") {
            return { glyph: "bin", style: { background: "var(--yz-2a1d10)", color: "var(--yz-ffcb6b)" }, isChip: true }
        }
        return { glyph: "img", style: { background: "var(--yz-221530)", color: "var(--yz-c792ea)" }, isChip: true }
    }
```

Modify the tab title render line:

```tsx
{t.type === "file" || t.type === "media" ? t.name : t.title}
```

Add this test to `src/v2/TabStrip.test.tsx`:

```tsx
    test("renders media tabs with an image chip and title", () => {
        act(() => {
            v2Store.setState((s) => ({
                ui: {
                    ...s.ui,
                    api: {
                        ...s.ui.api,
                        activeTab: 9100,
                        tabs: [{
                            id: 9100,
                            type: "media" as const,
                            name: "hero.png",
                            path: "assets/hero.png",
                            realPath: "/workspace/assets/hero.png",
                            media: {
                                path: "/workspace/assets/hero.png",
                                kind: "image",
                                mime: "image/png",
                                format: "png",
                                data_url: "data:image/png;base64,abc",
                                byte_size: 3,
                                dimensions: { width: 1, height: 1 },
                                version: { modified_ms: 1, len: 3 },
                                too_large: false,
                                error: null,
                            },
                        }],
                    },
                },
            }))
        })

        const view = render(<TabStrip />)

        expect(view.getByText("hero.png")).toBeTruthy()
        expect(view.getByText("img")).toBeTruthy()
    })
```

- [ ] **Step 8: Run frontend focused tests**

Run:

```bash
bun test src/features/files/media-model.test.ts src/v2/file-watch.test.ts src/v2/TabStrip.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit frontend media model**

```bash
git add src/features/files/media-model.ts src/features/files/media-model.test.ts src/features/files/file-api.ts src/v2/v2-model.ts src/v2/file-watch.ts src/v2/file-watch.test.ts src/v2/TabStrip.tsx src/v2/TabStrip.test.tsx
git commit -m "feat: add media tab model"
```

---

### Task 3: Controller Open Routing

**Files:**
- Modify: `src/v2/controller.ts`
- Modify: `src/v2/folder-expand.test.ts`

- [ ] **Step 1: Extend mocked Tauri API for media**

In `src/v2/folder-expand.test.ts`, add arrays near the existing call trackers:

```ts
const mediaReadCalls: any[] = []
let readTextThrowsInvalidUtf8 = false
```

Inside the mocked `invoke`, update the `read_text_file` branch:

```ts
        if (cmd === "read_text_file") {
            if (readTextThrowsInvalidUtf8) throw "invalid utf-8 sequence"
            return { path: args.path, content: "disk", version: VERSION, too_large: false }
        }
```

Add this branch:

```ts
        if (cmd === "read_media_file") {
            mediaReadCalls.push(args)
            const path = String(args.path)
            if (path.endsWith(".png")) {
                return {
                    path,
                    kind: "image",
                    mime: "image/png",
                    format: "png",
                    data_url: "data:image/png;base64,abc",
                    byte_size: 3,
                    dimensions: { width: 1, height: 1 },
                    version: VERSION,
                    too_large: false,
                    error: null,
                }
            }
            if (path.endsWith(".svg")) {
                return {
                    path,
                    kind: "image",
                    mime: "image/svg+xml",
                    format: "svg",
                    data_url: "data:image/svg+xml;base64,abc",
                    byte_size: 40,
                    dimensions: { width: 32, height: 18 },
                    version: VERSION,
                    too_large: false,
                    error: null,
                }
            }
            return {
                path,
                kind: "unsupported",
                mime: "application/octet-stream",
                format: path.split(".").pop() ?? "binary",
                data_url: null,
                byte_size: 5,
                dimensions: null,
                version: VERSION,
                too_large: false,
                error: null,
            }
        }
```

In `ensureMockWorkspace`, reset the new state:

```ts
    mediaReadCalls.length = 0
    readTextThrowsInvalidUtf8 = false
```

- [ ] **Step 2: Add failing controller tests**

Append these tests to `src/v2/folder-expand.test.ts`:

```ts
    test("opening a bitmap image creates a media tab without opening LSP", async () => {
        await ensureMockWorkspace()

        lspCalls.length = 0
        v2Store.getState().openFile("assets/hero.png")

        await waitFor(() => Boolean(v2Store.getState().ui.demo.tabs.find((t) => t.type === "media" && t.path === "assets/hero.png")?.media))
        const tab = v2Store.getState().ui.demo.tabs.find((t) => t.type === "media" && t.path === "assets/hero.png")!

        expect(tab.media?.kind).toBe("image")
        expect(tab.media?.mime).toBe("image/png")
        expect(tab.content).toBeUndefined()
        expect(mediaReadCalls).toEqual([{ workspaceRoot: ROOT, path: "assets/hero.png" }])
        expect(lspCalls.some((call) => call.cmd === "lsp_open_document")).toBe(false)
    })

    test("opening svg creates editor tab plus media split", async () => {
        await ensureMockWorkspace()

        v2Store.getState().openFile("assets/icon.svg")

        await waitFor(() => {
            const p = v2Store.getState().ui.demo
            return Boolean(
                p.tabs.find((t) => t.type === "file" && t.path === "assets/icon.svg")?.content &&
                p.tabs.find((t) => t.type === "media" && t.path === "assets/icon.svg")?.media
            )
        })
        const p = v2Store.getState().ui.demo
        const file = p.tabs.find((t) => t.type === "file" && t.path === "assets/icon.svg")!
        const media = p.tabs.find((t) => t.type === "media" && t.path === "assets/icon.svg")!

        expect(p.activeTab).toBe(file.id)
        expect(p.split).toBe(media.id)
        expect(media.media?.mime).toBe("image/svg+xml")
    })

    test("opening known binary creates unsupported media tab", async () => {
        await ensureMockWorkspace()

        v2Store.getState().openFile("dist/app.wasm")

        await waitFor(() => Boolean(v2Store.getState().ui.demo.tabs.find((t) => t.type === "media" && t.path === "dist/app.wasm")?.media))
        const tab = v2Store.getState().ui.demo.tabs.find((t) => t.type === "media" && t.path === "dist/app.wasm")!

        expect(tab.media?.kind).toBe("unsupported")
        expect(tab.media?.data_url).toBeNull()
    })

    test("invalid utf8 text read falls back to unsupported media tab", async () => {
        await ensureMockWorkspace()
        readTextThrowsInvalidUtf8 = true

        v2Store.getState().openFile("data/blob.bin")

        await waitFor(() => Boolean(v2Store.getState().ui.demo.tabs.find((t) => t.type === "media" && t.path === "data/blob.bin")?.media))
        const tab = v2Store.getState().ui.demo.tabs.find((t) => t.type === "media" && t.path === "data/blob.bin")!

        expect(tab.media?.kind).toBe("unsupported")
        expect(v2Store.getState().ui.demo.tabs.find((t) => t.type === "file" && t.path === "data/blob.bin")).toBeUndefined()
    })
```

- [ ] **Step 3: Run controller tests to verify red**

Run:

```bash
bun test src/v2/folder-expand.test.ts
```

Expected: FAIL because controller still creates only `file` tabs and never calls `read_media_file`.

- [ ] **Step 4: Import media API and classifiers**

Modify imports in `src/v2/controller.ts`:

```ts
import { binaryPreviewKindForPath, isSvgPath } from "../features/files/media-model"
import { createDirectory, createTextFile, deletePath, readMediaFile, readTextFile, writeTextFile } from "../features/files/file-api"
```

Replace the existing file-api import with the combined import above.

- [ ] **Step 5: Add controller helpers**

Add these helpers near `tabId()`:

```ts
function mediaTabTitle(name: string): string {
    return name || "media"
}

function isInvalidUtf8Error(error: unknown): boolean {
    return errMsg(error).toLowerCase().includes("utf-8") || errMsg(error).toLowerCase().includes("utf8")
}

function existingMediaTab(project: ProjectUI, displayPath: string): Tab | undefined {
    return project.tabs.find((t) => t.type === "media" && t.path === displayPath)
}

function existingFileTab(project: ProjectUI, displayPath: string): Tab | undefined {
    return project.tabs.find((t) => t.type === "file" && t.path === displayPath)
}
```

Add this async loader:

```ts
async function loadMediaTab(pid: string, root: string, id: number, realPath: string, displayPath: string): Promise<void> {
    try {
        const media = await readMediaFile(root, realPath)
        patchTab(pid, id, (t) => ({
            ...t,
            loading: false,
            media,
            version: media.version,
            externalChange: false,
        }))
        logDiag("info", "media", "opened " + displayPath)
    } catch (error) {
        patchTab(pid, id, (t) => ({
            ...t,
            loading: false,
            media: {
                path: realPath,
                kind: "unsupported",
                mime: "application/octet-stream",
                format: "binary",
                data_url: null,
                byte_size: 0,
                dimensions: null,
                version: t.version ?? { modified_ms: 0, len: 0 },
                too_large: false,
                error: errMsg(error),
            },
        }))
        store().showToast("Open media: " + errMsg(error))
        logDiag("error", "media", "open failed " + errMsg(error))
    }
}
```

Add this media opener:

```ts
function openMediaTab(pid: string, root: string, displayPath: string, realPath: string, activate: boolean, split: boolean): number {
    const p = store().ui[pid]
    const existing = p ? existingMediaTab(p, displayPath) : undefined
    if (existing) {
        patchProject(pid, (q) => {
            if (activate) q.activeTab = existing.id
            if (split) q.split = existing.id
        })
        return existing.id
    }

    const id = tabId()
    const name = displayPath.split("/").pop() ?? displayPath
    patchProject(pid, (q) => {
        q.tabs = [
            ...q.tabs,
            {
                id,
                type: "media",
                title: mediaTabTitle(name),
                name,
                path: displayPath,
                realPath,
                loading: true,
            },
        ]
        if (activate) q.activeTab = id
        if (split) q.split = id
    })
    void loadMediaTab(pid, root, id, realPath, displayPath)
    return id
}
```

- [ ] **Step 6: Refactor text opening into helper**

Move the existing body of `openFile` text-tab creation into this helper near `openMediaTab`:

```ts
function openTextTab(pid: string, root: string, displayPath: string, realPath: string, reveal?: { line: number; col: number }): number {
    const p = store().ui[pid]
    const existing = p ? existingFileTab(p, displayPath) : undefined
    if (existing) {
        patchProject(pid, (q) => {
            q.activeTab = existing.id
            if (reveal) q.tabs = q.tabs.map((t) => (t.id === existing.id ? { ...t, reveal } : t))
        })
        return existing.id
    }

    const name = displayPath.split("/").pop() ?? displayPath
    const id = tabId()
    patchProject(pid, (q) => {
        q.tabs = [
            ...q.tabs,
            {
                id,
                type: "file",
                name,
                path: displayPath,
                realPath,
                loading: true,
                contentLang: langForPath(name),
                ...(reveal ? { reveal } : {}),
            },
        ]
        q.activeTab = id
    })

    void (async () => {
        try {
            const read = await readTextFile(root, realPath)
            patchProject(pid, (q) => {
                q.tabs = q.tabs.map((t) =>
                    t.id === id
                        ? { ...t, loading: false, content: read.content, tooLarge: read.too_large, version: read.version, savedContent: read.content }
                        : t,
                )
            })
            if (typeof read.content === "string" && isLspSupportedDocumentPath(displayPath)) {
                void openLspDocument(pid, displayPath, read.content).catch(() => {})
            }
            logDiag("info", "editor", "opened " + displayPath)
        } catch (error) {
            if (isInvalidUtf8Error(error)) {
                patchProject(pid, (q) => {
                    q.tabs = q.tabs.filter((t) => t.id !== id)
                    if (q.activeTab === id) q.activeTab = null
                })
                openMediaTab(pid, root, displayPath, realPath, true, false)
                return
            }
            patchProject(pid, (q) => {
                q.tabs = q.tabs.map((t) => (t.id === id ? { ...t, loading: false, content: null } : t))
            })
            store().showToast("Open file: " + errMsg(error))
            logDiag("error", "editor", "open failed " + errMsg(error))
        }
    })()
    return id
}
```

- [ ] **Step 7: Route `openFile` through classifiers**

Replace the body of delegate `openFile(displayPath, reveal?)` in `src/v2/controller.ts` with:

```ts
    openFile(displayPath: string, reveal?: { line: number; col: number }) {
        const pid = store().active
        const root = rootOf(pid)
        const p = store().ui[pid]
        if (!root || !p) return
        const node = findNode(p.treeData, displayPath)
        const realPath = node?.p ?? displayPath
        const kind = binaryPreviewKindForPath(displayPath)

        if (isSvgPath(displayPath)) {
            const fileId = openTextTab(pid, root, displayPath, realPath, reveal)
            openMediaTab(pid, root, displayPath, realPath, false, true)
            patchProject(pid, (q) => {
                q.activeTab = fileId
            })
            return
        }

        if (kind === "image" || kind === "unsupported") {
            openMediaTab(pid, root, displayPath, realPath, true, false)
            return
        }

        openTextTab(pid, root, displayPath, realPath, reveal)
    },
```

- [ ] **Step 8: Run focused controller tests**

Run:

```bash
bun test src/v2/folder-expand.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit controller routing**

```bash
git add src/v2/controller.ts src/v2/folder-expand.test.ts
git commit -m "feat: route media file opens"
```

---

### Task 4: External Open And Reveal Commands

**Files:**
- Modify: `src-tauri/src/file_system.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/features/files/file-api.ts`

- [ ] **Step 1: Add Rust tests for command builders**

Append these tests inside `src-tauri/src/file_system.rs` test module:

```rust
    #[test]
    fn external_open_command_targets_file() {
        let path = Path::new("/tmp/image.png");
        let command = super::external_open_command(path);

        assert!(!command.program.is_empty());
        assert!(command.args.iter().any(|arg| arg.contains("image.png")));
    }

    #[test]
    fn reveal_command_targets_file_or_parent() {
        let path = Path::new("/tmp/image.png");
        let command = super::reveal_command(path);

        assert!(!command.program.is_empty());
        assert!(!command.args.is_empty());
    }
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml external_open_command reveal_command
```

Expected: FAIL because the command builders do not exist.

- [ ] **Step 3: Add external command helpers**

Add this struct and helpers to `src-tauri/src/file_system.rs` near the media helpers:

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SystemCommand {
    pub program: String,
    pub args: Vec<String>,
}

pub fn external_open_command(path: &Path) -> SystemCommand {
    #[cfg(target_os = "macos")]
    {
        return SystemCommand {
            program: "/usr/bin/open".to_string(),
            args: vec![path.to_string_lossy().to_string()],
        };
    }
    #[cfg(target_os = "windows")]
    {
        return SystemCommand {
            program: "cmd".to_string(),
            args: vec!["/C".to_string(), "start".to_string(), "".to_string(), path.to_string_lossy().to_string()],
        };
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        return SystemCommand {
            program: "xdg-open".to_string(),
            args: vec![path.to_string_lossy().to_string()],
        };
    }
}

pub fn reveal_command(path: &Path) -> SystemCommand {
    #[cfg(target_os = "macos")]
    {
        return SystemCommand {
            program: "/usr/bin/open".to_string(),
            args: vec!["-R".to_string(), path.to_string_lossy().to_string()],
        };
    }
    #[cfg(target_os = "windows")]
    {
        return SystemCommand {
            program: "explorer".to_string(),
            args: vec![format!("/select,{}", path.to_string_lossy())],
        };
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let parent = path.parent().unwrap_or(path);
        return SystemCommand {
            program: "xdg-open".to_string(),
            args: vec![parent.to_string_lossy().to_string()],
        };
    }
}

fn run_system_command(command: SystemCommand) -> Result<(), String> {
    let status = std::process::Command::new(&command.program)
        .args(&command.args)
        .status()
        .map_err(|err| err.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("system command failed: {}", command.program))
    }
}

pub fn open_external_file(workspace_root: &Path, path: &Path) -> Result<(), String> {
    let path = workspace_child_for_existing_file(workspace_root, path)?;
    run_system_command(external_open_command(&path))
}

pub fn reveal_file(workspace_root: &Path, path: &Path) -> Result<(), String> {
    let path = workspace_child_for_existing_file(workspace_root, path)?;
    run_system_command(reveal_command(&path))
}
```

Update the `use std::{ ... }` import only if needed; the code uses `std::process::Command` fully qualified, so no new import is required.

- [ ] **Step 4: Add Tauri commands and registration**

Add these commands to `src-tauri/src/commands.rs` after `delete_path`:

```rust
#[tauri::command]
pub async fn open_external_file(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
) -> Result<(), String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || file_system::open_external_file(&workspace_root, Path::new(&path))).await
}

#[tauri::command]
pub async fn reveal_file(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
) -> Result<(), String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || file_system::reveal_file(&workspace_root, Path::new(&path))).await
}
```

Register them in `src-tauri/src/lib.rs` after `delete_path`:

```rust
commands::delete_path,
commands::open_external_file,
commands::reveal_file
```

The TypeScript wrappers were added in Task 2. Confirm `src/features/files/file-api.ts` contains `openExternalFile` and `revealFile`.

- [ ] **Step 5: Run focused Rust tests**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml external_open_command reveal_command
```

Expected: PASS.

- [ ] **Step 6: Commit external/reveal commands**

```bash
git add src-tauri/src/file_system.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/features/files/file-api.ts
git commit -m "feat: add media file external actions"
```

---

### Task 5: Media Viewer UI

**Files:**
- Modify: `src/v2/ContentViews.tsx`
- Modify: `src/v2/Workbench.tsx`
- Modify: `src/v2/ContentViews.test.tsx`
- Modify: `src/v2/yuzu.css`

- [ ] **Step 1: Add failing UI tests**

Modify the import in `src/v2/ContentViews.test.tsx`:

```tsx
import { BrowserView, EditorView, MediaView } from "./ContentViews"
```

Add these tests near the `EditorView` describe block:

```tsx
describe("MediaView", () => {
    test("renders image viewer toolbar metadata and info overlay", () => {
        const tab: Tab = {
            id: 9201,
            type: "media",
            name: "hero.png",
            path: "assets/hero.png",
            realPath: "/workspace/assets/hero.png",
            media: {
                path: "/workspace/assets/hero.png",
                kind: "image",
                mime: "image/png",
                format: "png",
                data_url: "data:image/png;base64,abc",
                byte_size: 3,
                dimensions: { width: 1, height: 1 },
                version: { modified_ms: 1, len: 3 },
                too_large: false,
                error: null,
            },
        }
        const view = render(<MediaView tab={tab} />)

        expect(view.getByAltText("hero.png")).toBeTruthy()
        expect(view.getByText("PNG")).toBeTruthy()
        expect(view.getByText("1 x 1")).toBeTruthy()
        fireEvent.click(view.getByTitle("Show media information"))
        expect(view.getByText("/workspace/assets/hero.png")).toBeTruthy()
    })

    test("renders unsupported binary viewer", () => {
        const tab: Tab = {
            id: 9202,
            type: "media",
            name: "app.wasm",
            path: "dist/app.wasm",
            realPath: "/workspace/dist/app.wasm",
            media: {
                path: "/workspace/dist/app.wasm",
                kind: "unsupported",
                mime: "application/octet-stream",
                format: "wasm",
                data_url: null,
                byte_size: 5,
                dimensions: null,
                version: { modified_ms: 1, len: 5 },
                too_large: false,
                error: null,
            },
        }
        const view = render(<MediaView tab={tab} />)

        expect(view.getByText("Preview is not supported for this file type.")).toBeTruthy()
        expect(view.getByText("WASM")).toBeTruthy()
    })

    test("renders too-large media state without image data", () => {
        const tab: Tab = {
            id: 9203,
            type: "media",
            name: "huge.png",
            path: "assets/huge.png",
            realPath: "/workspace/assets/huge.png",
            media: {
                path: "/workspace/assets/huge.png",
                kind: "image",
                mime: "image/png",
                format: "png",
                data_url: null,
                byte_size: 12000000,
                dimensions: null,
                version: { modified_ms: 1, len: 12000000 },
                too_large: true,
                error: null,
            },
        }
        const view = render(<MediaView tab={tab} />)

        expect(view.getByText("Image is too large to preview.")).toBeTruthy()
        expect(view.getByText("11.4 MB")).toBeTruthy()
    })
})
```

- [ ] **Step 2: Run UI tests to verify red**

Run:

```bash
bun test src/v2/ContentViews.test.tsx
```

Expected: FAIL because `MediaView` is not exported.

- [ ] **Step 3: Add MediaView implementation**

Modify imports in `src/v2/ContentViews.tsx`:

```tsx
import { useRef, useState } from "react"
import { ExternalLink, FolderSearch, Info, RefreshCw, ZoomIn, ZoomOut } from "lucide-react"
import { openExternalFile, revealFile } from "../features/files/file-api"
```

Replace the existing `import { useRef } from "react"` with the React import shown above.

Add these helpers before `EditorView`:

```tsx
function bytesLabel(bytes: number): string {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB"
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB"
    return bytes + " B"
}

function dimensionLabel(dimensions: { width: number; height: number } | null | undefined): string {
    return dimensions ? dimensions.width + " x " + dimensions.height : "unknown"
}

function formatLabel(format: string | undefined): string {
    return (format || "binary").toUpperCase()
}
```

Add this exported component after `EditorView`:

```tsx
export function MediaView({ tab }: { tab: Tab }) {
    const [fit, setFit] = useState(true)
    const [infoOpen, setInfoOpen] = useState(false)
    const projectName = useV2Store((s) => s.meta[s.active]?.name ?? "")
    const root = useV2Store((s) => s.meta[s.active]?.root ?? "")
    const showToast = useV2Store((s) => s.showToast)
    const reloadTab = useV2Store((s) => s.reloadTab)
    const media = tab.media
    const path = tab.path ?? tab.name ?? "media"
    const title = tab.name ?? path

    const runExternal = (kind: "open" | "reveal") => {
        const realPath = tab.realPath ?? tab.path
        if (!root || !realPath) {
            showToast("Media action needs a real workspace path")
            return
        }
        const action = kind === "open" ? openExternalFile(root, realPath) : revealFile(root, realPath)
        void action
            .then(() => showToast(kind === "open" ? "Opened externally" : "Revealed in file manager"))
            .catch((error) => showToast((kind === "open" ? "Open external: " : "Reveal: ") + String(error)))
    }

    const body = !media || tab.loading ? (
        <div className="yz2-media-empty">Loading {title}...</div>
    ) : media.too_large ? (
        <div className="yz2-media-empty">Image is too large to preview.</div>
    ) : media.error ? (
        <div className="yz2-media-empty">{media.error}</div>
    ) : media.kind === "unsupported" ? (
        <div className="yz2-media-empty">Preview is not supported for this file type.</div>
    ) : media.data_url ? (
        <img
            className={"yz2-media-img" + (fit ? " is-fit" : " is-actual")}
            src={media.data_url}
            alt={title}
        />
    ) : (
        <div className="yz2-media-empty">No preview data available.</div>
    )

    return (
        <div className="yz2-view yz2-media-view" key={tab.id}>
            <div className="yz2-ed-head yz2-media-head">
                <span className="yz2-ellipsis">{projectName + " › " + path.split("/").join(" › ")}</span>
                <span className="yz2-spacer" />
                {tab.externalChange ? (
                    <span className="yz2-ext-chip" title="This media file changed on disk">
                        changed on disk
                        <button type="button" className="yz2-ext-btn" onClick={() => reloadTab(tab.id)}>Reload</button>
                    </span>
                ) : null}
                <button type="button" className="yz2-ed-tool" onClick={() => setFit(true)}>Fit</button>
                <button type="button" className="yz2-ed-tool" onClick={() => setFit(false)}>100%</button>
                <button type="button" className="yz2-ed-tool" title="Zoom out" onClick={() => setFit(true)}><ZoomOut size={13} /></button>
                <button type="button" className="yz2-ed-tool" title="Zoom in" onClick={() => setFit(false)}><ZoomIn size={13} /></button>
                <button type="button" className="yz2-ed-tool" title="Open externally" onClick={() => runExternal("open")}><ExternalLink size={13} /></button>
                <button type="button" className="yz2-ed-tool" title="Reveal in file manager" onClick={() => runExternal("reveal")}><FolderSearch size={13} /></button>
                <button type="button" className="yz2-ed-tool" title="Show media information" onClick={() => setInfoOpen((v) => !v)}><Info size={13} /></button>
                <button type="button" className="yz2-ed-tool" title="Reload media" onClick={() => reloadTab(tab.id)}><RefreshCw size={13} /></button>
            </div>
            <div className="yz2-media-canvas">
                {body}
                {infoOpen && media ? (
                    <div className="yz2-media-info">
                        <div><b>Path</b><span>{media.path}</span></div>
                        <div><b>Mime</b><span>{media.mime}</span></div>
                        <div><b>Format</b><span>{formatLabel(media.format)}</span></div>
                        <div><b>Size</b><span>{bytesLabel(media.byte_size)}</span></div>
                        <div><b>Dimensions</b><span>{dimensionLabel(media.dimensions)}</span></div>
                    </div>
                ) : null}
            </div>
            <div className="yz2-media-meta">
                <span>{formatLabel(media?.format)}</span>
                <span>{dimensionLabel(media?.dimensions)}</span>
                <span>{bytesLabel(media?.byte_size ?? 0)}</span>
                <span>{media?.mime ?? "unknown"}</span>
            </div>
        </div>
    )
}
```

- [ ] **Step 4: Wire main and split routing**

In `src/v2/Workbench.tsx`, add a branch in `MainContent` after the `file` branch:

```tsx
                    ) : at.type === "media" ? (
                        <MediaView tab={at} />
```

Update the import:

```tsx
import { BrowserView, EditorView, EmptyView, MediaView, SplitPane, TerminalView } from "./ContentViews"
```

In `src/v2/ContentViews.tsx`, update the split title line:

```tsx
<span className="tt">{spTab.type === "file" || spTab.type === "media" ? spTab.name : spTab.title}</span>
```

Add a split branch before the `cmd` branch:

```tsx
            ) : spTab.type === "media" ? (
                <MediaView tab={spTab} />
```

- [ ] **Step 5: Add media CSS**

Append to `src/v2/yuzu.css` near the editor/view styles:

```css
.yz2-media-view {
    background: var(--yz-080d14);
}
.yz2-media-head .yz2-ed-tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
}
.yz2-media-canvas {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: grid;
    place-items: center;
    padding: 18px;
    background:
        linear-gradient(45deg, rgba(255,255,255,.03) 25%, transparent 25%),
        linear-gradient(-45deg, rgba(255,255,255,.03) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, rgba(255,255,255,.03) 75%),
        linear-gradient(-45deg, transparent 75%, rgba(255,255,255,.03) 75%);
    background-size: 24px 24px;
    background-position: 0 0, 0 12px, 12px -12px, -12px 0;
}
.yz2-media-img {
    display: block;
    image-rendering: auto;
    box-shadow: 0 14px 36px rgba(0,0,0,.42);
}
.yz2-media-img.is-fit {
    max-width: 100%;
    max-height: 100%;
}
.yz2-media-img.is-actual {
    max-width: none;
    max-height: none;
}
.yz2-media-empty {
    color: var(--yz-8b97a7);
    font-size: 13px;
    border: 1px solid var(--yz-2b3547);
    background: var(--yz-10151f);
    border-radius: 8px;
    padding: 16px 18px;
}
.yz2-media-meta {
    height: 28px;
    flex: 0 0 28px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 16px;
    border-top: 1px solid var(--yz-1c2433);
    color: var(--yz-8b97a7);
    font-size: 11px;
    white-space: nowrap;
}
.yz2-media-info {
    position: absolute;
    top: 12px;
    right: 12px;
    width: min(320px, calc(100% - 24px));
    border: 1px solid var(--yz-2b3547);
    border-radius: 8px;
    background: var(--yz-10151f);
    box-shadow: 0 16px 40px rgba(0,0,0,.5);
    padding: 10px 12px;
    display: grid;
    gap: 7px;
    font-size: 11px;
}
.yz2-media-info div {
    display: grid;
    grid-template-columns: 82px minmax(0, 1fr);
    gap: 8px;
}
.yz2-media-info b {
    color: var(--yz-8b97a7);
}
.yz2-media-info span {
    color: var(--yz-e6edf3);
    overflow-wrap: anywhere;
}
```

- [ ] **Step 6: Run UI tests**

Run:

```bash
bun test src/v2/ContentViews.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit media UI**

```bash
git add src/v2/ContentViews.tsx src/v2/Workbench.tsx src/v2/ContentViews.test.tsx src/v2/yuzu.css
git commit -m "feat: render media viewer tabs"
```

---

### Task 6: Reload, Close, Save Exclusion, And Final Verification

**Files:**
- Modify: `src/v2/controller.ts`
- Modify: `src/v2/Workbench.tsx`
- Modify: `src/v2/folder-expand.test.ts`
- Modify: `src/v2/ContentViews.test.tsx`
- Modify: `src/v2/v2-store.test.ts`

- [ ] **Step 1: Add failing reload/save exclusion tests**

Add this test to `src/v2/folder-expand.test.ts`:

```ts
    test("reload refreshes media tabs without writing or opening LSP", async () => {
        await ensureMockWorkspace()
        v2Store.getState().openFile("assets/hero.png")
        await waitFor(() => Boolean(v2Store.getState().ui.demo.tabs.find((t) => t.type === "media" && t.path === "assets/hero.png")?.media))
        const tab = v2Store.getState().ui.demo.tabs.find((t) => t.type === "media" && t.path === "assets/hero.png")!

        mediaReadCalls.length = 0
        lspCalls.length = 0
        v2Store.getState().reloadTab(tab.id)

        await waitFor(() => mediaReadCalls.length === 1)
        expect(mediaReadCalls[0]).toEqual({ workspaceRoot: ROOT, path: "assets/hero.png" })
        expect(lspCalls.some((call) => call.cmd === "lsp_open_document")).toBe(false)
    })
```

Add this test to `src/v2/v2-store.test.ts`:

```ts
    test("media tabs do not delegate save on Cmd+S path", () => {
        const store = freshStore()
        const calls: unknown[][] = []
        registerRealDelegate({
            saveFile: (...args: unknown[]) => calls.push(["save", ...args]),
        } as any)
        store.setState((s) => ({
            mode: "real",
            ui: {
                ...s.ui,
                api: {
                    ...s.ui.api,
                    activeTab: 9300,
                    tabs: [{
                        id: 9300,
                        type: "media" as const,
                        name: "hero.png",
                        path: "assets/hero.png",
                        realPath: "/workspace/assets/hero.png",
                        version: { modified_ms: 1, len: 3 },
                    }],
                },
            },
        }))

        store.getState().saveTab(9300)

        expect(calls).toEqual([])
    })
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
bun test src/v2/folder-expand.test.ts src/v2/v2-store.test.ts
```

Expected: FAIL because `reloadTab` still delegates only `reloadFile`, and `saveTab` delegates `saveFile` without checking active tab type when called directly.

- [ ] **Step 3: Add media reload in controller**

In delegate `reloadFile(tabId)` in `src/v2/controller.ts`, keep existing file behavior and add media behavior before file-only return. If the function currently starts by requiring `tab.type === "file"`, change the start to:

```ts
    reloadFile(tabId: number) {
        const pid = store().active
        const root = rootOf(pid)
        const tab = tabIn(pid, tabId)
        if (!root || !tab || !tab.realPath) return
        if (tab.type === "media") {
            patchTab(pid, tabId, (t) => ({ ...t, loading: true }))
            void loadMediaTab(pid, root, tabId, tab.realPath, tab.path ?? tab.realPath)
            return
        }
        if (tab.type !== "file") return
```

Leave the rest of the existing file reload logic after that.

- [ ] **Step 4: Guard direct media save**

Modify `saveTab` in `src/v2/v2-store.ts`:

```ts
            saveTab: (tabId) => {
                const tab = get().ui[get().active]?.tabs.find((t) => t.id === tabId)
                if (tab?.type !== "file") {
                    get().showToast("This tab is read-only")
                    return
                }
                if (get().mode === "real") {
                    realDelegate?.saveFile(tabId)
                    return
                }
                get().showToast("Demo mode — edits are not written to disk")
            },
```

This keeps `Workbench` Cmd+S behavior unchanged and prevents direct action calls from saving media.

- [ ] **Step 5: Ensure closeTab does not back up media**

Confirm `src/v2/controller.ts` still checks `tab.type === "file"` before `saveUnsavedBackup`. No code change is needed if this guard remains:

```ts
if (tab.type === "file" && tab.dirty && typeof tab.content === "string" && tab.path) {
```

If a previous task changed this guard, restore it exactly.

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
bun test src/features/files/media-model.test.ts src/v2/file-watch.test.ts src/v2/TabStrip.test.tsx src/v2/ContentViews.test.tsx src/v2/folder-expand.test.ts src/v2/v2-store.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run focused Rust tests**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml media_file external_open_command reveal_command
```

Expected: PASS.

- [ ] **Step 8: Run broader verification**

Run:

```bash
bun test src/v2 src/features/files
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
git diff --check
```

Expected:

- Bun tests pass.
- Build exits 0.
- Cargo tests pass.
- Cargo fmt exits 0.
- Cargo clippy exits 0.
- `git diff --check` exits 0.

- [ ] **Step 9: Run packaged smoke**

Run:

```bash
bun run tauri build --debug --bundles app
```

Expected: debug app bundle builds.

Manual smoke checklist:

- Open a workspace with `assets/hero.png`, `assets/photo.jpg`, `assets/icon.svg`, `dist/app.wasm`, and a media file larger than 10 MiB.
- Open `hero.png`: it renders in a media tab with metadata strip.
- Toggle Fit and 100%: image switches between constrained and actual display.
- Click Info: overlay shows full path, mime, format, size, and dimensions.
- Open `icon.svg`: source editor is active, image viewer opens in split.
- Modify `hero.png` externally: tab shows changed-on-disk chip, Reload refreshes payload.
- Open `dist/app.wasm`: unsupported viewer appears and no editor content is shown.
- Click Open External and Reveal in file manager on a real media tab.

- [ ] **Step 10: Commit final integration**

```bash
git add src/v2/controller.ts src/v2/Workbench.tsx src/v2/folder-expand.test.ts src/v2/ContentViews.test.tsx src/v2/v2-store.ts src/v2/v2-store.test.ts
git commit -m "test: verify media tab integration"
```

---

## Self-Review Checklist

Spec coverage:

- Image support for `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`: Task 1 Rust classification, Task 2 frontend classification, Task 3 routing, Task 5 UI.
- SVG split: Task 3 controller test and routing.
- Unsupported binary surface: Task 1, Task 2, Task 3, Task 5.
- Metadata strip and info overlay: Task 5.
- Save/LSP/backup exclusion: Task 3 LSP assertions, Task 6 save/reload/backup guards.
- Path safety and size limit: Task 1 Rust tests.
- External open/reveal controls: Task 4 commands, Task 5 UI buttons.

Type consistency:

- Rust response: `MediaFileRead`.
- Frontend payload: `MediaFilePayload`.
- Tab type: `type: "media"`.
- Media payload field: `tab.media`.
- IPC command: `read_media_file`.
- TS wrapper: `readMediaFile`.

Execution rule:

- Use path-scoped `git add` exactly as shown in each commit step.
- Do not commit unrelated dirty files listed by `git status`.
