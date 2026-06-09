# Node 8 Browser Preview And Local Dev Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace-scoped browser preview so frontend and full-stack work can run a dev server, open localhost beside the relevant files, reload it, capture verification screenshots, and attach those screenshots to agent context.

**Architecture:** Rust owns trusted URL validation and macOS region screenshot capture through a small command surface; React owns per-workspace browser state, dev-server detection from task state, browser controls, split editor/browser layout, and agent context assembly. The native preview uses a Tauri child WebView positioned over the browser preview pane, while tests use an injected adapter so UI behavior stays deterministic without opening a real WebView.

**Tech Stack:** Tauri 2, Rust 2021, `serde`, `serde_json`, `base64 0.22.1`, React 19.2.7, TypeScript 6.0.3, Vite 8.0.16, Bun 1.3.14, Zustand, lucide-react icons, `@tauri-apps/api/window`, `@tauri-apps/api/webview`, and the dense rail/panel/split/browser visual language in `docs/ui-design/`.

**Subagent contract:** Development subagents must use `gpt-5.3-codex-spark` with `xhigh` reasoning. Spec-compliance and code-quality review subagents must use `gpt-5.5` with `xhigh` reasoning. Do not use `gpt-5.4`.

---

## Source Context

- `roadmap.md` Node 8 requires embedded browser preview, localhost URL launcher, dev-server detection from tasks, reload and hard reload, split editor/browser layout, screenshot capture, and a console error surface if practical.
- `docs/architecture/tech-stack.md` says Tauri 2 + Vite + React + TypeScript is the primary app route, Rust owns process/task/lifecycle state, React owns visible workbench state, heavy surfaces remain lazy, and browser preview should use a separate WebView when embedded.
- `docs/ui-design/app.jsx` defines the Browser rail item with a globe icon, browser tab title derived from the URL, `openBrowser(url)`, and split-right behavior.
- `docs/ui-design/scenes.jsx` defines `BrowserScene` and `docs/ui-design/ide.css` defines compact split editor group styling. Production UI should reuse the current app's `.panel`, `.panel-head`, `.btn`, `.iconbtn`, `.input2`, `.badge2`, `.tab`, `.breadcrumb`, `.group-content`, and statusbar patterns.
- Current app state has `Surface = "empty" | "editor" | "terminal" | "git-diff" | "git-graph" | "docs-preview"`. Node 8 adds a `"browser-preview"` surface and a browser slice to `WorkspaceViewState`.
- Current agent context kinds are `file`, `doc`, `diff`, `diagnostic`, and `terminal`. Node 8 adds `screenshot` in Rust and TypeScript so captured preview evidence can be selected into agent sessions.
- `@tauri-apps/api/webview` exposes child WebView create, setPosition, setSize, show, hide, close, setFocus, and clearAllBrowsingData. It does not expose a direct screenshot method.
- macOS screenshot capture is implemented through `/usr/sbin/screencapture -x -R x,y,w,h <file>` after React supplies physical screen bounds. Non-macOS returns a clear unsupported error. Tests inject fake capture bytes and do not shell out.

## File Structure

- Create `src-tauri/src/browser_preview.rs`: URL normalization/validation, screenshot bounds validation, macOS region capture, PNG data URL encoding, capture artifact types, and Rust unit tests.
- Modify `src-tauri/Cargo.toml`: add direct `base64 = "0.22.1"` dependency for PNG data URL encoding.
- Modify `src-tauri/src/agent.rs`: add `AgentContextKind::Screenshot` and export label support.
- Modify `src-tauri/src/commands.rs`: expose `browser_validate_url` and `browser_capture_preview`, route through `AppState::trusted_workspace_root`, and add command-level tests.
- Modify `src-tauri/src/lib.rs`: register the browser preview module and Tauri commands.
- Create `src/features/browser/browser-model.ts`: pure browser state, URL helpers, dev-server detection, reload counters, screenshot state, console error state, and agent context conversion.
- Create `src/features/browser/browser-model.test.ts`: Bun tests for pure browser behavior.
- Create `src/features/browser/browser-api.ts`: typed Tauri wrappers for URL validation and screenshot capture.
- Create `src/features/browser/browser-webview.ts`: Tauri child WebView adapter, physical bounds calculation, reload/hard-reload URL helpers, and adapter interface used by tests.
- Create `src/features/browser/BrowserPreviewSurface.tsx`: lazy surface that attaches/detaches the child WebView, tracks pane bounds, reports native errors, and renders a tested fallback shell.
- Create `src/features/browser/BrowserPreviewSurface.test.tsx`: UI tests using a fake adapter.
- Create `src/features/browser/BrowserPanel.tsx`: browser panel with URL launcher, detected dev server candidates, reload, hard reload, capture, console error list, and screenshot list.
- Create `src/features/browser/BrowserPanel.test.tsx`: UI tests for controls, detected task launching, screenshot selection, and disabled states.
- Modify `src/features/agents/agent-model.ts` and `src/features/agents/agent-model.test.ts`: include screenshot context summary and helper coverage.
- Modify `src/app/activity-rail.tsx` and `src/app/activity-rail.test.tsx`: add Browser rail item using `Globe`.
- Modify `src/app/command-palette-model.ts` and `src/app/command-palette-model.test.ts`: add Node 8 browser commands.
- Modify `src/app/workspace-view-state.ts` and `src/app/workspace-view-state.test.ts`: add frozen per-workspace browser state and updater.
- Modify `src/app/AppShell.tsx` and `src/app/AppShell.contract.test.tsx`: wire browser panel, browser surface tab, split editor/browser layout, screenshot capture, browser screenshots in agent context, and command handlers.
- Modify `src/index.css`: add compact browser panel, browser surface, split layout, screenshot rows, and responsive styles consistent with `docs/ui-design/`.
- Create `docs/architecture/node-8-browser-results.md`: final TDD/review/verification evidence and screenshot/runtime caveats.
- Modify `docs/architecture/progress.md`: append Node 8 completion after verification passes.
- Modify `roadmap.md`: mark Node 8 complete and set current priority to Node 9 after verification passes.

## Command Contract

Rust commands added by Node 8:

```text
browser_validate_url(url) -> BrowserUrl
browser_capture_preview(workspace_root, request) -> BrowserScreenshot
```

`BrowserUrl`:

```rust
pub struct BrowserUrl {
    pub url: String,
    pub host: String,
    pub port: Option<u16>,
}
```

`BrowserCaptureRequest`:

```rust
pub struct BrowserCaptureRequest {
    pub url: String,
    pub title: String,
    pub bounds: BrowserCaptureBounds,
}
```

`BrowserCaptureBounds` uses physical screen pixels:

```rust
pub struct BrowserCaptureBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
```

`BrowserScreenshot`:

```rust
pub struct BrowserScreenshot {
    pub id: String,
    pub workspace_root: String,
    pub url: String,
    pub title: String,
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub captured_ms: u64,
}
```

Allowed browser URLs are local development URLs only:

- `http://localhost:<port>`
- `http://127.0.0.1:<port>`
- `http://[::1]:<port>`
- the same host forms without a scheme, normalized to `http://...`
- optional path, query, and fragment after the host and port

Rejected URLs include remote hosts, custom protocols, file URLs, empty input, unsupported schemes, invalid ports, and hostnames that only contain `localhost` as a substring.

## Task 1: Rust URL Validation, Screenshot Capture, And Screenshot Agent Kind

**Files:**
- Create: `src-tauri/src/browser_preview.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/agent.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/browser_preview.rs`
- Test: `src-tauri/src/agent.rs`
- Test: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write failing Rust tests for URL validation and screenshot capture**

Create `src-tauri/src/browser_preview.rs` with tests first. The production section can contain type declarations without working bodies until Step 3.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_localhost_urls_and_preserves_paths() {
        let url = normalize_browser_url("localhost:5173/dashboard?tab=preview#top")
            .expect("normalized url");

        assert_eq!(url.url, "http://localhost:5173/dashboard?tab=preview#top");
        assert_eq!(url.host, "localhost");
        assert_eq!(url.port, Some(5173));
    }

    #[test]
    fn accepts_loopback_hosts_with_explicit_http_scheme() {
        assert_eq!(
            normalize_browser_url("http://127.0.0.1:3000").expect("ipv4").host,
            "127.0.0.1"
        );
        assert_eq!(
            normalize_browser_url("http://[::1]:8080/").expect("ipv6").host,
            "::1"
        );
    }

    #[test]
    fn rejects_remote_and_non_http_urls() {
        for value in [
            "",
            "https://example.com",
            "http://example.local:3000",
            "file:///Users/yuuzu/index.html",
            "tauri://localhost",
            "http://localhost.evil.test:3000",
            "http://127.0.0.1:99999",
        ] {
            assert!(
                normalize_browser_url(value).is_err(),
                "{value} should not be accepted"
            );
        }
    }

    #[test]
    fn capture_bounds_reject_zero_or_excessive_regions() {
        assert!(validate_capture_bounds(&BrowserCaptureBounds {
            x: 0,
            y: 0,
            width: 0,
            height: 200,
        })
        .is_err());

        assert!(validate_capture_bounds(&BrowserCaptureBounds {
            x: 0,
            y: 0,
            width: 5000,
            height: 5000,
        })
        .is_err());
    }

    #[test]
    fn capture_region_builds_bounded_png_data_url() {
        let request = BrowserCaptureRequest {
            url: "http://localhost:5173/".to_string(),
            title: "localhost:5173".to_string(),
            bounds: BrowserCaptureBounds {
                x: 10,
                y: 20,
                width: 320,
                height: 180,
            },
        };

        let screenshot = capture_preview_with(
            "/workspace",
            request,
            |_bounds| Ok(vec![137, 80, 78, 71, 13, 10, 26, 10]),
            || Ok(42),
            || "shot-1".to_string(),
        )
        .expect("screenshot");

        assert_eq!(screenshot.id, "shot-1");
        assert_eq!(screenshot.workspace_root, "/workspace");
        assert_eq!(screenshot.width, 320);
        assert_eq!(screenshot.height, 180);
        assert!(screenshot.data_url.starts_with("data:image/png;base64,"));
        assert_eq!(screenshot.captured_ms, 42);
    }
}
```

- [ ] **Step 2: Run Rust tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml browser_preview::tests -- --nocapture
```

Expected: FAIL because `normalize_browser_url`, capture types, and capture helpers are missing or stubbed.

- [ ] **Step 3: Implement Rust browser preview module**

Add `base64` as a direct dependency:

```toml
[dependencies]
base64 = "0.22.1"
```

Implement `src-tauri/src/browser_preview.rs` with these public APIs:

```rust
use std::{
    fs,
    path::PathBuf,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};

const MAX_CAPTURE_PIXELS: u32 = 8_294_400;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BrowserUrl {
    pub url: String,
    pub host: String,
    pub port: Option<u16>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BrowserCaptureBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BrowserCaptureRequest {
    pub url: String,
    pub title: String,
    pub bounds: BrowserCaptureBounds,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BrowserScreenshot {
    pub id: String,
    pub workspace_root: String,
    pub url: String,
    pub title: String,
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub captured_ms: u64,
}

pub fn normalize_browser_url(input: &str) -> Result<BrowserUrl, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("browser URL is required".to_string());
    }

    let candidate = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else if trimmed.contains("://") {
        return Err("only http localhost URLs are supported".to_string());
    } else {
        format!("http://{trimmed}")
    };

    if candidate.starts_with("https://") {
        return Err("only http localhost URLs are supported".to_string());
    }

    let after_scheme = candidate
        .strip_prefix("http://")
        .ok_or_else(|| "only http localhost URLs are supported".to_string())?;
    let authority = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    let (host, port) = parse_loopback_authority(authority)?;

    Ok(BrowserUrl {
        url: candidate,
        host,
        port,
    })
}

fn parse_loopback_authority(authority: &str) -> Result<(String, Option<u16>), String> {
    if authority.is_empty() {
        return Err("localhost host is required".to_string());
    }

    if let Some(rest) = authority.strip_prefix("[::1]") {
        let port = parse_optional_port(rest)?;
        return Ok(("::1".to_string(), port));
    }

    let mut parts = authority.split(':');
    let host = parts.next().unwrap_or_default();
    let port = match parts.next() {
        Some(value) => Some(parse_port(value)?),
        None => None,
    };

    if parts.next().is_some() {
        return Err("invalid localhost authority".to_string());
    }

    if host != "localhost" && host != "127.0.0.1" {
        return Err("only localhost browser URLs are supported".to_string());
    }

    Ok((host.to_string(), port))
}

fn parse_optional_port(value: &str) -> Result<Option<u16>, String> {
    if value.is_empty() {
        return Ok(None);
    }
    let port = value
        .strip_prefix(':')
        .ok_or_else(|| "invalid localhost authority".to_string())?;
    Ok(Some(parse_port(port)?))
}

fn parse_port(value: &str) -> Result<u16, String> {
    value
        .parse::<u16>()
        .map_err(|_| "invalid localhost port".to_string())
}

pub fn validate_capture_bounds(bounds: &BrowserCaptureBounds) -> Result<(), String> {
    if bounds.width == 0 || bounds.height == 0 {
        return Err("browser capture bounds must be non-empty".to_string());
    }
    if bounds.width.saturating_mul(bounds.height) > MAX_CAPTURE_PIXELS {
        return Err("browser capture bounds are too large".to_string());
    }
    Ok(())
}

pub fn capture_preview(workspace_root: &str, request: BrowserCaptureRequest) -> Result<BrowserScreenshot, String> {
    capture_preview_with(
        workspace_root,
        request,
        capture_png_bytes,
        current_time_ms,
        || uuid::Uuid::new_v4().to_string(),
    )
}

fn capture_preview_with(
    workspace_root: &str,
    request: BrowserCaptureRequest,
    capture: impl FnOnce(BrowserCaptureBounds) -> Result<Vec<u8>, String>,
    now_ms: impl FnOnce() -> Result<u64, String>,
    next_id: impl FnOnce() -> String,
) -> Result<BrowserScreenshot, String> {
    let normalized = normalize_browser_url(&request.url)?;
    validate_capture_bounds(&request.bounds)?;
    let png = capture(request.bounds)?;
    if !png.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        return Err("browser capture did not produce a PNG".to_string());
    }

    Ok(BrowserScreenshot {
        id: next_id(),
        workspace_root: workspace_root.to_string(),
        url: normalized.url,
        title: bound_title(&request.title, &normalized.url),
        data_url: format!(
            "data:image/png;base64,{}",
            general_purpose::STANDARD.encode(png)
        ),
        width: request.bounds.width,
        height: request.bounds.height,
        captured_ms: now_ms()?,
    })
}

fn bound_title(title: &str, fallback: &str) -> String {
    let trimmed = title.trim();
    let title = if trimmed.is_empty() { fallback } else { trimmed };
    title.chars().take(160).collect()
}

#[cfg(target_os = "macos")]
fn capture_png_bytes(bounds: BrowserCaptureBounds) -> Result<Vec<u8>, String> {
    let path: PathBuf = std::env::temp_dir().join(format!(
        "yuuzu-browser-preview-{}.png",
        uuid::Uuid::new_v4()
    ));
    let region = format!("{},{},{},{}", bounds.x, bounds.y, bounds.width, bounds.height);
    let status = Command::new("/usr/sbin/screencapture")
        .args(["-x", "-R", &region])
        .arg(&path)
        .status()
        .map_err(|err| format!("browser screenshot failed: {err}"))?;

    if !status.success() {
        let _ = fs::remove_file(&path);
        return Err("browser screenshot command failed".to_string());
    }

    let bytes = fs::read(&path).map_err(|err| format!("browser screenshot read failed: {err}"))?;
    let _ = fs::remove_file(&path);
    Ok(bytes)
}

#[cfg(not(target_os = "macos"))]
fn capture_png_bytes(_bounds: BrowserCaptureBounds) -> Result<Vec<u8>, String> {
    Err("browser screenshot capture is currently supported on macOS only".to_string())
}

fn current_time_ms() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis() as u64)
}
```

- [ ] **Step 4: Add screenshot context kind in Rust agent module**

Modify `src-tauri/src/agent.rs`:

```rust
pub enum AgentContextKind {
    File,
    Doc,
    Diff,
    Diagnostic,
    Terminal,
    Screenshot,
}

impl AgentContextKind {
    fn as_label(&self) -> &'static str {
        match self {
            AgentContextKind::File => "file",
            AgentContextKind::Doc => "doc",
            AgentContextKind::Diff => "diff",
            AgentContextKind::Diagnostic => "diagnostic",
            AgentContextKind::Terminal => "terminal",
            AgentContextKind::Screenshot => "screenshot",
        }
    }
}
```

Add a Rust test in `src-tauri/src/agent.rs`:

```rust
#[test]
fn export_prompt_labels_browser_screenshot_context() {
    let temp = tempfile::tempdir().expect("temp dir");
    let store = AgentSessionStore::new(temp.path().join("agent-sessions.json"));
    let session = store
        .start_session(
            "/workspace",
            AgentMode::Verify,
            "Verify preview",
            vec![context_item(
                AgentContextKind::Screenshot,
                "Browser screenshot: localhost:5173",
                "data:image/png;base64,iVBORw0KGgo=",
            )],
        )
        .expect("start session");

    let exported = store.export_prompt(&session.id).expect("export");

    assert!(exported.content.contains("Browser screenshot: localhost:5173"));
    assert!(exported.content.contains("screenshot"));
}
```

- [ ] **Step 5: Wire Rust commands and registration**

Modify `src-tauri/src/commands.rs`:

```rust
pub fn validate_browser_url(&self, url: &str) -> Result<crate::browser_preview::BrowserUrl, String> {
    crate::browser_preview::normalize_browser_url(url)
}

pub fn capture_browser_preview(
    &self,
    workspace_root: &str,
    request: crate::browser_preview::BrowserCaptureRequest,
) -> Result<crate::browser_preview::BrowserScreenshot, String> {
    let trusted = self.trusted_workspace_root(workspace_root)?;
    crate::browser_preview::capture_preview(&trusted.to_string_lossy(), request)
}

#[tauri::command]
pub fn browser_validate_url(
    state: State<'_, AppState>,
    url: String,
) -> Result<crate::browser_preview::BrowserUrl, String> {
    state.validate_browser_url(&url)
}

#[tauri::command]
pub fn browser_capture_preview(
    state: State<'_, AppState>,
    workspace_root: String,
    request: crate::browser_preview::BrowserCaptureRequest,
) -> Result<crate::browser_preview::BrowserScreenshot, String> {
    state.capture_browser_preview(&workspace_root, request)
}
```

Modify `src-tauri/src/lib.rs`:

```rust
pub mod browser_preview;

tauri::generate_handler![
    commands::browser_validate_url,
    commands::browser_capture_preview,
]
```

Add a command test in `src-tauri/src/commands.rs`:

```rust
#[test]
fn browser_validate_url_rejects_remote_hosts() {
    assert!(crate::browser_preview::normalize_browser_url("http://example.com:3000").is_err());
    assert!(crate::browser_preview::normalize_browser_url("localhost:3000").is_ok());
}
```

- [ ] **Step 6: Run Rust tests to verify GREEN**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml browser_preview::tests agent::tests::export_prompt_labels_browser_screenshot_context commands::tests::browser_validate_url_rejects_remote_hosts -- --nocapture
```

Expected: PASS.

- [ ] **Step 7: Refactor and verify Rust formatting**

Run:

```bash
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml browser_preview::tests -- --nocapture
```

Expected: both PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/browser_preview.rs src-tauri/src/agent.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add browser preview capture commands"
```

## Task 2: Browser State Model, Dev Server Detection, API Wrappers, And Screenshot Agent Context

**Files:**
- Create: `src/features/browser/browser-model.ts`
- Create: `src/features/browser/browser-model.test.ts`
- Create: `src/features/browser/browser-api.ts`
- Modify: `src/features/agents/agent-model.ts`
- Modify: `src/features/agents/agent-model.test.ts`

- [ ] **Step 1: Write failing Bun tests for browser model behavior**

Create `src/features/browser/browser-model.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";

import {
  addBrowserConsoleError,
  browserScreenshotToContext,
  createBrowserState,
  detectDevServerTargets,
  hardReloadBrowser,
  openBrowserUrl,
  reloadBrowser,
  setBrowserUrlInput,
  storeBrowserScreenshot,
  type BrowserScreenshot,
} from "./browser-model";

describe("browser model", () => {
  test("opens normalized localhost url and scopes state to one slice", () => {
    const state = openBrowserUrl(createBrowserState(), {
      url: "http://localhost:5173/app",
      host: "localhost",
      port: 5173,
    });

    expect(state.activeUrl).toBe("http://localhost:5173/app");
    expect(state.urlInput).toBe("http://localhost:5173/app");
    expect(state.status).toBe("ready");
  });

  test("reload and hard reload advance separate counters", () => {
    const opened = openBrowserUrl(createBrowserState(), {
      url: "http://localhost:3000",
      host: "localhost",
      port: 3000,
    });
    const reloaded = reloadBrowser(opened);
    const hard = hardReloadBrowser(reloaded);

    expect(reloaded.reloadVersion).toBe(1);
    expect(reloaded.hardReloadVersion).toBe(0);
    expect(hard.reloadVersion).toBe(1);
    expect(hard.hardReloadVersion).toBe(1);
  });

  test("detects localhost targets from task commands and output", () => {
    const targets = detectDevServerTargets({
      detectedTasks: [
        { id: "vite", label: "dev", command: "bunx vite --host 127.0.0.1", cwd: "/repo", source: "package.json" },
        { id: "next", label: "next", command: "next dev -p 3010", cwd: "/repo", source: "package.json" },
      ],
      runs: [
        { id: "w:task-1", workspace_id: "w", label: "serve", command: "bun run serve", cwd: "/repo", status: "Running", exit_code: null },
      ],
      outputByRunId: {
        "w:task-1": "ready at http://localhost:4321/docs",
      },
    });

    expect(targets.map((target) => target.url)).toEqual([
      "http://localhost:4321/docs",
      "http://127.0.0.1:5173",
      "http://localhost:3010",
    ]);
  });

  test("stores screenshots newest first and exposes screenshot agent context", () => {
    const screenshot: BrowserScreenshot = {
      id: "shot-1",
      workspace_root: "/repo",
      url: "http://localhost:5173",
      title: "localhost:5173",
      data_url: "data:image/png;base64,iVBORw0KGgo=",
      width: 320,
      height: 180,
      captured_ms: 10,
    };

    const state = storeBrowserScreenshot(createBrowserState(), screenshot);
    const context = browserScreenshotToContext(screenshot);

    expect(state.screenshots[0].id).toBe("shot-1");
    expect(context.kind).toBe("screenshot");
    expect(context.label).toBe("Browser screenshot: localhost:5173");
    expect(context.content).toContain("data:image/png;base64");
  });

  test("bounds console errors without clearing screenshots", () => {
    const state = addBrowserConsoleError(
      storeBrowserScreenshot(createBrowserState(), {
        id: "shot-1",
        workspace_root: "/repo",
        url: "http://localhost:3000",
        title: "preview",
        data_url: "data:image/png;base64,iVBORw0KGgo=",
        width: 100,
        height: 100,
        captured_ms: 1,
      }),
      { message: "Hydration failed", level: "error", captured_ms: 2 },
    );

    expect(state.consoleErrors[0].message).toBe("Hydration failed");
    expect(state.screenshots).toHaveLength(1);
  });
});
```

Modify `src/features/agents/agent-model.test.ts` with a failing screenshot summary assertion:

```typescript
test("summarizes screenshot context items", () => {
  const summary = agentContextSummary({
    id: "agent-1",
    workspace_root: "/repo",
    mode: "verify",
    prompt: "Check preview",
    context_items: [
      {
        id: "screenshot:shot-1",
        kind: "screenshot",
        label: "Browser screenshot: localhost:5173",
        path: null,
        content: "data:image/png;base64,iVBORw0KGgo=",
        truncated: false,
      },
    ],
    transcript: [],
    created_ms: 1,
    updated_ms: 2,
  });

  expect(summary).toBe("1 screenshot");
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/features/browser/browser-model.test.ts src/features/agents/agent-model.test.ts
```

Expected: FAIL because browser model files and screenshot context kind are not implemented.

- [ ] **Step 3: Implement browser model and API wrappers**

Create `src/features/browser/browser-model.ts` with these exported types and helpers:

```typescript
import type { AgentContextItem } from "../agents/agent-model";
import type { TaskRun, WorkspaceTask } from "../tasks/task-model";

export type BrowserStatus = "idle" | "loading" | "ready" | "error";
export type BrowserConsoleLevel = "error" | "warning" | "info";

export type BrowserUrl = {
  url: string;
  host: string;
  port: number | null;
};

export type BrowserScreenshot = {
  id: string;
  workspace_root: string;
  url: string;
  title: string;
  data_url: string;
  width: number;
  height: number;
  captured_ms: number;
};

export type BrowserConsoleError = {
  message: string;
  level: BrowserConsoleLevel;
  captured_ms: number;
};

export type BrowserPreviewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserViewState = {
  urlInput: string;
  activeUrl: string | null;
  activeTitle: string | null;
  status: BrowserStatus;
  error: string | null;
  reloadVersion: number;
  hardReloadVersion: number;
  bounds: BrowserPreviewBounds | null;
  screenshots: BrowserScreenshot[];
  selectedScreenshotId: string | null;
  consoleErrors: BrowserConsoleError[];
};

export type DevServerDetectionSource = {
  detectedTasks: WorkspaceTask[];
  runs: TaskRun[];
  outputByRunId: Record<string, string>;
};

export type DevServerTarget = {
  id: string;
  label: string;
  url: string;
  source: string;
};

const MAX_SCREENSHOTS = 12;
const MAX_CONSOLE_ERRORS = 20;

export function createBrowserState(): BrowserViewState {
  return {
    urlInput: "localhost:3000",
    activeUrl: null,
    activeTitle: null,
    status: "idle",
    error: null,
    reloadVersion: 0,
    hardReloadVersion: 0,
    bounds: null,
    screenshots: [],
    selectedScreenshotId: null,
    consoleErrors: [],
  };
}

export function setBrowserUrlInput(state: BrowserViewState, urlInput: string): BrowserViewState {
  return { ...state, urlInput };
}

export function openBrowserUrl(state: BrowserViewState, browserUrl: BrowserUrl): BrowserViewState {
  return {
    ...state,
    urlInput: browserUrl.url,
    activeUrl: browserUrl.url,
    activeTitle: browserUrl.url.replace(/^http:\/\//u, ""),
    status: "ready",
    error: null,
  };
}

export function setBrowserError(state: BrowserViewState, error: string | null): BrowserViewState {
  return { ...state, status: error ? "error" : state.status, error };
}

export function reloadBrowser(state: BrowserViewState): BrowserViewState {
  return state.activeUrl ? { ...state, reloadVersion: state.reloadVersion + 1 } : state;
}

export function hardReloadBrowser(state: BrowserViewState): BrowserViewState {
  return state.activeUrl ? { ...state, hardReloadVersion: state.hardReloadVersion + 1 } : state;
}

export function updateBrowserBounds(
  state: BrowserViewState,
  bounds: BrowserPreviewBounds | null,
): BrowserViewState {
  return { ...state, bounds };
}

export function storeBrowserScreenshot(
  state: BrowserViewState,
  screenshot: BrowserScreenshot,
): BrowserViewState {
  const screenshots = [
    screenshot,
    ...state.screenshots.filter((item) => item.id !== screenshot.id),
  ].slice(0, MAX_SCREENSHOTS);

  return { ...state, screenshots, selectedScreenshotId: screenshot.id };
}

export function addBrowserConsoleError(
  state: BrowserViewState,
  error: BrowserConsoleError,
): BrowserViewState {
  return {
    ...state,
    consoleErrors: [error, ...state.consoleErrors].slice(0, MAX_CONSOLE_ERRORS),
  };
}

export function browserScreenshotToContext(screenshot: BrowserScreenshot): AgentContextItem {
  return {
    id: `screenshot:${screenshot.id}`,
    kind: "screenshot",
    label: `Browser screenshot: ${screenshot.title || screenshot.url.replace(/^http:\/\//u, "")}`,
    path: null,
    content: [
      `URL: ${screenshot.url}`,
      `Size: ${screenshot.width}x${screenshot.height}`,
      `Captured: ${screenshot.captured_ms}`,
      screenshot.data_url,
    ].join("\n"),
    truncated: false,
  };
}

export function detectDevServerTargets(source: DevServerDetectionSource): DevServerTarget[] {
  const targets: DevServerTarget[] = [];
  const seen = new Set<string>();
  const push = (target: DevServerTarget) => {
    if (seen.has(target.url)) return;
    seen.add(target.url);
    targets.push(target);
  };

  for (const run of source.runs) {
    if (run.status !== "Running") continue;
    for (const url of urlsFromText(source.outputByRunId[run.id] ?? "")) {
      push({ id: `run:${run.id}:${url}`, label: run.label, url, source: "task output" });
    }
  }

  for (const task of source.detectedTasks) {
    const url = urlFromTaskCommand(task.command);
    if (url) {
      push({ id: `task:${task.id}:${url}`, label: task.label, url, source: task.source });
    }
  }

  return targets;
}

function urlsFromText(text: string): string[] {
  const matches = text.match(/http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}[^\s"'<>)]*/gu);
  return matches ?? [];
}

function urlFromTaskCommand(command: string): string | null {
  const explicitPort = /\s(?:-p|--port)\s+(\d{2,5})\b/u.exec(command)?.[1];
  if (explicitPort) return `http://localhost:${explicitPort}`;
  if (/\bvite\b/u.test(command)) return "http://127.0.0.1:5173";
  if (/\bnext\s+dev\b/u.test(command)) return "http://localhost:3000";
  if (/\bastro\s+dev\b/u.test(command)) return "http://localhost:4321";
  return null;
}
```

Create `src/features/browser/browser-api.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";

import type {
  BrowserPreviewBounds,
  BrowserScreenshot,
  BrowserUrl,
} from "./browser-model";

export type BrowserCaptureRequest = {
  url: string;
  title: string;
  bounds: BrowserPreviewBounds;
};

export function validateBrowserUrl(url: string): Promise<BrowserUrl> {
  return invoke<BrowserUrl>("browser_validate_url", { url });
}

export function captureBrowserPreview(args: {
  workspaceRoot: string;
  request: BrowserCaptureRequest;
}): Promise<BrowserScreenshot> {
  return invoke<BrowserScreenshot>("browser_capture_preview", {
    workspaceRoot: args.workspaceRoot,
    request: args.request,
  });
}
```

Modify `src/features/agents/agent-model.ts`:

```typescript
export type AgentContextKind =
  | "file"
  | "doc"
  | "diff"
  | "diagnostic"
  | "terminal"
  | "screenshot";
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
bun test src/features/browser/browser-model.test.ts src/features/agents/agent-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Refactor and run focused type check**

Run:

```bash
bun run build
```

Expected: PASS or fail only on missing later-task imports. If it fails because later task files are not present, record that reason in the implementer result and keep the focused tests passing.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/features/browser/browser-model.ts src/features/browser/browser-model.test.ts src/features/browser/browser-api.ts src/features/agents/agent-model.ts src/features/agents/agent-model.test.ts
git commit -m "feat: add browser preview state model"
```

## Task 3: Tauri Child WebView Adapter And Preview Surface

**Files:**
- Create: `src/features/browser/browser-webview.ts`
- Create: `src/features/browser/BrowserPreviewSurface.tsx`
- Create: `src/features/browser/BrowserPreviewSurface.test.tsx`

- [ ] **Step 1: Write failing adapter and surface tests**

Create `src/features/browser/BrowserPreviewSurface.test.tsx`:

```typescript
/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { ensureTestDom } from "../../app/test-dom";
import type { BrowserPreviewAdapter } from "./browser-webview";

ensureTestDom();

const { cleanup, render } = await import("@testing-library/react");
const React = await import("react");
const { BrowserPreviewSurface } = await import("./BrowserPreviewSurface");

afterEach(() => {
  cleanup();
});

function fakeAdapter(): BrowserPreviewAdapter {
  return {
    attach: mock(async () => {}),
    detach: mock(async () => {}),
    reload: mock(async () => {}),
    hardReload: mock(async () => {}),
  };
}

async function fixedGeometry() {
  return {
    webviewBounds: { x: 0, y: 0, width: 640, height: 360 },
    captureBounds: { x: 10, y: 20, width: 640, height: 360 },
  };
}

describe("BrowserPreviewSurface", () => {
  test("renders empty state without an active url", () => {
    const adapter = fakeAdapter();
    const result = render(
      <BrowserPreviewSurface
        workspaceId="w"
        url={null}
        title={null}
        reloadVersion={0}
        hardReloadVersion={0}
        adapter={adapter}
        resolveGeometry={fixedGeometry}
        onBoundsChange={() => {}}
        onError={() => {}}
      />,
    );

    expect(result.getByText("No browser preview open")).toBeTruthy();
    expect(adapter.attach).toHaveBeenCalledTimes(0);
  });

  test("attaches adapter for active url and reports a stable pane bound", async () => {
    const adapter = fakeAdapter();
    const onBoundsChange = mock(() => {});

    render(
      <BrowserPreviewSurface
        workspaceId="w"
        url="http://localhost:5173"
        title="localhost:5173"
        reloadVersion={0}
        hardReloadVersion={0}
        adapter={adapter}
        resolveGeometry={fixedGeometry}
        onBoundsChange={onBoundsChange}
        onError={() => {}}
      />,
    );

    await Promise.resolve();

    expect(adapter.attach).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "w",
        url: "http://localhost:5173",
      }),
    );
    expect(onBoundsChange).toHaveBeenCalled();
  });

  test("routes reload and hard reload version changes through adapter", async () => {
    const adapter = fakeAdapter();
    const { rerender } = render(
      <BrowserPreviewSurface
        workspaceId="w"
        url="http://localhost:3000"
        title="localhost:3000"
        reloadVersion={0}
        hardReloadVersion={0}
        adapter={adapter}
        resolveGeometry={fixedGeometry}
        onBoundsChange={() => {}}
        onError={() => {}}
      />,
    );

    rerender(
      <BrowserPreviewSurface
        workspaceId="w"
        url="http://localhost:3000"
        title="localhost:3000"
        reloadVersion={1}
        hardReloadVersion={0}
        adapter={adapter}
        resolveGeometry={fixedGeometry}
        onBoundsChange={() => {}}
        onError={() => {}}
      />,
    );
    rerender(
      <BrowserPreviewSurface
        workspaceId="w"
        url="http://localhost:3000"
        title="localhost:3000"
        reloadVersion={1}
        hardReloadVersion={1}
        adapter={adapter}
        resolveGeometry={fixedGeometry}
        onBoundsChange={() => {}}
        onError={() => {}}
      />,
    );

    await Promise.resolve();

    expect(adapter.reload).toHaveBeenCalledWith("http://localhost:3000");
    expect(adapter.hardReload).toHaveBeenCalledWith("http://localhost:3000");
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/features/browser/BrowserPreviewSurface.test.tsx
```

Expected: FAIL because preview surface and adapter do not exist.

- [ ] **Step 3: Implement WebView adapter**

Create `src/features/browser/browser-webview.ts`:

```typescript
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";

import type { BrowserPreviewBounds } from "./browser-model";

export type BrowserWebviewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserPaneGeometry = {
  webviewBounds: BrowserWebviewBounds;
  captureBounds: BrowserPreviewBounds;
};

export type BrowserAttachRequest = {
  workspaceId: string;
  url: string;
  webviewBounds: BrowserWebviewBounds;
};

export type BrowserPreviewAdapter = {
  attach: (request: BrowserAttachRequest) => Promise<void>;
  detach: () => Promise<void>;
  reload: (url: string) => Promise<void>;
  hardReload: (url: string) => Promise<void>;
};

export async function browserPaneGeometryFromElement(element: HTMLElement): Promise<BrowserPaneGeometry> {
  const rect = element.getBoundingClientRect();
  const win = getCurrentWindow();
  const position = await win.innerPosition();
  const scaleFactor = await win.scaleFactor();

  return {
    webviewBounds: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    },
    captureBounds: {
      x: Math.round(position.x + rect.left * scaleFactor),
      y: Math.round(position.y + rect.top * scaleFactor),
      width: Math.max(1, Math.round(rect.width * scaleFactor)),
      height: Math.max(1, Math.round(rect.height * scaleFactor)),
    },
  };
}

export function hardReloadUrl(url: string, version: number): string {
  const parsed = new URL(url);
  parsed.searchParams.set("_yuuzu_hard_reload", String(version));
  return parsed.toString();
}

export function createTauriBrowserPreviewAdapter(): BrowserPreviewAdapter {
  const appWindow = getCurrentWindow();
  let webview: Webview | null = null;
  let lastRequest: BrowserAttachRequest | null = null;
  let hardReloadVersion = 0;

  async function closeCurrent() {
    if (webview) {
      await webview.close().catch(() => {});
      webview = null;
    }
  }

  return {
    async attach(request) {
      await closeCurrent();
      lastRequest = request;
      const label = `browser-preview-${request.workspaceId.replace(/[^a-zA-Z0-9_:-]/gu, "_")}`;
      webview = new Webview(appWindow, label, {
        url: request.url,
        x: request.webviewBounds.x,
        y: request.webviewBounds.y,
        width: request.webviewBounds.width,
        height: request.webviewBounds.height,
        devtools: true,
      });
    },
    async detach() {
      await closeCurrent();
    },
    async reload(url) {
      if (!lastRequest) return;
      await this.attach({ ...lastRequest, url });
    },
    async hardReload(url) {
      if (!lastRequest) return;
      hardReloadVersion += 1;
      await this.attach({
        ...lastRequest,
        url: hardReloadUrl(url, hardReloadVersion),
      });
    },
  };
}
```

- [ ] **Step 4: Implement preview surface**

Create `src/features/browser/BrowserPreviewSurface.tsx`:

```tsx
import { Globe, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import type { BrowserPreviewBounds } from "./browser-model";
import {
  createTauriBrowserPreviewAdapter,
  browserPaneGeometryFromElement,
  type BrowserPaneGeometry,
  type BrowserPreviewAdapter,
} from "./browser-webview";

type BrowserPreviewSurfaceProps = {
  workspaceId: string | null;
  url: string | null;
  title: string | null;
  reloadVersion: number;
  hardReloadVersion: number;
  adapter?: BrowserPreviewAdapter;
  resolveGeometry?: (element: HTMLElement) => Promise<BrowserPaneGeometry>;
  onBoundsChange: (bounds: BrowserPreviewBounds | null) => void;
  onError: (message: string | null) => void;
};

export function BrowserPreviewSurface({
  workspaceId,
  url,
  title,
  reloadVersion,
  hardReloadVersion,
  adapter,
  resolveGeometry = browserPaneGeometryFromElement,
  onBoundsChange,
  onError,
}: BrowserPreviewSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const previewAdapter = useMemo(
    () => adapter ?? createTauriBrowserPreviewAdapter(),
    [adapter],
  );

  useEffect(() => {
    if (!workspaceId || !url || !hostRef.current) {
      onBoundsChange(null);
      void previewAdapter.detach();
      return;
    }

    let disposed = false;

    async function attach() {
      try {
        const host = hostRef.current;
        if (!host) return;
        const geometry = await resolveGeometry(host);
        if (disposed) return;
        onBoundsChange(geometry.captureBounds);
        await previewAdapter.attach({
          workspaceId,
          url,
          webviewBounds: geometry.webviewBounds,
        });
        onError(null);
      } catch (error) {
        if (!disposed) {
          onError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void attach();

    return () => {
      disposed = true;
      onBoundsChange(null);
      void previewAdapter.detach();
    };
  }, [workspaceId, url, previewAdapter, resolveGeometry, onBoundsChange, onError]);

  useEffect(() => {
    if (url && reloadVersion > 0) {
      void previewAdapter.reload(url).catch((error) =>
        onError(error instanceof Error ? error.message : String(error)),
      );
    }
  }, [url, reloadVersion, previewAdapter, onError]);

  useEffect(() => {
    if (url && hardReloadVersion > 0) {
      void previewAdapter.hardReload(url).catch((error) =>
        onError(error instanceof Error ? error.message : String(error)),
      );
    }
  }, [url, hardReloadVersion, previewAdapter, onError]);

  return (
    <div className="browser-preview-surface" ref={hostRef}>
      {url ? (
        <div className="browser-preview-fallback" aria-label="Browser preview frame">
          <div className="browser-preview-chrome">
            <Globe aria-hidden="true" />
            <span className="mono">{title ?? url}</span>
            <RotateCw aria-hidden="true" />
          </div>
        </div>
      ) : (
        <div className="browser-empty-state">
          <Globe aria-hidden="true" />
          <span>No browser preview open</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
bun test src/features/browser/BrowserPreviewSurface.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Refactor adapter without changing behavior**

Run:

```bash
bun test src/features/browser/BrowserPreviewSurface.test.tsx src/features/browser/browser-model.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/features/browser/browser-webview.ts src/features/browser/BrowserPreviewSurface.tsx src/features/browser/BrowserPreviewSurface.test.tsx
git commit -m "feat: add browser preview surface"
```

## Task 4: Browser Panel, Rail Item, And Command Palette

**Files:**
- Create: `src/features/browser/BrowserPanel.tsx`
- Create: `src/features/browser/BrowserPanel.test.tsx`
- Modify: `src/app/activity-rail.tsx`
- Modify: `src/app/activity-rail.test.tsx`
- Modify: `src/app/command-palette-model.ts`
- Modify: `src/app/command-palette-model.test.ts`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing browser panel and command tests**

Create `src/features/browser/BrowserPanel.test.tsx`:

```typescript
/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { ensureTestDom } from "../../app/test-dom";
import { createBrowserState, openBrowserUrl } from "./browser-model";

ensureTestDom();

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { BrowserPanel } = await import("./BrowserPanel");

afterEach(() => cleanup());

describe("BrowserPanel", () => {
  test("launches typed localhost url", () => {
    const onUrlChange = mock(() => {});
    const onOpenUrl = mock(() => {});

    const result = render(
      <BrowserPanel
        state={createBrowserState()}
        devServerTargets={[]}
        canCapture={false}
        onUrlInputChange={onUrlChange}
        onOpenUrl={onOpenUrl}
        onOpenTarget={() => {}}
        onReload={() => {}}
        onHardReload={() => {}}
        onCapture={() => {}}
        onSelectScreenshot={() => {}}
      />,
    );

    fireEvent.change(result.getByLabelText("Browser URL"), {
      target: { value: "localhost:5173" },
    });
    fireEvent.click(result.getByRole("button", { name: "Open browser preview" }));

    expect(onUrlChange).toHaveBeenCalledWith("localhost:5173");
    expect(onOpenUrl).toHaveBeenCalledWith("localhost:3000");
  });

  test("renders detected dev server targets and screenshot controls", () => {
    const onOpenTarget = mock(() => {});
    const onCapture = mock(() => {});
    const state = openBrowserUrl(createBrowserState(), {
      url: "http://localhost:5173",
      host: "localhost",
      port: 5173,
    });

    const result = render(
      <BrowserPanel
        state={{
          ...state,
          screenshots: [{
            id: "shot-1",
            workspace_root: "/repo",
            url: "http://localhost:5173",
            title: "localhost:5173",
            data_url: "data:image/png;base64,iVBORw0KGgo=",
            width: 320,
            height: 180,
            captured_ms: 1,
          }],
        }}
        devServerTargets={[{ id: "vite", label: "dev", url: "http://localhost:5173", source: "task output" }]}
        canCapture={true}
        onUrlInputChange={() => {}}
        onOpenUrl={() => {}}
        onOpenTarget={onOpenTarget}
        onReload={() => {}}
        onHardReload={() => {}}
        onCapture={onCapture}
        onSelectScreenshot={() => {}}
      />,
    );

    fireEvent.click(result.getByRole("button", { name: "Open dev at http://localhost:5173" }));
    fireEvent.click(result.getByRole("button", { name: "Capture browser screenshot" }));

    expect(onOpenTarget).toHaveBeenCalledWith("http://localhost:5173");
    expect(onCapture).toHaveBeenCalled();
    expect(result.getByText("localhost:5173")).toBeTruthy();
  });
});
```

Modify `src/app/command-palette-model.test.ts`:

```typescript
test("includes browser preview commands", () => {
  expect(allCommands.map((command) => command.id)).toContain("open-browser-preview");
  expect(allCommands.map((command) => command.id)).toContain("browser-capture-screenshot");
});
```

Modify `src/app/activity-rail.test.tsx`:

```typescript
test("renders browser rail item", () => {
  const result = render(<ActivityRail active="browser" onSelect={() => {}} />);
  expect(result.getByRole("button", { name: "Browser" })).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/features/browser/BrowserPanel.test.tsx src/app/command-palette-model.test.ts src/app/activity-rail.test.tsx
```

Expected: FAIL because Browser panel, activity id, and commands are missing.

- [ ] **Step 3: Implement Browser panel**

Create `src/features/browser/BrowserPanel.tsx`:

```tsx
import { Camera, Globe, Play, RotateCw, Zap } from "lucide-react";

import type { BrowserViewState, DevServerTarget } from "./browser-model";

type BrowserPanelProps = {
  state: BrowserViewState;
  devServerTargets: DevServerTarget[];
  canCapture: boolean;
  onUrlInputChange: (value: string) => void;
  onOpenUrl: (value: string) => void;
  onOpenTarget: (url: string) => void;
  onReload: () => void;
  onHardReload: () => void;
  onCapture: () => void;
  onSelectScreenshot: (id: string) => void;
};

export function BrowserPanel({
  state,
  devServerTargets,
  canCapture,
  onUrlInputChange,
  onOpenUrl,
  onOpenTarget,
  onReload,
  onHardReload,
  onCapture,
  onSelectScreenshot,
}: BrowserPanelProps) {
  return (
    <div className="panel-body browser-panel">
      <div className="browser-url-row">
        <input
          className="input2 mono"
          aria-label="Browser URL"
          value={state.urlInput}
          onChange={(event) => onUrlInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onOpenUrl(state.urlInput);
          }}
        />
        <button
          type="button"
          className="btn primary"
          aria-label="Open browser preview"
          onClick={() => onOpenUrl(state.urlInput)}
        >
          <Play aria-hidden="true" />
          Open
        </button>
      </div>

      <div className="browser-actions">
        <button type="button" className="btn" disabled={!state.activeUrl} onClick={onReload}>
          <RotateCw aria-hidden="true" />
          Reload
        </button>
        <button type="button" className="btn" disabled={!state.activeUrl} onClick={onHardReload}>
          <Zap aria-hidden="true" />
          Hard reload
        </button>
        <button
          type="button"
          className="btn"
          aria-label="Capture browser screenshot"
          disabled={!state.activeUrl || !canCapture}
          onClick={onCapture}
        >
          <Camera aria-hidden="true" />
          Capture
        </button>
      </div>

      {state.error ? <div className="terminal-inline-error" role="alert">{state.error}</div> : null}

      <div className="section-label">
        <span>Dev servers</span>
        <span>{devServerTargets.length}</span>
      </div>
      {devServerTargets.map((target) => (
        <button
          type="button"
          className="row tree-row browser-target-row"
          key={target.id}
          aria-label={`Open ${target.label} at ${target.url}`}
          title={target.url}
          onClick={() => onOpenTarget(target.url)}
        >
          <Globe aria-hidden="true" />
          <span className="task-row-main">
            <span className="nm mono">{target.label}</span>
            <span className="task-row-sub mono">{target.url}</span>
          </span>
          <span className="badge2">{target.source}</span>
        </button>
      ))}
      {devServerTargets.length === 0 ? (
        <div className="panel-empty task-empty"><span>No detected dev servers</span></div>
      ) : null}

      <div className="section-label">
        <span>Screenshots</span>
        <span>{state.screenshots.length}</span>
      </div>
      {state.screenshots.map((shot) => (
        <button
          type="button"
          className={`row tree-row browser-shot-row${state.selectedScreenshotId === shot.id ? " sel" : ""}`}
          key={shot.id}
          onClick={() => onSelectScreenshot(shot.id)}
        >
          <Camera aria-hidden="true" />
          <span className="task-row-main">
            <span className="nm mono">{shot.title}</span>
            <span className="task-row-sub mono">{shot.width}x{shot.height}</span>
          </span>
        </button>
      ))}

      <div className="section-label">
        <span>Console</span>
        <span>{state.consoleErrors.length}</span>
      </div>
      {state.consoleErrors.map((error) => (
        <div className="browser-console-row" key={`${error.captured_ms}:${error.message}`}>
          <span className={`badge2 ${error.level === "error" ? "danger" : "warn"}`}>{error.level}</span>
          <span>{error.message}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add activity and commands**

Modify `src/app/activity-rail.tsx`:

```typescript
import { Globe } from "lucide-react";

export type ActivityId =
  | "explorer"
  | "search"
  | "git"
  | "terminal"
  | "tasks"
  | "docs"
  | "language"
  | "agents"
  | "browser"
  | "database"
  | "settings";

const activities: ActivityItem[] = [
  { id: "explorer", label: "Explorer", icon: Files },
  { id: "search", label: "Search", icon: Search },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "tasks", label: "Tasks", icon: ClipboardList },
  { id: "docs", label: "Docs", icon: BookOpenText },
  { id: "language", label: "Language", icon: Languages },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "browser", label: "Browser", icon: Globe },
  { id: "database", label: "Database", icon: Database },
  { id: "settings", label: "Settings", icon: Settings },
];
```

Modify `src/app/command-palette-model.ts`:

```typescript
export const node8Commands: CommandItem[] = [
  { id: "open-browser-preview", label: "Browser: Open preview", group: "Browser" },
  { id: "browser-reload", label: "Browser: Reload preview", group: "Browser" },
  { id: "browser-hard-reload", label: "Browser: Hard reload preview", group: "Browser" },
  { id: "browser-capture-screenshot", label: "Browser: Capture screenshot", group: "Browser" },
];

export const allCommands: CommandItem[] = [
  ...node1Commands,
  ...node5Commands,
  ...node6Commands,
  ...node7Commands,
  ...node8Commands,
];
```

- [ ] **Step 5: Add browser CSS**

Modify `src/index.css` with compact rules:

```css
.browser-panel {
  gap: 10px;
}

.browser-url-row,
.browser-actions {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
}

.browser-url-row .input2 {
  min-width: 0;
}

.browser-target-row,
.browser-shot-row {
  width: 100%;
}

.browser-console-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--line);
  color: var(--txt-dim);
  font-size: 12px;
}

.browser-preview-surface {
  flex: 1;
  min-height: 0;
  position: relative;
  background: var(--editor);
  overflow: hidden;
}

.browser-preview-fallback {
  position: absolute;
  inset: 0;
  border: 1px solid var(--line);
  background: var(--editor);
  pointer-events: none;
}

.browser-preview-chrome {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--line);
  background: var(--chrome);
  color: var(--txt-dim);
}

.browser-empty-state {
  height: 100%;
  display: grid;
  place-items: center;
  gap: 8px;
  color: var(--txt-faint);
}
```

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```bash
bun test src/features/browser/BrowserPanel.test.tsx src/app/command-palette-model.test.ts src/app/activity-rail.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Refactor CSS only after tests pass**

Run:

```bash
bun test src/features/browser/BrowserPanel.test.tsx src/features/browser/browser-model.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/features/browser/BrowserPanel.tsx src/features/browser/BrowserPanel.test.tsx src/app/activity-rail.tsx src/app/activity-rail.test.tsx src/app/command-palette-model.ts src/app/command-palette-model.test.ts src/index.css
git commit -m "feat: add browser preview panel"
```

## Task 5: Workspace View State, AppShell Wiring, Split Layout, And Agent Context Attachment

**Files:**
- Modify: `src/app/workspace-view-state.ts`
- Modify: `src/app/workspace-view-state.test.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.contract.test.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing workspace and AppShell contract tests**

Modify `src/app/workspace-view-state.test.ts`:

```typescript
test("keeps browser preview state scoped per workspace", () => {
  const store = createWorkspaceViewStore();

  store.getState().updateBrowser("workspace-a", (browser) =>
    openBrowserUrl(browser, {
      url: "http://localhost:5173",
      host: "localhost",
      port: 5173,
    }),
  );

  expect(store.getState().viewFor("workspace-a").browser.activeUrl).toBe("http://localhost:5173");
  expect(store.getState().viewFor("workspace-b").browser.activeUrl).toBeNull();
});
```

Modify `src/app/AppShell.contract.test.tsx`:

```typescript
test("collects browser screenshot context for active workspace", () => {
  const source = {
    workspaceRoot: "/repo",
    activeWorkspaceId: "w:1",
    loadedFile: null,
    docsPreviews: [],
    selectedDiff: null,
    activeFileDiagnostics: [],
    terminalSession: null,
    terminalOutput: "",
    browserScreenshots: [{
      id: "shot-1",
      workspace_root: "/repo",
      url: "http://localhost:5173",
      title: "localhost:5173",
      data_url: "data:image/png;base64,iVBORw0KGgo=",
      width: 320,
      height: 180,
      captured_ms: 1,
    }],
  } as AgentAvailableContextSource;

  const contextItems = collectAgentAvailableContext(source);

  expect(contextItems.map((item) => item.kind)).toContain("screenshot");
  expect(contextItems.map((item) => item.label)).toContain("Browser screenshot: localhost:5173");
});
```

Add a panel routing test in `src/app/AppShell.contract.test.tsx`:

```typescript
test("PanelBody renders BrowserPanel and routes preview callbacks", () => {
  const onBrowserOpenUrl = mock(() => {});
  const result = render(
    <PanelBody
      active="browser"
      refreshKey={0}
      activeFilePath={null}
      terminalSessions={[]}
      activeTerminalId={null}
      terminalCwdInput=""
      terminalError={null}
      taskState={createTaskState()}
      taskError={null}
      browserState={createBrowserState()}
      browserTargets={[{ id: "vite", label: "dev", url: "http://localhost:5173", source: "task output" }]}
      browserCanCapture={false}
      onBrowserUrlInputChange={() => {}}
      onBrowserOpenUrl={onBrowserOpenUrl}
      onBrowserOpenTarget={() => {}}
      onBrowserReload={() => {}}
      onBrowserHardReload={() => {}}
      onBrowserCapture={() => {}}
      onBrowserSelectScreenshot={() => {}}
      gitState={{ status: null, loading: false, error: null, commitMessage: "", selectedDiff: null, diffByKey: {}, branches: [], graph: [] }}
      docsState={createDocsState()}
      contextPackNameById={{}}
      gitDecorations={{}}
      agentState={createAgentState()}
      availableAgentContext={[]}
      languageState={createLanguageState()}
      onOpenFile={() => Promise.resolve()}
      onCreateFile={async () => {}}
      onRenamePath={async () => {}}
      onDeletePath={async () => {}}
      onTerminalCwdInputChange={() => {}}
      onNewTerminal={() => Promise.resolve()}
      onActivateTerminal={() => {}}
      onCloseTerminal={() => Promise.resolve()}
      onRestartTerminal={() => Promise.resolve()}
      onTaskCustomCommandChange={() => {}}
      onRunTask={() => {}}
      onRunCustomTask={() => {}}
      onActivateTaskRun={() => {}}
      onStopTaskRun={() => Promise.resolve()}
      onRerunTaskRun={() => {}}
      onGitRefresh={() => Promise.resolve()}
      onGitCommitMessageChange={() => {}}
      onGitCommit={() => {}}
      onGitStage={() => {}}
      onGitUnstage={() => {}}
      onGitDiscard={() => {}}
      onGitOpenDiff={() => {}}
      onGitStash={() => {}}
      onGitFetch={() => {}}
      onGitPull={() => {}}
      onGitPush={() => {}}
      onGitCheckoutBranch={() => Promise.resolve()}
      onGitCreateBranch={() => Promise.resolve()}
      onGitOpenGraph={() => {}}
      onDocsRefresh={() => Promise.resolve()}
      onDocsSearch={() => {}}
      onDocsOpenPreview={() => Promise.resolve()}
      onDocsToggleSource={() => {}}
      onDocsPackNameChange={() => {}}
      onDocsCreatePack={() => Promise.resolve()}
      onDocsSelectPack={() => {}}
      onDocsDeletePack={() => Promise.resolve()}
      onDocsUsePackForActiveTask={() => Promise.resolve()}
      onDocsLinkPackToAgentSession={() => Promise.resolve()}
      onAgentModeChange={() => {}}
      onAgentPromptChange={() => {}}
      onAgentToggleContext={() => {}}
      onAgentStartSession={() => Promise.resolve()}
      onAgentSelectSession={() => {}}
      onAgentApprove={() => Promise.resolve()}
      onAgentReject={() => Promise.resolve()}
      onAgentExport={() => Promise.resolve()}
      onLanguageOpenDiagnostic={() => {}}
      onLanguageRefresh={() => Promise.resolve()}
      onLanguageRestartServer={() => Promise.resolve()}
    />,
  );

  fireEvent.click(result.getByRole("button", { name: "Open dev at http://localhost:5173" }));
  expect(result.getByRole("button", { name: "Capture browser screenshot" })).toBeDisabled();
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx
```

Expected: FAIL because browser state, AppShell source fields, PanelBody props, and browser panel routing are not implemented.

- [ ] **Step 3: Add browser state to workspace store**

Modify `src/app/workspace-view-state.ts`:

```typescript
import { createBrowserState, type BrowserViewState } from "../features/browser/browser-model";

export type Surface =
  | "empty"
  | "editor"
  | "terminal"
  | "git-diff"
  | "git-graph"
  | "docs-preview"
  | "browser-preview";

export type WorkspaceViewState = {
  browser: BrowserViewState;
};

type WorkspaceViewStore = {
  updateBrowser: (
    workspaceId: string | null,
    update: (browser: BrowserViewState) => BrowserViewState,
  ) => void;
};

function defaultWorkspaceView(): WorkspaceViewState {
  return {
    browser: createBrowserState(),
  };
}
```

In `freezeWorkspaceView`, freeze browser arrays and objects:

```typescript
Object.freeze(view.browser.screenshots);
for (const screenshot of view.browser.screenshots) {
  Object.freeze(screenshot);
}
Object.freeze(view.browser.consoleErrors);
for (const error of view.browser.consoleErrors) {
  Object.freeze(error);
}
if (view.browser.bounds) {
  Object.freeze(view.browser.bounds);
}
Object.freeze(view.browser);
```

Add updater:

```typescript
updateBrowser: (workspaceId, update) =>
  set((state) => {
    const key = workspaceId ?? shellKey;
    const current = state.views[key] ?? defaultView;

    return {
      views: {
        ...state.views,
        [key]: { ...current, browser: update(current.browser) },
      },
    };
  }),
```

- [ ] **Step 4: Wire PanelBody and available agent context**

Modify `src/app/AppShell.tsx` imports:

```typescript
import { Globe } from "lucide-react";
import { captureBrowserPreview, validateBrowserUrl } from "../features/browser/browser-api";
import { BrowserPanel } from "../features/browser/BrowserPanel";
import { BrowserPreviewSurface } from "../features/browser/BrowserPreviewSurface";
import {
  browserScreenshotToContext,
  createBrowserState,
  detectDevServerTargets,
  hardReloadBrowser,
  openBrowserUrl,
  reloadBrowser,
  setBrowserError,
  setBrowserUrlInput,
  storeBrowserScreenshot,
  updateBrowserBounds,
  type BrowserScreenshot,
  type BrowserViewState,
} from "../features/browser/browser-model";
```

Extend `AgentAvailableContextSource`:

```typescript
browserScreenshots: BrowserScreenshot[];
```

Extend `collectAgentAvailableContext`:

```typescript
for (const screenshot of source.browserScreenshots) {
  if (screenshot.workspace_root === source.workspaceRoot) {
    context.push(browserScreenshotToContext(screenshot));
  }
}
```

Extend `PanelBody` props and active branch:

```tsx
browserState: BrowserViewState;
browserTargets: DevServerTarget[];
browserCanCapture: boolean;
onBrowserUrlInputChange: (value: string) => void;
onBrowserOpenUrl: (value: string) => void;
onBrowserOpenTarget: (url: string) => void;
onBrowserReload: () => void;
onBrowserHardReload: () => void;
onBrowserCapture: () => void;
onBrowserSelectScreenshot: (id: string) => void;
```

Render:

```tsx
if (active === "browser") {
  return (
    <BrowserPanel
      state={browserState}
      devServerTargets={browserTargets}
      canCapture={browserCanCapture}
      onUrlInputChange={onBrowserUrlInputChange}
      onOpenUrl={onBrowserOpenUrl}
      onOpenTarget={onBrowserOpenTarget}
      onReload={onBrowserReload}
      onHardReload={onBrowserHardReload}
      onCapture={onBrowserCapture}
      onSelectScreenshot={onBrowserSelectScreenshot}
    />
  );
}
```

- [ ] **Step 5: Wire AppShell browser handlers**

Add `updateBrowser` selector:

```typescript
const updateBrowser = useWorkspaceViewStore((state) => state.updateBrowser);
```

Compute targets:

```typescript
const browserTargets = useMemo(
  () =>
    detectDevServerTargets({
      detectedTasks: view.task.detectedTasks,
      runs: view.task.runs,
      outputByRunId: view.task.outputByRunId,
    }),
  [view.task.detectedTasks, view.task.runs, view.task.outputByRunId],
);
```

Handlers:

```typescript
function openBrowserPanel() {
  updateView(activeWorkspaceId, {
    activeActivity: "browser",
    panelOpen: true,
  });
}

async function openBrowserPreview(value: string) {
  if (!activeWorkspaceId) return;
  try {
    const url = await validateBrowserUrl(value);
    updateBrowser(activeWorkspaceId, (browser) => openBrowserUrl(browser, url));
    updateView(activeWorkspaceId, {
      activeActivity: "browser",
      panelOpen: true,
      surface: "browser-preview",
    });
  } catch (error) {
    updateBrowser(activeWorkspaceId, (browser) =>
      setBrowserError(browser, terminalErrorMessage(error)),
    );
    openBrowserPanel();
  }
}

function updateBrowserUrlInput(value: string) {
  updateBrowser(activeWorkspaceId, (browser) => setBrowserUrlInput(browser, value));
}

function reloadBrowserPreview() {
  updateBrowser(activeWorkspaceId, reloadBrowser);
}

function hardReloadBrowserPreview() {
  updateBrowser(activeWorkspaceId, hardReloadBrowser);
}

async function captureBrowserScreenshot() {
  if (!activeWorkspace || !activeWorkspaceId) return;
  const browser = workspaceViewStore.getState().viewFor(activeWorkspaceId).browser;
  if (!browser.activeUrl || !browser.bounds) {
    updateBrowser(activeWorkspaceId, (state) =>
      setBrowserError(state, "Browser preview bounds are not ready"),
    );
    return;
  }

  try {
    const screenshot = await captureBrowserPreview({
      workspaceRoot: activeWorkspace.path,
      request: {
        url: browser.activeUrl,
        title: browser.activeTitle ?? browser.activeUrl,
        bounds: browser.bounds,
      },
    });
    updateBrowser(activeWorkspaceId, (state) => storeBrowserScreenshot(state, screenshot));
  } catch (error) {
    updateBrowser(activeWorkspaceId, (state) =>
      setBrowserError(state, `Capture failed: ${terminalErrorMessage(error)}`),
    );
  }
}
```

Pass `browserScreenshots: view.browser.screenshots` to `collectAgentAvailableContext`.

- [ ] **Step 6: Render browser tab and split editor/browser layout**

Add tab when `surface === "browser-preview"`:

```tsx
{surface === "browser-preview" ? (
  <div className="tab active" title={view.browser.activeUrl ?? "Browser"}>
    <Globe className="ftype" aria-hidden="true" />
    <span className="tlabel mono">{view.browser.activeTitle ?? "Browser"}</span>
    <button
      type="button"
      className="close"
      title="Close browser preview"
      aria-label="Close browser preview"
      onClick={() => setSurface("empty")}
    >
      <X aria-hidden="true" />
    </button>
  </div>
) : null}
```

Add browser surface branch:

```tsx
) : surface === "browser-preview" ? (
  <div className={`browser-split${activeEditorTab ? " has-editor" : ""}`}>
    {activeEditorTab && showLoadedEditor ? (
      <div className="browser-split-editor">
        <Suspense fallback={<div className="editor-loading">Loading editor</div>}>
          <EditorTab
            workspaceId={activeWorkspaceId ?? ""}
            filePath={loadedFile!.path}
            content={loadedFile!.content}
            language={loadedFile!.language}
            readOnly={loadedFile!.readOnly}
            diagnostics={activeFileDiagnostics}
            findOpen={findOpen}
            findFocusRequest={findFocusRequest}
            findQuery={findQuery}
            onFindQueryChange={setFindQuery}
            onContentChange={handleEditorContentChange}
            onHover={onLanguageHover}
            onGoToDefinition={onLanguageGoToDefinition}
            onReferences={onLanguageReferences}
            onCompletion={onLanguageCompletion}
            onCodeActions={onLanguageCodeActions}
            onRename={onLanguageRename}
            onDirtyChange={() => undefined}
          />
        </Suspense>
      </div>
    ) : null}
    <BrowserPreviewSurface
      workspaceId={activeWorkspaceId}
      url={view.browser.activeUrl}
      title={view.browser.activeTitle}
      reloadVersion={view.browser.reloadVersion}
      hardReloadVersion={view.browser.hardReloadVersion}
      onBoundsChange={(bounds) =>
        updateBrowser(activeWorkspaceId, (browser) => updateBrowserBounds(browser, bounds))
      }
      onError={(message) =>
        updateBrowser(activeWorkspaceId, (browser) => setBrowserError(browser, message))
      }
    />
  </div>
```

Add browser surface to editor-content class checks and breadcrumb labels.

Modify command handling:

```typescript
case "open-browser-preview":
  void openBrowserPreview(view.browser.urlInput);
  break;
case "browser-reload":
  reloadBrowserPreview();
  break;
case "browser-hard-reload":
  hardReloadBrowserPreview();
  break;
case "browser-capture-screenshot":
  void captureBrowserScreenshot();
  break;
```

- [ ] **Step 7: Add split CSS**

Modify `src/index.css`:

```css
.browser-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
  height: 100%;
}

.browser-split.has-editor {
  grid-template-columns: minmax(280px, 1fr) minmax(320px, 1fr);
}

.browser-split-editor {
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--line);
  overflow: hidden;
}

@media (max-width: 820px) {
  .browser-split.has-editor {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(220px, 1fr) minmax(260px, 1fr);
  }

  .browser-split-editor {
    border-right: none;
    border-bottom: 1px solid var(--line);
  }
}
```

- [ ] **Step 8: Run tests to verify GREEN**

Run:

```bash
bun test src/app/workspace-view-state.test.ts src/app/AppShell.contract.test.tsx src/features/browser/BrowserPanel.test.tsx src/features/browser/BrowserPreviewSurface.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Refactor and verify frontend build**

Run:

```bash
bun run build
```

Expected: PASS with only existing Vite chunk-size warning if emitted.

- [ ] **Step 10: Commit Task 5**

```bash
git add src/app/workspace-view-state.ts src/app/workspace-view-state.test.ts src/app/AppShell.tsx src/app/AppShell.contract.test.tsx src/index.css
git commit -m "feat: wire browser preview workspace"
```

## Task 6: Full Verification, Browser Smoke, Documentation, And Roadmap Update

**Files:**
- Create: `docs/architecture/node-8-browser-results.md`
- Modify: `docs/architecture/progress.md`
- Modify: `roadmap.md`

- [ ] **Step 1: Run full frontend and Rust verification**

Run:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
git diff --check
```

Expected:

- `bun test`: PASS for all frontend tests.
- `bun run build`: PASS with Vite chunk-size warning only if present.
- `cargo test`: PASS for all Rust tests.
- `cargo fmt --check`: PASS.
- `cargo clippy`: PASS.
- `git diff --check`: PASS.

- [ ] **Step 2: Run Tauri debug build**

Run:

```bash
. "$HOME/.cargo/env" && bun run tauri build --debug
```

Expected: PASS and build the macOS debug app and DMG under `src-tauri/target/debug/bundle/`.

- [ ] **Step 3: Run browser UI smoke in mocked DOM**

Run:

```bash
bun test src/features/browser/browser-model.test.ts src/features/browser/BrowserPanel.test.tsx src/features/browser/BrowserPreviewSurface.test.tsx src/app/AppShell.contract.test.tsx
```

Expected: PASS and include coverage for:

- localhost URL launcher,
- dev-server detection from task output and commands,
- reload and hard reload counters,
- split surface adapter calls,
- screenshot context attachment,
- disabled capture when bounds are unavailable.

- [ ] **Step 4: Record Node 8 results**

Create `docs/architecture/node-8-browser-results.md` after all implementation and reviews finish. The document must contain these headings with real evidence from this run:

- `# Node 8 Browser Preview Results`
- `## Status`: state that Node 8 completed and passed only after every verification command has passed.
- `## Scope Delivered`: list the delivered browser preview, localhost launcher, task-derived dev-server targets, reload controls, workspace-scoped state, split editor/browser layout, macOS preview-region screenshot capture, screenshot agent context, and bounded console error state.
- `## TDD Evidence`: include one row per implementation task with the exact RED command, observed failing reason, GREEN command, and refactor verification command.
- `## Review Evidence`: include one row per implementation task with the implementer commit SHA, spec-compliance reviewer result, code-quality reviewer result, and any follow-up fix commit SHAs.
- `## Verification Evidence`: include the exact final command results for `bun test`, `bun run build`, Rust tests, Rust formatting, Rust clippy, Tauri debug build, and `git diff --check`.
- `## Residual Risks`: record that screenshot capture uses macOS `screencapture`, non-macOS capture returns an explicit unsupported error, Tauri WebView lacks direct page-pixel screenshot API in the current package, and console error state is present while automatic console event collection depends on future WebView event support.

Do not write synthetic counts, fabricated SHAs, angle-bracket markers, or generic success text. Every result line must be backed by a command output or subagent review result from this Node 8 run.

- [ ] **Step 5: Update progress and roadmap**

Modify `docs/architecture/progress.md`:

Add a `### Node 8: Browser Preview And Local Dev Loop` section under the current date. The section must say `Status: completed and passed.` and must cite `docs/architecture/node-8-browser-results.md`. Include the final verification commands and their observed pass results using the real counts and bundle paths from this run.

Modify `roadmap.md` current priority from Node 8 to Node 9 after Node 8 verification passes.

- [ ] **Step 6: Run documentation gate**

Run:

```bash
test -f docs/architecture/node-8-browser-results.md
rg -n 'T[B]D|T[O]DO|F[I]XME|place[ ]holder|fill with actual[ ]count|0 tests|0 pass|<[a]ctual|<[s]ha>|<[a]pproved|<[a]ctual command' docs/architecture/node-8-browser-results.md docs/architecture/progress.md roadmap.md
git diff --check
```

Expected:

- `test -f` exits 0.
- `rg` returns no matches.
- `git diff --check` exits 0.

- [ ] **Step 7: Commit Task 6 and final Node 8 docs**

```bash
git add docs/architecture/node-8-browser-results.md docs/architecture/progress.md roadmap.md
git commit -m "docs: record node 8 browser results"
```

## Task Execution Order

Execute tasks strictly in this order:

1. Task 1 Rust URL validation, screenshot capture, and screenshot agent kind.
2. Task 2 browser model/API and screenshot agent context.
3. Task 3 child WebView adapter and preview surface.
4. Task 4 browser panel, rail item, and command palette.
5. Task 5 workspace/AppShell integration and split layout.
6. Task 6 full verification and documentation.

Do not dispatch parallel implementation subagents for these tasks because Task 2 depends on Task 1 context kind, Task 3 depends on Task 2 browser types, Task 4 depends on Task 2 browser state, Task 5 depends on Tasks 2-4, and Task 6 depends on all implementation tasks.

## Per-Task Review Gates

After each implementation task:

1. Dispatch a spec-compliance reviewer using `gpt-5.5` with `xhigh` reasoning.
2. If spec review finds issues, send the exact findings back to the implementer and re-review after fixes.
3. Dispatch a code-quality reviewer using `gpt-5.5` with `xhigh` reasoning only after spec compliance passes.
4. If code-quality review finds issues, send the exact findings back to the implementer and re-review after fixes.
5. Record the implementer commit SHA, red/green/refactor commands, and reviewer result for `docs/architecture/node-8-browser-results.md`.

## Self-Review

- Spec coverage: Tasks 1 and 5 cover embedded preview and screenshot capture; Tasks 2, 4, and 5 cover localhost launcher, dev-server detection, reload controls, split layout, workspace-scoped state, screenshots, and agent context attachment; Task 4 provides a bounded console error surface; Task 6 records acceptance evidence.
- Placeholder scan: this plan intentionally avoids completion claims and marks evidence fields only inside instructions for the final results document. Task 6 requires replacing those markers before commit and adds an `rg` gate to enforce that.
- Type consistency: `BrowserScreenshot`, `BrowserPreviewBounds`, `BrowserUrl`, `BrowserViewState`, `AgentContextKind = "screenshot"`, and `Surface = "browser-preview"` are named consistently across Rust, TypeScript, AppShell, and documentation tasks.
