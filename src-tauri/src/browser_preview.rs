use std::{fs, process::Command, time::SystemTime};

use base64::{engine::general_purpose, Engine as _};

const MAX_SCREENSHOT_PIXELS: i64 = 8_294_400;
const MAX_SCREENSHOT_TITLE_CHARS: usize = 160;
const PNG_MAGIC: &[u8] = &[137, 80, 78, 71, 13, 10, 26, 10];

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
    pub width: i32,
    pub height: i32,
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
    pub title: String,
    pub width: i32,
    pub height: i32,
    pub captured_ms: u64,
    pub data_url: String,
}

pub fn normalize_browser_url(input: &str) -> Result<BrowserUrl, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("browser url is empty".to_string());
    }

    let normalized = if input.contains("://") {
        input.to_string()
    } else {
        format!("http://{input}")
    };

    let Some((scheme, rest)) = normalized.split_once("://") else {
        return Err("invalid browser url".to_string());
    };
    if scheme != "http" {
        return Err(format!("unsupported browser scheme: {scheme}"));
    }

    let (authority, path, query, fragment) = split_browser_url(rest)?;
    let (host, port) = parse_loopback_host(authority)?;

    let mut normalized_url = format!("http://{authority}");
    normalized_url.push_str(&path);
    if let Some(query) = query {
        normalized_url.push('?');
        normalized_url.push_str(&query);
    }
    if let Some(fragment) = fragment {
        normalized_url.push('#');
        normalized_url.push_str(&fragment);
    }

    Ok(BrowserUrl {
        url: normalized_url,
        host,
        port,
    })
}

fn split_browser_url(input: &str) -> Result<(&str, String, Option<&str>, Option<&str>), String> {
    if input.is_empty() {
        return Err("browser url is missing host".to_string());
    }

    let mut remainder = input;
    let mut fragment = None;
    if let Some((before_hash, hash)) = remainder.split_once('#') {
        fragment = Some(hash);
        remainder = before_hash;
    }

    let mut query = None;
    if let Some((before_query, query_part)) = remainder.split_once('?') {
        query = Some(query_part);
        remainder = before_query;
    }

    let (authority, path_part) = match remainder.split_once('/') {
        Some((authority, path_part)) => (authority, Some(path_part)),
        None => (remainder, None),
    };

    if authority.is_empty() {
        return Err("browser url is missing host".to_string());
    }
    let path = if let Some(path_after) = path_part {
        if path_after.is_empty() {
            "/".to_string()
        } else {
            format!("/{path_after}")
        }
    } else {
        String::new()
    };

    Ok((authority, path, query, fragment))
}

fn parse_loopback_host(authority: &str) -> Result<(String, Option<u16>), String> {
    if authority.starts_with('[') {
        let Some(close) = authority.find(']') else {
            return Err("browser url has invalid IPv6 host".to_string());
        };

        let host = &authority[1..close];
        if host != "::1" {
            return Err("browser host is not a loopback address".to_string());
        }

        if close + 1 == authority.len() {
            return Ok((host.to_string(), None));
        }

        let suffix = &authority[close + 1..];
        if !suffix.starts_with(':') {
            return Err("browser url has invalid IPv6 port".to_string());
        }
        let port = parse_port(&suffix[1..])?;
        Ok((host.to_string(), Some(port)))
    } else {
        let mut split = authority.split(':');
        let host = split
            .next()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "browser url is missing host".to_string())?;
        let port = match split.next() {
            Some(raw_port) if !raw_port.is_empty() => Some(parse_port(raw_port)?),
            Some(_) => return Err("browser url has invalid port".to_string()),
            None => None,
        };

        if split.next().is_some() {
            return Err("browser url host is malformed".to_string());
        }
        if host != "localhost" && host != "127.0.0.1" {
            return Err("browser host is not a loopback address".to_string());
        }

        Ok((host.to_string(), port))
    }
}

fn parse_port(raw_port: &str) -> Result<u16, String> {
    let port: u16 = raw_port
        .parse()
        .map_err(|_| "browser url has invalid port".to_string())?;
    if port == 0 {
        return Err("browser url has invalid port".to_string());
    }
    Ok(port)
}

pub fn validate_capture_bounds(bounds: &BrowserCaptureBounds) -> Result<(), String> {
    if bounds.width <= 0 || bounds.height <= 0 {
        return Err("capture region must have positive width and height".to_string());
    }
    if bounds.x < 0 || bounds.y < 0 {
        return Err("capture region origin must not be negative".to_string());
    }

    let area = i64::from(bounds.width) * i64::from(bounds.height);
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
    let _ = normalize_browser_url(&request.url)?;
    validate_capture_bounds(&request.bounds)?;
    let bytes = capture_png(&request.bounds)?;
    validate_png_signature(&bytes)?;
    let encoded = general_purpose::STANDARD.encode(bytes);

    Ok(BrowserScreenshot {
        id: generate_id(),
        workspace_root: workspace_root.as_ref().to_string(),
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
        return Err(format!("screencapture command failed: {message}"));
    };

    fs::remove_file(&path)
        .map_err(|err| format!("failed to remove temporary screenshot: {err}"))?;
    Ok(bytes)
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
