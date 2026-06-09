use serde::Serialize;
use std::{
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, Serialize)]
pub struct AppMetricSnapshot {
    pub timestamp_ms: u128,
    pub process_id: u32,
}

pub fn snapshot() -> AppMetricSnapshot {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before unix epoch")
        .as_millis();

    AppMetricSnapshot {
        timestamp_ms,
        process_id: std::process::id(),
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub fn process_memory_bytes(pid: u32) -> Option<u64> {
    let output = Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let rss_kib = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u64>()
        .ok()?;
    rss_kib.checked_mul(1024)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn process_memory_bytes(_pid: u32) -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_includes_process_id() {
        let value = snapshot();

        assert!(value.process_id > 0);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn snapshot_reads_current_process_memory_when_available() {
        let memory = process_memory_bytes(std::process::id()).expect("memory");

        assert!(memory > 0);
    }
}
