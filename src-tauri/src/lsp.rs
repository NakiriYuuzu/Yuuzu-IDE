use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub enum LanguageId {
    Rust,
    TypeScript,
    JavaScript,
    Python,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LanguageServerProfile {
    pub language: LanguageId,
    pub display_name: String,
    pub command: String,
    pub args: Vec<String>,
}

pub fn detect_language(path: &str) -> Option<LanguageId> {
    let extension = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();

    match extension.as_str() {
        "rs" => Some(LanguageId::Rust),
        "ts" | "tsx" | "mts" | "cts" => Some(LanguageId::TypeScript),
        "js" | "jsx" | "mjs" | "cjs" => Some(LanguageId::JavaScript),
        "py" | "pyw" => Some(LanguageId::Python),
        _ => None,
    }
}

pub fn server_profile(language: LanguageId) -> LanguageServerProfile {
    match language {
        LanguageId::Rust => LanguageServerProfile {
            language,
            display_name: "Rust Analyzer".to_string(),
            command: "rust-analyzer".to_string(),
            args: Vec::new(),
        },
        LanguageId::TypeScript => LanguageServerProfile {
            language,
            display_name: "TypeScript Language Server".to_string(),
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
        },
        LanguageId::JavaScript => LanguageServerProfile {
            language,
            display_name: "JavaScript Language Server".to_string(),
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
        },
        LanguageId::Python => LanguageServerProfile {
            language,
            display_name: "Python LSP Server".to_string(),
            command: "pylsp".to_string(),
            args: Vec::new(),
        },
    }
}

pub fn encode_lsp_message(value: &serde_json::Value) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(value).map_err(|err| err.to_string())?;
    let mut frame = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    frame.extend(body);
    Ok(frame)
}

pub fn decode_lsp_message(buffer: &mut Vec<u8>) -> Result<Option<serde_json::Value>, String> {
    let Some(header_end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") else {
        return Ok(None);
    };

    let header = std::str::from_utf8(&buffer[..header_end]).map_err(|err| err.to_string())?;
    let content_length_value = header
        .lines()
        .find_map(|line| line.strip_prefix("Content-Length: "))
        .ok_or_else(|| "missing LSP Content-Length header".to_string())?;
    let content_length = content_length_value
        .parse::<usize>()
        .map_err(|err| format!("invalid LSP Content-Length: {err}"))?;

    let body_start = header_end + 4;
    let body_end = body_start
        .checked_add(content_length)
        .ok_or_else(|| "invalid LSP Content-Length exceeds frame bounds".to_string())?;
    if buffer.len() < body_end {
        return Ok(None);
    }

    let body = buffer[body_start..body_end].to_vec();
    buffer.drain(..body_end);
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_supported_languages_from_workspace_paths() {
        assert_eq!(detect_language("src/main.rs"), Some(LanguageId::Rust));
        assert_eq!(detect_language("src/app.ts"), Some(LanguageId::TypeScript));
        assert_eq!(detect_language("src/app.tsx"), Some(LanguageId::TypeScript));
        assert_eq!(detect_language("src/app.mts"), Some(LanguageId::TypeScript));
        assert_eq!(detect_language("src/app.cts"), Some(LanguageId::TypeScript));
        assert_eq!(detect_language("src/app.js"), Some(LanguageId::JavaScript));
        assert_eq!(
            detect_language("scripts/build.py"),
            Some(LanguageId::Python)
        );
        assert_eq!(detect_language("README.md"), None);
    }

    #[test]
    fn profiles_use_expected_language_server_commands() {
        assert_eq!(server_profile(LanguageId::Rust).command, "rust-analyzer");
        assert_eq!(
            server_profile(LanguageId::TypeScript).command,
            "typescript-language-server"
        );
        assert_eq!(
            server_profile(LanguageId::JavaScript).command,
            "typescript-language-server"
        );
        assert_eq!(server_profile(LanguageId::Python).command, "pylsp");
        assert_eq!(
            server_profile(LanguageId::TypeScript).args,
            vec!["--stdio".to_string()]
        );
    }

    #[test]
    fn encodes_and_decodes_lsp_content_length_frames() {
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize"
        });
        let frame = encode_lsp_message(&payload).expect("encode");
        let mut buffer = frame.clone();

        let decoded = decode_lsp_message(&mut buffer)
            .expect("decode")
            .expect("message");

        assert_eq!(decoded, payload);
        assert!(buffer.is_empty());
    }

    #[test]
    fn waits_for_complete_lsp_frame_body() {
        let mut buffer = b"Content-Length: 12\r\n\r\n{\"jsonrpc\"".to_vec();
        assert!(decode_lsp_message(&mut buffer).expect("decode").is_none());
        assert_eq!(
            buffer.len(),
            b"Content-Length: 12\r\n\r\n{\"jsonrpc\"".len()
        );
    }

    #[test]
    fn reports_invalid_lsp_content_length_header() {
        let mut buffer = b"Content-Length: abc\r\n\r\n{}".to_vec();

        let error = decode_lsp_message(&mut buffer).expect_err("invalid length");

        assert!(error.contains("invalid LSP Content-Length"));
        assert_eq!(buffer, b"Content-Length: abc\r\n\r\n{}".to_vec());
    }

    #[test]
    fn rejects_lsp_content_length_that_overflows_frame_end() {
        let mut buffer = format!("Content-Length: {}\r\n\r\n{{}}", usize::MAX).into_bytes();

        let error = decode_lsp_message(&mut buffer).expect_err("overflowing length");

        assert_eq!(error, "invalid LSP Content-Length exceeds frame bounds");
        assert!(buffer.starts_with(b"Content-Length: "));
    }
}
