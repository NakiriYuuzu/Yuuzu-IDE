use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};

pub fn default_shell() -> String {
    #[cfg(windows)]
    {
        shell_from_env("COMSPEC", "powershell.exe")
    }

    #[cfg(not(windows))]
    {
        shell_from_env("SHELL", "/bin/zsh")
    }
}

pub fn spawn_shell_probe() -> Result<String, String> {
    let shell = default_shell();
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| err.to_string())?;
    let mut child = pair
        .slave
        .spawn_command(CommandBuilder::new(&shell))
        .map_err(|err| err.to_string())?;

    child.kill().map_err(|err| err.to_string())?;

    Ok(shell)
}

fn shell_from_env(name: &str, fallback: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shell_is_not_empty() {
        assert!(!default_shell().is_empty());
    }
}
