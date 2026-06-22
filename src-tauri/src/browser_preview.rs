use std::{fs, process::Command, time::SystemTime};

use base64::{engine::general_purpose, Engine as _};

const MAX_SCREENSHOT_PIXELS: u64 = 8_294_400;
const MAX_SCREENSHOT_TITLE_CHARS: usize = 160;
const PNG_MAGIC: &[u8] = &[137, 80, 78, 71, 13, 10, 26, 10];

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

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
            normalize_browser_url("http://127.0.0.1:3000")
                .expect("ipv4")
                .host,
            "127.0.0.1"
        );
        assert_eq!(
            normalize_browser_url("http://[::1]:8080/")
                .expect("ipv6")
                .host,
            "::1"
        );
    }

    #[test]
    fn accepts_remote_https_urls_and_preserves_parts() {
        let url =
            normalize_browser_url("https://example.com/docs?q=tauri#webview").expect("https url");

        assert_eq!(url.url, "https://example.com/docs?q=tauri#webview");
        assert_eq!(url.host, "example.com");
        assert_eq!(url.port, None);

        let with_port =
            normalize_browser_url("https://example.com:8443/path").expect("https url with port");
        assert_eq!(with_port.url, "https://example.com:8443/path");
        assert_eq!(with_port.host, "example.com");
        assert_eq!(with_port.port, Some(8443));
    }

    #[test]
    fn keeps_http_urls_loopback_only() {
        assert!(normalize_browser_url("localhost:5173/dashboard").is_ok());
        assert!(normalize_browser_url("http://127.0.0.1:3000").is_ok());
        assert!(normalize_browser_url("http://[::1]:8080/").is_ok());

        assert!(normalize_browser_url("http://example.com").is_err());
        assert!(normalize_browser_url("http://example.local:3000").is_err());
        assert!(normalize_browser_url("http://localhost.evil.test:3000").is_err());
    }

    #[test]
    fn rejects_unsupported_and_credentialed_browser_urls() {
        for value in [
            "",
            "file:///Users/yuuzu/index.html",
            "tauri://localhost",
            "data:text/html,hello",
            "javascript:alert(1)",
            "https://user@example.com",
            "https://user:pass@example.com",
            "http://localhost:0",
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

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_capture_error_includes_region_and_permission_hint() {
        let error = format_capture_error(
            &BrowserCaptureBounds {
                x: 337,
                y: 713,
                width: 863,
                height: 661,
            },
            "could not create image from rect",
        );

        assert!(error.contains("region 337,713,863,661"));
        assert!(error.contains("Screen Recording permission"));
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
        let width: u32 = screenshot.width;
        let height: u32 = screenshot.height;
        assert_eq!(width, 320);
        assert_eq!(height, 180);
        assert_eq!(screenshot.url, "http://localhost:5173/");
        assert!(screenshot.data_url.starts_with("data:image/png;base64,"));
        assert_eq!(screenshot.captured_ms, 42);
    }

    #[test]
    fn capture_region_stores_normalized_url() {
        let request = BrowserCaptureRequest {
            url: "localhost:5173/dashboard".to_string(),
            title: "localhost:5173/dashboard".to_string(),
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
            || "shot-2".to_string(),
        )
        .expect("screenshot");

        assert_eq!(screenshot.url, "http://localhost:5173/dashboard");
    }

    #[test]
    fn capture_region_allows_negative_coordinates() {
        let captured_bounds: Arc<Mutex<Option<BrowserCaptureBounds>>> = Arc::new(Mutex::new(None));
        let request = BrowserCaptureRequest {
            url: "http://localhost:5173/".to_string(),
            title: "local".to_string(),
            bounds: BrowserCaptureBounds {
                x: -320,
                y: -200,
                width: 320,
                height: 180,
            },
        };

        let observed = captured_bounds.clone();
        capture_preview_with(
            "/workspace",
            request,
            move |bounds| {
                *observed.lock().expect("capture bounds") = Some(bounds.clone());
                Ok(vec![137, 80, 78, 71, 13, 10, 26, 10])
            },
            || Ok(42),
            || "shot-3".to_string(),
        )
        .expect("screenshot");

        let observed = captured_bounds.lock().expect("capture bounds");
        let observed = observed.as_ref().expect("bounds");
        assert_eq!(observed.x, -320);
        assert_eq!(observed.y, -200);
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BrowserUrl {
    pub url: String,
    pub host: String,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BrowserCaptureBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BrowserCaptureRequest {
    pub url: String,
    pub title: String,
    pub bounds: BrowserCaptureBounds,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BrowserScreenshot {
    pub id: String,
    pub workspace_root: String,
    pub url: String,
    pub title: String,
    pub width: u32,
    pub height: u32,
    pub captured_ms: u64,
    pub data_url: String,
}

pub fn normalize_browser_url(input: &str) -> Result<BrowserUrl, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("browser url is empty".to_string());
    }

    let candidate = if input.contains("://") {
        input.to_string()
    } else {
        format!("http://{input}")
    };
    let parsed = url::Url::parse(&candidate).map_err(|_| "invalid browser url".to_string())?;
    let scheme = parsed.scheme();

    if scheme != "http" && scheme != "https" {
        return Err(format!("unsupported browser scheme: {scheme}"));
    }
    if parsed.cannot_be_a_base() {
        return Err("browser url is missing host".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("browser url must not include credentials".to_string());
    }
    if parsed.port() == Some(0) {
        return Err("browser url has invalid port".to_string());
    }

    let host = browser_host_string(&parsed)?;

    if scheme == "http" && !is_loopback_url(&parsed) {
        return Err("browser host is not a loopback address".to_string());
    }

    Ok(BrowserUrl {
        url: parsed.to_string(),
        host,
        port: parsed.port(),
    })
}

fn is_loopback_url(url: &url::Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(addr)) => addr.is_loopback(),
        Some(url::Host::Ipv6(addr)) => addr.is_loopback(),
        None => false,
    }
}

fn browser_host_string(url: &url::Url) -> Result<String, String> {
    match url.host() {
        Some(url::Host::Domain(host)) if !host.is_empty() => Ok(host.to_string()),
        Some(url::Host::Ipv4(addr)) => Ok(addr.to_string()),
        Some(url::Host::Ipv6(addr)) => Ok(addr.to_string()),
        _ => Err("browser url is missing host".to_string()),
    }
}

pub fn validate_capture_bounds(bounds: &BrowserCaptureBounds) -> Result<(), String> {
    if bounds.width == 0 || bounds.height == 0 {
        return Err("capture region must have positive width and height".to_string());
    }

    let area = u64::from(bounds.width) * u64::from(bounds.height);
    if area > MAX_SCREENSHOT_PIXELS {
        return Err("capture region exceeds maximum area".to_string());
    }

    Ok(())
}

pub fn capture_preview(
    workspace_root: impl AsRef<str>,
    request: BrowserCaptureRequest,
) -> Result<BrowserScreenshot, String> {
    let workspace_root = workspace_root.as_ref().to_string();
    let workspace_root_capture = workspace_root.clone();
    capture_preview_with(
        workspace_root,
        request,
        move |bounds| capture_png_bytes(&workspace_root_capture, bounds),
        current_time_ms,
        || uuid::Uuid::new_v4().to_string(),
    )
}

pub fn capture_preview_with(
    workspace_root: impl AsRef<str>,
    request: BrowserCaptureRequest,
    capture_png: impl Fn(&BrowserCaptureBounds) -> Result<Vec<u8>, String>,
    current_time_ms: impl Fn() -> Result<u64, String>,
    generate_id: impl Fn() -> String,
) -> Result<BrowserScreenshot, String> {
    let normalized_url = normalize_browser_url(&request.url)?;
    validate_capture_bounds(&request.bounds)?;
    let bytes = capture_png(&request.bounds)?;
    validate_png_signature(&bytes)?;
    let encoded = general_purpose::STANDARD.encode(bytes);

    Ok(BrowserScreenshot {
        id: generate_id(),
        workspace_root: workspace_root.as_ref().to_string(),
        url: normalized_url.url,
        title: bound_title(request.title),
        width: request.bounds.width,
        height: request.bounds.height,
        captured_ms: current_time_ms()?,
        data_url: format!("data:image/png;base64,{encoded}"),
    })
}

fn bound_title(value: String) -> String {
    value.chars().take(MAX_SCREENSHOT_TITLE_CHARS).collect()
}

fn validate_png_signature(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < PNG_MAGIC.len() {
        return Err("screenshot image is not valid png".to_string());
    }

    if bytes.starts_with(PNG_MAGIC) {
        Ok(())
    } else {
        Err("screenshot image is not valid png".to_string())
    }
}

pub fn capture_png_bytes(
    _workspace_root: &str,
    bounds: &BrowserCaptureBounds,
) -> Result<Vec<u8>, String> {
    capture_png_bytes_on_platform(bounds)
}

#[cfg(target_os = "macos")]
fn capture_png_bytes_on_platform(bounds: &BrowserCaptureBounds) -> Result<Vec<u8>, String> {
    let path = temporary_screenshot_path()?;
    let command_output = Command::new("/usr/sbin/screencapture")
        .args([
            "-x",
            "-R",
            &format!(
                "{},{},{},{}",
                bounds.x, bounds.y, bounds.width, bounds.height
            ),
            path.to_str()
                .ok_or_else(|| "invalid temporary path".to_string())?,
        ])
        .output()
        .map_err(|err| format!("failed to run screencapture: {err}"))?;

    let bytes = if command_output.status.success() {
        fs::read(&path).map_err(|err| {
            let _ = fs::remove_file(&path);
            format!("failed to read screenshot file: {err}")
        })?
    } else {
        let message = if command_output.stderr.is_empty() {
            command_output.status.to_string()
        } else {
            String::from_utf8_lossy(&command_output.stderr).into_owned()
        };
        let _ = fs::remove_file(&path);
        return Err(format_capture_error(bounds, &message));
    };

    fs::remove_file(&path)
        .map_err(|err| format!("failed to remove temporary screenshot: {err}"))?;
    Ok(bytes)
}

#[cfg(target_os = "macos")]
fn format_capture_error(bounds: &BrowserCaptureBounds, message: &str) -> String {
    let hint = if message.contains("could not create image from rect") {
        "; Screen Recording permission may be required for Yuuzu-IDE"
    } else {
        ""
    };
    format!(
        "screencapture command failed for region {},{},{},{}: {message}{hint}",
        bounds.x, bounds.y, bounds.width, bounds.height
    )
}

#[cfg(not(target_os = "macos"))]
fn capture_png_bytes_on_platform(_bounds: &BrowserCaptureBounds) -> Result<Vec<u8>, String> {
    Err("browser screenshot capture is currently supported on macOS only".to_string())
}

fn temporary_screenshot_path() -> Result<std::path::PathBuf, String> {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "yuuzu-browser-preview-{}.png",
        uuid::Uuid::new_v4()
    ));
    Ok(path)
}

pub fn current_time_ms() -> Result<u64, String> {
    let now = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "system time is invalid".to_string())?;
    Ok(now.as_millis() as u64)
}
