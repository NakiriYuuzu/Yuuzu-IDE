use std::{io::Write, process::Stdio};

use crate::background_process::background_command;

pub fn write_text(text: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        write_text_with_command("/usr/bin/pbcopy", &[], text)
    }

    #[cfg(target_os = "windows")]
    {
        write_text_with_command("cmd", &["/C", "clip"], text)
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        write_text_with_command("wl-copy", &[], text)
            .or_else(|_| write_text_with_command("xclip", &["-selection", "clipboard"], text))
    }

    #[cfg(not(any(unix, target_os = "windows")))]
    {
        let _ = text;
        Err("clipboard text write is not supported on this platform".to_string())
    }
}

fn write_text_with_command(program: &str, args: &[&str], text: &str) -> Result<(), String> {
    let mut child = background_command(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to start clipboard command '{program}': {err}"))?;

    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "clipboard command stdin is unavailable".to_string())?;
        stdin
            .write_all(text.as_bytes())
            .map_err(|err| format!("failed to write clipboard text: {err}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("failed to wait for clipboard command: {err}"))?;
    if output.status.success() {
        return Ok(());
    }

    let message = if output.stderr.is_empty() {
        output.status.to_string()
    } else {
        String::from_utf8_lossy(&output.stderr).trim().to_string()
    };
    Err(format!("clipboard command failed: {message}"))
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    #[test]
    fn write_text_with_command_streams_text_to_stdin() {
        super::write_text_with_command("/bin/sh", &["-c", "cat >/dev/null"], "abc123")
            .expect("clipboard command succeeds");
    }

    #[cfg(unix)]
    #[test]
    fn write_text_with_command_reports_failed_status() {
        let err =
            super::write_text_with_command("/bin/sh", &["-c", "echo denied >&2; exit 7"], "abc123")
                .expect_err("clipboard command fails");

        assert!(err.contains("denied"));
    }
}
