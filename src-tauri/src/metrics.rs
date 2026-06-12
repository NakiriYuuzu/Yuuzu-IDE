use serde::Serialize;
use std::{
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone)]
pub struct AppMetricInput {
    pub started_ms: u128,
    pub workspace_count: usize,
    pub active_workspace_id: Option<String>,
    pub docs_index_entries: usize,
    pub file_tree_entries: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppMetricSnapshot {
    pub timestamp_ms: u128,
    pub process_id: u32,
    pub memory_bytes: Option<u64>,
    pub uptime_ms: u128,
    pub workspace_count: usize,
    pub active_workspace_id: Option<String>,
    pub docs_index_entries: usize,
    pub file_tree_entries: usize,
}

pub fn current_time_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before unix epoch")
        .as_millis()
}

pub fn snapshot(input: AppMetricInput) -> AppMetricSnapshot {
    let timestamp_ms = current_time_ms();
    let process_id = std::process::id();

    AppMetricSnapshot {
        timestamp_ms,
        process_id,
        memory_bytes: process_memory_bytes(process_id),
        uptime_ms: timestamp_ms.saturating_sub(input.started_ms),
        workspace_count: input.workspace_count,
        active_workspace_id: input.active_workspace_id,
        docs_index_entries: input.docs_index_entries,
        file_tree_entries: input.file_tree_entries,
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
        let value = snapshot(AppMetricInput {
            started_ms: current_time_ms(),
            workspace_count: 0,
            active_workspace_id: None,
            docs_index_entries: 0,
            file_tree_entries: 0,
        });

        assert!(value.process_id > 0);
    }

    #[test]
    fn snapshot_includes_uptime_memory_and_index_counts() {
        let started_ms = current_time_ms().saturating_sub(50);
        let snapshot = snapshot(AppMetricInput {
            started_ms,
            workspace_count: 2,
            active_workspace_id: Some("workspace-a".to_string()),
            docs_index_entries: 3,
            file_tree_entries: 4,
        });

        assert!(snapshot.uptime_ms >= 50);
        if let Some(memory_bytes) = snapshot.memory_bytes {
            assert!(memory_bytes > 0);
        }
        assert_eq!(snapshot.workspace_count, 2);
        assert_eq!(snapshot.active_workspace_id.as_deref(), Some("workspace-a"));
        assert_eq!(snapshot.docs_index_entries, 3);
        assert_eq!(snapshot.file_tree_entries, 4);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn snapshot_reads_current_process_memory_when_available() {
        let memory = process_memory_bytes(std::process::id()).expect("memory");

        assert!(memory > 0);
    }
}
